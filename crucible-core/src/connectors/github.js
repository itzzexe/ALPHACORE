// GitHub — where the engineering half of the company actually lives.
//
// Issues become tasks and tasks become issues; The Lab and System Design open
// pull requests instead of writing a document about opening one; the AI Auditor
// reads diffs. Merging is not here by accident — it is in the always-gated list,
// because a merge is not reversible in the way an issue comment is.
import { wire, need } from './wire.js';

const API = 'https://api.github.com';
const gh = (token) => ({ authorization: `Bearer ${token}`, 'user-agent': 'alphacore', accept: 'application/vnd.github+json' });

export default {
  id: 'github',
  label: 'GitHub',
  docs: 'https://docs.github.com/rest',
  auth: { kind: 'token', note: 'fine-grained personal access token, or a GitHub App installation token' },
  capabilities: ['repo.read', 'repo.issues', 'issue.create', 'issue.comment', 'pr.create', 'pr.review', 'repo.merge', 'actions.status'],
  quotaDay: 800,
  ops: {
    'repo.read': {
      target: (a) => a.repo,
      async run({ repo, path = '', ref = null }, ctx) {
        const token = need(ctx, 'token');
        const url = `${API}/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}${ref ? `?ref=${ref}` : ''}`;
        const data = await wire(url, { headers: gh(token), service: 'github' });
        if (Array.isArray(data)) return { kind: 'dir', entries: data.map((e) => ({ name: e.name, type: e.type, size: e.size })) };
        return { kind: 'file', name: data.name, size: data.size, text: data.content ? Buffer.from(data.content, 'base64').toString('utf8').slice(0, 20000) : null };
      },
    },
    'repo.issues': {
      target: (a) => a.repo,
      async run({ repo, state = 'open', labels = null, max = 30 }, ctx) {
        const token = need(ctx, 'token');
        const u = new URL(`${API}/repos/${repo}/issues`);
        u.searchParams.set('state', state);
        u.searchParams.set('per_page', String(Math.min(100, max)));
        if (labels) u.searchParams.set('labels', labels);
        const rows = await wire(u.toString(), { headers: gh(token), service: 'github' });
        return {
          count: rows.length,
          issues: rows.map((i) => ({
            number: i.number, title: i.title, state: i.state, isPr: Boolean(i.pull_request),
            labels: (i.labels || []).map((l) => l.name), author: i.user?.login,
            url: i.html_url, updated: i.updated_at, body: String(i.body || '').slice(0, 4000),
          })),
        };
      },
    },
    'issue.create': {
      target: (a) => a.repo,
      async run({ repo, title, body = '', labels = [] }, ctx) {
        const token = need(ctx, 'token');
        const issue = await wire(`${API}/repos/${repo}/issues`, {
          method: 'POST', headers: gh(token), body: { title, body, labels }, service: 'github',
        });
        return { number: issue.number, url: issue.html_url, title };
      },
    },
    'issue.comment': {
      target: (a) => a.repo,
      async run({ repo, number, body }, ctx) {
        const token = need(ctx, 'token');
        const c = await wire(`${API}/repos/${repo}/issues/${number}/comments`, {
          method: 'POST', headers: gh(token), body: { body }, service: 'github',
        });
        return { id: c.id, url: c.html_url };
      },
    },
    'pr.create': {
      target: (a) => a.repo,
      async run({ repo, title, head, base = 'main', body = '', draft = true }, ctx) {
        const token = need(ctx, 'token');
        const pr = await wire(`${API}/repos/${repo}/pulls`, {
          method: 'POST', headers: gh(token), body: { title, head, base, body, draft }, service: 'github',
        });
        return { number: pr.number, url: pr.html_url, draft: pr.draft };
      },
    },
    'pr.review': {
      target: (a) => a.repo,
      async run({ repo, number, event = 'COMMENT', body = '' }, ctx) {
        const token = need(ctx, 'token');
        // An employee may comment or request changes. Approving somebody else's
        // work on the company's behalf is a human act, so APPROVE is refused.
        if (event === 'APPROVE') throw new Error('an approval on GitHub is a human signature, not an agent action');
        const r = await wire(`${API}/repos/${repo}/pulls/${number}/reviews`, {
          method: 'POST', headers: gh(token), body: { event, body }, service: 'github',
        });
        return { id: r.id, state: r.state };
      },
    },
    'repo.merge': {
      target: (a) => a.repo,
      async run({ repo, number, method = 'squash' }, ctx) {
        const token = need(ctx, 'token');
        return wire(`${API}/repos/${repo}/pulls/${number}/merge`, {
          method: 'PUT', headers: gh(token), body: { merge_method: method }, service: 'github',
        });
      },
    },
    'actions.status': {
      target: (a) => a.repo,
      async run({ repo, max = 10 }, ctx) {
        const token = need(ctx, 'token');
        const runs = await wire(`${API}/repos/${repo}/actions/runs?per_page=${Math.min(50, max)}`, { headers: gh(token), service: 'github' });
        return {
          count: runs.total_count,
          runs: (runs.workflow_runs || []).map((r) => ({
            id: r.id, name: r.name, status: r.status, conclusion: r.conclusion,
            branch: r.head_branch, url: r.html_url, updated: r.updated_at,
          })),
        };
      },
    },
  },
};
