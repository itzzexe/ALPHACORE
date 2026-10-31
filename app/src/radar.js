// The horizon radar — the subjects a founder keeps an eye on, and what the
// world is doing about each of them.
//
// A subject is a few words: a technology, a market, a competitor, an idea.
// For each one the radar reads five things, every one a free public service
// through the gate: how much attention the public pays it (ninety days of
// Wikipedia page views), what builders posted about it this month (Hacker
// News), the newest research (arXiv), the open-source projects started on it
// this quarter (GitHub), and who is hiring for it (the companies that named it
// in this month's "Who is hiring?" thread). Nothing is
// summarised by a model: the page shows what was read, with its time.
//
// A signal is a change somebody would want to be told about — attention up
// by half again in a week, a story the whole technical world is discussing, a
// project that collected hundreds of stars in its first months, a subject
// suddenly hiring. Signals are computed from the reads by thresholds written
// here, kept one per subject, kind and day, and the strongest reach the
// notification tray.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { isLive, pull, read, frontpage } from './livedata.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const SYSTEM = 'system:radar';
const MAX_TOPICS = 24;
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wikipedia's title for a subject when nobody gave one: first letter up, spaces as underscores. */
export const titleFor = (query) => { const s = String(query || '').trim(); return s ? (s[0].toUpperCase() + s.slice(1)).replace(/\s+/g, '_') : ''; };

export function addTopic({ query, wikiTitle = null, lang = 'en', note = null, actor }) {
  if (!isHuman(actor)) refuse('a person chooses what to watch', 403);
  const qs = String(query || '').trim().replace(/\s+/g, ' ');
  if (qs.length < 2 || qs.length > 80) refuse('a subject is two to eighty characters');
  if (one("SELECT id FROM radar_topics WHERE lower(query) = lower(?) AND state = 'watching'", qs)) refuse('that subject is already on the radar', 409);
  if (one("SELECT COUNT(*) AS n FROM radar_topics WHERE state = 'watching'").n >= MAX_TOPICS) refuse(`the radar watches at most ${MAX_TOPICS} subjects — archive one first`, 409);
  const title = String(wikiTitle || '').trim().replace(/\s+/g, '_').slice(0, 200) || titleFor(qs);
  const r = exec('INSERT INTO radar_topics (query, wiki_title, lang, note, created_by) VALUES (?,?,?,?,?)', qs, title, lang === 'ar' ? 'ar' : 'en', note || null, actor);
  const id = Number(r.lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'radar.watch', subjectType: 'radar_topic', subjectId: String(id), payload: { query: qs, wikiTitle: title } });
  return topicRow(id);
}

export function updateTopic({ id, wikiTitle, note, actor }) {
  if (!isHuman(actor)) refuse('a person changes what is watched', 403);
  const t = topicRow(id);
  const title = wikiTitle != null ? String(wikiTitle).trim().replace(/\s+/g, '_').slice(0, 200) || titleFor(t.query) : t.wiki_title;
  exec('UPDATE radar_topics SET wiki_title = ?, note = ? WHERE id = ?', title, note !== undefined ? note || null : t.note, t.id);
  audit({ actorType: 'human', actorId: actor, action: 'radar.topic_updated', subjectType: 'radar_topic', subjectId: String(t.id), payload: { wikiTitle: title } });
  return topicRow(t.id);
}

export function archiveTopic({ id, actor }) {
  if (!isHuman(actor)) refuse('a person stops watching', 403);
  const t = topicRow(id);
  exec("UPDATE radar_topics SET state = 'archived' WHERE id = ?", t.id);
  audit({ actorType: 'human', actorId: actor, action: 'radar.archived', subjectType: 'radar_topic', subjectId: String(t.id), payload: { query: t.query } });
  return { archived: t.id };
}

function topicRow(id) { return one('SELECT * FROM radar_topics WHERE id = ?', Number(id)) || refuse('no such subject', 404); }

// ------------------------------------------------------------------ reads --

/** The five reads of one subject. Each is asked only when its last answer has aged out. */
async function readTopic(t, { actor = SYSTEM, force = false } = {}) {
  const key = `t${t.id}`;
  const opt = { actor, force, reason: `the radar on "${t.query.slice(0, 60)}"` };
  await pull('attention', `${key}:${t.lang}:${t.wiki_title}`, { title: t.wiki_title, lang: t.lang }, opt);
  await pull('stories', key, { query: t.query }, opt);
  await pull('papers', key, { query: t.query }, opt);
  // GitHub's search allows ten calls a minute without a key; the radar keeps well under.
  await pull('repos', key, { query: t.query }, opt);
  await pull('jobs', key, { query: t.query }, opt);
}

let running = false;
/** Every subject on the radar, then the signals. The clock calls this; so does a person's "read now". */
export async function refresh({ actor = SYSTEM, force = false, topicId = null } = {}) {
  if (!isLive()) return { skipped: 'live data is off' };
  if (running) return { skipped: 'already reading' };
  running = true;
  try {
    const topics = topicId ? [topicRow(topicId)] : q("SELECT * FROM radar_topics WHERE state = 'watching' ORDER BY id");
    for (const t of topics) {
      await readTopic(t, { actor, force });
      if (topics.length > 1) await sleep(400);
    }
    const found = detect();
    return { topics: topics.length, signals: found.length };
  } finally {
    running = false;
  }
}

export async function readNow({ id, actor }) {
  if (!isHuman(actor)) refuse('a person asks for a fresh read', 403);
  if (!isLive()) refuse('live data is off — a person switches it on first', 409);
  await refresh({ actor, force: true, topicId: id });
  return topic(id);
}

const avg = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);

/** Last week against the four before it. Below a floor of daily readers a ratio is noise. */
export function attentionTrend(series) {
  const v = (series || []).map(([, n]) => Number(n) || 0);
  if (v.length < 35) return null;
  const week = avg(v.slice(-7)); const before = avg(v.slice(-35, -7));
  return { week: Math.round(week), before: Math.round(before), ratio: before >= 20 ? Math.round((week / before) * 100) / 100 : null, total: v.reduce((a, x) => a + x, 0) };
}

/** What each subject's reads say, from the cache only. */
export function summary(t) {
  const key = `t${t.id}`;
  const att = read('attention', `${key}:${t.lang}:${t.wiki_title}`);
  const st = read('stories', key); const pa = read('papers', key); const re = read('repos', key); const jo = read('jobs', key);
  return {
    attention: att?.data ? { series: att.data.series || [], missing: Boolean(att.data.missing), trend: attentionTrend(att.data.series), fetchedAt: att.fetchedAt } : null,
    stories: st?.data ? { total: st.data.total, top: st.data.stories || [], fetchedAt: st.fetchedAt } : null,
    papers: pa?.data ? { total: pa.data.total, latest: pa.data.papers || [], fetchedAt: pa.fetchedAt } : null,
    repos: re?.data ? { total: re.data.total, top: re.data.repos || [], fetchedAt: re.fetchedAt } : null,
    jobs: jo?.data ? { count: jo.data.count, remote: jo.data.remote ?? null, thread: jo.data.thread || null, companies: jo.data.companies || [], regions: jo.data.regions || [], withPay: jo.data.withPay || [], latest: jo.data.latest || [], fetchedAt: jo.fetchedAt } : null,
    errors: [att, st, pa, re, jo].map((x) => x?.error).filter(Boolean),
  };
}

/** The thresholds a signal is measured against. */
export const THRESHOLDS = { rising: 1.5, falling: 0.6, hotStory: 150, breakout: 500, hiring: 20 };

export function signalsFor(t, s) {
  const out = [];
  const tr = s.attention?.trend;
  if (tr?.ratio != null && tr.ratio >= THRESHOLDS.rising) out.push({ kind: 'attention.rising', strength: tr.ratio, text: `attention up ${Math.round((tr.ratio - 1) * 100)}% this week`, payload: tr });
  if (tr?.ratio != null && tr.ratio <= THRESHOLDS.falling) out.push({ kind: 'attention.falling', strength: tr.ratio, text: `attention down ${Math.round((1 - tr.ratio) * 100)}% this week`, payload: tr });
  const weekAgo = Date.now() - 7 * 86400_000;
  const hot = (s.stories?.top || []).find((x) => x.points >= THRESHOLDS.hotStory && Date.parse(x.at) >= weekAgo);
  if (hot) out.push({ kind: 'stories.hot', strength: hot.points, text: hot.title, payload: { url: hot.url, points: hot.points } });
  const star = (s.repos?.top || [])[0];
  if (star && star.stars >= THRESHOLDS.breakout) out.push({ kind: 'repos.breakout', strength: star.stars, text: `${star.name} — ${star.stars} stars since ${star.created}`, payload: { url: star.url } });
  if ((s.jobs?.count || 0) >= THRESHOLDS.hiring) out.push({ kind: 'jobs.demand', strength: s.jobs.count, text: `${s.jobs.count} companies hiring for it this month`, payload: null });
  return out;
}

/** Record today's signals for every subject; the first of each kind a day is new, the rest are the same news. */
export function detect() {
  const found = [];
  for (const t of q("SELECT * FROM radar_topics WHERE state = 'watching'")) {
    for (const sg of signalsFor(t, summary(t))) {
      const r = exec(`INSERT INTO radar_signals (topic_id, kind, day, text, strength, payload) VALUES (?,?,?,?,?,?)
                      ON CONFLICT(topic_id, kind, day) DO NOTHING`, t.id, sg.kind, today(), sg.text.slice(0, 300), sg.strength, sg.payload ? JSON.stringify(sg.payload) : null);
      if (!r.changes) continue;
      found.push({ topic: t.query, ...sg });
      if (sg.kind === 'attention.rising' && sg.strength >= 2) {
        notify({ level: 'info', source: 'radar', message: `${t.query}: ${sg.text}`, subjectType: 'radar_topic', subjectId: t.id });
      }
    }
  }
  return found;
}

export function topic(id) {
  const t = topicRow(id);
  return { ...t, ...summary(t), signals: q('SELECT * FROM radar_signals WHERE topic_id = ? ORDER BY id DESC LIMIT 30', t.id) };
}

export function overview() {
  const topics = q("SELECT * FROM radar_topics WHERE state = 'watching' ORDER BY id").map((t) => {
    const s = summary(t);
    return {
      id: t.id, query: t.query, wiki_title: t.wiki_title, lang: t.lang, note: t.note,
      trend: s.attention?.trend || null, spark: (s.attention?.series || []).map(([, n]) => n),
      missingPage: Boolean(s.attention?.missing),
      stories: s.stories?.total ?? null, topStory: s.stories?.top?.[0] || null,
      papers: s.papers?.total ?? null, repos: s.repos?.total ?? null, topRepo: s.repos?.top?.[0] || null, jobs: s.jobs?.count ?? null,
      read: Boolean(s.stories || s.attention), errors: s.errors.length,
    };
  });
  return {
    live: isLive(),
    topics,
    signals: q(`SELECT s.*, t.query FROM radar_signals s JOIN radar_topics t ON t.id = s.topic_id
                WHERE t.state = 'watching' ORDER BY s.day DESC, s.id DESC LIMIT 30`).map((x) => ({ ...x, payload: x.payload ? JSON.parse(x.payload) : null })),
    frontpage: frontpage(),
    limit: MAX_TOPICS,
    thresholds: THRESHOLDS,
  };
}
