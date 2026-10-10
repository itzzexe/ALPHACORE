// The GitHub hub — where the factory meets the repositories that already exist.
//
// Everything here goes through the GitHub connector, which means through the
// egress gate: a new connection starts in dry-run, every call is written to the
// chain before it is made, and a merge is never available at all. Cloning,
// pulling and pushing are git commands rather than REST calls, but they leave
// the machine just the same, so they are put through the same gate by name —
// `repo.clone`, `repo.pull`, `repo.push` — rather than quietly shelling out.
//
// Two things only a person does: posting a review on somebody's pull request,
// and opening an issue in their tracker. Both are one click, and both say on
// the record whose click it was.
import crypto from 'node:crypto';
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { notify } from '../notify.js';
import { attempt } from '../egress.js';
import { callConnector, connect, credentialFor, getConnector, setConnectorState } from '../connectors/index.js';
import { getSecret, putSecret, hasSecret } from '../vault.js';
import { getSetting } from '../settings.js';
import { cloneProject, pullProject, pushProject, projectRow } from '../forge.js';
import { startReview, reviewMarkdown, markPosted, markIssue } from './reviews.js';

exec(`CREATE TABLE IF NOT EXISTS gh_repos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL UNIQUE,
  project_id     INTEGER REFERENCES forge_projects(id),
  default_branch TEXT,
  description    TEXT,
  private        INTEGER NOT NULL DEFAULT 0,
  url            TEXT,
  auto_review    INTEGER NOT NULL DEFAULT 0,   -- 1 = every opened or updated pull request is reviewed
  last_synced    TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
)`);
exec(`CREATE TABLE IF NOT EXISTS gh_pulls (
  repo_id    INTEGER NOT NULL REFERENCES gh_repos(id),
  number     INTEGER NOT NULL,
  title      TEXT,
  state      TEXT,
  draft      INTEGER,
  author     TEXT,
  head       TEXT,
  base       TEXT,
  sha        TEXT,
  url        TEXT,
  updated    TEXT,
  review_id  INTEGER,
  PRIMARY KEY (repo_id, number)
)`);
exec(`CREATE TABLE IF NOT EXISTS gh_deliveries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery    TEXT,
  event       TEXT NOT NULL,
  action      TEXT,
  repo        TEXT,
  number      INTEGER,
  outcome     TEXT NOT NULL,                 -- reviewed|recorded|ignored|refused
  detail      TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const repoName = (r) => { const v = String(r || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''); if (!REPO.test(v)) refuse('a repository is owner/name, e.g. octocat/hello-world'); return v; };
const WEBHOOK_SECRET = 'GITHUB_WEBHOOK_SECRET';

/**
 * The connector learns the hub's capabilities on first use. A catalogue row
 * seeded before this module existed lists only the old ones, and the gate —
 * correctly — refuses anything the connector was never granted.
 */
export function ensureHubScopes() {
  const c = one("SELECT scopes FROM connectors WHERE id = 'github'");
  if (!c) return;
  let scopes = [];
  try { scopes = JSON.parse(c.scopes || '[]'); } catch { scopes = []; }
  const want = ['repo.list', 'repo.info', 'repo.branches', 'pr.list', 'pr.files', 'repo.clone', 'repo.pull', 'repo.push'];
  const missing = want.filter((s) => !scopes.includes(s));
  if (missing.length && scopes.length) exec("UPDATE connectors SET scopes = ? WHERE id = 'github'", JSON.stringify([...scopes, ...missing]));
}

/** The token, from wherever it was put: the connector's account, or the vault under its old name. */
const token = () => credentialFor('github') || getSecret('GITHUB_TOKEN') || null;

/** Every call to GitHub — answered, held, or refused — in one shape. */
async function gh(capability, args, { actor, reason }) {
  ensureHubScopes();
  const r = await callConnector({ connector: 'github', capability, args, actor, reason });
  if (r.verdict === 'allowed') return r.result;
  if (r.verdict === 'dry') refuse('GitHub is connected in dry-run: the call was recorded and nothing left this machine. Switch it to live on this page when you trust it.', 409);
  if (r.verdict === 'gated') refuse(`held for a person: ${r.why}`, 409);
  refuse(`the gate refused it: ${r.why}`, 403);
}

/** A git command that leaves the machine, put through the gate by name. */
async function gitOut(capability, target, payload, actor, call) {
  ensureHubScopes();
  const r = await attempt({ connector: 'github', capability, target, payload, actor, reason: `${capability} ${target}`, call });
  if (r.verdict === 'allowed') return r.result;
  if (r.verdict === 'dry') refuse('GitHub is in dry-run: the clone/pull/push was recorded and not performed. Switch the connector to live first.', 409);
  refuse(`the gate refused it: ${r.why}`, r.verdict === 'gated' ? 409 : 403);
}

// ------------------------------------------------------------- connection --

export function hubOverview() {
  const c = getConnector('github');
  const repos = q('SELECT r.*, p.slug AS project_slug, p.name AS project_name FROM gh_repos r LEFT JOIN forge_projects p ON p.id = r.project_id ORDER BY r.id DESC');
  const base = String(getSetting('PUBLIC_BASE_URL') || '').replace(/\/$/, '');
  return {
    connector: c ? { state: c.state, health: c.health || null, lastCall: c.last_call || null, todayCalls: c.todayCalls } : null,
    hasToken: Boolean(token()),
    webhook: {
      url: `${base}/webhooks/github`,
      hasSecret: hasSecret(WEBHOOK_SECRET),
      reachable: Boolean(base) && !/localhost|127\.0\.0\.1/.test(base),
      deliveries: q('SELECT * FROM gh_deliveries ORDER BY id DESC LIMIT 20'),
    },
    repos: repos.map((r) => ({
      ...r,
      pulls: q('SELECT * FROM gh_pulls WHERE repo_id = ? ORDER BY updated DESC LIMIT 30', r.id),
    })),
    stats: {
      repos: repos.length,
      linked: repos.filter((r) => r.project_id).length,
      openPulls: one("SELECT COUNT(*) AS n FROM gh_pulls WHERE state = 'open'").n,
      reviewed: one('SELECT COUNT(*) AS n FROM gh_pulls WHERE review_id IS NOT NULL').n,
      autoReview: repos.filter((r) => r.auto_review).length,
    },
  };
}

/** Hand over a token. The connector starts in dry-run, as every connector does. */
export function connectGitHub({ token: t, actor }) {
  if (!isHuman(actor)) refuse('only a person connects GitHub');
  const v = String(t || '').trim();
  if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(v)) refuse('that does not look like a GitHub token (ghp_… or github_pat_…)');
  if (!one("SELECT id FROM connectors WHERE id = 'github'")) refuse('the GitHub connector is not in the catalogue');
  connect('github', { secret: v, actor });
  ensureHubScopes();
  return hubOverview();
}

export function setGitHubLive({ live, actor }) {
  if (!isHuman(actor)) refuse('only a person arms a connector');
  setConnectorState('github', live ? 'live' : 'dry', { actor });
  return hubOverview();
}

/** A secret GitHub signs deliveries with. Shown once, kept only in the vault. */
export function rotateWebhookSecret({ actor }) {
  if (!isHuman(actor)) refuse('only a person sets the webhook secret');
  const secret = crypto.randomBytes(24).toString('hex');
  putSecret(WEBHOOK_SECRET, secret, { kind: 'webhook', connector: 'github', note: 'signs GitHub webhook deliveries', actor });
  return { secret, url: hubOverview().webhook.url, shownOnce: true };
}

// ---------------------------------------------------------------- repos --

export async function remoteRepos({ actor }) {
  return gh('repo.list', { max: 100 }, { actor, reason: 'list the repositories this token can see' });
}

export async function addRepo({ repo, projectId = null, actor }) {
  const name = repoName(repo);
  let info = null;
  try { info = await gh('repo.info', { repo: name }, { actor, reason: `look up ${name}` }); } catch (e) { if (e.status !== 409) throw e; }
  exec(`INSERT INTO gh_repos (full_name, project_id, default_branch, description, private, url, created_by)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(full_name) DO UPDATE SET project_id = COALESCE(excluded.project_id, project_id),
          default_branch = COALESCE(excluded.default_branch, default_branch), description = COALESCE(excluded.description, description)`,
  name, projectId ? projectRow(projectId).id : null, info?.defaultBranch || null, info?.description || null, info?.private ? 1 : 0,
  info?.url || `https://github.com/${name}`, actor);
  const r = one('SELECT * FROM gh_repos WHERE full_name = ?', name);
  if (r.project_id) exec("UPDATE forge_projects SET repo_url = COALESCE(repo_url, ?) WHERE id = ?", `https://github.com/${name}.git`, r.project_id);
  audit({ actorType: 'human', actorId: actor, action: 'github.repo_added', subjectType: 'ghRepo', subjectId: r.id, payload: { repo: name, projectId: r.project_id } });
  return r;
}

const repoRow = (id) => { const r = one('SELECT * FROM gh_repos WHERE id = ?', Number(id)); if (!r) refuse('no such repository', 404); return r; };

export function updateRepo(id, { autoReview, projectId, actor }) {
  const r = repoRow(id);
  exec('UPDATE gh_repos SET auto_review = COALESCE(?, auto_review), project_id = COALESCE(?, project_id) WHERE id = ?',
    autoReview === undefined ? null : (autoReview ? 1 : 0), projectId ? projectRow(projectId).id : null, r.id);
  audit({ actorType: 'human', actorId: actor, action: 'github.repo_updated', subjectType: 'ghRepo', subjectId: r.id, payload: { autoReview, projectId } });
  return repoRow(r.id);
}

export function removeRepo(id, { actor }) {
  const r = repoRow(id);
  exec('DELETE FROM gh_pulls WHERE repo_id = ?', r.id);
  exec('DELETE FROM gh_repos WHERE id = ?', r.id);
  audit({ actorType: 'human', actorId: actor, action: 'github.repo_removed', subjectType: 'ghRepo', subjectId: r.id, payload: { repo: r.full_name } });
  return { ok: true };
}

/** Clone into the factory, so the editor, the reviewers and the deployer can all reach it. */
export async function importRepo(id, { branch = null, actor }) {
  const r = repoRow(id);
  if (r.project_id) refuse('this repository is already in the factory');
  const url = `https://github.com/${r.full_name}.git`;
  const p = await gitOut('repo.clone', r.full_name, { branch }, actor,
    async () => cloneProject({ name: r.full_name.split('/')[1], url, branch: branch || r.default_branch || null, token: token(), description: r.description || '', actor }));
  exec('UPDATE gh_repos SET project_id = ? WHERE id = ?', p.id, r.id);
  return { project: { id: p.id, slug: p.slug, name: p.name }, repo: repoRow(r.id) };
}

export async function pullRepo(id, { actor }) {
  const r = repoRow(id);
  if (!r.project_id) refuse('import the repository into the factory first');
  return gitOut('repo.pull', r.full_name, {}, actor, async () => pullProject(r.project_id, { token: token(), actor }));
}

export async function pushRepo(id, { actor }) {
  const r = repoRow(id);
  if (!r.project_id) refuse('import the repository into the factory first');
  if (!isHuman(actor)) refuse('a push is a person\'s act');
  return gitOut('repo.push', r.full_name, {}, actor, async () => pushProject(r.project_id, { actor, token: token() }));
}

export async function syncPulls(id, { actor }) {
  const r = repoRow(id);
  const { pulls } = await gh('pr.list', { repo: r.full_name, state: 'open', max: 50 }, { actor, reason: `refresh pull requests of ${r.full_name}` });
  exec("UPDATE gh_pulls SET state = 'closed' WHERE repo_id = ? AND state = 'open'", r.id);
  for (const p of pulls) {
    exec(`INSERT INTO gh_pulls (repo_id, number, title, state, draft, author, head, base, sha, url, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(repo_id, number) DO UPDATE SET title = excluded.title, state = excluded.state, draft = excluded.draft,
            head = excluded.head, base = excluded.base, sha = excluded.sha, updated = excluded.updated`,
    r.id, p.number, p.title, p.state, p.draft ? 1 : 0, p.author, p.head, p.base, p.sha, p.url, p.updated);
  }
  exec("UPDATE gh_repos SET last_synced = datetime('now') WHERE id = ?", r.id);
  return { pulls: q('SELECT * FROM gh_pulls WHERE repo_id = ? ORDER BY updated DESC', r.id) };
}

export async function issues(id, { actor }) {
  const r = repoRow(id);
  return gh('repo.issues', { repo: r.full_name, state: 'open', max: 50 }, { actor, reason: `read issues of ${r.full_name}` });
}

export async function actions(id, { actor }) {
  const r = repoRow(id);
  return gh('actions.status', { repo: r.full_name, max: 15 }, { actor, reason: `read workflow runs of ${r.full_name}` });
}

export async function branchesOf(id, { actor }) {
  const r = repoRow(id);
  return gh('repo.branches', { repo: r.full_name }, { actor, reason: `list branches of ${r.full_name}` });
}

// -------------------------------------------------------- pull requests --

/** Read a pull request's patch and put it in front of the review board. */
export async function reviewPull(id, number, { dimensions = null, actor }) {
  const r = repoRow(id);
  const { pull, files } = await gh('pr.files', { repo: r.full_name, number: Number(number) }, { actor, reason: `read the patch of ${r.full_name}#${number}` });
  const review = startReview({ repo: r.full_name, prNumber: pull.number, prTitle: pull.title, prFiles: files, projectId: null, dimensions, actor });
  exec(`INSERT INTO gh_pulls (repo_id, number, title, state, author, head, base, sha, url, review_id) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(repo_id, number) DO UPDATE SET review_id = excluded.review_id, sha = excluded.sha`,
  r.id, pull.number, pull.title, 'open', pull.author, pull.head, pull.base, String(pull.sha || '').slice(0, 7), pull.url, review.id);
  return review;
}

/**
 * Post a finished review on the pull request — as a comment, or as "request
 * changes" when it failed. Never an approval: approving somebody's work on the
 * company's behalf is a signature, and the driver refuses it outright.
 */
export async function postReview(reviewId, { actor }) {
  if (!isHuman(actor)) refuse('a review goes on GitHub when a person posts it');
  const rv = one('SELECT * FROM eng_reviews WHERE id = ?', Number(reviewId));
  if (!rv) refuse('no such review', 404);
  if (!rv.repo || !rv.pr_number) refuse('this review is not of a pull request');
  if (rv.state !== 'done') refuse('the review has not finished');
  const body = reviewMarkdown(rv.id);
  const event = rv.verdict === 'fail' ? 'REQUEST_CHANGES' : 'COMMENT';
  const res = await gh('pr.review', { repo: rv.repo, number: rv.pr_number, event, body }, { actor, reason: `post review #${rv.id}` });
  markPosted(rv.id, { url: `https://github.com/${rv.repo}/pull/${rv.pr_number}`, actor });
  audit({ actorType: 'human', actorId: actor, action: 'github.review_posted', subjectType: 'engReview', subjectId: rv.id, payload: { repo: rv.repo, number: rv.pr_number, event } });
  return { ok: true, event, id: res?.id || null };
}

/** One finding becomes one issue in the repository's tracker. */
export async function issueFromFinding(findingId, { repo = null, actor }) {
  if (!isHuman(actor)) refuse('opening an issue is a person\'s act');
  const f = one('SELECT f.*, r.repo AS review_repo, r.project_id FROM eng_findings f JOIN eng_reviews r ON r.id = f.review_id WHERE f.id = ?', Number(findingId));
  if (!f) refuse('no such finding', 404);
  if (f.issue_url) refuse('an issue was already opened for this finding');
  const target = repo ? repoName(repo) : (f.review_repo || one('SELECT full_name FROM gh_repos WHERE project_id = ?', f.project_id)?.full_name);
  if (!target) refuse('link this project to a GitHub repository first');
  const body = [
    `**${f.severity}** · ${f.dimension}${f.file ? ` · \`${f.file}${f.line ? `:${f.line}` : ''}\`` : ''}`,
    '', f.detail || '', f.evidence ? `\n> ${f.evidence}` : '', f.fix ? `\n**Fix:** ${f.fix}` : '',
    '', `_From AlphaCore review #${f.review_id}._`,
  ].join('\n');
  const res = await gh('issue.create', { repo: target, title: `[${f.severity}] ${f.title}`.slice(0, 200), body, labels: [f.dimension, `severity:${f.severity}`] }, { actor, reason: `issue for finding #${f.id}` });
  markIssue(f.id, res.url);
  return res;
}

// ---------------------------------------------------------------- webhook --

/** GitHub signs the raw body with the shared secret; anything else is refused. */
export function verifySignature(raw, header) {
  const secret = getSecret(WEBHOOK_SECRET);
  if (!secret || !header || !String(header).startsWith('sha256=')) return false;
  const want = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(want);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * A delivery from GitHub. Only `pull_request` opened/synchronize/reopened on a
 * repository with auto-review switched on does anything; everything else is
 * written down and left alone. Reading the patch still goes through the gate,
 * so a dry-run connector records the delivery and does not fetch.
 */
export async function receiveWebhook({ event, delivery, raw, signature }) {
  const log = (outcome, extra = {}) => exec('INSERT INTO gh_deliveries (delivery, event, action, repo, number, outcome, detail) VALUES (?,?,?,?,?,?,?)',
    delivery || null, event || 'unknown', extra.action || null, extra.repo || null, extra.number || null, outcome, extra.detail || null);
  if (!verifySignature(raw, signature)) { log('refused', { detail: 'bad or missing signature' }); return { status: 401, body: 'signature check failed' }; }
  let payload;
  try { payload = JSON.parse(raw); } catch { log('refused', { detail: 'not JSON' }); return { status: 400, body: 'not json' }; }
  const repo = payload.repository?.full_name || null;
  const action = payload.action || null;
  if (event === 'ping') { log('recorded', { repo, detail: 'ping' }); return { status: 200, body: 'pong' }; }
  if (event !== 'pull_request') { log('ignored', { action, repo }); return { status: 202, body: 'ignored' }; }
  const number = payload.pull_request?.number;
  const r = repo ? one('SELECT * FROM gh_repos WHERE full_name = ?', repo) : null;
  if (!r) { log('ignored', { action, repo, number, detail: 'repository not linked' }); return { status: 202, body: 'not linked' }; }
  exec(`INSERT INTO gh_pulls (repo_id, number, title, state, draft, author, head, base, sha, url, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(repo_id, number) DO UPDATE SET title = excluded.title, state = excluded.state, sha = excluded.sha, updated = excluded.updated`,
  r.id, number, payload.pull_request?.title || null, payload.pull_request?.state || null, payload.pull_request?.draft ? 1 : 0,
  payload.pull_request?.user?.login || null, payload.pull_request?.head?.ref || null, payload.pull_request?.base?.ref || null,
  String(payload.pull_request?.head?.sha || '').slice(0, 7), payload.pull_request?.html_url || null, payload.pull_request?.updated_at || null);
  if (!r.auto_review || !['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(action) || payload.pull_request?.draft) {
    log('recorded', { action, repo, number });
    return { status: 202, body: 'recorded' };
  }
  try {
    const review = await reviewPull(r.id, number, { actor: 'system:github-webhook' });
    log('reviewed', { action, repo, number, detail: `review #${review.id}` });
    notify({ level: 'info', source: 'github', message: `${repo}#${number} was updated — the review board is reading it.`, subjectType: 'engReview', subjectId: review.id });
    return { status: 202, body: `review ${review.id}` };
  } catch (e) {
    log('recorded', { action, repo, number, detail: String(e.message).slice(0, 300) });
    return { status: 202, body: 'recorded' };
  }
}
