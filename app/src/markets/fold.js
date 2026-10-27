// Reading a finished run, the same way for the markets desk, the newsroom and
// the local brain.
//
// Any state other than queued, leased or running is finished. awaiting_human
// still carries an answer — the model was just unsure of it — so it is used
// and labelled rather than thrown away.
import { one } from '../db.js';
import { openPii } from '../erasure.js';

export function readRun(runId) {
  if (!runId) return { done: true, failed: true, why: 'no run' };
  const run = one('SELECT state, output, failure_reason, provider, model FROM runs WHERE id = ?', runId);
  if (!run) return { done: true, failed: true, why: 'the run is gone' };
  if (['queued', 'leased', 'running'].includes(run.state)) return { done: false };
  let parsed = null; let raw = '';
  try { const o = run.output ? JSON.parse(openPii(run.output)) : null; parsed = o?.parsed || null; raw = o?.raw || ''; } catch { parsed = null; }
  return {
    done: true,
    failed: !parsed && !raw,
    why: run.failure_reason || null,
    parsed,
    raw,
    lowConfidence: run.state === 'awaiting_human',
    servedBy: run.provider ? `${run.provider}/${run.model}` : null,
  };
}
