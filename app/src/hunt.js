// The hunt — البحث العميق.
//
// A search box returns what matches the words you typed. That is a different
// thing from finding out what you asked, and the gap between them is where most
// questions die: you search "Northwind", get four rows, and never learn that the
// contract is filed under the parent company, the contact left in March, and the
// unpaid invoice is under a different reference entirely.
//
// So this does not search. It hunts:
//
//   1. asks every source at once — every table in the database, the knowledge
//      graph, what the agents remember, the archive, the audit record, and the
//      open web
//   2. reads what came back and decides whether the question is actually
//      answered, which is a judgement and is made by a model, in the open, with
//      its reasoning recorded
//   3. if it is not, works out what to ask next *from what it just learned* —
//      the names, references, domains and dates that appeared — and goes again
//   4. stops when the answer is found, when the money runs out, or when a round
//      turns up nothing new
//
// It never stops by inventing an answer. A hunt that fails says so: not found,
// after this many rounds, across these sources, having tried these queries. An
// honest empty result is worth more than a confident wrong one, and this is the
// system where a wrong answer becomes a journal entry or an email.
//
// Everything outside this machine goes through the egress gate and the budget
// like any other call, because a search loop is exactly the thing that quietly
// spends a thousand dollars overnight.
import { q, one, exec, db } from './db.js';
import { audit } from './audit.js';
import { route, parseAgentJson } from './router.js';
import { search as memorySearch } from './memory.js';
import { semanticSearch, neighbourhood } from './graph.js';
import { searchWeb, fetchPage, scanForInjection } from './web.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';

// ------------------------------------------------------------- the sources --

/**
 * Tables worth reading and the columns worth reading in them.
 *
 * Discovered rather than listed: a hand-maintained list of searchable tables is
 * out of date the week after somebody adds a feature, and the whole promise here
 * is "everywhere". So the schema is asked what exists, and every text column is
 * fair game — except the ones that must never be surfaced.
 */
const NEVER_READ = new Set([
  'secrets', 'sessions', 'api_keys', 'vault_items', 'push_subscriptions',
  'totp_secrets', 'login_attempts', 'users', 'erasure_keys', 'master_keys',
]);
// Columns that hold ciphertext, hashes or keys: matching on them is noise at
// best and a leak at worst.
const NEVER_COLUMN = /(^|_)(secret|password|token|key|hash|ciphertext|iv|tag|salt|signature|private)(_|$)/i;

let tableCache = null;
function searchableTables() {
  if (tableCache) return tableCache;
  const tables = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);
  tableCache = [];
  for (const t of tables) {
    if (NEVER_READ.has(t)) continue;
    let cols;
    try { cols = q(`PRAGMA table_info(${t})`); } catch { continue; }
    const text = cols
      .filter((c) => /TEXT|CHAR|CLOB|BLOB|^$/i.test(c.type || '') && !NEVER_COLUMN.test(c.name))
      .map((c) => c.name);
    if (text.length) tableCache.push({ table: t, columns: text, id: cols.find((c) => c.pk)?.name || 'rowid' });
  }
  return tableCache;
}

/** Every table, every text column. This is the "searches everywhere" part. */
function searchRecords(term, { limit = 40 } = {}) {
  const hits = [];
  const like = `%${term}%`;
  for (const { table, columns, id } of searchableTables()) {
    const where = columns.map((c) => `"${c}" LIKE ?`).join(' OR ');
    let rows;
    try {
      rows = q(`SELECT ${id === 'rowid' ? 'rowid AS _id' : `"${id}" AS _id`}, * FROM "${table}" WHERE ${where} LIMIT 6`,
        ...columns.map(() => like));
    } catch { continue; } // a view, a virtual table, a column type that will not compare
    for (const r of rows) {
      // Which column actually matched, so the result can say why it is here.
      const why = columns.find((c) => String(r[c] ?? '').toLowerCase().includes(term.toLowerCase()));
      hits.push({
        source: 'records', where: table, id: r._id,
        title: String(r.title || r.name || r.ref || r.label || r.subject || `${table} ${r._id}`).slice(0, 140),
        snippet: String(r[why] ?? '').slice(0, 300),
        matched: why,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** The sources, each wrapped so one failing never takes the hunt down. */
const SOURCES = {
  records: {
    label: 'company records', external: false,
    run: async (term) => searchRecords(term),
  },
  graph: {
    label: 'knowledge graph', external: false,
    run: async (term) => semanticSearch(term, { k: 8 }).map((n) => ({
      source: 'graph', where: n.kind, id: n.id,
      title: n.label || n.id, snippet: (n.summary || '').slice(0, 300), score: n.score,
    })),
  },
  memory: {
    label: 'what the agents remember', external: false,
    run: async (term) => memorySearch(term, { limit: 8 }).map((m) => ({
      source: 'memory', where: m.kind, id: m.id,
      title: m.title, snippet: (m.body || '').slice(0, 300), score: m.score,
    })),
  },
  audit: {
    label: 'the audit record', external: false,
    run: async (term) => q(
      `SELECT seq, action, actor_id, subject_type, subject_id, payload, occurred_at FROM audit_log
        WHERE subject_id LIKE ? OR action LIKE ? OR payload LIKE ? ORDER BY seq DESC LIMIT 8`,
      `%${term}%`, `%${term}%`, `%${term}%`,
    ).map((a) => ({
      source: 'audit', where: a.action, id: a.seq,
      title: `${a.action} — ${a.subject_type || ''} ${a.subject_id || ''}`.trim(),
      snippet: `${a.actor_id} at ${a.occurred_at}: ${String(a.payload || '').slice(0, 200)}`,
    })),
  },
  web: {
    label: 'the open web', external: true,
    run: async (term, ctx) => {
      const r = await searchWeb(term, { agentId: ctx.agentId, runId: ctx.runId, count: 6 });
      if (!r.results?.length) return [];
      return r.results.map((x) => ({
        source: 'web', where: (() => { try { return new URL(x.url).hostname; } catch { return 'web'; } })(),
        id: x.url, title: x.title, snippet: x.snippet, url: x.url, engine: r.engine,
      }));
    },
  },
};

// -------------------------------------------------------------- the machine --

const key = (h) => `${h.source}:${h.where}:${h.id}`;

/**
 * Ask the model two questions at once: is this enough, and if not, what should
 * we ask next.
 *
 * Both in one call because they are one judgement — "not yet, and here is why
 * not" is the same thought as "so try these". Splitting them doubles the cost to
 * produce a worse answer.
 */
async function assess({ question, found, tried, round, agentId }) {
  const evidence = found.slice(0, 40).map((h, i) =>
    `[${i + 1}] (${h.source}/${h.where}) ${h.title}\n    ${String(h.snippet || '').replace(/\s+/g, ' ').slice(0, 240)}`).join('\n');

  const r = await route({
    tier: 'T2', agentId, sensitivity: 'internal', maxTokens: 1200,
    system: `You decide whether a question has actually been answered by evidence, and if not, what to search next.

Answer with JSON only:
{"answered": true|false,
 "confidence": 0.0-1.0,
 "answer": "the answer, in plain words, ONLY if answered is true — otherwise null",
 "citations": [1, 4],
 "missing": "what is still not known, if anything",
 "next": ["up to 4 new search terms"]}

Rules that matter more than being helpful:
- "answered" is true only if the evidence SAYS the answer. Not if it suggests one,
  not if you happen to know it, not if it is probably right. You are the check
  against a confident wrong answer, and there is nothing downstream of you.
- Every claim in "answer" must be traceable to a numbered item. Cite them.
- "next" terms must come from what the evidence revealed — a name, a reference,
  a company, a domain, a date that appeared and was not searched. Re-wording the
  original question is not a new lead and wastes a round.
- If the evidence contains no new leads at all, return an empty "next". Saying
  the trail is cold is more useful than another guess.`,
    prompt: `Question: ${question}

Already searched (round ${round}): ${tried.join(' | ') || '(nothing yet)'}

Evidence found so far:
${evidence || '(nothing at all)'}`,
  });
  const j = parseAgentJson(r.text) || {};
  return {
    answered: j.answered === true,
    confidence: Number(j.confidence) || 0,
    answer: j.answered === true ? (j.answer || null) : null,
    citations: Array.isArray(j.citations) ? j.citations : [],
    missing: j.missing || null,
    next: (Array.isArray(j.next) ? j.next : []).map((s) => String(s).slice(0, 120)).filter(Boolean).slice(0, 4),
    costUsd: r.costUsd || 0,
  };
}

/**
 * Hunt until found.
 *
 * `rounds` is a ceiling, not a target — it stops the moment it has the answer.
 * The other two stops are the ones that matter for a loop that can spend money:
 * a cost cap, and a dry round. Without them "keep going until it finds it" is a
 * promise to search forever.
 */
export async function hunt({
  question,
  actor,
  agentId = 'agent:AGT-RSH-001',
  rounds = Number(getSetting('HUNT_MAX_ROUNDS') || 6),
  maxUsd = Number(getSetting('HUNT_MAX_USD') || 2),
  sources = null,
  allowWeb = true,
  runId = null,
} = {}) {
  // Refusals, not failures — see the note in ledger.js. A missing question is
  // the caller's mistake, and a 500 for it is a false alarm.
  const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (!question || !String(question).trim()) refuse('a hunt needs a question');
  if (!actor) refuse('a hunt has to be signed — it can spend money and reach outside');

  const started = new Date().toISOString();
  const id = exec(
    `INSERT INTO hunts (question, asked_by, agent_id, state, max_rounds, max_usd, started_at)
     VALUES (?,?,?,'running',?,?,?)`,
    question, actor, agentId, rounds, maxUsd, started,
  ).lastInsertRowid;

  const wanted = sources
    ? Object.keys(SOURCES).filter((s) => sources.includes(s))
    : Object.keys(SOURCES).filter((s) => allowWeb || !SOURCES[s].external);

  const seen = new Set();
  const found = [];
  const tried = [];
  const trail = [];
  let spent = 0;
  let verdict = null;
  let stopped = 'rounds exhausted';
  let queries = [String(question).trim()];

  for (let round = 1; round <= rounds; round += 1) {
    const before = found.length;
    const roundHits = [];
    const roundErrors = [];

    // Every source, every query, all at once. A hunt that asks one source at a
    // time takes as long as the slowest one multiplied by the number of them.
    const work = [];
    for (const term of queries) {
      tried.push(term);
      for (const name of wanted) {
        work.push(
          SOURCES[name].run(term, { agentId, runId })
            .then((hits) => { for (const h of hits || []) roundHits.push({ ...h, via: term }); })
            // A source that is down, unconfigured or rate-limited is a fact
            // about that source. It must not end the hunt — the answer may be
            // sitting in one of the others.
            .catch((e) => roundErrors.push({ source: name, error: String(e.message).slice(0, 140) })),
        );
      }
    }
    await Promise.all(work);

    for (const h of roundHits) {
      if (seen.has(key(h))) continue;
      seen.add(key(h));
      // Anything from outside is checked before a model reads it. A search
      // result is untrusted text, and this loop feeds it straight to a model
      // that is deciding what to do next.
      if (h.source === 'web') {
        const scan = scanForInjection(`${h.title} ${h.snippet}`);
        if (scan.hit) { h.quarantined = scan.pattern; h.snippet = '[withheld: this page tries to give instructions]'; }
      }
      found.push(h);
    }

    const judgement = await assess({ question, found, tried, round, agentId });
    spent += judgement.costUsd;

    trail.push({
      round, queries: [...queries], newHits: found.length - before,
      sources: wanted.length, errors: roundErrors,
      answered: judgement.answered, confidence: judgement.confidence,
      missing: judgement.missing, next: judgement.next, costUsd: Number(judgement.costUsd.toFixed(4)),
    });
    exec('INSERT INTO hunt_rounds (hunt_id, round, queries, hits, verdict, note) VALUES (?,?,?,?,?,?)',
      id, round, queries.join(' | '), found.length - before,
      judgement.answered ? 'answered' : 'keep going', judgement.missing || null);

    if (judgement.answered) { verdict = judgement; stopped = 'found'; break; }
    if (spent >= maxUsd) { stopped = `stopped at the ${maxUsd} cap`; break; }
    if (!judgement.next.length) { stopped = 'the trail went cold — nothing new left to ask'; break; }

    // Only genuinely new queries. Re-asking a term already asked burns a round
    // and returns the same rows, which is how a loop convinces itself it is
    // still working.
    queries = judgement.next.filter((n) => !tried.some((t) => t.toLowerCase() === n.toLowerCase()));
    if (!queries.length) { stopped = 'every lead had already been followed'; break; }
  }

  const result = {
    id,
    question,
    // Found or not found. There is no third state, and in particular there is
    // no "here is my best guess" — that is the failure this whole design is
    // arranged against.
    found: Boolean(verdict),
    answer: verdict?.answer || null,
    confidence: verdict?.confidence || 0,
    citations: (verdict?.citations || []).map((n) => found[n - 1]).filter(Boolean).map((h) => ({
      source: h.source, where: h.where, id: h.id, title: h.title, url: h.url || null,
    })),
    stopped,
    rounds: trail.length,
    sourcesAsked: wanted.map((w) => SOURCES[w].label),
    queriesTried: tried,
    evidence: found.slice(0, 60),
    trail,
    costUsd: Number(spent.toFixed(4)),
    // Said plainly rather than left to be inferred from an empty array.
    say: verdict
      ? `Found after ${trail.length} round(s).`
      : `Not found. ${trail.length} round(s) across ${wanted.length} source(s), ${tried.length} quer(y/ies) tried. ${stopped}.`,
  };

  exec(
    `UPDATE hunts SET state = ?, answer = ?, confidence = ?, rounds = ?, cost_usd = ?, stopped = ?, finished_at = datetime('now') WHERE id = ?`,
    result.found ? 'found' : 'not-found', result.answer, result.confidence, result.rounds, result.costUsd, stopped, id,
  );
  audit({
    actorType: actor.startsWith('agent:') ? 'agent' : 'human', actorId: actor, action: 'hunt.finished',
    subjectType: 'hunt', subjectId: String(id),
    payload: {
      question: question.slice(0, 200), found: result.found, rounds: result.rounds,
      queries: tried.length, costUsd: result.costUsd, stopped,
    },
  });
  if (!result.found) {
    notify({
      level: 'info', source: 'research',
      message: `Hunt ${id} did not find it: ${question.slice(0, 90)}`,
      subjectType: 'hunt', subjectId: String(id),
    });
  }
  return result;
}

// ---------------------------------------------------------------- read-side --

/** One shallow pass across everything. Instant, free, and honest about it. */
export function lookup(term, { limit = 40 } = {}) {
  const t = String(term || '').trim();
  if (!t) return { term: t, hits: [] };
  const hits = [
    ...searchRecords(t, { limit }),
    ...semanticSearch(t, { k: 6 }).map((n) => ({ source: 'graph', where: n.kind, id: n.id, title: n.label || n.id, snippet: (n.summary || '').slice(0, 200) })),
    ...memorySearch(t, { limit: 6 }).map((m) => ({ source: 'memory', where: m.kind, id: m.id, title: m.title, snippet: (m.body || '').slice(0, 200) })),
  ];
  const by = {};
  for (const h of hits) (by[h.source] ||= []).push(h);
  return {
    term: t, total: hits.length, bySource: by, hits: hits.slice(0, limit),
    tablesSearched: searchableTables().length,
    // The difference is the whole point of having both.
    note: 'One pass. If this did not find it, a hunt keeps going and follows what it learns.',
  };
}

export function huntsList({ limit = 30 } = {}) {
  return q('SELECT * FROM hunts ORDER BY id DESC LIMIT ?', limit);
}

export function huntDetail(id) {
  const h = one('SELECT * FROM hunts WHERE id = ?', id);
  if (!h) { const e = new Error('no such hunt'); e.status = 404; throw e; }
  return { ...h, rounds: q('SELECT * FROM hunt_rounds WHERE hunt_id = ? ORDER BY round', id) };
}

export function huntOverview() {
  const total = one('SELECT COUNT(*) AS n FROM hunts').n;
  const found = one("SELECT COUNT(*) AS n FROM hunts WHERE state = 'found'").n;
  return {
    tablesSearched: searchableTables().length,
    sources: Object.entries(SOURCES).map(([k, s]) => ({ key: k, label: s.label, reachesOutside: s.external })),
    maxRounds: Number(getSetting('HUNT_MAX_ROUNDS') || 6),
    maxUsd: Number(getSetting('HUNT_MAX_USD') || 2),
    total,
    found,
    // The rate is worth showing even when it is bad — especially when it is bad.
    foundRate: total ? Math.round((found / total) * 100) : null,
    spentUsd: Number((one('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM hunts').c || 0).toFixed(2)),
    recent: q('SELECT id, question, state, rounds, cost_usd, stopped, finished_at FROM hunts ORDER BY id DESC LIMIT 12'),
  };
}
