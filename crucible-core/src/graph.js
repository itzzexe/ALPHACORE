// The knowledge graph — who knows what about whom, in one hop.
//
// Memory answers "what did we learn". BM25 answers "which document mentions
// this word". Neither answers "everything we know about Basra Oil Company",
// because that answer is spread across a customer row, three intel records, a
// deal, six runs and two calls. This builds the entity graph those rows imply
// and lets you walk it.
//
// The embeddings are deliberately local and dependency-free: a hashed bag of
// character trigrams, normalised for Arabic the same way the memory index is.
// It will not beat a real embedding model on nuance, but it needs no key, no
// network and no vendor, which means it keeps working in sovereign mode — and
// combined with the exact-match graph edges it is enough to find the thing.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const DIM = 96;

/** The same Arabic folding the memory index uses, so both agree on a word. */
function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function embed(text) {
  const v = new Array(DIM).fill(0);
  const t = ` ${normalize(text)} `;
  for (let i = 0; i < t.length - 2; i++) {
    const gram = t.slice(i, i + 3);
    let h = 0;
    for (let j = 0; j < gram.length; j++) h = (h * 31 + gram.charCodeAt(j)) >>> 0;
    v[h % DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => Number((x / norm).toFixed(4)));
}

const cosine = (a, b) => a.reduce((sum, x, i) => sum + x * (b[i] || 0), 0);

function upsertNode(id, kind, label, props = {}) {
  exec(
    `INSERT INTO graph_nodes (id, kind, label, props, embedding, updated_at)
     VALUES (?,?,?,?,?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, props = excluded.props,
       embedding = excluded.embedding, updated_at = datetime('now')`,
    id, kind, String(label || id).slice(0, 200), JSON.stringify(props),
    JSON.stringify(embed(`${label} ${Object.values(props).join(' ')}`)),
  );
}

const link = (src, dst, rel, weight = 1) => {
  try {
    exec('INSERT INTO graph_edges (src, dst, rel, weight) VALUES (?,?,?,?) ON CONFLICT(src, dst, rel) DO UPDATE SET weight = weight + 0.1', src, dst, rel, weight);
  } catch { /* one of the ends does not exist yet; the next sweep will catch it */ }
};

/**
 * Rebuild from the rows that are actually there. Cheap enough to run on a
 * timer, so the graph never drifts from the database it describes.
 */
export function rebuildGraph() {
  const before = one('SELECT COUNT(*) AS n FROM graph_nodes').n;

  for (const c of q('SELECT * FROM customers')) {
    upsertNode(`customer:${c.id}`, 'customer', c.name, { company: c.company, plan: c.plan, mrr: c.mrr_usd, state: c.state });
  }
  for (const a of q("SELECT * FROM agents WHERE status = 'active'")) {
    upsertNode(`agent:${a.id}`, 'employee', a.name, { role: a.role_group, tier: a.model_tier, departments: a.departments });
  }
  for (const p of q('SELECT * FROM products')) upsertNode(`product:${p.id}`, 'product', p.name, {});
  for (const r of q('SELECT * FROM intel_records LIMIT 400')) {
    upsertNode(`org:${r.id}`, 'organisation', r.name, { domain: r.domain, sector: r.sector, country: r.country, city: r.city, size: r.size_hint });
    if (r.customer_id) link(`org:${r.id}`, `customer:${r.customer_id}`, 'became');
  }
  for (const d of q('SELECT * FROM deals')) {
    upsertNode(`deal:${d.id}`, 'deal', d.name, { value: d.value_usd, stage: d.stage });
    if (d.customer_id) link(`deal:${d.id}`, `customer:${d.customer_id}`, 'with');
    if (d.product_id) link(`deal:${d.id}`, `product:${d.product_id}`, 'for');
    if (d.owner) link(`agent:${d.owner}`, `deal:${d.id}`, 'owns');
  }
  for (const r of q("SELECT id, agent_id, task_type, decision_id FROM runs WHERE state = 'done' ORDER BY id DESC LIMIT 500")) {
    upsertNode(`run:${r.id}`, 'work', r.task_type, { agent: r.agent_id });
    if (r.agent_id) link(`agent:${r.agent_id}`, `run:${r.id}`, 'did');
    if (r.decision_id) link(`run:${r.id}`, `decision:${r.decision_id}`, 'informed');
  }
  for (const d of q('SELECT id, title, status FROM decisions')) {
    upsertNode(`decision:${d.id}`, 'decision', d.title, { status: d.status });
  }
  for (const c of q('SELECT * FROM campaigns')) {
    upsertNode(`campaign:${c.id}`, 'campaign', c.name, { channel: c.channel, state: c.state });
    if (c.product_id) link(`campaign:${c.id}`, `product:${c.product_id}`, 'promotes');
  }
  for (const cu of q('SELECT id, campaign_id, product_id FROM customers WHERE campaign_id IS NOT NULL OR product_id IS NOT NULL')) {
    if (cu.campaign_id) link(`campaign:${cu.campaign_id}`, `customer:${cu.id}`, 'won');
    if (cu.product_id) link(`customer:${cu.id}`, `product:${cu.product_id}`, 'uses');
  }
  for (const call of q('SELECT id, customer_id, agent_id FROM calls WHERE customer_id IS NOT NULL LIMIT 300')) {
    if (call.agent_id) link(`agent:${call.agent_id}`, `customer:${call.customer_id}`, 'spoke-to');
  }
  for (const m of q('SELECT id, layer, classification, content, created_by FROM memory_entries ORDER BY id DESC LIMIT 300')) {
    upsertNode(`memory:${m.id}`, 'memory', String(m.content || '').slice(0, 120), { layer: m.layer, classification: m.classification });
    if (String(m.created_by || '').startsWith('AGT')) link(`agent:${m.created_by}`, `memory:${m.id}`, 'remembers');
  }

  const after = one('SELECT COUNT(*) AS n FROM graph_nodes').n;
  const edges = one('SELECT COUNT(*) AS n FROM graph_edges').n;
  audit({ actorType: 'system', actorId: 'system:graph', action: 'graph.rebuilt', payload: { nodes: after, edges, added: after - before } });
  return { nodes: after, edges, added: after - before };
}

/** Meaning-ish search: the embedding finds it even when the words differ. */
export function semanticSearch(query, { k = 10, kind = null } = {}) {
  const qv = embed(query);
  const rows = kind
    ? q('SELECT id, kind, label, props, embedding FROM graph_nodes WHERE kind = ?', kind)
    : q('SELECT id, kind, label, props, embedding FROM graph_nodes');
  return rows
    .map((r) => ({ id: r.id, kind: r.kind, label: r.label, props: JSON.parse(r.props || '{}'), score: Number(cosine(qv, JSON.parse(r.embedding || '[]')).toFixed(4)) }))
    .filter((r) => r.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Everything within N hops of one thing — the "what do we know about X" answer. */
export function neighbourhood(nodeId, { hops = 2, limit = 60 } = {}) {
  const seen = new Map();
  const node = one('SELECT * FROM graph_nodes WHERE id = ?', nodeId);
  if (!node) return null;
  let frontier = [nodeId];
  seen.set(nodeId, 0);
  const edges = [];
  for (let d = 1; d <= hops && seen.size < limit; d++) {
    const next = [];
    for (const id of frontier) {
      for (const e of q('SELECT * FROM graph_edges WHERE src = ? OR dst = ?', id, id)) {
        edges.push(e);
        for (const other of [e.src, e.dst]) {
          if (!seen.has(other)) { seen.set(other, d); next.push(other); }
        }
      }
    }
    frontier = next;
  }
  const ids = [...seen.keys()].slice(0, limit);
  const nodes = ids.map((id) => {
    const n = one('SELECT id, kind, label, props FROM graph_nodes WHERE id = ?', id);
    return n ? { ...n, props: JSON.parse(n.props || '{}'), hop: seen.get(id) } : null;
  }).filter(Boolean);
  const idSet = new Set(ids);
  return {
    centre: { ...node, props: JSON.parse(node.props || '{}') },
    nodes,
    edges: edges.filter((e) => idSet.has(e.src) && idSet.has(e.dst)).map((e) => ({ src: e.src, dst: e.dst, rel: e.rel, weight: e.weight })),
  };
}

export function graphOverview() {
  return {
    counts: {
      nodes: one('SELECT COUNT(*) AS n FROM graph_nodes').n,
      edges: one('SELECT COUNT(*) AS n FROM graph_edges').n,
    },
    byKind: q('SELECT kind, COUNT(*) AS n FROM graph_nodes GROUP BY kind ORDER BY n DESC'),
    byRel: q('SELECT rel, COUNT(*) AS n FROM graph_edges GROUP BY rel ORDER BY n DESC'),
    hubs: q(`SELECT n.id, n.kind, n.label,
                    (SELECT COUNT(*) FROM graph_edges e WHERE e.src = n.id OR e.dst = n.id) AS degree
             FROM graph_nodes n ORDER BY degree DESC LIMIT 15`),
    orphans: one('SELECT COUNT(*) AS n FROM graph_nodes n WHERE NOT EXISTS (SELECT 1 FROM graph_edges e WHERE e.src = n.id OR e.dst = n.id)').n,
    lastBuilt: one("SELECT occurred_at FROM audit_log WHERE action = 'graph.rebuilt' ORDER BY seq DESC LIMIT 1")?.created_at || null,
  };
}
