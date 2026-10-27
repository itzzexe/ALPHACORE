// The operations center — whether the company's processes are performing,
// read from numbers rather than from status meetings.
//
// A KPI belongs to a process (a published one, from the policies library) and
// has a target and a warning line; every reading is kept, so the trend is on
// the page and not in somebody's memory. A reading that crosses the warning
// line opens an issue with an owner, once, and the issue closes with what was
// done about it.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);

export function addKpi({ name, processId = null, unit = '', better = 'up', target, warn = null, owner = null, actor }) {
  if (!clean(name, 120)) refuse('a KPI has a name');
  if (!['up', 'down'].includes(better)) refuse('better is up or down');
  if (!Number.isFinite(Number(target))) refuse('a KPI has a numeric target');
  if (processId && !one('SELECT id FROM pol_docs WHERE id = ?', Number(processId))) refuse('no such process');
  if (one('SELECT id FROM ops_kpis WHERE name = ?', clean(name, 120))) refuse('a KPI with that name exists', 409);
  const r = exec('INSERT INTO ops_kpis (name, process_id, unit, better, target, warn, owner, created_by) VALUES (?,?,?,?,?,?,?,?)',
    clean(name, 120), processId ? Number(processId) : null, clean(unit, 20), better, Number(target), warn == null || warn === '' ? null : Number(warn), clean(owner, 80) || null, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'opscenter.kpi', subjectType: 'ops_kpi', subjectId: Number(r.lastInsertRowid), payload: { name, target } });
  return one('SELECT * FROM ops_kpis WHERE id = ?', Number(r.lastInsertRowid));
}

/** Red past the warning line, amber short of target, green at or past it. */
export function rag(k, value) {
  if (value == null) return 'none';
  const good = k.better === 'up' ? value >= k.target : value <= k.target;
  if (good) return 'green';
  if (k.warn == null) return 'amber';
  const bad = k.better === 'up' ? value < k.warn : value > k.warn;
  return bad ? 'red' : 'amber';
}

export function record({ kpiId, value, note = '', actor }) {
  const k = one('SELECT * FROM ops_kpis WHERE id = ?', Number(kpiId));
  if (!k) refuse('no such KPI', 404);
  const v = Number(value);
  if (!Number.isFinite(v)) refuse('a reading is a number');
  exec('INSERT INTO ops_readings (kpi_id, value, note, created_by) VALUES (?,?,?,?)', k.id, v, clean(note), actor);
  const state = rag(k, v);
  if (state === 'red' && !one("SELECT id FROM ops_issues WHERE kpi_id = ? AND state = 'open'", k.id)) {
    const r = exec('INSERT INTO ops_issues (title, kpi_id, severity, owner, created_by) VALUES (?,?,?,?,?)',
      `${k.name} is ${v}${k.unit || ''} against a target of ${k.target}${k.unit || ''}`, k.id, 'high', k.owner, 'system:opscenter');
    notify({ level: 'warn', source: 'opscenter', message: `${k.name} crossed its warning line: ${v}${k.unit || ''}`, subjectType: 'ops_issue', subjectId: Number(r.lastInsertRowid) });
  }
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'opscenter.reading', subjectType: 'ops_kpi', subjectId: k.id, payload: { value: v, state } });
  return { value: v, state };
}

export function addIssue({ title, kpiId = null, severity = 'medium', owner = null, due = null, actor }) {
  if (!clean(title, 200)) refuse('an issue has a title');
  const r = exec('INSERT INTO ops_issues (title, kpi_id, severity, owner, due, created_by) VALUES (?,?,?,?,?,?)',
    clean(title, 200), kpiId ? Number(kpiId) : null, ['high', 'medium', 'low'].includes(severity) ? severity : 'medium', clean(owner, 80) || null, due, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'opscenter.issue', subjectType: 'ops_issue', subjectId: Number(r.lastInsertRowid) });
  return one('SELECT * FROM ops_issues WHERE id = ?', Number(r.lastInsertRowid));
}

export function closeIssue({ id, resolution, actor }) {
  const i = one("SELECT * FROM ops_issues WHERE id = ? AND state = 'open'", Number(id));
  if (!i) refuse('no such open issue', 404);
  if (!clean(resolution)) refuse('say what was done about it');
  exec("UPDATE ops_issues SET state = 'closed', resolution = ?, closed_at = datetime('now') WHERE id = ?", clean(resolution, 2000), i.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'opscenter.issue_closed', subjectType: 'ops_issue', subjectId: i.id });
  return one('SELECT * FROM ops_issues WHERE id = ?', i.id);
}

export function overview() {
  const kpis = q('SELECT k.*, d.code AS process_code, d.title AS process_title FROM ops_kpis k LEFT JOIN pol_docs d ON d.id = k.process_id ORDER BY k.name').map((k) => {
    const readings = q('SELECT value, created_at FROM ops_readings WHERE kpi_id = ? ORDER BY id DESC LIMIT 30', k.id).reverse();
    const lastV = readings.length ? readings[readings.length - 1].value : null;
    return { ...k, readings, last: lastV, state: rag(k, lastV) };
  });
  return {
    kpis,
    rag: { green: kpis.filter((k) => k.state === 'green').length, amber: kpis.filter((k) => k.state === 'amber').length, red: kpis.filter((k) => k.state === 'red').length, none: kpis.filter((k) => k.state === 'none').length },
    issues: q("SELECT * FROM ops_issues ORDER BY CASE state WHEN 'open' THEN 0 ELSE 1 END, id DESC LIMIT 50"),
    processes: q("SELECT id, code, title FROM pol_docs WHERE kind IN ('process','procedure') AND state <> 'retired' ORDER BY code"),
  };
}
