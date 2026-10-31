// The governance and enterprise floor.
//
// Each department here is mostly a set of rules about who may move a record
// and what it must carry when they do: a rule is published by a person and not
// straight from its author's draft, a clause is verified only with evidence, a
// nonconformity closes only when the action worked, a finding is never
// verified by its owner, an alert is reported only with the FIU's reference,
// and a payment message is approved by somebody other than who built it. Those
// are what is tested — plus the arithmetic that is easy to get quietly wrong:
// the journal tests, Benford, the IBAN checksum, the script breakdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-enterprise.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-enterprise-files/memory';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 23).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-enterprise.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-enterprise-files'), { recursive: true, force: true });

const { one, q, exec } = await import('../src/db.js');
const { seedAgents, leaseNext, executeRun } = await import('../src/workflow.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { ensurePlaybooks } = await import('../src/memory.js');
const { verifyChain } = await import('../src/audit.js');
const { PERMS } = await import('../src/auth.js');
const { sectionCatalog, SURFACES } = await import('../src/links.js');
const Policies = await import('../src/policies.js');
const Iso = await import('../src/iso.js');
const IA = await import('../src/internalaudit.js');
const Dtx = await import('../src/transformation.js');
const Prod = await import('../src/studio-production.js');
const Ops = await import('../src/opscenter.js');
const Strat = await import('../src/strategy.js');
const Ins = await import('../src/insurance.js');
const Aml = await import('../src/aml.js');
const { fold, similarity, screen } = await import('../src/screening.js');
const Remit = await import('../src/core2/remit.js');

seedAgents();
seedConnectors();
ensurePlaybooks();

const ALICE = 'human:alice';
const BOB = 'human:bob';
const AGENT = 'agent:AGT-POL-001';

async function drain() {
  for (let i = 0; i < 40; i++) {
    const run = leaseNext();
    if (!run) return;
    await executeRun(run);
  }
}

test('policies: a rule is published by a person, not straight from its author’s draft, and every version is kept', () => {
  const d = Policies.createDoc({ kind: 'policy', title: 'Information security policy', body: '## Purpose\nProtect information.', actor: ALICE });
  assert.equal(d.code, 'POL-001');
  assert.equal(d.state, 'draft');
  assert.equal(Policies.createDoc({ kind: 'policy', title: 'Acceptable use', actor: ALICE }).code, 'POL-002');

  assert.throws(() => Policies.setState({ id: d.id, state: 'published', actor: AGENT }), /person/);
  assert.throws(() => Policies.setState({ id: d.id, state: 'published', actor: ALICE }), /review first/);
  assert.throws(() => Policies.acknowledge({ id: d.id, user: { username: 'carol' } }), /published/);

  Policies.setState({ id: d.id, state: 'review', actor: AGENT });
  const pub = Policies.setState({ id: d.id, state: 'published', actor: BOB });
  assert.equal(pub.state, 'published');
  assert.equal(pub.approved_by, BOB);
  assert.ok(pub.next_review > new Date().toISOString().slice(0, 10));

  Policies.acknowledge({ id: d.id, user: { username: 'carol' } });
  Policies.acknowledge({ id: d.id, user: { username: 'carol' } });
  assert.equal(Policies.getDoc(d.id).acks.length, 1, 'acknowledging twice counts once');

  // Editing the rule in force starts version 2 as a draft; the text people read stays in the history.
  const v2 = Policies.editDoc({ id: d.id, body: '## Purpose\nProtect information and people.', actor: ALICE });
  assert.equal(v2.version, 2);
  assert.equal(v2.state, 'draft');
  assert.equal(v2.acks.length, 0, 'an acknowledgement belongs to the version that was read');
  const kept = q('SELECT version, note, body FROM pol_versions WHERE doc_id = ? ORDER BY id', d.id);
  assert.deepEqual(kept.map((v) => [v.version, v.note]), [[1, 'published'], [1, 'superseded']]);
  assert.match(kept[0].body, /Protect information\.$/);

  assert.throws(() => Policies.setState({ id: d.id, state: 'retired', actor: AGENT }), /person/);
  assert.equal(Policies.setState({ id: d.id, state: 'retired', actor: BOB }).state, 'retired');
  assert.throws(() => Policies.editDoc({ id: d.id, body: 'x', actor: ALICE }), /retired/);
});

test('policies: a process needs who does each step; a law can be published by the person who registered it', () => {
  assert.throws(() => Policies.createDoc({ kind: 'process', title: 'Purchase to pay', steps: [{ step: 'Raise a request' }], actor: ALICE }), /who does it/);
  const p = Policies.createDoc({ kind: 'process', title: 'Purchase to pay', steps: [{ step: 'Raise a request', role: 'Requester', control: 'Budget check' }], actor: ALICE });
  assert.equal(p.code, 'PRC-001');
  assert.equal(p.steps[0].role, 'Requester');
  const law = Policies.createDoc({ kind: 'law', title: 'Companies law', body: 'Article 1 …', actor: ALICE });
  assert.equal(law.code, 'LAW-001');
  assert.equal(Policies.setState({ id: law.id, state: 'published', actor: ALICE }).state, 'published');
  assert.throws(() => Policies.createDoc({ kind: 'memo', title: 'x', actor: ALICE }), /kind/);
});

test('drafts: the policy writer drafts, the draft comes back, and nothing is written into the rule', async () => {
  const d = Policies.createDoc({ kind: 'procedure', title: 'Onboarding a supplier', actor: ALICE });
  const job = Policies.draft({ id: d.id, instructions: 'include sanctions screening', actor: ALICE });
  assert.equal(job.state, 'thinking');
  const run = one('SELECT agent_id, task_type FROM runs WHERE id = ?', job.run_id);
  assert.equal(run.agent_id, 'AGT-POL-001');
  assert.equal(run.task_type, 'draft:policies:procedure');
  await drain();
  const back = Policies.getDoc(d.id);
  assert.equal(back.drafts[0].state, 'ready');
  assert.match(back.drafts[0].body.title, /procedure/);
  assert.equal(back.body, '', 'a person adopts a draft; the module never does');
});

test('iso: readiness counts implemented and verified clauses; verifying needs a person and evidence', () => {
  const ov = Iso.overview({ standard: 'ISO 9001' });
  assert.equal(ov.standards.length, 5);
  assert.ok(ov.clauses.length >= 20);
  assert.equal(ov.standards.find((s) => s.code === 'ISO 9001').readiness, 0);
  Iso.seedStandards();
  assert.equal(one("SELECT COUNT(*) AS n FROM iso_clauses WHERE standard = 'ISO 9001'").n, ov.clauses.length, 'seeding twice adds nothing');

  const [a, b, c] = ov.clauses;
  assert.throws(() => Iso.setClause({ id: a.id, status: 'verified', evidence: 'POL-001', actor: AGENT }), /person/);
  assert.throws(() => Iso.setClause({ id: a.id, status: 'verified', actor: ALICE }), /evidence/);
  Iso.setClause({ id: a.id, status: 'verified', evidence: 'POL-001 and the context register', actor: ALICE });
  Iso.setClause({ id: b.id, status: 'partial', actor: AGENT });
  Iso.setClause({ id: c.id, status: 'na', actor: ALICE });
  const r = Iso.readiness('ISO 9001');
  const applicable = ov.clauses.length - 1;
  assert.equal(r.readiness, Math.round((1.5 / applicable) * 100));
  assert.equal(r.verified, 1);
  assert.equal(r.gaps, applicable - 2);
});

test('iso: a nonconformity needs a root cause, a corrective action, and a person who says it worked', () => {
  const n = Iso.raiseNcr({ standard: 'ISO 9001', clauseRef: '8.7', description: 'Two shipments left without inspection', severity: 'major', actor: ALICE });
  assert.throws(() => Iso.advanceNcr({ id: n.id, to: 'verify', actor: ALICE }), /from open/);
  assert.throws(() => Iso.advanceNcr({ id: n.id, to: 'action', actor: ALICE }), /root cause/);
  Iso.advanceNcr({ id: n.id, to: 'action', rootCause: 'Inspector shift not covered on Fridays', actor: ALICE });
  assert.throws(() => Iso.advanceNcr({ id: n.id, to: 'verify', actor: ALICE }), /cannot happen again/);
  Iso.advanceNcr({ id: n.id, to: 'verify', correctiveAction: 'Release blocked in the system until inspection is recorded', actor: ALICE });
  assert.throws(() => Iso.advanceNcr({ id: n.id, to: 'closed', effective: true, actor: AGENT }), /person/);
  assert.throws(() => Iso.advanceNcr({ id: n.id, to: 'closed', effective: false, actor: BOB }), /effective/);
  const closed = Iso.advanceNcr({ id: n.id, to: 'closed', effective: true, actor: BOB });
  assert.equal(closed.state, 'closed');
  assert.equal(closed.verified_by, BOB);
  assert.throws(() => Iso.holdReview({ standard: 'ISO 9001', decisions: 'Fund a second inspector', actor: AGENT }), /people/);
  assert.throws(() => Iso.holdReview({ standard: 'ISO 9001', decisions: '', actor: ALICE }), /decisions/);
  Iso.holdReview({ standard: 'ISO 9001', attendees: 'CEO, QM', decisions: 'Fund a second inspector', actor: ALICE });
});

function postEntry({ ref, date, total, lines, by = 'human:clerk', postedBy = 'human:controller', source = 'manual' }) {
  const r = exec(`INSERT INTO journal (ref, entry_date, period, memo, source, total, state, created_by, posted_by, posted_at)
                  VALUES (?,?,?,?,?,?, 'posted', ?, ?, datetime('now'))`, ref, date, date.slice(0, 7), `test ${ref}`, source, total, by, postedBy);
  for (const [code, side, amount] of lines) {
    exec('INSERT INTO journal_lines (journal_id, account_code, side, amount) VALUES (?,?,?,?)', Number(r.lastInsertRowid), code, side, amount);
  }
}

test('internal audit: the journal tests find what they should, and nothing more', () => {
  // 2026-10-20 is a Tuesday; 2026-10-23 a Friday.
  postEntry({ ref: 'T-1', date: '2026-10-20', total: 100, lines: [['5100', 'debit', 100], ['1000', 'credit', 90]] });
  postEntry({ ref: 'T-2', date: '2026-10-20', total: 250, lines: [['5200', 'debit', 250], ['1000', 'credit', 250]] });
  postEntry({ ref: 'T-3', date: '2026-10-20', total: 250, lines: [['5200', 'debit', 250], ['1000', 'credit', 250]] });
  postEntry({ ref: 'T-4', date: '2026-10-23', total: 120, lines: [['5300', 'debit', 120], ['1000', 'credit', 120]] });
  postEntry({ ref: 'T-5', date: '2026-10-21', total: 4900, lines: [['5400', 'debit', 4900], ['1000', 'credit', 4900]] });
  postEntry({ ref: 'T-6', date: '2026-10-21', total: 3000, lines: [['5500', 'debit', 3000], ['1000', 'credit', 3000]] });
  postEntry({ ref: 'T-7', date: '2026-10-22', total: 130, by: 'human:clerk', postedBy: 'human:clerk', lines: [['5600', 'debit', 130], ['1000', 'credit', 130]] });
  // A Friday posting the system made is not a manual one.
  postEntry({ ref: 'T-8', date: '2026-10-23', total: 140, source: 'invoice', lines: [['1100', 'debit', 140], ['4000', 'credit', 140]] });

  const run = IA.runAnalytics({ from: '2026-10-19', to: '2026-10-25', limit: 5000, actor: ALICE });
  assert.equal(run.entries, 8);
  const refs = (k) => run.tests[k].map((x) => x.ref);
  assert.deepEqual(refs('unbalanced'), ['T-1']);
  assert.deepEqual(refs('duplicates'), ['T-3']);
  assert.deepEqual(refs('weekend'), ['T-4']);
  assert.deepEqual(refs('nearLimit'), ['T-5']);
  assert.deepEqual(refs('round'), ['T-6']);
  assert.deepEqual(refs('selfApproved'), ['T-7']);
  assert.match(run.benford.note, /fewer than 50/);
  assert.equal(run.exceptions, 6);

  const f = IA.raiseFromAnalytics({ runId: run.id, test: 'unbalanced', actor: ALICE });
  assert.equal(f.rating, 'high');
  assert.equal(f.source, 'analytics');
  assert.equal(JSON.parse(f.evidence)[0].ref, 'T-1');
  assert.throws(() => IA.raiseFromAnalytics({ runId: run.id, test: 'nothing', actor: ALICE }), /nothing to raise/);
});

test('internal audit: Benford flags amounts that all start with the same digit', () => {
  for (let i = 0; i < 60; i++) {
    const amount = 900 + i * 1.37;
    postEntry({ ref: `B-${i}`, date: '2026-09-01', total: amount, source: 'invoice', lines: [[`6${String(i).padStart(3, '0')}`, 'debit', amount], ['2000', 'credit', amount]] });
  }
  const run = IA.runAnalytics({ from: '2026-09-01', to: '2026-09-01', actor: ALICE });
  assert.equal(run.benford.n, 120);
  assert.equal(run.benford.conforms, false);
  assert.equal(run.benford.observed[8], 1, 'every first digit is 9');
});

test('internal audit: findings follow criteria and condition, the owner never verifies, and the chief auditor closes', () => {
  const ov = IA.overview();
  assert.ok(ov.entities > 50, 'the audit universe is seeded from the catalogue');
  assert.ok(ov.plan.length > 0);
  const e = IA.openEngagement({ entityId: ov.plan[0].id, title: 'Payables audit', kind: 'financial', actor: ALICE });
  assert.throws(() => IA.advanceEngagement({ id: e.id, to: 'reporting', actor: ALICE }), /comes fieldwork/);
  IA.advanceEngagement({ id: e.id, to: 'fieldwork', actor: ALICE });
  IA.advanceEngagement({ id: e.id, to: 'reporting', actor: ALICE });
  assert.throws(() => IA.advanceEngagement({ id: e.id, to: 'followup', actor: ALICE }), /opinion/);
  IA.advanceEngagement({ id: e.id, to: 'followup', opinion: 'needs_improvement', actor: ALICE });

  assert.throws(() => IA.addFinding({ engagementId: e.id, title: 'No three-way match', actor: ALICE }), /criteria/);
  const f = IA.addFinding({
    engagementId: e.id, title: 'No three-way match', criteria: 'POL-002 requires PO, receipt and invoice to agree', condition: '7 of 25 invoices paid without a receipt',
    owner: 'dana', actor: ALICE,
  });
  assert.throws(() => IA.advanceFinding({ id: f.id, to: 'in_progress', actor: ALICE }), /action plan/);
  IA.advanceFinding({ id: f.id, to: 'in_progress', actionPlan: 'Block payment until a receipt is posted — dana, 30 Nov', actor: ALICE });
  IA.advanceFinding({ id: f.id, to: 'implemented', actor: 'human:dana' });
  assert.throws(() => IA.advanceEngagement({ id: e.id, to: 'closed', actor: ALICE }), /not verified/);
  assert.throws(() => IA.advanceFinding({ id: f.id, to: 'verified', actor: 'human:dana' }), /owner/);
  assert.throws(() => IA.advanceFinding({ id: f.id, to: 'verified', actor: 'agent:AGT-AUD-001' }), /auditor/);
  IA.advanceFinding({ id: f.id, to: 'verified', actor: ALICE });
  assert.throws(() => IA.advanceEngagement({ id: e.id, to: 'closed', actor: 'agent:AGT-AUD-001' }), /chief auditor/);
  assert.equal(IA.advanceEngagement({ id: e.id, to: 'closed', actor: ALICE }).state, 'closed');
  assert.ok(one('SELECT last_audited FROM ia_entities WHERE id = ?', ov.plan[0].id).last_audited, 'closing an audit dates its area');
});

test('transformation: every dimension is scored 1–5, and the average is what is recorded', () => {
  assert.throws(() => Dtx.assess({ scores: { strategy: 2 }, actor: ALICE }), /customer/);
  assert.throws(() => Dtx.assess({ scores: { strategy: 6, customer: 1, operations: 1, technology: 1, data: 1, people: 1 }, actor: ALICE }), /strategy/);
  const a = Dtx.assess({ scores: { strategy: 2, customer: 3, operations: 2, technology: 4, data: 1, people: 3 }, actor: ALICE });
  assert.equal(a.overall, 2.5);
  const ov = Dtx.overview();
  assert.equal(ov.weakest, 'data');
});

test('production: the breakdown is read from the script, and delivery is signed off by a person into the archive', () => {
  const script = `Title: The launch

INT. OFFICE - DAY

LAYLA
We ship tonight.

OMAR (V.O.)
Then nobody sleeps.

EXT. ROOFTOP - NIGHT

LAYLA
Look at the city.

داخلي. مستودع - ليل

OMAR
Ready.`;
  const b = Prod.breakdown(script);
  assert.equal(b.scenes.length, 3);
  assert.deepEqual(b.locations, ['OFFICE', 'ROOFTOP', 'مستودع']);
  assert.equal(b.nightScenes, 2);
  assert.deepEqual(b.scenes.map((s) => s.interior), [true, false, true]);
  assert.deepEqual(b.characters.map((c) => [c.name, c.lines]), [['LAYLA', 2], ['OMAR', 2]]);
  assert.deepEqual(b.characters.find((c) => c.name === 'OMAR').scenes, [1, 3]);

  const p = Prod.createProduction({ title: 'The launch', kind: 'ad', budget: 20000, actor: ALICE });
  assert.throws(() => Prod.advance({ id: p.id, actor: ALICE }), /script/);
  Prod.saveScript({ id: p.id, script, actor: ALICE });
  for (let i = 0; i < 3; i++) Prod.advance({ id: p.id, actor: AGENT });
  assert.throws(() => Prod.advance({ id: p.id, actor: AGENT }), /person/);
  const done = Prod.advance({ id: p.id, spent: 18000, actor: ALICE });
  assert.equal(done.stage, 'delivered');
  const archived = one('SELECT * FROM archive_items WHERE id = ?', done.archive_id);
  assert.equal(archived.kind, 'production');
  assert.equal(JSON.parse(archived.snapshot).scenes, 3);
  assert.throws(() => Prod.advance({ id: p.id, actor: ALICE }), /already delivered/);
});

test('operations: a reading past the warning line opens one issue, not one per reading', () => {
  const k = Ops.addKpi({ name: 'On-time delivery', unit: '%', better: 'up', target: 95, warn: 90, owner: 'ops-lead', actor: ALICE });
  assert.throws(() => Ops.addKpi({ name: 'On-time delivery', target: 1, actor: ALICE }), /exists/);
  assert.equal(Ops.record({ kpiId: k.id, value: 96, actor: ALICE }).state, 'green');
  assert.equal(Ops.record({ kpiId: k.id, value: 92, actor: ALICE }).state, 'amber');
  assert.equal(one('SELECT COUNT(*) AS n FROM ops_issues WHERE kpi_id = ?', k.id).n, 0);
  assert.equal(Ops.record({ kpiId: k.id, value: 85, actor: ALICE }).state, 'red');
  assert.equal(Ops.record({ kpiId: k.id, value: 80, actor: ALICE }).state, 'red');
  const issues = q('SELECT * FROM ops_issues WHERE kpi_id = ?', k.id);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].owner, 'ops-lead');
  assert.equal(issues[0].created_by, 'system:opscenter', 'the system opened it, and says so');
  assert.throws(() => Ops.closeIssue({ id: issues[0].id, resolution: '', actor: ALICE }), /what was done/);
  Ops.closeIssue({ id: issues[0].id, resolution: 'Second carrier added', actor: ALICE });
  // Lower-is-better reads the other way round.
  assert.equal(Ops.rag({ better: 'down', target: 2, warn: 4 }, 3), 'amber');
  assert.equal(Ops.rag({ better: 'down', target: 2, warn: 4 }, 5), 'red');
});

test('strategy: an offer and a close are a person’s acts; implied value is EBITDA times the multiple', () => {
  const d = Strat.addDeal({ target: 'Acme Logistics', ebitda: 1_200_000, multiple: 6.5, actor: ALICE });
  assert.equal(Strat.impliedEv(d), 7_800_000);
  for (const stage of ['contact', 'nda', 'diligence']) Strat.moveDeal({ id: d.id, stage, actor: AGENT });
  assert.throws(() => Strat.moveDeal({ id: d.id, stage: 'offer', actor: AGENT }), /person/);
  Strat.moveDeal({ id: d.id, stage: 'offer', actor: ALICE });
});

test('insurance: a claim must fall inside the policy period, and a person submits it', () => {
  const p = Ins.addPolicy({ insurer: 'Gulf Insurance', line: 'cyber', coverage: 1_000_000, premium: 12_000, starts: '2026-01-01', ends: '2026-12-31', actor: ALICE });
  assert.throws(() => Ins.fileClaim({ policyId: p.id, incidentDate: '2025-12-30', description: 'Ransomware', actor: ALICE }), /outside the policy period/);
  const c = Ins.fileClaim({ policyId: p.id, incidentDate: '2026-06-01', description: 'Ransomware on the file server', claimed: 80_000, actor: ALICE });
  assert.throws(() => Ins.moveClaim({ id: c.id, to: 'settled', paid: 1, actor: ALICE }), /from open/);
  assert.throws(() => Ins.moveClaim({ id: c.id, to: 'submitted', actor: AGENT }), /person/);
  Ins.moveClaim({ id: c.id, to: 'submitted', actor: ALICE });
  assert.equal(Ins.moveClaim({ id: c.id, to: 'settled', paid: 70_000, actor: ALICE }).paid, 70_000);
  assert.ok(Ins.overview().uncovered.includes('property'), 'a line with no cover is named');
});

test('screening: names are folded across spelling, diacritics and honorifics before they are compared', () => {
  assert.equal(fold('  Dr. Aḥmad AL-Rashid '), 'ahmad rashid');
  assert.equal(fold('أحمد الرّاشد'), fold('احمد الراشد'));
  assert.ok(similarity('Ahmed Al-Rashid', 'Ahmad Al Rashid') >= 0.85);
  assert.equal(screen('Acme Trading LLC', [{ name: 'Ahmad Al Rashid' }]).length, 0);
  assert.equal(screen('شركة الراشد', [{ name: 'الراشد' }]).length, 1);
});

test('aml: risk is scored from recognised factors; an alert is reported only by a person, with the FIU’s reference', () => {
  const high = Aml.scoreParty({ pep: true, country: 'KP', channel: 'remote' });
  assert.equal(high.level, 'high');
  assert.equal(high.cdd, 'enhanced');
  assert.equal(high.reviewMonths, 12);
  assert.equal(Aml.scoreParty({ country: 'AE', channel: 'in_person' }).cdd, 'simplified');
  assert.equal(Aml.scoreParty({ channel: 'intermediary' }).level, 'medium');
  assert.deepEqual(Aml.scoreParty({ industry: 'Gold trading' }).factors, [{ points: 2, why: 'higher-risk industry', arg: 'Gold trading' }]);
  assert.equal(Aml.scoreParty({ industry: 'تجارة الذهب' }).score, 2, 'the industry is matched in Arabic too');
  assert.equal(Aml.scoreParty({ industry: 'Software' }).score, 0);

  const clean = Aml.addParty({ name: 'Nour Trading', country: 'AE', actor: ALICE });
  assert.equal(clean.hits.length, 0);
  assert.throws(() => Aml.addToWatchlist({ name: 'Nour Trading', actor: AGENT }), /person/);
  // Adding a name rescreens everybody already on the books.
  assert.equal(Aml.addToWatchlist({ name: 'Nour Trading Co', actor: ALICE }).alerts, 1);
  const flagged = Aml.addParty({ name: 'NOUR TRADING LLC', country: 'AE', actor: ALICE });
  assert.equal(flagged.hits.length, 1);

  const alert = one('SELECT * FROM aml_alerts WHERE party_id = ?', flagged.id);
  assert.throws(() => Aml.decideAlert({ id: alert.id, to: 'reported', note: 'x', reportRef: 'x', actor: ALICE }), /from open/);
  Aml.decideAlert({ id: alert.id, to: 'investigating', actor: AGENT });
  assert.throws(() => Aml.decideAlert({ id: alert.id, to: 'reported', note: 'Same director', reportRef: 'FIU-1', actor: AGENT }), /person/);
  assert.throws(() => Aml.decideAlert({ id: alert.id, to: 'reported', note: 'Same director', actor: ALICE }), /reference/);
  const done = Aml.decideAlert({ id: alert.id, to: 'reported', note: 'Same director and address', reportRef: 'FIU-2026-0042', actor: ALICE });
  assert.equal(done.state, 'reported');
  assert.equal(done.decided_by, ALICE);
});

test('remittances: IBAN and BIC are validated before anything is built', () => {
  assert.equal(Remit.validIban('GB82 WEST 1234 5698 7654 32'), true);
  assert.equal(Remit.validIban('DE89370400440532013000'), true);
  assert.equal(Remit.validIban('GB82WEST12345698765433'), false, 'one wrong digit fails the checksum');
  assert.equal(Remit.validIban('not an iban'), false);
  assert.equal(Remit.validBic('DEUTDEFF'), true);
  assert.equal(Remit.validBic('deutdeff500'), true);
  assert.equal(Remit.validBic('DEUT'), false);
  assert.throws(() => Remit.addBeneficiary({ name: 'Hans', iban: 'GB82WEST12345698765433', bic: 'DEUTDEFF', country: 'DE', actor: ALICE }), /checksum/);
  assert.throws(() => Remit.addBeneficiary({ name: 'Hans', iban: 'DE89370400440532013000', bic: 'DEUT', country: 'DE', actor: ALICE }), /BIC/);
});

test('remittances: a message is built from an approved external transfer, screened, approved by a second person, and released as a file', () => {
  const acct = exec("INSERT INTO bank_account (name, bank, currency, iban, gl_code, created_by) VALUES ('Operating', 'Rafidain', 'USD', 'IQ98NBIQ850123456789012', '1009', ?)", ALICE);
  const from = Number(acct.lastInsertRowid);
  const transfer = (state, amount = 12_500.5) => Number(exec("INSERT INTO bank_transfer (from_account_id, beneficiary, amount, state, approved_by, created_by) VALUES (?, 'Hans Muller GmbH', ?, ?, ?, ?)",
    from, amount, state, state === 'approved' ? BOB : null, ALICE).lastInsertRowid);
  const ben = Remit.addBeneficiary({ name: 'Hans Muller GmbH', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX', bankName: 'Commerzbank', country: 'DE', actor: ALICE });
  assert.equal(ben.iban, 'DE89370400440532013000');

  const draftT = transfer('draft');
  assert.throws(() => Remit.buildMessage({ transferId: draftT, beneficiaryId: ben.id, actor: ALICE }), /approved/);
  const t1 = transfer('approved');
  assert.throws(() => Remit.buildMessage({ transferId: t1, beneficiaryId: ben.id, actor: ALICE }), /REMIT_ORDERING_BIC/);
  assert.throws(() => Remit.setOrderingBic({ bic: 'RAFBIQBA', actor: 'agent:AGT-FIN-001' }), /human act/);
  assert.throws(() => Remit.setOrderingBic({ bic: 'RAFB', actor: ALICE }), /BIC/);
  assert.equal(Remit.setOrderingBic({ bic: 'rafbiqba', actor: ALICE }).orderingBic, 'RAFBIQBA');

  const m = Remit.buildMessage({ transferId: t1, beneficiaryId: ben.id, format: 'MT103', charges: 'SHA', remittanceInfo: 'INV-2026-118', valueDate: '2026-10-28', actor: ALICE });
  assert.equal(m.state, 'draft');
  assert.match(m.uetr, /^[0-9a-f-]{36}$/);
  assert.match(m.content, new RegExp(`\\{121:${m.uetr}\\}`));
  assert.match(m.content, /:32A:261028USD12500,50/);
  assert.match(m.content, /:59:\/DE89370400440532013000/);
  assert.match(m.content, /:71A:SHA/);
  assert.throws(() => Remit.buildMessage({ transferId: t1, beneficiaryId: ben.id, actor: ALICE }), /already has a message/);

  assert.throws(() => Remit.approveMessage(m.id, { actor: ALICE }), /four eyes/);
  assert.throws(() => Remit.approveMessage(m.id, { actor: 'agent:AGT-FIN-001' }), /human act/);
  Remit.approveMessage(m.id, { actor: BOB });
  assert.throws(() => Remit.releaseMessage(m.id, { actor: 'agent:AGT-FIN-001' }), /human act/);
  const out = Remit.releaseMessage(m.id, { actor: BOB });
  assert.equal(out.state, 'released');
  assert.equal(out.file.name, `mt103-${m.uetr}.txt`);
  assert.equal(out.file.content, m.content);
});

test('remittances: a screening hit holds the message until a person says why it is a different party', () => {
  const acctId = one("SELECT id FROM bank_account WHERE gl_code = '1009'").id;
  const t = Number(exec("INSERT INTO bank_transfer (from_account_id, beneficiary, amount, state, approved_by, created_by) VALUES (?, 'Ivan Petrov', 900, 'approved', ?, ?)", acctId, BOB, ALICE).lastInsertRowid);
  const ben = Remit.addBeneficiary({ name: 'Ivan Petrov <Ltd> & Sons', iban: 'GB82WEST12345698765432', bic: 'WESTGB2L', country: 'GB', actor: ALICE });
  assert.throws(() => Remit.addWatchName({ name: 'Ivan Petrov', actor: AGENT }), /human act/);
  Remit.addWatchName({ name: 'Ivan Petrov', source: 'internal', actor: ALICE });
  const m = Remit.buildMessage({ transferId: t, beneficiaryId: ben.id, format: 'pacs.008', charges: 'OUR', actor: ALICE });
  assert.equal(m.state, 'held');
  assert.equal(m.screening.hits[0].name, 'Ivan Petrov');
  assert.match(m.content, /<ChrgBr>DEBT<\/ChrgBr>/);
  assert.match(m.content, /Ivan Petrov &lt;Ltd&gt; &amp; Sons/, 'names are escaped inside the XML');
  assert.throws(() => Remit.approveMessage(m.id, { actor: BOB }), /clear it first/);
  assert.throws(() => Remit.clearHold(m.id, { note: '', actor: BOB }), /different party/);
  const cleared = Remit.clearHold(m.id, { note: 'Date of birth and passport differ from the listed person', actor: BOB });
  assert.equal(cleared.state, 'draft');
  assert.equal(cleared.screening.clearedBy, BOB);
  Remit.cancelMessage(m.id, { actor: ALICE });
  assert.equal(Remit.getMessage(m.id).state, 'cancelled');
});

test('the floor is wired: permissions, catalogue, one surface each, and an unbroken audit chain', () => {
  for (const p of ['policies.publish', 'iso.verify', 'ia.close', 'dtx.manage', 'production.manage', 'opscenter.manage', 'strategy.manage', 'insurance.manage', 'aml.decide', 'remit.release']) {
    assert.ok(PERMS.includes(p), `${p} is a permission`);
  }
  const ids = new Set(sectionCatalog().map((s) => s.id));
  const surfaceCount = (id) => SURFACES.filter((s) => s.departments.includes(id)).length;
  for (const id of ['policies', 'iso', 'internalaudit', 'transformation', 'production', 'opscenter', 'strategy', 'insurance', 'aml']) {
    assert.ok(ids.has(id), `${id} is in the catalogue`);
    assert.equal(surfaceCount(id), 1, `${id} sits in exactly one surface`);
  }
  assert.deepEqual(SURFACES.find((s) => s.id === 'assurance').departments, ['assurancemap', 'policies', 'iso', 'internalaudit', 'aml', 'insurance', 'insider']);
  const chain = verifyChain();
  assert.equal(chain.ok, true, JSON.stringify(chain));
});
