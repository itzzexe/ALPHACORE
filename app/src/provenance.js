// Provenance — a signed receipt for anything the company made.
//
// The audit chain already proves that nothing was altered after the fact. This
// proves the opposite direction: that a particular artifact came out of this
// company, on this date, from this model, reviewed by these employees, at this
// cost — and it proves it to somebody who does not have access to the database.
//
// The receipt is an Ed25519 signature over a canonical description of the work.
// Anyone holding the public key can verify it offline, forever, without asking
// us anything. As disclosure of machine-made content stops being optional, this
// stops being a nicety.
import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey, createPrivateKey } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSecret, putSecret } from './vault.js';

const PRIV = 'PROVENANCE_PRIVATE_KEY';
const PUB = 'PROVENANCE_PUBLIC_KEY';

/** The company's signing identity, made once and kept in the vault. */
function keys() {
  let priv = getSecret(PRIV);
  let pub = getSecret(PUB);
  if (!priv || !pub) {
    const pair = generateKeyPairSync('ed25519');
    priv = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    pub = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    putSecret(PRIV, priv, { kind: 'password', note: 'signs provenance receipts', actor: 'system:provenance' });
    putSecret(PUB, pub, { kind: 'api_key', note: 'verifies provenance receipts — safe to publish', actor: 'system:provenance' });
  }
  return { priv, pub };
}

/** Deterministic: the same work always produces the same bytes to sign. */
function canonical(receipt) {
  const ordered = Object.keys(receipt).sort().map((k) => `${k}=${typeof receipt[k] === 'object' ? JSON.stringify(receipt[k]) : receipt[k]}`);
  return ordered.join('\n');
}

/**
 * Sign a piece of work. `content` is the artifact itself; everything else is
 * how it came to exist.
 */
export function issueReceipt({ subjectType, subjectId, content, madeBy = null, model = null, reviewers = [], costUsd = 0 }) {
  const { priv, pub } = keys();
  const contentHash = createHash('sha256').update(String(content ?? '')).digest('hex');
  const chainHash = one('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')?.hash || null;
  const body = {
    subjectType, subjectId: String(subjectId), contentHash, chainHash,
    madeBy, model, reviewers, costUsd,
    issuedAt: new Date().toISOString().slice(0, 19) + 'Z',
  };
  const signature = edSign(null, Buffer.from(canonical(body)), createPrivateKey(priv)).toString('base64');
  exec(
    `INSERT INTO provenance (subject_type, subject_id, content_hash, chain_hash, made_by, model, reviewers, cost_usd, signature, public_key)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(subject_type, subject_id, content_hash) DO NOTHING`,
    subjectType, String(subjectId), contentHash, chainHash, madeBy, model, JSON.stringify(reviewers), costUsd, signature, pub,
  );
  audit({
    actorType: 'system', actorId: 'system:provenance', action: 'provenance.issued',
    subjectType, subjectId: String(subjectId), payload: { contentHash: contentHash.slice(0, 16), model, reviewers: reviewers.length },
  });
  return { ...body, signature, publicKey: pub };
}

/** Verify a receipt against content somebody hands you. Offline, no database. */
export function verifyReceipt({ receipt, content = null }) {
  try {
    const body = { ...receipt };
    const signature = body.signature;
    const publicKey = body.publicKey || body.public_key;
    delete body.signature; delete body.publicKey; delete body.public_key;
    const sigOk = edVerify(null, Buffer.from(canonical(body)), createPublicKey(publicKey), Buffer.from(signature, 'base64'));
    const contentOk = content === null ? null
      : createHash('sha256').update(String(content)).digest('hex') === body.contentHash;
    return { signatureValid: sigOk, contentMatches: contentOk, ok: sigOk && contentOk !== false };
  } catch (err) {
    return { signatureValid: false, contentMatches: false, ok: false, why: err.message };
  }
}

/** Verify one we issued, straight from the table. */
export function verifyStored(id, content = null) {
  const r = one('SELECT * FROM provenance WHERE id = ?', id);
  if (!r) throw new Error('no such receipt');
  return verifyReceipt({
    receipt: {
      subjectType: r.subject_type, subjectId: r.subject_id, contentHash: r.content_hash,
      chainHash: r.chain_hash, madeBy: r.made_by, model: r.model,
      reviewers: JSON.parse(r.reviewers || '[]'), costUsd: r.cost_usd,
      issuedAt: r.created_at.replace(' ', 'T') + 'Z',
      signature: r.signature, publicKey: r.public_key,
    },
    content,
  });
}

/** Everything finished that has no receipt yet gets one. */
export function sealFinishedWork() {
  let n = 0;
  const artifacts = q(`SELECT a.* FROM archive_items a
    WHERE NOT EXISTS (SELECT 1 FROM provenance p WHERE p.subject_type = 'archive' AND p.subject_id = CAST(a.id AS TEXT))
    ORDER BY a.id DESC LIMIT 20`);
  for (const a of artifacts) {
    issueReceipt({
      subjectType: 'archive', subjectId: a.id,
      content: a.snapshot || a.title || '',
      madeBy: a.created_by || null, model: null, reviewers: [],
    });
    n++;
  }
  // A run's receipt names the model that served it and anyone who reviewed the
  // work — that is the part an outside reader cannot reconstruct for themselves.
  const runs = q(`SELECT r.id, r.agent_id, r.output, r.cost_usd,
                         (SELECT model FROM model_calls mc WHERE mc.run_id = r.id ORDER BY mc.id DESC LIMIT 1) AS model
                  FROM runs r
                  WHERE r.state = 'done' AND r.output IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM provenance p WHERE p.subject_type = 'run' AND p.subject_id = r.id)
                  ORDER BY r.ended_at DESC LIMIT 20`);
  for (const r of runs) {
    const reviewers = q(
      "SELECT DISTINCT reviewer FROM quality_reviews WHERE area = ? OR notes LIKE ?", r.agent_id, `%${r.id}%`,
    ).map((x) => x.reviewer).filter(Boolean);
    issueReceipt({ subjectType: 'run', subjectId: r.id, content: r.output, madeBy: r.agent_id, model: r.model, reviewers, costUsd: r.cost_usd || 0 });
    n++;
  }
  return n;
}

export function provenanceOverview() {
  const { pub } = keys();
  return {
    publicKey: pub,
    counts: {
      total: one('SELECT COUNT(*) AS n FROM provenance').n,
      today: one("SELECT COUNT(*) AS n FROM provenance WHERE created_at >= date('now')").n,
      subjects: q('SELECT subject_type, COUNT(*) AS n FROM provenance GROUP BY subject_type'),
    },
    recent: q(`SELECT id, subject_type, subject_id, substr(content_hash,1,16) AS content_hash,
                      made_by, model, reviewers, cost_usd, created_at
               FROM provenance ORDER BY id DESC LIMIT 30`),
    unsealed: {
      runs: one("SELECT COUNT(*) AS n FROM runs r WHERE r.state = 'done' AND NOT EXISTS (SELECT 1 FROM provenance p WHERE p.subject_type='run' AND p.subject_id = r.id)").n,
    },
  };
}
