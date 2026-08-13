// Status and SLA — what the company admits, in public, while it is happening.
//
// The internal incident record already exists. What did not is the thing a
// customer refreshes at three in the morning, and the promise the contract made
// about how often this is allowed to happen.
//
// One rule shapes the whole module: a public notice is derived from a real
// incident, and closing the incident does not close the notice. Somebody has to
// say "resolved" out loud, because a status page that quietly goes green is
// worse than one that stays red — it teaches people not to believe it.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const clean = (s, n = 4000) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const STATES = ['operational', 'degraded', 'partial', 'major', 'maintenance'];
const NOTICE_STATES = ['investigating', 'identified', 'monitoring', 'resolved'];
const IMPACTS = ['none', 'minor', 'major', 'critical'];

const WORST = { operational: 0, maintenance: 1, degraded: 2, partial: 3, major: 4 };

export function seedComponents({ actor = 'system:status' } = {}) {
  const defaults = [
    ['Console', 'The operating console people sign in to'],
    ['API', 'Everything under /api'],
    ['Workforce', 'Agents picking up and finishing runs'],
    ['Outbound', 'Anything that leaves the machine, through the gate'],
  ];
  let made = 0;
  for (const [name, descr] of defaults) {
    if (one('SELECT id FROM status_components WHERE name = ?', name)) continue;
    exec('INSERT INTO status_components (name, descr) VALUES (?,?)', name, descr);
    made++;
  }
  return { made, total: one('SELECT COUNT(*) AS n FROM status_components').n };
}

export function setComponent({ name, state, objective = null, actor }) {
  if (!actor) refuse('a status change has to name who made it');
  if (!STATES.includes(state)) refuse(`state must be one of: ${STATES.join(', ')}`);
  const c = one('SELECT * FROM status_components WHERE name = ?', name);
  if (!c) refuse('no such component');
  exec("UPDATE status_components SET state = ?, objective = COALESCE(?, objective), updated_at = datetime('now') WHERE id = ?",
    state, clean(objective, 60) || null, c.id);
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'system', actorId: actor,
    action: 'status.component_set', subjectType: 'status_component', subjectId: c.id,
    payload: { name, from: c.state, to: state },
  });
  return one('SELECT * FROM status_components WHERE id = ?', c.id);
}

/**
 * Say something publicly about an outage.
 *
 * Deliberately a separate act from opening the incident. An incident is a note
 * to ourselves; this is a statement to customers, and the two have different
 * audiences, different wording and different consequences for getting it wrong.
 */
export function postNotice({ title, body, impact = 'minor', component = null, incidentId = null, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('telling customers the company is down is a human act');
  if (!IMPACTS.includes(impact)) refuse(`impact must be one of: ${IMPACTS.join(', ')}`);
  if (!title || !body) refuse('a notice with no body tells nobody anything');
  exec(`INSERT INTO status_notices (title, impact, body, component, incident_id, created_by)
        VALUES (?,?,?,?,?,?)`,
  clean(title, 200), impact, clean(body), clean(component, 60) || null, incidentId, actor);
  const nt = one('SELECT * FROM status_notices WHERE id = last_insert_rowid()');
  if (component && impact !== 'none') {
    const to = impact === 'critical' ? 'major' : impact === 'major' ? 'partial' : 'degraded';
    try { setComponent({ name: component, state: to, actor }); } catch { /* unknown component, notice still stands */ }
  }
  audit({
    actorType: 'human', actorId: actor, action: 'status.notice_posted',
    subjectType: 'status_notice', subjectId: nt.id, payload: { title, impact, component, incidentId },
  });
  return nt;
}

export function updateNotice({ id, state, body, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('a public update is a human act');
  if (!NOTICE_STATES.includes(state)) refuse(`state must be one of: ${NOTICE_STATES.join(', ')}`);
  const nt = one('SELECT * FROM status_notices WHERE id = ?', id);
  if (!nt) refuse('no such notice');
  exec(`UPDATE status_notices SET state = ?, body = ?, resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE resolved_at END
        WHERE id = ?`, state, clean(`${nt.body}\n\n— ${new Date().toISOString().slice(0, 16).replace('T', ' ')} —\n${clean(body)}`), state, id);
  if (state === 'resolved' && nt.component) {
    try { setComponent({ name: nt.component, state: 'operational', actor }); } catch { /* component gone */ }
  }
  audit({
    actorType: 'human', actorId: actor, action: 'status.notice_updated',
    subjectType: 'status_notice', subjectId: id, payload: { from: nt.state, to: state },
  });
  return one('SELECT * FROM status_notices WHERE id = ?', id);
}

/** Incidents that are open and have never been mentioned publicly. */
export function unannounced() {
  try {
    return q(`SELECT i.id, i.title, i.sev, i.created_at FROM incidents i
               WHERE i.state <> 'closed'
                 AND NOT EXISTS (SELECT 1 FROM status_notices n WHERE n.incident_id = i.id)
               ORDER BY i.id DESC LIMIT 20`);
  } catch { return []; }
}

export function addTerm({ name, targetPct = 99.9, windowDays = 30, creditPct = 0, appliesTo = null, objective = null, note = null, actor }) {
  if (!actor) refuse('a promise has to name who made it');
  if (!name) refuse('an SLA needs a name');
  if (targetPct <= 0 || targetPct > 100) refuse('a target is a percentage');
  exec(`INSERT INTO sla_terms (name, target_pct, window_days, credit_pct, applies_to, objective, note, created_by)
        VALUES (?,?,?,?,?,?,?,?)`,
  clean(name, 120), Number(targetPct), Number(windowDays) || 30, Number(creditPct) || 0,
  clean(appliesTo, 120) || null, clean(objective, 60) || null, clean(note, 600) || null, actor);
  const t = one('SELECT * FROM sla_terms WHERE id = last_insert_rowid()');
  audit({
    actorType: 'human', actorId: actor, action: 'status.sla_added',
    subjectType: 'sla_term', subjectId: t.id, payload: { name, targetPct, windowDays, creditPct },
  });
  return t;
}

/**
 * Measured against the watchtower, which is already keeping the number.
 *
 * A promise measured by the department that made it is not measured.
 */
export function slaStanding() {
  const out = [];
  for (const t of q('SELECT * FROM sla_terms ORDER BY id')) {
    let live = null;
    let breached = null;
    if (t.objective) {
      try {
        const o = one('SELECT * FROM objectives WHERE key = ? OR name = ?', t.objective, t.objective);
        if (o) { live = o.value; breached = o.state === 'breached'; }
      } catch { /* watchtower not installed */ }
    }
    out.push({ ...t, live, breached, measuredBy: t.objective ? 'watchtower' : 'nothing yet' });
  }
  return out;
}

/** What the public sees. No internal identifiers, no severities we use in-house. */
export function publicView() {
  const components = q('SELECT name, descr, state, updated_at FROM status_components ORDER BY name');
  const worst = components.reduce((w, c) => Math.max(w, WORST[c.state] ?? 0), 0);
  return {
    overall: Object.keys(WORST).find((k) => WORST[k] === worst) || 'operational',
    components,
    notices: q(`SELECT title, impact, state, body, component, started_at, resolved_at
                  FROM status_notices ORDER BY id DESC LIMIT 20`),
    sla: q('SELECT name, target_pct, window_days, credit_pct, applies_to FROM sla_terms ORDER BY id'),
  };
}

export function overview() {
  return {
    ...publicView(),
    unannounced: unannounced(),
    standing: slaStanding(),
    states: STATES,
    impacts: IMPACTS,
    noticeStates: NOTICE_STATES,
    note: 'Closing an incident does not close a notice. Somebody says "resolved" in public, because a page that '
      + 'quietly goes green teaches people not to read it.',
  };
}
