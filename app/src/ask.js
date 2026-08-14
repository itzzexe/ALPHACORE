// Ask AlphaCore — one input in front of a hundred and forty departments.
//
// This adds no intelligence. It is a router, and it routes to three things
// that already existed and were each hidden behind a different page: the
// request desk, which opens work across departments; the hunt, which goes and
// finds out; and asking a named employee directly. The only new idea here is
// that a person should not have to know which of those three they wanted
// before they are allowed to type.
//
// Two rules govern the whole file, and both are about not being clever:
//
//   No model call. Routing is regex over the words typed. A classifier that
//   costs money and takes two seconds to decide which page to open is worse
//   than the menu it replaced, and it fails in ways nobody can read.
//
//   Read-only by default. The instant answer is a search: it costs nothing,
//   changes nothing, and is usually what the person wanted. Anything that
//   spends money or creates work — a hunt, a request, a message to an
//   employee — comes back as a proposal with the exact call attached, and a
//   person presses the button. Guessing wrong about a search wastes a
//   millisecond; guessing wrong about a request opens work in four
//   departments.
import { one } from './db.js';
import { audit } from './audit.js';
import { lookup } from './hunt.js';
import { sectionCatalog, surfaceOf } from './links.js';

/**
 * The routing table. Order matters: the first rule that matches wins.
 *
 * Written as data so it can be read by a person and served by the API — the
 * rules that decide where a question goes should not be something you have to
 * read JavaScript to discover. `GET /api/ask` returns this.
 */
export const RULES = [
  {
    id: 'directed',
    target: 'employee',
    // "ask legal whether…", "@AGT-LEG-001 what do you think"
    test: /(?:^|\s)@?(AGT-[A-Z]{2,4}-\d{3})\b|^\s*(?:ask|tell|check with)\s+(?:the\s+)?([a-z]{3,20})\b/i,
    why: 'it names an employee or a department, so it is a question for them rather than a search',
  },
  {
    id: 'make',
    target: 'request',
    // Imperatives that produce work. Deliberately narrow: a verb list that
    // grows to cover every phrasing ends up catching questions too, and the
    // cost of a false positive here is work opened in several departments.
    test: /^\s*(?:please\s+)?(?:build|create|write|draft|make|set\s?up|launch|send|publish|fix|plan|prepare|design|hire|buy|pay|schedule|migrate|open|start|run\s+a|organise|organize)\b/i,
    why: 'it asks for something to be done, which is what the request desk routes department to department',
  },
  {
    id: 'investigate',
    target: 'hunt',
    // Questions the company's own records cannot answer on their own.
    test: /\b(?:research|investigate|compare|competitors?|market|industry|find\s+(?:me\s+)?\d+|list\s+\d+|leads?|prospects?|who\s+(?:are|is)\s+the\b|latest\s+news)\b/i,
    why: 'it needs more than one pass and may need the open web, which is what a hunt is for',
  },
  {
    id: 'lookup',
    target: 'lookup',
    test: /.*/,
    why: 'anything else is answered from the records first — it is instant, it costs nothing, and it is usually enough',
  },
];

/**
 * Which department a search hit belongs to.
 *
 * Declared rather than guessed. Most tables share a name with their department
 * and a regex would get those right, but it would also confidently mislabel the
 * ones that do not — `deals` is Sales, `tickets` is Support — and a wrong
 * department name on an answer is worse than none. Anything unlisted reports
 * the table it came from, which is honest and not a claim.
 */
const TABLE_DEPARTMENT = {
  customers: 'customers', deals: 'sales', tickets: 'support', incidents: 'incidents',
  campaigns: 'marketing', products: 'products', projects: 'projects', tasks: 'tasks',
  runs: 'runs', agents: 'agents', requests: 'requests', intel_records: 'intel',
  intel_contacts: 'intel', partners: 'partnerships', vendors: 'vendors', invoices: 'money',
  journal_entries: 'ledger', decisions: 'decisions', risks: 'risks', blueprints: 'systems',
  posts: 'social', content_items: 'content', designs: 'design', archive_items: 'archive',
  mem_docs: 'memory', chat_messages: 'chat', calls: 'contact', sms_messages: 'contact',
  connectors: 'connectors', jobs: 'jobs', pipelines: 'pipelines', people: 'people',
};

const clean = (s) => String(s || '').trim().slice(0, 600);

/** The first rule that matches. Never null — the last rule matches everything. */
export function classify(text) {
  const t = clean(text);
  for (const rule of RULES) {
    const m = t.match(rule.test);
    if (m) return { ...rule, match: m };
  }
  return RULES[RULES.length - 1];
}

/** An employee id or a department name, if the question named one. */
function directedAt(match) {
  const agentId = match?.[1];
  if (agentId) {
    const a = one('SELECT id, name, role_group FROM agents WHERE id = ?', String(agentId).toUpperCase());
    if (a) return { kind: 'agent', id: a.id, label: a.name || a.id };
  }
  const word = match?.[2];
  if (word) {
    const dept = sectionCatalog().find((s) => s.id === String(word).toLowerCase());
    if (dept) return { kind: 'department', id: dept.id, label: dept.label };
  }
  return null;
}

/**
 * Answer what can be answered for free, and propose the rest.
 *
 * Every ask gets the instant lookup, whatever it was routed to — a question
 * that turns out to be answerable from the records should not need a hunt, and
 * the person can see that for themselves before spending anything.
 */
export function ask(text, { actor = 'human:unknown' } = {}) {
  const question = clean(text);
  if (!question) {
    const e = new Error('type something to ask');
    e.status = 400;
    throw e;
  }

  const rule = classify(question);
  const directed = rule.target === 'employee' ? directedAt(rule.match) : null;
  // A question that named a department nobody has heard of is not a message to
  // an employee; it is a search that happened to start with the word "ask".
  const target = rule.target === 'employee' && !directed ? 'lookup' : rule.target;

  const found = lookup(question, { limit: 12 });
  const hits = found.hits || [];

  // Which departments actually produced the answer, plus whichever one the
  // proposal would involve. The map already knows; this reads it.
  const departments = [...new Set([
    ...hits.map((h) => TABLE_DEPARTMENT[h.where] || null).filter(Boolean),
    ...(directed?.kind === 'department' ? [directed.id] : []),
    ...(target === 'request' ? ['requests'] : []),
    ...(target === 'hunt' ? ['hunt'] : []),
    ...(target === 'employee' ? ['chat'] : []),
  ])].map((id) => {
    const s = sectionCatalog().find((x) => x.id === id);
    return { id, label: s?.label || id, href: s?.href || `#/${id}`, surface: surfaceOf(id) };
  });

  // The proposal. Never executed here: it carries the exact call so the console
  // can make it after a person has read what it would do.
  const next = {
    lookup: null,
    hunt: {
      what: 'Run a hunt', endpoint: 'POST /api/hunt', body: { question, actor },
      cost: 'spends model budget, and may fetch pages from the open web',
    },
    request: {
      what: 'Open a request', endpoint: 'POST /api/requests',
      body: { title: question.slice(0, 120), body: question, actor },
      cost: 'opens work that routes department to department until it is done',
    },
    employee: directed?.kind === 'agent'
      ? {
        what: `Ask ${directed.label}`, endpoint: 'POST /api/chat/dm',
        body: { actor, with: directed.id },
        cost: 'starts a conversation and enqueues a run for them to answer',
      }
      : null,
  }[target];

  audit({
    actorType: 'human', actorId: actor, action: 'ask.routed',
    subjectType: 'ask', subjectId: rule.id,
    // The question itself is not recorded. It is typed by a person, may name
    // anybody, and the chain cannot forget.
    payload: { rule: rule.id, target, hits: hits.length, departments: departments.map((d) => d.id) },
  });

  return {
    question,
    route: { rule: rule.id, target, why: rule.why, directedAt: directed },
    answer: {
      total: found.total || 0,
      hits: hits.slice(0, 12),
      tablesSearched: found.tablesSearched || 0,
    },
    departments,
    next,
    note: 'The search above already ran and cost nothing. Anything that spends money or opens work is a '
      + 'proposal until you press the button — routing is done by reading the words you typed, not by asking a model, '
      + 'so it is occasionally wrong and never expensively wrong.',
  };
}

/** The rules, so they can be read rather than reverse-engineered. */
export function askRules() {
  return {
    rules: RULES.map((r) => ({ id: r.id, target: r.target, why: r.why, pattern: String(r.test) })),
    targets: {
      lookup: 'One pass over every table, the knowledge graph and memory. Instant, free, read-only.',
      hunt: 'A research campaign that keeps going and follows what it learns. Costs model budget.',
      request: 'Work opened on the request desk, routed department to department until it is done.',
      employee: 'A direct question to one named AI employee.',
    },
    note: 'First match wins, and the last rule matches everything. Routing is regex over the words typed — no model '
      + 'call, so it is fast, free and legible. The default is the read-only one on purpose.',
  };
}
