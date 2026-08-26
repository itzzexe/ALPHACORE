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
  // --- the enterprise galaxy, in both languages -------------------------
  //
  // These answer from Core 2's record directly, and they answer with counts
  // and pointers rather than personal detail: "who is absent" gets names and
  // numbers of people — org facts — never a leave type, never a reason,
  // because the reason does not exist in any schema to begin with.
  {
    id: 'attendance',
    target: 'core2',
    test: /\b(?:absent|attendance|who\s+is\s+(?:in|out|away)|on\s+leave\s+today)\b|غايب|غائب|الحضور|الغياب|بالدوام|في الدوام/i,
    why: 'today\'s attendance is a fact the record holds — answered from Core 2, instantly',
  },
  {
    id: 'leave',
    target: 'core2',
    test: /\b(?:leave\s+(?:request|balance|pending)|pending\s+leave|vacation\s+balance)\b|إجاز|رصيد الاجاز/i,
    why: 'leave lives in the record; what waits on a manager is a count, not a search',
  },
  {
    id: 'payroll',
    target: 'core2',
    test: /\b(?:payroll|salaries|salary\s+run|payslip)\b|رواتب|الراتب|قسيمة/i,
    why: 'payroll is pointed at, never quoted — slips are sealed and the screen is permission-checked',
  },
  {
    id: 'contracts',
    target: 'core2',
    test: /\b(?:contracts?\s+(?:expiring|expire|renewal)|expiring\s+contracts?)\b|عقود تنتهي|انتهاء العقود|تجديد العقود/i,
    why: 'the contract watch already knows what lapses soon',
  },
  {
    id: 'cash',
    target: 'core2',
    test: /\b(?:cash\s+position|bank\s+balance|how\s+much\s+(?:cash|money)\s+(?:do\s+we\s+have|in\s+the\s+bank)|in\s+the\s+bank)\b|رصيد البنك|كم عندنا فلوس|النقد|الصندوق/i,
    why: 'the cash position is the ledger\'s balance per account — a reading, not a search',
  },
  {
    id: 'stock',
    target: 'core2',
    test: /\b(?:stock\s+levels?|low\s+stock|inventory|out\s+of\s+stock|in\s+the\s+warehouse)\b|المخزون|المستودع|ناقص من المخزن/i,
    why: 'a stock level is the sum of its moves, answered from the record',
  },
  {
    id: 'tickets',
    target: 'core2',
    test: /\b(?:help\s*desk|open\s+tickets|it\s+tickets|sla\s+breach)\b|تذاكر الدعم|الهيلب ديسك|تذاكر مفتوحة/i,
    why: 'open help-desk tickets and breached SLAs are counts the desk already keeps',
  },
  {
    id: 'owed',
    target: 'core2',
    test: /\b(?:overdue\s+(?:bills|invoices)|what\s+do\s+we\s+owe|who\s+owes\s+us|payables|receivables|unpaid\s+invoices)\b|الذمم|الفواتير المتأخرة|شنو علينا|منو عليه/i,
    why: 'aging is computed from the sub-ledgers, not searched for',
  },
  {
    id: 'obligations',
    target: 'core2',
    test: /\b(?:obligations?\s+due|licen[cs]es?\s+expiring|regulatory\s+calendar|what\s+is\s+due\s+this\s+month)\b|الالتزامات|الرخص|التراخيص|انتهاء الرخصة/i,
    why: 'the regulatory calendar knows what is due and what lapses',
  },
  {
    id: 'lookup',
    target: 'lookup',
    test: /.*/,
    why: 'anything else is answered from the records first — it is instant, it costs nothing, and it is usually enough',
  },
];

/**
 * The Core 2 answers, computed rather than searched.
 *
 * Loaded lazily so ask.js does not import the enterprise modules until an
 * enterprise question arrives. What each answer contains is deliberate:
 * attendance gives names and counts (org facts), leave gives counts and a
 * pointer, payroll gives only a pointer — the slips are sealed, and an answer
 * box must never become the hole in that seal.
 */
async function core2Answer(ruleId) {
  const { attendanceToday, timeOverview } = await import('./core2/time.js');
  const { payopsOverview } = await import('./core2/payops.js');
  const { listExpiring } = await import('./core2/procure.js');
  switch (ruleId) {
    case 'attendance': {
      const a = attendanceToday();
      return {
        headline: `${a.present} in, ${a.absent} absent, ${a.onLeave} on leave`,
        rows: a.people.filter((p) => !p.in && !p.onLeave).map((p) => ({ title: p.display_name, sub: 'absent' })),
        href: '#/time',
      };
    }
    case 'leave': {
      const o = timeOverview();
      return { headline: `${o.pending} request(s) waiting on a manager`, rows: [], href: '#/time' };
    }
    case 'payroll': {
      const o = payopsOverview();
      const last = o.runs[0];
      return {
        headline: last ? `latest run ${last.period} is ${last.state}` : 'no payroll run yet',
        rows: [], href: '#/finops2',
        note: 'slips are sealed; the screen behind this link is permission-checked',
      };
    }
    case 'contracts': {
      const soon = listExpiring({ horizonDays: 90 });
      return {
        headline: `${soon.length} contract(s) expire inside ninety days`,
        rows: soon.slice(0, 8).map((c) => ({ title: c.title, sub: c.expires_at })),
        href: '#/procure',
      };
    }
    case 'cash': {
      const { cashPosition } = await import('./core2/bank.js');
      const p = cashPosition();
      return {
        headline: `${p.accounts.length} account(s), ${p.total.toFixed(2)} on the ledger`,
        rows: p.accounts.map((a) => ({ title: a.name, sub: `${a.ledger.toFixed(2)} ${a.currency}${a.unmatched ? ` · ${a.unmatched} unmatched` : ''}` })),
        href: '#/bank',
      };
    }
    case 'stock': {
      const { stockLevels } = await import('./core2/ops.js');
      const rows = stockLevels();
      const low = rows.filter((r) => r.low);
      return {
        headline: `${rows.length} item(s), ${low.length} below minimum`,
        rows: (low.length ? low : rows).slice(0, 8).map((r) => ({ title: `${r.sku} — ${r.name}`, sub: `${r.level} ${r.unit}${r.low ? ' · low' : ''}` })),
        href: '#/inventory',
      };
    }
    case 'tickets': {
      const { listTickets } = await import('./core2/ops.js');
      const open = listTickets().filter((t) => !['resolved', 'closed'].includes(t.state));
      return {
        headline: `${open.length} open ticket(s), ${open.filter((t) => t.breached).length} past SLA`,
        rows: open.slice(0, 8).map((t) => ({ title: `${t.ref} — ${t.title}`, sub: `${t.priority} · ${t.state}` })),
        href: '#/helpdesk',
      };
    }
    case 'owed': {
      const { apAging, arAging } = await import('./core2/finance.js');
      const ap = apAging(); const ar = arAging();
      return {
        headline: `we owe ${ap.total.toFixed(2)} on ${ap.count} bill(s); we are owed ${ar.total.toFixed(2)} on ${ar.count} invoice(s)`,
        rows: [
          { title: 'Payables overdue', sub: `${(ap.d30 + ap.d60 + ap.d90).toFixed(2)}` },
          { title: 'Receivables overdue', sub: `${(ar.d30 + ar.d60 + ar.d90).toFixed(2)}` },
        ],
        href: '#/payables',
      };
    }
    case 'obligations': {
      const { listObligations, listLicenses } = await import('./core2/admin.js');
      const due = listObligations().filter((o) => o.state !== 'done').slice(0, 6);
      const lic = listLicenses().filter((l) => l.state === 'active').slice(0, 4);
      return {
        headline: `${due.length} obligation(s) pending, ${lic.length} licence(s) on file`,
        rows: [...due.map((o) => ({ title: o.title, sub: `${o.authority} · due ${o.due}${o.state === 'overdue' ? ' · overdue' : ''}` })),
          ...lic.map((l) => ({ title: l.name, sub: `${l.authority} · expires ${l.expires}` }))],
        href: '#/regulatory',
      };
    }
    default: return null;
  }
}

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
  // The enterprise galaxy's tables, so a hit on a person or a purchase names
  // the Core 2 department it lives in rather than the table it came from.
  hr_person: 'workforce2', hr_employee: 'workforce2', hr_org_unit: 'orgchart',
  time_overtime: 'hrops', time_shift: 'hrops', hr_allowance: 'comp', hr_benefit_plan: 'comp', hr_grievance: 'comp',
  fin_budget: 'budgets2', fin_ap_bill: 'payables', fin_ar_invoice: 'receivables', fin_fixed_asset: 'fixedassets',
  bank_account: 'bank', bank_transfer: 'bank', bank_cheque: 'bank', bank_payment_batch: 'bank',
  ops_item: 'inventory', ops_warehouse: 'inventory', ops_workorder: 'facilities', ops_vehicle: 'facilities', ops_room: 'facilities',
  ops_ticket: 'helpdesk', ops_incident: 'helpdesk', adm_letter: 'secretariat', adm_committee: 'secretariat', adm_resolution: 'secretariat',
  adm_case: 'legalcases', adm_obligation: 'regulatory', adm_license: 'regulatory',
  rec_application: 'talent2', rec_vacancy: 'talent2', mtg_meeting: 'meetings',
  time_leave_request: 'time', fin_expense: 'finops2', proc_request: 'procure', doc_document: 'docs',
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
export async function ask(text, { actor = 'human:unknown' } = {}) {
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

  // An enterprise question is answered from the record, not searched for.
  const core2 = target === 'core2' ? await core2Answer(rule.id) : null;

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
    ...(core2 ? [core2.href.replace('#/', '')] : []),
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
    core2,
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
