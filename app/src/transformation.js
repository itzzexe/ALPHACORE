// Digital transformation — where the company stands, what it is changing,
// and whether the change paid.
//
// A maturity assessment over six dimensions, scored 1–5 against written
// levels so two people scoring the same company land near each other; an
// initiative portfolio ranked by value against effort; and each initiative
// carries a KPI with a baseline, so "live" is followed by "and did it move".
// The weakest dimension is what the roadmap should lean on, and the page
// says which one it is.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { requestDraft, draftsFor } from './drafts.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 1000) => String(s ?? '').trim().slice(0, n);

export const DIMENSIONS = {
  strategy: ['No digital agenda', 'Isolated projects', 'A written digital strategy', 'Strategy funded and governed', 'Digital is how the company competes'],
  customer: ['Paper and phone', 'Some online channels', 'Consistent digital journeys', 'Personalised, measured journeys', 'Customers self-serve end to end'],
  operations: ['Manual and spreadsheet-run', 'Some systems, many re-keys', 'Core processes digitised', 'Processes integrated and measured', 'Automated, exceptions-only'],
  technology: ['Ad-hoc tools', 'Core systems, unintegrated', 'Integrated platform', 'Cloud and APIs by default', 'Platform others build on'],
  data: ['Data in silos', 'Reports by hand', 'One source of truth', 'Decisions made from dashboards', 'Predictive and AI-assisted'],
  people: ['Digital skills rare', 'A few champions', 'Training programme in place', 'Skills measured and hired for', 'Digital-first culture'],
};
const STAGES = ['idea', 'approved', 'in_progress', 'live', 'retired'];

export function assess({ scores, notes = '', actor }) {
  if (!scores || typeof scores !== 'object') refuse('score each dimension 1–5');
  const clean6 = {};
  for (const d of Object.keys(DIMENSIONS)) {
    const v = Number(scores[d]);
    if (!(Number.isInteger(v) && v >= 1 && v <= 5)) refuse(`${d} needs a score from 1 to 5`);
    clean6[d] = v;
  }
  const overall = Math.round((Object.values(clean6).reduce((a, b) => a + b, 0) / 6) * 10) / 10;
  const r = exec('INSERT INTO dtx_assessments (scores, overall, notes, created_by) VALUES (?,?,?,?)', JSON.stringify(clean6), overall, clean(notes), actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'transformation.assessed', subjectType: 'dtx_assessment', subjectId: Number(r.lastInsertRowid), payload: { overall } });
  return { id: Number(r.lastInsertRowid), overall, scores: clean6 };
}

export function addInitiative({ title, dimension, problem = '', outcome = '', value = 3, effort = 3, owner = null, quarter = null, kpi = null, baseline = null, target = null, actor }) {
  if (!clean(title, 200)) refuse('an initiative has a title');
  if (!DIMENSIONS[dimension]) refuse(`dimension must be one of: ${Object.keys(DIMENSIONS).join(', ')}`);
  const v = Math.min(5, Math.max(1, Number(value) || 3)); const e = Math.min(5, Math.max(1, Number(effort) || 3));
  const r = exec(`INSERT INTO dtx_initiatives (title, dimension, problem, outcome, value, effort, owner, quarter, kpi, baseline, target, current, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, clean(title, 200), dimension, clean(problem), clean(outcome), v, e, clean(owner, 80) || null,
  clean(quarter, 10) || null, clean(kpi, 120) || null, baseline == null ? null : Number(baseline), target == null ? null : Number(target), baseline == null ? null : Number(baseline), actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'transformation.initiative', subjectType: 'dtx_initiative', subjectId: Number(r.lastInsertRowid), payload: { title, dimension } });
  return one('SELECT * FROM dtx_initiatives WHERE id = ?', Number(r.lastInsertRowid));
}

export function updateInitiative({ id, stage = null, current = null, actor }) {
  const i = one('SELECT * FROM dtx_initiatives WHERE id = ?', Number(id));
  if (!i) refuse('no such initiative', 404);
  if (stage && !STAGES.includes(stage)) refuse(`stage must be one of: ${STAGES.join(', ')}`);
  // Funding a change is a decision, not a status update.
  if (stage === 'approved' && !isHuman(actor)) refuse('approving an initiative is a person’s act', 403);
  exec('UPDATE dtx_initiatives SET stage = COALESCE(?, stage), current = COALESCE(?, current) WHERE id = ?', stage, current == null ? null : Number(current), i.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'transformation.updated', subjectType: 'dtx_initiative', subjectId: i.id, payload: { stage, current } });
  return one('SELECT * FROM dtx_initiatives WHERE id = ?', i.id);
}

/** How far the KPI has moved from its baseline towards its target, 0–100. */
const progress = (i) => (i.baseline == null || i.target == null || i.current == null || i.target === i.baseline
  ? null : Math.round(Math.max(0, Math.min(1, (i.current - i.baseline) / (i.target - i.baseline))) * 100));

export function roadmap({ actor, lang = 'ar' }) {
  const last = one('SELECT * FROM dtx_assessments ORDER BY id DESC LIMIT 1');
  const inits = q("SELECT title, dimension, value, effort, stage FROM dtx_initiatives WHERE stage <> 'retired'");
  const brief = `A twelve-month digital transformation roadmap by quarter. Current maturity: ${last ? last.scores : '[not assessed — TO CONFIRM]'}.
Initiatives already proposed: ${inits.map((x) => `${x.title} (${x.dimension}, value ${x.value}, effort ${x.effort}, ${x.stage})`).join('; ') || 'none'}.
Lean on the weakest dimension, sequence quick wins first, name the dependency between initiatives, and give one KPI per quarter. Put each quarter in "items" as {quarter, initiatives, kpi}.`;
  return requestDraft({ dept: 'transformation', subjectType: 'dtx', subjectId: 'roadmap', kind: 'roadmap', agentId: 'AGT-DTX-001', brief, lang, actor });
}

export function overview() {
  const last = one('SELECT * FROM dtx_assessments ORDER BY id DESC LIMIT 1');
  const scores = last ? JSON.parse(last.scores) : null;
  const inits = q("SELECT * FROM dtx_initiatives ORDER BY CASE stage WHEN 'retired' THEN 1 ELSE 0 END, (value * 1.0 / effort) DESC, id").map((i) => ({
    ...i, priority: Math.round((i.value / i.effort) * 100) / 100, quadrant: i.value >= 4 && i.effort <= 2 ? 'quick win' : i.value >= 4 ? 'major project' : i.effort <= 2 ? 'fill-in' : 'reconsider', progress: progress(i),
  }));
  return {
    dimensions: Object.entries(DIMENSIONS).map(([id, levels]) => ({ id, levels, score: scores?.[id] ?? null })),
    overall: last?.overall ?? null,
    weakest: scores ? Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0] : null,
    history: q('SELECT id, overall, created_at FROM dtx_assessments ORDER BY id DESC LIMIT 8'),
    initiatives: inits,
    byStage: Object.fromEntries(STAGES.map((s) => [s, inits.filter((i) => i.stage === s).length])),
    drafts: draftsFor('transformation', 'dtx', 'roadmap', 3),
  };
}
