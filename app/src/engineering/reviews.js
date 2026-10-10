// The review board — every change read by more than the hand that wrote it.
//
// A review is two passes. The scanner runs first, here, synchronously and for
// free: secrets, dangerous calls, missing tests, unpinned dependencies, images
// without alt text. Then one reviewer per dimension is given the code and told
// what the scanner already found, so that the model spends its attention on
// what a regular expression cannot see — a missing authorisation check, a race,
// a query that is fine at ten rows and fatal at ten million.
//
// Reviewers sit on a different model family from the engineers who write the
// code, by the router's policy, because one model checking its own homework is
// not review. And a reviewer only ever *finds*: fixing is a change set an
// engineer proposes and a person applies, and saying anything on GitHub is a
// person's click.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { notify } from '../notify.js';
import { enqueueRun } from '../workflow.js';
import { openPii } from '../erasure.js';
import { getSetting } from '../settings.js';
import { projectRow, projectDir, walk, contextFor, requestChange, runCommand, gitLog } from '../forge.js';
import { DIMENSIONS, SEVERITIES, scanProject, scanPatches, score } from './scan.js';

exec(`CREATE TABLE IF NOT EXISTS eng_reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER REFERENCES forge_projects(id),
  repo         TEXT,                               -- owner/name, when the subject is on GitHub
  pr_number    INTEGER,
  subject      TEXT NOT NULL,                      -- project|pr|change
  title        TEXT NOT NULL,
  dimensions   TEXT NOT NULL,                      -- JSON [dimension]
  state        TEXT NOT NULL DEFAULT 'running',    -- running|done|failed
  score        INTEGER,
  verdict      TEXT,                               -- pass|warn|fail
  summary      TEXT,
  bom          TEXT,                               -- JSON: the bill of materials at review time
  counts       TEXT,                               -- JSON: files, source, tests
  command_id   INTEGER,                            -- the test run, when one was asked for
  commit_sha   TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  posted_by    TEXT,
  posted_at    TEXT,
  posted_url   TEXT
)`);
exec(`CREATE TABLE IF NOT EXISTS eng_review_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id  INTEGER NOT NULL REFERENCES eng_reviews(id),
  dimension  TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  run_id     TEXT,
  state      TEXT NOT NULL DEFAULT 'running',      -- running|done|held|failed
  summary    TEXT,
  verdict    TEXT
)`);
exec(`CREATE TABLE IF NOT EXISTS eng_findings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id   INTEGER NOT NULL REFERENCES eng_reviews(id),
  dimension   TEXT NOT NULL,
  source      TEXT NOT NULL,                       -- scanner|agent|tests
  agent_id    TEXT,
  severity    TEXT NOT NULL,
  rule        TEXT,
  file        TEXT,
  line        INTEGER,
  title       TEXT NOT NULL,
  detail      TEXT,
  evidence    TEXT,
  fix         TEXT,
  state       TEXT NOT NULL DEFAULT 'open',        -- open|dismissed|fixing|fixed
  change_id   INTEGER,
  issue_url   TEXT,
  decided_by  TEXT,
  decided_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);
exec('CREATE INDEX IF NOT EXISTS eng_findings_review ON eng_findings (review_id, severity)');
exec('CREATE INDEX IF NOT EXISTS eng_reviews_project ON eng_reviews (project_id, id)');

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const MARK = (d) => `[ENG-REVIEW:${d}]`;

/** Who reads for what. Dependencies have no reviewer: the scanner is the review. */
export const REVIEWERS = {
  security: { agent: 'AGT-SEC-001', label: 'Security reviewer', asks: 'authentication and authorisation gaps, injection of every kind, secrets, unsafe deserialisation, SSRF, path traversal, missing input validation, data exposed in logs or errors' },
  tests: { agent: 'AGT-QA-001', label: 'QA agent', asks: 'behaviour that has no test, tests that cannot fail, edge cases (empty, huge, unicode, concurrent), error paths, and acceptance criteria nobody verified' },
  quality: { agent: 'AGT-REV-001', label: 'Code reviewer', asks: 'correctness bugs first, then error handling, naming, duplication, dead code, and anything a maintainer would misread' },
  performance: { agent: 'AGT-PERF-001', label: 'Performance engineer', asks: 'N+1 queries, blocking work on a request path, unbounded growth, missing pagination or indexes, repeated work that could be cached' },
  accessibility: { agent: 'AGT-A11Y-001', label: 'Accessibility reviewer', asks: 'WCAG 2.2 AA failures in any interface: names, roles, keyboard, focus, contrast, language and right-to-left layout' },
};

const normSeverity = (s) => {
  const v = String(s || '').toLowerCase();
  if (SEVERITIES.includes(v)) return v;
  if (/block|crit/.test(v)) return 'critical';
  if (/major|high|error/.test(v)) return 'high';
  if (/minor|low/.test(v)) return 'low';
  if (/nit|info|note|suggest/.test(v)) return 'info';
  return 'medium';
};

function insertFinding(reviewId, f, { source, agentId = null }) {
  exec(`INSERT INTO eng_findings (review_id, dimension, source, agent_id, severity, rule, file, line, title, detail, evidence, fix)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  reviewId, f.dimension, source, agentId, normSeverity(f.severity), f.rule || null,
  f.file ? String(f.file).slice(0, 300) : null, Number.isFinite(Number(f.line)) && Number(f.line) > 0 ? Number(f.line) : null,
  String(f.title || f.claim || 'Finding').slice(0, 300), f.detail ? String(f.detail).slice(0, 4000) : null,
  f.evidence ? String(f.evidence).slice(0, 600) : null, f.fix ? String(f.fix).slice(0, 2000) : null);
}

/**
 * Start a review of a factory project, or of a pull request's files.
 *
 * `prFiles` is what GitHub returns for a pull request — filename, status and
 * patch per file. With it, only the lines the pull request adds are scanned
 * and the reviewers read the patch, not the repository.
 */
export function startReview({ projectId = null, repo = null, prNumber = null, prFiles = null, prTitle = null, title = null, dimensions = null, agents = true, runTests = false, actor }) {
  const dims = (Array.isArray(dimensions) && dimensions.length ? dimensions : DIMENSIONS).filter((d) => DIMENSIONS.includes(d));
  if (!dims.length) refuse(`choose at least one of: ${DIMENSIONS.join(', ')}`);
  const p = projectId ? projectRow(projectId) : null;
  if (!p && !prFiles) refuse('a review needs a project or a pull request');
  const subject = prFiles ? 'pr' : 'project';
  const name = title || (prFiles ? `${repo}#${prNumber}${prTitle ? ` — ${prTitle}` : ''}` : `${p.name}`);

  let scan;
  let head = null;
  if (prFiles) scan = { findings: scanPatches(prFiles, { only: dims }), bom: [], counts: { files: prFiles.length } };
  else {
    scan = scanProject(projectDir(p), walk(p), { only: dims });
    // The commit a review read, so a later deploy can ask whether *this* code
    // was reviewed rather than whether something with the same name once was.
    head = gitLog(p, 1)[0]?.sha || null;
  }
  exec(`INSERT INTO eng_reviews (project_id, repo, pr_number, subject, title, dimensions, bom, counts, commit_sha, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
  p?.id || null, repo, prNumber, subject, String(name).slice(0, 200), JSON.stringify(dims),
  JSON.stringify(scan.bom || []), JSON.stringify(scan.counts || {}), head, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  for (const f of scan.findings) insertFinding(id, f, { source: 'scanner' });

  if (agents) {
    const context = prFiles ? patchContext(prFiles) : contextFor(p, 45_000);
    for (const d of dims) {
      const r = REVIEWERS[d];
      if (!r) continue;
      const already = scan.findings.filter((f) => f.dimension === d).slice(0, 40)
        .map((f) => `- ${f.severity} ${f.file || ''}${f.line ? `:${f.line}` : ''} ${f.title}`).join('\n');
      const runId = enqueueRun({
        agentId: r.agent,
        taskType: `eng-review:${id}:${d}`,
        actor,
        input: {
          prompt: `${MARK(d)} Review ${prFiles ? `pull request ${repo}#${prNumber}${prTitle ? ` "${prTitle}"` : ''}` : `the repository "${p.name}"${p.description ? ` (${p.description})` : ''}`} for ${d.toUpperCase()}.

Look for: ${r.asks}.

A mechanical scanner already reported the findings below. Do NOT repeat them. Spend your attention on what a pattern match cannot see. If you believe one of them is a false positive, say so in the summary.
${already || '(the scanner found nothing in this dimension)'}

Report only real problems, each with the file and line, why it matters, and a concrete fix. If the code is good in this dimension, return no findings and say so — an empty review is an honest answer, an invented finding is not.

${prFiles ? 'THE PATCH' : 'FILES IN THE REPOSITORY'}:
${prFiles ? context : `${context.listing}\n\nCURRENT CONTENTS (most relevant first):\n${context.bodies}`}

Output JSON: {"summary":"","verdict":"pass|warn|fail","findings":[{"severity":"critical|high|medium|low|info","file":"","line":0,"title":"","detail":"","fix":""}],"confidence":0.0}`,
        },
      });
      exec('INSERT INTO eng_review_runs (review_id, dimension, agent_id, run_id) VALUES (?,?,?,?)', id, d, r.agent, runId);
    }
  }

  // The tests are the one reviewer that does not have an opinion.
  if (runTests && p && dims.includes('tests')) {
    const cmd = testCommandFor(p);
    if (cmd) {
      try {
        const c = runCommand({ projectId: p.id, command: cmd, actor });
        exec('UPDATE eng_reviews SET command_id = ? WHERE id = ?', c.id, id);
      } catch (e) {
        insertFinding(id, { dimension: 'tests', severity: 'medium', rule: 'tests.not-run', title: 'The tests could not be started', detail: e.message, fix: 'Install the project\'s dependencies (npm install) and run the tests from the terminal.' }, { source: 'tests' });
      }
    }
  }

  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'eng.review_started', subjectType: 'engReview', subjectId: id, payload: { subject, project: p?.slug || null, repo, prNumber, dimensions: dims, scannerFindings: scan.findings.length } });
  syncReviews();
  return getReview(id);
}

function patchContext(prFiles, budget = 45_000) {
  let used = 0;
  const out = [];
  for (const f of prFiles) {
    const block = `--- ${f.filename} (${f.status}, +${f.additions ?? '?'} -${f.deletions ?? '?'})\n${f.patch || '(no textual patch: binary or too large)'}`;
    if (used + block.length > budget) { out.push(`--- ${f.filename} (omitted: over the review budget)`); continue; }
    used += block.length;
    out.push(block);
  }
  return out.join('\n\n');
}

export function testCommandFor(p) {
  const dir = projectDir(p);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test)) return 'npm test';
  } catch { /* not a node project */ }
  if (walk(p).some((f) => /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(f.path))) return 'python -m unittest';
  return null;
}
/** Server tick: fold finished reviewer runs and test commands into the review. */
export function syncReviews() {
  for (const rr of q("SELECT * FROM eng_review_runs WHERE state = 'running' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', rr.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    let parsed = null;
    try { parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null; } catch { parsed = null; }
    if (!parsed) {
      exec("UPDATE eng_review_runs SET state = 'failed', summary = ? WHERE id = ?", run.failure_reason || `the reviewer returned nothing usable (${run.state})`, rr.id);
      continue;
    }
    const list = Array.isArray(parsed.findings) ? parsed.findings.slice(0, 60) : [];
    for (const f of list) {
      if (!f || typeof f !== 'object') continue;
      insertFinding(rr.review_id, { ...f, dimension: rr.dimension, title: f.title || f.claim, detail: f.detail || f.evidence }, { source: 'agent', agentId: rr.agent_id });
    }
    // Held at the human gate means the employee was not sure of itself; the
    // findings are still worth reading, and the label says how much to trust them.
    const held = run.state === 'awaiting_human';
    exec('UPDATE eng_review_runs SET state = ?, summary = ?, verdict = ? WHERE id = ?',
      held ? 'held' : 'done', `${held ? '[held for a person: low confidence] ' : ''}${String(parsed.summary || '').slice(0, 2000)}`,
      String(parsed.verdict || '').slice(0, 20) || null, rr.id);
  }

  for (const r of q("SELECT * FROM eng_reviews WHERE state = 'running'")) {
    if (r.command_id) {
      const c = one('SELECT state, exit_code, output FROM forge_commands WHERE id = ?', r.command_id);
      if (c?.state === 'running') continue;
      if (c && !one("SELECT id FROM eng_findings WHERE review_id = ? AND source = 'tests'", r.id)) {
        if (c.state !== 'ok') {
          insertFinding(r.id, {
            dimension: 'tests', severity: 'high', rule: 'tests.failing', title: `The test suite fails (exit ${c.exit_code ?? '?'})`,
            evidence: String(c.output || '').split('\n').filter((l) => /fail|error|not ok|assert/i.test(l)).slice(0, 8).join('\n').slice(0, 600) || null,
            fix: 'Open the terminal output, fix the failing tests, and review again.',
          }, { source: 'tests' });
        } else {
          insertFinding(r.id, { dimension: 'tests', severity: 'info', rule: 'tests.passing', title: 'The test suite passes', fix: null }, { source: 'tests' });
        }
      }
    }
    if (one("SELECT COUNT(*) AS n FROM eng_review_runs WHERE review_id = ? AND state = 'running'", r.id).n) continue;
    finish(r.id);
  }

  // A fix applied is a finding closed. Rejected or failed fixes reopen it.
  for (const f of q("SELECT f.id, c.state FROM eng_findings f JOIN forge_changes c ON c.id = f.change_id WHERE f.state = 'fixing'")) {
    if (f.state === 'applied') exec("UPDATE eng_findings SET state = 'fixed', decided_at = datetime('now') WHERE id = ?", f.id);
    else if (['rejected', 'failed'].includes(f.state)) exec("UPDATE eng_findings SET state = 'open' WHERE id = ?", f.id);
  }
}

function finish(id) {
  const r = one('SELECT * FROM eng_reviews WHERE id = ?', id);
  const findings = q('SELECT severity, dimension, state FROM eng_findings WHERE review_id = ?', id);
  const s = score(findings);
  const runs = q('SELECT dimension, summary, state FROM eng_review_runs WHERE review_id = ?', id);
  const summary = [
    `${findings.length} finding(s): ${SEVERITIES.filter((k) => s.bySeverity[k]).map((k) => `${s.bySeverity[k]} ${k}`).join(', ') || 'none'}.`,
    ...runs.map((x) => `${x.dimension}: ${x.state === 'failed' ? `reviewer did not finish — ${x.summary}` : (x.summary || 'no comment')}`.slice(0, 400)),
  ].join('\n');
  exec("UPDATE eng_reviews SET state = 'done', score = ?, verdict = ?, summary = ?, finished_at = datetime('now') WHERE id = ?", s.score, s.verdict, summary, id);
  audit({ actorType: 'system', actorId: 'system:review-board', action: 'eng.review_done', subjectType: 'engReview', subjectId: id, payload: { score: s.score, verdict: s.verdict, bySeverity: s.bySeverity } });
  notify({
    level: s.verdict === 'fail' ? 'warn' : 'info', source: 'reviews',
    message: `Review of ${r.title}: ${s.verdict.toUpperCase()} · ${s.score}/100${s.bySeverity.critical ? ` · ${s.bySeverity.critical} critical` : ''}`,
    subjectType: 'engReview', subjectId: id,
  });
}

/** Recompute after a person dismisses or a fix lands, so the score is never stale. */
function rescore(reviewId) {
  const r = one('SELECT state FROM eng_reviews WHERE id = ?', reviewId);
  if (r?.state !== 'done') return;
  const s = score(q('SELECT severity, dimension, state FROM eng_findings WHERE review_id = ?', reviewId));
  exec('UPDATE eng_reviews SET score = ?, verdict = ? WHERE id = ?', s.score, s.verdict, reviewId);
}

// gh_repos belongs to the GitHub hub, which may not have created it yet.
const linkedRepo = (projectId) => { try { return one('SELECT full_name FROM gh_repos WHERE project_id = ?', projectId)?.full_name || null; } catch { return null; } };

export function getReview(id) {
  const r = one('SELECT * FROM eng_reviews WHERE id = ?', Number(id));
  if (!r) refuse('no such review', 404);
  const findings = q(`SELECT * FROM eng_findings WHERE review_id = ? ORDER BY
      CASE state WHEN 'open' THEN 0 WHEN 'fixing' THEN 1 ELSE 2 END,
      CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, id`, r.id);
  return {
    ...r,
    dimensions: parse(r.dimensions, []),
    bom: parse(r.bom, []),
    counts: parse(r.counts, {}),
    project: r.project_id ? one('SELECT id, slug, name FROM forge_projects WHERE id = ?', r.project_id) : null,
    // Where an issue for a finding would be opened, if anywhere.
    issueRepo: r.repo || (r.project_id ? linkedRepo(r.project_id) : null),
    reviewers: q('SELECT dimension, agent_id, state, summary, verdict, run_id FROM eng_review_runs WHERE review_id = ?', r.id),
    findings,
    stats: score(findings),
  };
}

export function listReviews({ projectId = null, limit = 60 } = {}) {
  const rows = projectId
    ? q('SELECT * FROM eng_reviews WHERE project_id = ? ORDER BY id DESC LIMIT ?', Number(projectId), limit)
    : q('SELECT * FROM eng_reviews ORDER BY id DESC LIMIT ?', limit);
  return rows.map((r) => ({
    ...r, dimensions: parse(r.dimensions, []), bom: undefined, counts: parse(r.counts, {}),
    open: one("SELECT COUNT(*) AS n FROM eng_findings WHERE review_id = ? AND state = 'open'", r.id).n,
    critical: one("SELECT COUNT(*) AS n FROM eng_findings WHERE review_id = ? AND state = 'open' AND severity = 'critical'", r.id).n,
    project: r.project_id ? one('SELECT slug, name FROM forge_projects WHERE id = ?', r.project_id) : null,
  }));
}

export function reviewsOverview() {
  const n = (sql, ...a) => one(sql, ...a).n;
  return {
    reviews: n('SELECT COUNT(*) AS n FROM eng_reviews'),
    running: n("SELECT COUNT(*) AS n FROM eng_reviews WHERE state = 'running'"),
    open: n("SELECT COUNT(*) AS n FROM eng_findings WHERE state = 'open'"),
    critical: n("SELECT COUNT(*) AS n FROM eng_findings WHERE state = 'open' AND severity = 'critical'"),
    high: n("SELECT COUNT(*) AS n FROM eng_findings WHERE state = 'open' AND severity = 'high'"),
    fixed: n("SELECT COUNT(*) AS n FROM eng_findings WHERE state = 'fixed'"),
    dismissed: n("SELECT COUNT(*) AS n FROM eng_findings WHERE state = 'dismissed'"),
    byDimension: Object.fromEntries(DIMENSIONS.map((d) => [d, n("SELECT COUNT(*) AS n FROM eng_findings WHERE state = 'open' AND dimension = ?", d)])),
    dimensions: DIMENSIONS,
    reviewers: Object.entries(REVIEWERS).map(([d, r]) => ({ dimension: d, agent: r.agent, label: r.label })),
    gateMode: gateMode(),
  };
}

// ---------------------------------------------------------------- findings --

/** A person says a finding is not a problem, and why. The why is kept. */
export function dismissFinding(id, { note = '', actor }) {
  if (!isHuman(actor)) refuse('only a person can dismiss a finding');
  const f = one('SELECT * FROM eng_findings WHERE id = ?', Number(id));
  if (!f) refuse('no such finding', 404);
  if (f.state !== 'open') refuse(`this finding is ${f.state}`);
  if (['critical', 'high'].includes(f.severity) && String(note).trim().length < 8) refuse('dismissing a critical or high finding needs a reason of a few words');
  exec("UPDATE eng_findings SET state = 'dismissed', decided_by = ?, decided_at = datetime('now'), detail = COALESCE(detail, '') || ? WHERE id = ?",
    actor, note ? `\n\nDismissed: ${String(note).slice(0, 500)}` : '', f.id);
  audit({ actorType: 'human', actorId: actor, action: 'eng.finding_dismissed', subjectType: 'engReview', subjectId: f.review_id, payload: { finding: f.id, severity: f.severity, rule: f.rule } });
  rescore(f.review_id);
  return { ok: true };
}

export function reopenFinding(id, { actor }) {
  const f = one('SELECT * FROM eng_findings WHERE id = ?', Number(id));
  if (!f) refuse('no such finding', 404);
  exec("UPDATE eng_findings SET state = 'open', decided_by = NULL, decided_at = NULL WHERE id = ?", f.id);
  audit({ actorType: 'human', actorId: actor, action: 'eng.finding_reopened', subjectType: 'engReview', subjectId: f.review_id, payload: { finding: f.id } });
  rescore(f.review_id);
  return { ok: true };
}

const describe = (f) => `- [${f.severity}] ${f.title}${f.file ? ` — ${f.file}${f.line ? `:${f.line}` : ''}` : ''}${f.detail ? `\n  Why: ${String(f.detail).slice(0, 600)}` : ''}${f.evidence ? `\n  Evidence: ${String(f.evidence).slice(0, 200)}` : ''}${f.fix ? `\n  Suggested fix: ${f.fix}` : ''}`;

/**
 * Hand findings to an engineer. One change set for all of them, because five
 * change sets touching the same file conflict with each other by the third.
 * Missing tests go to the test engineer; everything else to the project's own.
 */
export function fixFindings({ reviewId, ids = null, severities = null, actor }) {
  const r = one('SELECT * FROM eng_reviews WHERE id = ?', Number(reviewId));
  if (!r) refuse('no such review', 404);
  if (!r.project_id) refuse('this review is of a pull request — fix it on its branch, or import the repository into the factory first');
  let list = q("SELECT * FROM eng_findings WHERE review_id = ? AND state = 'open'", r.id);
  if (Array.isArray(ids) && ids.length) list = list.filter((f) => ids.map(Number).includes(f.id));
  if (Array.isArray(severities) && severities.length) list = list.filter((f) => severities.includes(f.severity));
  list = list.filter((f) => f.severity !== 'info');
  if (!list.length) refuse('there is nothing open to fix');
  const onlyTests = list.every((f) => f.dimension === 'tests');
  const prompt = `${onlyTests ? 'Write the missing tests' : 'Fix these review findings'} — and nothing else. Keep every unrelated line as it is.

${list.map(describe).join('\n')}

If a finding is a false positive, leave the code alone and say so in knownGaps. Add or update a test that would have caught each real defect.`;
  const ch = requestChange({ projectId: r.project_id, prompt, agentId: onlyTests ? 'AGT-TST-001' : null, actor });
  for (const f of list) exec("UPDATE eng_findings SET state = 'fixing', change_id = ? WHERE id = ?", ch.id, f.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'eng.fix_requested', subjectType: 'engReview', subjectId: r.id, payload: { findings: list.map((f) => f.id), changeId: ch.id, agent: ch.agent } });
  return { changeId: ch.id, agent: ch.agent, findings: list.length, project: one('SELECT slug FROM forge_projects WHERE id = ?', r.project_id).slug };
}

/** The review as a comment a person could post on a pull request. */
export function reviewMarkdown(id) {
  const r = getReview(id);
  const open = r.findings.filter((f) => f.state === 'open');
  const icon = { critical: '🛑', high: '🔴', medium: '🟠', low: '🟡', info: '⚪' };
  const lines = [
    `## AlphaCore review — ${r.verdict ? r.verdict.toUpperCase() : 'IN PROGRESS'} · ${r.score ?? '—'}/100`,
    '',
    `Dimensions: ${r.dimensions.join(', ')}. ${open.length} open finding(s).`,
    '',
    ...open.slice(0, 50).map((f) => `- ${icon[f.severity] || ''} **${f.severity}** · ${f.dimension} · ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\` — ` : ''}${f.title}${f.fix ? `\n  - Fix: ${f.fix}` : ''}`),
    open.length > 50 ? `\n…and ${open.length - 50} more.` : '',
    '',
    '_Found by a deterministic scanner and AI reviewers on a different model family from the author. Posted by a person._',
  ];
  return lines.join('\n');
}

export function markPosted(id, { url = null, actor }) {
  exec("UPDATE eng_reviews SET posted_by = ?, posted_at = datetime('now'), posted_url = ? WHERE id = ?", actor, url, Number(id));
}

export function markIssue(findingId, url) {
  exec('UPDATE eng_findings SET issue_url = ? WHERE id = ?', url, Number(findingId));
}

// ------------------------------------------------------------ quality gate --

/** off: never consulted · warn: recorded on the release · enforce: production waits for a clean review. */
export const gateMode = () => (['off', 'warn', 'enforce'].includes(getSetting('ENG_QUALITY_GATE')) ? getSetting('ENG_QUALITY_GATE') : 'warn');

/**
 * Is this project fit to ship? Read from the newest finished review, because
 * an old clean review says nothing about the code that is there now.
 */
export function qualityGate(projectId) {
  const mode = gateMode();
  const r = one("SELECT * FROM eng_reviews WHERE project_id = ? AND subject = 'project' AND state = 'done' ORDER BY id DESC LIMIT 1", Number(projectId));
  if (!r) return { mode, state: 'none', ok: mode !== 'enforce', why: 'this project has never been reviewed' };
  const critical = one("SELECT COUNT(*) AS n FROM eng_findings WHERE review_id = ? AND state = 'open' AND severity = 'critical'", r.id).n;
  const high = one("SELECT COUNT(*) AS n FROM eng_findings WHERE review_id = ? AND state = 'open' AND severity = 'high'", r.id).n;
  const failing = one("SELECT COUNT(*) AS n FROM eng_findings WHERE review_id = ? AND state = 'open' AND rule = 'tests.failing'", r.id).n;
  const blocked = critical > 0 || failing > 0;
  return {
    mode, reviewId: r.id, score: r.score, verdict: r.verdict, reviewedAt: r.finished_at, critical, high, failingTests: failing > 0,
    state: blocked ? 'fail' : high ? 'warn' : 'pass',
    ok: mode !== 'enforce' || !blocked,
    why: blocked ? `review #${r.id} has ${critical} open critical finding(s)${failing ? ' and failing tests' : ''}` : `review #${r.id} scored ${r.score}/100`,
  };
}
