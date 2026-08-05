// Pipeline engine — FORGE chains made mechanical. A pipeline is a template of
// steps; each step is an agent run. The advance tick moves work forward:
// done → next step (previous output becomes context), awaiting_human → the
// pipeline waits at the gate, rejected/failed → the pipeline fails. Every
// completed step's output is archived into the workspace as an artifact.
import { q, one, exec, uuid } from './db.js';
import { pipelinesConfig } from './env.js';
import { audit } from './audit.js';
import { enqueueRun } from './workflow.js';
import { writeStepArtifact } from './artifacts.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function listTemplates() {
  return Object.entries(pipelinesConfig.templates).map(([key, t]) => ({
    key, title: t.title, description: t.description, steps: t.steps.map((s) => ({ agentId: s.agentId, title: s.title })),
  }));
}

function stepPrompt(step, goal, prevText, allText) {
  return step.prompt
    .replaceAll('{{goal}}', goal)
    .replaceAll('{{prev}}', prevText || '(none)')
    .replaceAll('{{all}}', allText || prevText || '(none)');
}

function allOutputs(steps, upto) {
  return steps.slice(0, upto)
    .filter((s) => s.outText)
    .map((s) => `=== ${s.title} (${s.agentId}) ===\n${s.outText}`)
    .join('\n\n')
    .slice(0, 24000);
}

function startStep(p, index, prevText) {
  const steps = JSON.parse(p.steps);
  const step = steps[index];
  const runId = enqueueRun({
    agentId: step.agentId,
    taskType: `pipeline:${step.title}`,
    input: { prompt: stepPrompt(step, p.goal, prevText, allOutputs(steps, index)) },
    pipelineId: p.id,
    actor: 'system:pipeline',
  });
  steps[index] = { ...step, runId, state: 'running' };
  exec('UPDATE pipelines SET steps = ?, current_step = ?, state = ? WHERE id = ?', JSON.stringify(steps), index, 'running', p.id);
  audit({ actorType: 'system', actorId: 'pipeline', action: 'pipeline.step_started', subjectType: 'pipeline', subjectId: p.id, payload: { step: index, title: step.title, runId } });
}

export function createPipeline({ template, goal, productId = null, actor = 'human:admin' }) {
  const tpl = pipelinesConfig.templates[template];
  if (!tpl) throw new Error(`unknown template ${template}`);
  if (!goal || !goal.trim()) throw new Error('goal is required');
  if (productId && !one('SELECT id FROM products WHERE id = ?', productId)) throw new Error(`unknown product ${productId}`);
  const id = uuid();
  const workspace = productId ? `${productId}-${slug(template)}-${Date.now().toString(36)}` : `${slug(template)}-${Date.now().toString(36)}`;
  const steps = tpl.steps.map((s) => ({ ...s, runId: null, state: 'pending' }));
  exec(
    'INSERT INTO pipelines (id, name, template, goal, steps, workspace, product_id) VALUES (?,?,?,?,?,?,?)',
    id, tpl.title, template, goal.trim(), JSON.stringify(steps), workspace, productId,
  );
  audit({ actorType: 'human', actorId: actor, action: 'pipeline.created', subjectType: 'pipeline', subjectId: id, payload: { template, productId, goal: goal.slice(0, 160) } });
  const p = one('SELECT * FROM pipelines WHERE id = ?', id);
  startStep(p, 0, '');
  return getPipeline(id);
}

function outputText(run) {
  if (!run?.output) return '';
  try {
    const out = JSON.parse(run.output);
    const body = out.parsed ? JSON.stringify(out.parsed, null, 2) : String(out.raw || '');
    return body.slice(0, 8000);
  } catch { return ''; }
}

function finish(p, state) {
  exec("UPDATE pipelines SET state = ?, ended_at = datetime('now') WHERE id = ?", state, p.id);
  audit({ actorType: 'system', actorId: 'pipeline', action: `pipeline.${state}`, subjectType: 'pipeline', subjectId: p.id });
}

/** Advance every live pipeline one notch if its current run has settled. */
export function advancePipelines() {
  const live = q("SELECT * FROM pipelines WHERE state IN ('running','awaiting_human')");
  for (const p of live) {
    const steps = JSON.parse(p.steps);
    const i = p.current_step;
    const step = steps[i];
    if (!step?.runId) continue;
    const run = one('SELECT * FROM runs WHERE id = ?', step.runId);
    if (!run) continue;

    if (run.state === 'done') {
      const text = outputText(run);
      steps[i] = { ...step, state: 'done', outText: text.slice(0, 6000) };
      try {
        writeStepArtifact(p.workspace, `${String(i + 1).padStart(2, '0')}-${slug(step.title)}.md`,
          `# ${step.title}\n\nPipeline: ${p.name}\nGoal: ${p.goal}\nAgent: ${step.agentId} · Run: ${run.id}\n\n---\n\n${text}`);
      } catch { /* artifact archive is best-effort */ }
      if (i + 1 < steps.length) {
        exec('UPDATE pipelines SET steps = ? WHERE id = ?', JSON.stringify(steps), p.id);
        startStep({ ...p, steps: JSON.stringify(steps) }, i + 1, text);
      } else {
        exec('UPDATE pipelines SET steps = ? WHERE id = ?', JSON.stringify(steps), p.id);
        finish(p, 'done');
      }
    } else if (run.state === 'awaiting_human') {
      if (p.state !== 'awaiting_human') {
        exec("UPDATE pipelines SET state = 'awaiting_human' WHERE id = ?", p.id);
      }
    } else if (run.state === 'failed' || run.state === 'cancelled') {
      steps[i] = { ...step, state: run.state };
      exec('UPDATE pipelines SET steps = ? WHERE id = ?', JSON.stringify(steps), p.id);
      finish(p, 'failed');
    } else if (p.state === 'awaiting_human') {
      // Run resumed (e.g. requeued) — reflect it.
      exec("UPDATE pipelines SET state = 'running' WHERE id = ?", p.id);
    }
  }
}

export function getPipeline(id) {
  const p = one('SELECT * FROM pipelines WHERE id = ?', id);
  if (!p) return null;
  const steps = JSON.parse(p.steps).map((s, idx) => {
    const run = s.runId ? one('SELECT id, state, cost_usd, flags, failure_reason FROM runs WHERE id = ?', s.runId) : null;
    return {
      index: idx, agentId: s.agentId, title: s.title,
      runId: s.runId, stepState: s.state,
      runState: run?.state || null,
      costUsd: run?.cost_usd || 0,
      flags: run?.flags ? JSON.parse(run.flags) : [],
      reason: run?.failure_reason || null,
    };
  });
  return { ...p, steps, costUsd: steps.reduce((a, s) => a + (s.costUsd || 0), 0) };
}

export function listPipelines() {
  return q('SELECT id FROM pipelines ORDER BY created_at DESC LIMIT 50').map((r) => getPipeline(r.id));
}

export function cancelPipeline(id, actor) {
  const p = one('SELECT * FROM pipelines WHERE id = ?', id);
  if (!p) throw new Error('pipeline not found');
  if (!['running', 'awaiting_human'].includes(p.state)) throw new Error(`pipeline is ${p.state}`);
  finish(p, 'cancelled');
  audit({ actorType: 'human', actorId: actor, action: 'pipeline.cancelled', subjectType: 'pipeline', subjectId: id });
  return getPipeline(id);
}
