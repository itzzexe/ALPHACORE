// The app builder — from a paragraph to a running application, in steps a
// person can check.
//
// A model asked for "an app that does X" in one go returns something that
// looks finished and is not: forty files, half of them guessed, none of them
// run. So the builder does what a good lead engineer does instead. A product
// manager writes the specification and a person reads it. An architect picks
// the smallest stack and cuts the work into milestones and a person reads
// that. Then each milestone is one change set in the factory — applied by a
// person, or by the project's autopilot if somebody allowed it — and the next
// one starts only when the last one landed. Tests are written by a test
// engineer who did not write the code, and the review board reads the result
// before anybody is told it is ready.
//
// Every stage is a row and a line on the chain, so "how did this app come to
// be" has an answer that is not a chat log.
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { notify } from '../notify.js';
import { enqueueRun } from '../workflow.js';
import { openPii } from '../erasure.js';
import { KINDS, createProject, requestChange, applyChange, rejectChange, projectRow } from '../forge.js';
import { startReview, qualityGate } from './reviews.js';

exec(`CREATE TABLE IF NOT EXISTS app_builds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  idea        TEXT NOT NULL,
  audience    TEXT,
  language    TEXT NOT NULL DEFAULT 'en',      -- en|ar|both: the interface language the app must speak
  state       TEXT NOT NULL DEFAULT 'spec',    -- spec|spec_review|arch|arch_review|building|milestone_review|testing|reviewing|ready|failed|cancelled
  spec        TEXT,                            -- JSON from the product manager
  arch        TEXT,                            -- JSON from the architect
  milestones  TEXT,                            -- JSON [{title, goal, acceptance, state, changeId}]
  current     INTEGER NOT NULL DEFAULT 0,
  run_id      TEXT,                            -- the spec or architecture run in flight
  project_id  INTEGER REFERENCES forge_projects(id),
  test_change INTEGER,
  review_id   INTEGER,
  log         TEXT NOT NULL DEFAULT '[]',      -- JSON [{at, stage, text}]
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const BUILDABLE = ['node-api', 'fullstack', 'static-site', 'python-api'];
export const STAGES = ['spec', 'spec_review', 'arch', 'arch_review', 'building', 'milestone_review', 'testing', 'reviewing', 'ready'];

const row = (id) => { const b = one('SELECT * FROM app_builds WHERE id = ?', Number(id)); if (!b) refuse('no such build', 404); return b; };

function note(id, stage, text) {
  const b = row(id);
  const log = parse(b.log, []);
  log.push({ at: new Date().toISOString(), stage, text: String(text).slice(0, 600) });
  exec("UPDATE app_builds SET log = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(log.slice(-80)), id);
}

function setState(id, state, extra = {}) {
  const sets = ["state = ?", "updated_at = datetime('now')"];
  const vals = [state];
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); vals.push(v); }
  exec(`UPDATE app_builds SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
  audit({ actorType: 'system', actorId: 'system:app-builder', action: `appbuild.${state}`, subjectType: 'appBuild', subjectId: id, payload: { state } });
}

const langLine = (l) => (l === 'ar' ? 'The interface is in Arabic, right-to-left, with dir="rtl" and no letter-spacing on Arabic text.'
  : l === 'both' ? 'The interface is bilingual: English and Arabic with a switch, and the Arabic view is right-to-left.' : 'The interface is in English.');

// ------------------------------------------------------------------ stages --

function askForSpec(id, feedback = null) {
  const b = row(id);
  const prev = parse(b.spec, null);
  const runId = enqueueRun({
    agentId: 'AGT-PM-001',
    taskType: `appbuild:${id}:spec`,
    actor: b.created_by,
    input: {
      prompt: `[APP-SPEC] Write the specification for a new application.

Name: ${b.name}
The idea, in the owner's words: ${b.idea}
${b.audience ? `Who it is for: ${b.audience}\n` : ''}${langLine(b.language)}
${prev && feedback ? `\nYour previous draft:\n${JSON.stringify(prev).slice(0, 8000)}\n\nThe owner's feedback on it — address every point:\n${feedback}\n` : ''}
Keep it to a first version somebody would actually use: the smallest set of features that delivers the idea, each with user stories and Given/When/Then acceptance criteria. Say plainly what is out of scope.

Output JSON: {"summary":"","users":[""],"features":[{"name":"","stories":[""],"acceptance":[""]}],"screens":[""],"dataModel":[{"entity":"","fields":[""]}],"outOfScope":[""],"risks":[""],"confidence":0.0}`,
    },
  });
  setState(id, 'spec', { run_id: runId });
  note(id, 'spec', feedback ? 'The product manager is revising the specification.' : 'The product manager is writing the specification.');
}

function askForArch(id, feedback = null) {
  const b = row(id);
  const prev = parse(b.arch, null);
  const runId = enqueueRun({
    agentId: 'AGT-ARC-001',
    taskType: `appbuild:${id}:arch`,
    actor: b.created_by,
    input: {
      prompt: `[APP-ARCH] Design the smallest architecture that delivers this approved specification, and cut the build into milestones.

Name: ${b.name}
Specification (approved by a person):
${JSON.stringify(parse(b.spec, {})).slice(0, 12000)}
${langLine(b.language)}
${prev && feedback ? `\nYour previous design:\n${JSON.stringify(prev).slice(0, 6000)}\n\nThe owner's feedback — address every point:\n${feedback}\n` : ''}
Choose "kind" from exactly: ${BUILDABLE.join(', ')}. Prefer the standard library; every dependency you add must earn its place.
Cut the work into 2 to 6 milestones. Each milestone must leave the app runnable and be small enough for one engineer to write in one change set; the first one is the skeleton that starts and answers.

Output JSON: {"summary":"","kind":"","stack":"","structure":[{"path":"","purpose":""}],"milestones":[{"title":"","goal":"","acceptance":[""]}],"nfr":[""],"risks":[""],"confidence":0.0}`,
    },
  });
  setState(id, 'arch', { run_id: runId });
  note(id, 'arch', feedback ? 'The architect is revising the design.' : 'The architect is designing the application and cutting it into milestones.');
}

function startMilestone(id) {
  const b = row(id);
  const ms = parse(b.milestones, []);
  const m = ms[b.current];
  if (!m) return startTests(id);
  const spec = parse(b.spec, {});
  const arch = parse(b.arch, {});
  const ch = requestChange({
    projectId: b.project_id,
    actor: b.created_by,
    prompt: `Milestone ${b.current + 1} of ${ms.length}: ${m.title}
Goal: ${m.goal}
Acceptance:
${(m.acceptance || []).map((a) => `- ${a}`).join('\n') || '- it runs and does what the goal says'}

This app: ${b.name} — ${spec.summary || b.idea}
${langLine(b.language)}
Architecture: ${arch.stack || ''} ${arch.summary || ''}
Planned structure:
${(arch.structure || []).map((s) => `- ${s.path}: ${s.purpose}`).join('\n').slice(0, 3000)}
${b.current > 0 ? `\nEarlier milestones are already in the repository: ${ms.slice(0, b.current).map((x) => x.title).join('; ')}. Build on them; do not rewrite what works.` : ''}

Write only this milestone. Leave the app runnable, add tests for what you build, and list in knownGaps anything the acceptance asks for that you did not do.`,
  });
  ms[b.current] = { ...m, state: 'drafting', changeId: ch.id };
  setState(id, 'building', { milestones: JSON.stringify(ms) });
  note(id, 'building', `Milestone ${b.current + 1}/${ms.length} — "${m.title}" — is being written by ${ch.agent}.`);
}

function startTests(id) {
  const b = row(id);
  const spec = parse(b.spec, {});
  const ch = requestChange({
    projectId: b.project_id,
    agentId: 'AGT-TST-001',
    actor: b.created_by,
    prompt: `Write the test suite this application is missing. You did not write the code; read it as somebody who expects it to be wrong.
Cover every acceptance criterion below that can be checked automatically, then the error paths.

${(spec.features || []).map((f) => `${f.name}:\n${(f.acceptance || []).map((a) => `- ${a}`).join('\n')}`).join('\n\n').slice(0, 8000) || b.idea}

Use the runner the project already has. Make sure "npm test" (or python -m unittest) runs them.`,
  });
  setState(id, 'testing', { test_change: ch.id });
  note(id, 'testing', 'The test engineer is writing the test suite.');
}

function startBoardReview(id) {
  const b = row(id);
  const r = startReview({ projectId: b.project_id, runTests: true, actor: b.created_by, title: `${b.name} — before release` });
  setState(id, 'reviewing', { review_id: r.id });
  note(id, 'reviewing', `The review board is reading it (review #${r.id}): security, tests, quality, performance, accessibility, dependencies.`);
}

// --------------------------------------------------------------- the tick --

function runResult(runId) {
  const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', runId);
  if (!run || ['queued', 'leased', 'running'].includes(run.state)) return null;
  let parsed = null;
  try { parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null; } catch { parsed = null; }
  return { state: run.state, parsed, why: run.failure_reason };
}

/** Server tick: move every build along as far as the work allows, and no further. */
export function syncBuilds() {
  for (const b of q("SELECT * FROM app_builds WHERE state IN ('spec','arch','building','milestone_review','testing','reviewing')")) {
    try { step(b); } catch (e) { note(b.id, b.state, `Stopped: ${e.message}`); setState(b.id, 'failed'); }
  }
}

function step(b) {
  if (b.state === 'spec' || b.state === 'arch') {
    const r = b.run_id ? runResult(b.run_id) : null;
    if (!r) return;
    const ok = r.parsed && (b.state === 'spec' ? Array.isArray(r.parsed.features) : Array.isArray(r.parsed.milestones));
    if (!ok) {
      note(b.id, b.state, `The ${b.state === 'spec' ? 'product manager' : 'architect'} returned nothing usable: ${r.why || r.state}. Ask for a revision or cancel.`);
      setState(b.id, `${b.state}_review`, { run_id: null });
      return;
    }
    if (b.state === 'arch' && !BUILDABLE.includes(r.parsed.kind)) r.parsed.kind = 'node-api';
    const held = r.state === 'awaiting_human' ? ' (the employee was not confident — read it closely)' : '';
    setState(b.id, `${b.state}_review`, { [b.state]: JSON.stringify(r.parsed), run_id: null });
    note(b.id, `${b.state}_review`, `${b.state === 'spec' ? 'The specification is' : 'The architecture and milestones are'} ready for you to read${held}.`);
    notify({ level: 'info', source: 'appbuilder', message: `${b.name}: the ${b.state === 'spec' ? 'specification' : 'architecture'} is waiting for your approval.`, subjectType: 'appBuild', subjectId: b.id });
    return;
  }
  if (b.state === 'building' || b.state === 'milestone_review') {
    const ms = parse(b.milestones, []);
    const m = ms[b.current];
    if (!m?.changeId) return;
    const c = one('SELECT state FROM forge_changes WHERE id = ?', m.changeId);
    if (!c) return;
    if (c.state === 'proposed' && b.state === 'building') {
      ms[b.current] = { ...m, state: 'proposed' };
      setState(b.id, 'milestone_review', { milestones: JSON.stringify(ms) });
      note(b.id, 'milestone_review', `Milestone ${b.current + 1} is written. Read the change and apply it — the next milestone starts when it lands.`);
      notify({ level: 'info', source: 'appbuilder', message: `${b.name}: milestone ${b.current + 1} is ready to review and apply.`, subjectType: 'appBuild', subjectId: b.id });
    } else if (c.state === 'applied') {
      ms[b.current] = { ...m, state: 'applied' };
      exec('UPDATE app_builds SET milestones = ?, current = current + 1 WHERE id = ?', JSON.stringify(ms), b.id);
      note(b.id, 'building', `Milestone ${b.current + 1} landed.`);
      startMilestone(b.id);
    } else if (['rejected', 'failed'].includes(c.state) && m.state !== c.state) {
      ms[b.current] = { ...m, state: c.state };
      setState(b.id, 'milestone_review', { milestones: JSON.stringify(ms) });
      note(b.id, 'milestone_review', `Milestone ${b.current + 1} was ${c.state}. Retry it with guidance, or skip it.`);
    }
    return;
  }
  if (b.state === 'testing') {
    const c = b.test_change ? one('SELECT state FROM forge_changes WHERE id = ?', b.test_change) : null;
    if (!c) return;
    if (c.state === 'applied') startBoardReview(b.id);
    else if (['rejected', 'failed'].includes(c.state)) { note(b.id, 'testing', `The tests were ${c.state}; going to review without them.`); startBoardReview(b.id); }
    return;
  }
  if (b.state === 'reviewing') {
    const r = b.review_id ? one('SELECT state, verdict, score FROM eng_reviews WHERE id = ?', b.review_id) : null;
    if (r?.state !== 'done') return;
    setState(b.id, 'ready');
    note(b.id, 'ready', `Reviewed: ${String(r.verdict).toUpperCase()} · ${r.score}/100. Preview it, fix what the board found, and deploy.`);
    notify({ level: r.verdict === 'fail' ? 'warn' : 'info', source: 'appbuilder', message: `${b.name} is built — review ${String(r.verdict).toUpperCase()} ${r.score}/100.`, subjectType: 'appBuild', subjectId: b.id });
  }
}

// ----------------------------------------------------------------- actions --

export function createBuild({ name, idea, audience = null, language = 'en', actor }) {
  if (!String(name || '').trim()) refuse('the app needs a name');
  if (String(idea || '').trim().length < 20) refuse('describe the idea in at least a sentence — what it does and for whom');
  if (!['en', 'ar', 'both'].includes(language)) refuse('language is en, ar or both');
  exec('INSERT INTO app_builds (name, idea, audience, language, created_by) VALUES (?,?,?,?,?)',
    String(name).trim().slice(0, 80), String(idea).trim().slice(0, 4000), audience ? String(audience).slice(0, 500) : null, language, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'appbuild.created', subjectType: 'appBuild', subjectId: id, payload: { name, language } });
  askForSpec(id);
  return getBuild(id);
}

/** A person accepts the stage in front of them. Nothing moves past a gate without this. */
export function approve(id, { actor }) {
  if (!isHuman(actor)) refuse('only a person approves a stage');
  const b = row(id);
  if (b.state === 'spec_review') {
    if (!parse(b.spec, null)) refuse('there is no specification to approve — ask for a revision');
    audit({ actorType: 'human', actorId: actor, action: 'appbuild.spec_approved', subjectType: 'appBuild', subjectId: b.id });
    note(b.id, 'spec_review', `${actor.replace(/^human:/, '')} approved the specification.`);
    askForArch(b.id);
  } else if (b.state === 'arch_review') {
    const arch = parse(b.arch, null);
    if (!arch?.milestones?.length) refuse('there is no design to approve — ask for a revision');
    const kind = BUILDABLE.includes(arch.kind) ? arch.kind : 'node-api';
    const p = b.project_id ? projectRow(b.project_id) : createProject({ name: b.name, kind, description: parse(b.spec, {}).summary || b.idea.slice(0, 300), actor });
    const ms = arch.milestones.slice(0, 8).map((m) => ({ title: String(m.title || 'Milestone').slice(0, 120), goal: String(m.goal || '').slice(0, 1200), acceptance: (m.acceptance || []).slice(0, 12).map(String), state: 'pending', changeId: null }));
    exec('UPDATE app_builds SET project_id = ?, milestones = ?, current = 0 WHERE id = ?', p.id, JSON.stringify(ms), b.id);
    audit({ actorType: 'human', actorId: actor, action: 'appbuild.arch_approved', subjectType: 'appBuild', subjectId: b.id, payload: { kind, milestones: ms.length, project: p.slug } });
    note(b.id, 'arch_review', `${actor.replace(/^human:/, '')} approved the design. Project "${p.slug}" created (${KINDS[kind]?.label || kind}).`);
    startMilestone(b.id);
  } else refuse(`there is nothing to approve while the build is ${b.state.replace(/_/g, ' ')}`);
  return getBuild(b.id);
}

/** Send a stage back with words. The words go to the employee verbatim. */
export function revise(id, { feedback, actor }) {
  if (!isHuman(actor)) refuse('only a person sends work back');
  const b = row(id);
  const fb = String(feedback || '').trim();
  if (fb.length < 4) refuse('say what should change');
  if (b.state === 'spec_review') askForSpec(b.id, fb);
  else if (b.state === 'arch_review') askForArch(b.id, fb);
  else if (b.state === 'milestone_review') {
    const ms = parse(b.milestones, []);
    const m = ms[b.current];
    const c = m?.changeId ? one('SELECT state FROM forge_changes WHERE id = ?', m.changeId) : null;
    if (c?.state === 'proposed') rejectChange(m.changeId, { note: fb, actor });
    ms[b.current] = { ...m, goal: `${m.goal}\n\nThe owner's guidance after the last attempt: ${fb}`, state: 'pending', changeId: null };
    exec('UPDATE app_builds SET milestones = ? WHERE id = ?', JSON.stringify(ms), b.id);
    startMilestone(b.id);
  } else refuse(`the build is ${b.state.replace(/_/g, ' ')}, there is nothing to revise`);
  audit({ actorType: 'human', actorId: actor, action: 'appbuild.revised', subjectType: 'appBuild', subjectId: b.id, payload: { stage: b.state } });
  return getBuild(b.id);
}

/** Apply the milestone in front of a person, from the builder rather than the factory. */
export function applyMilestone(id, { actor }) {
  const b = row(id);
  const m = parse(b.milestones, [])[b.current];
  if (b.state !== 'milestone_review' || !m?.changeId) refuse('there is no milestone waiting to be applied');
  applyChange(m.changeId, { actor });
  step(row(b.id));
  return getBuild(b.id);
}

export function skipMilestone(id, { actor }) {
  if (!isHuman(actor)) refuse('only a person skips a milestone');
  const b = row(id);
  if (b.state !== 'milestone_review') refuse('only a milestone that is waiting can be skipped');
  const ms = parse(b.milestones, []);
  const m = ms[b.current];
  if (m?.changeId && one('SELECT state FROM forge_changes WHERE id = ?', m.changeId)?.state === 'proposed') rejectChange(m.changeId, { note: 'skipped from the app builder', actor });
  ms[b.current] = { ...m, state: 'skipped' };
  exec('UPDATE app_builds SET milestones = ?, current = current + 1 WHERE id = ?', JSON.stringify(ms), b.id);
  note(b.id, 'milestone_review', `${actor.replace(/^human:/, '')} skipped milestone ${b.current + 1}.`);
  audit({ actorType: 'human', actorId: actor, action: 'appbuild.milestone_skipped', subjectType: 'appBuild', subjectId: b.id, payload: { milestone: b.current + 1 } });
  startMilestone(b.id);
  return getBuild(b.id);
}

export function cancelBuild(id, { actor }) {
  const b = row(id);
  if (['ready', 'cancelled'].includes(b.state)) refuse(`the build is already ${b.state}`);
  setState(b.id, 'cancelled');
  note(b.id, 'cancelled', `${String(actor).replace(/^human:/, '')} cancelled the build. The project, if one was created, stays in the factory.`);
  return getBuild(b.id);
}

export function getBuild(id) {
  const b = row(id);
  const ms = parse(b.milestones, []);
  return {
    ...b,
    spec: parse(b.spec, null),
    arch: parse(b.arch, null),
    milestones: ms.map((m) => ({ ...m, change: m.changeId ? one('SELECT id, state, summary, agent_id FROM forge_changes WHERE id = ?', m.changeId) : null })),
    log: parse(b.log, []),
    project: b.project_id ? one('SELECT id, slug, name, kind FROM forge_projects WHERE id = ?', b.project_id) : null,
    review: b.review_id ? one('SELECT id, state, verdict, score FROM eng_reviews WHERE id = ?', b.review_id) : null,
    gate: b.project_id && b.state === 'ready' ? qualityGate(b.project_id) : null,
    stageIndex: Math.max(0, STAGES.indexOf(b.state)),
  };
}

export function listBuilds() {
  return q('SELECT id, name, idea, state, language, project_id, current, milestones, review_id, created_by, created_at, updated_at FROM app_builds ORDER BY id DESC LIMIT 60')
    .map((b) => {
      const ms = parse(b.milestones, []);
      return { ...b, milestones: undefined, total: ms.length, done: ms.filter((m) => ['applied', 'skipped'].includes(m.state)).length, project: b.project_id ? one('SELECT slug FROM forge_projects WHERE id = ?', b.project_id)?.slug : null };
    });
}

export function buildsOverview() {
  const n = (sql) => one(sql).n;
  return {
    builds: n('SELECT COUNT(*) AS n FROM app_builds'),
    waiting: n("SELECT COUNT(*) AS n FROM app_builds WHERE state IN ('spec_review','arch_review','milestone_review')"),
    working: n("SELECT COUNT(*) AS n FROM app_builds WHERE state IN ('spec','arch','building','testing','reviewing')"),
    ready: n("SELECT COUNT(*) AS n FROM app_builds WHERE state = 'ready'"),
    stages: STAGES,
  };
}
