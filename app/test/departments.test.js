// The departments a company discovers it needed after somebody audited it.
//
// Most of what matters in these is what they refuse. Anything can write a row
// into a tax table; what makes one worth keeping is that it will not invent a
// rate, will not let an employee file a return, and will not let a data flow
// nobody assessed start carrying people's details to another country.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-departments.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-departments.db${s}`)); } catch { /* first run */ }
}

const TAX = await import('../src/tax.js');
const PRIV = await import('../src/privacy.js');
const IP = await import('../src/ip.js');
const HELP = await import('../src/helpcentre.js');
const GOV = await import('../src/datagov.js');
const TRUST = await import('../src/trustcentre.js');
const STATUS = await import('../src/statuspage.js');
const GROWTH = await import('../src/growth.js');
const PART = await import('../src/partnerships.js');
const E = await import('../src/erasure.js');
const { one, exec } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');
const { seedChart } = await import('../src/ledger.js');

// Tax posts into the real books, so the real chart has to exist. Seeding it
// here rather than mocking it is the point: an entry against an account that
// does not exist should fail, and it does.
seedChart();

const HUMAN = 'human:owner';

// ------------------------------------------------------------------- tax --

test('tax refuses to invent a rate for a jurisdiction nobody recorded', () => {
  const c = TAX.classify({ jurisdiction: 'ZZ', basis: 1000 });
  assert.equal(c.treatment, null);
  assert.equal(c.amount, 0);
  assert.equal(c.needsPerson, true);
  assert.match(c.reason, /not on file/);
});

test('a rate on file is applied, and the sentence explaining it is kept', () => {
  TAX.addJurisdiction({ code: 'iq', name: 'Iraq', kind: 'vat', rate: 15, registered: 1, actor: HUMAN });
  const c = TAX.classify({ jurisdiction: 'IQ', basis: 200 });
  assert.equal(c.treatment, 'collected');
  assert.equal(c.amount, 30);
  assert.match(c.reason, /Iraq VAT at 15%/);
});

test('registered nowhere is out of scope, not zero-rated by accident', () => {
  TAX.addJurisdiction({ code: 'GB', name: 'United Kingdom', kind: 'vat', rate: 20, registered: 0, thresholdUsd: 90000, actor: HUMAN });
  const c = TAX.classify({ jurisdiction: 'GB', basis: 5000 });
  assert.equal(c.treatment, 'out_of_scope');
  assert.match(c.reason, /not registered/);
  assert.equal(c.needsPerson, true, 'a threshold exists, so somebody should be watching it');
});

test('tax collected lands in the real books as a liability, never as revenue', () => {
  const r = TAX.recordLine({ sourceKind: 'invoice', sourceId: '9001', jurisdiction: 'IQ', basis: 200, actor: HUMAN });
  assert.ok(r.entryId, 'it produced a journal entry');
  const lines = one(`SELECT COUNT(*) AS n FROM journal_lines
                      WHERE journal_id = ? AND account_code = '2200' AND side = 'credit'`, r.entryId);
  assert.ok(lines.n >= 1, 'credited to tax payable — money held for somebody else');
  const revenue = one(`SELECT COUNT(*) AS n FROM journal_lines
                        WHERE journal_id = ? AND account_code LIKE '4%'`, r.entryId);
  assert.equal(revenue.n, 0, 'booking tax as income is how a company looks profitable until the return is due');
});

test('the same event cannot be taxed twice', () => {
  const again = TAX.recordLine({ sourceKind: 'invoice', sourceId: '9001', jurisdiction: 'IQ', basis: 200, actor: HUMAN });
  assert.equal(again.alreadyRecorded, true);
});

test('an employee may not file a return, at any amount', () => {
  const ret = TAX.buildReturn({ jurisdiction: 'IQ', periodStart: '2000-01-01', periodEnd: '2100-01-01', actor: HUMAN });
  assert.throws(() => TAX.fileReturn({ id: ret.id, actor: 'agent:AGT-TAX-001' }), /person/);
  const filed = TAX.fileReturn({ id: ret.id, actor: HUMAN });
  assert.equal(filed.state, 'filed');
});

// --------------------------------------------------------------- privacy --

test('a privacy request never stores the identifier it was made with', () => {
  const req = PRIV.logRequest({ kind: 'access', identifier: 'karim@example.com', actor: HUMAN });
  assert.equal(req.subject_ref, E.refFor('contact', 'karim@example.com'));
  assert.ok(!JSON.stringify(req).includes('karim@example.com'),
    'a table of who asked to be forgotten is a table of people, kept');
  const entry = one("SELECT payload FROM audit_log WHERE action = 'privacy.request_logged' ORDER BY seq DESC LIMIT 1");
  assert.ok(!entry.payload.includes('karim@example.com'), 'and the permanent record must not carry it either');
});

test('answering an access request needs the address again, because the reference is one-way', () => {
  const req = PRIV.logRequest({ kind: 'access', identifier: 'karim@example.com', actor: HUMAN });
  assert.throws(() => PRIV.buildExport({ id: req.id, identifier: 'someone.else@example.com', actor: HUMAN }), /does not match/);
  const exp = PRIV.buildExport({ id: req.id, identifier: 'karim@example.com', actor: HUMAN });
  assert.equal(exp.state, 'built');
  assert.ok(fs.existsSync(exp.file_ref), 'a copy that does not exist is not portability');
});

test('an erasure request is carried out, not noted', () => {
  exec("INSERT INTO intel_records (query_id, name, email) VALUES (1, 'Karim Ltd', ?)", 'karim@example.com');
  const req = PRIV.logRequest({ kind: 'erasure', identifier: 'karim@example.com', actor: HUMAN });
  const r = PRIV.answerRequest({ id: req.id, identifier: 'karim@example.com', outcome: 'erased', actor: HUMAN });
  assert.ok(r.erasure?.ok);
  const row = one("SELECT email FROM intel_records WHERE name = 'Karim Ltd'");
  assert.equal(E.openPii(row.email), '[erased]');
  assert.equal(verifyChain().ok, true, 'and the chain still verifies');
});

test('risk is derived from the facts, not typed by whoever wants approval', () => {
  const f = PRIV.proposeFlow({
    name: 'Ship transcripts abroad', purpose: 'analysis', lawfulBasis: 'legitimate_interest',
    categories: 'call transcripts, health mentions', subjects: 'customers',
    crossesBorder: 1, retentionDays: 0, actor: HUMAN,
  });
  assert.equal(f.risk, 'high');
  assert.throws(() => PRIV.decideFlow({
    id: f.id, verdict: 'approved', assessment: 'looks fine to me, nothing to worry about', actor: 'agent:AGT-DPO-001',
  }), /decided by a person/);
});

test('an assessment that says nothing is refused', () => {
  const f = PRIV.proposeFlow({
    name: 'Newsletter', purpose: 'send updates people asked for', lawfulBasis: 'consent',
    categories: 'email', subjects: 'subscribers', retentionDays: 365, actor: HUMAN,
  });
  assert.throws(() => PRIV.decideFlow({ id: f.id, verdict: 'approved', assessment: 'ok', actor: HUMAN }), /rubber stamp/);
});

// ------------------------------------------------------- data governance --

test('the inventory is discovered from the schema, and finds what erasure cannot reach', () => {
  GOV.seedClasses({});
  const r = GOV.rebuild({});
  assert.ok(r.columns > 100, 'it walked the real schema');
  assert.ok(r.personal > 0, 'and proposed the obvious ones');
  const gaps = GOV.unerasablePersonal();
  assert.ok(Array.isArray(gaps));
  // The point of the department: the two modules disagree, and somebody is told.
  const reachable = GOV.coverage();
  assert.equal(reachable.personal, reachable.erasable + reachable.gap);
});

test('classifying data is a judgement and carries a name', () => {
  assert.throws(() => GOV.classifyColumn({
    table: 'customers', column: 'name', className: 'personal', personal: 1, actor: 'agent:AGT-DPO-001',
  }), /carries a name/);
});

// ----------------------------------------------------------- help centre --

test('a question asked three times becomes one gap with a count, not three tickets', () => {
  for (const n of [1, 2, 3]) {
    exec("INSERT INTO tickets (customer, category, subject, body) VALUES (?,?,?,?)",
      `person${n}@example.com`, 'billing', 'How do I change my plan?', 'please help');
  }
  HELP.sweepTickets();
  const gap = one("SELECT * FROM help_gaps WHERE question LIKE 'How do I change my plan%'");
  assert.equal(gap.seen, 3, 'the same question three ways is one gap');
});

test('an article reaches a customer only when a person signs it', () => {
  const a = HELP.write({ title: 'Changing your plan', body: 'Open Settings, then Plan.', actor: 'agent:AGT-DOC-001' });
  assert.equal(a.state, 'draft');
  assert.throws(() => HELP.publish({ id: a.id, actor: 'agent:AGT-DOC-001' }), /published by a person/);
  assert.equal(HELP.publish({ id: a.id, actor: HUMAN }).state, 'published');
  assert.equal(HELP.publicIndex().length, 1);
});

// -------------------------------------------------------------------- ip --

test('what lapses soon is the only question this department answers in time', () => {
  IP.register({
    name: 'AlphaCore', kind: 'trademark', jurisdiction: 'IQ', owner: 'the company',
    state: 'registered', renewalAt: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), actor: HUMAN,
  });
  IP.register({
    name: 'Something old', kind: 'trademark', owner: 'the company', state: 'registered',
    renewalAt: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), actor: HUMAN,
  });
  const due = IP.dueSoon(90);
  assert.equal(due.length, 1);
  assert.equal(due[0].name, 'AlphaCore');
});

// ---------------------------------------------------------------- growth --

test('the hypothesis is required before the result exists', () => {
  assert.throws(() => GROWTH.start({
    name: 'Shorter form', hypothesis: 'it will help', metric: 'signups',
    variantA: 'a', variantB: 'b', actor: HUMAN,
  }), /what you expect and why/);
});

test('an experiment cannot end without saying what happens next', () => {
  const x = GROWTH.start({
    name: 'Shorter form', metric: 'signup completion',
    hypothesis: 'Removing the company field will raise completion, because it is the only field people stop at',
    variantA: 'as it is', variantB: 'without the field', actor: HUMAN,
  });
  assert.throws(() => GROWTH.conclude({ id: x.id, winner: 'b', decision: 'Ship it to everyone', actor: HUMAN }), /record both results/);
  GROWTH.record({ id: x.id, resultA: 100, resultB: 125, actor: HUMAN });
  assert.equal(one('SELECT uplift FROM experiments WHERE id = ?', x.id).uplift, 25);
  assert.throws(() => GROWTH.conclude({ id: x.id, winner: 'b', decision: 'yes', actor: HUMAN }), /what happens next/);
  const done = GROWTH.conclude({ id: x.id, winner: 'b', decision: 'Ship variant B to everyone next release', actor: HUMAN });
  assert.equal(done.state, 'concluded');
});

// ------------------------------------------------------ status and trust --

test('telling customers the company is down is a human act', () => {
  STATUS.seedComponents({});
  assert.throws(() => STATUS.postNotice({
    title: 'Console slow', body: 'we are looking', impact: 'minor', component: 'Console', actor: 'agent:AGT-OPS-001',
  }), /human act/);
  const n = STATUS.postNotice({ title: 'Console slow', body: 'we are looking', impact: 'minor', component: 'Console', actor: HUMAN });
  assert.equal(one("SELECT state FROM status_components WHERE name = 'Console'").state, 'degraded');
  STATUS.updateNotice({ id: n.id, state: 'resolved', body: 'fixed', actor: HUMAN });
  assert.equal(one("SELECT state FROM status_components WHERE name = 'Console'").state, 'operational');
});

test('an open incident nobody announced is reported, not hidden', () => {
  exec("INSERT INTO incidents (sev, title, state, commander) VALUES ('SEV2', 'Queue stalled', 'open', 'human:owner')");
  assert.ok(STATUS.unannounced().some((i) => i.title === 'Queue stalled'));
});

test('the trust centre publishes a live number, not a sentence about one', () => {
  const e = TRUST.evidence();
  assert.equal(typeof e.auditEntries, 'number');
  assert.ok(e.openPrivacyRequests >= 0);
  assert.throws(() => TRUST.publishDocument({
    title: 'Security overview', kind: 'policy', body: 'we take security seriously', owner: 'CEO', actor: 'agent:AGT-DPO-001',
  }), /made by a person/);
});

// ---------------------------------------------------------- partnerships --

test('a partnership is judged on what flowed through it, not on the logo', () => {
  exec("INSERT INTO partners (name, kind, tier, owner, state) VALUES ('Quiet Co', 'partner', 'standard', 'CEO', 'active')");
  const p = one("SELECT id FROM partners WHERE name = 'Quiet Co'");
  const t = PART.throughput(p.id);
  assert.equal(t.won, 0);
  assert.equal(t.daysQuiet, null, 'never spoken to');
  assert.ok(PART.dormant(90).some((d) => d.partner.name === 'Quiet Co'));
});

test('the chain verifies after everything above', () => {
  assert.equal(verifyChain().ok, true);
});
