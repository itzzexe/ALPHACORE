// External anchoring, proved by committing the forgery it exists to catch.
//
// The attack is the one that matters and the one the hash chain alone cannot
// see: somebody who owns the disk opens the file with another tool, drops the
// append-only triggers, rewrites history, and recomputes every hash forward
// from the genesis string. The result is a *perfect* chain — internally
// consistent, verifying cleanly, and false.
//
// So this test performs exactly that forgery, checks that verifyChain() is
// fooled by it (it must be — that is the whole premise), and then checks that
// the anchor catches it anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-anchor.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-anchor.db${s}`)); } catch { /* first run */ }
}
try { fs.rmSync(path.join(root, 'data', 'anchors.log')); } catch { /* first run */ }

const { audit, verifyChain } = await import('../src/audit.js');
const { anchorNow, verifyAnchors, chainHead, anchorsOverview, anchorEvidence } = await import('../src/anchor.js');
const { db, q, one, exec } = await import('../src/db.js');

const GENESIS = 'crucible-genesis';
const canon = (o) => {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return `[${o.map(canon).join(',')}]`;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
};

/**
 * The forgery, done properly. Not a clumsy edit that breaks the chain — a
 * rewrite followed by a full recomputation, which is what anybody with the
 * file and ten minutes would actually do.
 */
function rewriteHistory(seq, newAction) {
  db.exec('DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;');
  exec('UPDATE audit_log SET action = ? WHERE seq = ?', newAction, seq);
  let prev = GENESIS;
  for (const r of q('SELECT * FROM audit_log ORDER BY seq ASC')) {
    const body = canon({
      actorType: r.actor_type, actorId: r.actor_id, action: r.action,
      subjectType: r.subject_type, subjectId: r.subject_id,
      payload: r.payload ? JSON.parse(r.payload) : null,
    });
    const hash = createHash('sha256').update(`${prev}|${body}`).digest('hex');
    exec('UPDATE audit_log SET prev_hash = ?, hash = ? WHERE seq = ?', prev, hash, r.seq);
    prev = hash;
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  `);
}

test('the head binds the height as well as the hash', () => {
  audit({ actorType: 'human', actorId: 'human:alice', action: 'money.released', payload: { usd: 40000 } });
  audit({ actorType: 'system', actorId: 'system:x', action: 'run.finished', payload: { id: 1 } });
  const head = chainHead();
  assert.equal(head.seq, one('SELECT MAX(seq) AS s FROM audit_log').s);
  assert.equal(head.digest.length, 32);
  // Anchoring the hash alone would let a forger replay an old anchor against a
  // truncated chain; the height is inside the digest to stop that.
  const withoutHeight = createHash('sha256').update(`alphacore-anchor-v1||${head.hash}`).digest('hex');
  assert.notEqual(head.digest.toString('hex'), withoutHeight);
});

test('a local file anchor says loudly that it is not a witness', async () => {
  const r = await anchorNow({ kind: 'file' });
  assert.ok(r.ok, r.error);
  assert.match(r.note, /NOT A WITNESS/, 'anybody who can rewrite the database can rewrite this file');
  const o = anchorsOverview();
  assert.equal(o.anchors[0].witness, 'file');
});

test('a quiet company is not anchored over and over', async () => {
  const before = one('SELECT COUNT(*) AS n FROM anchors').n;
  // Anchoring writes its own entry, so the head has moved — but only by its
  // own footprint, and signing your own footprints is not evidence of
  // anything. Nothing real has happened, so nothing should be witnessed.
  const again = await anchorNow({ kind: 'file' });
  assert.ok(again.skipped, `expected a skip, got ${JSON.stringify(again)}`);
  assert.match(again.reason, /nothing has happened/);
  assert.equal(one('SELECT COUNT(*) AS n FROM anchors').n, before);

  // Something real happens, and it anchors again.
  audit({ actorType: 'human', actorId: 'human:bob', action: 'decision.approved', payload: { id: 7 } });
  const now = await anchorNow({ kind: 'file' });
  assert.ok(now.ok, `expected an anchor, got ${JSON.stringify(now)}`);
  assert.equal(one('SELECT COUNT(*) AS n FROM anchors').n, before + 1);
});

test('a rewritten history still passes verifyChain — that is the whole problem', () => {
  const anchoredHeight = one('SELECT chain_seq FROM anchors WHERE ok = 1 ORDER BY id DESC LIMIT 1').chain_seq;
  assert.ok(anchoredHeight >= 1);

  rewriteHistory(1, 'money.released.definitely.not');

  const internal = verifyChain();
  assert.equal(internal.ok, true,
    'a competent forger recomputes the hashes, and the chain agrees with itself afterwards — '
    + 'which is exactly why internal consistency is not evidence');
});

test('…and the anchor catches it anyway', () => {
  const v = verifyAnchors();
  assert.equal(v.internallyConsistent, true, 'still self-consistent');
  assert.equal(v.ok, false, 'but no longer the history a third party saw');
  assert.ok(v.findings.length >= 1);
  assert.match(v.findings[0], /rewritten after it was anchored/);
});

test('truncating the chain below an anchored height is caught too', () => {
  db.exec('DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;');
  const anchored = one('SELECT MAX(chain_seq) AS s FROM anchors WHERE ok = 1').s;
  exec('DELETE FROM audit_log WHERE seq >= ?', anchored);
  const v = verifyAnchors();
  assert.equal(v.ok, false);
  assert.ok(v.findings.some((f) => /truncated/.test(f)), `expected a truncation finding, got: ${v.findings.join(' | ')}`);
});

test('a failed anchoring attempt is recorded, not swallowed', async () => {
  const before = one('SELECT COUNT(*) AS n FROM anchors').n;
  const { setSetting } = await import('../src/settings.js');
  setSetting('ANCHOR_CONFIG', JSON.stringify({ url: 'http://127.0.0.1:1/nothing-here' }));
  const r = await anchorNow({ kind: 'webhook' });
  assert.equal(r.ok, false);
  assert.equal(one('SELECT COUNT(*) AS n FROM anchors').n, before + 1,
    'a gap with no explanation looks identical to a period nobody was watching');
  const row = one('SELECT * FROM anchors ORDER BY id DESC LIMIT 1');
  assert.equal(row.ok, 0);
  assert.ok(row.note, 'the reason it failed is kept');
  setSetting('ANCHOR_CONFIG', null);
});

test('the evidence can be handed to somebody who is not us', async () => {
  const row = one('SELECT id FROM anchors WHERE ok = 1 ORDER BY id LIMIT 1');
  const ev = anchorEvidence(row.id);
  assert.ok(ev.digest && ev.chainHash && ev.howToVerify);
  assert.throws(() => anchorEvidence(999999), /no such anchor/);
});
