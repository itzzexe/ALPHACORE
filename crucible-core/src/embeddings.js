// Real semantic recall, without leaving the machine.
//
// The knowledge graph and the memory playbooks retrieve by trigram overlap.
// That finds "invoice OCR platform" from "invoice ocr", and it does not find
// "the tool that reads receipts" — which is how somebody actually asks. Every
// recall the workforce gets is bounded by that, and it is a ceiling on the
// quality of the answers rather than a rough edge on the search box.
//
// The obvious fix is an embedding API, and it costs the position this project
// has taken everywhere else: nothing leaves the machine. Ollama resolves that
// exactly — it is already a supported provider, it runs locally, and its
// embedding models are small enough to sit beside the database.
//
// So: real vectors when a local model is there, trigrams when it is not, and
// the two never mixed in one index. A search that compares a 768-dimension
// vector with a 256-bucket trigram sketch returns nonsense with total
// confidence, which is worse than the trigrams alone.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { providersConfig } from './env.js';

const TRIGRAM_DIM = 256;

/** The local model, if the operator has said which one. */
export function embeddingModel() {
  const model = getSetting('EMBEDDING_MODEL');
  if (!model) return null;
  const base = getSetting('OLLAMA_URL')
    || providersConfig.providers?.ollama?.baseUrl
    || 'http://127.0.0.1:11434';
  return { model, base: base.replace(/\/$/, '') };
}

/** A short name for whichever space a vector belongs to. */
export const spaceOf = () => {
  const m = embeddingModel();
  return m ? `ollama:${m.model}` : 'trigram:v1';
};

// ------------------------------------------------------------- trigrams --

function trigram(text) {
  const v = new Array(TRIGRAM_DIM).fill(0);
  const t = ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
  for (let i = 0; i < t.length - 2; i++) {
    const gram = t.slice(i, i + 3);
    let h = 0;
    for (let j = 0; j < gram.length; j++) h = (h * 31 + gram.charCodeAt(j)) >>> 0;
    v[h % TRIGRAM_DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => Number((x / norm).toFixed(4)));
}

// ---------------------------------------------------------------- local --

/**
 * Ask the local model for a vector.
 *
 * Short timeout and no retry: this sits on the path that renders a page, and a
 * search that hangs for thirty seconds because ollama is starting up is worse
 * than a search that quietly falls back to trigrams and says so.
 */
async function fromOllama(text, { timeoutMs = 4000 } = {}) {
  const cfg = embeddingModel();
  if (!cfg) return null;
  const res = await fetch(`${cfg.base}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, prompt: String(text || '').slice(0, 8000) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ollama answered ${res.status}`);
  const json = await res.json();
  const v = json.embedding;
  if (!Array.isArray(v) || !v.length) throw new Error('ollama returned no embedding');
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * One text to one vector, plus the space it belongs to.
 *
 * Always returns something. A recall that throws takes a page down; a recall
 * that degrades returns worse answers and says which kind they are.
 */
export async function embedText(text) {
  const cfg = embeddingModel();
  if (!cfg) return { vector: trigram(text), space: 'trigram:v1', local: false };
  try {
    const vector = await fromOllama(text);
    return { vector, space: `ollama:${cfg.model}`, local: true };
  } catch (e) {
    // Recorded once per hour rather than per call: a failing local model on a
    // busy page would otherwise write a thousand identical rows.
    const recent = one(
      "SELECT seq FROM audit_log WHERE action = 'embeddings.degraded' AND occurred_at > datetime('now', '-1 hour') LIMIT 1",
    );
    if (!recent) {
      audit({
        actorType: 'system', actorId: 'system:embeddings', action: 'embeddings.degraded',
        subjectType: 'system', subjectId: cfg.model,
        payload: { error: String(e.message).slice(0, 150), fellBackTo: 'trigram:v1' },
      });
    }
    return { vector: trigram(text), space: 'trigram:v1', local: false, degraded: String(e.message).slice(0, 150) };
  }
}

export const cosine = (a, b) => {
  // Different lengths mean different spaces. Comparing them produces a number,
  // and the number is meaningless — which is far more dangerous than an error,
  // because a ranked list of nonsense looks exactly like a ranked list.
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};

/**
 * Re-embed everything into the current space.
 *
 * Needed whenever the model changes, because vectors from two models are not
 * comparable even at the same dimension. Bounded batches, for the same reason
 * retention is: this runs on a synchronous database.
 */
export async function reindex({ batch = 200, actor = 'system:embeddings' } = {}) {
  const space = spaceOf();
  const stale = q(
    'SELECT id, label, props FROM graph_nodes WHERE embedding_space IS NULL OR embedding_space != ? LIMIT ?',
    space, batch,
  );
  if (!stale.length) return { done: true, space, reindexed: 0 };

  let n = 0;
  for (const node of stale) {
    let text = node.label || '';
    try { text = `${text} ${Object.values(JSON.parse(node.props || '{}')).filter((v) => typeof v === 'string').join(' ')}`; }
    catch { /* the label alone */ }
    const { vector } = await embedText(text);
    exec('UPDATE graph_nodes SET embedding = ?, embedding_space = ? WHERE id = ?', JSON.stringify(vector), space, node.id);
    n++;
  }

  const left = one(
    'SELECT COUNT(*) AS n FROM graph_nodes WHERE embedding_space IS NULL OR embedding_space != ?', space,
  ).n;
  if (n) {
    audit({
      actorType: 'system', actorId: actor, action: 'embeddings.reindexed',
      subjectType: 'system', subjectId: space, payload: { reindexed: n, remaining: left },
    });
  }
  return { done: left === 0, space, reindexed: n, remaining: left };
}

export function embeddingsOverview() {
  const cfg = embeddingModel();
  const spaces = q('SELECT COALESCE(embedding_space, \'trigram:v1\') AS space, COUNT(*) AS n FROM graph_nodes GROUP BY space');
  const current = spaceOf();
  return {
    model: cfg?.model || null,
    endpoint: cfg?.base || null,
    space: current,
    // Said plainly: without a local model this is string overlap, and string
    // overlap does not find "the tool that reads receipts".
    quality: cfg
      ? 'meaning: a local model, and nothing leaves this machine'
      : 'string overlap only — set EMBEDDING_MODEL to a local ollama model for recall that understands a question phrased differently',
    spaces,
    needsReindex: spaces.filter((s) => s.space !== current).reduce((n, s) => n + s.n, 0),
    lastDegraded: one("SELECT occurred_at, payload FROM audit_log WHERE action = 'embeddings.degraded' ORDER BY seq DESC LIMIT 1") || null,
  };
}
