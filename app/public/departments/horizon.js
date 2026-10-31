// The horizon: what the company reads from the world, and who owns it.
//
// Live data is the public services — rates, holidays, weather, the World
// Bank, legal entities, VAT numbers, mail domains, advisories, earthquakes —
// shown with the age of every answer, because a rate without a time is a
// guess. The cap table is the ledger of who owns the company, with the two
// questions founders actually ask of it: what does this round do to me, and
// what do I get if we sell.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t, lang } from '/i18n.js';
import { kpi, ago, spark, tabs } from '../components/ui.js';
import { countryName, localTime } from '../components/geo.js';

const loc = () => (lang === 'ar' ? 'ar' : 'en-US');
const num = (n, d = 0) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const pct = (n, d = 2) => (n == null ? '—' : `${num(n, d)}%`);
const compact = (n) => (n == null ? '—' : Number(n).toLocaleString(loc(), { notation: 'compact', maximumFractionDigits: 1 }));
const signed = (n, d = 2) => (n == null ? '' : `${n > 0 ? '+' : ''}${num(n, d)}%`);

/** The WMO weather codes Open-Meteo answers with, as a glyph and a word. */
export function wx(code) {
  const c = Number(code);
  if (c === 0) return { g: '☀', w: 'Clear' };
  if (c <= 2) return { g: '◐', w: 'Partly cloudy' };
  if (c === 3) return { g: '☁', w: 'Overcast' };
  if (c === 45 || c === 48) return { g: '≋', w: 'Fog' };
  if (c >= 51 && c <= 67) return { g: '☂', w: 'Rain' };
  if (c >= 71 && c <= 77) return { g: '❄', w: 'Snow' };
  if (c >= 80 && c <= 82) return { g: '☂', w: 'Showers' };
  if (c >= 85 && c <= 86) return { g: '❄', w: 'Snow showers' };
  if (c >= 95) return { g: 'ϟ', w: 'Thunderstorm' };
  return { g: '·', w: 'Unknown' };
}

const daysUntil = (d) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86400_000);
const when = (d) => { const n = daysUntil(d); return n === 0 ? t('today') : n === 1 ? t('tomorrow') : `${t('in')} ${num(n)} ${t('days')}`; };
const weekday = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(loc(), { weekday: 'short' });
const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(loc(), { day: 'numeric', month: 'long' });
const age = (ts) => (ts ? ago(ts) : t('not read yet'));

const IND = {
  gdpGrowth: { label: 'GDP growth', fmt: (v) => signed(v, 1) },
  inflation: { label: 'Inflation', fmt: (v) => pct(v, 1) },
  gdpPerCapita: { label: 'GDP per person', fmt: (v) => `$${compact(v)}` },
  unemployment: { label: 'Unemployment', fmt: (v) => pct(v, 1) },
  population: { label: 'Population', fmt: (v) => compact(v) },
  internet: { label: 'Online', fmt: (v) => pct(v, 0) },
};

// ============================================================ live data ==

export async function renderLiveData() {
  const d = await api('/api/livedata');
  const canM = hasPermC('livedata.manage');
  const canL = hasPermC('livedata.lookup');
  const ok = d.sources.filter((s) => s.fetchedAt && !s.error).length;
  const reads = d.sources.reduce((a, s) => a + s.today, 0);
  const home = d.fx.rates.find((r) => r.code === d.fx.home);

  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The world outside, read on a clock: exchange rates, the days each country is shut, the weather where the company works, how those economies are moving, earthquakes near its places — and lookups a person asks for. Free public services, no keys, every read through the gate. Each answer is kept with its time, so a page shows the last good answer and says how old it is.'))}</p></div>

  <div class="ld-switch panel ${d.live ? 'on' : ''}">
    <div class="ld-state"><span class="ld-led" aria-hidden="true"></span><div><b>${esc(t(d.live ? 'Live' : 'Off'))}</b><span class="sub">${d.live ? `${esc(t('Last pass'))} ${esc(d.lastRefresh ? ago(d.lastRefresh) : t('pending'))} · ${esc(t('every five minutes, each service when its answer ages out'))}` : esc(t('Nothing is read until a person switches it on. Reading changes nothing out there; it is still the platform reaching the world on a clock.'))}</span></div></div>
    <div class="inline">
      ${canM ? (d.live
        ? `<button type="button" class="btn btn-sm" id="ld-refresh">↻ ${esc(t('Read everything now'))}</button><button type="button" class="btn btn-sm btn-ghost" id="ld-off">${esc(t('Switch off'))}</button>`
        : `<button type="button" class="btn btn-primary" id="ld-on">${esc(t('Switch live data on'))}</button>`) : ''}
      <a class="btn btn-sm btn-ghost" href="#/egress">${esc(t('The gate'))} →</a>
    </div>
  </div>

  <div class="kpis">
    ${kpi('Services answering', `${ok}/${d.sources.length}`, d.sources.some((s) => s.error) ? `${d.sources.filter((s) => s.error).length} ${esc(t('failing'))}` : esc(t('all well')), ok ? 'ok' : '')}
    ${kpi('Reads today', reads, esc(t('each one a row in the gate')), 'ai', '#/egress')}
    ${kpi(`USD → ${d.fx.home}`, home ? num(home.perUsd, home.perUsd > 100 ? 0 : 4) : '—', d.fx.date ? `${esc(t('rates of'))} ${esc(d.fx.date)}` : esc(t('not read yet')), 'human')}
    ${kpi('Earthquakes near your places', d.quakes.near.length, `${d.quakes.list.length} ${esc(t('of magnitude 4.5+ this week'))}`, d.quakes.near.length ? 'bad' : 'ok')}
  </div>

  ${d.places.length ? `<div class="ld-places">${d.places.map(placeCard).join('')}</div>`
    : `<div class="callout">${esc(t('Set the country the company is run from in Settings, and the places it works appear here with their weather, holidays and economy.'))} <a href="#/settings">${esc(t('Settings'))} →</a></div>`}

  ${dayPanel(d.day)}

  <div class="grid grid-2 ld-grid">
    <div class="panel">
      <div class="panel-title">${esc(t('Exchange rates'))}<span class="sub">— ${esc(t('one US dollar buys'))}${d.fx.source ? ` · ${esc(d.fx.source)}` : ''}</span></div>
      ${d.fx.fallback ? `<div class="callout warn" style="margin-bottom:10px">${esc(t('The main rates service failed; these are the central bank\'s. Carried over from the last good answer:'))} <b class="ltr">${esc(d.fx.fallback.carried.join(', '))}</b></div>` : ''}
      ${d.fx.rates.length ? `<table class="tbl"><thead><tr><th>${esc(t('Currency'))}</th><th class="num">${esc(t('Per dollar'))}</th><th class="num">${esc(t('90 days'))}</th><th>${esc(t('Trend'))}</th></tr></thead><tbody>
        ${d.fx.rates.map((r) => `<tr class="${r.code === d.fx.home ? 'sel' : ''}"><td><b class="ltr">${esc(r.code)}</b> <span class="sub">${esc(curName(r.code))}</span></td><td class="num ltr">${num(r.perUsd, r.perUsd > 100 ? 0 : 4)}</td><td class="num ltr ${r.change90 > 0 ? 't-bad' : r.change90 < 0 ? 't-ok' : ''}">${r.change90 == null ? '<span class="sub">—</span>' : signed(r.change90)}</td><td>${r.spark.length > 2 ? spark(r.spark.map((v) => v - Math.min(...r.spark))) : '<span class="sub">—</span>'}</td></tr>`).join('')}</tbody></table>
        <form class="ld-convert" id="ld-convert">
          <label class="sr-only" for="ld-amt">${esc(t('Amount'))}</label><input id="ld-amt" type="number" step="any" value="1000" min="0">
          <label class="sr-only" for="ld-from">${esc(t('From'))}</label><select id="ld-from">${d.fx.all.map((c) => `<option ${c === 'USD' ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <span aria-hidden="true">→</span>
          <label class="sr-only" for="ld-to">${esc(t('To'))}</label><select id="ld-to">${d.fx.all.map((c) => `<option ${c === d.fx.home ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <output id="ld-out" class="ld-out ltr" aria-live="polite"></output>
        </form>
        <p class="sub" style="margin-top:6px">${esc(t('A rising number means the currency is weaker against the dollar.'))} · ${esc(age(d.fx.fetchedAt))}</p>`
        : `<div class="empty">${esc(t(d.live ? 'The rates have not been read yet.' : 'Switch live data on to read the rates.'))}</div>`}
    </div>

    <div class="panel">
      <div class="panel-title">${esc(t('Days off ahead'))}<span class="sub">— ${esc(t('the next ninety days, every place'))}</span></div>
      ${d.holidays.list.length ? `<ol class="ld-days">${d.holidays.list.slice(0, 12).map((h) => `<li><span class="ld-day"><b>${esc(new Date(`${h.date}T12:00:00Z`).toLocaleDateString(loc(), { day: 'numeric' }))}</b><small>${esc(new Date(`${h.date}T12:00:00Z`).toLocaleDateString(loc(), { month: 'short' }))}</small></span>
        <span class="ld-day-main"><b dir="auto">${esc(lang === 'ar' && h.localName ? h.localName : h.name)}</b><span class="sub">${esc(countryName(h.country, lang))} · ${esc(weekday(h.date))}${h.global ? '' : ` · ${esc(t('some regions'))}`}</span></span>
        <span class="chip ${daysUntil(h.date) <= 7 ? 'chip-warn' : ''}">${esc(when(h.date))}</span></li>`).join('')}</ol>`
        : `<div class="empty">${esc(t(d.live ? 'No public holiday in the next ninety days in the places the company works.' : 'Switch live data on to read the calendars.'))}</div>`}
      ${d.holidays.unsupported.length ? `<p class="sub" style="margin-top:8px">${esc(t('No public calendar is published for'))}: ${d.holidays.unsupported.map((c) => esc(countryName(c, lang))).join('، ')}</p>` : ''}
      <p class="sub">${esc(t('Shifts, payment runs and deadlines that fall on these days move.'))}</p>
    </div>

    <div class="panel ld-wide">
      <div class="panel-title">${esc(t('The economies you work in'))}<span class="sub">— ${esc(t('World Bank, latest year'))}</span></div>
      ${Object.keys(d.indicators.byCountry).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Country'))}</th>${d.indicators.keys.map((k) => `<th class="num">${esc(t(IND[k].label))}</th>`).join('')}</tr></thead><tbody>
        ${Object.entries(d.indicators.byCountry).map(([cc, row]) => `<tr><td><b>${esc(countryName(cc, lang))}</b></td>${d.indicators.keys.map((k) => `<td class="num ltr">${row[k] ? `${IND[k].fmt(row[k].value)}<span class="sub"> ’${esc(String(row[k].year).slice(2))}</span>` : '<span class="sub">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">${esc(t('Not read yet.'))}</div>`}
      <p class="sub" style="margin-top:6px">${esc(t('For pricing, salaries and where to sell next. The year beside each figure is the year it describes.'))}</p>
    </div>

    <div class="panel">
      <div class="panel-title">${esc(t('Earthquakes this week'))}<span class="sub">— USGS · ${esc(t('magnitude 4.5 and above'))}</span><a class="btn btn-sm btn-ghost" href="#/globe">${esc(t('On the globe'))} →</a></div>
      ${d.quakes.list.length ? `<div class="rows">${[...d.quakes.near, ...d.quakes.list.filter((x) => !x.near)].slice(0, 9).map((x) => `
        <div class="row ld-quake ${x.near ? 'near' : ''}"><span class="ld-mag" style="--m:${Math.min(1, (x.mag - 4.5) / 3)}">${num(x.mag, 1)}</span>
          <div class="row-main"><div class="row-title" dir="auto">${esc(x.place || '—')}</div><div class="row-meta">${esc(ago(x.time))} · ${esc(t('depth'))} ${num(x.depth)} km${x.tsunami ? ` · <b class="t-bad">${esc(t('tsunami warning'))}</b>` : ''}${x.near ? ` · <b class="t-bad">${num(x.near.km)} km ${esc(t('from'))} ${esc(countryName(x.near.code, lang))}</b>` : ''}</div></div></div>`).join('')}</div>`
        : `<div class="empty">${esc(t(d.live ? 'Not read yet.' : 'Switch live data on to watch for earthquakes.'))}</div>`}
      <p class="sub" style="margin-top:6px">${esc(t('A quake within 600 km of a capital where the company works is flagged — that is where continuity plans get opened.'))}</p>
    </div>
    ${eventsPanel(d.events)}
  </div>

  ${canL ? `<div class="panel" id="ld-tools">
    <div class="panel-title">${esc(t('Look something up'))}<span class="sub">— ${esc(t('each lookup is one read through the gate, recorded with who asked'))}</span></div>
    ${tabs([['company', 'Who is this company'], ['vat', 'EU VAT number'], ['email', 'Mail address'], ['deps', 'Advisories in our code']], 'company')}
    <div class="ld-tool" data-pane="company"><form class="inline" id="ld-co"><label class="sr-only" for="ld-co-q">${esc(t('Company name or LEI'))}</label><input id="ld-co-q" required minlength="3" maxlength="120" dir="auto" placeholder="${esc(t('Company name or LEI'))}" style="flex:1"><button class="btn btn-primary btn-sm" type="submit" ${d.live ? '' : 'disabled'}>${esc(t('Look up'))}</button></form><div id="ld-co-out"></div></div>
    <div class="ld-tool" data-pane="vat" hidden><form class="inline" id="ld-vat"><label class="sr-only" for="ld-vat-n">${esc(t('VAT number'))}</label><input id="ld-vat-n" required maxlength="20" class="ltr" placeholder="IE6388047V" style="flex:1"><button class="btn btn-primary btn-sm" type="submit" ${d.live ? '' : 'disabled'}>${esc(t('Check'))}</button></form><div id="ld-vat-out"></div></div>
    <div class="ld-tool" data-pane="email" hidden><form class="inline" id="ld-mail"><label class="sr-only" for="ld-mail-a">${esc(t('Email address'))}</label><input id="ld-mail-a" type="email" required class="ltr" placeholder="name@example.com" style="flex:1"><button class="btn btn-primary btn-sm" type="submit" ${d.live ? '' : 'disabled'}>${esc(t('Check'))}</button></form><div id="ld-mail-out"></div></div>
    <div class="ld-tool" data-pane="deps" hidden><form class="inline" id="ld-dep"><label class="sr-only" for="ld-dep-t">${esc(t('What to check'))}</label><select id="ld-dep-t" style="flex:1"><option value="alphacore">AlphaCore — ${esc(t('this platform'))}</option>${d.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn btn-primary btn-sm" type="submit" ${d.live ? '' : 'disabled'}>${esc(t('Check with OSV'))}</button></form><div id="ld-dep-out">${d.scans.map(scanView).join('')}</div></div>
  </div>` : ''}

  <div class="grid grid-2 ld-grid">
    <div class="panel">
      <div class="panel-title">${esc(t('The runtime'))}<span class="sub">— endoflife.date</span></div>
      ${d.runtime.line ? `<p>Node.js <b class="ltr">${esc(d.runtime.node)}</b> — ${d.runtime.line.maintained && !d.runtime.line.eol
        ? `<span class="chip chip-ok">${esc(t('receives security fixes'))}</span>${d.runtime.line.eolFrom ? ` <span class="sub">${esc(t('until'))} ${esc(d.runtime.line.eolFrom)}</span>` : ''}`
        : `<span class="chip chip-bad">${esc(t('no longer supported'))}</span>`}</p>
        ${d.runtime.recommended ? `<p class="sub">${esc(t('The supported long-term line is'))} <b class="ltr">${esc(d.runtime.recommended.label)}</b> (<span class="ltr">${esc(d.runtime.recommended.latest || '')}</span>).</p>` : ''}`
        : `<div class="empty">${esc(t('Not read yet.'))}</div>`}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Where this comes from'))}</div>
      <div class="ld-sources">${d.sources.map((s) => `<div class="ld-src ${s.error ? 'bad' : s.fetchedAt ? 'ok' : ''}" title="${esc(s.error || '')}"><i aria-hidden="true"></i><div><b>${esc(t(s.label))}</b><span class="sub">${esc(s.service)} · ${esc(age(s.fetchedAt))}${s.today ? ` · ${s.today} ${esc(t('today'))}` : ''}</span></div></div>`).join('')}</div>
      <p class="sub" style="margin-top:8px">${esc(t('Picked from the public-apis catalogue: free, no key, HTTPS, and a decision here that each answer changes.'))}</p>
    </div>
  </div>`;

  // --- switches
  $('#ld-on')?.addEventListener('click', async () => {
    try { await api('/api/livedata/live', { method: 'POST', body: { on: true } }); toast(t('Live data is on — the first pass takes a few seconds')); await api('/api/livedata/refresh', { method: 'POST', body: {} }).catch(() => null); renderLiveData(); } catch (e) { toast(e.message, true); }
  });
  $('#ld-off')?.addEventListener('click', async () => { try { await api('/api/livedata/live', { method: 'POST', body: { on: false } }); renderLiveData(); } catch (e) { toast(e.message, true); } });
  $('#ld-refresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api('/api/livedata/refresh', { method: 'POST', body: {} }); toast(t('Read')); renderLiveData(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });

  // --- converter
  const conv = async () => {
    const out = $('#ld-out');
    if (!out) return;
    try {
      const r = await api(`/api/livedata/convert?${new URLSearchParams({ amount: $('#ld-amt').value || '0', from: $('#ld-from').value, to: $('#ld-to').value })}`);
      out.textContent = `= ${num(r.result, r.result > 100 ? 0 : 4)} ${r.to}`;
    } catch (err) { out.textContent = err.message; }
  };
  ['#ld-amt', '#ld-from', '#ld-to'].forEach((s) => $(s)?.addEventListener('input', conv));
  $('#ld-convert')?.addEventListener('submit', (e) => { e.preventDefault(); conv(); });
  conv();

  // --- tools
  view.querySelectorAll('#ld-tools [data-tab]').forEach((b) => b.addEventListener('click', () => {
    view.querySelectorAll('#ld-tools [data-tab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    view.querySelectorAll('#ld-tools [data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
  const tool = (form, run) => $(form)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await run(); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  });
  tool('#ld-co', async () => {
    const r = await api('/api/livedata/company', { method: 'POST', body: { query: $('#ld-co-q').value, lang } });
    $('#ld-co-out').innerHTML = `<div class="ld-result">${r.lei.length ? r.lei.map((x) => `<div class="ld-entity"><div><b dir="auto">${esc(x.name || '—')}</b> <span class="chip ${x.status === 'ACTIVE' ? 'chip-ok' : 'chip-bad'}">${esc(t(x.status === 'ACTIVE' ? 'active' : String(x.status || 'unknown').toLowerCase()))}</span>
        ${x.registration && x.registration !== 'ISSUED' ? `<span class="chip chip-warn">${esc(t('record'))}: ${esc(x.registration.toLowerCase())}</span>` : ''}</div>
        <div class="sub"><span class="mono">${esc(x.lei)}</span> · ${esc(countryName(x.country || x.jurisdiction || '', lang) || x.jurisdiction || '')}${x.address ? ` · <span dir="auto">${esc(x.address)}</span>` : ''}</div>
        <div class="sub">${x.renewsAt ? `${esc(t('renews'))} ${esc(String(x.renewsAt).slice(0, 10))}` : ''}${x.corroboration ? ` · ${esc(x.corroboration.toLowerCase().replace(/_/g, ' '))}` : ''}</div></div>`).join('')
      : `<div class="empty">${esc(t('No registered legal entity by that name. Not having an LEI is common for small companies; it is not a finding on its own.'))}</div>`}
      ${r.wiki?.found ? `<blockquote class="ld-wiki" dir="auto"><b>${esc(r.wiki.title)}</b>${r.wiki.description ? ` — ${esc(r.wiki.description)}` : ''}<p>${esc(r.wiki.extract || '')}</p><span class="sub">Wikipedia · <span class="ltr">${esc(r.wiki.url || '')}</span></span></blockquote>` : ''}
      <p class="sub"><a href="#/aml">${esc(t('Screen them in AML'))} →</a></p></div>`;
  });
  tool('#ld-vat', async () => {
    const r = await api('/api/livedata/vat', { method: 'POST', body: { number: $('#ld-vat-n').value } });
    $('#ld-vat-out').innerHTML = `<div class="ld-result"><span class="chip ${r.valid ? 'chip-ok' : 'chip-bad'}">${esc(t(r.valid ? 'Valid' : 'Not valid'))}</span> <b class="ltr">${esc(r.number)}</b>${r.name ? `<div dir="auto">${esc(r.name)}</div>` : ''}${r.address ? `<div class="sub" dir="auto">${esc(r.address)}</div>` : ''}<p class="sub">${esc(r.source)}</p></div>`;
  });
  tool('#ld-mail', async () => {
    const r = await api('/api/livedata/email', { method: 'POST', body: { address: $('#ld-mail-a').value } });
    $('#ld-mail-out').innerHTML = `<div class="ld-result"><b class="ltr">${esc(r.address)}</b><div class="inline" style="margin-top:6px">
      <span class="chip ${r.disposable ? 'chip-bad' : r.disposable === false ? 'chip-ok' : ''}">${esc(t(r.disposable ? 'Throwaway domain' : r.disposable === false ? 'Real domain' : 'Domain not checked'))}</span>
      ${r.role ? `<span class="chip chip-warn">${esc(t('A shared role address, not a person'))}</span>` : ''}</div></div>`;
  });
  tool('#ld-dep', async () => {
    const r = await api('/api/livedata/scan', { method: 'POST', body: { target: $('#ld-dep-t').value } });
    $('#ld-dep-out').innerHTML = scanView({ target: r.target, label: r.label, fetchedAt: r.fetchedAt, checked: r.checked, counts: r.counts, packages: r.packages });
  });
}

function placeCard(p) {
  const w = p.weather;
  const now = w ? wx(w.code) : null;
  return `<a class="ld-place panel ${p.home ? 'home' : ''}" href="#/globe?c=${esc(p.code)}">
    <div class="ld-place-head"><b>${esc(countryName(p.code, lang))}</b>${p.home ? `<span class="chip chip-warn">${esc(t('Home'))}</span>` : ''}</div>
    <div class="sub">${esc(p.capital || '')}${localTime(p.code, lang) ? ` · ${esc(localTime(p.code, lang))}` : ''}</div>
    ${w ? `<div class="ld-now"><span class="ld-glyph" aria-hidden="true">${now.g}</span><b class="ltr">${Math.round(w.temp)}°</b><span class="sub">${esc(t(now.w))}${w.wind != null ? ` · ${num(w.wind)} km/h` : ''}</span></div>
      <div class="ld-week">${w.daily.slice(1, 4).map((x) => `<span><small>${esc(weekday(x.day))}</small><i aria-hidden="true">${wx(x.code).g}</i><b class="ltr">${Math.round(x.max)}°</b><small class="ltr">${Math.round(x.min)}°</small></span>`).join('')}</div>`
      : `<div class="sub" style="margin-top:12px">${esc(t('weather not read yet'))}</div>`}
    ${p.air?.aqi != null ? `<div class="ld-aqi ${aqiBand(p.air.aqi)}" title="PM2.5 ${num(p.air.pm25, 1)} µg/m³"><b class="ltr">AQI ${num(p.air.aqi)}</b><span>${esc(t(AQI_WORD[aqiBand(p.air.aqi)]))}</span></div>` : ''}
    ${p.currency ? `<div class="ld-cur ltr">${esc(p.currency)}</div>` : ''}
  </a>`;
}

/** The US AQI bands, as the EPA draws them. */
export const aqiBand = (a) => (a <= 50 ? 'aq-good' : a <= 100 ? 'aq-mod' : a <= 150 ? 'aq-sens' : a <= 200 ? 'aq-bad' : 'aq-vbad');
export const AQI_WORD = { 'aq-good': 'Good air', 'aq-mod': 'Moderate air', 'aq-sens': 'Unhealthy for sensitive people', 'aq-bad': 'Unhealthy air', 'aq-vbad': 'Very unhealthy air' };
const PRAYER = { Fajr: 'Fajr', Sunrise: 'Sunrise', Dhuhr: 'Dhuhr', Asr: 'Asr', Maghrib: 'Maghrib', Isha: 'Isha' };
const EVENT = { wildfires: ['🔥', 'Wildfires'], severeStorms: ['🌀', 'Severe storms'], volcanoes: ['🌋', 'Volcanoes'], floods: ['≋', 'Floods'], seaLakeIce: ['❄', 'Sea and lake ice'], dustHaze: ['≈', 'Dust and haze'], drought: ['☀', 'Drought'], landslides: ['⛰', 'Landslides'], snow: ['❄', 'Snow'], tempExtremes: ['🌡', 'Extreme temperatures'], earthquakes: ['◎', 'Earthquakes'], manmade: ['⚑', 'Man-made'], waterColor: ['≋', 'Water colour'] };
export const eventGlyph = (c) => (EVENT[c] || ['•', c])[0];

/** The day at home: the Hijri date, the six times, the next one lit, and Ramadan. */
function dayPanel(day) {
  if (!day) return '';
  const hijri = lang === 'ar' ? `${num(day.hijri.day)} ${day.hijri.monthAr || ''} ${num(day.hijri.year)} هـ` : `${day.hijri.day} ${day.hijri.monthEn || ''} ${day.hijri.year} AH`;
  return `<div class="panel ld-daypanel">
    <div class="ld-hijri"><small>${esc(t('The day at home'))} · ${esc(countryName(day.country, lang))}</small><b dir="auto">${esc(hijri)}</b>
      ${day.inRamadan ? `<span class="chip chip-warn">${esc(t('Ramadan'))}</span>` : day.ramadanIn != null && day.ramadanIn >= 0 ? `<span class="sub">${esc(t('Ramadan begins in'))} <b class="ltr">${num(day.ramadanIn)}</b> ${esc(t('days'))} · ${esc(day.ramadan.date)}</span>` : ''}</div>
    <ol class="ld-prayers">${Object.keys(PRAYER).map((k) => `<li class="${day.next?.name === k ? 'next' : day.timings[k] && day.timings[k] < day.now ? 'past' : ''}"><small>${esc(t(PRAYER[k]))}</small><b class="ltr">${esc(day.timings[k] || '—')}</b></li>`).join('')}</ol>
    <p class="sub">${esc(t('Prayer times at'))} ${esc(day.city)} · Aladhan · ${esc(t('for working hours, shifts and meetings — and Ramadan hours are planned weeks ahead.'))}</p>
  </div>`;
}

/** Natural events still open: the ones near a place first, then the rest by kind. */
function eventsPanel(ev) {
  if (!ev) return '';
  return `<div class="panel">
    <div class="panel-title">${esc(t('Natural events still open'))}<span class="sub">— NASA EONET${ev.fetchedAt ? ` · ${esc(ago(ev.fetchedAt))}` : ''}</span><a class="btn btn-sm btn-ghost" href="#/globe">${esc(t('On the globe'))} →</a></div>
    ${Object.keys(ev.counts).length ? `<div class="ld-evcounts">${Object.entries(ev.counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span class="chip"><span aria-hidden="true">${eventGlyph(c)}</span> ${esc(t((EVENT[c] || [0, c])[1]))} · ${n}</span>`).join('')}</div>` : ''}
    ${ev.list.length ? `<div class="rows">${ev.list.slice(0, 8).map((x) => `<div class="row ld-quake ${x.near ? 'near' : ''}"><span class="ld-ev" aria-hidden="true">${eventGlyph(x.category)}</span>
      <div class="row-main"><div class="row-title" dir="auto">${esc(x.title)}</div><div class="row-meta">${esc(t((EVENT[x.category] || [0, x.categoryTitle || x.category])[1]))}${x.date ? ` · ${esc(ago(x.date))}` : ''}${x.magnitude ? ` · ${num(x.magnitude)} ${esc(x.unit || '')}` : ''}${x.near ? ` · <b class="t-bad">${num(x.near.km)} km ${esc(t('from'))} ${esc(countryName(x.near.code, lang))}</b>` : ''}</div></div></div>`).join('')}</div>`
      : `<div class="empty">${esc(t('Not read yet.'))}</div>`}
    <p class="sub" style="margin-top:6px">${esc(t('An event within 500 km of a capital where the company works is flagged.'))}</p>
  </div>`;
}

const SEV_CHIP = { critical: 'chip-bad', high: 'chip-bad', moderate: 'chip-warn', low: '', unknown: 'chip-dim' };
function scanView(s) {
  const total = s.counts ? Object.values(s.counts).reduce((a, n) => a + n, 0) : 0;
  return `<div class="ld-result">
    <div class="inline" style="justify-content:space-between"><b>${esc(s.label || (s.target === 'alphacore' ? 'AlphaCore' : `${t('App')} ${s.target}`))}</b><span class="sub">${num(s.checked)} ${esc(t('packages checked'))} · ${esc(age(s.fetchedAt))}</span></div>
    ${total ? `<div class="inline" style="margin:6px 0">${Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `<span class="chip ${SEV_CHIP[k]}">${n} ${esc(t(k))}</span>`).join('')}</div>
      <table class="tbl"><tbody>${(s.packages || []).map((p) => `<tr><td><b class="ltr">${esc(p.name)}</b> <span class="mono">${esc(p.version)}</span>${p.dev ? ` <span class="chip chip-dim">${esc(t('dev only'))}</span>` : ''}</td>
        <td>${p.vulns.slice(0, 3).map((v) => `<div><span class="chip ${SEV_CHIP[v.severity.toLowerCase()]}">${esc(t(v.severity.toLowerCase()))}</span> <span class="mono">${esc(v.aliases[0] || v.id)}</span> <span class="sub" dir="auto">${esc(v.summary || '')}</span>${v.fixed ? ` <span class="sub">· ${esc(t('fixed in'))} <span class="ltr">${esc(v.fixed)}</span></span>` : ''}</div>`).join('')}</td></tr>`).join('')}</tbody></table>`
      : `<p class="t-ok" style="margin:6px 0">✓ ${esc(t('No published advisory for any version this tree runs.'))}</p>`}
  </div>`;
}

let CUR_NAMES = null;
function curName(code) {
  try { CUR_NAMES ||= new Intl.DisplayNames([loc()], { type: 'currency' }); return CUR_NAMES.of(code) || ''; } catch { return ''; }
}

// ============================================================ cap table ==

const KIND_COLOR = { founder: 'var(--sx-human-bright)', employee: 'var(--sx-ai)', investor: 'var(--sx-info)', advisor: 'var(--sx-ok)', other: 'var(--sx-faint)', pool: 'var(--sx-line)', new: 'var(--sx-ok)' };
const PALETTE = ['#e48a12', '#0a8ec4', '#4fe3ff', '#7c6cf0', '#2fb58a', '#ff6b80', '#c8a400', '#5aa0ff', '#ff9d5c', '#8ad66a'];

/** The ownership ring: each holder an arc, fully diluted, the pool last. */
function donut(rows, pool, fd) {
  const C = 2 * Math.PI * 64;
  let at = 0;
  const parts = [...rows.filter((r) => r.shares + r.options > 0).map((r, i) => ({ v: r.shares + r.options, c: PALETTE[i % PALETTE.length], name: r.name })), ...(pool ? [{ v: pool, c: 'var(--sx-line)', name: t('Option pool (unallocated)') }] : [])];
  const arcs = parts.map((p, i) => {
    const len = (p.v / fd) * C;
    const seg = `<circle class="eq-arc" cx="80" cy="80" r="64" stroke="${p.c}" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}" style="--i:${i}"><title>${esc(p.name)} — ${pct((p.v / fd) * 100)}</title></circle>`;
    at += len;
    return seg;
  }).join('');
  return { svg: `<svg class="eq-donut" viewBox="0 0 160 160" role="img" aria-label="${esc(t('Ownership, fully diluted'))}"><circle cx="80" cy="80" r="64" class="eq-track"/>${arcs}</svg>`, parts };
}

export async function renderEquity() {
  const d = await api('/api/equity');
  const canM = hasPermC('equity.manage');
  const canI = hasPermC('equity.issue');
  const T = d.totals;
  const fd = T.fullyDiluted;
  const valuation = d.lastPrice && fd ? d.lastPrice * fd : null;
  const ring = fd ? donut(d.holders, T.poolFree, fd) : null;
  const holderOpts = d.holders.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const classOpts = d.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Who owns the company. Shares move only as rows in a ledger — a mistake is corrected by a cancellation that says why — options vest by the calendar from the day they were granted, and SAFEs wait beside the table until a round converts them. Issuing, granting and cancelling are a person\'s acts and are on the chain. The round and exit models are arithmetic on the table and change nothing.'))}</p></div>

  <div class="kpis">
    ${kpi('Fully diluted', num(fd), `${num(T.issued)} ${esc(t('issued'))} · ${num(T.options)} ${esc(t('in options'))}`, 'ai')}
    ${kpi('Holders', d.holders.length, `${d.holders.filter((h) => h.kind === 'founder').length} ${esc(t('founders'))}`)}
    ${kpi('Pool left', pct(T.poolPct), `${num(T.poolFree)} ${esc(t('of'))} ${num(T.poolSize)}`, T.poolSize && T.poolPct < 3 ? 'human' : '')}
    ${kpi('Last price a share', d.lastPrice ? num(d.lastPrice, 4) : '—', valuation ? `${esc(t('implies'))} ${compact(valuation)}` : esc(t('no priced issue yet')), 'human')}
  </div>

  ${!fd ? `<div class="panel eq-start"><h3>${esc(t('Start the cap table'))}</h3><ol class="eq-steps">
      <li><b>${esc(t('Add the founders'))}</b><span>${esc(t('and anyone else who holds or is promised shares'))}</span></li>
      <li><b>${esc(t('Issue their shares'))}</b><span>${esc(t('the number on the founding documents, at the price paid'))}</span></li>
      <li><b>${esc(t('Set the option pool'))}</b><span>${esc(t('the shares set aside for the people you will hire'))}</span></li>
      <li><b>${esc(t('Record SAFEs and notes'))}</b><span>${esc(t('then model the next round to see what it does to each of you'))}</span></li></ol></div>` : `
  <div class="eq-top">
    <div class="panel eq-ring"><div class="panel-title">${esc(t('Ownership'))}<span class="sub">— ${esc(t('fully diluted'))}</span></div>
      <div class="eq-ring-body">${ring.svg}<div class="eq-ring-num"><div><b>${num(d.holders.length)}</b><span>${esc(t('holders'))}</span></div></div></div>
      <ul class="eq-legend">${ring.parts.map((p) => `<li><i style="background:${p.c}"></i><span dir="auto">${esc(p.name)}</span><b class="ltr">${pct((p.v / fd) * 100, 1)}</b></li>`).join('')}</ul>
    </div>
    <div class="panel"><div class="panel-title">${esc(t('The table'))}</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Holder'))}</th>${d.classes.filter((c) => c.shares).map((c) => `<th class="num">${esc(c.name)}</th>`).join('')}<th class="num">${esc(t('Options'))}</th><th class="num">${esc(t('Vested'))}</th><th class="num">${esc(t('Issued %'))}</th><th class="num">${esc(t('Fully diluted %'))}</th></tr></thead><tbody>
        ${d.holders.map((h) => `<tr><td><b dir="auto">${esc(h.name)}</b> <span class="chip" style="--chip:${KIND_COLOR[h.kind]}">${esc(t(h.kind))}</span></td>${d.classes.filter((c) => c.shares).map((c) => `<td class="num ltr">${h.byClass[c.id] ? num(h.byClass[c.id]) : '<span class="sub">—</span>'}</td>`).join('')}
          <td class="num ltr">${h.options ? num(h.options) : '<span class="sub">—</span>'}</td><td class="num ltr">${h.options ? num(h.vested) : '<span class="sub">—</span>'}</td><td class="num ltr">${pct(h.basicPct)}</td><td class="num ltr"><b>${pct(h.fdPct)}</b></td></tr>`).join('')}
        <tr class="sub"><td>${esc(t('Option pool (unallocated)'))}</td>${d.classes.filter((c) => c.shares).map(() => '<td></td>').join('')}<td class="num ltr">${num(T.poolFree)}</td><td></td><td></td><td class="num ltr">${pct(T.poolPct)}</td></tr>
      </tbody></table></div>
    </div>
  </div>

  <div class="panel" id="eq-model">
    ${tabs([['round', 'Model a round'], ['exit', 'Model an exit']], 'round')}
    <div data-pane="round">
      <div class="eq-model">
        <div class="eq-levers">
          ${lever('preMoney', 'Pre-money valuation', 100000, 200000000, 100000, Math.max(1000000, Math.round((valuation || 5000000) / 100000) * 100000))}
          ${lever('investment', 'New money in', 25000, 50000000, 25000, 1000000)}
          ${lever('poolPostPct', 'Pool after the round', 0, 30, 0.5, 10, '%')}
          <label class="eq-check"><input type="checkbox" id="eq-conv" checked> ${esc(t('Convert SAFEs and notes in this round'))}</label>
        </div>
        <div><div class="kpis" id="eq-round-kpis"></div><div id="eq-round-bars" class="eq-bars"></div></div>
      </div>
    </div>
    <div data-pane="exit" hidden>
      <div class="eq-model">
        <div class="eq-levers">${lever('value', 'Sale price of the company', 100000, 1000000000, 100000, Math.max(1000000, Math.round(((valuation || 10000000) * 3) / 100000) * 100000))}
          <p class="sub">${esc(t('Preferred is paid first, the most senior class first. A non-participating class takes the better of its preference or converting to common. Unexercised options are left out — an option is money only once exercised.'))}</p></div>
        <div><div class="kpis" id="eq-exit-kpis"></div><div id="eq-exit-bars" class="eq-bars"></div></div>
      </div>
    </div>
    ${canM ? `<form id="eq-keep" class="inline" style="margin-top:12px"><label class="sr-only" for="eq-keep-n">${esc(t('Name'))}</label><input id="eq-keep-n" required maxlength="120" dir="auto" placeholder="${esc(t('Name this scenario'))}" style="flex:1"><button class="btn btn-sm btn-primary" type="submit">${esc(t('Keep'))}</button></form>` : ''}
    ${d.scenarios.length ? `<div class="eq-kept">${d.scenarios.map((s) => `<span class="chip"><button type="button" class="linkish" data-load="${s.id}">${esc(s.name)}</button> <span class="sub">${s.kind === 'exit' ? compact(s.result.value) : `${pct(s.result.investorPct, 1)} @ ${num(s.result.price, 4)}`}</span>${canM ? ` <button type="button" class="linkish" data-rm="${s.id}" aria-label="${esc(t('Remove'))} ${esc(s.name)}">×</button>` : ''}</span>`).join('')}</div>` : ''}
  </div>`}

  ${d.grants.length ? `<div class="panel"><div class="panel-title">${esc(t('Options, vesting by the calendar'))}</div>
    <div class="eq-vest">${d.grants.map((g) => vestRow(g, canI)).join('')}</div></div>` : ''}

  ${d.convertibles.length ? `<div class="panel"><div class="panel-title">${esc(t('SAFEs and notes'))}</div>
    <table class="tbl"><thead><tr><th>${esc(t('Holder'))}</th><th>${esc(t('Kind'))}</th><th class="num">${esc(t('Amount'))}</th><th class="num">${esc(t('Cap'))}</th><th class="num">${esc(t('Discount'))}</th><th class="num">${esc(t('Worth now'))}</th><th>${esc(t('State'))}</th></tr></thead><tbody>
    ${d.convertibles.map((c) => `<tr><td dir="auto"><b>${esc(c.holder)}</b></td><td>${esc(c.kind === 'safe' ? 'SAFE' : t('Note'))}${c.interest_pct ? ` <span class="sub">${num(c.interest_pct, 1)}%/${esc(t('yr'))}</span>` : ''}</td><td class="num ltr">${num(c.principal)}</td><td class="num ltr">${c.cap ? compact(c.cap) : '—'}</td><td class="num ltr">${c.discount_pct ? pct(c.discount_pct, 0) : '—'}</td><td class="num ltr">${num(c.value)}</td><td><span class="chip">${esc(t(c.state))}</span></td></tr>`).join('')}</tbody></table></div>` : ''}

  ${canM || canI ? `<div class="panel"><div class="panel-title">${esc(t('Change the table'))}</div>
    ${tabs([['holder', 'Add a holder'], ...(canI ? [['issue', 'Issue shares'], ['pool', 'Option pool'], ['grant', 'Grant options'], ['safe', 'SAFE or note']] : []), ['class', 'Share class']], 'holder')}
    <form class="eq-form grid grid-3" data-pane="holder" data-post="/api/equity/holders">
      ${field('name', 'Name', 'text', 'required maxlength="160" dir="auto"')}
      <div><label class="fl" for="eq-kind">${esc(t('Kind'))}</label><select id="eq-kind" name="kind">${d.kinds.map((k) => `<option value="${k}">${esc(t(k))}</option>`).join('')}</select></div>
      ${field('email', 'Email', 'email', 'class="ltr"')}
      <div><button class="btn btn-primary" type="submit">${esc(t('Add'))}</button></div>
    </form>
    ${canI ? `<form class="eq-form grid grid-3" data-pane="issue" data-post="/api/equity/issue" hidden>
      <div><label class="fl" for="eq-i-h">${esc(t('Holder'))}</label><select id="eq-i-h" name="holderId" required>${holderOpts}</select></div>
      <div><label class="fl" for="eq-i-c">${esc(t('Class'))}</label><select id="eq-i-c" name="classId"><option value="">${esc(t('Common'))}</option>${classOpts}</select></div>
      ${field('shares', 'Shares', 'number', 'required min="1" step="1"')}${field('price', 'Price a share', 'number', 'min="0" step="any" value="0"')}${field('issuedOn', 'On', 'date', '')}${field('ref', 'Board resolution or reference', 'text', 'maxlength="160" dir="auto"')}
      <div><button class="btn btn-human" type="submit">${esc(t('Issue — this is on the chain'))}</button></div>
    </form>
    <form class="eq-form grid grid-3" data-pane="pool" data-post="/api/equity/pool" hidden>
      ${field('size', 'Shares set aside for options', 'number', `required min="0" step="1" value="${T.poolSize || ''}"`)}
      <div><button class="btn btn-human" type="submit">${esc(t('Set the pool'))}</button></div>
    </form>
    <form class="eq-form grid grid-3" data-pane="grant" data-post="/api/equity/grants" hidden>
      <div><label class="fl" for="eq-g-h">${esc(t('Holder'))}</label><select id="eq-g-h" name="holderId" required>${holderOpts}</select></div>
      ${field('shares', 'Options', 'number', 'required min="1" step="1"')}${field('strike', 'Strike', 'number', 'min="0" step="any" value="0"')}${field('grantedOn', 'Granted on', 'date', '')}${field('vestMonths', 'Vesting, months', 'number', 'min="0" max="120" value="48"')}${field('cliffMonths', 'Cliff, months', 'number', 'min="0" max="120" value="12"')}
      <div><button class="btn btn-human" type="submit">${esc(t('Grant'))}</button></div>
    </form>
    <form class="eq-form grid grid-3" data-pane="safe" data-post="/api/equity/convertibles" hidden>
      <div><label class="fl" for="eq-s-h">${esc(t('Holder'))}</label><select id="eq-s-h" name="holderId" required>${holderOpts}</select></div>
      <div><label class="fl" for="eq-s-k">${esc(t('Kind'))}</label><select id="eq-s-k" name="kind"><option value="safe">SAFE</option><option value="note">${esc(t('Convertible note'))}</option></select></div>
      ${field('principal', 'Amount', 'number', 'required min="1" step="any"')}${field('cap', 'Valuation cap', 'number', 'min="0" step="any"')}${field('discountPct', 'Discount %', 'number', 'min="0" max="99" step="any" value="20"')}${field('interestPct', 'Interest % a year (notes)', 'number', 'min="0" max="50" step="any" value="0"')}
      <div><button class="btn btn-human" type="submit">${esc(t('Record'))}</button></div>
    </form>` : ''}
    <form class="eq-form grid grid-3" data-pane="class" data-post="/api/equity/classes" hidden>
      ${field('name', 'Name', 'text', 'required maxlength="80" dir="auto" placeholder="Seed preferred"')}
      <div><label class="fl" for="eq-c-k">${esc(t('Kind'))}</label><select id="eq-c-k" name="kind"><option value="common">${esc(t('Common'))}</option><option value="preferred">${esc(t('Preferred'))}</option></select></div>
      ${field('liqPref', 'Preference, × paid', 'number', 'min="0" max="10" step="0.25" value="1"')}${field('seniority', 'Seniority (higher paid first)', 'number', 'min="0" max="20" value="1"')}
      <label class="eq-check"><input type="checkbox" name="participating"> ${esc(t('Participating'))}</label>
      <div><button class="btn btn-primary" type="submit">${esc(t('Add'))}</button></div>
    </form>
  </div>` : ''}

  ${d.ledger.length ? `<div class="panel"><div class="panel-title">${esc(t('The ledger'))}<span class="sub">— ${esc(t('every row, never edited'))}</span><a class="btn btn-sm btn-ghost" href="#/audit">${esc(t('The chain'))} →</a></div>
    <div class="rows">${d.ledger.map((l) => `<div class="row"><span class="eq-led ${l.shares < 0 ? 'neg' : ''}" aria-hidden="true">${l.kind === 'cancel' ? '−' : l.kind === 'exercise' ? '⇢' : '+'}</span>
      <div class="row-main"><div class="row-title"><b dir="auto">${esc(l.holder)}</b> · <span class="ltr">${num(l.shares)}</span> ${esc(l.class)}${l.price ? ` <span class="sub">@ ${num(l.price, 4)}</span>` : ''}</div><div class="row-meta">${esc(t(l.kind))} · ${esc(l.on_day)}${l.ref ? ` · ${esc(l.ref)}` : ''}${l.note ? ` · <span dir="auto">${esc(l.note)}</span>` : ''} · ${esc(String(l.actor).replace(/^human:/, ''))}</div></div></div>`).join('')}</div></div>` : ''}`;

  wireEquity(d);
}

const lever = (k, label, min, max, step, value, unit = '') => `<div class="wi-lever"><label for="eq-${k}">${esc(t(label))}<output id="eq-o-${k}"></output></label><input id="eq-${k}" data-k="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-unit="${unit}"></div>`;
// Several forms share a field name (shares, name), so each input gets its own id.
let fieldSeq = 0;
const field = (name, label, type, extra) => { const id = `eq-f-${name}-${++fieldSeq}`; return `<div><label class="fl" for="${id}">${esc(t(label))}</label><input id="${id}" name="${name}" type="${type}" ${extra} style="width:100%"></div>`; };

function vestRow(g, canI) {
  const start = Date.parse(g.granted_on); const end = Date.parse(g.fullyOn); const cliff = Date.parse(g.cliffOn);
  const span = Math.max(1, end - start);
  const now = Math.min(1, Math.max(0, (Date.now() - start) / span));
  return `<div class="eq-vrow ${g.state !== 'active' ? 'ended' : ''}">
    <div class="eq-vname"><b dir="auto">${esc(g.holder)}</b><span class="sub ltr">${num(g.shares)} @ ${num(g.strike, 4)}</span></div>
    <div class="eq-vbar" role="img" aria-label="${esc(`${num(g.vested)} / ${num(g.shares)} ${t('vested')}`)}">
      <i class="eq-vfill" style="--w:${((g.vested / g.shares) * 100).toFixed(1)}%"></i>
      <i class="eq-vex" style="--w:${((g.exercised / g.shares) * 100).toFixed(1)}%"></i>
      <span class="eq-vcliff" style="--x:${(((cliff - start) / span) * 100).toFixed(1)}%" title="${esc(t('cliff'))} ${esc(g.cliffOn)}"></span>
      ${g.state === 'active' ? `<span class="eq-vnow" style="--x:${(now * 100).toFixed(1)}%"></span>` : ''}
    </div>
    <div class="eq-vmeta"><span class="ltr">${num(g.vested)}</span> ${esc(t('vested'))} · <span class="ltr">${num(g.exercised)}</span> ${esc(t('exercised'))}<span class="sub"> · ${esc(t('fully vested'))} ${esc(g.fullyOn)}</span>
      ${g.state !== 'active' ? ` <span class="chip chip-dim">${esc(t('ended'))}</span>` : canI ? ` ${g.exercisable ? `<button type="button" class="btn btn-sm" data-exercise="${g.id}" data-max="${g.exercisable}">${esc(t('Exercise'))}</button>` : ''}<button type="button" class="btn btn-sm btn-ghost" data-endgrant="${g.id}">${esc(t('End'))}</button>` : ''}</div>
  </div>`;
}

function wireEquity(d) {
  const p = {};
  const out = (k, v, unit) => { const o = $(`#eq-o-${k}`); if (o) o.textContent = unit === '%' ? `${num(v, 1)}%` : compact(v); };
  let pending = 0;
  const runRound = () => {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      try {
        const r = await api(`/api/equity/round?${new URLSearchParams({ preMoney: p.preMoney, investment: p.investment, poolPostPct: p.poolPostPct, convertibles: String($('#eq-conv').checked) })}`);
        $('#eq-round-kpis').innerHTML = `${kpi('Price a share', num(r.price, 4))}${kpi('Post-money', compact(r.postMoney))}${kpi('The new money owns', pct(r.investorPct, 1), '', 'ok')}${kpi('Pool top-up', num(r.shares.poolTopUp), `${num(r.shares.conversions)} ${esc(t('from SAFEs and notes'))}`, 'human')}`;
        $('#eq-round-bars').innerHTML = r.rows.map((x) => `<div class="eq-bar"><span dir="auto">${esc(x.kind === 'pool' ? t('Option pool (unallocated)') : x.kind === 'new' ? t('New money') : x.name)}</span>
          <div class="eq-track2"><i class="before" style="--w:${x.before}%"></i><i class="after k-${esc(x.kind)}" style="--w:${x.after}%"></i></div>
          <b class="ltr">${pct(x.before, 1)} → ${pct(x.after, 1)}</b></div>`).join('')
          + (r.conversions.length ? `<p class="sub">${r.conversions.map((c) => `${esc(c.holder || '')}: ${num(c.shares)} ${esc(t('shares at'))} ${num(c.price, 4)} (${esc(t(c.via === 'cap' ? 'the cap' : 'the discount'))})`).join(' · ')}</p>` : '');
      } catch (e) { $('#eq-round-bars').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    }, 110);
  };
  const runExit = () => {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      try {
        const r = await api(`/api/equity/exit?value=${p.value}`);
        const max = Math.max(1, ...r.holders.map((h) => h.payout));
        $('#eq-exit-kpis').innerHTML = `${kpi('Sale price', compact(r.value))}${kpi('Per common share', num(r.perCommonShare, 4), '', 'ok')}${kpi('Classes converting', r.classes.filter((c) => c.converted).length, `${esc(t('of'))} ${r.classes.filter((c) => c.kind === 'preferred').length} ${esc(t('preferred'))}`)}`;
        $('#eq-exit-bars').innerHTML = r.holders.map((h) => `<div class="eq-bar"><span dir="auto">${esc(h.name)}</span><div class="eq-track2"><i class="after k-${esc(h.kind)}" style="--w:${((h.payout / max) * 100).toFixed(1)}%"></i></div><b class="ltr">${compact(h.payout)}${h.multiple != null ? ` <span class="sub">${num(h.multiple, 1)}×</span>` : ''}</b></div>`).join('')
          + `<p class="sub">${r.classes.map((c) => `${esc(c.name)}: ${compact(c.payout)}${c.converted ? ` (${esc(t('converted'))})` : c.prefPaid ? ` (${esc(t('preference'))} ${compact(c.prefPaid)})` : ''}`).join(' · ')}</p>`;
      } catch (e) { $('#eq-exit-bars').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    }, 110);
  };
  let mode = 'round';
  view.querySelectorAll('#eq-model input[type="range"]').forEach((el) => {
    p[el.dataset.k] = Number(el.value); out(el.dataset.k, p[el.dataset.k], el.dataset.unit);
    el.addEventListener('input', () => { p[el.dataset.k] = Number(el.value); out(el.dataset.k, p[el.dataset.k], el.dataset.unit); (el.dataset.k === 'value' ? runExit : runRound)(); });
  });
  $('#eq-conv')?.addEventListener('change', runRound);
  const paneTabs = (root) => root?.querySelectorAll(':scope > .tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll(':scope > .tabs [data-tab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    root.querySelectorAll(':scope > [data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== b.dataset.tab; });
    if (root.id === 'eq-model') { mode = b.dataset.tab; (mode === 'exit' ? runExit : runRound)(); }
  }));
  paneTabs($('#eq-model'));
  view.querySelectorAll('.panel').forEach((x) => { if (x.querySelector(':scope > form.eq-form')) paneTabs(x); });
  if ($('#eq-model')) runRound();

  $('#eq-keep')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const params = mode === 'exit' ? { kind: 'exit', value: p.value } : { preMoney: p.preMoney, investment: p.investment, poolPostPct: p.poolPostPct, convertibles: $('#eq-conv').checked };
    try { await api('/api/equity/scenarios', { method: 'POST', body: { name: $('#eq-keep-n').value, params } }); toast(t('Kept')); renderEquity(); } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
    const s = d.scenarios.find((x) => String(x.id) === b.dataset.load);
    if (!s) return;
    const tab = view.querySelector(`#eq-model [data-tab="${s.kind}"]`); tab?.click();
    for (const [k, v] of Object.entries(s.params)) { const el = $(`#eq-${k}`); if (el && el.type === 'range') { el.value = v; p[k] = Number(v); out(k, v, el.dataset.unit); } }
    if (s.kind !== 'exit' && $('#eq-conv')) $('#eq-conv').checked = s.params.convertibles !== false;
    (s.kind === 'exit' ? runExit : runRound)();
  }));
  view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    if (!window.confirm(t('Remove this scenario?'))) return;
    try { await api(`/api/equity/scenarios/${b.dataset.rm}/remove`, { method: 'POST', body: {} }); renderEquity(); } catch (err) { toast(err.message, true); }
  }));

  view.querySelectorAll('form.eq-form').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const [k, v] of new FormData(f)) if (v !== '') body[k] = ['holderId', 'classId', 'shares', 'size', 'vestMonths', 'cliffMonths', 'seniority'].includes(k) ? Number(v) : ['price', 'strike', 'principal', 'cap', 'discountPct', 'interestPct', 'liqPref'].includes(k) ? Number(v) : v;
    if (f.querySelector('[name="participating"]')) body.participating = f.querySelector('[name="participating"]').checked;
    try { await api(f.dataset.post, { method: 'POST', body }); toast(t('Recorded')); renderEquity(); } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-exercise]').forEach((b) => b.addEventListener('click', async () => {
    const n = window.prompt(t('How many vested options to exercise?'), b.dataset.max);
    if (!n) return;
    try { await api(`/api/equity/grants/${b.dataset.exercise}/exercise`, { method: 'POST', body: { shares: Number(n) } }); toast(t('Exercised')); renderEquity(); } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-endgrant]').forEach((b) => b.addEventListener('click', async () => {
    const why = window.prompt(t('Why does this grant end? What was not exercised goes back to the pool.'));
    if (!why) return;
    try { await api(`/api/equity/grants/${b.dataset.endgrant}/cancel`, { method: 'POST', body: { note: why } }); renderEquity(); } catch (err) { toast(err.message, true); }
  }));
}
