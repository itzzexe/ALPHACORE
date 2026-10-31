// The working day: processes that run, the company answering from its own
// documents, paper read on this machine, recordings that end in tasks,
// WhatsApp, the portal, the board pack and insider risk.
//
// What is tested is what each part decides — who may do which step, what an
// answer may cite, which check digit fails, what becomes a bill, what a portal
// link can see and for how long, how many months the cash lasts, which
// pattern in the record raises an alert. Tesseract, whisper and WhatsApp are
// stood in for; nothing here touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-workday.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-workday-files/memory';
process.env.ALPHACORE_UPLOADS_DIR = 'data/test-workday-files/uploads';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 31).toString('base64');
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-workday.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-workday-files'), { recursive: true, force: true });

const { one, q, exec } = await import('../src/db.js');
const { seedAgents, leaseNext, executeRun } = await import('../src/workflow.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { ensurePlaybooks } = await import('../src/memory.js');
const { audit, verifyChain } = await import('../src/audit.js');
const { setSetting } = await import('../src/settings.js');
const { createUser, login } = await import('../src/auth.js');
const { expandTemplate } = await import('../src/approvals.js');
const { sectionCatalog, SURFACES } = await import('../src/links.js');
const Policies = await import('../src/policies.js');
const Proc = await import('../src/processruns.js');
const { searchCompany } = await import('../src/context.js');
const CompanyAsk = await import('../src/companyask.js');
const X = await import('../src/intake/extract.js');
const Intake = await import('../src/intake.js');
const Minutes = await import('../src/minutes.js');
const WA = await import('../src/whatsapp.js');
const Portal = await import('../src/portal.js');
const BoardPack = await import('../src/boardpack.js');
const Insider = await import('../src/insider.js');
const Docs = await import('../src/documents.js');
const { saveUpload } = await import('../src/uploads.js');
const { createInvoice, issueInvoice } = await import('../src/core2/finance.js');
const { seedChart } = await import('../src/ledger.js');

seedAgents();
seedChart();
seedConnectors();
ensurePlaybooks();

const ALICE = 'human:alice';
const BOB = 'human:bob';
const OWNER = { id: 0, username: 'owner', role: 'superadmin', perms: ['*'] };
const member = (username, perms) => ({ id: 0, username, role: 'member', perms });

async function drain() {
  for (let i = 0; i < 60; i++) {
    const run = leaseNext();
    if (!run) return;
    await executeRun(run);
  }
}
function published(kind, title, extra = {}) {
  const d = Policies.createDoc({ kind, title, actor: ALICE, ...extra });
  Policies.setState({ id: d.id, state: 'review', actor: ALICE });
  return Policies.setState({ id: d.id, state: 'published', actor: BOB });
}
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString('base64');
const mp3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]).toString('base64');

// ------------------------------------------------------- processes run --

test('process runs: each step to its role, a control needs a person who says how it held, and not the one who did the step before', () => {
  const doc = published('process', 'Paying a supplier', {
    steps: [
      { step: 'Enter the invoice', role: 'Clerk' },
      { step: 'Check it against the order', role: 'Controller', control: 'Order, receipt and invoice agree' },
      { step: 'Pay', role: 'Treasurer' },
    ],
  });
  assert.throws(() => Proc.startRun({ docId: doc.id, actor: 'agent:AGT-OPR-001' }), /person/);
  const draft = Policies.createDoc({ kind: 'process', title: 'Unpublished', steps: [{ step: 'x', role: 'y' }], actor: ALICE });
  assert.throws(() => Proc.startRun({ docId: draft.id, actor: ALICE }), /publish it first/);

  let run = Proc.startRun({ docId: doc.id, title: 'INV-77 from Acme', actor: ALICE });
  assert.equal(run.steps[0].state, 'active');
  assert.ok(run.steps[0].due_at);
  run = Proc.complete({ runId: run.id, note: 'entered', actor: ALICE });
  assert.equal(run.steps[1].state, 'active');
  assert.throws(() => Proc.complete({ runId: run.id, controlOk: true, note: 'fine', actor: ALICE }), /segregation of duties/);
  assert.throws(() => Proc.complete({ runId: run.id, note: 'fine', actor: BOB }), /confirm the control/);
  assert.throws(() => Proc.complete({ runId: run.id, controlOk: true, note: '', actor: BOB }), /how the control/);
  Proc.claim({ runId: run.id, actor: BOB });
  assert.throws(() => Proc.complete({ runId: run.id, controlOk: true, note: 'x', actor: 'human:carol' }), /bob's/);
  run = Proc.complete({ runId: run.id, controlOk: true, note: 'three documents agree, GRN-12', actor: BOB });
  run = Proc.complete({ runId: run.id, actor: ALICE });
  assert.equal(run.state, 'done', 'the control step sat between them, so alice may pay');
  assert.deepEqual(run.steps.map((s) => [s.done_by, s.control_ok]), [[ALICE, null], [BOB, 1], [ALICE, null]]);

  const second = Proc.startRun({ docId: doc.id, actor: ALICE });
  Proc.complete({ runId: second.id, actor: ALICE });
  assert.throws(() => Proc.reject({ runId: second.id, reason: '', actor: BOB }), /why/);
  assert.equal(Proc.reject({ runId: second.id, reason: 'receipt missing', actor: BOB }).state, 'rejected');
  exec("UPDATE proc_steps SET due_at = datetime('now','-1 hour') WHERE run_id = ? AND state = 'active'", Proc.startRun({ docId: doc.id, actor: ALICE }).id);
  assert.equal(Proc.lateSweep().late, 1);
  assert.equal(Proc.lateSweep().late, 0, 'announced once');
  const ov = Proc.overview({ actor: BOB });
  assert.equal(ov.exceptions, 1, 'a rejected control step is an exception');
  assert.equal(ov.late, 1);
  assert.equal(ov.processes.find((p) => p.id === doc.id).runs, 3);
});

// ---------------------------------------------------- ask the company --

test('ask the company: an answer is drawn only from what the asker may read, and cites it', async () => {
  const p = published('policy', 'Travel and expenses policy', { body: 'Hotel nights are reimbursed up to 120 dollars. Taxi receipts must be attached to every expense claim.' });
  const asOwner = await searchCompany('how much is reimbursed for a hotel night', { user: OWNER });
  assert.equal(asOwner.results[0].cite, `${p.code} v1`);
  assert.equal(asOwner.semantic, false, 'no embedding model installed: words alone');
  const outsider = member('dana', ['hunt.view']);
  assert.equal((await searchCompany('hotel night reimbursed', { user: outsider })).results.length, 0, 'policies.view is needed to be answered from a policy');

  const a = await CompanyAsk.askCompany({ question: 'How much is a hotel night reimbursed?', user: OWNER, lang: 'en' });
  assert.equal(a.state, 'thinking');
  assert.equal(a.sources[0].cite, `${p.code} v1`);
  await drain();
  const done = CompanyAsk.getAsk(a.id, OWNER);
  assert.equal(done.state, 'ready');
  assert.ok(done.answer.markdown);
  assert.throws(() => CompanyAsk.getAsk(a.id, outsider), /someone else/);
  const none = await CompanyAsk.askCompany({ question: 'xylophone quartet', user: OWNER });
  assert.equal(none.state, 'no-sources', 'nothing to cite, nothing is asked of the model');
});

// ------------------------------------------------------- paper intake --

test('extraction: a passport and an ID card check themselves; a misread digit is caught', () => {
  const td3 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
  const p = X.parseMrz(td3);
  assert.equal(p.format, 'TD3');
  assert.deepEqual([p.surname, p.given, p.number, p.nationality, p.birth, p.expiry, p.sex], ['ERIKSSON', 'ANNA MARIA', 'L898902C3', 'UTO', '1974-08-12', '2012-04-15', 'F']);
  assert.equal(p.valid, true);
  const misread = X.parseMrz(td3.replace('7408122', '7408192'));
  assert.equal(misread.valid, false);
  assert.equal(misread.checks.birth, false);
  const td1 = X.parseMrz('noise above\nI<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<');
  assert.equal(td1.format, 'TD1');
  assert.equal(td1.number, 'D23145890');
  assert.equal(td1.valid, true);
  assert.equal(X.parseMrz('no zone here'), null);
});

test('extraction: an invoice in Arabic digits and words, and one in English', () => {
  const ar = X.parseInvoice('شركة النور للتجارة\nفاتورة رقم: INV-2026-041\nالتاريخ: ٠٥/١٠/٢٠٢٦\nتاريخ الاستحقاق: ٠٤/١١/٢٠٢٦\nالمجموع الفرعي ١٬٠٠٠٬٠٠٠\nضريبة ١٠٠٬٠٠٠\nالإجمالي ١٬١٠٠٬٠٠٠ دينار');
  assert.deepEqual([ar.supplier, ar.number, ar.issued, ar.due, ar.total, ar.tax, ar.currency], ['شركة النور للتجارة', 'INV-2026-041', '2026-10-05', '2026-11-04', 1100000, 100000, 'IQD']);
  const en = X.parseInvoice('ACME Supplies Ltd\nInvoice No: A-9931\nInvoice Date: 2026-10-01\nDue Date: 2026-10-31\nSubtotal 2,000.00\nVAT 200.00\nTotal Due $2,200.00');
  assert.deepEqual([en.supplier, en.number, en.issued, en.due, en.total, en.tax, en.currency], ['ACME Supplies Ltd', 'A-9931', '2026-10-01', '2026-10-31', 2200, 200, 'USD']);
  const c = X.parseContract('This agreement is made between Alpha Trading LLC and Beta Logistics, on 2026-01-15, for a fee of USD 45,000.');
  assert.deepEqual(c.parties, ['Alpha Trading LLC', 'Beta Logistics']);
  assert.deepEqual(c.dates, ['2026-01-15']);
  assert.deepEqual(c.sums, [45000]);
});

test('intake: a read invoice becomes a draft bill only for a person with finance rights who names the vendor', () => {
  exec("INSERT INTO vendors (id, name, service) VALUES ('acme', 'ACME Supplies', 'supplies')");
  const it = Intake.createItem({ kind: 'invoice', text: 'ACME Supplies Ltd\nInvoice No: A-9931\nInvoice Date: 2026-10-01\nDue Date: 2026-10-31\nVAT 200.00\nTotal Due $2,200.00', actor: ALICE });
  assert.equal(it.state, 'read');
  assert.equal(it.fields.total, 2200);
  assert.throws(() => Intake.adopt({ id: it.id, user: member('carol', ['intake.manage']) }), /finance\.export/);
  assert.throws(() => Intake.adopt({ id: it.id, user: OWNER }), /which vendor/);
  const done = Intake.adopt({ id: it.id, vendorId: 'acme', fields: { total: '2200' }, user: OWNER });
  assert.equal(done.state, 'adopted');
  const bill = one('SELECT * FROM fin_ap_bill WHERE id = ?', Number(done.adopted_ref.split(':')[1]));
  assert.deepEqual([bill.ref, bill.amount, bill.tax, bill.state, bill.currency], ['A-9931', 2000, 200, 'draft', 'USD']);
  assert.throws(() => Intake.adopt({ id: it.id, vendorId: 'acme', user: OWNER }), /adopted/);
});

test('intake: a scan is read by the OCR engine, and an identity document becomes a screened party', async () => {
  Intake.engines.ocr = async () => 'REPUBLIC OF UTOPIA\nP<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
  const it = Intake.createItem({ kind: 'id', upload: { name: 'passport.png', mime: 'image/png', data: png() }, actor: ALICE });
  assert.equal(it.state, 'reading');
  assert.ok(one("SELECT id FROM jobs WHERE kind = 'intake.read'"), 'reading is a job, off the request');
  await Intake.readItem(it.id);
  const read = Intake.getItem(it.id);
  assert.equal(read.state, 'read');
  assert.equal(read.fields.mrz.valid, true);
  assert.throws(() => Intake.adopt({ id: it.id, user: member('carol', ['intake.manage']) }), /aml\.manage/);
  const done = Intake.adopt({ id: it.id, user: OWNER });
  const party = one('SELECT * FROM aml_parties WHERE id = ?', Number(done.adopted_ref.split(':')[1]));
  assert.equal(party.name, 'ANNA MARIA ERIKSSON');
  Intake.engines.ocr = async () => { throw new Error('tesseract is not installed on this server'); };
  const failed = Intake.createItem({ kind: 'invoice', upload: { name: 'x.png', mime: 'image/png', data: png() }, actor: ALICE });
  await Intake.readItem(failed.id);
  assert.match(Intake.getItem(failed.id).error, /not installed/);
  assert.throws(() => saveUpload({ purpose: 'intake', name: 'fake.png', mime: 'image/png', data: Buffer.from('%PDF-1.4 not a png').toString('base64'), actor: ALICE }), /not what its type says/);
  assert.throws(() => saveUpload({ purpose: 'intake', name: 'song.mp3', mime: 'audio/mpeg', data: mp3(), actor: ALICE }), /takes/);
});

// ----------------------------------------------------- recordings & minutes --

test('minutes: a transcript is drafted into minutes, and confirmed actions become tasks; a management review is ISO’s too', async () => {
  const m = Minutes.createMeeting({ title: 'Quality management review', kind: 'management_review', isoStandard: 'ISO 9001', attendees: 'CEO, QM',
    transcript: 'CEO: we agree to hire a second inspector by December. QM will draft the job description by the 15th.', actor: ALICE });
  assert.equal(m.state, 'transcribed');
  await drain();
  assert.equal(Minutes.getMeeting(m.id).drafts[0].state, 'ready');
  assert.throws(() => Minutes.recordMinutes({ id: m.id, decisions: '', actions: [], actor: ALICE }), /decided nothing/);
  assert.throws(() => Minutes.recordMinutes({ id: m.id, decisions: 'Hire', actions: [{ task: '' }], actor: ALICE }), /every action/);
  const done = Minutes.recordMinutes({ id: m.id, summary: 'Inspection capacity', decisions: '- Hire a second inspector', actions: [{ task: 'Draft the job description', owner: 'qm', due: '2026-11-15' }, { task: 'Budget the post', owner: 'cfo', due: 'soon' }], actor: ALICE });
  assert.equal(done.state, 'minuted');
  assert.equal(done.actions.length, 2);
  const task = one('SELECT * FROM tasks WHERE id = ?', done.actions[0].task_id);
  assert.deepEqual([task.title, task.assignee_id, task.due_date], ['Draft the job description', 'qm', '2026-11-15']);
  assert.equal(done.actions[1].due, null, 'a date that is not a date is not invented');
  assert.equal(one("SELECT COUNT(*) AS n FROM iso_reviews WHERE standard = 'ISO 9001'").n, 1);
  assert.throws(() => Minutes.recordMinutes({ id: m.id, decisions: 'again', actor: ALICE }), /already recorded/);
  assert.throws(() => Minutes.createMeeting({ title: 'x', kind: 'management_review', transcript: 'y', actor: ALICE }), /names the standard/);
  const copy = Docs.issue({ type: 'minutes', id: m.id, user: OWNER });
  assert.equal(Docs.verify(copy.code).inForce, true);
});

test('minutes: a recording waits for the speech engine, then follows the same path', async () => {
  Minutes.engines.transcribe = async () => 'We decided to open the Basra office in January.';
  const m = Minutes.createMeeting({ title: 'Expansion', upload: { name: 'call.mp3', mime: 'audio/mpeg', data: mp3() }, actor: ALICE });
  assert.equal(m.state, 'transcribing');
  await Minutes.transcribe(m.id);
  const after = Minutes.getMeeting(m.id);
  assert.equal(after.state, 'transcribed');
  assert.match(after.transcript, /Basra/);
  assert.equal(after.drafts[0].kind, 'minutes');
  Minutes.engines.transcribe = async () => { throw new Error('no speech model is set'); };
  const f = Minutes.createMeeting({ title: 'Broken', upload: { name: 'b.mp3', mime: 'audio/mpeg', data: mp3() }, actor: ALICE });
  await Minutes.transcribe(f.id);
  assert.match(Minutes.getMeeting(f.id).error, /speech model/);
});

// --------------------------------------------------------------- WhatsApp --

const delivery = (id, from, text, at = Math.floor(Date.now() / 1000)) => ({
  entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'Hassan' } }], messages: [{ from, id, timestamp: String(at), type: 'text', text: { body: text } }] } }] }],
});

test('whatsapp: only a delivery signed with the app secret counts, and a retried one counts once', () => {
  const raw = Buffer.from(JSON.stringify(delivery('wamid.1', '9647701234567', 'مرحبا، متى تصل الشحنة؟')));
  const sig = `sha256=${createHmac('sha256', 'test-app-secret').update(raw).digest('hex')}`;
  assert.equal(WA.signatureValid(raw, sig), true);
  assert.equal(WA.signatureValid(raw, sig.slice(0, -1) + (sig.endsWith('f') ? 'e' : 'f')), false);
  assert.equal(WA.signatureValid(raw, undefined), false);
  setSetting('WHATSAPP_VERIFY_TOKEN', 'verify-me');
  assert.equal(WA.verifyWebhook(new URLSearchParams('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42')), '42');
  assert.equal(WA.verifyWebhook(new URLSearchParams('hub.mode=subscribe&hub.verify_token=guess&hub.challenge=42')), null);
  assert.equal(WA.ingest(JSON.parse(raw)).received, 1);
  assert.equal(WA.ingest(JSON.parse(raw)).received, 0, 'WhatsApp retries; the message is stored once');
  const th = WA.thread('9647701234567');
  assert.equal(th.name, 'Hassan');
  assert.equal(th.windowOpen, true);
  assert.equal(WA.overview().waiting, 1);
});

test('whatsapp: a free reply only inside the 24-hour window, a template outside it, and every send passes the gate', async () => {
  WA.ingest(delivery('wamid.old', '9647709999999', 'hello', Math.floor(Date.now() / 1000) - 30 * 3600));
  await assert.rejects(() => WA.send({ waId: '9647709999999', text: 'hi', user: OWNER }), /24 hours/);
  setSetting('WHATSAPP_TEMPLATES', JSON.stringify([{ name: 'invoice_reminder', lang: 'ar', params: 2, preview: 'تذكير: الفاتورة {{1}} بمبلغ {{2}}' }]));
  await assert.rejects(() => WA.sendTemplate({ waId: '9647709999999', name: 'unknown', user: OWNER }), /approved list/);
  await assert.rejects(() => WA.sendTemplate({ waId: '9647709999999', name: 'invoice_reminder', params: ['AR-1'], user: OWNER }), /2 value/);
  const r = await WA.sendTemplate({ waId: '9647709999999', name: 'invoice_reminder', params: ['AR-1', '250,000 IQD'], user: OWNER });
  assert.equal(r.verdict, 'blocked', 'the connector is not connected, so the gate stops it — and says so');
  const out = r.thread.messages.at(-1);
  assert.deepEqual([out.direction, out.kind, out.body, out.status], ['out', 'template', 'تذكير: الفاتورة AR-1 بمبلغ 250,000 IQD', 'blocked']);
  const draft = WA.draftReply({ waId: '9647701234567', actor: ALICE });
  assert.equal(draft.dept, 'whatsapp');
});

// ------------------------------------------------------------------ portal --

test('portal: a link sees one party’s own invoices, can write and upload, and stops working when withdrawn', () => {
  exec("INSERT INTO customers (name, state) VALUES ('Nour Hotels', 'active'), ('Someone Else', 'active')");
  const nour = one("SELECT id FROM customers WHERE name = 'Nour Hotels'").id;
  const other = one("SELECT id FROM customers WHERE name = 'Someone Else'").id;
  for (const [cid, desc] of [[nour, 'Room booking system'], [other, 'Not theirs']]) {
    const inv = createInvoice({ customerId: cid, description: desc, amount: 1000, tax: 100, actor: ALICE });
    issueInvoice(inv.id, { actor: BOB });
  }
  assert.throws(() => Portal.issueLink({ kind: 'customer', partyId: nour, actor: 'agent:AGT-SUP-001' }), /person/);
  const link = Portal.issueLink({ kind: 'customer', partyId: nour, actor: ALICE });
  const token = link.link.split('#t=')[1];
  assert.ok(token.length >= 40);
  assert.equal(one('SELECT COUNT(*) AS n FROM portal_accounts WHERE token_hash = ?', token).n, 0, 'the token itself is not stored');
  const acct = Portal.authenticate(token);
  assert.equal(acct.name, 'Nour Hotels');
  assert.equal(Portal.authenticate('a'.repeat(43)), null);
  const inv = Portal.handle(acct, 'GET', '/invoices');
  assert.deepEqual(inv.items.map((i) => [i.description, i.total]), [['Room booking system', 1100]], 'only this customer’s invoices');
  Portal.handle(acct, 'POST', '/message', { subject: 'Invoice question', body: 'Can we pay in two parts?' });
  assert.throws(() => Portal.handle(acct, 'POST', '/upload', { purpose: 'invoice', name: 'x.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') }), /suppliers/);
  Portal.handle(acct, 'POST', '/upload', { purpose: 'kyc', name: 'licence.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 licence').toString('base64') });
  assert.equal(Portal.thread(acct.id).messages.length, 2);
  assert.equal(one("SELECT actor_type FROM audit_log WHERE action = 'portal.upload'").actor_type, 'external', 'a visitor is neither staff nor the system');
  assert.throws(() => Portal.handle(acct, 'GET', '/../admin'), /not found/);
  Portal.revoke({ id: link.id, actor: ALICE });
  assert.equal(Portal.authenticate(token), null);
});

test('portal: a supplier’s uploaded invoice goes straight to paper intake; a link is throttled', () => {
  const link = Portal.issueLink({ kind: 'supplier', partyId: 'acme', actor: ALICE });
  const token = link.link.split('#t=')[1];
  const acct = Portal.authenticate(token);
  Portal.handle(acct, 'POST', '/upload', { purpose: 'invoice', name: 'inv.png', mime: 'image/png', data: png() });
  const it = one("SELECT * FROM intake_items WHERE source = 'portal'");
  assert.equal(it.kind, 'invoice');
  assert.equal(it.created_by, `portal:${acct.id}`);
  assert.throws(() => { for (let i = 0; i < 130; i++) Portal.authenticate(token); }, /too many requests/);
});

// -------------------------------------------------------------- board pack --

test('board pack: months of cash are arithmetic, the pack is frozen once issued, and it builds itself on the first', () => {
  const r = BoardPack.runway(12000, [{ totalRevenue: 1000, totalExpenses: 3000 }, { totalRevenue: 1000, totalExpenses: 3000 }, { totalRevenue: 1000, totalExpenses: 3000 }]);
  assert.deepEqual([r.burn, r.months, r.monthsIfRevenueFalls20], [2000, 6, 5.45]);
  assert.equal(BoardPack.runway(5000, [{ totalRevenue: 4000, totalExpenses: 1000 }]).months, null, 'not burning cash is no runway figure, not infinity');
  assert.equal(BoardPack.previousPeriod(new Date(Date.UTC(2026, 0, 1))), '2025-12');

  const p = BoardPack.build({ period: '2026-10', actor: ALICE });
  assert.equal(p.snapshot.period, '2026-10');
  assert.ok(p.snapshot.governance.length >= 7);
  assert.equal(p.snapshot.overdue.lateProcessSteps, 1);
  assert.equal(BoardPack.build({ period: '2026-10', actor: ALICE }).id, p.id, 'a draft is rebuilt in place');
  const copy = Docs.issue({ type: 'boardpack', id: p.id, user: OWNER });
  assert.equal(BoardPack.getPack(p.id).state, 'issued');
  assert.equal(BoardPack.getPack(p.id).issued_code, copy.code);
  assert.throws(() => BoardPack.build({ period: '2026-10', actor: ALICE }), /issued/);
  assert.equal(BoardPack.monthlyTick(new Date(Date.UTC(2026, 11, 2, 9))), null, 'only on the first');
  assert.equal(BoardPack.monthlyTick(new Date(Date.UTC(2026, 11, 1, 9))).period, '2026-11');
  assert.equal(BoardPack.monthlyTick(new Date(Date.UTC(2026, 11, 1, 10))), null, 'once');
});

// ------------------------------------------------------------ insider risk --

test('insider risk: a new network, a night approval of money, an approval pair and a password burst each raise one alert', () => {
  createUser({ username: 'erin', password: 'erin-password-1', perms: ['policies.publish'], actor: ALICE });
  exec("INSERT INTO login_attempts (username, ip, ok, at) VALUES ('erin', '10.1.2.3', 1, datetime('now','-20 days'))");
  exec("INSERT INTO login_attempts (username, ip, ok, at) VALUES ('erin', '185.7.7.7', 1, datetime('now','-1 minute'))");
  for (let i = 0; i < 5; i++) exec("INSERT INTO login_attempts (username, ip, ok, at) VALUES ('frank', '1.1.1.1', 0, datetime('now','-10 minutes'))");
  exec("INSERT INTO login_attempts (username, ip, ok, at) VALUES ('frank', '1.1.1.1', 1, datetime('now','-5 minutes'))");
  // Whatever the hour now, put the company's clock at two in the morning.
  const h = new Date().getUTCHours();
  const off = ((2 - h + 36) % 24) - 12;
  setSetting('COMPANY_TZ_OFFSET', String(off));
  if (((h + off) % 24 + 24) % 24 < 5) audit({ actorType: 'human', actorId: 'human:gail', action: 'remit.approved', subjectType: 'remit_message', subjectId: 9 });
  for (let i = 0; i < 5; i++) {
    const d = Policies.createDoc({ kind: 'instruction', title: `Work instruction ${i}`, body: 'steps', actor: 'human:dave' });
    Policies.setState({ id: d.id, state: 'review', actor: 'human:dave' });
    Policies.setState({ id: d.id, state: 'published', actor: 'human:erin' });
  }
  const first = Insider.sweep();
  assert.ok(first.raised >= 4);
  assert.equal(Insider.sweep().raised, 0, 'each pattern once per person and key');
  const alerts = q('SELECT rule, subject, score FROM insider_alerts');
  const has = (rule, subject) => alerts.find((a) => a.rule === rule && a.subject === subject);
  assert.ok(has('new_location', 'human:erin'));
  assert.ok(has('password_burst', 'human:frank'));
  assert.ok(has('approval_pair', 'human:erin'), 'erin approved all five of dave’s');
  assert.equal(has('off_hours', 'human:gail')?.score, 50, 'money approved at night counts double');

  const pair = one("SELECT id FROM insider_alerts WHERE rule = 'approval_pair'");
  assert.throws(() => Insider.decide({ id: pair.id, verdict: 'confirmed', note: 'me', actor: 'human:erin' }), /somebody else/);
  assert.throws(() => Insider.decide({ id: pair.id, verdict: 'confirmed', note: '', actor: ALICE }), /why/);
  login('erin', 'erin-password-1');
  const d = Insider.decide({ id: pair.id, verdict: 'confirmed', note: 'erin approves everything dave writes; rotate the reviewer', endSessions: true, actor: ALICE });
  assert.equal(d.state, 'confirmed');
  assert.ok(d.sessionsEnded >= 1);
  assert.equal(Insider.overview().people[0].subject, 'human:erin');
});

// ------------------------------------------------------------- the floor --

test('the floor is wired: catalogue, one door each, permissions, and alerts about colleagues kept from *.view', () => {
  const ids = new Set(sectionCatalog().map((s) => s.id));
  for (const id of ['procruns', 'intake', 'minutes', 'whatsapp', 'portal', 'boardpack', 'insider']) {
    assert.ok(ids.has(id), `${id} is in the catalogue`);
    assert.equal(SURFACES.filter((s) => s.departments.includes(id)).length, 1, `${id} sits in exactly one door`);
  }
  assert.ok(ids.has('meetings'), 'Core 2 Meetings is still its own department');
  assert.equal(expandTemplate('operator').includes('insider.watch'), false);
  assert.equal(expandTemplate('security').includes('insider.watch'), true);
  const chain = verifyChain();
  assert.equal(chain.ok, true, JSON.stringify(chain));
});
