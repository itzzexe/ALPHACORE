// Chips and legends that appear on pages in more than one surface: a state, a
// verdict, the flow legend, and the certification matrix the trust centre
// draws. Shared because they must say the same thing everywhere.

import { $, esc, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { preBody } from './chrome.js';
import { tile } from './tile.js';
import { t } from '/i18n.js';

/**
 * The certification matrix — a table nobody typed.
 *
 * Every other integration table in the industry is written by hand and starts
 * decaying the day it ships. This one is a view over evidence the egress gate
 * writes on every call, so the cells that read "untested" are the honest half
 * of the page and are deliberately not styled to look like a failure.
 */
const CERT_TONE = {
  'live-verified': 'chip-ok', 'sandbox-verified': 'chip-ok', 'paper-verified': 'chip-warn',
  'mock-only': 'chip-warn', untested: 'chip-dim', 'not yet observable': 'chip-dim',
};
function certCell(c) {
  const tone = CERT_TONE[c.state] || 'chip-dim';
  const why = c.why ? esc(c.why)
    : `${c.observations || 0} ${t('observations')}${c.lastSeenAt ? ` · ${c.lastSeenAt}` : ''}`;
  // A cell that only ever climbs is lying by omission: a live-verified column
  // with a failure yesterday must say so on the same line.
  const failed = c.lastFailureAt
    ? `<div class="sub" style="color:var(--bad)">${esc(t('last failure'))}: ${esc(String(c.lastFailure || '').slice(0, 90))}</div>` : '';
  return `<td title="${esc(why)}"><span class="chip ${tone}">${esc(t(c.state))}</span>${failed}</td>`;
}
export function certificationPanel(m) {
  if (!m) return '';
  const c = m.counts;
  return `
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Connector certification — measured, not claimed'))}</div>
    <div class="map-legend">${esc(t(m.note))}</div>
    <div class="grid grid-4" style="margin-top:12px">
      ${tile(t('Live-verified'), c.liveVerified, esc(t('a real call really left this machine')), c.liveVerified ? 'tile-ok' : '')}
      ${tile(t('Paper-verified'), c.paperVerified, esc(t('read the real world, changed nothing')))}
      ${tile(t('Untested'), c.untested, esc(t('no evidence either way')), c.untested ? 'tile-warn' : '')}
      ${tile(t('With a recent failure'), c.withRecentFailure, esc(t('shown beside the state, not hidden')), c.withRecentFailure ? 'tile-bad' : '')}
    </div>
    <div style="overflow-x:auto;margin-top:12px">
      <table class="tbl"><thead><tr>
        <th>${esc(t('Connector'))}</th>
        ${m.capabilities.map((x) => `<th title="${esc(t(x.about))}">${esc(t(x.label))}</th>`).join('')}
      </tr></thead><tbody>
        ${m.connectors.map((row) => `<tr>
          <td><b>${esc(row.label || row.connector)}</b><div class="sub">${esc(row.connector)} · ${esc(t(row.connectorState))}</div></td>
          ${row.cells.map(certCell).join('')}
        </tr>`).join('')}
      </tbody></table>
    </div>
    <div class="map-legend" style="margin-top:10px">${esc(t('Evidence rows behind this table'))}: <b>${c.cells ? m.evidence : 0}</b></div>
  </div>`;
}

/* ---------- the eight doors, as pages ----------
   The rail is one way in. These are the other: a surface has a page of its own
   so it can be linked, bookmarked and swept, and so "Approvals" means somewhere
   you can stand rather than only a menu that drops down. Every one of them is
   drawn from the same server-side mapping the rail uses — there is no second
   list here to fall out of step. */
// ---------- how a relationship is drawn ----------
// Five kinds of movement, five readings. Without this every line looked like
// a hand-off, so the loops — the part that makes the work actually improve —
// were invisible.
export const EDGE_KIND = {
  flow: {
    dash: null, marker: 'arrow', label: 'hand-off',
    how: 'Work moves forward: the source department finishes something and the target picks it up. The number is how many times this has actually happened, counted straight from the database — not a diagram of intent.',
  },
  loop: {
    dash: '7 5', marker: 'arrow-back', label: 'sent back to improve',
    how: 'The return path. Work that did not clear the bar goes back carrying every finding with it, and the next round must address them. This is the line that makes output improve instead of merely ship.',
  },
  review: {
    dash: '2 5', marker: 'arrow', label: 'independent peer review',
    how: 'A second opinion from someone who did not do the work. Reviewers are chosen to exclude the producer, and where possible from a different model family, so a mistake is not confirmed by the mind that made it.',
  },
  audit: {
    dash: '10 4 2 4', marker: 'diamond', label: 'audit verdict',
    how: 'One independent auditor judges output from every department against the same criteria and returns a score plus concrete findings. A failing verdict blocks the work and opens the return path.',
  },
  gate: {
    dash: '1 6', marker: 'gate', label: 'stops for a human',
    how: 'A hard stop. The machine prepares, a named person decides, and the decision is written to the hash chain with their name on it. Nothing crosses this line automatically.',
  },
  memory: {
    dash: '4 3', marker: 'arrow', label: 'memory recalled / kept',
    how: 'Experience moving in and out of storage: finished work leaves an episode behind, and future work retrieves what is relevant before it starts — so the same mistake is not made twice.',
  },
};
export const flowLegend = (flow) => !flow ? '' : `
  <div class="flow-legend">
    ${Object.entries(EDGE_KIND).map(([k, v]) => `<span class="fl-k fl-${k}"><i></i>${esc(t(v.label))}</span>`).join('')}
    <span class="fl-stats">${flow.rounds} ${esc(t('rounds'))} · ${flow.revisions} ${esc(t('sent back'))} · ${flow.handoffs} ${esc(t('hand-offs across'))} ${flow.departmentsTouched} ${esc(t('departments'))} ·
      ${flow.peerReviews} ${esc(t('peer reviews by'))} ${flow.reviewersInvolved} ${esc(t('reviewers'))} · ${flow.audits} ${esc(t('audits over'))} ${flow.auditedDepartments} ${esc(t('departments'))} ·
      ${flow.humanGates} ${esc(t('human rulings'))} · ${flow.memoryRecalls} ${esc(t('memory recalls'))}</span>
  </div>`;

// ---------- the atlas ----------
// One map, two depths. Far: every district as a tree growing out of a dense
// core, names set around the rim in the serif. Near: one district, its
// departments as chips, with the district name ghosted enormous behind them.
//
// The previous two maps each answered half the question and made you choose
// which half. A map you zoom answers both, and the act of zooming is itself the
// explanation — the branch you followed is the relationship.
//
// Geometry is deterministic: the same company always draws the same picture, so
// you learn where things are and they stay there.
// ---------- Social Media Desk ----------
export const PLATFORM_ICONS = { x: '𝕏', linkedin: 'in', instagram: '◎', facebook: 'f', tiktok: '♪', youtube: '▶', telegram: '✈' };
export const verdictChip = (v) => `<span class="chip ${v === 'allowed' ? 'chip-ok' : v === 'blocked' ? 'chip-bad' : v === 'gated' ? 'chip-warn' : 'chip-dim'}">${esc(v)}</span>`;
export const stateChip = (s) => `<span class="chip ${s === 'live' ? 'chip-ok' : s === 'dry' ? 'chip-warn' : s === 'paused' ? 'chip-bad' : 'chip-dim'}">${esc(s)}</span>`;
export async function renderWebPage(id) {
  const r = await api(`/api/web/${id}`);
  if (!r) { view.innerHTML = '<div class="empty">No such page.</div>'; return; }
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title"><a href="#/web">← the open web</a></div>
    <h2 style="margin:6px 0">${esc(r.title || r.url)}</h2>
    <div class="sub mono">${esc(r.url)}</div>
    <div class="sub" style="margin-top:6px">${esc(r.mode)} · ${r.status} · ${r.bytes} bytes · fingerprint <span class="mono">${esc(r.content_hash || '—')}</span> · ${esc(String(r.created_at))}</div>
    ${!r.injection.clean ? `<div class="chip chip-bad" style="margin-top:10px">Contains text that tries to give instructions: ${esc(r.injection.hits.join(', '))}</div>` : ''}
    ${r.screenshot ? `<img src="${r.screenshot}" style="max-width:100%;margin-top:12px;border:1px solid var(--seam);border-radius:8px">` : ''}
    ${preBody(r.text || '')}
  </div>`;
}
export const mktState = (s) => `<span class="chip ${['live', 'published', 'approved', 'done'].includes(s) ? 'chip-ok' : ['cancelled', 'declined', 'retired'].includes(s) ? 'chip-bad' : s === 'review' ? 'chip-warn' : 'chip-dim'}">${esc(s)}</span>`;
// ---------- Marketing department ----------
export let mktTab = 'plan';
