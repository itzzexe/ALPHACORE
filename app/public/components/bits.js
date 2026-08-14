// Small shared renderers and lookup tables: a contact cell, a people block, a
// figure with a caption, the colour a department is drawn in, and the
// deterministic pixel-person the offices are populated with.

import { $, esc, short } from '../core/dom.js';
import { t } from '/i18n.js';

/** A stable number from a string. Same employee, same face, for ever. */
function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
const SKIN = ['#f0d5b8', '#e3bd97', '#c99a6e', '#a9784f', '#7d5433', '#5c3c26'];
const HAIR = ['#241a12', '#3d2a1a', '#5a3d24', '#7d5a33', '#a8802f', '#2f2f33', '#6b1f14', '#8a8a8a'];
// Mood is a ring, not just a face. A face at this size is four pixels of mouth;
// a ring is legible across the whole floor, which is the point of a floor plan.
export const MOOD = {
  pleased: { ring: 'var(--ok)', word: 'pleased' },
  curious: { ring: 'var(--steel)', word: 'curious' },
  steady: { ring: 'transparent', word: 'steady' },
  tired: { ring: 'var(--warn)', word: 'tired' },
  frustrated: { ring: 'var(--bad)', word: 'frustrated' },
  tense: { ring: 'var(--bad)', word: 'tense' },
};
/**
 * The name you can actually fit under a figure.
 *
 * Nine characters, because at ten the labels in a full room run into each
 * other and a floor plan of colliding text is worse than one with no names.
 */
const shortName = (n) => {
  const s = String(n || '').replace(/\s*\(.*\)$/, '').trim();
  if (s.length <= 9) return s;
  const first = s.split(/[\s&/]+/)[0];
  return first.length <= 9 ? first : `${first.slice(0, 8)}…`;
};
/**
 * One employee, big enough to recognise.
 *
 * The ring is mood, the shirt is their division, the shadow is energy, and the
 * name is under them because a floor plan of anonymous people is a chart.
 */
export function figure(p, colour, x, y, speaking) {
  const h = hashOf(p.agent_id);
  const skin = SKIN[h % SKIN.length];
  const hair = HAIR[(h >> 3) % HAIR.length];
  const style = (h >> 6) % 4;
  const mood = MOOD[p.mood] || MOOD.steady;
  const tired = p.energy < 30;

  const mouth = {
    pleased: 'M -3 3.4 q 3 2.6 6 0',
    steady: 'M -2.6 3.6 h 5.2',
    curious: 'M -2.6 3.6 h 3.6',
    tired: 'M -2.6 4 h 5.2',
    frustrated: 'M -3 4.4 q 3 -2.2 6 0',
    tense: 'M -3 4.4 q 3 -2.6 6 0',
  }[p.mood] || 'M -2.6 3.6 h 5.2';

  const hairPath = [
    `<path d="M -7 -1 a 7 7 0 0 1 14 0 v -1 a 7 8 0 0 0 -14 0 z" fill="${hair}"/>`,
    `<path d="M -7 -1.5 a 7 7 0 0 1 14 0 q -3 -4 -7 -4 t -7 4 z" fill="${hair}"/><circle cx="0" cy="-7.4" r="2.1" fill="${hair}"/>`,
    `<path d="M -7 -0.5 a 7 7 0 0 1 14 0 v -2 a 7 8 0 0 0 -14 0 z" fill="${hair}"/><path d="M -7.4 -0.5 q -1.6 4 -0.4 7" stroke="${hair}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    `<path d="M -6.6 -2.2 a 7 7 0 0 1 13.2 0 z" fill="${hair}"/>`,
  ][style];

  return `<g class="of-fig${speaking ? ' is-speaking' : ''}" transform="translate(${x} ${y})" data-agent="${esc(p.agent_id)}">
    <title>${esc(p.name)} · ${esc(p.role_group || '')} · ${esc(mood.word)}, energy ${p.energy}%${p.note ? ` · “${esc(p.note)}”` : ''}</title>
    <ellipse cx="0" cy="21" rx="${5 + (p.energy / 100) * 4}" ry="1.7" fill="var(--ink)" opacity="${0.05 + (p.energy / 100) * 0.12}"/>
    ${mood.ring !== 'transparent'
    ? `<circle cx="0" cy="1" r="12.5" fill="none" stroke="${mood.ring}" stroke-width="1.6" opacity="0.85"/>` : ''}
    <path d="M -7.5 20 v -6 a 7.5 8 0 0 1 15 0 v 6 z" fill="${colour}" opacity="${tired ? 0.72 : 1}"/>
    <circle cx="0" cy="0" r="7" fill="${skin}"/>
    ${hairPath}
    <circle cx="-2.6" cy="1" r="0.95" fill="var(--ink)"/>
    <circle cx="2.6" cy="1" r="0.95" fill="var(--ink)"/>
    <path d="${mouth}" stroke="var(--ink)" stroke-width="0.9" fill="none" stroke-linecap="round"/>
    <text x="0" y="31" font-size="7.4" text-anchor="middle" fill="var(--ink-mute)">${esc(shortName(p.name))}</text>
  </g>`;
}
export const ENRICH_CHIP = {
  enriched: ['chip-ok', 'web-confirmed'],
  pending: ['chip-warn', 'harvesting…'],
  unreachable: ['chip-bad', 'site unreachable'],
  'no-domain': ['chip-dim', 'no domain found'],
};
export function contactCell(r) {
  const line = (icon, val, title) => val ? `<div title="${esc(title || '')}"><span style="opacity:.6">${icon}</span> <span class="mono" style="user-select:all">${esc(val)}</span></div>` : '';
  const src = r.evidence?.find((e) => e.source_url)?.source_url;
  const gapList = (r.gaps || []).filter((g) => ['email', 'phone', 'address'].includes(g));
  return `
    ${line('✉', r.email, 'primary email')}${line('✉', r.email2, 'secondary email')}
    ${line('☎', r.phone, 'primary phone')}${line('☎', r.phone2, 'secondary phone')}
    ${line('◎', r.whatsapp, 'WhatsApp')}
    ${line('⌂', short(r.address, 60), r.address)}
    ${r.website ? `<div>🌐 <a href="${esc(r.website)}" target="_blank" rel="noopener noreferrer">${esc(short(r.website.replace(/^https?:\/\//, ''), 34))}</a></div>` : ''}
    ${r.linkedin ? `<div>in <a href="${esc(r.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a></div>` : ''}
    ${gapList.length ? `<div class="map-legend" style="color:var(--warn)">gap: ${gapList.join(', ')}</div>` : ''}
    ${src ? `<div class="map-legend">source: <a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(short(src.replace(/^https?:\/\//, ''), 40))}</a></div>` : '<div class="map-legend">source: model knowledge only</div>'}`;
}
const METHOD_BADGE = {
  'web-scrape': ['chip-ok', 'from site'],
  'model-knowledge': ['chip-dim', 'agent-named'],
  'pattern-derived': ['chip-warn', 'derived — unverified'],
  human: ['chip-steel', 'human'],
  dataset: ['chip-dim', 'dataset'],
};
export function peopleBlock(r, canM) {
  const people = (r.contacts || []).filter((c) => c.name);
  if (!people.length) return '';
  return `<div class="people-block">
    <div class="map-legend" style="color:var(--steel)">People inside — ${people.length}</div>
    ${people.map((c) => {
      const [cls, txt] = METHOD_BADGE[c.method] || ['chip-dim', c.method];
      return `<div class="person-row">
        <span><b>${esc(c.name)}</b>${c.role ? ` <span style="color:var(--ink-mute)">· ${esc(short(c.role, 30))}</span>` : ''}</span>
        <span class="mono" style="font-size:11px">${[c.email, c.phone].filter(Boolean).map(esc).join(' · ') || '<span style="color:var(--warn)">no direct contact</span>'}</span>
        <span><span class="chip ${cls}" title="${esc(c.note || '')}">${txt}</span>${c.verification === 'verified' ? '<span class="chip chip-ok">✓</span>' : canM && (c.email || c.phone) ? `<button class="btn btn-sm" data-cverify="${c.id}" title="confirm this person — promotes their details to the record">✓</button>` : ''}</span>
      </div>`;
    }).join('')}
  </div>`;
}
export const DS_SOURCE_ICON = { tickets: '🎧', 'intel-records': '🔍', incidents: '🚨', customers: '👤', interactions: '🤝', 'social-metrics': '📱', audit: '⛓' };
// ---------- Company Journeys — the value chain ----------
export const DEPT_COLORS = {
  strategy: '#948b7d', research: '#5ec3c9', product: '#b78bff', finance: '#ffb020',
  legal: '#e5533d', architecture: '#78bf6d', engineering: '#ff6b2c', review: '#5ec3c9',
  qa: '#ffb020', security: '#e5533d', release: '#78bf6d', marketing: '#b78bff',
  support: '#5ec3c9', governance: '#948b7d',
};
// ---------- The society ----------
export const initials = (s) => String(s || '?').replace(/^AGT-/, '').split(/[\s-]/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const GROUP_COLOR = { build: '#b78bff', create: '#ff5fa2', run: '#ffb020', discover: '#78bf6d', steer: '#948b7d', assure: '#5ec3c9' };
// ---------- The iteration engine: workstreams, auditor, sprints ----------
export const METHOD_HINT = {
  waterfall: 'One pass per department with a gate between phases — a failed audit stops for a human instead of silently looping.',
  scrum: 'Fixed iterations with a cycle budget; quality that misses the bar carries into the next round.',
  kaizen: 'Keeps improving until the audit clears your target or the cycle budget is spent.',
};
