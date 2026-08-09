#!/usr/bin/env node
// A chain verifier that owes nothing to the platform.
//
//   node scripts/verify-chain.mjs <export.json | database.db> [--anchors]
//
// This file is deliberately standalone. It imports nothing from src/, opens no
// settings, and can be copied out of the repository and run on its own against
// an export somebody sent you. That is the entire point: a verifier that has to
// be run *by* the system it is checking is a system marking its own homework.
//
// It answers three questions, in descending order of how much they are worth:
//
//   1. Does every hash follow from the one before it?  (the chain agrees with
//      itself — necessary, and not evidence of anything on its own)
//   2. Does the chain still hash to what a third party wrote down?  (it agrees
//      with the world — this is the one that cannot be forged locally)
//   3. Do the timestamping tokens actually contain those hashes?
//
// The first is what a rewritten history also passes. Read the second before
// believing the first.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const GENESIS = 'crucible-genesis';

/** Byte-identical to the server's: sorted keys, no whitespace variance. */
function canon(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canon).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`).join(',')}}`;
}

const target = process.argv[2];
const wantAnchors = process.argv.includes('--anchors');

if (!target || process.argv.includes('--help')) {
  console.log(`
  Verify an AlphaCore audit chain without AlphaCore.

    node verify-chain.mjs company-export.json
    node verify-chain.mjs data/alphacore.db --anchors

  A .json export needs nothing but Node. A .db needs Node 22.5 or newer, for
  node:sqlite. Neither needs the platform, its settings, or its keys.
`);
  process.exit(target ? 0 : 1);
}

// ------------------------------------------------------------ loading it --

async function load(file) {
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);

  if (file.endsWith('.json')) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // An export may be the whole database or just the log; accept either
    // rather than making somebody reshape a file to be allowed to check it.
    const entries = data.audit_log || data.auditLog || data.entries || (Array.isArray(data) ? data : null);
    if (!entries) throw new Error('this JSON has no audit_log in it');
    return { entries, anchors: data.anchors || [] };
  }

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  const entries = db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all();
  let anchors = [];
  try { anchors = db.prepare('SELECT * FROM anchors WHERE ok = 1 ORDER BY chain_seq ASC').all(); } catch { /* older database */ }
  return { entries, anchors };
}

// ----------------------------------------------------------- checking it --

function verifyChain(entries) {
  let prev = GENESIS;
  for (const r of entries) {
    const body = canon({
      actorType: r.actor_type ?? r.actorType,
      actorId: r.actor_id ?? r.actorId,
      action: r.action,
      subjectType: r.subject_type ?? r.subjectType ?? null,
      subjectId: r.subject_id ?? r.subjectId ?? null,
      payload: typeof r.payload === 'string' ? (r.payload ? JSON.parse(r.payload) : null) : (r.payload ?? null),
    });
    const expect = createHash('sha256').update(`${prev}|${body}`).digest('hex');
    const storedPrev = r.prev_hash ?? r.prevHash;
    if (storedPrev !== prev) {
      return { ok: false, at: r.seq, why: `entry ${r.seq} claims to follow ${String(storedPrev).slice(0, 12)}… but follows ${prev.slice(0, 12)}…` };
    }
    if (r.hash !== expect) {
      return { ok: false, at: r.seq, why: `entry ${r.seq} hashes to ${expect.slice(0, 12)}… but stores ${String(r.hash).slice(0, 12)}…` };
    }
    prev = r.hash;
  }
  return { ok: true, checked: entries.length, head: prev };
}

function verifyAnchors(entries, anchors) {
  const hashAt = new Map(entries.map((e) => [e.seq, e.hash]));
  return anchors.map((a) => {
    const current = hashAt.get(a.chain_seq);
    if (!current) {
      return { height: a.chain_seq, witness: a.witness, ok: false, why: 'that entry is not in this chain — it has been truncated below a height somebody already witnessed' };
    }
    const expect = createHash('sha256').update(`alphacore-anchor-v1|${a.chain_seq}|${current}`).digest('hex');
    const ok = expect === a.digest;
    return {
      height: a.chain_seq, witness: a.witness, at: a.external_at, ok,
      why: ok ? null : 'this chain no longer hashes to what was witnessed — history was rewritten after it was anchored',
      // Whether the token really contains that digest is checkable here too:
      // it is carried verbatim inside the signed TSTInfo.
      tokenCarriesDigest: a.evidence ? Buffer.from(a.evidence, 'base64').includes(Buffer.from(a.digest, 'hex')) : null,
    };
  });
}

// ---------------------------------------------------------------- saying it --

const { entries, anchors } = await load(target);
const rule = '─'.repeat(66);

console.log(`\n${rule}`);
console.log(`  ${target}`);
console.log(`  ${entries.length} entries` + (anchors.length ? `, ${anchors.length} anchor(s)` : ', no anchors'));
console.log(rule);

const chain = verifyChain(entries);
if (chain.ok) {
  console.log(`\n  ✓ internally consistent — ${chain.checked} entries, head ${chain.head.slice(0, 16)}…`);
} else {
  console.log(`\n  ✗ BROKEN at entry ${chain.at}`);
  console.log(`    ${chain.why}`);
}

if (!anchors.length) {
  console.log('\n  ! nothing was witnessed outside the machine that wrote this.');
  console.log('    Internal consistency is exactly what a rewritten record also has:');
  console.log('    anybody with the file can edit it and recompute every hash.');
  console.log('    Without an anchor, the check above proves the file is well-formed,');
  console.log('    not that it is true.');
} else if (wantAnchors || anchors.length) {
  const results = verifyAnchors(entries, anchors);
  const broken = results.filter((r) => !r.ok);
  console.log(`\n  ${broken.length ? '✗' : '✓'} against ${results.length} outside witness(es):`);
  for (const r of results) {
    console.log(`    ${r.ok ? '✓' : '✗'} height ${String(r.height).padEnd(7)} ${r.witness.padEnd(9)} ${r.at || ''}`
      + (r.tokenCarriesDigest === false ? '  [token does not carry this digest]' : ''));
    if (r.why) console.log(`      ${r.why}`);
  }
  if (!broken.length) {
    console.log('\n    This is the answer that cannot be forged on the machine that');
    console.log('    holds the file. To go further, check the tokens themselves:');
    console.log('      openssl ts -reply -in token.tsr -text');
  }
}

console.log(`\n${rule}\n`);
process.exit(chain.ok && !verifyAnchors(entries, anchors).some((r) => !r.ok) ? 0 : 1);
