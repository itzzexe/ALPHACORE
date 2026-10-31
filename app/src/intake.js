// PAPER INTAKE — a scanned invoice, a passport or a contract, read on this
// machine into fields a person checks.
//
// The document is read here: tesseract for the text (Arabic and English),
// pdftoppm first when it is a PDF. Nothing leaves the server, which matters
// most for exactly the papers that come through here — identity documents and
// what the company is billed. The fields are then found without a model where
// they can be (the passport zone checks itself) and offered to a person, who
// corrects them and decides what becomes of them: a bill in payables, a party
// in AML. Nothing is created from a document a person has not read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { hasPerm } from './auth.js';
import { saveUpload, getUpload } from './uploads.js';
import { runTool } from './localtools.js';
import { enqueue } from './jobs.js';
import { extract } from './intake/extract.js';
import { requestDraft, draftsFor } from './drafts.js';
import { createBill } from './core2/finance.js';
import { addParty } from './aml.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
export const KINDS = ['invoice', 'id', 'contract', 'other'];

/** How a page becomes text. Replaceable, so the tests can read without tesseract. */
export const engines = {
  async ocr(file, mime) {
    const lang = ['-l', 'ara+eng'];
    if (mime !== 'application/pdf') return runTool('tesseract', [file, 'stdout', ...lang], { timeoutMs: 180_000 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-'));
    try {
      // Ten pages at most: an invoice is a page or two, and a hundred-page PDF
      // would hold the machine for the better part of an hour.
      await runTool('pdftoppm', ['-r', '200', '-l', '10', '-png', file, path.join(dir, 'p')], { timeoutMs: 180_000 });
      const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
      const out = [];
      for (const p of pages) out.push(await runTool('tesseract', [path.join(dir, p), 'stdout', ...lang], { timeoutMs: 180_000 }));
      return out.join('\n\f\n');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },
};

/** A document arrives: as a file to read, or as text already typed or pasted. */
export function createItem({ kind, upload = null, uploadId = null, text = null, source = 'upload', actor }) {
  if (!KINDS.includes(kind)) refuse(`kind is one of: ${KINDS.join(', ')}`);
  if (!actor) refuse('a document arrives from somebody');
  let up = uploadId ? getUpload(uploadId) : null;
  if (upload) up = saveUpload({ purpose: 'intake', ...upload, actor });
  if (!up && !String(text || '').trim()) refuse('a file or its text');
  const r = exec('INSERT INTO intake_items (kind, source, upload_id, text, state, created_by) VALUES (?,?,?,?,?,?)',
    kind, source, up?.id || null, up ? null : String(text).slice(0, 200_000), up ? 'reading' : 'new', String(actor));
  const id = Number(r.lastInsertRowid);
  audit({ actorType: isHuman(actor) ? 'human' : String(actor).startsWith('portal:') ? 'external' : 'system', actorId: String(actor), action: 'intake.received', subjectType: 'intake_item', subjectId: id, payload: { kind, source, file: Boolean(up) } });
  if (up) enqueue('intake.read', { id }, { idempotency: `intake:${id}` });
  else readText(id);
  return getItem(id);
}

/** Text in hand: find the fields. */
function readText(id) {
  const it = one('SELECT * FROM intake_items WHERE id = ?', id);
  const fields = extract(it.kind, it.text || '');
  exec("UPDATE intake_items SET fields = ?, state = 'read', error = NULL WHERE id = ?", JSON.stringify(fields), id);
}

/** The job: read the file into text on this machine, then find the fields. */
export async function readItem(id) {
  const it = one('SELECT * FROM intake_items WHERE id = ?', Number(id));
  if (!it || !it.upload_id) return;
  const up = getUpload(it.upload_id);
  try {
    const text = await engines.ocr(up.path, up.mime);
    exec('UPDATE intake_items SET text = ? WHERE id = ?', String(text).slice(0, 200_000), it.id);
    readText(it.id);
  } catch (e) {
    exec("UPDATE intake_items SET state = 'failed', error = ? WHERE id = ?", String(e.message).slice(0, 300), it.id);
  }
}

/** Ask the intake clerk to structure what the rules could not. Optional; a person still decides. */
export function structure({ id, actor }) {
  const it = getItem(id);
  if (!it.text) refuse('there is no text yet');
  return requestDraft({
    dept: 'intake', subjectType: 'intake_item', subjectId: it.id, kind: `intake-${it.kind}`, agentId: 'AGT-INK-001', actor, urgent: true,
    brief: `Read this ${it.kind} and list its fields in "items" as {field, value}. Fields found by rules so far: ${JSON.stringify(it.fields || {})}. Where a value is not in the text, write [TO CONFIRM].\n\nText:\n${String(it.text).slice(0, 6000)}`,
  });
}

/**
 * The person's decision. An invoice becomes a draft bill for the vendor they
 * name (approval still follows in payables); an identity document becomes a
 * party screened by AML. Each needs that department's own permission.
 */
export function adopt({ id, fields = {}, vendorId = null, user }) {
  const actor = `human:${user?.username}`;
  if (!user) refuse('a person decides', 403);
  const it = getItem(id);
  if (!['read', 'failed'].includes(it.state)) refuse(`this document is ${it.state}`);
  const f = { ...(it.fields || {}), ...fields };
  let ref;
  if (it.kind === 'invoice') {
    if (!hasPerm(user, 'finance.export')) refuse('making a bill needs finance.export', 403);
    if (!vendorId) refuse('which vendor is this from?');
    if (!(Number(f.total) > 0)) refuse('the invoice total, please');
    const bill = createBill({ vendorId, ref: f.number || `INTAKE-${it.id}`, amount: Number(f.total) - Number(f.tax || 0), tax: Number(f.tax || 0),
      currency: f.currency || 'USD', issued: f.issued || null, due: f.due || null, actor });
    ref = `fin_ap_bill:${bill.id}`;
  } else if (it.kind === 'id') {
    if (!hasPerm(user, 'aml.manage')) refuse('adding a party needs aml.manage', 403);
    const m = f.mrz || {};
    const name = String(fields.name || `${m.given || ''} ${m.surname || ''}`).trim();
    if (!name) refuse('the name on the document, please');
    const country = String(fields.country || m.nationality || '').slice(0, 3);
    // ICAO codes are three letters; the AML register keeps the two-letter one when it can be told.
    const iso2 = { IRQ: 'IQ', SYR: 'SY', JOR: 'JO', IRN: 'IR', TUR: 'TR', SAU: 'SA', ARE: 'AE', KWT: 'KW', EGY: 'EG', LBN: 'LB', USA: 'US', GBR: 'GB', DEU: 'DE', FRA: 'FR', IND: 'IN', CHN: 'CN', RUS: 'RU', PRK: 'KP', MMR: 'MM' }[country] || (country.length === 2 ? country : null);
    const p = addParty({ name, kind: 'individual', country: iso2, channel: fields.channel || 'in_person', actor });
    ref = `aml_party:${p.id}`;
  } else {
    ref = 'filed';
  }
  exec("UPDATE intake_items SET state = 'adopted', fields = ?, adopted_ref = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?", JSON.stringify(f), ref, actor, it.id);
  audit({ actorType: 'human', actorId: actor, action: 'intake.adopted', subjectType: 'intake_item', subjectId: it.id, payload: { kind: it.kind, ref } });
  return getItem(it.id);
}

export function reject({ id, reason, user }) {
  if (!user) refuse('a person decides', 403);
  if (!String(reason || '').trim()) refuse('say why');
  const r = exec("UPDATE intake_items SET state = 'rejected', error = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ? AND state NOT IN ('adopted','rejected')",
    String(reason).slice(0, 300), `human:${user.username}`, Number(id));
  if (!r.changes) refuse('that document is already decided');
  audit({ actorType: 'human', actorId: `human:${user.username}`, action: 'intake.rejected', subjectType: 'intake_item', subjectId: Number(id) });
  return getItem(id);
}

export function getItem(id) {
  const it = one('SELECT i.*, u.name AS file_name, u.mime FROM intake_items i LEFT JOIN uploads u ON u.id = i.upload_id WHERE i.id = ?', Number(id));
  if (!it) refuse('no such document', 404);
  return { ...it, fields: it.fields ? JSON.parse(it.fields) : null, drafts: draftsFor('intake', 'intake_item', it.id, 2) };
}

export function overview() {
  return {
    items: q("SELECT i.id, i.kind, i.source, i.state, i.error, i.adopted_ref, i.created_by, i.created_at, u.name AS file_name FROM intake_items i LEFT JOIN uploads u ON u.id = i.upload_id ORDER BY CASE WHEN i.state IN ('read','failed') THEN 0 WHEN i.state = 'reading' THEN 1 ELSE 2 END, i.id DESC LIMIT 100"),
    waiting: one("SELECT COUNT(*) AS n FROM intake_items WHERE state IN ('read','failed')").n,
    vendors: q('SELECT id, name FROM vendors ORDER BY name LIMIT 500'),
  };
}
