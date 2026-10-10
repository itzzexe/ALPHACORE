// The review board, reading this repository's own pull requests.
//
// The same scanner the platform runs on its customers' code, run on the diff
// between a branch and its base: only the lines a change adds are read, at the
// line numbers they will have. Free, deterministic, and needs no key — the AI
// reviewers in the workflow beside it are the part that needs judgement.
//
// Run: node scripts/review-diff.mjs [--base=origin/main] [--fail-on=critical]
// Writes a Markdown summary to $GITHUB_STEP_SUMMARY when there is one.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { scanPatches, score, SEVERITIES } from '../src/engineering/scan.js';

const arg = (name, d) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || d;
const base = arg('base', process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
const failOn = arg('fail-on', 'critical');

const r = spawnSync('git', ['diff', '--no-color', '-U0', `${base}...HEAD`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) {
  console.error(`git diff against ${base} failed: ${r.stderr}`);
  process.exit(2);
}

// One entry per file, in the shape GitHub's pull-request files API returns.
const files = [];
let cur = null;
for (const line of r.stdout.split('\n')) {
  if (line.startsWith('diff --git ')) { cur = { filename: null, status: 'modified', patch: '' }; files.push(cur); continue; }
  if (!cur) continue;
  if (line.startsWith('new file mode')) cur.status = 'added';
  else if (line.startsWith('deleted file mode')) cur.status = 'removed';
  else if (line.startsWith('+++ ')) cur.filename = line.slice(4).replace(/^b\//, '');
  else if (line.startsWith('--- ')) { /* the old side */ }
  else if (/^[@+ -]/.test(line)) cur.patch += `${line}\n`;
}
const real = files.filter((f) => f.filename && f.filename !== '/dev/null');
const findings = scanPatches(real);
const s = score(findings);

const rows = findings.map((f) => `| ${f.severity} | ${f.dimension} | \`${f.file}${f.line ? `:${f.line}` : ''}\` | ${f.title} | ${f.fix || ''} |`);
const md = [
  `## Review board — ${s.verdict.toUpperCase()} · ${s.score}/100`,
  '',
  `${real.length} file(s) changed against \`${base}\`. ${findings.length} finding(s): ${SEVERITIES.filter((k) => s.bySeverity[k]).map((k) => `${s.bySeverity[k]} ${k}`).join(', ') || 'none'}.`,
  '',
  ...(rows.length ? ['| Severity | Dimension | Where | What | Fix |', '|---|---|---|---|---|', ...rows.slice(0, 200)] : ['Nothing found in the lines this change adds.']),
].join('\n');

console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);

const rank = (sev) => SEVERITIES.indexOf(sev);
const blocking = findings.filter((f) => rank(f.severity) <= rank(failOn));
if (blocking.length) {
  console.error(`\n${blocking.length} finding(s) at or above ${failOn}: the change is held.`);
  process.exit(1);
}
