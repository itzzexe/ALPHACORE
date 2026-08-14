// Disputes — what happens when two members of the workforce disagree.
//
// The platform already forces disagreement into the open: a reviewer can block
// an engineer, security can block a release, a critic can block a tribunal.
// Until now those simply stopped work. Here they become a case:
//
//   1. Either party (or a human, or a rule) raises the dispute with both
//      positions stated.
//   2. HR arbitrates — it hears both sides and writes a recommendation. HR
//      recommends; HR does not rule.
//   3. The OWNER rules. That ruling is binding, recorded on the audit chain,
//      and optionally written into organizational memory as precedent so the
//      same argument is not had twice.
//
// The escalation ladder is deliberate: machines argue, HR frames, the owner
// decides. Nothing here can be settled by an agent alone.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { openPii } from './erasure.js';

export function raiseDispute({ title, partyA, positionA, partyB, positionB, subjectType = null, subjectId = null, context = null, actor }) {
  if (!title?.trim() || !partyA?.trim() || !partyB?.trim()) throw new Error('title and both parties required');
  if (!positionA?.trim() || !positionB?.trim()) throw new Error('both positions must be stated — a dispute with one side is just an opinion');
  exec(`INSERT INTO disputes (title, subject_type, subject_id, party_a, position_a, party_b, position_b, context, raised_by)
        VALUES (?,?,?,?,?,?,?,?,?)`,
    title.trim(), subjectType, subjectId === null ? null : String(subjectId),
    partyA.trim(), positionA.trim(), partyB.trim(), positionB.trim(), context, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;

  const runId = enqueueRun({
    agentId: 'AGT-HR-001',
    taskType: `dispute:${id}`,
    input: {
      prompt: `Arbitrate this disagreement between two members of the workforce.

CASE: ${title.trim()}
${subjectType ? `About: ${subjectType} #${subjectId}` : ''}
${context ? `Context: ${context}` : ''}

PARTY A — ${partyA.trim()}
"""
${positionA.trim()}
"""

PARTY B — ${partyB.trim()}
"""
${positionB.trim()}
"""

Find where they actually disagree — it is usually an assumption neither has stated. Assess each position on its merits. Recommend what should happen, and preserve whatever the losing side is right about. If this is a values or priority call rather than a factual one, set needsOwnerDecision true and say why the owner must be the one to choose.`,
    },
    actor,
  });
  exec('UPDATE disputes SET hr_run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'dispute.raised', subjectType: 'dispute', subjectId: id, payload: { title: title.trim(), partyA, partyB } });
  notify({ level: 'warn', source: 'hr', message: `Dispute #${id} raised: ${title.trim()} — ${partyA} vs ${partyB}. HR is arbitrating.`, subjectType: 'dispute', subjectId: id });
  return getDispute(id);
}

export function getDispute(id) {
  const d = one('SELECT * FROM disputes WHERE id = ?', id);
  return d || null;
}

export function listDisputes() {
  return q("SELECT * FROM disputes ORDER BY state = 'ruled', state = 'withdrawn', id DESC LIMIT 60");
}

/** The owner's word. Binding, final, and on the record. */
export function ruleDispute(id, { ruling, favours = null, precedent = false, actor }) {
  const d = getDispute(id);
  if (!d) throw new Error('dispute not found');
  if (d.state === 'ruled') throw new Error('already ruled');
  if (!ruling?.trim()) throw new Error('a ruling must say what is decided');
  exec("UPDATE disputes SET state = 'ruled', ruling = ?, ruled_by = ?, ruled_at = datetime('now') WHERE id = ?",
    `${favours ? `In favour of ${favours}. ` : ''}${ruling.trim()}`, actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'dispute.ruled', subjectType: 'dispute', subjectId: id, payload: { title: d.title, favours, precedent } });

  if (precedent) {
    // A ruling that will recur is worth more as memory than as a record.
    exec('INSERT INTO memory_entries (layer, classification, verification, content, source_ref, created_by) VALUES (?,?,?,?,?,?)',
      'policy', 'internal', 'verified',
      `Precedent from dispute #${id} — ${d.title}\nDisagreement: ${d.party_a} vs ${d.party_b}.\nRuling by the owner: ${ruling.trim()}`,
      `dispute:${id}`, actor);
  }
  notify({ level: 'info', source: 'hr', message: `Dispute #${id} ruled by the owner${favours ? ` in favour of ${favours}` : ''}. ${precedent ? 'Recorded as precedent.' : ''}`, subjectType: 'dispute', subjectId: id });
  return getDispute(id);
}

export function withdrawDispute(id, actor) {
  if (!getDispute(id)) throw new Error('dispute not found');
  exec("UPDATE disputes SET state = 'withdrawn' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'dispute.withdrawn', subjectType: 'dispute', subjectId: id });
  return { ok: true };
}

/** Server tick — collect HR's recommendations. */
export function syncDisputes() {
  for (const d of q("SELECT * FROM disputes WHERE state = 'arbitrating' AND hr_run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', d.hr_run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    const p = run.output ? JSON.parse(openPii(run.output))?.parsed : null;
    if (p?.recommendation) {
      const reasoning = [
        p.whereTheyDisagree ? `Where they actually disagree: ${p.whereTheyDisagree}` : null,
        p.assessmentA ? `On ${d.party_a}: ${p.assessmentA}` : null,
        p.assessmentB ? `On ${d.party_b}: ${p.assessmentB}` : null,
        p.reasoning ? `Reasoning: ${p.reasoning}` : null,
        p.needsOwnerDecision ? 'HR judges this a values call — the owner must decide.' : null,
      ].filter(Boolean).join('\n\n');
      exec("UPDATE disputes SET state = 'recommended', recommendation = ?, reasoning = ? WHERE id = ?", p.recommendation, reasoning, d.id);
      notify({ level: 'warn', source: 'hr', message: `Dispute #${d.id} — HR has a recommendation. The final ruling is yours.`, subjectType: 'dispute', subjectId: d.id });
    } else {
      exec("UPDATE disputes SET state = 'recommended', recommendation = ?, reasoning = ? WHERE id = ?",
        'HR could not arbitrate this case.', run.failure_reason || run.state, d.id);
    }
  }
}

/**
 * Watch for disagreement the platform already detected and turn it into a case
 * automatically — a blocked review is a dispute whether or not anyone files it.
 */
export function ruleAutoDisputes() {
  const seen = (key) => one("SELECT id FROM disputes WHERE subject_type = 'run' AND subject_id = ?", key);
  for (const r of q(`SELECT * FROM runs WHERE state IN ('awaiting_human','done') AND output IS NOT NULL
                     AND agent_id IN ('AGT-REV-001','AGT-SEC-001') AND created_at >= datetime('now','-3 days') LIMIT 20`)) {
    let parsed;
    try { parsed = JSON.parse(openPii(r.output))?.parsed; } catch { continue; }
    const blocking = parsed && (parsed.verdict === 'block' || parsed.verdict === 'request-changes');
    if (!blocking || seen(r.id)) continue;
    const author = one("SELECT agent_id FROM runs WHERE pipeline_id = ? AND agent_id IN ('AGT-ENG-001','AGT-ARC-001') ORDER BY created_at DESC LIMIT 1", r.pipeline_id)?.agent_id;
    if (!author) continue;
    const findings = (parsed.findings || []).map((f) => `- [${f.severity}] ${f.claim}`).join('\n') || parsed.verdict;
    try {
      raiseDispute({
        title: `${r.agent_id} ${parsed.verdict === 'block' ? 'blocked' : 'requested changes on'} ${author}'s work`,
        subjectType: 'run', subjectId: r.id,
        partyA: r.agent_id, positionA: `Verdict: ${parsed.verdict}.\n${findings}`,
        partyB: author, positionB: 'The work was submitted as complete against the stated requirements.',
        context: `Raised automatically from run ${r.id}. Neither party has argued further; HR is asked to frame the disagreement.`,
        actor: 'system:hr',
      });
    } catch { /* skip */ }
  }
}

export function disputesOverview() {
  const all = listDisputes();
  return {
    total: all.length,
    arbitrating: all.filter((d) => d.state === 'arbitrating').length,
    awaitingOwner: all.filter((d) => d.state === 'recommended').length,
    ruled: all.filter((d) => d.state === 'ruled').length,
    disputes: all,
  };
}
