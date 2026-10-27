// The six things that took the platform past "built": official documents with
// a code anyone can check, the public sanctions lists, bank statement files,
// the night shift and company context for drafting, the governance map, phone
// notifications, and the drills and locks that make it safe to run.
//
// What is tested is what each part decides: when a document is still in
// force, which name counts as a sanctions match and which does not, how a
// statement line's sign is read in three formats, when a draft waits for the
// night and who may bring it forward, what a proposal does when accepted and
// who may accept it, what a notification is allowed to say, and who has to
// set up a one-time code. No network: the lists and files are written here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-nextlevel.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-nextlevel-files/memory';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 29).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-nextlevel.db${suffix}`)); } catch { /* first run */ }
}
const scratch = path.join(root, 'data', 'test-nextlevel-files');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });

const { one, q, exec, atomically, DB_FILE } = await import('../src/db.js');
const { DatabaseSync } = await import('node:sqlite');
const { seedAgents, enqueueRun, leaseNext, executeRun } = await import('../src/workflow.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { ensurePlaybooks } = await import('../src/memory.js');
const { verifyChain } = await import('../src/audit.js');
const { setSetting } = await import('../src/settings.js');
const { createUser, login, beginTotp, confirmTotp, requiresTwoFactor, setTwoFactorRule } = await import('../src/auth.js');
const { codeFor } = await import('../src/totp.js');
const { qrMatrix, qrSvg } = await import('../public/components/qr.js');
const Policies = await import('../src/policies.js');
const Docs = await import('../src/documents.js');
const { parseUn, parseOfac, parseOfacAlt } = await import('../src/connectors/sanctions.js');
const Sanctions = await import('../src/sanctions.js');
const Aml = await import('../src/aml.js');
const Remit = await import('../src/core2/remit.js');
const St = await import('../src/core2/statements.js');
const Night = await import('../src/nightshift.js');
const { companyContext } = await import('../src/context.js');
const Drafts = await import('../src/drafts.js');
const Reach = await import('../src/reach.js');
const Assurance = await import('../src/assurance.js');
const IA = await import('../src/internalaudit.js');
const Ops = await import('../src/opscenter.js');
const { drillRestore, takeBackup } = await import('../src/backup.js');
const { encryptFile, decryptFile } = await import('../src/backupcrypt.js');

seedAgents();
seedConnectors();
ensurePlaybooks();

const ALICE = 'human:alice';
const BOB = 'human:bob';
const OWNER = { id: 0, username: 'owner', role: 'superadmin', perms: ['*'] };
const viewer = (perms) => ({ id: 0, username: 'carol', role: 'member', perms });

async function drain() {
  for (let i = 0; i < 40; i++) {
    const run = leaseNext();
    if (!run) return;
    await executeRun(run);
  }
}

function publishedPolicy(title, body) {
  const d = Policies.createDoc({ kind: 'policy', title, body, actor: ALICE });
  Policies.setState({ id: d.id, state: 'review', actor: ALICE });
  return Policies.setState({ id: d.id, state: 'published', actor: BOB });
}

// ------------------------------------------------------------------ QR --

/** Read the 15 format bits back from the matrix, as a decoder would. */
function formatBits(m) {
  const size = m.length;
  const a = []; const b = [];
  for (let i = 0; i <= 5; i++) a.push(m[i][8]);
  a.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) a.push(m[8][14 - i]);
  for (let i = 0; i < 8; i++) b.push(m[8][size - 1 - i]);
  for (let i = 8; i < 15; i++) b.push(m[size - 15 + i][8]);
  const n = (bits) => bits.reduce((acc, bit, i) => acc | ((bit ? 1 : 0) << i), 0);
  return [n(a), n(b)];
}

test('qr: the symbol has the shape the standard fixes — size, finders, timing, and matching format information at level M', () => {
  for (const [text, version] of [['A', 1], ['https://alphacore.example/verify/K7QX-2M9A-PL4T', 4], ['x'.repeat(200), 10]]) {
    const m = qrMatrix(text);
    assert.equal(m.length, 17 + 4 * version, `${text.length} bytes is version ${version}`);
    const size = m.length;
    for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      assert.ok(m[r][c] && m[r + 6][c + 6] && m[r + 3][c + 3] && !m[r + 1][c + 1], 'a finder pattern in each corner but one');
    }
    for (let i = 8; i < size - 8; i++) assert.equal(m[6][i], i % 2 === 0, 'the timing row alternates');
    assert.equal(m[size - 8][8], true, 'the dark module');
    const [f1, f2] = formatBits(m);
    assert.equal(f1, f2, 'both copies of the format information agree');
    const data = (f1 ^ 0x5412) >>> 10;
    assert.equal(data >>> 3, 0, 'error correction level M');
  }
  assert.throws(() => qrMatrix('x'.repeat(300)), /too long/);
  const svg = qrSvg('وثيقة رسمية', { label: '<script>' });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.doesNotMatch(svg, /<script>/, 'the label cannot become markup');
});

// ------------------------------------------------------------ documents --

test('documents: only a final record is issued; the same content keeps its code; the check says when it stopped being in force', () => {
  const p = publishedPolicy('Information security policy', '## Purpose\nPasswords are at least twelve characters and never shared.');
  const d1 = Docs.issue({ type: 'policy', id: p.id, user: OWNER });
  assert.match(d1.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(Docs.issue({ type: 'policy', id: p.id, user: OWNER }).code, d1.code, 'printing again is not a new document');
  assert.equal(d1.content.approvedBy, BOB);
  assert.match(d1.verifyUrl, new RegExp(`/verify/${d1.code}$`));

  assert.throws(() => Docs.issue({ type: 'policy', id: p.id, user: viewer(['policies.view']) }), /policies\.manage/);
  assert.throws(() => Docs.read(d1.code, viewer(['iso.view'])), /policies\.view/);
  assert.equal(Docs.read(d1.code, viewer(['policies.view'])).title, `${p.code} · Information security policy`);

  const draft = Policies.createDoc({ kind: 'policy', title: 'Not yet', actor: ALICE });
  assert.throws(() => Docs.issue({ type: 'policy', id: draft.id, user: OWNER }), /published/);
  assert.throws(() => Docs.issue({ type: 'nonsense', id: 1, user: OWNER }), /one of/);

  let v = Docs.verify(d1.code);
  assert.deepEqual([v.found, v.inForce, v.approvedBy, v.version], [true, true, 'bob', 1]);
  Policies.editDoc({ id: p.id, body: '## Purpose\nPasswords are at least fourteen characters.', actor: ALICE });
  v = Docs.verify(d1.code);
  assert.equal(v.inForce, false);
  assert.match(v.note, /superseded — version 2/);

  assert.throws(() => Docs.revoke({ code: d1.code, reason: '', user: OWNER }), /why/);
  Docs.revoke({ code: d1.code, reason: 'printed with the wrong owner', user: OWNER });
  assert.match(Docs.verify(d1.code).note, /withdrawn/);
  assert.equal(Docs.verify('ZZZZ-ZZZZ-ZZZZ').found, false);
  assert.equal(Docs.verify('not a code').found, false);

  const page = Docs.verifyPage(d1.code);
  assert.match(page, /Genuine, but not in force/);
  assert.match(page, /وثيقة أصلية/);
  assert.doesNotMatch(page, /https?:\/\/|src=|href=/, 'the public page makes no requests and links nowhere');
  assert.match(Docs.verifyPage('ZZZZ-ZZZZ-ZZZZ'), /No document with this code/);
});

// ------------------------------------------------------------ sanctions --

const UN_XML = `<?xml version="1.0"?><CONSOLIDATED_LIST><INDIVIDUALS>
<INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>ABU</FIRST_NAME><SECOND_NAME>BAKR</SECOND_NAME><THIRD_NAME>AL-BAGHDADI</THIRD_NAME>
<UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE><REFERENCE_NUMBER>QDi.299</REFERENCE_NUMBER><NAME_ORIGINAL_SCRIPT>أبو بكر البغدادي</NAME_ORIGINAL_SCRIPT>
<INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Ibrahim Awwad Ibrahim Ali al-Badri</ALIAS_NAME></INDIVIDUAL_ALIAS></INDIVIDUAL>
</INDIVIDUALS><ENTITIES>
<ENTITY><DATAID>2</DATAID><FIRST_NAME>AL-NUR TRADING &amp; EXCHANGE</FIRST_NAME><UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE><REFERENCE_NUMBER>QDe.999</REFERENCE_NUMBER>
<ENTITY_ALIAS><ALIAS_NAME>Nur Exchange House</ALIAS_NAME></ENTITY_ALIAS></ENTITY>
</ENTITIES></CONSOLIDATED_LIST>`;

test('sanctions: the UN and OFAC files are read into names under their party, with aliases and the original script', () => {
  const un = parseUn(UN_XML);
  assert.deepEqual(un.map((e) => [e.ref, e.name, e.kind, e.alias]), [
    ['QDi.299', 'ABU BAKR AL-BAGHDADI', 'individual', false],
    ['QDi.299', 'أبو بكر البغدادي', 'individual', true],
    ['QDi.299', 'Ibrahim Awwad Ibrahim Ali al-Badri', 'individual', true],
    ['QDe.999', 'AL-NUR TRADING & EXCHANGE', 'entity', false],
    ['QDe.999', 'Nur Exchange House', 'entity', true],
  ]);
  const ofac = parseOfac('36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- \n2674,"ABBAS, Abu","individual","SDGT",-0-,-0-\n\nnot,a,row\n');
  assert.deepEqual(ofac.map((e) => [e.ref, e.name, e.kind, e.program]), [['36', 'AEROCARIBBEAN AIRLINES', 'entity', 'CUBA'], ['2674', 'Abu ABBAS', 'individual', 'SDGT']]);
  assert.deepEqual(parseOfacAlt('2674,1,"aka","ABU ABBAS, Mohammed",-0-\n').map((e) => [e.ref, e.name]), [['2674', 'Mohammed ABU ABBAS']]);
});

test('sanctions: a close spelling or two shared names matches; one shared word does not; a shrunken list is refused', () => {
  assert.equal(Sanctions.storeList('un', parseUn(UN_XML)).stored, true);
  const hit = (n) => Sanctions.matchSanctions(n).map((h) => h.ref);
  assert.deepEqual(hit('Abu Bakr Al Baghdadi'), ['QDi.299']);
  assert.deepEqual(hit('أبو بكر البغدادي'), ['QDi.299'], 'the Arabic original matches in Arabic');
  assert.deepEqual(hit('Nur Trading Exchange LLC'), ['QDe.999']);
  assert.deepEqual(hit('Nour Trading'), [], '“Trading” alone is not a match');
  assert.deepEqual(hit('Mohammed Trading Co'), []);
  const refused = Sanctions.storeList('un', []);
  assert.equal(refused.stored, false, 'an empty file does not clear the list');
  assert.equal(one("SELECT state FROM sanctions_lists WHERE list = 'un'").state, 'refused');
  assert.equal(one("SELECT COUNT(*) AS n FROM sanctions_entries WHERE list = 'un'").n, 5);
  const ov = Sanctions.sanctionsOverview();
  assert.equal(ov.live, false, 'off until a person turns it on');
  assert.equal(Sanctions.due(), false);
  assert.throws(() => Sanctions.goLive({ actor: 'agent:AGT-AML-001' }), /person/);
});

test('sanctions: a new party that matches gets one alert, and a daily rescreen does not raise it again', () => {
  const p = Aml.addParty({ name: 'Abu Bakr Al-Baghdadi', kind: 'individual', actor: ALICE });
  assert.equal(p.sanctions.length, 1);
  const alerts = q('SELECT reason FROM aml_alerts WHERE party_id = ?', p.id);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].reason, /^matches a sanctions list: UN QDi\.299/);
  assert.equal(Aml.rescreenSanctions().alerts, 0);
  assert.equal(Aml.addParty({ name: 'Nour Trading', actor: ALICE }).sanctions.length, 0);
});

test('sanctions: a payment to a listed name is held when built, and an approved one is held again if the name is listed later', () => {
  const acct = Number(exec("INSERT INTO bank_account (name, bank, currency, gl_code, created_by) VALUES ('Operating', 'Rafidain', 'USD', '1011', ?)", ALICE).lastInsertRowid);
  const transfer = (who) => Number(exec("INSERT INTO bank_transfer (from_account_id, beneficiary, amount, state, approved_by, created_by) VALUES (?, ?, 900, 'approved', ?, ?)", acct, who, BOB, ALICE).lastInsertRowid);
  Remit.setOrderingBic({ bic: 'RAFBIQBA', actor: ALICE });
  const listed = Remit.addBeneficiary({ name: 'Nur Trading Exchange LLC', iban: 'DE89370400440532013000', bic: 'COBADEFF', country: 'DE', actor: ALICE });
  const held = Remit.buildMessage({ transferId: transfer('Nur'), beneficiaryId: listed.id, actor: ALICE });
  assert.equal(held.state, 'held');
  assert.equal(held.screening.hits[0].source, 'UN QDe.999');

  const clean = Remit.addBeneficiary({ name: 'Clean Co Holdings', iban: 'GB82WEST12345698765432', bic: 'WESTGB2L', country: 'GB', actor: ALICE });
  const m = Remit.buildMessage({ transferId: transfer('Clean'), beneficiaryId: clean.id, actor: ALICE });
  Remit.approveMessage(m.id, { actor: BOB });
  assert.equal(Remit.rescreenOpen().held, 0);
  Sanctions.storeList('un', [...parseUn(UN_XML), { ref: 'QDe.1000', name: 'CLEAN CO HOLDINGS', kind: 'entity', alias: false }]);
  assert.equal(Remit.rescreenOpen().held, 1);
  const after = Remit.getMessage(m.id);
  assert.equal(after.state, 'held', 'approved, but not yet released — so it stops');
  assert.equal(after.approved_by, null, 'the approval was given before the hit, so it is asked for again');
  assert.equal(Remit.rescreenOpen().held, 0, 'the same hit does not hold it twice');
});

// ------------------------------------------------------------ statements --

test('statements: amounts and dates as banks write them', () => {
  for (const [raw, n] of [['1,234.56', 1234.56], ['1.234,56', 1234.56], ['(1,200.00)', -1200], ['-50', -50], ['1200.00 DR', -1200], ['5000 CR', 5000], ['', null], ['abc', null]]) {
    assert.equal(St.parseAmount(raw), n, raw);
  }
  for (const [raw, d] of [['2026-08-01', '2026-08-01'], ['01/08/2026', '2026-08-01'], ['1.8.26', '2026-08-01'], ['20260801', '2026-08-01'], ['31/02/2026', null]]) {
    assert.equal(St.parseDay(raw), d, raw);
  }
});

test('statements: CSV with Arabic headers and separate debit and credit columns', () => {
  const r = St.parseStatement('التاريخ;البيان;مدين;دائن\n01/08/2026;إيجار;1.200,00;\n03/08/2026;تحويل وارد;;5.000,00\nمجموع;;;\n');
  assert.equal(r.format, 'csv');
  assert.deepEqual(r.lines, [{ day: '2026-08-01', amount: -1200, ref: 'إيجار' }, { day: '2026-08-03', amount: 5000, ref: 'تحويل وارد' }]);
  assert.equal(r.skipped, 1);
  assert.deepEqual(St.parseCsv('2026-08-01, -12.50, coffee').lines, [{ day: '2026-08-01', amount: -12.5, ref: 'coffee' }], 'no header: day, amount, reference');
});

test('statements: MT940 movements, with the :86: narrative as the reference', () => {
  const r = St.parseStatement(`:20:STMT001
:25:IQ98NBIQ850123456789012
:28C:1/1
:60F:C260731IQD1000000,00
:61:2608010801D1200,00NTRFNONREF//B123
:86:RENT
 AUGUST
:61:2608030803C5000,00NTRFINV-AR-2026-0001
:61:2608040804RD75,00NMSCREVERSAL
:62F:C260803IQD1003800,00
-}`);
  assert.equal(r.format, 'mt940');
  assert.equal(r.currency, 'IQD');
  assert.deepEqual(r.lines, [
    { day: '2026-08-01', amount: -1200, ref: 'RENT AUGUST' },
    { day: '2026-08-03', amount: 5000, ref: 'INV-AR-2026-0001' },
    { day: '2026-08-04', amount: 75, ref: 'REVERSAL' },
  ]);
});

test('statements: camt.053 entries, namespaced or not, with a reversal flipping the sign', () => {
  const body = (p) => `<?xml version="1.0"?><${p}Document xmlns${p ? `:${p.slice(0, -1)}` : ''}="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><${p}BkToCstmrStmt><${p}Stmt>
<${p}Acct><${p}Id><${p}IBAN>DE89370400440532013000</${p}IBAN></${p}Id><${p}Ccy>EUR</${p}Ccy></${p}Acct>
<${p}Ntry><${p}Amt Ccy="EUR">1200.00</${p}Amt><${p}CdtDbtInd>DBIT</${p}CdtDbtInd><${p}BookgDt><${p}Dt>2026-08-01</${p}Dt></${p}BookgDt><${p}NtryDtls><${p}TxDtls><${p}RmtInf><${p}Ustrd>Rent &amp; service</${p}Ustrd></${p}RmtInf></${p}TxDtls></${p}NtryDtls></${p}Ntry>
<${p}Ntry><${p}Amt Ccy="EUR">5000.00</${p}Amt><${p}CdtDbtInd>CRDT</${p}CdtDbtInd><${p}BookgDt><${p}DtTm>2026-08-03T10:00:00</${p}DtTm></${p}BookgDt><${p}NtryRef>REF2</${p}NtryRef></${p}Ntry>
<${p}Ntry><${p}Amt Ccy="EUR">50.00</${p}Amt><${p}CdtDbtInd>DBIT</${p}CdtDbtInd><${p}RvslInd>true</${p}RvslInd><${p}BookgDt><${p}Dt>2026-08-04</${p}Dt></${p}BookgDt></${p}Ntry>
</${p}Stmt></${p}BkToCstmrStmt></${p}Document>`;
  for (const prefix of ['', 'ns2:']) {
    const r = St.parseStatement(body(prefix));
    assert.equal(r.format, 'camt053');
    assert.equal(r.currency, 'EUR');
    assert.deepEqual(r.lines, [
      { day: '2026-08-01', amount: -1200, ref: 'Rent & service' },
      { day: '2026-08-03', amount: 5000, ref: 'REF2' },
      { day: '2026-08-04', amount: 50, ref: '' },
    ], prefix || 'no prefix');
  }
});

// ---------------------------------------------------------- night shift --

test('night shift: the window wraps midnight, and the next start is the next time it opens', () => {
  const cfg = { on: true, model: 'qwen2.5:7b', start: 22, end: 3 };
  const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 27, h, m));
  assert.deepEqual([23, 2, 3, 12, 21].map((h) => Night.inWindow(at(h), cfg)), [true, true, false, false, false]);
  assert.equal(Night.nextWindowStart(at(12), cfg), '2026-10-27 22:00:00');
  assert.equal(Night.nextWindowStart(at(23, 30), cfg), '2026-10-28 22:00:00');
});

test('night shift: a draft waits for the window and the night model; the asking department can bring it forward', async () => {
  await drain();
  assert.deepEqual(Night.laneFor({}), { lane: null, notBefore: null }, 'off by default: nothing waits');
  // A window that opens two hours from now, whatever the hour the test runs at.
  const h = new Date().getUTCHours();
  setSetting('NIGHT_SHIFT', 'true');
  setSetting('NIGHT_START', String((h + 2) % 24));
  setSetting('NIGHT_END', String((h + 3) % 24));
  setSetting('NIGHT_MODEL', 'qwen2.5:7b');
  assert.equal(Night.laneFor({ urgent: true }).lane, null, 'urgent work does not wait');

  const doc = Policies.createDoc({ kind: 'procedure', title: 'Supplier onboarding', actor: ALICE });
  const job = Policies.draft({ id: doc.id, actor: ALICE });
  const run = one('SELECT lane, not_before FROM runs WHERE id = ?', job.run_id);
  assert.equal(run.lane, 'night');
  assert.ok(run.not_before > new Date().toISOString().replace('T', ' ').slice(0, 19));
  assert.equal(leaseNext(), null, 'a run that is not due yet is not leased');
  const shown = Drafts.draftsFor('policies', 'pol_doc', doc.id)[0];
  assert.equal(shown.not_before, run.not_before, 'the page can say when it will be written');

  assert.deepEqual(Night.nightChain({ lane: 'night' }), [{ provider: 'ollama', model: 'qwen2.5:7b' }]);
  assert.equal(Night.nightChain({ lane: null }), null);

  assert.throws(() => Night.runNow(job.run_id, { actor: 'agent:AGT-POL-001' }), /person/);
  Drafts.draftNow(job.id, { actor: ALICE });
  const leased = leaseNext();
  assert.equal(leased.id, job.run_id);
  assert.equal(leased.lane, null, 'brought forward to the day model');
  await executeRun(leased);
  assert.ok(one('SELECT lease_until FROM runs WHERE id = ?', job.run_id).lease_until, 'a started run carries its own deadline');
  assert.throws(() => Drafts.draftNow(job.id, { actor: ALICE }), /no longer waiting|already written/);
  setSetting('NIGHT_SHIFT', 'false');
  assert.equal(Night.nightChain({ lane: 'night' }), null);
});

test('context: the writer is handed the company’s own rules, cited by code, and not the one it is rewriting', () => {
  const p = publishedPolicy('Password standard', 'Every password is at least sixteen characters, and shared accounts are forbidden.');
  const ctx = companyContext('procedure for resetting a password');
  assert.match(ctx, new RegExp(`\\[${p.code} v1\\] Password standard`));
  assert.doesNotMatch(companyContext('procedure for resetting a password', { exclude: p.code }), new RegExp(`\\[${p.code} `));
  assert.equal(companyContext('xylophone quartet'), '', 'nothing related, nothing added');
});

// -------------------------------------------------------- governance map --

test('governance map: a finding proposes revising the closest rule, accepting needs that department’s permission, and is done once', async () => {
  publishedPolicy('Procurement policy', 'Every purchase needs a purchase order, a goods receipt and an invoice that agree — the three-way match — before payment.');
  const f = IA.addFinding({ title: 'Payments without a goods receipt', criteria: 'purchase order, goods receipt and invoice must agree before payment',
    condition: '7 of 25 invoices were paid without a goods receipt', rating: 'high', actor: ALICE });
  Assurance.sweep();
  const p = one("SELECT * FROM gov_proposals WHERE from_type = 'ia_finding' AND from_id = ?", String(f.id));
  assert.equal(p.kind, 'finding_policy');
  assert.match(p.title, /Procurement policy/);
  assert.equal(Assurance.sweep().made, 0, 'one proposal per source, ever');

  assert.throws(() => Assurance.decide({ id: p.id, verdict: 'accept', user: viewer(['assurancemap.manage', 'iso.manage']) }), /policies\.manage/);
  const done = Assurance.decide({ id: p.id, verdict: 'accept', user: { ...OWNER, username: 'dana' } });
  assert.equal(done.state, 'accepted');
  assert.match(done.result_ref, /^draft_job:\d+$/);
  const job = one('SELECT * FROM draft_jobs WHERE id = ?', Number(done.result_ref.split(':')[1]));
  assert.equal(job.dept, 'policies');
  assert.throws(() => Assurance.decide({ id: p.id, verdict: 'accept', user: OWNER }), /already accepted/);
  await drain();
});

test('governance map: a red KPI becomes a nonconformity, a large uncovered risk asks for cover, and dismissing needs a reason', () => {
  const k = Ops.addKpi({ name: 'Orders shipped on time', unit: '%', better: 'up', target: 95, warn: 90, owner: 'ops', actor: ALICE });
  Ops.record({ kpiId: k.id, value: 80, actor: ALICE });
  exec("INSERT INTO risks (title, likelihood, impact, owner) VALUES ('Ransomware on the file server', 4, 4, 'it')");
  Assurance.sweep();
  const ncr = one("SELECT * FROM gov_proposals WHERE kind = 'issue_ncr'");
  const r = Assurance.decide({ id: ncr.id, verdict: 'accept', user: OWNER });
  const n = one('SELECT * FROM iso_ncrs WHERE id = ?', Number(r.result_ref.split(':')[1]));
  assert.equal(n.clause_ref, '9.1');
  assert.equal(n.severity, 'major', 'a high issue is a major nonconformity');

  const cover = one("SELECT * FROM gov_proposals WHERE kind = 'risk_insurance'");
  assert.equal(cover.to_ref, 'cyber');
  assert.throws(() => Assurance.decide({ id: cover.id, verdict: 'dismiss', reason: ' ', user: OWNER }), /why/);
  assert.equal(Assurance.decide({ id: cover.id, verdict: 'dismiss', reason: 'covered by the group policy', user: OWNER }).state, 'dismissed');

  const map = Object.fromEntries(Assurance.heatmap().map((t) => [t.id, t.status]));
  assert.equal(map.opscenter, 'red');
  assert.equal(map.iso, 'red', 'a major nonconformity is open');
  assert.equal(map.internalaudit, 'red', 'a high finding is open');
  assert.equal(map.risks, 'red', 'a severe risk with no mitigation');
});

// ----------------------------------------------------------------- reach --

test('reach: a message names kinds and counts, never titles, and links to the desk', () => {
  const items = [{ kind: 'contract', title: 'Secret deal with Acme' }, { kind: 'contract', title: 'x' }, { kind: 'payout', title: '$40,000 to …' }];
  const en = Reach.instantText(items, { arabic: false, link: 'https://ops.example.iq' });
  assert.equal(en, '⏳ 3 waiting for you: 2 contract, 1 payout\nhttps://ops.example.iq/#/approvals');
  assert.doesNotMatch(en, /Acme|40,000/);
  assert.match(Reach.instantText(items, { arabic: true, link: '' }), /^⏳ 3 بانتظار قرارك: 2 عقد، 1 دفعة$/);
});

test('reach: linking proves the chat with a code, what already waits is not announced, and the digest shows only what the person may see', async () => {
  const user = { id: 77, username: 'erin', role: 'member', perms: ['aml.view'] };
  await assert.rejects(() => Reach.link({ user, chatId: '123456789' }), /not connected/);
  exec("INSERT INTO reach_channels (user_id, chat_id, code_hash, code_expires) VALUES (?, '123456789', ?, datetime('now','+15 minutes'))",
    user.id, createHash('sha256').update('424242').digest('hex'));
  assert.throws(() => Reach.confirm({ user, code: '111111' }), /not the code/);
  const mine = Reach.confirm({ user, code: '424242' });
  assert.equal(mine.linked, true);
  setSetting('REACH_LANG', 'en');
  const digest = Reach.digestFor(user);
  assert.match(digest, /AML alerts open/);
  assert.doesNotMatch(digest, /nonconformities|audit actions/, 'not what this person cannot see');
  assert.match(Reach.digestFor(OWNER), /nonconformities open/);
  assert.deepEqual(await Reach.tick(), { sent: 0 }, 'Telegram off: nothing is attempted');
  assert.throws(() => Reach.setPrefs({ user, digestHour: 30 }), /0–23/);
  assert.equal(Reach.unlink({ user }).linked, false);
});

// ----------------------------------------------------------- the locks --

test('backups: a drill opens the newest copy read-only and checks it is whole; an encrypted copy opens only with its passphrase', async () => {
  const d = drillRestore({ actor: ALICE });
  try {
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.integrity, 'ok');
    assert.equal(d.chainTip, d.expectedTip, 'the chain inside the copy ends where it did when the copy was taken');
    assert.equal(one('SELECT ok FROM restore_drills WHERE id = ?', d.id).ok, 1);
  } finally {
    const b = one('SELECT file FROM backups WHERE id = ?', d.backupId);
    if (b) fs.rmSync(path.join(root, b.file), { force: true });
  }
  const src = path.join(scratch, 'plain.bin');
  fs.writeFileSync(src, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200_000, 7)]));
  await assert.rejects(() => encryptFile(src, path.join(scratch, 'x.acbk'), 'short'), /12 characters/);
  await encryptFile(src, path.join(scratch, 'plain.acbk'), 'a long and memorable sentence');
  const enc = fs.readFileSync(path.join(scratch, 'plain.acbk'));
  assert.equal(enc.subarray(0, 6).toString(), 'ACBK1\n');
  assert.equal(enc.includes(Buffer.from('SQLite format 3')), false, 'nothing of the database is readable');
  await assert.rejects(() => decryptFile(path.join(scratch, 'plain.acbk'), path.join(scratch, 'bad.bin'), 'the wrong sentence entirely'), /wrong passphrase/);
  assert.equal(fs.existsSync(path.join(scratch, 'bad.bin')), false, 'a failed decryption leaves nothing half-written');
  await decryptFile(path.join(scratch, 'plain.acbk'), path.join(scratch, 'back.bin'), 'a long and memorable sentence');
  assert.ok(fs.readFileSync(path.join(scratch, 'back.bin')).equals(fs.readFileSync(src)));
});

test('backups: a copy taken while something else is reading still reaches the end of the chain', () => {
  // A running server always has a reader somewhere. While a reader holds an
  // older snapshot the checkpoint cannot fold what was written after it, and a
  // copy of the main file alone ends short — which the first drill found.
  const files = [];
  const reader = new DatabaseSync(DB_FILE);
  try {
    reader.exec('BEGIN');
    reader.prepare('SELECT COUNT(*) AS n FROM audit_log').get();
    for (let i = 0; i < 3; i++) Policies.createDoc({ kind: 'instruction', title: `Written after the reader looked ${i}`, actor: ALICE });
    const b = atomically(() => takeBackup({ kind: 'test', actor: ALICE }));
    files.push(b.file);
    const d = drillRestore({ actor: ALICE });
    assert.equal(d.backupId, b.id);
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.chainTip, b.chain_tip);
  } finally {
    try { reader.exec('COMMIT'); } catch { /* already closed */ }
    reader.close();
    for (const f of files) fs.rmSync(path.join(root, f), { force: true });
  }
});

test('two-factor: who must use a code, and the owner cannot require it before having one', () => {
  assert.equal(requiresTwoFactor({ role: 'member', perms: ['remit.release'] }, 'admins'), true);
  assert.equal(requiresTwoFactor({ role: 'member', perms: ['policies.view'] }, 'admins'), false);
  assert.equal(requiresTwoFactor({ role: 'member', perms: ['policies.view'] }, 'all'), true);
  assert.equal(requiresTwoFactor({ role: 'superadmin', perms: ['*'] }, 'off'), false);

  const bossId = createUser({ username: 'boss', password: 'boss-password-1', perms: ['users.manage', 'settings.manage'], actor: ALICE });
  const boss = { id: bossId, username: 'boss', role: 'member', perms: ['users.manage', 'settings.manage'] };
  assert.throws(() => setTwoFactorRule({ mode: 'admins', user: boss }), /your own one-time code first/);
  const { secret } = beginTotp(bossId);
  confirmTotp(bossId, codeFor(secret));
  createUser({ username: 'payer', password: 'payer-password-1', perms: ['treasury.pay'], actor: ALICE });
  createUser({ username: 'reader', password: 'reader-password-1', perms: ['dashboard.view'], actor: ALICE });
  const r = setTwoFactorRule({ mode: 'admins', user: boss });
  assert.equal(r.mode, 'admins');
  assert.ok(r.mustEnrol >= 1);
  assert.equal(login('payer', 'payer-password-1').user.mustEnrolTotp, true, 'holds a power that moves money');
  assert.equal(login('reader', 'reader-password-1').user.mustEnrolTotp, false);
  assert.throws(() => setTwoFactorRule({ mode: 'sometimes', user: boss }), /one of/);
  setTwoFactorRule({ mode: 'off', user: boss });
  assert.equal(login('payer', 'payer-password-1').user.mustEnrolTotp, false);
});

test('the record holds: every act above is on an unbroken chain', () => {
  const chain = verifyChain();
  assert.equal(chain.ok, true, JSON.stringify(chain));
});
