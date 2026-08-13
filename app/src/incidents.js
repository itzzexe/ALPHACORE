// Incident management (Part 5 §6). A human commands, always. SEV1 declarations
// raise a critical notification; closing a SEV1/SEV2 requires a postmortem —
// a skipped review is itself a policy violation the immune system would flag.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { createPipeline } from './pipelines.js';

const TRANSITIONS = { open: ['mitigated', 'resolved'], mitigated: ['resolved', 'open'], resolved: ['closed', 'open'], closed: [] };

export function declareIncident({ sev, title, commander, productId = null, note = '', actor }) {
  if (!['SEV1', 'SEV2', 'SEV3', 'SEV4'].includes(sev)) throw new Error('sev must be SEV1..SEV4');
  if (!title?.trim() || !commander?.trim()) throw new Error('title and commander required');
  const timeline = [{ t: new Date().toISOString(), who: actor, note: note || 'Incident declared.' }];
  exec('INSERT INTO incidents (sev, title, commander, product_id, timeline) VALUES (?,?,?,?,?)',
    sev, title.trim(), commander.trim(), productId, JSON.stringify(timeline));
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'incident.declared', subjectType: 'incident', subjectId: id, payload: { sev, title } });
  if (sev === 'SEV1' || sev === 'SEV2') {
    notify({ level: 'crit', source: 'incident', message: `${sev} declared: ${title} — commander ${commander}`, subjectType: 'incident', subjectId: id });
  }
  return getIncident(id);
}

export function getIncident(id) {
  const r = one('SELECT * FROM incidents WHERE id = ?', id);
  return r ? { ...r, timeline: JSON.parse(r.timeline) } : null;
}

export function listIncidents() {
  return q('SELECT id FROM incidents ORDER BY id DESC LIMIT 100').map((r) => getIncident(r.id));
}

export function addIncidentUpdate(id, { note, actor }) {
  const inc = getIncident(id);
  if (!inc) throw new Error('incident not found');
  if (inc.state === 'closed') throw new Error('incident is closed');
  if (!note?.trim()) throw new Error('note required');
  inc.timeline.push({ t: new Date().toISOString(), who: actor, note: note.trim() });
  exec('UPDATE incidents SET timeline = ? WHERE id = ?', JSON.stringify(inc.timeline), id);
  audit({ actorType: 'human', actorId: actor, action: 'incident.update', subjectType: 'incident', subjectId: id });
  return getIncident(id);
}

/** Cross-link: spawn the incident-postmortem pipeline from this incident. */
export function startPostmortemPipeline(id, actor) {
  const inc = getIncident(id);
  if (!inc) throw new Error('incident not found');
  if (inc.postmortem_pipeline_id) throw new Error('postmortem pipeline already exists');
  const goal = `${inc.sev} incident #${inc.id}: ${inc.title}\nCommander: ${inc.commander}\nTimeline:\n` +
    inc.timeline.map((t) => `${t.t} ${t.who}: ${t.note}`).join('\n');
  const p = createPipeline({ template: 'incident-postmortem', goal, productId: inc.product_id || null, actor });
  exec('UPDATE incidents SET postmortem_pipeline_id = ? WHERE id = ?', p.id, id);
  audit({ actorType: 'human', actorId: actor, action: 'incident.postmortem_pipeline', subjectType: 'incident', subjectId: id, payload: { pipelineId: p.id } });
  return getIncident(id);
}

export function setIncidentState(id, { state, postmortem = null, actor }) {
  const inc = getIncident(id);
  if (!inc) throw new Error('incident not found');
  if (!TRANSITIONS[inc.state]?.includes(state)) throw new Error(`cannot go ${inc.state} → ${state}`);
  if (state === 'closed' && ['SEV1', 'SEV2'].includes(inc.sev) && !(postmortem?.trim() || inc.postmortem)) {
    throw new Error(`${inc.sev} cannot close without a postmortem (blameless; ≤5 business days)`);
  }
  inc.timeline.push({ t: new Date().toISOString(), who: actor, note: `State → ${state}.` });
  exec(
    `UPDATE incidents SET state = ?, timeline = ?, postmortem = COALESCE(?, postmortem),
     resolved_at = CASE WHEN ? IN ('resolved','closed') AND resolved_at IS NULL THEN datetime('now') ELSE resolved_at END
     WHERE id = ?`,
    state, JSON.stringify(inc.timeline), postmortem?.trim() || null, state, id,
  );
  audit({ actorType: 'human', actorId: actor, action: `incident.${state}`, subjectType: 'incident', subjectId: id });
  return getIncident(id);
}
