// The small shared pieces every department page reaches for: the 360°
// connections panel, the download wiring that carries the session header, and
// the two or three constants that would otherwise be redefined slightly
// differently on four pages.

import { $, esc, linkFor, short, view } from '../core/dom.js';
import { api, downloadFile } from '../services/api.js';

/** Wire every [data-download] button on the current page. */
export function wireDownloads() {
  view.querySelectorAll('[data-download]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    downloadFile(b.dataset.download, b.dataset.filename || 'export.csv');
  }));
}
/** A speech bubble that points down at whoever said it. */
export function bubble(x, y, who, text, w) {
  const body = String(text).replace(/\s+/g, ' ').slice(0, 130);
  const lines = [];
  let line = '';
  const perLine = Math.floor(w / 5.2);
  for (const word of body.split(' ')) {
    if ((`${line} ${word}`).length > perLine) { lines.push(line); line = word; } else { line = line ? `${line} ${word}` : word; }
    if (lines.length >= 3) break;
  }
  if (line && lines.length < 3) lines.push(line);
  const h = 15 + lines.length * 11;
  return `<g class="of-bubble" transform="translate(${x} ${y})">
    <rect x="${-w / 2}" y="0" width="${w}" height="${h}" rx="7" fill="var(--paper-veil)" stroke="var(--ember)" stroke-opacity="0.45"/>
    <path d="M -5 ${h} l 5 6 l 5 -6 z" fill="var(--paper-veil)" stroke="var(--ember)" stroke-opacity="0.45"/>
    <text x="${-w / 2 + 8}" y="11" font-size="7.6" fill="var(--ember)">${esc(who)}</text>
    ${lines.map((l, i) => `<text x="${-w / 2 + 8}" y="${23 + i * 11}" font-size="9.3" fill="var(--ink)">${esc(l)}</text>`).join('')}
  </g>`;
}
// ---------- the 360° connections block (used on every entity page) ----------
const DEPT_HREF = {
  sales: '#/sales', customers: '#/customers', support: '#/support', relations: '#/relations',
  marketing: '#/marketing', products: '#/products', intel: '#/intel', segments: '#/segments',
  social: '#/social', content: '#/content', design: '#/design', incidents: '#/incidents',
  risks: '#/risks', knowledge: '#/knowledge', pipelines: '#/pipelines', journeys: '#/journeys',
  runs: '#/runs', tasks: '#/tasks', projects: '#/projects', legal: '#/legal', vendors: '#/vendors',
  objectives: '#/objectives', archive: '#/archive', evals: '#/evals', oversight: '#/oversight', data: '#/data',
};
/** A 🔗 button any row can carry; opens the connections drawer for that entity. */
export const connBtn = (type, id, label = '🔗') =>
  `<button class="btn btn-sm" data-conn-type="${esc(type)}" data-conn-id="${esc(String(id))}" title="show everything connected to this">${label}</button>`;
/** Delegate every 🔗 button on the current page to a shared drawer. */
export function wireConnections() {
  view.querySelectorAll('[data-conn-type]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    let host = $('#conn-drawer');
    if (!host) { host = document.createElement('div'); host.id = 'conn-drawer'; host.className = 'panel'; view.appendChild(host); }
    host.innerHTML = '<div class="empty">Loading connections…</div>';
    await renderConnections('#conn-drawer', b.dataset.connType, b.dataset.connId);
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
}
/** Render "what else is connected to this" into a container selector. */
export async function renderConnections(sel, type, id) {
  const host = $(sel);
  if (!host) return;
  let c;
  try { c = await api(`/api/links/${type}/${encodeURIComponent(id)}`); } catch { host.innerHTML = ''; return; }
  if (!c || !c.totalLinks) { host.innerHTML = '<div class="map-legend">No connections recorded yet.</div>'; return; }
  host.innerHTML = `
    <div class="panel-title" style="margin-top:12px">Connected across the company — ${c.totalLinks} links</div>
    ${c.groups.map((g2) => `
      <div class="conn-group">
        <a class="conn-dept" href="${DEPT_HREF[g2.dept] || '#/'}">${esc(g2.label)}</a>
        <div class="agent-meta">${g2.items.map((it) => {
          const href = it.type === 'url' ? it.id : (linkFor(it.type, it.id) || DEPT_HREF[g2.dept] || '#/');
          const ext = it.type === 'url';
          return `<a class="chip chip-dim" style="text-decoration:none" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''} title="${esc(it.sub || '')}">${esc(short(it.title, 34))}${it.sub ? ` <span style="color:var(--ink-faint)">· ${esc(short(it.sub, 22))}</span>` : ''}</a>`;
        }).join('')}</div>
      </div>`).join('')}
    ${c.auditTrail.length ? `<div class="map-legend" style="margin-top:8px">Recent on the <a href="#/audit">chain</a>: ${c.auditTrail.slice(0, 5).map((a) => `${esc(a.action)} <span style="color:var(--ink-faint)">(${esc(a.actor_id)})</span>`).join(' · ')}</div>` : ''}`;
}
// ---------- Request desk ----------
export const REQ_STATE_CLS = { done: 'done', running: 'running', triaging: 'running', awaiting_human: 'awaiting_human', failed: 'failed', cancelled: 'failed' };
// ---------- The floor: chat between humans and the AI workforce ----------
export const chatState = { channel: null, since: 0, thread: null, showRoster: true };
export const CHAT_EMOJI = ['👍', '✅', '🔥', '👀', '❓'];
