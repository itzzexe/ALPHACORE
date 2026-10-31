// The command floor's own pages: the globe, missions, the health index, what
// if, and broadcasts. The deck on the home page shows a corner of each; these
// are where each one is read in full and acted on.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t, lang } from '/i18n.js';
import { kpi, ago, hashParam } from '../components/ui.js';
import { mountGlobe } from '../views/globe.js';
import { countryName, localTime } from '../components/geo.js';
import { wx, aqiBand, AQI_WORD, eventGlyph } from './horizon.js';

const money = (n) => (n == null ? '—' : Number(n).toLocaleString(lang === 'ar' ? 'ar' : 'en-US', { maximumFractionDigits: 0 }));

// ================================================================= globe ==

let globeView = null;
/**
 * The live layers for a globe: this week's earthquakes, the natural events
 * still open, the weather where the company works, the station overhead, and
 * the markets on the atlas shortlist.
 */
export async function globeLayers() {
  const [d, a] = await Promise.all([
    hasPermC('livedata.view') ? api('/api/livedata').catch(() => null) : null,
    hasPermC('atlas.view') ? api('/api/atlas').catch(() => null) : null,
  ]);
  return {
    quakes: d?.quakes?.list || [],
    events: d?.events?.list || [],
    iss: d?.iss || null,
    weather: Object.fromEntries((d?.places || []).filter((p) => p.weather).map((p) => [p.code, p.weather])),
    shortlist: (a?.shortlist || []).filter((x) => x.stage !== 'dropped').map((x) => x.code),
    live: Boolean(d?.live),
  };
}

const fmt = (n, dg = 1) => (n == null ? '—' : Number(n).toLocaleString(lang === 'ar' ? 'ar' : 'en-US', { maximumFractionDigits: dg }));
const short = (n) => (n == null ? '—' : Number(n).toLocaleString(lang === 'ar' ? 'ar' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }));

/** The card beside the globe when a country is picked: the record's ties, then what live data knows. */
async function countryCard(code, g) {
  const tie = g.countries.find((x) => x.code === code);
  const c = hasPermC('livedata.view') ? await api(`/api/livedata/country/${code}`).catch(() => null) : null;
  const w = c?.weather; const now = w ? wx(w.code) : null; const ind = c?.indicators || {};
  return `<button type="button" class="globe-card-x" aria-label="${esc(t('Close'))}">×</button>
    <div class="globe-card-eyebrow">${esc(code)}${code === g.home ? ` · ${esc(t('Home'))}` : ''}</div>
    <h3>${esc(countryName(code, lang))}</h3>
    <div class="sub">${esc(c?.facts?.capital || '')}${localTime(code, lang) ? ` · ${esc(localTime(code, lang))}` : ''}${c?.facts?.income ? ` · ${esc(t(c.facts.income))}` : ''}</div>
    ${w ? `<div class="globe-card-wx"><span aria-hidden="true">${now.g}</span><b class="ltr">${Math.round(w.temp)}°</b><span class="sub">${esc(t(now.w))}</span>${c?.air?.aqi != null ? `<span class="ld-aqi inline-aqi ${aqiBand(c.air.aqi)}"><b class="ltr">AQI ${c.air.aqi}</b><span>${esc(t(AQI_WORD[aqiBand(c.air.aqi)]))}</span></span>` : ''}</div>` : ''}
    <dl class="globe-card-dl">
      ${tie ? `<dt>${esc(t('In the record'))}</dt><dd>${[tie.parties && `${tie.parties} ${t('counterparties')}`, tie.beneficiaries && `${tie.beneficiaries} ${t('beneficiaries')}`, tie.researched && `${tie.researched} ${t('researched')}`, tie.payments && `${tie.payments} ${t('payments')}`].filter(Boolean).map(esc).join(' · ')}</dd>` : ''}
      ${c?.currency ? `<dt>${esc(t('Currency'))}</dt><dd class="ltr">${esc(c.currency)}${c.perUsd ? ` · 1 USD = ${fmt(c.perUsd, c.perUsd > 100 ? 0 : 4)}` : ''}</dd>` : ''}
      ${ind.gdpGrowth ? `<dt>${esc(t('GDP growth'))}</dt><dd class="ltr">${fmt(ind.gdpGrowth.value)}% · ${esc(ind.gdpGrowth.year)}</dd>` : ''}
      ${ind.inflation ? `<dt>${esc(t('Inflation'))}</dt><dd class="ltr">${fmt(ind.inflation.value)}%</dd>` : ''}
      ${ind.population ? `<dt>${esc(t('Population'))}</dt><dd class="ltr">${short(ind.population.value)}</dd>` : ''}
      ${(c?.holidays || []).length ? `<dt>${esc(t('Next day off'))}</dt><dd dir="auto">${esc(lang === 'ar' && c.holidays[0].localName ? c.holidays[0].localName : c.holidays[0].name)} · ${esc(c.holidays[0].date)}</dd>` : ''}
      ${(c?.events || []).length ? `<dt class="t-bad">${esc(t('Natural events near'))}</dt><dd class="t-bad" dir="auto">${c.events.map((x) => `${eventGlyph(x.category)} ${esc(x.title)}`).join(' · ')}</dd>` : ''}
      ${ind.corruption ? `<dt>${esc(t('Control of corruption'))}</dt><dd class="ltr">${fmt(ind.corruption.value, 2)} <span class="sub">(−2.5 … +2.5)</span></dd>` : ''}
      ${(c?.quakes || []).length ? `<dt class="t-bad">${esc(t('Earthquakes near'))}</dt><dd class="t-bad">${c.quakes.map((x) => `M${fmt(x.mag)} · ${fmt(x.near.km, 0)} km`).join(' · ')}</dd>` : ''}
    </dl>
    ${!c ? '' : c.live ? '' : `<p class="sub"><a href="#/livedata">${esc(t('Switch live data on'))}</a> ${esc(t('for weather, rates and the economy here.'))}</p>`}`;
}

export async function renderGlobe() {
  const [g0, layers] = await Promise.all([api('/api/globe'), globeLayers()]);
  const g = { ...g0, ...layers };
  const pick = hashParam('c');
  globeView?.destroy();
  const row = (c) => `<tr data-c="${c.code}" class="${c.code === pick ? 'sel' : ''}"><td><b>${esc(countryName(c.code, lang))}</b> <span class="sub ltr">${c.code}</span>${c.code === g.home ? ` <span class="chip chip-warn">${esc(t('Home'))}</span>` : ''}</td>
    <td class="num">${c.parties || ''}</td><td class="num">${c.beneficiaries || ''}</td><td class="num">${c.researched || ''}</td><td class="num">${c.numbers || ''}</td>
    <td class="num">${c.payments || ''}</td><td class="ltr">${Object.entries(c.amounts).map(([cur, a]) => `${money(a)} ${esc(cur)}`).join(' · ')}</td><td class="sub">${esc(localTime(c.code, lang) || '')}</td></tr>`;
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Every country the record touches. A point lights because a counterparty, a beneficiary, a researched company or a phone number says the company deals there; an arc is a payment message written to it. The sun is where it really is — the night side glows the way cities do from orbit. Drag to turn it; click a country to read it.'))}</p></div>
  <div class="kpis">${kpi('Countries', g.totals.countries)}${kpi('Ties in the record', g.totals.ties)}${kpi('Payment messages', g.totals.payments, `${g.totals.released} ${esc(t('released'))}`, 'ai')}${kpi('Home', g.home ? esc(countryName(g.home, lang)) : '—', g.home ? '' : `<a href="#/settings">${esc(t('Set it'))}</a>`, g.home ? 'human' : '')}</div>
  <div class="globe-page"><div class="globe-host" id="gp-host"></div><div class="globe-tip" id="gp-tip" hidden></div><aside class="globe-card" id="gp-card" hidden aria-live="polite"></aside>
    <div class="globe-legend"><span><i style="background:var(--g-home)"></i>${esc(t('Home'))}</span><span><i style="background:var(--g-lit)"></i>${esc(t('In the record'))}</span><span><i style="background:var(--g-city)"></i>${esc(t('night side'))}</span><span><i style="background:var(--g-arc)"></i>${esc(t('payments'))}</span>${g.quakes.length ? `<span><i style="background:var(--g-quake)"></i>${g.quakes.length} ${esc(t('earthquakes this week'))}</span>` : ''}${g.events.length ? `<span><i style="background:var(--g-fire)"></i>${g.events.length} ${esc(t('natural events'))}</span>` : ''}${g.shortlist.length ? `<span><i style="background:var(--g-short)"></i>${esc(t('shortlisted markets'))}</span>` : ''}${g.iss ? `<span><i style="background:var(--g-iss)"></i>${esc(t('the space station'))}</span>` : ''}</div></div>
  <div class="panel"><div class="panel-title">${esc(t('Countries'))}</div>
    ${g.countries.length ? `<table class="tbl"><thead><tr><th>${esc(t('Country'))}</th><th class="num">${esc(t('Counterparties'))}</th><th class="num">${esc(t('Beneficiaries'))}</th><th class="num">${esc(t('Researched'))}</th><th class="num">${esc(t('Numbers'))}</th><th class="num">${esc(t('Payments'))}</th><th>${esc(t('Sent'))}</th><th>${esc(t('Local time'))}</th></tr></thead><tbody>${g.countries.map(row).join('')}</tbody></table>`
      : `<div class="empty">${esc(t('No country in the record yet. Screen a counterparty in AML, add a SWIFT beneficiary, or research a company, and it appears here.'))}</div>`}</div>`;
  const tip = $('#gp-tip');
  globeView = mountGlobe($('#gp-host'), {
    data: g,
    onHover: (code, at) => {
      if (!code || !at) { tip.hidden = true; return; }
      const c = g.countries.find((x) => x.code === code);
      tip.innerHTML = `<b>${esc(countryName(code, lang))}</b>${c ? `${c.total} ${esc(t('ties in the record'))}` : esc(t('nothing in the record yet'))}`;
      tip.style.left = `${at.x}px`; tip.style.top = `${at.y}px`; tip.hidden = false;
    },
    onPick: (code) => {
      showCard(code);
      view.querySelectorAll('tr[data-c]').forEach((r) => r.classList.toggle('sel', r.dataset.c === code));
      view.querySelector(`tr[data-c="${code}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
  });
  const card = $('#gp-card');
  async function showCard(code) {
    card.hidden = false; card.innerHTML = `<div class="sub">${esc(t('Reading'))}…</div>`;
    card.innerHTML = await countryCard(code, g);
    card.querySelector('.globe-card-x')?.addEventListener('click', () => { card.hidden = true; });
  }
  if (pick) { globeView.focus(pick); showCard(pick); }
  view.querySelectorAll('tr[data-c]').forEach((r) => r.addEventListener('click', () => { globeView.focus(r.dataset.c); showCard(r.dataset.c); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}

// ============================================================== missions ==

const GLYPH = { base: '◇', coin: '◎', spark: '✦', shield: '⛉', globe: '◍' };
export async function renderMissions() {
  const m = await api('/api/missions');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The journeys a company takes, in the order most take them. Every step is a question put to the record — so a step is done when the company has done it, and stays honest if somebody undoes it. Each one takes you to where it is done.'))}</p></div>
  <div class="kpis">${kpi('Journey', `${m.pct}%`, `${m.done}/${m.total} ${esc(t('steps'))}`, m.pct === 100 ? 'ok' : 'ai')}${kpi('Missions complete', m.missions.filter((x) => x.complete).length, `${esc(t('of'))} ${m.missions.length}`)}
    ${m.next ? `<a class="kpi human" href="${esc(m.next.step.href)}"><div class="k-label">${esc(t('Next'))}</div><div class="k-val" style="font-size:20px;font-weight:600">${esc(t(m.next.step.title))}</div><div class="k-sub">${esc(t(m.next.title))}</div></a>` : ''}</div>
  <div class="m-bar" style="height:6px"><i style="--w:${m.pct}%"></i></div>
  <div class="missions">${m.missions.map((x) => `
    <div class="panel mission ${x.complete ? 'complete' : ''}">
      <div class="inline" style="justify-content:space-between"><span style="font-size:26px;color:var(--sx-ai)" aria-hidden="true">${GLYPH[x.glyph] || '◇'}</span><span class="chip ${x.complete ? 'chip-ok' : ''}">${x.done}/${x.total}</span></div>
      <h3>${esc(t(x.title))}</h3><p class="sub">${esc(t(x.blurb))}</p>
      <div class="m-bar"><i style="--w:${Math.round((x.done / x.total) * 100)}%"></i></div>
      <ol>${x.steps.map((s) => `<li class="${s.done ? 'done' : ''}">${!s.perm || hasPermC(s.perm)
        ? `<a href="${esc(s.href)}"><span class="m-check" aria-hidden="true">${s.done ? '✓' : ''}</span>${esc(t(s.title))}<span class="sr-only">${esc(t(s.done ? 'done' : 'to do'))}</span></a>`
        : `<span class="m-locked"><span class="m-check" aria-hidden="true">${s.done ? '✓' : ''}</span>${esc(t(s.title))} <span class="sub">· ${esc(t('needs someone else'))}</span></span>`}</li>`).join('')}</ol>
    </div>`).join('')}</div>`;
}

// ========================================================== health index ==

const PCOL = { money: 'var(--sx-human-bright)', operations: 'var(--sx-info)', people: 'var(--sx-human)', ai: 'var(--sx-ai)', governance: 'var(--sx-ok)' };
function trendSvg(trend) {
  if (trend.length < 2) return `<p class="sub">${esc(t('The trend starts with today’s reading; one point is added each day.'))}</p>`;
  const W = 600; const H = 120;
  const x = (i) => (i / (trend.length - 1)) * (W - 20) + 10;
  const y = (v) => H - 10 - (v / 100) * (H - 20);
  const pts = trend.map((r, i) => `${x(i).toFixed(1)},${y(r.score).toFixed(1)}`).join(' ');
  return `<svg class="hi-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t('The index, day by day'))}">
    <defs><linearGradient id="hi-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sx-ai)" stop-opacity=".35"/><stop offset="1" stop-color="var(--sx-ai)" stop-opacity="0"/></linearGradient></defs>
    <polygon points="10,${H - 10} ${pts} ${x(trend.length - 1).toFixed(1)},${H - 10}" fill="url(#hi-g)"/>
    <polyline points="${pts}" fill="none" stroke="var(--sx-ai)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="meter-label"><span>${esc(trend[0].day)}</span><span>${esc(trend.at(-1).day)}</span></div>`;
}
export async function renderHealthIndex() {
  const h = await api('/api/healthindex');
  const C = 2 * Math.PI * 70;
  const tone = { strong: 'var(--sx-ok)', steady: 'var(--sx-ai)', strained: 'var(--sx-human-bright)', critical: 'var(--sx-bad)' }[h.band] || 'var(--sx-faint)';
  view.innerHTML = `
  <div class="panel hi-hero">
    <div class="ring"><svg viewBox="0 0 168 168" aria-hidden="true" focusable="false"><defs><linearGradient id="m-ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--sx-ai)"/><stop offset="1" stop-color="${tone}"/></linearGradient></defs>
      <circle class="ring-track" cx="84" cy="84" r="70"/><circle class="ring-val" cx="84" cy="84" r="70" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(h.score == null ? C : C * (1 - h.score / 100)).toFixed(1)}"/></svg>
      <div class="ring-num"><div><b data-count>${h.score ?? '—'}</b><span>${esc(t(h.band))}</span></div></div></div>
    <div><h2 class="deck-hello" style="font-size:34px">${esc(t('How the company is doing'))}</h2>
      <p class="deck-sub" style="max-width:70ch">${esc(t('One number, taken apart: five pillars, each the average of readings from the record, each reading scored on a straight line between a good and a bad threshold. A pillar with nothing to read is left out rather than counted as perfect.'))}</p>
      ${h.focus ? `<a class="mission-next" style="margin-top:12px;max-width:520px" href="${esc(h.focus.href)}"><span aria-hidden="true" style="font-size:22px">⚑</span><span><small>${esc(t('Dragging it most'))}</small>${esc(t(h.focus.label))}: ${esc(String(h.focus.value))}</span></a>` : ''}
      ${trendSvg(h.trend)}</div>
  </div>
  <div class="hi-pillars">${h.pillars.map((p) => `
    <div class="panel"><div class="panel-title">${esc(t(p.label))}<span class="hi-score" style="color:${PCOL[p.id]}">${p.score ?? '—'}</span></div>
      <div class="pillar" style="grid-template-columns:1fr"><i style="--w:${p.score ?? 0}%;--c:${PCOL[p.id]}"></i></div>
      ${p.readings.length ? p.readings.map((r) => `<a class="hi-reading" href="${esc(r.href)}"><span>${esc(t(r.label))}</span><b>${esc(t(String(r.value)))}${r.unit ? ` ${esc(t(r.unit))}` : ''}</b><span class="hi-score">${r.score}</span></a>`).join('')
        : `<div class="empty">${esc(t('Nothing to read yet — this pillar is left out of the index.'))}</div>`}
    </div>`).join('')}</div>
  <p class="sub">${esc(t(h.method))}</p>`;
}

// =============================================================== what if ==

function chart(r) {
  const W = 760; const H = 300; const P = 36;
  const all = [...r.curve.map((c) => c.cash), ...r.baseCurve, 0];
  const lo = Math.min(...all); const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i) => P + (i / Math.max(1, r.curve.length - 1)) * (W - P * 2);
  const y = (v) => H - P - ((v - lo) / span) * (H - P * 2);
  const line = r.curve.map((c, i) => `${x(i).toFixed(1)},${y(c.cash).toFixed(1)}`).join(' ');
  const base = r.baseCurve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [0, Math.floor((r.curve.length - 1) / 2), r.curve.length - 1];
  return `<svg class="wi-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('Cash, month by month'))}">
    <defs><linearGradient id="wi-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sx-ai)" stop-opacity=".28"/><stop offset="1" stop-color="var(--sx-ai)" stop-opacity="0"/></linearGradient></defs>
    <line class="wi-zero" x1="${P}" x2="${W - P}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
    <polygon class="wi-area" points="${x(0).toFixed(1)},${y(lo).toFixed(1)} ${line} ${x(r.curve.length - 1).toFixed(1)},${y(lo).toFixed(1)}"/>
    <polyline class="wi-base" points="${base}"/><polyline class="wi-line" points="${line}"/>
    ${ticks.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(t('month'))} ${r.curve[i].month}</text>`).join('')}
    <text x="${P}" y="${(y(hi) - 6).toFixed(1)}">${money(hi)}</text><text x="${P}" y="${(y(lo) + 14).toFixed(1)}">${money(lo)}</text></svg>`;
}
const LEVER_UI = [
  { k: 'revenuePct', label: 'Revenue change', min: -100, max: 200, step: 5, unit: '%' },
  { k: 'growthPct', label: 'Revenue growth a month', min: -20, max: 30, step: 1, unit: '%' },
  { k: 'costPct', label: 'Cost change', min: -80, max: 200, step: 5, unit: '%' },
  { k: 'hires', label: 'People hired', min: 0, max: 50, step: 1, unit: '' },
  { k: 'salary', label: 'Monthly cost of each hire', min: 0, max: 20000, step: 250, unit: '' },
  { k: 'oneOff', label: 'One-off now (in or out)', min: -500000, max: 500000, step: 5000, unit: '' },
  { k: 'horizon', label: 'Months ahead', min: 6, max: 36, step: 1, unit: '' },
];
export async function renderWhatIf() {
  const ov = await api('/api/whatif');
  const canM = hasPermC('whatif.manage');
  const b = ov.baseline;
  const p = { revenuePct: 0, growthPct: 0, costPct: 0, hires: 0, salary: 1500, oneOff: 0, horizon: 18 };
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The next months of cash if something changes. It starts from the record — cash in the registered accounts, the average month of the last three closed ones — and walks forward a month at a time. Arithmetic, never sent to a model, never applied to the books.'))}</p></div>
  <div class="kpis">${kpi('Cash now', money(b.cash), `${b.accounts} ${esc(t('accounts'))}`)}${kpi('Average revenue a month', money(b.revenue))}${kpi('Average expenses a month', money(b.expenses))}${kpi('Burn a month', money(b.expenses - b.revenue), '', b.expenses > b.revenue ? 'bad' : 'ok')}</div>
  <div class="wi-grid">
    <div class="panel"><div class="panel-title">${esc(t('Levers'))}</div>
      ${LEVER_UI.map((l) => `<div class="wi-lever"><label for="wi-${l.k}">${esc(t(l.label))}<output id="wi-o-${l.k}"></output></label><input id="wi-${l.k}" data-k="${l.k}" type="range" min="${l.min}" max="${l.max}" step="${l.step}" value="${p[l.k]}"></div>`).join('')}
      ${canM ? `<form id="wi-save" class="inline" style="margin-top:8px"><label class="sr-only" for="wi-name">${esc(t('Name'))}</label><input id="wi-name" required maxlength="120" placeholder="${esc(t('Name this scenario'))}" style="flex:1"><button class="btn btn-primary btn-sm" type="submit">${esc(t('Keep'))}</button></form>` : ''}
    </div>
    <div class="panel"><div class="panel-title">${esc(t('Cash, month by month'))}<span class="sub">— ${esc(t('dashed: as things are'))}</span></div><div id="wi-chart"></div><div class="kpis" id="wi-sum" style="margin-top:12px"></div></div>
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Kept scenarios'))}</div>
    ${ov.scenarios.length ? `<table class="tbl"><thead><tr><th>${esc(t('Name'))}</th><th>${esc(t('Levers'))}</th><th class="num">${esc(t('Cash at the end'))}</th><th>${esc(t('Runs out'))}</th><th>${esc(t('Breaks even'))}</th><th>${esc(t('By'))}</th><th></th></tr></thead><tbody>
      ${ov.scenarios.map((s) => `<tr><td dir="auto"><b>${esc(s.name)}</b></td><td class="sub ltr">${esc(Object.entries(s.params).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · '))}</td><td class="num">${money(s.result.endCash)}</td><td>${s.result.runsOutInMonth ? `${esc(t('month'))} ${s.result.runsOutInMonth}` : '—'}</td><td>${s.result.breaksEvenInMonth ? `${esc(t('month'))} ${s.result.breaksEvenInMonth}` : '—'}</td><td class="sub">${esc(s.created_by.replace(/^human:/, ''))} · ${ago(s.created_at)}</td>
        <td>${canM ? `<button type="button" class="btn btn-sm btn-ghost" data-load="${s.id}">${esc(t('Load'))}</button><button type="button" class="btn btn-sm btn-ghost" data-rm="${s.id}" aria-label="${esc(t('Remove'))} ${esc(s.name)}">×</button>` : `<button type="button" class="btn btn-sm btn-ghost" data-load="${s.id}">${esc(t('Load'))}</button>`}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${esc(t('Nothing kept yet. Move the levers, name what you see, and keep it.'))}</div>`}</div>`;
  let pending = 0;
  const run = () => {
    for (const l of LEVER_UI) $(`#wi-o-${l.k}`).textContent = `${l.k === 'salary' || l.k === 'oneOff' ? money(p[l.k]) : p[l.k]}${l.unit}`;
    clearTimeout(pending);
    pending = setTimeout(async () => {
      try {
        const r = await api(`/api/whatif/run?${new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]))}`);
        $('#wi-chart').innerHTML = chart(r);
        const s = r.summary;
        $('#wi-sum').innerHTML = `${kpi('Cash at the end', money(s.endCash), `${esc(t('as things are'))}: ${money(s.baseEndCash)}`, s.endCash < 0 ? 'bad' : 'ok')}
          ${kpi('Runs out', s.runsOutInMonth ? `${esc(t('month'))} ${s.runsOutInMonth}` : esc(t('not within the horizon')), '', s.runsOutInMonth ? 'bad' : 'ok')}
          ${kpi('Breaks even', s.breaksEvenInMonth ? `${esc(t('month'))} ${s.breaksEvenInMonth}` : '—', '', s.breaksEvenInMonth ? 'ok' : '')}
          ${kpi('Burn a month', money(s.monthlyBurn), '', s.monthlyBurn > 0 ? 'human' : 'ok')}`;
      } catch (e) { toast(e.message, true); }
    }, 120);
  };
  view.querySelectorAll('input[type="range"]').forEach((el) => el.addEventListener('input', () => { p[el.dataset.k] = Number(el.value); run(); }));
  $('#wi-save')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/whatif', { method: 'POST', body: { name: $('#wi-name').value, params: p } }); toast(t('Kept')); renderWhatIf(); } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('[data-load]').forEach((btn) => btn.addEventListener('click', () => {
    const s = ov.scenarios.find((x) => String(x.id) === btn.dataset.load);
    Object.assign(p, s.params);
    for (const l of LEVER_UI) $(`#wi-${l.k}`).value = p[l.k];
    run();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  view.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!window.confirm(t('Remove this scenario?'))) return;
    try { await api(`/api/whatif/${btn.dataset.rm}/remove`, { method: 'POST', body: {} }); renderWhatIf(); } catch (err) { toast(err.message, true); }
  }));
  run();
}

// ============================================================ broadcasts ==

export async function renderBroadcasts() {
  const ov = await api('/api/broadcasts');
  const canM = hasPermC('broadcasts.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('One message to everybody in the company. It sits on top of every page until each person acknowledges it, and you can see who has. It stays inside the console — nothing is sent anywhere.'))}</p></div>
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Tell everybody'))}</div>
    <form id="bc-new" class="grid grid-2">
      <div><label class="fl" for="bc-title">${esc(t('Title'))}</label><input id="bc-title" name="title" required maxlength="160" dir="auto" style="width:100%"></div>
      <div class="grid grid-2"><div><label class="fl" for="bc-level">${esc(t('Level'))}</label><select id="bc-level" name="level"><option value="info">${esc(t('For everyone'))}</option><option value="important">${esc(t('Important'))}</option><option value="critical">${esc(t('Critical'))}</option></select></div>
        <div><label class="fl" for="bc-days">${esc(t('Days on screen (empty: until ended)'))}</label><input id="bc-days" name="days" type="number" min="1" max="90"></div></div>
      <div style="grid-column:1/-1"><label class="fl" for="bc-body">${esc(t('Details'))}</label><textarea id="bc-body" name="body" rows="3" dir="auto" style="width:100%"></textarea></div>
      <div><button class="btn btn-primary" type="submit">${esc(t('Broadcast'))}</button></div>
    </form></div>` : ''}
  <div class="panel"><div class="panel-title">${esc(t('Broadcasts'))}</div>
    ${ov.items.length ? `<table class="tbl"><thead><tr><th>${esc(t('Message'))}</th><th>${esc(t('Level'))}</th><th>${esc(t('Read by'))}</th><th>${esc(t('By'))}</th><th></th></tr></thead><tbody>
      ${ov.items.map((b) => `<tr><td dir="auto"><b>${esc(b.title)}</b>${b.body ? `<div class="sub">${esc(b.body)}</div>` : ''}</td><td><span class="chip ${b.level === 'critical' ? 'chip-bad' : b.level === 'important' ? 'chip-warn' : ''}">${esc(t(b.level === 'critical' ? 'Critical' : b.level === 'important' ? 'Important' : 'For everyone'))}</span>${b.live ? '' : ` <span class="chip chip-dim">${esc(t('ended'))}</span>`}</td>
        <td><div class="m-bar" style="width:120px"><i style="--w:${ov.people ? Math.round((b.readers / ov.people) * 100) : 0}%"></i></div><span class="sub">${b.readers}/${ov.people}</span></td>
        <td class="sub">${esc(String(b.created_by).replace(/^human:/, ''))} · ${ago(b.created_at)}</td>
        <td>${canM && b.live ? `<button type="button" class="btn btn-sm" data-end="${b.id}">${esc(t('End'))}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${esc(t('Nothing has been broadcast yet.'))}</div>`}</div>`;
  $('#bc-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/api/broadcasts', { method: 'POST', body: { title: f.title, body: f.body || null, level: f.level, days: f.days || null } }); toast(t('Broadcast')); renderBroadcasts(); } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('[data-end]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await api(`/api/broadcasts/${btn.dataset.end}/end`, { method: 'POST', body: {} }); renderBroadcasts(); } catch (err) { toast(err.message, true); }
  }));
}
