// External anchoring — making the record answerable to something other than
// itself.
//
// The hash chain detects tampering by anybody who edits rows through the
// application. It does not detect the person who owns the disk. They can open
// the file with any SQLite tool, drop the append-only triggers (the factory
// reset does exactly that, legitimately), rewrite whatever they like, and
// recompute every hash forward from the genesis string. `verifyChain()` will
// then happily report that everything is consistent — because it is. The chain
// only ever proved internal consistency, and internal consistency is exactly
// what a careful forger produces.
//
// The fix is to put a copy of the chain's head somewhere the operator cannot
// reach, at a time they cannot choose. Afterwards, rewriting history means
// producing a chain whose hash at seq N no longer matches what a third party
// wrote down on Tuesday — and that is a contradiction against the world rather
// than against itself.
//
// Three witnesses, in descending order of how much they are worth:
//
//   rfc3161  a timestamping authority signs "this digest existed at this time".
//            Cryptographic, third-party, and admissible-shaped. The strongest
//            thing available without paying anybody.
//   webhook  POST the digest to a URL the operator does not control. Worth
//            exactly as much as that endpoint's independence and its logs.
//   file     append to a local file. Worth *nothing* against the disk's owner
//            and labelled as such wherever it appears; it exists so the
//            mechanism can be exercised in a test without the network.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { verifyChain } from './audit.js';
import { getSetting } from './settings.js';
import { ROOT } from './env.js';

// ------------------------------------------------------------------- DER --
// Just enough ASN.1 to ask a timestamping authority a question and read the
// first line of its answer. Writing this out is shorter than the argument for
// adding a dependency to do it.

const derLen = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const der = (tag, ...content) => {
  const body = Buffer.concat(content.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))));
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
};
const SEQ = (...c) => der(0x30, ...c);
const INT = (buf) => der(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const OCTETS = (buf) => der(0x04, buf);
const NULL_ = Buffer.from([0x05, 0x00]);
const BOOL = (v) => Buffer.from([0x01, 0x01, v ? 0xff : 0x00]);
const OID_SHA256 = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

/** RFC 3161 §2.4.1 TimeStampReq over a SHA-256 imprint. */
function timeStampRequest(digest, nonce) {
  return SEQ(
    INT(Buffer.from([1])),                       // version
    SEQ(SEQ(OID_SHA256, NULL_), OCTETS(digest)), // messageImprint
    INT(nonce),                                  // nonce — refuses a replayed answer
    BOOL(true),                                  // certReq: send the cert back with it
  );
}

/** Walk a DER buffer and hand every (tag, contents) to a visitor. */
function walk(buf, visit, depth = 0) {
  let i = 0;
  while (i < buf.length - 1) {
    const tag = buf[i];
    let len = buf[i + 1];
    let head = 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n === 0 || n > 4 || i + 2 + n > buf.length) return;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | buf[i + 2 + k];
      head = 2 + n;
    }
    if (i + head + len > buf.length) return;
    const body = buf.subarray(i + head, i + head + len);
    visit(tag, body, depth);
    // 0x20 marks a constructed type: its contents are more TLVs. An OCTET
    // STRING is primitive, but CMS hides the whole signed TSTInfo inside one,
    // so it is worth trying to descend when the bytes look like DER — which is
    // how the authority's claimed time is reached at all.
    const nested = (tag & 0x20) || (tag === 0x04 && body.length > 2 && (body[0] === 0x30 || body[0] === 0x31));
    if (nested && depth < 12) walk(body, visit, depth + 1);
    i += head + len;
  }
}

/**
 * Read the parts of a TimeStampResp that can be checked without the
 * authority's certificate: the status, whether our digest is genuinely inside
 * the signed token, and the time the authority claims.
 *
 * Verifying the authority's *signature* needs its certificate chain, which is
 * a different and larger job. The token is stored whole so it can be handed to
 * `openssl ts -verify` — the honest division of labour is that this decides
 * whether to keep the answer, and a proper verifier decides whether to believe
 * the authority.
 */
function readTimeStampResponse(der_, digest) {
  let status = null;
  let genTime = null;
  walk(der_, (tag, body, depth) => {
    if (status === null && tag === 0x02 && depth <= 2 && body.length === 1) status = body[0];
    if (genTime === null && tag === 0x18) genTime = body.toString('ascii');
  });
  // The imprint is carried verbatim inside TSTInfo; if our digest is not in
  // the bytes the authority signed, the answer is about somebody else's data.
  const carriesOurDigest = der_.includes(digest);
  return { status, granted: status === 0 || status === 1, genTime, carriesOurDigest };
}

// -------------------------------------------------------------- witnesses --

/** What is being anchored: the chain's head, as a hash of hash and height. */
export function chainHead() {
  const tip = one('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1');
  if (!tip) return null;
  // Bind the height in. Anchoring the hash alone would let a forger replay an
  // old anchor against a truncated chain and call it a match.
  const digest = createHash('sha256')
    .update(`alphacore-anchor-v1|${tip.seq}|${tip.hash}`)
    .digest();
  return { seq: tip.seq, hash: tip.hash, digest };
}

const WITNESSES = {
  async rfc3161({ digest, config }) {
    const url = config.url || getSetting('ANCHOR_TSA_URL') || 'http://timestamp.digicert.com';
    const nonce = randomBytes(8);
    const req = timeStampRequest(digest, nonce);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query', 'content-length': String(req.length) },
      body: req,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`the timestamping authority answered ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const read = readTimeStampResponse(body, digest);
    if (!read.granted) throw new Error(`the authority refused: PKIStatus ${read.status}`);
    if (!read.carriesOurDigest) throw new Error('the token does not contain the digest we asked about');
    return {
      ref: url,
      evidence: body.toString('base64'),
      at: read.genTime || null,
      note: `signed by ${new URL(url).host}; verify the token with: openssl ts -verify`,
    };
  },

  async webhook({ digest, head, config }) {
    const url = config.url || getSetting('ANCHOR_WEBHOOK_URL');
    if (!url) throw new Error('no witness URL is set');
    const payload = {
      platform: 'alphacore',
      company: getSetting('COMPANY_NAME') || null,
      chainHeight: head.seq,
      chainHash: head.hash,
      digest: digest.toString('hex'),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const text = (await res.text()).slice(0, 2000);
    if (!res.ok) throw new Error(`the witness answered ${res.status}`);
    return { ref: url, evidence: text, at: new Date().toISOString(), note: 'worth exactly as much as that endpoint is independent of you' };
  },

  async file({ digest, head, config }) {
    const file = config.path || path.join(ROOT, 'data', 'anchors.log');
    const line = `${new Date().toISOString()} height=${head.seq} hash=${head.hash} digest=${digest.toString('hex')}\n`;
    fs.appendFileSync(file, line);
    return {
      ref: file,
      evidence: line.trim(),
      at: new Date().toISOString(),
      // Said here, and again on every screen this appears on.
      note: 'A LOCAL FILE IS NOT A WITNESS. Anyone who can rewrite the database can rewrite this. For exercising the mechanism only.',
    };
  },
};

export const WITNESS_KINDS = Object.keys(WITNESSES);

// ---------------------------------------------------------------- anchoring --

/**
 * Take the chain's current head to a witness and record what came back.
 *
 * Failure is recorded too. An anchoring run that quietly did nothing would
 * leave a gap that looks identical to a period nobody was watching, and the
 * whole point is to be able to tell those apart.
 */
export async function anchorNow({ kind = null, actor = 'system:anchor' } = {}) {
  const witness = kind || getSetting('ANCHOR_WITNESS') || 'rfc3161';
  const run = WITNESSES[witness];
  if (!run) throw new Error(`no such witness: ${witness}`);

  const head = chainHead();
  if (!head) throw new Error('there is nothing on the chain to anchor');

  // Anchoring writes its own entry to the chain, so the head always moves and
  // "is this exact height already anchored" can never be true. The question
  // worth asking is whether anything has *happened* since the last witness —
  // and a run of nothing but our own anchoring entries is not something
  // happening. Without this, a scheduler pointed at a quiet company would ask
  // a timestamping authority to sign its own footprints forever.
  const last = one('SELECT chain_seq FROM anchors WHERE witness = ? AND ok = 1 ORDER BY chain_seq DESC LIMIT 1', witness);
  if (last) {
    const since = q(
      "SELECT action FROM audit_log WHERE seq > ? AND action NOT IN ('chain.anchored', 'chain.anchor_failed')",
      last.chain_seq,
    );
    if (!since.length) {
      return { skipped: true, reason: 'nothing has happened since the last anchor', anchoredHeight: last.chain_seq };
    }
  }

  let config = {};
  try { config = JSON.parse(getSetting('ANCHOR_CONFIG') || '{}'); } catch { /* defaults */ }

  try {
    const result = await run({ digest: head.digest, head, config });
    exec(
      `INSERT INTO anchors (witness, chain_seq, chain_hash, digest, external_ref, external_at, evidence, note, ok)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      witness, head.seq, head.hash, head.digest.toString('hex'),
      result.ref, result.at, result.evidence, result.note || null,
    );
    audit({
      actorType: 'system', actorId: actor, action: 'chain.anchored',
      subjectType: 'chain', subjectId: String(head.seq),
      payload: { witness, height: head.seq, digest: head.digest.toString('hex').slice(0, 16), at: result.at },
    });
    return { ok: true, witness, height: head.seq, at: result.at, note: result.note };
  } catch (err) {
    exec(
      `INSERT INTO anchors (witness, chain_seq, chain_hash, digest, external_ref, evidence, note, ok)
       VALUES (?,?,?,?,?,?,?,0)`,
      witness, head.seq, head.hash, head.digest.toString('hex'), null, null, String(err.message).slice(0, 300),
    );
    audit({
      actorType: 'system', actorId: actor, action: 'chain.anchor_failed',
      subjectType: 'chain', subjectId: String(head.seq),
      payload: { witness, error: String(err.message).slice(0, 200) },
    });
    return { ok: false, witness, error: err.message };
  }
}

/**
 * The question anchoring exists to answer: has anything been rewritten since a
 * third party wrote it down?
 *
 * For each successful anchor, recompute the chain as it stands now up to that
 * height and compare the hash with the one that was witnessed. A match means
 * that prefix of history is the same history somebody else saw. A mismatch
 * means it was rewritten afterwards — and, unlike verifyChain(), no amount of
 * recomputing hashes on this machine can make it agree again.
 */
export function verifyAnchors() {
  const anchors = q('SELECT * FROM anchors WHERE ok = 1 ORDER BY chain_seq ASC');
  const rows = q('SELECT * FROM audit_log ORDER BY seq ASC');
  const hashAt = new Map(rows.map((r) => [r.seq, r.hash]));

  const results = anchors.map((a) => {
    const current = hashAt.get(a.chain_seq);
    if (!current) {
      return {
        id: a.id, witness: a.witness, height: a.chain_seq, at: a.external_at,
        ok: false,
        finding: `entry ${a.chain_seq} no longer exists — the chain has been truncated below a height a third party already saw`,
      };
    }
    const expected = createHash('sha256').update(`alphacore-anchor-v1|${a.chain_seq}|${current}`).digest('hex');
    const ok = expected === a.digest;
    return {
      id: a.id, witness: a.witness, height: a.chain_seq, at: a.external_at, ok,
      finding: ok ? null
        : `the chain at height ${a.chain_seq} no longer hashes to what ${a.witness} witnessed — history was rewritten after it was anchored`,
    };
  });

  const internal = verifyChain();
  const broken = results.filter((r) => !r.ok);
  return {
    // Both questions, kept separate on purpose: one asks whether the chain
    // agrees with itself, the other whether it agrees with the world.
    internallyConsistent: internal.ok,
    anchored: results.length,
    ok: internal.ok && broken.length === 0,
    highestAnchoredHeight: results.length ? Math.max(...results.map((r) => r.height)) : 0,
    unanchoredEntries: rows.length ? rows[rows.length - 1].seq - (results.length ? Math.max(...results.map((r) => r.height)) : 0) : 0,
    findings: broken.map((b) => b.finding),
    results,
  };
}

export function anchorsOverview() {
  const rows = q('SELECT * FROM anchors ORDER BY id DESC LIMIT 100');
  const last = one('SELECT * FROM anchors WHERE ok = 1 ORDER BY id DESC LIMIT 1');
  const witness = getSetting('ANCHOR_WITNESS') || 'rfc3161';
  return {
    witness,
    // Say the quiet part on the page, not only in the source.
    witnessIsExternal: witness !== 'file',
    configured: Boolean(getSetting('ANCHOR_WITNESS') || getSetting('ANCHOR_TSA_URL')),
    everyHours: Number(getSetting('ANCHOR_EVERY_HOURS') || 6),
    last: last ? { at: last.external_at || last.created_at, height: last.chain_seq, witness: last.witness, ref: last.external_ref } : null,
    ageHours: last ? Math.round((Date.now() - new Date(`${last.created_at.replace(' ', 'T')}Z`)) / 36e5) : null,
    verification: verifyAnchors(),
    kinds: WITNESS_KINDS,
    anchors: rows.map((r) => ({
      id: r.id, witness: r.witness, height: r.chain_seq, ok: Boolean(r.ok),
      at: r.external_at, createdAt: r.created_at, ref: r.external_ref, note: r.note,
      hasEvidence: Boolean(r.evidence),
    })),
  };
}

/** The stored token, for handing to a verifier that is not us. */
export function anchorEvidence(id) {
  const a = one('SELECT * FROM anchors WHERE id = ?', id);
  if (!a) throw new Error('no such anchor');
  return {
    id: a.id, witness: a.witness, height: a.chain_seq, chainHash: a.chain_hash,
    digest: a.digest, externalRef: a.external_ref, at: a.external_at,
    evidence: a.evidence, note: a.note,
    howToVerify: a.witness === 'rfc3161'
      ? 'base64-decode `evidence` into token.tsr, then: openssl ts -reply -in token.tsr -text  (and `openssl ts -verify` with the authority\'s CA to check its signature)'
      : 'compare `digest` with what the witness recorded at that time',
  };
}
