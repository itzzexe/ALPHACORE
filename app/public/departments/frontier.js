// The frontier: what a founder who looks up keeps open — the horizon radar,
// the market atlas and the naming studio. All three read public services
// through live data and show what was read, with its time; none of them asks
// a model to summarise the world.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t, lang } from '/i18n.js';
import { kpi, ago, spark } from '../components/ui.js';
import { countryName } from '../components/geo.js';

const loc = () => (lang === 'ar' ? 'ar' : 'en-US');
const num = (n, d = 0) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString(loc(), { maximumFractionDigits: d }));
const compact = (n) => (n == null ? '—' : Number(n).toLocaleString(loc(), { notation: 'compact', maximumFractionDigits: 1 }));
const ext = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(label)}</a>`;
const offCallout = () => `<div class="callout warn">${esc(t('Live data is off, so nothing new is read. What was read before is still shown with its time.'))} ${hasPermC('livedata.manage') ? `<a href="#/livedata">${esc(t('Switch live data on'))} →</a>` : ''}</div>`;

// ================================================================= radar ==

const SIGNAL = {
  'attention.rising': { g: '▲', label: 'Attention rising', tone: 'ok' },
  'attention.falling': { g: '▼', label: 'Attention falling', tone: 'bad' },
  'stories.hot': { g: '◆', label: 'Everybody is discussing', tone: 'human' },
  'repos.breakout': { g: '★', label: 'A breakout project', tone: 'ai' },
  'jobs.demand': { g: '◎', label: 'Hiring for it', tone: 'ai' },
};

export async function renderRadar() {
  const d = await api('/api/radar');
  const canM = hasPermC('radar.manage');
  const open = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('t')) || null;
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The subjects you keep an eye on — a technology, a market, a competitor, an idea — and what the world is doing about each: how much attention the public pays it, what builders posted this month, the newest research, the open-source projects started this quarter, and who is hiring. Read through the gate, shown as read. A change worth knowing about becomes a signal.'))}</p></div>
  ${d.live ? '' : offCallout()}
  ${canM ? `<form class="panel rd-add" id="rd-add">
    <div class="rd-add-main"><label class="sr-only" for="rd-q">${esc(t('A subject to watch'))}</label><input id="rd-q" required minlength="2" maxlength="80" dir="auto" placeholder="${esc(t('A subject to watch — e.g. fintech, solar energy, a competitor'))}">
      <label class="sr-only" for="rd-w">${esc(t('Wikipedia page (optional)'))}</label><input id="rd-w" maxlength="200" dir="auto" placeholder="${esc(t('Wikipedia page (optional)'))}">
      <label class="sr-only" for="rd-l">${esc(t('Language'))}</label><select id="rd-l"><option value="en">English</option><option value="ar">العربية</option></select>
      <button class="btn btn-primary" type="submit">${esc(t('Watch'))}</button></div>
    <span class="sub">${d.topics.length}/${d.limit} ${esc(t('subjects'))}</span></form>` : ''}

  ${d.signals.length ? `<div class="rd-signals">${d.signals.slice(0, 8).map((s) => { const k = SIGNAL[s.kind] || { g: '·', label: s.kind, tone: '' }; return `
    <a class="rd-signal t-${k.tone}" href="#/radar?t=${s.topic_id}"><span class="rd-sg" aria-hidden="true">${k.g}</span><span><small>${esc(t(k.label))} · ${esc(s.day)}</small><b dir="auto">${esc(s.query)}</b><span class="sub" dir="auto">${esc(s.text)}</span></span></a>`; }).join('')}</div>` : ''}

  ${d.topics.length ? `<div class="rd-grid">${d.topics.map((x) => topicCard(x, open)).join('')}</div>`
    : `<div class="panel eq-start"><h3>${esc(t('Put the first subject on the radar'))}</h3><p class="sub">${esc(t('Every subject is read every few hours through live data. Start with the market you are in, the technology you build on, and the competitor you worry about.'))}</p></div>`}

  <div id="rd-detail"></div>

  <div class="panel"><div class="panel-title">${esc(t('What builders are reading right now'))}<span class="sub">— Hacker News${d.frontpage.fetchedAt ? ` · ${esc(ago(d.frontpage.fetchedAt))}` : ''}</span></div>
    ${d.frontpage.stories.length ? `<ol class="rd-front">${d.frontpage.stories.map((s) => `<li>${ext(s.url, s.title)}<span class="sub ltr">${num(s.points)} ▲ · ${num(s.comments)} ${esc(t('comments'))}</span></li>`).join('')}</ol>` : `<div class="empty">${esc(t('Not read yet.'))}</div>`}
  </div>`;

  $('#rd-add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/radar', { method: 'POST', body: { query: $('#rd-q').value, wikiTitle: $('#rd-w').value || null, lang: $('#rd-l').value } });
      toast(t('On the radar — reading it now'));
      await api(`/api/radar/${r.id}/read`, { method: 'POST', body: {} }).catch(() => null);
      location.hash = `#/radar?t=${r.id}`;
      renderRadar();
    } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openTopic(Number(b.dataset.open))));
  if (open) openTopic(open);
}

function topicCard(x, open) {
  const tr = x.trend;
  const chip = tr?.ratio == null ? '' : `<span class="chip ${tr.ratio >= 1.5 ? 'chip-ok' : tr.ratio <= 0.6 ? 'chip-bad' : ''}">${tr.ratio >= 1 ? '▲' : '▼'} ${num(Math.abs((tr.ratio - 1) * 100))}%</span>`;
  return `<button type="button" class="panel rd-card ${open === x.id ? 'sel' : ''}" data-open="${x.id}">
    <div class="rd-card-head"><b dir="auto">${esc(x.query)}</b>${chip}</div>
    <div class="rd-spark">${x.spark.length > 7 ? spark(x.spark) : `<span class="sub">${esc(t(x.missingPage ? 'no encyclopaedia page — set one' : x.read ? 'no attention data' : 'not read yet'))}</span>`}</div>
    <div class="rd-counts">
      <span><b>${compact(tr?.week)}</b><small>${esc(t('readers a day'))}</small></span>
      <span><b>${compact(x.stories)}</b><small>${esc(t('stories'))}</small></span>
      <span><b>${compact(x.papers)}</b><small>${esc(t('papers'))}</small></span>
      <span><b>${compact(x.repos)}</b><small>${esc(t('projects'))}</small></span>
      <span><b>${compact(x.jobs)}</b><small>${esc(t('jobs'))}</small></span>
    </div>
    ${x.topStory ? `<div class="rd-top sub" dir="auto">◆ ${esc(x.topStory.title)}</div>` : ''}
  </button>`;
}

async function openTopic(id) {
  const host = $('#rd-detail');
  if (!host) return;
  view.querySelectorAll('.rd-card').forEach((c) => c.classList.toggle('sel', Number(c.dataset.open) === id));
  host.innerHTML = `<div class="panel"><div class="sub">${esc(t('Reading'))}…</div></div>`;
  let x;
  try { x = await api(`/api/radar/${id}`); } catch (e) { host.innerHTML = ''; toast(e.message, true); return; }
  const canM = hasPermC('radar.manage');
  const series = x.attention?.series || [];
  host.innerHTML = `<div class="panel rd-detail">
    <div class="panel-title"><span dir="auto">${esc(x.query)}</span><span class="sub">— ${esc(t('watched since'))} ${esc(String(x.created_at).slice(0, 10))}</span>
      ${canM ? `<span class="inline"><button type="button" class="btn btn-sm" id="rd-read">↻ ${esc(t('Read now'))}</button><button type="button" class="btn btn-sm btn-ghost" id="rd-arch">${esc(t('Stop watching'))}</button></span>` : ''}</div>
    <div class="rd-att">
      <div><h4>${esc(t('Public attention'))}</h4><p class="sub">${esc(t('Daily readers of the page'))} <span class="ltr">${esc(x.wiki_title || '')}</span> · ${esc(t('ninety days'))}${x.attention?.fetchedAt ? ` · ${esc(ago(x.attention.fetchedAt))}` : ''}</p>
        ${series.length ? attentionChart(series) : `<div class="empty">${esc(t(x.attention?.missing ? 'There is no encyclopaedia page by that title. Give the exact page title and attention can be measured.' : 'Not read yet.'))}</div>`}
        ${canM ? `<form class="inline" id="rd-title" style="margin-top:8px"><label class="sr-only" for="rd-tt">${esc(t('Wikipedia page'))}</label><input id="rd-tt" value="${esc(x.wiki_title || '')}" dir="auto" style="flex:1"><button class="btn btn-sm" type="submit">${esc(t('Measure this page'))}</button></form>` : ''}
      </div>
      <div class="rd-trend">${x.attention?.trend ? `<b class="ltr">${num(x.attention.trend.week)}</b><span>${esc(t('readers a day this week'))}</span><b class="ltr">${num(x.attention.trend.before)}</b><span>${esc(t('the four weeks before'))}</span>` : ''}</div>
    </div>
    <div class="grid grid-2 rd-cols">
      <div><h4>${esc(t('What builders posted this month'))} <span class="sub">${num(x.stories?.total)} · Hacker News</span></h4>
        ${(x.stories?.top || []).length ? `<ol class="rd-list">${x.stories.top.slice(0, 8).map((s) => `<li>${ext(s.url, s.title)}<span class="sub ltr">${num(s.points)} ▲ · ${num(s.comments)} ${esc(t('comments'))} · ${esc(String(s.at).slice(0, 10))}</span></li>`).join('')}</ol>` : `<div class="empty">${esc(t('Nothing this month.'))}</div>`}</div>
      <div><h4>${esc(t('The newest research'))} <span class="sub">${num(x.papers?.total)} · arXiv</span></h4>
        ${(x.papers?.latest || []).length ? `<ol class="rd-list">${x.papers.latest.slice(0, 6).map((p) => `<li>${ext(p.id, p.title)}<span class="sub">${esc(p.authors.join(', '))} · ${esc(p.published)}</span></li>`).join('')}</ol>` : `<div class="empty">${esc(t('No papers found.'))}</div>`}</div>
      <div><h4>${esc(t('Projects started this quarter'))} <span class="sub">${num(x.repos?.total)} · GitHub</span></h4>
        ${(x.repos?.top || []).length ? `<ol class="rd-list">${x.repos.top.map((r) => `<li><span class="rd-line1">${ext(r.url, r.name)} <span class="chip ltr">★ ${compact(r.stars)}</span>${r.language ? ` <span class="chip chip-dim">${esc(r.language)}</span>` : ''}</span><span class="sub" dir="auto">${esc(r.description)}</span></li>`).join('')}</ol>` : `<div class="empty">${esc(t('None yet.'))}</div>`}</div>
      <div><h4>${esc(t('Who is hiring for it'))} <span class="sub">${num(x.jobs?.count)} ${esc(t('companies'))}${x.jobs?.remote ? ` · ${num(x.jobs.remote)} ${esc(t('remote'))}` : ''} · ${x.jobs?.thread ? ext(x.jobs.thread.url, x.jobs.thread.title) : 'Hacker News'}</span></h4>
        ${x.jobs?.count ? `<div class="rd-tags">${x.jobs.companies.slice(0, 6).map(([c, n]) => `<span class="chip">${esc(c)} · ${n}</span>`).join('')}</div>
          <div class="rd-tags">${x.jobs.regions.slice(0, 8).map(([c, n]) => `<span class="chip chip-dim" dir="auto">${esc(c === 'Remote' ? t('Remote') : c)} · ${n}</span>`).join('')}</div>
          ${x.jobs.withPay.length ? `<ol class="rd-list">${x.jobs.withPay.slice(0, 5).map((j) => `<li>${ext(j.url, j.title)} <b class="ltr">${esc(j.salary)}</b><span class="sub">${esc(j.company)}</span></li>`).join('')}</ol>` : ''}`
          : `<div class="empty">${esc(t('No company named it in this month\'s thread.'))}</div>`}</div>
    </div>
    ${x.signals.length ? `<h4>${esc(t('Signals'))}</h4><div class="rows">${x.signals.slice(0, 10).map((s) => `<div class="row"><span class="rd-sg" aria-hidden="true">${(SIGNAL[s.kind] || {}).g || '·'}</span><div class="row-main"><div class="row-title" dir="auto">${esc(s.text)}</div><div class="row-meta">${esc(t((SIGNAL[s.kind] || {}).label || s.kind))} · ${esc(s.day)}</div></div></div>`).join('')}</div>` : ''}
    ${x.errors.length ? `<p class="sub t-bad">${esc(t('Some services did not answer the last time:'))} ${esc(x.errors.join(' · ').slice(0, 300))}</p>` : ''}
  </div>`;
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#rd-read')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api(`/api/radar/${id}/read`, { method: 'POST', body: {} }); renderRadar(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
  $('#rd-arch')?.addEventListener('click', async () => {
    if (!window.confirm(t('Stop watching this subject?'))) return;
    try { await api(`/api/radar/${id}/archive`, { method: 'POST', body: {} }); location.hash = '#/radar'; renderRadar(); } catch (err) { toast(err.message, true); }
  });
  $('#rd-title')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/radar/${id}`, { method: 'POST', body: { wikiTitle: $('#rd-tt').value } }); await api(`/api/radar/${id}/read`, { method: 'POST', body: {} }).catch(() => null); openTopic(id); } catch (err) { toast(err.message, true); }
  });
}

/** Ninety days of readers as an area, the last week lit. */
function attentionChart(series) {
  const v = series.map(([, n]) => n);
  const max = Math.max(1, ...v);
  const W = 600; const H = 120;
  const x = (i) => (i / Math.max(1, v.length - 1)) * W;
  const y = (n) => H - 6 - (n / max) * (H - 16);
  const line = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(' ');
  const cut = x(Math.max(0, v.length - 7));
  return `<svg class="rd-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t('Public attention'))}">
    <defs><linearGradient id="rd-g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--sx-ai)" stop-opacity=".35"/><stop offset="1" stop-color="var(--sx-ai)" stop-opacity="0"/></linearGradient></defs>
    <rect x="${cut.toFixed(1)}" y="0" width="${(W - cut).toFixed(1)}" height="${H}" class="rd-week"/>
    <path d="${line} L${W} ${H} L0 ${H} Z" fill="url(#rd-g)"/><path d="${line}" class="rd-line" vector-effect="non-scaling-stroke"/>
    <text x="4" y="12">${esc(compact(max))}</text></svg>`;
}

// ================================================================= atlas ==

const PILLAR = { size: 'Size', growth: 'Growth', wealth: 'Wealth', digital: 'Digital reach', stability: 'Stability', proximity: 'Proximity' };
const PILLAR_KEYS = Object.keys(PILLAR);

/** Six pillars as a hexagon: the shape of a market. Home is the dashed outline. */
function hexRadar(p, home = null, size = 220) {
  const c = size / 2; const r = size / 2 - 46;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i * Math.PI) / 3; const k = (v ?? 0) / 100; return [c + Math.cos(a) * r * k, c + Math.sin(a) * r * k]; };
  const poly = (vals) => PILLAR_KEYS.map((k, i) => pt(i, vals[k]).map((n) => n.toFixed(1)).join(',')).join(' ');
  const grid = [25, 50, 75, 100].map((g) => `<polygon class="ax-grid" points="${PILLAR_KEYS.map((_, i) => pt(i, g).map((n) => n.toFixed(1)).join(',')).join(' ')}"/>`).join('');
  // Side labels anchor away from the shape, so a long word grows outward instead of over it.
  const anchor = (i) => (i === 0 || i === 3 ? 'middle' : i < 3 ? 'start' : 'end');
  const labels = PILLAR_KEYS.map((k, i) => { const [x, y] = pt(i, 118); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor(i)}" dominant-baseline="middle">${esc(t(PILLAR[k]))}</text>`; }).join('');
  return `<svg class="ax-radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(PILLAR_KEYS.map((k) => `${t(PILLAR[k])} ${p[k] ?? '—'}`).join(', '))}">${grid}
    ${home ? `<polygon class="ax-home" points="${poly(home)}"/>` : ''}<polygon class="ax-shape" points="${poly(p)}"/>${labels}</svg>`;
}

export async function renderAtlas() {
  const d = await api('/api/atlas');
  const canM = hasPermC('atlas.manage');
  const st = { region: 'mena', w: { ...d.defaults } };
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Where the company could go next. Every economy is ranked on the World Bank\'s own figures — size, growth, wealth, digital reach, stability (prices, political stability, regulation, control of corruption) and how near it is — with the weights you choose. A score means better than the others on the same list, not a grade; a figure the World Bank does not have is left out, not counted as zero.'))}</p></div>
  ${d.live ? '' : offCallout()}
  ${!d.ready ? `<div class="panel eq-start"><h3>${esc(t('The world has not been read yet'))}</h3><p class="sub">${esc(t('Live data reads the figures for every economy once a week. Switch it on and the atlas fills in.'))}</p></div>` : `
  <div class="kpis">${kpi('Economies', d.economies, `${esc(t('read'))} ${esc(ago(d.fetchedAt))}`, 'ai')}${kpi('Shortlisted', d.shortlist.length, `${d.shortlist.filter((x) => x.stage === 'entering' || x.stage === 'operating').length} ${esc(t('entering or operating'))}`, 'human')}${kpi('Home', d.home ? esc(countryName(d.home, lang)) : '—', esc(t('the benchmark')))}</div>
  <div class="panel ax-controls">
    <div class="ax-regions" role="tablist">${[...d.regions, { id: 'shortlist', label: 'The shortlist' }, { id: 'all', label: 'Every economy' }].map((r) => `<button type="button" role="tab" data-region="${r.id}" class="${r.id === st.region ? 'on' : ''}" aria-selected="${r.id === st.region}">${esc(t(r.label))}</button>`).join('')}</div>
    <div class="ax-weights">${PILLAR_KEYS.map((k) => `<div class="wi-lever"><label for="ax-${k}">${esc(t(PILLAR[k]))}<output id="ax-o-${k}">${st.w[k]}</output></label><input id="ax-${k}" data-k="${k}" type="range" min="0" max="5" step="1" value="${st.w[k]}"></div>`).join('')}</div>
  </div>
  <div id="ax-podium" class="ax-podium"></div>
  <div class="panel"><div class="panel-title">${esc(t('The ranking'))}<span class="sub" id="ax-sub"></span></div><div class="tbl-wrap" id="ax-table"></div></div>
  <div class="panel"><div class="panel-title">${esc(t('The shortlist'))}<span class="sub">— ${esc(t('the markets being decided on, and how far along'))}</span></div>
    ${d.shortlist.length ? `<div class="ax-stages">${d.stages.map((s) => `<div class="ax-stage"><h4>${esc(t(s))} <span class="sub">${d.shortlist.filter((x) => x.stage === s).length}</span></h4>
      ${d.shortlist.filter((x) => x.stage === s).map((x) => `<div class="ax-mk"><b>${esc(countryName(x.code, lang))}</b><span class="sub">${esc(x.capital || '')}${x.note ? ` · <span dir="auto">${esc(x.note)}</span>` : ''}</span>
        ${canM ? `<div class="inline"><label class="sr-only" for="ax-st-${x.code}">${esc(t('Stage'))}</label><select id="ax-st-${x.code}" data-stage="${x.code}">${d.stages.map((o) => `<option value="${o}" ${o === x.stage ? 'selected' : ''}>${esc(t(o))}</option>`).join('')}</select><button type="button" class="btn btn-sm btn-ghost" data-unlist="${x.code}" aria-label="${esc(t('Remove'))} ${esc(countryName(x.code, lang))}">×</button></div>` : ''}</div>`).join('')}</div>`).join('')}</div>`
      : `<div class="empty">${esc(t('Nothing shortlisted yet. Add a market from the ranking.'))}</div>`}
  </div>`}`;
  if (!d.ready) return;

  let pending = 0;
  const run = () => {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      const qs = new URLSearchParams({ region: st.region, ...Object.fromEntries(PILLAR_KEYS.map((k) => [`w_${k}`, String(st.w[k])])) });
      let r;
      try { r = await api(`/api/atlas/score?${qs}`); } catch (e) { toast(e.message, true); return; }
      const home = r.homeRow?.pillars || null;
      $('#ax-sub').textContent = `— ${r.rows.length} ${t('markets')}`;
      $('#ax-podium').innerHTML = r.rows.slice(0, 3).map((x, i) => `<div class="panel ax-pod" style="--i:${i}"><div class="ax-rank">${i + 1}</div>
        <div><b>${esc(countryName(x.code, lang))}</b><span class="sub">${esc(x.capital || '')} · ${esc(t(x.income || ''))}</span></div>
        ${hexRadar(x.pillars, home)}<div class="ax-score"><b>${x.score}</b><span>${esc(t('of 100'))}</span></div>
        <p class="sub">${esc(t('Strongest'))}: ${x.strongest.map((p) => esc(t(PILLAR[p]))).join(' · ')}${x.weakest ? ` — ${esc(t('weakest'))}: ${esc(t(PILLAR[x.weakest]))}` : ''}</p></div>`).join('')
        + (home ? `<p class="sub ax-legend"><i class="ax-key"></i>${esc(t('the market'))} <i class="ax-key home"></i>${esc(t('home'))} (${esc(countryName(r.home, lang))})</p>` : '');
      $('#ax-table').innerHTML = r.rows.length ? `<table class="tbl ax-tbl"><thead><tr><th>#</th><th>${esc(t('Market'))}</th><th>${esc(t('Score'))}</th>${PILLAR_KEYS.map((k) => `<th class="num">${esc(t(PILLAR[k]))}</th>`).join('')}<th class="num">${esc(t('GDP'))}</th><th class="num">${esc(t('Growth'))}</th><th class="num">${esc(t('Per person'))}</th><th class="num">${esc(t('Online'))}</th><th class="num">${esc(t('Inflation'))}</th><th class="num">${esc(t('Distance'))}</th><th></th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr><td class="num">${x.rank}</td><td><b>${esc(countryName(x.code, lang))}</b>${x.raw.arabic ? ` <span class="chip chip-dim">${esc(t('Arabic'))}</span>` : ''}</td>
          <td><div class="ax-bar"><i style="--w:${x.score}%"></i><b>${x.score}</b></div></td>
          ${PILLAR_KEYS.map((k) => `<td class="num"><span class="ax-pill" style="--v:${x.pillars[k] ?? 0}">${x.pillars[k] ?? '—'}</span></td>`).join('')}
          <td class="num ltr">$${compact(x.raw.gdp)}</td><td class="num ltr">${x.raw.gdpGrowth == null ? '—' : `${num(x.raw.gdpGrowth, 1)}%`}</td><td class="num ltr">$${compact(x.raw.gdpPerCapita)}</td>
          <td class="num ltr">${x.raw.internet == null ? '—' : `${num(x.raw.internet)}%`}</td><td class="num ltr">${x.raw.inflation == null ? '—' : `${num(x.raw.inflation, 1)}%`}</td><td class="num ltr">${x.raw.distance == null ? '—' : `${compact(x.raw.distance)} km`}</td>
          <td>${x.shortlisted ? `<span class="chip chip-warn">${esc(t('shortlisted'))}</span>` : canM ? `<button type="button" class="btn btn-sm" data-short="${x.code}">＋ ${esc(t('Shortlist'))}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${esc(t('No market on this list has figures yet.'))}</div>`;
      view.querySelectorAll('[data-short]').forEach((b) => b.addEventListener('click', async () => {
        try { await api('/api/atlas/shortlist', { method: 'POST', body: { code: b.dataset.short } }); toast(t('Shortlisted')); renderAtlas(); } catch (e) { toast(e.message, true); }
      }));
    }, 120);
  };
  view.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => {
    st.region = b.dataset.region;
    view.querySelectorAll('[data-region]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    run();
  }));
  view.querySelectorAll('.ax-weights input').forEach((el) => el.addEventListener('input', () => { st.w[el.dataset.k] = Number(el.value); $(`#ax-o-${el.dataset.k}`).textContent = el.value; run(); }));
  view.querySelectorAll('[data-stage]').forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/atlas/shortlist/${s.dataset.stage}`, { method: 'POST', body: { stage: s.value } }); renderAtlas(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-unlist]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/atlas/shortlist/${b.dataset.unlist}/remove`, { method: 'POST', body: {} }); renderAtlas(); } catch (e) { toast(e.message, true); }
  }));
  run();
}

// ================================================================ naming ==

const STATE_CLS = { free: 'nm-free', taken: 'nm-taken', unknown: 'nm-unknown' };
const STATE_WORD = { free: 'free', taken: 'taken', unknown: 'cannot say' };

function scoreRing(score) {
  const C = 2 * Math.PI * 30;
  const off = score == null ? C : C * (1 - score / 100);
  return `<div class="nm-ring"><svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="30" class="nm-track"/><circle cx="36" cy="36" r="30" class="nm-val" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg><b>${score ?? '—'}</b></div>`;
}

function nameCard(n, tlds, canM) {
  const r = n.results;
  return `<div class="panel nm-card ${n.starred ? 'starred' : ''}">
    <div class="nm-head">${scoreRing(n.score)}<div><h3 dir="auto">${esc(n.name)}</h3><span class="sub ltr">${esc(n.label)} · ${esc(ago(n.checked_at))}</span></div>
      ${canM ? `<div class="nm-acts"><button type="button" class="btn btn-sm btn-ghost" data-star="${n.id}" aria-label="${esc(t(n.starred ? 'Unstar' : 'Star'))} ${esc(n.name)}" aria-pressed="${n.starred}">${n.starred ? '★' : '☆'}</button>
        <label class="sr-only" for="nm-v-${n.id}">${esc(t('Verdict'))}</label><select id="nm-v-${n.id}" data-verdict="${n.id}"><option value="" ${!n.verdict ? 'selected' : ''}>—</option>${['favourite', 'maybe', 'no'].map((v) => `<option value="${v}" ${n.verdict === v ? 'selected' : ''}>${esc(t(v))}</option>`).join('')}</select>
        <button type="button" class="btn btn-sm" data-recheck="${esc(n.name)}">↻</button><button type="button" class="btn btn-sm btn-ghost" data-rm="${n.id}" aria-label="${esc(t('Remove'))} ${esc(n.name)}">×</button></div>` : ''}</div>
    <div class="nm-zones">${tlds.map((z) => { const v = r.domains[z] || { state: 'unknown' }; return `<span class="nm-zone ${STATE_CLS[v.state]}" title="${esc(t(STATE_WORD[v.state]))}${v.expires ? ` · ${esc(t('expires'))} ${esc(v.expires)}` : ''}"><b class="ltr">.${esc(z)}</b><small>${esc(t(STATE_WORD[v.state]))}</small></span>`; }).join('')}
      <span class="nm-zone ${STATE_CLS[r.github?.state || 'unknown']}"><b>GitHub</b><small>${esc(t(STATE_WORD[r.github?.state || 'unknown']))}</small></span>
      <span class="nm-zone ${STATE_CLS[r.npm?.state || 'unknown']}"><b>npm</b><small>${esc(t(STATE_WORD[r.npm?.state || 'unknown']))}${r.npm?.downloads ? ` · ${compact(r.npm.downloads)}/${esc(t('mo'))}` : ''}</small></span></div>
    ${r.known ? `<p class="sub nm-known">◉ ${esc(t('Already known as'))}: <b dir="auto">${esc(r.known.title)}</b>${r.known.description ? ` — <span dir="auto">${esc(r.known.description)}</span>` : ''}</p>` : ''}
    ${n.note ? `<p class="sub" dir="auto">✎ ${esc(n.note)}</p>` : ''}
  </div>`;
}

export async function renderNaming() {
  const d = await api('/api/naming');
  const canM = hasPermC('naming.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Whether a name is still free where a company needs it: eight domain zones (each registry\'s own answer), the GitHub handle, the npm package — and whether it is already a famous thing. Free means not registered when asked; it is not a trademark search, and a name you fall in love with still goes to a lawyer before it goes on a sign.'))}</p></div>
  ${d.live ? '' : offCallout()}
  ${canM ? `<form class="panel nm-ask" id="nm-ask"><label class="sr-only" for="nm-n">${esc(t('A name'))}</label><input id="nm-n" required maxlength="63" dir="auto" placeholder="${esc(t('A name to check'))}" autocomplete="off"><button class="btn btn-primary" type="submit" ${d.live ? '' : 'disabled'}>${esc(t('Check everywhere'))}</button>
    <div class="nm-vars" id="nm-vars"></div></form>` : ''}
  <div id="nm-result"></div>
  ${d.names.length ? `<div class="panel-title" style="margin-top:6px">${esc(t('Names checked'))}<span class="sub">— ${d.names.length}</span></div><div class="nm-grid">${d.names.map((n) => nameCard(n, d.tlds, canM)).join('')}</div>`
    : `<div class="empty">${esc(t('No name checked yet.'))}</div>`}`;

  const check = async (name) => {
    const out = $('#nm-result');
    out.innerHTML = `<div class="panel nm-scan"><span class="nm-scanline" aria-hidden="true"></span>${esc(t('Asking the registries'))} — <b dir="auto">${esc(name)}</b>…</div>`;
    try { await api('/api/naming', { method: 'POST', body: { name } }); renderNaming(); } catch (e) { out.innerHTML = ''; toast(e.message, true); }
  };
  $('#nm-ask')?.addEventListener('submit', (e) => { e.preventDefault(); check($('#nm-n').value); });
  let vt = 0;
  $('#nm-n')?.addEventListener('input', () => {
    clearTimeout(vt);
    vt = setTimeout(async () => {
      const v = $('#nm-n').value.trim();
      if (v.length < 2) { $('#nm-vars').innerHTML = ''; return; }
      const r = await api(`/api/naming/variations?name=${encodeURIComponent(v)}`).catch(() => ({ variations: [] }));
      $('#nm-vars').innerHTML = r.variations.length ? `<span class="sub">${esc(t('Or try'))}:</span> ${r.variations.map((x) => `<button type="button" class="chip linkish ltr" data-try="${esc(x)}">${esc(x)}</button>`).join('')}` : '';
      view.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => check(b.dataset.try)));
    }, 250);
  });
  view.querySelectorAll('[data-recheck]').forEach((b) => b.addEventListener('click', () => check(b.dataset.recheck)));
  view.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/naming/${b.dataset.star}`, { method: 'POST', body: { starred: b.getAttribute('aria-pressed') !== 'true' } }); renderNaming(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-verdict]').forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/naming/${s.dataset.verdict}`, { method: 'POST', body: { verdict: s.value } }); renderNaming(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    if (!window.confirm(t('Remove this name?'))) return;
    try { await api(`/api/naming/${b.dataset.rm}/remove`, { method: 'POST', body: {} }); renderNaming(); } catch (e) { toast(e.message, true); }
  }));
}
