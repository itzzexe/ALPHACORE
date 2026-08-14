// The Company Journey — one order/product travels through EVERY department:
// Strategy → Research → Product → Finance → Legal → Architecture →
// Engineering → Review → QA → Security → Release → Marketing → Support →
// Governance. Agent stages run real work through the run queue (budgets,
// router, gates all apply); human stages are named sign-offs. The journey is
// the value chain made visible: nothing ships without crossing the whole
// company, and every crossing is on the audit record.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { archiveItem } from './data.js';
import { openPii } from './erasure.js';

export const JOURNEY_STAGES = [
  { dept: 'strategy',     title: 'Strategy alignment — OKR fit, named sponsor', mode: 'human', link: '#/objectives' },
  { dept: 'research',     title: 'Market & evidence brief',                      mode: 'agent', agent: 'AGT-RES-001' },
  { dept: 'product',      title: 'PRD & MVP boundary',                          mode: 'agent', agent: 'AGT-PM-001' },
  { dept: 'finance',      title: 'Budget envelope approved',                    mode: 'human', link: '#/budgets' },
  { dept: 'legal',        title: 'Legal & compliance check',                    mode: 'human', link: '#/legal' },
  { dept: 'architecture', title: 'Architecture & ADR',                          mode: 'agent', agent: 'AGT-ARC-001' },
  { dept: 'engineering',  title: 'Implementation plan & build',                 mode: 'agent', agent: 'AGT-ENG-001' },
  { dept: 'review',       title: 'Independent code review (cross-family)',      mode: 'agent', agent: 'AGT-REV-001' },
  { dept: 'qa',           title: 'QA verification',                             mode: 'agent', agent: 'AGT-QA-001' },
  { dept: 'security',     title: 'Security review (block authority)',           mode: 'agent', agent: 'AGT-SEC-001' },
  { dept: 'release',      title: 'Release checklist & rollback plan',           mode: 'agent', agent: 'AGT-DEV-001' },
  { dept: 'marketing',    title: 'Launch copy & docs',                          mode: 'agent', agent: 'AGT-DOC-001' },
  { dept: 'support',      title: 'Support readiness — KB & macros',             mode: 'agent', agent: 'AGT-SUP-001' },
  { dept: 'governance',   title: 'Final go/no-go — human sign-off',             mode: 'human', link: '#/governance' },
];

export function createJourney({ title, productId = null, autopilot = false, actor }) {
  if (!title?.trim()) throw new Error('title required');
  exec('INSERT INTO journeys (title, product_id, created_by, autopilot) VALUES (?,?,?,?)', title.trim(), productId, actor, autopilot ? 1 : 0);
  const id = one('SELECT last_insert_rowid() AS id').id;
  JOURNEY_STAGES.forEach((s, i) => {
    exec('INSERT INTO journey_stages (journey_id, seq, dept, title, mode, agent_id, state, started_at) VALUES (?,?,?,?,?,?,?,?)',
      id, i + 1, s.dept, s.title, s.mode, s.agent || null,
      i === 0 ? 'active' : 'pending', i === 0 ? new Date().toISOString() : null);
  });
  audit({ actorType: 'human', actorId: actor, action: 'journey.created', subjectType: 'journey', subjectId: id, payload: { title: title.trim(), productId, stages: JOURNEY_STAGES.length, autopilot: Boolean(autopilot) } });
  notify({ level: 'info', source: 'journey', message: `Journey started: “${title.trim()}” — ${JOURNEY_STAGES.length} departments ahead.${autopilot ? ' AUTOPILOT: only the final governance sign-off is human.' : ' First stop: strategy (human).'}`, subjectType: 'journey', subjectId: id });
  return getJourney(id);
}

export function getJourney(id) {
  const j = one('SELECT * FROM journeys WHERE id = ?', id);
  if (!j) return null;
  const stages = q('SELECT * FROM journey_stages WHERE journey_id = ? ORDER BY seq', id).map((s) => {
    const run = s.run_id ? one('SELECT state, cost_usd, failure_reason FROM runs WHERE id = ?', s.run_id) : null;
    return { ...s, run };
  });
  return {
    ...j,
    stages,
    doneCount: stages.filter((s) => s.state === 'done').length,
    total: stages.length,
    costUsd: stages.reduce((a, s) => a + (s.run?.cost_usd || 0), 0),
  };
}

export function listJourneys() {
  return q('SELECT id FROM journeys ORDER BY id DESC LIMIT 50').map((r) => {
    const j = getJourney(r.id);
    const active = j.stages.find((s) => ['active', 'awaiting_human'].includes(s.state));
    return { ...j, stages: undefined, activeStage: active || null };
  });
}

function activeStage(journeyId) {
  return one("SELECT * FROM journey_stages WHERE journey_id = ? AND state IN ('active','awaiting_human') ORDER BY seq LIMIT 1", journeyId);
}

function advanceTo(journey, doneSeq, actor = 'system:journey') {
  const next = one('SELECT * FROM journey_stages WHERE journey_id = ? AND seq = ?', journey.id, doneSeq + 1);
  if (next) {
    exec("UPDATE journey_stages SET state = 'active', started_at = datetime('now') WHERE id = ?", next.id);
    exec("UPDATE journeys SET current_seq = ?, state = 'running' WHERE id = ?", next.seq, journey.id);
    if (next.mode === 'human') {
      notify({ level: 'warn', source: 'journey', message: `Journey “${journey.title}” reached ${next.dept.toUpperCase()} — a human must sign off: ${next.title}`, subjectType: 'journey', subjectId: journey.id });
    }
  } else {
    exec("UPDATE journeys SET state = 'done', ended_at = datetime('now') WHERE id = ?", journey.id);
    audit({ actorType: 'system', actorId: actor, action: 'journey.completed', subjectType: 'journey', subjectId: journey.id, payload: { title: journey.title } });
    notify({ level: 'info', source: 'journey', message: `Journey COMPLETE: “${journey.title}” crossed all ${JOURNEY_STAGES.length} departments.`, subjectType: 'journey', subjectId: journey.id });
    const j = getJourney(journey.id);
    archiveItem({
      title: `Journey complete: ${journey.title}`,
      kind: 'manual',
      subjectType: 'journey',
      subjectId: journey.id,
      snapshot: { title: journey.title, productId: journey.product_id, costUsd: j.costUsd, stages: j.stages.map((s) => ({ dept: s.dept, state: s.state, summary: s.summary })) },
      actor: 'system:journey',
    });
  }
}

/** Server tick — agent stages enqueue real runs and follow them. */
export function advanceJourneys() {
  for (const j of q("SELECT * FROM journeys WHERE state IN ('running','awaiting_human')")) {
    const s = activeStage(j.id);
    if (!s) continue;

    // Autopilot: policy-default human stages self-complete — EXCEPT the final
    // governance sign-off, which is always a named human (load-bearing rule).
    if (s.mode === 'human' && j.autopilot && s.seq < JOURNEY_STAGES.length && s.state === 'active') {
      exec("UPDATE journey_stages SET state = 'done', summary = 'autopilot: policy defaults applied', ended_at = datetime('now') WHERE id = ?", s.id);
      audit({ actorType: 'system', actorId: 'system:autopilot', action: 'journey.stage_autopiloted', subjectType: 'journey', subjectId: j.id, payload: { seq: s.seq, dept: s.dept } });
      advanceTo(j, s.seq);
      continue;
    }

    // Human stages wait for completeStage(); agent stages run for real.
    if (s.mode !== 'agent') continue;

    if (!s.run_id) {
      const prior = q("SELECT dept, title, summary FROM journey_stages WHERE journey_id = ? AND seq < ? AND summary IS NOT NULL ORDER BY seq DESC LIMIT 3", j.id, s.seq);
      const context = prior.reverse().map((p) => `[${p.dept}] ${p.title}: ${String(p.summary).slice(0, 500)}`).join('\n');
      try {
        const runId = enqueueRun({
          agentId: s.agent_id,
          taskType: `journey:${j.id}:${s.seq}`,
          input: {
            prompt: `Company journey "${j.title}" — stage ${s.seq}/${JOURNEY_STAGES.length}: ${s.title} (${s.dept} department).${j.product_id ? `\nProduct: ${j.product_id}` : ''}
${context ? `\nUpstream stage outputs:\n${context}\n` : ''}
Do this stage's work for the journey goal above. Follow your role's output contract exactly.`,
          },
          actor: 'system:journey',
        });
        exec('UPDATE journey_stages SET run_id = ? WHERE id = ?', runId, s.id);
      } catch {
        // Budget exhausted or agent suspended — surface it, keep the journey alive.
        exec("UPDATE journey_stages SET state = 'awaiting_human', note = 'could not enqueue (budget/agent) — complete manually or retry later' WHERE id = ?", s.id);
        exec("UPDATE journeys SET state = 'awaiting_human' WHERE id = ?", j.id);
      }
      continue;
    }

    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', s.run_id);
    if (!run) continue;
    if (run.state === 'done') {
      const out = run.output ? JSON.parse(openPii(run.output)) : {};
      const p = out.parsed || {};
      const summary = p.summary || p.artifact || p.verdict || p.draft || p.report?.[0]?.criterion || out.text?.slice(0, 300) || 'done';
      exec("UPDATE journey_stages SET state = 'done', summary = ?, ended_at = datetime('now') WHERE id = ?", String(summary).slice(0, 500), s.id);
      audit({ actorType: 'agent', actorId: s.agent_id, action: 'journey.stage_done', subjectType: 'journey', subjectId: j.id, payload: { seq: s.seq, dept: s.dept } });
      advanceTo(j, s.seq);
    } else if (run.state === 'awaiting_human') {
      if (s.state !== 'awaiting_human') {
        exec("UPDATE journey_stages SET state = 'awaiting_human', note = ? WHERE id = ?", run.failure_reason || 'held at the human gate', s.id);
        exec("UPDATE journeys SET state = 'awaiting_human' WHERE id = ?", j.id);
      }
    } else if (['failed', 'cancelled'].includes(run.state)) {
      if (s.state !== 'awaiting_human') {
        exec("UPDATE journey_stages SET state = 'awaiting_human', note = ? WHERE id = ?", `run ${run.state}: ${run.failure_reason || 'no reason recorded'} — approve to skip, or cancel the journey`, s.id);
        exec("UPDATE journeys SET state = 'awaiting_human' WHERE id = ?", j.id);
      }
    } else if (s.state === 'awaiting_human' && ['queued', 'leased', 'running'].includes(run.state)) {
      // Gate released the run (approved) — it is executing again.
      exec("UPDATE journey_stages SET state = 'active', note = NULL WHERE id = ?", s.id);
      exec("UPDATE journeys SET state = 'running' WHERE id = ?", j.id);
    }
  }
}

/** Human sign-off: completes the current human stage (or overrides a stuck one). */
export function completeStage(journeyId, { note = null, actor }) {
  const j = one('SELECT * FROM journeys WHERE id = ?', journeyId);
  if (!j) throw new Error('journey not found');
  if (['done', 'cancelled'].includes(j.state)) throw new Error(`journey is ${j.state}`);
  const s = activeStage(journeyId);
  if (!s) throw new Error('no active stage');
  if (s.mode === 'agent' && s.state !== 'awaiting_human') throw new Error('this stage belongs to an agent — it completes via its run');
  exec("UPDATE journey_stages SET state = 'done', note = COALESCE(?, note), summary = COALESCE(summary, ?), ended_at = datetime('now') WHERE id = ?",
    note, s.mode === 'human' ? `signed off by ${actor}` : 'human override', s.id);
  audit({ actorType: 'human', actorId: actor, action: 'journey.stage_signed', subjectType: 'journey', subjectId: journeyId, payload: { seq: s.seq, dept: s.dept, override: s.mode === 'agent' } });
  advanceTo(j, s.seq, actor);
  return getJourney(journeyId);
}

export function cancelJourney(journeyId, actor) {
  const j = one('SELECT * FROM journeys WHERE id = ?', journeyId);
  if (!j) throw new Error('journey not found');
  exec("UPDATE journeys SET state = 'cancelled', ended_at = datetime('now') WHERE id = ?", journeyId);
  exec("UPDATE journey_stages SET state = 'skipped' WHERE journey_id = ? AND state IN ('pending','active','awaiting_human')", journeyId);
  audit({ actorType: 'human', actorId: actor, action: 'journey.cancelled', subjectType: 'journey', subjectId: journeyId });
  return { ok: true };
}
