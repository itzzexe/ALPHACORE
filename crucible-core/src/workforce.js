// Workforce board — the AI agents ARE the employees. One card per agent:
// live workload (runs), open tasks, journey stages they hold, reputation from
// audited evals, spend, and last activity. This is the HR view of a company
// whose staff is software.
import { q, one } from './db.js';
import { getAgentSpec } from './workflow.js';
import { accuracyFactor } from './evals.js';

export function workforceBoard() {
  return q('SELECT * FROM agents ORDER BY role_group, id').map((a) => {
    const runs = one(`SELECT COUNT(*) AS total,
        COALESCE(SUM(state IN ('queued','leased','running')), 0) AS active,
        COALESCE(SUM(state = 'awaiting_human'), 0) AS gate,
        COALESCE(SUM(state = 'done'), 0) AS done,
        COALESCE(SUM(state = 'failed'), 0) AS failed,
        COALESCE(SUM(cost_usd), 0) AS cost
      FROM runs WHERE agent_id = ?`, a.id);
    const week = one("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost FROM runs WHERE agent_id = ? AND created_at >= datetime('now','-7 days')", a.id);
    const openTasks = q("SELECT id, title, state, priority, project_id FROM tasks WHERE assignee_type = 'agent' AND assignee_id = ? AND state NOT IN ('done','cancelled') ORDER BY id DESC LIMIT 8", a.id);
    const tasksDone = one("SELECT COUNT(*) AS n FROM tasks WHERE assignee_type = 'agent' AND assignee_id = ? AND state = 'done'", a.id).n;
    const journeyStages = q(`SELECT js.journey_id, js.seq, js.dept, js.state, j.title AS journey_title
      FROM journey_stages js JOIN journeys j ON j.id = js.journey_id
      WHERE js.agent_id = ? AND js.state IN ('active','awaiting_human') LIMIT 5`, a.id);
    const lastRun = one('SELECT created_at, state, task_type FROM runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1', a.id);
    const spec = getAgentSpec(a.id);
    return {
      id: a.id, name: a.name, roleGroup: a.role_group, tier: a.model_tier,
      status: a.status, owner: a.human_owner,
      failMode: spec?.failMode || null, sensitivity: spec?.sensitivity || null,
      reputation: accuracyFactor(a.id),
      runs, week,
      openTasks, tasksDone,
      journeyStages,
      lastActive: lastRun ? { at: lastRun.created_at, state: lastRun.state, taskType: lastRun.task_type } : null,
      busy: (runs.active || 0) + journeyStages.filter((s) => s.state === 'active').length + openTasks.filter((t) => t.state === 'doing').length,
    };
  });
}
