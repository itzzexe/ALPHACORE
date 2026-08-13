// Creative division — Social Media, Content Studio, Design Studio.
// Three creator agents (SMM, Content, Designer) draft everything; a HUMAN
// always publishes/approves — same load-bearing rule as support and marketing.
// Designs become real .svg files under workspace/_designs. Everything
// cross-links: post → channel/campaign/product, content → campaign,
// design → campaign, and approvals land on the audit chain.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { archiveItem } from './data.js';
import { WS_ROOT } from './artifacts.js';

const PLATFORMS = ['x', 'linkedin', 'instagram', 'facebook', 'tiktok', 'youtube', 'telegram'];

// ---------- Channels (the social accounts register) ----------
export function createChannel({ platform, handle, followers = 0, notes = null, actor }) {
  if (!PLATFORMS.includes(platform)) throw new Error(`platform must be one of ${PLATFORMS.join('|')}`);
  if (!handle?.trim()) throw new Error('handle required');
  exec('INSERT INTO channels (platform, handle, followers, notes) VALUES (?,?,?,?)',
    platform, handle.trim(), Number(followers) || 0, notes);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'channel.connected', subjectType: 'channel', subjectId: id, payload: { platform, handle: handle.trim() } });
  return one('SELECT * FROM channels WHERE id = ?', id);
}

export function listChannels() {
  return q('SELECT * FROM channels ORDER BY state, platform').map((c) => ({
    ...c,
    posts: one('SELECT COUNT(*) AS n FROM posts WHERE channel_id = ?', c.id).n,
    published: one("SELECT COUNT(*) AS n FROM posts WHERE channel_id = ? AND state = 'published'", c.id).n,
    scheduled: one("SELECT COUNT(*) AS n FROM posts WHERE channel_id = ? AND state = 'scheduled'", c.id).n,
  }));
}

export function updateChannel(id, { state = null, followers = null, actor }) {
  if (!one('SELECT id FROM channels WHERE id = ?', id)) throw new Error('channel not found');
  if (state && !['connected', 'paused', 'disconnected'].includes(state)) throw new Error('bad state');
  exec('UPDATE channels SET state = COALESCE(?, state), followers = COALESCE(?, followers) WHERE id = ?',
    state, followers === null ? null : Number(followers), id);
  audit({ actorType: 'human', actorId: actor, action: 'channel.updated', subjectType: 'channel', subjectId: id, payload: { state, followers } });
}

// ---------- Posts (SMM agent drafts, human publishes) ----------
export function createPost({ channelId = null, kind = 'post', brief, campaignId = null, productId = null, scheduleAt = null, actor }) {
  if (!brief?.trim()) throw new Error('brief required');
  const ch = channelId ? one('SELECT * FROM channels WHERE id = ?', channelId) : null;
  if (channelId && !ch) throw new Error('channel not found');
  exec('INSERT INTO posts (channel_id, campaign_id, product_id, kind, brief, schedule_at) VALUES (?,?,?,?,?,?)',
    channelId, campaignId, productId, kind, brief.trim(), scheduleAt);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const campaign = campaignId ? one('SELECT name, draft FROM campaigns WHERE id = ?', campaignId) : null;
  const runId = enqueueRun({
    agentId: 'AGT-SMM-001',
    taskType: `post:${id}`,
    input: {
      prompt: `Draft a ${kind} ${ch ? `for ${ch.platform} (@${ch.handle}, ${ch.followers} followers)` : 'for our social channels'}.
Brief: ${brief.trim()}
${productId ? `Product: ${productId}` : ''}${campaign ? `\nCampaign "${campaign.name}" approved copy for tone reference:\n${String(campaign.draft || '').slice(0, 600)}` : ''}
A human reviews and publishes — never claim it was posted.`,
    },
    actor,
  });
  exec('UPDATE posts SET draft_run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'post.drafting', subjectType: 'post', subjectId: id, payload: { channelId, kind, campaignId } });
  return one('SELECT * FROM posts WHERE id = ?', id);
}

export function listPosts() {
  return q('SELECT * FROM posts ORDER BY id DESC LIMIT 200').map((p) => ({
    ...p,
    hashtags: p.hashtags ? JSON.parse(p.hashtags) : [],
    metrics: JSON.parse(p.metrics),
    channel: p.channel_id ? one('SELECT platform, handle FROM channels WHERE id = ?', p.channel_id) : null,
  }));
}

export function schedulePost(id, { scheduleAt, actor }) {
  const p = one('SELECT * FROM posts WHERE id = ?', id);
  if (!p) throw new Error('post not found');
  if (!['draft_ready', 'scheduled'].includes(p.state)) throw new Error(`post is ${p.state}`);
  if (!scheduleAt) throw new Error('scheduleAt required (YYYY-MM-DD HH:MM)');
  exec("UPDATE posts SET state = 'scheduled', schedule_at = ? WHERE id = ?", scheduleAt, id);
  audit({ actorType: 'human', actorId: actor, action: 'post.scheduled', subjectType: 'post', subjectId: id, payload: { scheduleAt } });
}

/** HUMAN publishes — the platform records who and when; agents never post. */
export function publishPost(id, { body = null, actor }) {
  const p = one('SELECT * FROM posts WHERE id = ?', id);
  if (!p) throw new Error('post not found');
  if (!['draft_ready', 'scheduled'].includes(p.state)) throw new Error(`post is ${p.state}`);
  const text = body || p.draft;
  if (!text) throw new Error('nothing to publish');
  exec("UPDATE posts SET state = 'published', draft = ?, published_by = ?, published_at = datetime('now') WHERE id = ?", text, actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'post.published', subjectType: 'post', subjectId: id, payload: { edited: body !== null && body !== p.draft, channelId: p.channel_id } });
  archiveItem({ title: `Published post #${id}`, kind: 'manual', subjectType: 'post', subjectId: id, snapshot: { text: text.slice(0, 1000), channelId: p.channel_id, campaignId: p.campaign_id }, actor });
  return one('SELECT * FROM posts WHERE id = ?', id);
}

export function updatePostMetrics(id, { likes = null, comments = null, shares = null, reach = null, actor }) {
  const p = one('SELECT * FROM posts WHERE id = ?', id);
  if (!p) throw new Error('post not found');
  const m = JSON.parse(p.metrics);
  if (likes !== null) m.likes = Number(likes);
  if (comments !== null) m.comments = Number(comments);
  if (shares !== null) m.shares = Number(shares);
  if (reach !== null) m.reach = Number(reach);
  exec('UPDATE posts SET metrics = ? WHERE id = ?', JSON.stringify(m), id);
  audit({ actorType: 'human', actorId: actor, action: 'post.metrics', subjectType: 'post', subjectId: id, payload: m });
}

export function cancelPost(id, actor) {
  if (!one('SELECT id FROM posts WHERE id = ?', id)) throw new Error('post not found');
  exec("UPDATE posts SET state = 'cancelled' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'post.cancelled', subjectType: 'post', subjectId: id });
}

// ---------- Content Studio (Content Creator agent) ----------
export function createContent({ kind = 'article', title, brief, productId = null, campaignId = null, actor }) {
  if (!title?.trim() || !brief?.trim()) throw new Error('title and brief required');
  exec('INSERT INTO content_items (kind, title, brief, product_id, campaign_id) VALUES (?,?,?,?,?)',
    kind, title.trim(), brief.trim(), productId, campaignId);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: 'AGT-CNT-001',
    taskType: `content:${id}`,
    input: { prompt: `Write a ${kind} titled "${title.trim()}".\nBrief: ${brief.trim()}${productId ? `\nProduct: ${productId}` : ''}\nA human approves before publication.` },
    actor,
  });
  exec('UPDATE content_items SET draft_run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'content.drafting', subjectType: 'content', subjectId: id, payload: { kind, title: title.trim() } });
  return one('SELECT * FROM content_items WHERE id = ?', id);
}

export function listContent() {
  return q('SELECT * FROM content_items ORDER BY id DESC LIMIT 100').map((c) => ({ ...c, seo: c.seo ? JSON.parse(c.seo) : [] }));
}

export function approveContent(id, { verdict, body = null, actor }) {
  const c = one('SELECT * FROM content_items WHERE id = ?', id);
  if (!c) throw new Error('content not found');
  if (!['approved', 'published', 'cancelled'].includes(verdict)) throw new Error('verdict must be approved|published|cancelled');
  if (verdict !== 'cancelled' && c.state !== 'draft_ready' && c.state !== 'approved') throw new Error(`content is ${c.state}`);
  exec('UPDATE content_items SET state = ?, draft = COALESCE(?, draft), approved_by = ? WHERE id = ?', verdict, body, actor, id);
  audit({ actorType: 'human', actorId: actor, action: `content.${verdict}`, subjectType: 'content', subjectId: id });
  if (verdict === 'published') {
    archiveItem({ title: `Published: ${c.kind} — ${c.title}`, kind: 'manual', subjectType: 'content', subjectId: id, snapshot: { title: c.title, kind: c.kind, body: String(body || c.draft || '').slice(0, 2000) }, actor });
  }
  return one('SELECT * FROM content_items WHERE id = ?', id);
}

// ---------- Design Studio (Designer agent — designs for everything) ----------
export function createDesign({ kind = 'social-visual', title, brief, productId = null, campaignId = null, actor }) {
  if (!title?.trim() || !brief?.trim()) throw new Error('title and brief required');
  exec('INSERT INTO designs (kind, title, brief, product_id, campaign_id) VALUES (?,?,?,?,?)',
    kind, title.trim(), brief.trim(), productId, campaignId);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: 'AGT-DES-001',
    taskType: `design:${id}`,
    input: { prompt: `Design a ${kind}: "${title.trim()}".\nBrief: ${brief.trim()}${productId ? `\nProduct: ${productId}` : ''}\nDeliver the written spec plus one complete self-contained SVG.` },
    actor,
  });
  exec('UPDATE designs SET draft_run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'design.drafting', subjectType: 'design', subjectId: id, payload: { kind, title: title.trim() } });
  return one('SELECT * FROM designs WHERE id = ?', id);
}

export function listDesigns() {
  return q('SELECT * FROM designs ORDER BY id DESC LIMIT 60');
}

export function approveDesign(id, { actor }) {
  const d = one('SELECT * FROM designs WHERE id = ?', id);
  if (!d) throw new Error('design not found');
  if (d.state !== 'draft_ready') throw new Error(`design is ${d.state}`);
  exec("UPDATE designs SET state = 'approved', approved_by = ? WHERE id = ?", actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'design.approved', subjectType: 'design', subjectId: id });
  archiveItem({ title: `Design approved: ${d.title}`, kind: 'manual', subjectType: 'design', subjectId: id, snapshot: { kind: d.kind, spec: String(d.spec || '').slice(0, 1000), fileRef: d.file_ref }, actor });
  return one('SELECT * FROM designs WHERE id = ?', id);
}

// ---------- server tick: pull finished creative runs into their records ----------
function pullRun(row, table) {
  const run = one('SELECT state, output FROM runs WHERE id = ?', row.draft_run_id);
  if (!run) return null;
  if (['failed', 'cancelled'].includes(run.state)) {
    exec(`UPDATE ${table} SET state = 'draft_ready' WHERE id = ?`, row.id);
    return null;
  }
  if (run.state !== 'done' && run.state !== 'awaiting_human') return null;
  return run.output ? JSON.parse(run.output)?.parsed || null : null;
}

export function syncStudioRuns() {
  for (const p of q("SELECT * FROM posts WHERE state = 'drafting' AND draft_run_id IS NOT NULL")) {
    const parsed = pullRun(p, 'posts');
    if (!parsed) continue;
    const first = Array.isArray(parsed.posts) ? parsed.posts[0] : null;
    exec("UPDATE posts SET state = 'draft_ready', draft = ?, hashtags = ?, best_time = ? WHERE id = ?",
      first?.text || parsed.draft || '(draft unusable — human writes the post)',
      JSON.stringify(first?.hashtags || []), first?.bestTime || null, p.id);
    notify({ level: 'info', source: 'studio', message: `Post draft #${p.id} ready — review, schedule, and publish it yourself.`, subjectType: 'post', subjectId: p.id });
  }
  for (const c of q("SELECT * FROM content_items WHERE state = 'drafting' AND draft_run_id IS NOT NULL")) {
    const parsed = pullRun(c, 'content_items');
    if (!parsed) continue;
    exec("UPDATE content_items SET state = 'draft_ready', draft = ?, seo = ?, title = COALESCE(NULLIF(?,''), title) WHERE id = ?",
      parsed.article || parsed.draft || '(draft unusable)', JSON.stringify(parsed.seoKeywords || []), parsed.title || '', c.id);
    notify({ level: 'info', source: 'studio', message: `Content draft ready: ${c.title}`, subjectType: 'content', subjectId: c.id });
  }
  for (const d of q("SELECT * FROM designs WHERE state = 'drafting' AND draft_run_id IS NOT NULL")) {
    const parsed = pullRun(d, 'designs');
    if (!parsed) continue;
    let fileRef = null;
    const svg = typeof parsed.svg === 'string' && parsed.svg.trim().startsWith('<svg') ? parsed.svg.trim() : null;
    if (svg) {
      const dir = path.join(WS_ROOT, '_designs');
      fs.mkdirSync(dir, { recursive: true });
      fileRef = `_designs/design-${d.id}.svg`;
      fs.writeFileSync(path.join(WS_ROOT, fileRef), svg, 'utf8');
    }
    exec("UPDATE designs SET state = 'draft_ready', spec = ?, svg = ?, file_ref = ? WHERE id = ?",
      parsed.spec || '(no spec)', svg, fileRef, d.id);
    notify({ level: 'info', source: 'studio', message: `Design ready: ${d.title}${fileRef ? ` → ${fileRef}` : ''}`, subjectType: 'design', subjectId: d.id });
  }
}

// ---------- overview ----------
export function studioOverview() {
  return {
    channels: listChannels(),
    followers: one('SELECT COALESCE(SUM(followers),0) AS n FROM channels WHERE state = \'connected\'').n,
    postsByState: Object.fromEntries(q('SELECT state, COUNT(*) AS n FROM posts GROUP BY state').map((r) => [r.state, r.n])),
    upcoming: q("SELECT p.*, c.platform, c.handle FROM posts p LEFT JOIN channels c ON c.id = p.channel_id WHERE p.state = 'scheduled' ORDER BY p.schedule_at LIMIT 15"),
    reach: q("SELECT metrics FROM posts WHERE state = 'published'").reduce((a, r) => a + (JSON.parse(r.metrics).reach || 0), 0),
    contentByState: Object.fromEntries(q('SELECT state, COUNT(*) AS n FROM content_items GROUP BY state').map((r) => [r.state, r.n])),
    designsReady: one("SELECT COUNT(*) AS n FROM designs WHERE state IN ('draft_ready','approved')").n,
  };
}
