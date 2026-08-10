// The help centre — documentation for the people who bought the product.
//
// Not the academy, which trains the workforce, and not support, which answers
// one person at a time. The distinction is worth a department because the two
// are measured differently: support is judged on how fast it replies, and this
// is judged on how many replies never had to be written.
//
// The link that makes it pay for itself is the gap: a question that keeps
// arriving and has no article. Support raises them without being asked, and an
// article that closes one carries the ticket it came from, so "does the
// documentation work" is a number rather than an opinion.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { enqueueRun } from './workflow.js';

const clean = (s, n = 20000) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const slugify = (s) => String(s).toLowerCase().normalize('NFKD')
  .replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `article-${Date.now()}`;

// ------------------------------------------------------------------- gaps --

/**
 * A ticket arrived that the documentation did not answer.
 *
 * Matched on a normalised question so the same thing asked twenty ways counts
 * as one gap with a count of twenty, which is the number that decides what to
 * write next.
 */
export function noteGap({ question, category = null, ticketId = null }) {
  const text = clean(question, 300);
  if (!text) return null;
  const key = text.toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const existing = q('SELECT * FROM help_gaps ORDER BY id DESC LIMIT 300')
    .find((g) => g.question.toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, ' ').replace(/\s+/g, ' ').trim() === key);
  if (existing) {
    exec("UPDATE help_gaps SET seen = seen + 1, last_ticket = COALESCE(?, last_ticket), updated_at = datetime('now') WHERE id = ?",
      ticketId, existing.id);
    return one('SELECT * FROM help_gaps WHERE id = ?', existing.id);
  }
  exec('INSERT INTO help_gaps (question, category, last_ticket) VALUES (?,?,?)', text, clean(category, 60) || null, ticketId);
  return one('SELECT * FROM help_gaps WHERE id = last_insert_rowid()');
}

/**
 * Sweep support for questions that keep coming back.
 *
 * Runs over tickets rather than waiting to be told, because the department that
 * knows a question is repeating is the one too busy answering it.
 */
export function sweepTickets() {
  const rows = q("SELECT id, subject, category FROM tickets ORDER BY id DESC LIMIT 200");
  let raised = 0;
  for (const t of rows) {
    const g = noteGap({ question: t.subject, category: t.category, ticketId: t.id });
    if (g && g.seen === 1) raised++;
  }
  const repeated = q("SELECT COUNT(*) AS n FROM help_gaps WHERE seen >= 3 AND state = 'open'").n;
  if (raised) {
    audit({
      actorType: 'system', actorId: 'system:helpcentre', action: 'help.gaps_swept',
      subjectType: 'help', subjectId: 'sweep', payload: { newGaps: raised, repeatedUnanswered: repeated },
    });
  }
  return { newGaps: raised, repeatedUnanswered: repeated };
}

/** Ask an employee to draft the article for a gap. A person still publishes it. */
export function draftForGap({ id, actor, agentId = 'AGT-DOC-001' }) {
  if (!actor) refuse('a draft has to name who asked for it');
  const gap = one('SELECT * FROM help_gaps WHERE id = ?', id);
  if (!gap) refuse('no such gap');
  const runId = enqueueRun({
    agentId,
    taskType: 'help.article',
    input: {
      question: gap.question,
      category: gap.category,
      askedTimes: gap.seen,
      instruction: 'Write a help-centre article that answers this question for a customer. '
        + 'Plain language, steps in order, no internal detail, no promises about future features.',
    },
    actor,
  });
  exec("UPDATE help_gaps SET state = 'drafted', updated_at = datetime('now') WHERE id = ?", id);
  audit({
    actorType: 'human', actorId: actor, action: 'help.draft_requested',
    subjectType: 'help_gap', subjectId: id, payload: { question: gap.question, runId, agentId },
  });
  return { runId };
}

// --------------------------------------------------------------- articles --

export function write({
  title, body, audience = 'customer', productId = null, locale = 'en',
  sourceGap = null, runId = null, actor,
}) {
  if (!actor) refuse('an article has to name its author');
  if (!title || !body) refuse('an article needs a title and a body');
  const slug = slugify(title);
  const taken = one('SELECT id FROM help_articles WHERE slug = ?', slug);
  exec(`INSERT INTO help_articles (slug, title, body, audience, locale, product_id, source_gap, run_id, author)
        VALUES (?,?,?,?,?,?,?,?,?)`,
  taken ? `${slug}-${Date.now().toString(36)}` : slug, clean(title, 200), clean(body),
  audience, clean(locale, 8), clean(productId, 40) || null, sourceGap, clean(runId, 60) || null, actor);
  const a = one('SELECT * FROM help_articles WHERE id = last_insert_rowid()');
  if (sourceGap) exec('UPDATE help_gaps SET article_id = ?, state = ? WHERE id = ?', a.id, 'drafted', sourceGap);
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'help.article_written', subjectType: 'help_article', subjectId: a.id,
    payload: { slug: a.slug, audience, sourceGap },
  });
  return a;
}

/**
 * Publishing is a human act.
 *
 * This text is read by customers and is, in practice, a promise about how the
 * product behaves. An employee can write it; a person puts the company's name
 * on it — the same rule as everything else that leaves the building.
 */
export function publish({ id, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('an article is published by a person');
  const a = one('SELECT * FROM help_articles WHERE id = ?', id);
  if (!a) refuse('no such article');
  exec("UPDATE help_articles SET state = 'published', published_at = datetime('now') WHERE id = ?", id);
  if (a.source_gap) exec("UPDATE help_gaps SET state = 'answered', updated_at = datetime('now') WHERE id = ?", a.source_gap);
  audit({
    actorType: 'human', actorId: actor, action: 'help.published',
    subjectType: 'help_article', subjectId: id, payload: { slug: a.slug, title: a.title },
  });
  return one('SELECT * FROM help_articles WHERE id = ?', id);
}

/** What a customer would see. Published, customer-facing, nothing else. */
export function publicIndex({ locale = null } = {}) {
  return q(`SELECT slug, title, product_id, published_at FROM help_articles
             WHERE state = 'published' AND audience = 'customer'
               ${locale ? 'AND locale = ?' : ''}
             ORDER BY published_at DESC LIMIT 200`, ...(locale ? [locale] : []));
}

export function read({ slug }) {
  const a = one("SELECT * FROM help_articles WHERE slug = ? AND state = 'published'", slug);
  if (!a) return null;
  exec('UPDATE help_articles SET views = views + 1 WHERE id = ?', a.id);
  return a;
}

/** Somebody found an article instead of writing a ticket. That is the whole point. */
export function deflected({ slug }) {
  exec('UPDATE help_articles SET deflections = deflections + 1 WHERE slug = ?', slug);
  return { ok: true };
}

export function overview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    articles: q('SELECT * FROM help_articles ORDER BY id DESC LIMIT 200'),
    published: n("SELECT COUNT(*) AS n FROM help_articles WHERE state = 'published'"),
    drafts: n("SELECT COUNT(*) AS n FROM help_articles WHERE state IN ('draft','review')"),
    gaps: q("SELECT * FROM help_gaps WHERE state IN ('open','drafted') ORDER BY seen DESC, id DESC LIMIT 100"),
    openGaps: n("SELECT COUNT(*) AS n FROM help_gaps WHERE state = 'open'"),
    repeated: n("SELECT COUNT(*) AS n FROM help_gaps WHERE state = 'open' AND seen >= 3"),
    views: one('SELECT COALESCE(SUM(views),0) AS t FROM help_articles').t,
    deflections: one('SELECT COALESCE(SUM(deflections),0) AS t FROM help_articles').t,
    tickets: n('SELECT COUNT(*) AS n FROM tickets'),
  };
}
