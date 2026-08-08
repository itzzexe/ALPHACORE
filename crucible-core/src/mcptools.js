// What an outside agent can actually do when it drives this company over MCP.
//
// Kept separate from the protocol itself so the tool list reads as a list of
// company actions rather than a list of RPC handlers. Every one of these runs
// as the user whose token was presented, through the same functions the
// dashboard calls — there is no back door with wider powers.
import { q, one } from './db.js';
import { sectionCatalog } from './links.js';
import { enqueueRun } from './workflow.js';
import { createRequest } from './requests.js';
import { search as memorySearch } from './memory.js';
import { post as chatPost } from './chat.js';
import { hasPerm } from './auth.js';

const must = (user, perm) => {
  if (!hasPerm(user, perm)) throw new Error(`your account does not hold ${perm}`);
};

export const mcpTools = {
  company_overview(_args, user) {
    must(user, 'dashboard.view');
    const month = new Date().toISOString().slice(0, 7);
    return {
      queue: {
        running: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'running'").n,
        queued: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'queued'").n,
        awaitingHuman: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'").n,
      },
      spendThisMonthUsd: one('SELECT COALESCE(ROUND(SUM(cost_usd),4),0) AS s FROM model_calls WHERE created_at >= ?', `${month}-01`).s,
      decisionsOpen: one("SELECT COUNT(*) AS n FROM decisions WHERE status = 'open'").n,
      employees: one("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'").n,
      chainEntries: one('SELECT COUNT(*) AS n FROM audit_log').n,
      egressToday: one("SELECT COUNT(*) AS n FROM egress_log WHERE created_at >= datetime('now','-1 day')").n,
    };
  },

  list_sections(_args, user) {
    must(user, 'dashboard.view');
    return sectionCatalog().map((s) => ({ id: s.id, label: s.label, division: s.division, records: s.count }));
  },

  submit_request({ title, body }, user) {
    must(user, 'requests.create');
    if (!title || !body) throw new Error('a request needs a title and a body');
    return createRequest({ title, body, actor: `human:${user.username}` });
  },

  ask_employee({ agentId, taskType, input = {} }, user) {
    must(user, 'runs.create');
    const agent = one("SELECT id, name, status FROM agents WHERE id = ?", agentId);
    if (!agent) throw new Error(`there is no employee called ${agentId}`);
    const runId = enqueueRun({ agentId, taskType: taskType || 'task', input, actor: `human:${user.username}` });
    return { runId, agent: agent.name, note: 'the run is queued; read it back with audit_tail or the runs page' };
  },

  read_memory({ query, k = 6 }, user) {
    must(user, 'knowledge.view');
    return memorySearch(query, { limit: Math.min(20, k) });
  },

  audit_tail({ limit = 20 }, user) {
    must(user, 'audit.view');
    return q('SELECT seq, created_at, actor_type, actor_id, action, subject_type, subject_id FROM audit_log ORDER BY seq DESC LIMIT ?', Math.min(100, limit));
  },

  post_to_floor({ text, channel = 'floor' }, user) {
    must(user, 'dashboard.view');
    return chatPost({ channelId: channel, body: text, actor: `human:${user.username}` });
  },
};
