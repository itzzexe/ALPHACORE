// The markets door: the desk, one symbol in depth, the portfolio, the
// newsroom — and the local brain, which lives behind the Work door but is
// drawn here because it shares the same parts.
//
// Two rules for every number on these pages. A simulated price says so next
// to itself, not in a footnote. A forecast is never shown without its range
// and its track record beside it.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t, lang } from '/i18n.js';
import { kpi, tabs, emptyCta, act, wireActs, spark, ago, hashParam, bar } from '../components/ui.js';
import { correctButton, wireCorrections } from './learning.js';

// ---------------------------------------------------------------- format --

const fmt = (p) => {
  if (p == null || !Number.isFinite(Number(p))) return '—';
  const v = Number(p);
  const d = Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 10 ? 2 : 4;
  return v.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const pct = (x, { ratio = false, sign = true } = {}) => {
  if (x == null || !Number.isFinite(Number(x))) return '—';
  const v = ratio ? Number(x) * 100 : Number(x);
  return `${sign && v > 0 ? '+' : ''}${v.toFixed(2)}%`;
};
const dir = (x) => (x > 0 ? 'mk-up' : x < 0 ? 'mk-down' : '');
const num = (x) => `<span class="ltr">${x}</span>`;
const LABEL_CLS = { 'strong buy': 'chip-ok', buy: 'chip-ok', hold: '', sell: 'chip-bad', 'strong sell': 'chip-bad' };
const sigChip = (label, score) => (label ? `<span class="chip ${LABEL_CLS[label] || ''}">${esc(t(label))}${score != null ? ` · ${num(score)}` : ''}</span>` : '<span class="chip chip-dim">—</span>');
const stanceChip = (s) => `<span class="chip ${s === 'bullish' ? 'chip-ok' : s === 'bearish' ? 'chip-bad' : ''}">${esc(t(s || 'neutral'))}</span>`;
const sourceChip = (src) => (src === 'live'
  ? `<span class="chip chip-ok">${esc(t('Live prices'))}</span>`
  : `<span class="chip chip-warn" title="${esc(t('Not real prices. Switch to live data to see the market.'))}">${esc(t('SIMULATED'))}</span>`);
const symHref = (s) => `#/markets/${encodeURIComponent(s)}`;
const disclaimer = () => `<p class="hint mk-disclaimer">${esc(t('Analysis, not licensed financial advice. Forecasts carry their ranges and their track record; daily returns are close to unpredictable.'))}</p>`;

/**
 * Closing prices with the 50-day average and the forecast cone.
 *
 * The cone is the point: the expected path is a thin line inside two bands,
 * and the 95% band is usually wide enough to make the point for itself.
 */
function priceChart(chart, forecast = [], sma50 = null) {
  if (!chart?.length || chart.length < 2) return `<div class="empty">${esc(t('Not enough history to draw yet.'))}</div>`;
  const W = 760; const H = 260; const padL = 8; const padR = 120; const padT = 12; const padB = 22;
  const closes = chart.map((c) => c.close);
  const fc = forecast.filter((f) => f.horizon <= 60);
  const all = [...closes, ...fc.flatMap((f) => [f.low95, f.high95])].filter((x) => Number.isFinite(x));
  const lo = Math.min(...all); const hi = Math.max(...all);
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1));
  const plotW = W - padL - padR;
  const x = (i) => padL + (plotW * i) / (closes.length - 1);
  const line = closes.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join(' ');
  const sma = [];
  for (let i = 49; i < closes.length; i++) sma.push([i, closes.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50]);
  const smaPath = sma.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const x0 = x(closes.length - 1); const y0 = y(closes[closes.length - 1]);
  const fx = (h) => x0 + (padR - 10) * (h / 60);
  const cone = (loK, hiK) => (fc.length ? `M${x0} ${y0} ${fc.map((f) => `L${fx(f.horizon).toFixed(1)} ${y(f[hiK]).toFixed(1)}`).join(' ')} ${[...fc].reverse().map((f) => `L${fx(f.horizon).toFixed(1)} ${y(f[loK]).toFixed(1)}`).join(' ')} Z` : '');
  const mid = fc.length ? `M${x0} ${y0} ${fc.map((f) => `L${fx(f.horizon).toFixed(1)} ${y(f.expected).toFixed(1)}`).join(' ')}` : '';
  const label = `${t('Price history')} ${chart[0].day} – ${chart[chart.length - 1].day}`;
  return `<svg class="mk-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">
    <line class="mk-axis" x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}"/>
    ${smaPath ? `<path class="mk-sma" d="${smaPath}"/>` : ''}
    <path class="mk-line" d="${line}"/>
    ${fc.length ? `<path class="mk-cone95" d="${cone('low95', 'high95')}"/><path class="mk-cone80" d="${cone('low80', 'high80')}"/><path class="mk-mid" d="${mid}"/>` : ''}
    <text class="mk-tick" x="${padL}" y="${H - 6}">${esc(chart[0].day)}</text>
    <text class="mk-tick" x="${W - padR}" y="${H - 6}" text-anchor="end">${esc(chart[chart.length - 1].day)}</text>
    <text class="mk-tick" x="${W - 4}" y="${padT + 10}" text-anchor="end">${esc(fmt(hi))}</text>
    <text class="mk-tick" x="${W - 4}" y="${H - padB - 4}" text-anchor="end">${esc(fmt(lo))}</text>
  </svg>
  <div class="mk-legend"><span class="k-line">${esc(t('Close'))}</span><span class="k-sma">${esc(t('50-day average'))}</span>${fc.length ? `<span class="k-cone">${esc(t('Forecast: 80% and 95% ranges'))}</span>` : ''}</div>`;
}

// ================================================================= desk ==

export async function renderMarkets() {
  const d = await api('/api/markets');
  const canManage = hasPermC('markets.manage');
  const canArm = hasPermC('connectors.manage');
  const rec = d.record;
  const brief = d.brief;
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Every symbol on the watchlist updates on its own clock. Indicators, forecasts and the signal score are computed, not written by a model; the analyst is handed those numbers and asked to explain them. A forecast is recorded the day it is made and graded the day it falls due.'))}</p>
    <div class="inline">
      ${sourceChip(d.source)}
      ${d.lastRefresh ? `<span class="hint">${esc(t('Updated'))} ${ago(d.lastRefresh)}</span>` : ''}
      ${canManage ? act('/api/markets/refresh', 'Refresh now', { done: 'Refreshed' }) : ''}
      ${canManage ? act('/api/markets/daily', 'Run the daily pass', { done: 'The daily pass ran; the brief is being written' }) : ''}
      ${canManage ? act('/api/markets/brief', 'Write a brief now', { done: 'The analyst is writing' }) : ''}
    </div>
  </div>
  ${d.source !== 'live' ? `<div class="callout mk-callout">
    <b>${esc(t('These prices are simulated.'))}</b> ${esc(t('A plausible random walk so the desk can be learned on a fresh install. Nothing here is the market.'))}
    ${canArm ? `<form id="mk-live" class="form-inline" style="margin-top:10px">
      <label class="fl" for="mk-key">${esc(t('API key (optional)'))}</label>
      <input id="mk-key" type="password" autocomplete="off" placeholder="${esc(t('Twelve Data or Finnhub — leave empty for Yahoo'))}">
      <label class="fl" for="mk-prov">${esc(t('Prefer'))}</label>
      <select id="mk-prov"><option value="yahoo">Yahoo Finance</option><option value="twelvedata">Twelve Data</option><option value="finnhub">Finnhub</option></select>
      <button class="btn btn-primary" type="submit">${esc(t('Switch to live prices'))}</button>
    </form>` : `<p class="hint">${esc(t('A person with connectors.manage switches the desk onto live data.'))}</p>`}
  </div>` : ''}
  <div class="kpis">
    ${kpi('Symbols', d.watch.length, `${num(d.breadth.up)} ${esc(t('up'))} · ${num(d.breadth.down)} ${esc(t('down'))}`)}
    ${kpi('Forecast direction right', rec.graded ? num(`${Math.round(rec.directionHit * 100)}%`) : '—', rec.graded ? `${num(rec.graded)} ${esc(t('graded'))} · ${num(rec.pending)} ${esc(t('pending'))}` : esc(t('nothing graded yet')), rec.graded && rec.directionHit < 0.5 ? 'bad' : '')}
    ${kpi('Inside the 80% range', rec.graded ? num(`${Math.round(rec.inside80 * 100)}%`) : '—', esc(t('should be near 80% if the ranges are honest')))}
    ${kpi('Alerts', d.alerts.filter((a) => a.state === 'active').length, `${num(d.alerts.filter((a) => a.state === 'fired').length)} ${esc(t('fired'))}`)}
    ${kpi('Risk profile', esc(t(d.prefs.profile)), `${esc(t('refresh every'))} ${num(d.prefs.refreshSec)}s`)}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Daily brief'))} ${brief ? `<span class="hint">${esc(brief.day)} · ${brief.served_by ? esc(brief.served_by) : esc(t(brief.state))}</span>` : ''}</div>
    ${!brief ? `<div class="empty">${esc(t('No brief yet. The daily pass writes one after the configured hour, or ask for one now.'))}</div>`
    : brief.state === 'thinking' ? `<div class="empty">${esc(t('The analyst is writing…'))}</div>`
      : brief.state === 'failed' ? `<div class="empty">${esc(t('The brief failed:'))} ${esc(brief.summary || '')}</div>`
        : `<p class="mk-summary">${esc(brief.body?.summary || brief.summary || '')}</p>
      ${brief.body?.outlook?.length ? `<table class="tbl"><thead><tr><th>${esc(t('Symbol'))}</th><th>${esc(t('Stance'))}</th><th>${esc(t('Why'))}</th><th>${esc(t('Risks'))}</th><th>${esc(t('Stop'))}</th><th>${esc(t('Target'))}</th></tr></thead><tbody>
        ${brief.body.outlook.map((o) => `<tr><td><a href="${symHref(o.symbol)}">${esc(o.symbol)}</a></td><td>${stanceChip(o.stance)}</td><td>${esc(o.why || '')}</td><td class="sub">${esc(o.risks || '')}</td>
          <td>${num(fmt(o.levels?.stop))}</td><td>${num(fmt(o.levels?.target))}</td></tr>`).join('')}</tbody></table>` : ''}
      ${brief.body?.ideas?.length ? `<div class="fl" style="margin-top:12px">${esc(t('Ideas — each one becomes a proposal a person approves on the portfolio desk'))}</div>
        <ul class="mk-ideas">${brief.body.ideas.map((i) => `<li><span class="chip ${i.side === 'buy' ? 'chip-ok' : 'chip-bad'}">${esc(t(i.side))}</span> <a href="${symHref(i.symbol)}">${esc(i.symbol)}</a> — ${esc(i.why || '')} <span class="hint">${num(Math.round((i.confidence || 0) * 100))}%</span></li>`).join('')}</ul>` : ''}
      ${brief.body?.risks?.length ? `<div class="fl" style="margin-top:12px">${esc(t('Risks'))}</div><ul>${brief.body.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${correctButton('mkt_brief', brief.id)}`}
    ${disclaimer()}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Watchlist'))}</div>
    ${d.watch.length ? `<div class="mk-scroll"><table class="tbl mk-watch"><thead><tr>
      <th>${esc(t('Symbol'))}</th><th>${esc(t('Price'))}</th><th>${esc(t('Change'))}</th><th>${esc(t('Trend'))}</th><th>${esc(t('Signal'))}</th><th>${esc(t('Day range'))}</th><th></th>
    </tr></thead><tbody>
    ${d.watch.map((w) => `<tr>
      <td><a href="${symHref(w.symbol)}"><b class="ltr">${esc(w.symbol)}</b></a><div class="sub">${esc(w.name || '')} · ${esc(t(w.kind))}</div></td>
      <td>${num(fmt(w.price))}${w.source && w.source !== 'simulated' ? '' : w.price != null ? ` <span class="chip chip-warn mk-sim">${esc(t('sim'))}</span>` : ''}</td>
      <td class="${dir(w.change_pct)}">${num(pct(w.change_pct))}</td>
      <td class="mk-sparkcell">${spark(w.ticks || [], { max: null })}</td>
      <td>${sigChip(w.label, w.score)}</td>
      <td class="sub">${num(`${fmt(w.day_low)} – ${fmt(w.day_high)}`)}</td>
      <td>${canManage ? act('/api/markets/unwatch', 'Remove', { body: { symbol: w.symbol }, cls: 'btn-sm btn-ghost', confirm: 'Take this symbol off the watchlist?' }) : ''}</td>
    </tr>`).join('')}</tbody></table></div>`
    : emptyCta('An empty watchlist', 'Add the symbols you care about, or start with the usual fifteen.', canManage ? act('/api/markets/seed', 'Start with the usual list', { cls: 'btn-primary' }) : '')}
    ${canManage ? `<form id="mk-add" class="form-inline" style="margin-top:12px">
      <label class="fl" for="mk-sym">${esc(t('Add a symbol'))}</label>
      <input id="mk-sym" required maxlength="20" placeholder="AAPL · ^GSPC · BTC-USD · EURUSD=X · GC=F" class="ltr">
      <button class="btn" type="submit">${esc(t('Add'))}</button>
    </form>` : ''}
  </div>

  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Alerts'))}</div>
      ${d.alerts.length ? `<table class="tbl"><tbody>${d.alerts.map((a) => `<tr>
        <td><a href="${symHref(a.symbol)}">${esc(a.symbol)}</a></td><td>${esc(t(a.rule.replace('_', ' ')))} ${num(a.threshold)}</td>
        <td>${a.state === 'fired' ? `<span class="chip chip-warn">${esc(t('fired'))} ${ago(a.fired_at)}</span>` : `<span class="chip">${esc(t('watching'))}</span>`}</td>
        <td>${canManage ? act(`/api/markets/alert/${a.id}/off`, 'Turn off', { cls: 'btn-sm btn-ghost' }) : ''}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('No alerts. An alert notifies everyone who can see this desk.'))}</div>`}
      ${canManage && d.watch.length ? `<form id="mk-alert" class="form-inline" style="margin-top:10px">
        <label class="fl" for="mk-al-sym">${esc(t('Symbol'))}</label>
        <select id="mk-al-sym">${d.watch.map((w) => `<option value="${esc(w.symbol)}">${esc(w.symbol)}</option>`).join('')}</select>
        <label class="fl" for="mk-al-rule">${esc(t('When'))}</label>
        <select id="mk-al-rule">${['above', 'below', 'move_pct', 'rsi_above', 'rsi_below'].map((r) => `<option value="${r}">${esc(t(r.replace('_', ' ')))}</option>`).join('')}</select>
        <label class="fl" for="mk-al-th">${esc(t('Threshold'))}</label>
        <input id="mk-al-th" type="number" step="any" required style="width:110px">
        <button class="btn" type="submit">${esc(t('Set alert'))}</button>
      </form>` : ''}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Preferences'))}</div>
      ${canManage ? `<form id="mk-prefs" class="fields">
        <div><label class="fl" for="mk-p-ref">${esc(t('Refresh every (seconds)'))}</label><input id="mk-p-ref" type="number" min="15" max="3600" value="${d.prefs.refreshSec}"></div>
        <div><label class="fl" for="mk-p-prof">${esc(t('Risk profile'))}</label><select id="mk-p-prof">${['conservative', 'balanced', 'aggressive'].map((p) => `<option value="${p}" ${p === d.prefs.profile ? 'selected' : ''}>${esc(t(p))}</option>`).join('')}</select></div>
        <div><label class="fl" for="mk-p-hour">${esc(t('Daily pass after (UTC hour)'))}</label><input id="mk-p-hour" type="number" min="0" max="23" value="${d.prefs.briefHour}"></div>
        <div><label class="fl" for="mk-p-lang">${esc(t('Brief language'))}</label><select id="mk-p-lang"><option value="ar">العربية</option><option value="en">English</option></select></div>
        <div class="wide"><button class="btn" type="submit">${esc(t('Save'))}</button>
          ${d.source === 'live' && canArm ? act('/api/markets/simulated', 'Go back to simulated prices', { cls: 'btn-sm btn-ghost', confirm: 'Stop reading the real market?' }) : ''}</div>
      </form>` : `<div class="hint">${esc(t('Read-only for you.'))}</div>`}
    </div>
  </div>`;

  wireActs(view, api, toast, renderMarkets);
  wireCorrections(view, renderMarkets);
  $('#mk-add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/markets/watch', { method: 'POST', body: { symbol: $('#mk-sym').value } }); toast(t('Added — history arrives in a moment')); renderMarkets(); } catch (err) { toast(err.message, true); }
  });
  $('#mk-alert')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/markets/alert', { method: 'POST', body: { symbol: $('#mk-al-sym').value, rule: $('#mk-al-rule').value, threshold: Number($('#mk-al-th').value) } }); renderMarkets(); } catch (err) { toast(err.message, true); }
  });
  $('#mk-prefs')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/markets/prefs', { method: 'POST', body: { refreshSec: Number($('#mk-p-ref').value), profile: $('#mk-p-prof').value, briefHour: Number($('#mk-p-hour').value), briefLang: $('#mk-p-lang').value } });
      toast(t('Saved')); renderMarkets();
    } catch (err) { toast(err.message, true); }
  });
  $('#mk-live')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/markets/live', { method: 'POST', body: { key: $('#mk-key').value || null, provider: $('#mk-prov').value } }); toast(t('Live prices on — the first refresh is on its way')); renderMarkets(); } catch (err) { toast(err.message, true); }
  });
}

// =============================================================== symbol ==

export async function renderSymbol(arg) {
  const d = await api(`/api/markets/symbol/${encodeURIComponent(arg)}`);
  const a = d.analysis; const s = a.summary || {};
  const qt = d.quote || {};
  const canManage = hasPermC('markets.manage');
  const canPropose = hasPermC('portfolio.propose');
  const bt = d.backtest || {};
  const bt20 = d.backtest20 || {};
  const latest = d.briefs.find((b) => b.state === 'ready');
  view.innerHTML = `
  <div class="pg-head">
    <p><a href="#/markets">← ${esc(t('Markets desk'))}</a></p>
    <div class="mk-hero">
      <div><h2 class="ltr">${esc(d.symbol)}</h2><div class="sub">${esc(d.name || '')} · ${esc(t(d.kind))}${d.exchange ? ` · ${esc(d.exchange)}` : ''}</div></div>
      <div class="mk-price"><b>${num(fmt(qt.price))}</b> <span class="${dir(qt.change_pct)}">${num(pct(qt.change_pct))}</span> ${sourceChip(d.source)}</div>
    </div>
  </div>
  <div class="panel">${priceChart(d.chart, a.forecast, s.sma50)}</div>
  <div class="kpis">
    ${kpi('RSI (14)', s.rsi14 != null ? num(s.rsi14) : '—', esc(t(s.rsi14 > 70 ? 'overbought' : s.rsi14 < 30 ? 'oversold' : 'neutral')), s.rsi14 > 70 || s.rsi14 < 30 ? 'human' : '')}
    ${kpi('Volatility (annual)', s.vol20 != null ? num(pct(s.vol20, { ratio: true, sign: false })) : '—', `${esc(t('60-day'))} ${num(pct(s.vol60, { ratio: true, sign: false }))}`)}
    ${kpi('52-week range', num(`${fmt(s.lo52)} – ${fmt(s.hi52)}`), `${esc(t('drawdown'))} ${num(pct(s.drawdown1y, { ratio: true }))}`)}
    ${kpi('1 month', `<span class="${dir(s.perf?.m1)}">${num(pct(s.perf?.m1, { ratio: true }))}</span>`, `${esc(t('3 months'))} ${num(pct(s.perf?.m3, { ratio: true }))}`)}
    ${kpi('1 year', `<span class="${dir(s.perf?.y1)}">${num(pct(s.perf?.y1, { ratio: true }))}</span>`, `${num(a.bars)} ${esc(t('sessions of history'))}`)}
  </div>
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Signal'))} ${sigChip(a.signal.label, a.signal.score)}</div>
      ${bar('Score (−100 … +100)', (a.signal.score + 100) / 2, { warn: 101, bad: 101, suffix: '' }).replace(/<b>[^<]*<\/b>/, `<b>${num(a.signal.score)}</b>`)}
      <table class="tbl"><thead><tr><th>${esc(t('Part'))}</th><th>${esc(t('Points'))}</th><th>${esc(t('Why'))}</th></tr></thead><tbody>
      ${a.signal.components.map((c) => `<tr><td>${esc(t(c.part))}</td><td class="${dir(c.points)}">${num(c.points > 0 ? `+${c.points}` : c.points)}</td><td class="sub">${esc(c.why)}</td></tr>`).join('')}
      </tbody></table>
      <p class="hint">${esc(t('A score is the sum of its parts. When one loud part carries the verdict, it says so here.'))}</p>
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Forecast'))}</div>
      ${a.forecast.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Sessions'))}</th><th>${esc(t('Expected'))}</th><th>${esc(t('80% range'))}</th><th>${esc(t('95% range'))}</th><th>${esc(t('Chance higher'))}</th></tr></thead><tbody>
        ${a.forecast.map((f) => `<tr><td>${num(f.horizon)}</td><td>${num(fmt(f.expected))}</td><td class="sub">${num(`${fmt(f.low80)} – ${fmt(f.high80)}`)}</td><td class="sub">${num(`${fmt(f.low95)} – ${fmt(f.high95)}`)}</td><td>${num(`${Math.round(f.pUp * 100)}%`)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${esc(t('Thirty sessions of history are needed before a forecast.'))}</div>`}
      <div class="fl" style="margin-top:12px">${esc(t('How this forecast has done'))}</div>
      <table class="tbl"><tbody>
        <tr><td>${esc(t('Backtest, 5 sessions'))}</td><td>${bt.windows ? `${num(`${Math.round(bt.directionHit * 100)}%`)} ${esc(t('direction right'))} · ${esc(t('always-the-majority baseline'))} ${num(`${Math.round(bt.baselineAlwaysMajority * 100)}%`)} · ${num(`${Math.round(bt.inside80 * 100)}%`)} ${esc(t('inside 80%'))}` : '—'}</td></tr>
        <tr><td>${esc(t('Backtest, 20 sessions'))}</td><td>${bt20.windows ? `${num(`${Math.round(bt20.directionHit * 100)}%`)} ${esc(t('direction right'))} · ${esc(t('always-the-majority baseline'))} ${num(`${Math.round(bt20.baselineAlwaysMajority * 100)}%`)} · ${esc(t('mean error'))} ${num(`${bt20.meanAbsErrPct}%`)}` : '—'}</td></tr>
        <tr><td>${esc(t('Graded live on this install'))}</td><td>${d.record.graded ? `${num(`${Math.round(d.record.directionHit * 100)}%`)} ${esc(t('of'))} ${num(d.record.graded)}` : esc(t('nothing graded yet'))}</td></tr>
      </tbody></table>
      <p class="hint">${esc(t('If the direction is right about as often as the baseline, the forecast knows nothing the base rate does not. That is the usual finding, and the reason the ranges matter more than the line.'))}</p>
    </div>
  </div>
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Position sizing'))} <span class="hint">${esc(t(a.sizing?.profile || ''))}</span></div>
      ${a.sizing ? `<div class="kv"><span>${esc(t('Suggested weight'))}</span><b>${num(pct(a.sizing.weight, { ratio: true, sign: false }))}</b></div>
        <div class="kv"><span>${esc(t('Stop (2 × ATR)'))}</span><b>${num(fmt(a.sizing.stop))}</b></div>
        <div class="kv"><span>${esc(t('Target (3 × ATR)'))}</span><b>${num(fmt(a.sizing.target))}</b></div>
        <p class="hint">${esc(t('Sized to volatility, not to conviction: a calm stock gets a larger slice than a wild one at the same score.'))}</p>
        ${canPropose ? `<div class="inline">
          <button class="btn btn-primary" data-propose="buy">${esc(t('Propose a buy'))}</button>
          <button class="btn" data-propose="sell">${esc(t('Propose a sell'))}</button>
          <span class="hint">${esc(t('A proposal waits for a person on the portfolio desk.'))}</span></div>` : ''}`
    : `<div class="empty">${esc(t('Not enough history to size a position.'))}</div>`}
      ${disclaimer()}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('The analyst'))} ${canManage ? act('/api/markets/brief', 'Ask for a view', { body: { symbol: d.symbol }, done: 'The analyst is writing' }) : ''}</div>
      ${latest ? `<p class="mk-summary">${esc(latest.body?.summary || latest.summary || '')}</p>
        ${(latest.body?.outlook || []).filter((o) => o.symbol === d.symbol).map((o) => `<p>${stanceChip(o.stance)} ${esc(o.why || '')}</p><p class="sub">${esc(o.risks || '')}</p>`).join('')}
        <div class="hint">${esc(latest.served_by || '')} · ${ago(latest.created_at)} ${correctButton('mkt_brief', latest.id)}</div>`
    : d.briefs.length ? `<div class="empty">${esc(t(d.briefs[0].state === 'thinking' ? 'The analyst is writing…' : 'The last request failed.'))}</div>`
      : `<div class="empty">${esc(t('No view on this symbol yet.'))}</div>`}
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Headlines about it'))}</div>
    ${d.news.length ? `<ul class="nw-list">${d.news.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
      <span class="sub">${esc(n.source || '')} · ${ago(n.published_at)}</span> ${toneChip(n.sentiment)}</li>`).join('')}</ul>`
    : `<div class="empty">${esc(t('No headlines tagged with this symbol. Turn on the newsroom feeds to see them.'))}</div>`}
  </div>`;

  wireActs(view, api, toast, () => renderSymbol(arg));
  wireCorrections(view, () => renderSymbol(arg));
  view.querySelectorAll('[data-propose]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const o = await api('/api/portfolio/propose', { method: 'POST', body: { symbol: d.symbol, side: b.dataset.propose, rationale: `${t('From the markets desk')}: ${a.signal.label} ${a.signal.score}` } });
      toast(o.state === 'held' ? t('Proposed, but held: a check failed — see the portfolio desk') : t('Proposed — waiting for approval on the portfolio desk'));
    } catch (e) { toast(e.message, true); }
    b.disabled = false;
  }));
}

const toneChip = (s) => (s == null ? '' : s > 0.2 ? `<span class="chip chip-ok">${esc(t('positive'))}</span>` : s < -0.2 ? `<span class="chip chip-bad">${esc(t('negative'))}</span>` : `<span class="chip chip-dim">${esc(t('neutral'))}</span>`);

// ============================================================ portfolio ==

export async function renderPortfolio() {
  const d = await api('/api/portfolio');
  const canApprove = hasPermC('portfolio.approve');
  const canPropose = hasPermC('portfolio.propose');
  const canConnect = hasPermC('portfolio.connect');
  const main = d.accounts[0] || { equity: 0, cash: 0, positions: [] };
  const curve = d.curve.filter((c) => c.account_id === main.id).map((c) => c.equity);
  const checkChips = (risk) => (risk?.checks || []).map((c) => `<span class="chip ${c.ok ? 'chip-dim' : 'chip-bad'}" title="${esc(c.why)}">${esc(t(c.name))}</span>`).join(' ');
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Every book starts on paper. Anyone with the permission can propose an order and the analyst files its ideas as proposals; only a person approves one, and the checks run again at the price of the moment. A broker order leaves through the egress gate carrying that approval.'))}</p>
    <div class="inline">${sourceChip(d.priceSource)}</div>
  </div>
  <div class="kpis">
    ${kpi('Equity', num(fmt(main.equity)), esc(main.name || ''))}
    ${kpi('Cash', num(fmt(main.cash)), `${num(fmt(main.invested))} ${esc(t('invested'))}`)}
    ${kpi('Return', `<span class="${dir(main.returnPct)}">${num(pct(main.returnPct))}</span>`, d.benchmark ? `${esc(t('S&P 500 over the same time'))} ${num(pct(d.benchmark.returnPct))}` : '')}
    ${kpi('Waiting for a person', d.pending.filter((o) => o.state === 'proposed').length, `${num(d.pending.filter((o) => o.state === 'held').length)} ${esc(t('held by a check'))}`, d.pending.some((o) => o.state === 'proposed') ? 'human' : '')}
    <div class="kpi"><div class="k-label">${esc(t('Equity curve'))}</div>${spark(curve)}</div>
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Orders waiting'))}</div>
    ${d.pending.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>#</th><th>${esc(t('Order'))}</th><th>${esc(t('Value'))}</th><th>${esc(t('Proposed by'))}</th><th>${esc(t('Checks'))}</th><th>${esc(t('State'))}</th><th></th></tr></thead><tbody>
      ${d.pending.map((o) => `<tr class="${o.state === 'held' ? 'row-bad' : ''}">
        <td>${num(o.id)}</td>
        <td><span class="chip ${o.side === 'buy' ? 'chip-ok' : 'chip-bad'}">${esc(t(o.side))}</span> ${num(o.qty)} <a href="${symHref(o.symbol)}">${esc(o.symbol)}</a> <span class="sub">${esc(t(o.order_type))}${o.limit_price ? ` @ ${num(fmt(o.limit_price))}` : ''}</span>
          ${o.rationale ? `<div class="sub">${esc(o.rationale)}</div>` : ''}</td>
        <td>${num(fmt(o.est_value))}</td>
        <td class="sub">${esc(o.proposed_by)}</td>
        <td>${checkChips(o.risk)}</td>
        <td><span class="chip">${esc(t(o.state))}</span></td>
        <td class="inline">${canApprove && o.state === 'proposed' ? act(`/api/portfolio/order/${o.id}/approve`, 'Approve', { cls: 'btn-sm btn-human', confirm: 'Approve this order? On a broker account this sends it.', done: 'Approved' }) : ''}
          ${canApprove && ['proposed', 'held', 'working'].includes(o.state) ? act(`/api/portfolio/order/${o.id}/reject`, 'Reject', { cls: 'btn-sm btn-ghost' }) : ''}</td>
      </tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('Nothing waiting. Propose an order below, or let the analyst propose from the daily brief.'))}</div>`}
  </div>
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Positions'))}</div>
      ${d.accounts.map((acc) => `<div class="fl">${esc(acc.name)} · ${num(fmt(acc.equity))}</div>
        ${acc.positions.length ? `<table class="tbl"><thead><tr><th>${esc(t('Symbol'))}</th><th>${esc(t('Quantity'))}</th><th>${esc(t('Average cost'))}</th><th>${esc(t('Price'))}</th><th>${esc(t('P&L'))}</th><th>${esc(t('Weight'))}</th></tr></thead><tbody>
          ${acc.positions.map((p) => `<tr><td><a href="${symHref(p.symbol)}">${esc(p.symbol)}</a></td><td>${num(p.qty)}</td><td>${num(fmt(p.avg_cost))}</td><td>${num(fmt(p.price))}</td>
            <td class="${dir(p.pnl)}">${num(fmt(p.pnl))} (${num(pct(p.pnlPct))})</td><td>${num(`${p.weight}%`)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('No positions.'))}</div>`}`).join('')}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Propose an order'))}</div>
      ${canPropose ? `<form id="pf-new" class="fields">
        <div><label class="fl" for="pf-sym">${esc(t('Symbol'))}</label><input id="pf-sym" required maxlength="20" class="ltr" value="${esc(hashParam('symbol') || '')}"></div>
        <div><label class="fl" for="pf-side">${esc(t('Side'))}</label><select id="pf-side"><option value="buy">${esc(t('buy'))}</option><option value="sell">${esc(t('sell'))}</option></select></div>
        <div><label class="fl" for="pf-qty">${esc(t('Quantity (empty: size it for me)'))}</label><input id="pf-qty" type="number" step="any" min="0"></div>
        <div><label class="fl" for="pf-type">${esc(t('Type'))}</label><select id="pf-type"><option value="market">${esc(t('market'))}</option><option value="limit">${esc(t('limit'))}</option></select></div>
        <div><label class="fl" for="pf-limit">${esc(t('Limit price'))}</label><input id="pf-limit" type="number" step="any" min="0"></div>
        ${d.accounts.length > 1 ? `<div><label class="fl" for="pf-acc">${esc(t('Account'))}</label><select id="pf-acc">${d.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>` : ''}
        <div class="wide"><label class="fl" for="pf-why">${esc(t('Why'))}</label><textarea id="pf-why" rows="2" maxlength="2000"></textarea></div>
        <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Propose'))}</button></div>
      </form>` : `<div class="hint">${esc(t('Read-only for you.'))}</div>`}
      <div class="fl" style="margin-top:12px">${esc(t('Limits'))}</div>
      <div class="kv"><span>${esc(t('Largest order'))}</span><b>${num(fmt(d.limits.maxOrderUsd))}</b></div>
      <div class="kv"><span>${esc(t('Largest position'))}</span><b>${num(`${d.limits.maxPositionPct}%`)}</b></div>
      <div class="kv"><span>${esc(t('Orders a day'))}</span><b>${num(d.limits.maxOrdersDay)}</b></div>
      <div class="kv"><span>${esc(t('Paper slippage'))}</span><b>${num(`${d.limits.slippageBps} bps`)}</b></div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Order history'))}</div>
    ${d.orders.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>#</th><th>${esc(t('Order'))}</th><th>${esc(t('State'))}</th><th>${esc(t('Fill'))}</th><th>${esc(t('Decided by'))}</th><th>${esc(t('When'))}</th></tr></thead><tbody>
      ${d.orders.map((o) => `<tr><td>${num(o.id)}</td><td>${esc(t(o.side))} ${num(o.qty)} ${esc(o.symbol)}</td><td><span class="chip">${esc(t(o.state))}</span></td>
        <td>${o.fill_price ? num(fmt(o.fill_price)) : '—'}</td><td class="sub">${esc(o.decided_by || '—')}</td><td class="sub">${ago(o.filled_at || o.decided_at || o.created_at)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('No orders yet.'))}</div>`}
  </div>
  ${canConnect ? `<div class="panel">
    <div class="panel-title">${esc(t('Connect a broker'))} ${d.broker?.state === 'live' ? `<span class="chip chip-ok">${esc(t('connected'))}</span>` : ''}</div>
    <p class="hint">${esc(t('Alpaca, on its paper endpoint unless you say otherwise in so many words. The key is kept in the vault; orders still need a person to approve each one.'))}</p>
    <form id="pf-broker" class="fields">
      <div class="wide"><label class="fl" for="pf-bkey">${esc(t('KEY_ID:SECRET'))}</label><input id="pf-bkey" type="password" autocomplete="off" required class="ltr"></div>
      <div class="wide"><label class="eng-chk"><input type="checkbox" id="pf-blive"> ${esc(t('Real money (live account)'))}</label></div>
      <div><label class="fl" for="pf-bconf">${esc(t('Type REAL MONEY to confirm'))}</label><input id="pf-bconf" autocomplete="off"></div>
      <div><label class="fl" for="pf-bpw">${esc(t('Your password'))}</label><input id="pf-bpw" type="password" autocomplete="current-password"></div>
      <div class="wide inline"><button class="btn" type="submit">${esc(t('Connect'))}</button>
        ${d.broker?.state === 'live' ? act('/api/portfolio/sync', 'Read fills from the broker', { cls: 'btn-sm' }) : ''}</div>
    </form>
  </div>` : ''}
  <div class="panel">${disclaimer()}</div>`;

  wireActs(view, api, toast, renderPortfolio);
  $('#pf-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const o = await api('/api/portfolio/propose', { method: 'POST', body: {
        symbol: $('#pf-sym').value, side: $('#pf-side').value, qty: $('#pf-qty').value ? Number($('#pf-qty').value) : null,
        orderType: $('#pf-type').value, limitPrice: $('#pf-limit').value ? Number($('#pf-limit').value) : null,
        rationale: $('#pf-why').value, accountId: $('#pf-acc')?.value ? Number($('#pf-acc').value) : null,
      } });
      toast(o.state === 'held' ? t('Proposed, but held: a check failed') : t('Proposed — waiting for approval'));
      renderPortfolio();
    } catch (err) { toast(err.message, true); }
  });
  $('#pf-broker')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/portfolio/broker', { method: 'POST', body: { key: $('#pf-bkey').value, live: $('#pf-blive').checked, confirm: $('#pf-bconf').value, password: $('#pf-bpw').value } });
      toast(t('Broker connected')); renderPortfolio();
    } catch (err) { toast(err.message, true); }
  });
}

// ============================================================= newsroom ==

const CAT_LABEL = { all: 'All', tech: 'Technology', politics: 'Politics', economy: 'Economy', markets: 'Markets', world: 'World', arabic: 'Arabic', custom: 'Custom' };

export async function renderNewsroom() {
  const cat = hashParam('category') || 'all';
  const search = hashParam('q') || '';
  const qs = new URLSearchParams();
  if (cat !== 'all') qs.set('category', cat);
  if (search) qs.set('q', search);
  const d = await api(`/api/newsroom${qs.toString() ? `?${qs}` : ''}`);
  const canManage = hasPermC('news.manage');
  const canArm = hasPermC('connectors.manage');
  const dg = d.digests[cat];
  const total24 = Object.values(d.counts).reduce((a, b) => a + b, 0);
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Read from the feeds the outlets publish for exactly this — no scraping, robots.txt asked first. Every item is untrusted text: scanned for instructions before it is stored, and handed to the editor under a line that says so. Nothing here is invented; when the feeds are off, the page is empty.'))}</p>
    <div class="inline">
      ${d.live ? `<span class="chip chip-ok">${esc(t('Feeds on'))}</span>` : `<span class="chip chip-warn">${esc(t('Feeds off'))}</span>`}
      ${d.live && canArm ? act('/api/newsroom/quiet', 'Pause the feeds', { cls: 'btn-sm btn-ghost' }) : ''}
    </div>
  </div>
  ${!d.live ? emptyCta('The newsroom is quiet', 'Turn on the feeds and the newest technology, politics, economy and markets stories arrive here every fifteen minutes, with a brief once a day.',
    canArm ? act('/api/newsroom/live', 'Turn on the news feeds', { cls: 'btn-primary', done: 'Feeds on — the first stories arrive within a minute' }) : `<p class="hint">${esc(t('A person with connectors.manage turns the feeds on.'))}</p>`) : ''}
  <div class="kpis">
    ${kpi('Stories, last 24 hours', total24)}
    ${['tech', 'politics', 'economy', 'markets'].map((c) => kpi(CAT_LABEL[c], d.counts[c] || 0, d.tone[c] != null ? `${esc(t('tone'))} ${num(d.tone[c])}` : '')).join('')}
  </div>
  ${tabs([['all', 'All', total24], ...d.categories.map((c) => [c, CAT_LABEL[c] || c, d.counts[c] || ''])], cat)}
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t("Today's brief"))} ${canManage ? act('/api/newsroom/digest', 'Write the brief now', { body: { category: cat }, done: 'The editor is writing' }) : ''}</div>
      ${!dg ? `<div class="empty">${esc(t('No brief for this section yet.'))}</div>`
    : dg.state === 'thinking' ? `<div class="empty">${esc(t('The editor is writing…'))}</div>`
      : `<p class="mk-summary">${esc(dg.body?.headline || '')}</p>
        ${(dg.body?.stories || []).map((s) => `<div class="nw-story"><b>${esc(s.title)}</b> ${s.impact ? `<span class="chip ${s.impact === 'positive' ? 'chip-ok' : s.impact === 'negative' ? 'chip-bad' : 'chip-dim'}">${esc(t(s.impact))}</span>` : ''}
          <p>${esc(s.why || '')}</p><div class="sub">${esc((s.sources || []).join(' · '))} ${(s.tickers || []).map((x) => `<a class="chip" href="${symHref(x)}">${esc(x)}</a>`).join(' ')}</div></div>`).join('')}
        ${dg.body?.watch?.length ? `<div class="fl">${esc(t('What to watch'))}</div><ul>${dg.body.watch.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <div class="hint">${esc(dg.served_by || '')} · ${ago(dg.created_at)} ${correctButton('news_digest', dg.id)}</div>`}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Stories'))}</div>
      <form id="nw-search" class="form-inline"><label class="fl" for="nw-q">${esc(t('Search'))}</label><input id="nw-q" value="${esc(search)}" maxlength="80"><button class="btn btn-sm" type="submit">${esc(t('Search'))}</button></form>
      ${d.items.length ? `<ul class="nw-list">${d.items.map((n) => `<li>
        <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer" ${n.lang === 'ar' ? 'dir="rtl" lang="ar"' : 'dir="ltr" lang="en"'}>${esc(n.title)}</a>
        ${n.flagged ? `<span class="chip chip-bad" title="${esc(t('The injection scanner found instructions in this item. It is shown, never handed to a model.'))}">${esc(t('flagged'))}</span>` : ''}
        <div class="sub">${esc(n.source || '')} · ${esc(t(CAT_LABEL[n.category] || n.category))} · ${ago(n.published_at || n.fetched_at)} ${toneChip(n.sentiment)}
          ${n.tickers.map((x) => `<a class="chip" href="${symHref(x)}">${esc(x)}</a>`).join(' ')}</div>
      </li>`).join('')}</ul>` : `<div class="empty">${esc(t('No stories here yet.'))}</div>`}
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Feeds'))} <span class="hint">${num(d.feeds.length)}</span></div>
    <div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Feed'))}</th><th>${esc(t('Section'))}</th><th>${esc(t('Last read'))}</th><th>${esc(t('Stories'))}</th><th></th></tr></thead><tbody>
    ${d.feeds.map((f) => `<tr class="${f.last_error ? 'row-bad' : ''}"><td>${esc(f.name)}<div class="sub ltr">${esc(f.url)}</div>${f.last_error ? `<div class="sub">${esc(f.last_error)}</div>` : ''}</td>
      <td>${esc(t(CAT_LABEL[f.category] || f.category))}</td><td class="sub">${ago(f.last_ok)}</td><td>${num(f.items_total)}</td>
      <td class="inline">${canManage ? `${act(`/api/newsroom/feed/${f.id}/toggle`, f.enabled ? 'Turn off' : 'Turn on', { body: { enabled: !f.enabled }, cls: 'btn-sm btn-ghost' })}
        ${d.live && f.enabled ? act(`/api/newsroom/feed/${f.id}/fetch`, 'Read now', { cls: 'btn-sm' }) : ''}` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${canManage ? `<form id="nw-add" class="form-inline" style="margin-top:12px">
      <label class="fl" for="nw-url">${esc(t('Add an RSS or Atom feed'))}</label><input id="nw-url" type="url" required class="ltr" placeholder="https://…/rss.xml">
      <label class="fl" for="nw-name">${esc(t('Name'))}</label><input id="nw-name" maxlength="80">
      <label class="fl" for="nw-cat">${esc(t('Section'))}</label><select id="nw-cat">${d.categories.map((c) => `<option value="${c}">${esc(t(CAT_LABEL[c] || c))}</option>`).join('')}</select>
      <button class="btn" type="submit">${esc(t('Add'))}</button>
    </form>` : ''}
  </div>`;

  wireActs(view, api, toast, renderNewsroom);
  wireCorrections(view, renderNewsroom);
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.tab;
    location.hash = c === 'all' ? '#/newsroom' : `#/newsroom?category=${encodeURIComponent(c)}`;
  }));
  $('#nw-search')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (cat !== 'all') p.set('category', cat);
    if ($('#nw-q').value.trim()) p.set('q', $('#nw-q').value.trim());
    location.hash = `#/newsroom${p.toString() ? `?${p}` : ''}`;
  });
  $('#nw-add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/newsroom/feed', { method: 'POST', body: { url: $('#nw-url').value, name: $('#nw-name').value, category: $('#nw-cat').value } }); renderNewsroom(); } catch (err) { toast(err.message, true); }
  });
}

// ============================================================= local AI ==

export async function renderLocalAI() {
  const [d, eng] = await Promise.all([api('/api/localai'), api('/api/localai/engine').catch(() => null)]);
  const canManage = hasPermC('localai.manage');
  const canAsk = hasPermC('runs.create');
  const canFile = hasPermC('requests.create');
  const share = d.share?.n ? Math.round(((d.share.local || 0) / d.share.n) * 100) : null;
  const options = [...new Set([...d.installed.map((m) => m.name), ...d.catalogue.filter((c) => c.role !== 'embed').map((c) => c.model)])];
  const sel = (id, cur) => `<select id="${id}">${options.map((m) => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`;
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('The model that runs on the company’s own server. Nothing it reads leaves the machine, it costs electricity rather than tokens, and it keeps working with the internet cut. With local-first on, every employee asks it before any hosted provider — and the serving model is recorded on every run, so which one did the work is never a guess.'))}</p>
    <div class="inline">
      <span class="chip ${d.enabled ? 'chip-ok' : 'chip-warn'}">${esc(t(d.enabled ? 'switched on' : 'switched off'))}</span>
      <span class="chip ${d.reachable ? 'chip-ok' : 'chip-bad'}">${esc(t(d.reachable ? 'reachable' : 'not reachable'))}${d.version ? ` · Ollama ${esc(d.version)}` : ''}</span>
      <span class="chip ${d.localFirst ? 'chip-ok' : ''}">${esc(t(d.localFirst ? 'local-first on' : 'local-first off'))}</span>
      <span class="chip ${d.address === 'public' ? 'chip-bad' : 'chip-dim'}" title="${esc(d.base)}">${esc(t(d.address))}</span>
    </div>
  </div>
  ${handoverPanel(d, options, canManage)}
  ${d.address === 'public' ? `<div class="callout mk-callout"><b>${esc(t('This address is on the public internet.'))}</b> ${esc(t('Prompts travel to it in the clear unless it is behind TLS, and the data no longer stays on one machine. Run AlphaCore on the same VPS, or reach the model through an SSH tunnel or WireGuard.'))}</div>` : ''}
  ${d.error && d.enabled ? `<div class="callout mk-callout">${esc(t('The model server did not answer:'))} <span class="mono">${esc(d.error)}</span></div>` : ''}
  <div class="kpis">
    ${kpi('Served locally (24 h)', share != null ? num(`${share}%`) : '—', `${num(d.share?.local || 0)} ${esc(t('of'))} ${num(d.share?.n || 0)} ${esc(t('model calls'))}`, share >= 50 ? 'ok' : '')}
    ${kpi('Speed', d.usage?.tokPerSec != null ? num(`${d.usage.tokPerSec} tok/s`) : '—', d.usage?.avgMs ? `${esc(t('average answer'))} ${num(`${Math.round(d.usage.avgMs / 1000)}s`)}` : '')}
    ${kpi('Queue', `${num(d.queue.active)} / ${num(d.queue.waiting)}`, esc(t('answering / waiting')), d.queue.waiting > 2 ? 'human' : '')}
    ${kpi('Memory', num(`${d.hardware.ramGb} GB`), `${num(d.hardware.cpus)} ${esc(t('cores'))} · ${num(`${d.hardware.freeGb} GB`)} ${esc(t('free'))}`)}
    ${kpi('Loaded now', d.loaded.length ? esc(d.loaded.map((m) => m.name).join(', ')) : '—', d.loaded[0] ? `${esc(t('stays until'))} ${esc(String(d.loaded[0].until || '').slice(11, 16))}` : '')}
  </div>
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Ask the local operator'))}</div>
      <p class="hint">${esc(t('It reads a snapshot of the company — what is waiting, what failed, the markets, the news — and answers. It does not act: what should be done comes back as a request you file.'))}</p>
      ${canAsk ? `<form id="la-ask"><label class="fl" for="la-q">${esc(t('Your question'))}</label><textarea id="la-q" rows="3" required maxlength="2000"></textarea>
        <div class="inline" style="margin-top:8px"><button class="btn btn-primary" type="submit">${esc(t('Ask'))}</button></div></form>` : ''}
      ${d.asks.map((a) => `<div class="la-ask">
        <div class="fl">${esc(a.question)}</div>
        ${a.state === 'thinking' ? `<div class="empty">${esc(t('Thinking — a small model on a small machine takes its time.'))}</div>`
    : `<p>${esc(a.answer || '')}</p>${a.proposals.map((p, i) => `<div class="la-prop"><b>${esc(p.title)}</b> <span class="sub">${esc(p.department || '')}</span><div class="sub">${esc(p.body || '')}</div>
            ${canFile ? act(`/api/localai/ask/${a.id}/file`, 'File as a request', { body: { index: i }, cls: 'btn-sm', done: 'Filed on the request desk' }) : ''}</div>`).join('')}
          <div class="hint">${esc(a.served_by || '')} · ${ago(a.created_at)} ${correctButton('local_ask', a.id)}</div>`}
      </div>`).join('')}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Configuration'))}</div>
      ${canManage ? `<form id="la-cfg" class="fields">
        <div class="wide"><label class="eng-chk"><input type="checkbox" id="la-en" ${d.enabled ? 'checked' : ''}> ${esc(t('Use the local model'))}</label>
          <label class="eng-chk"><input type="checkbox" id="la-lf" ${d.localFirst ? 'checked' : ''}> ${esc(t('Local-first: ask it before any hosted provider'))}</label></div>
        <div><label class="fl" for="la-rt">${esc(t('Which runtime answers'))}</label><select id="la-rt">${['auto', 'engine', 'ollama'].map((r) => `<option value="${r}" ${r === (d.runtimePinned || 'auto') ? 'selected' : ''}>${esc(t(r === 'auto' ? 'automatic' : r === 'engine' ? 'built-in engine' : 'Ollama'))}</option>`).join('')}</select></div>
        <div class="wide"><label class="fl" for="la-url">${esc(t('Address of the model server'))}</label><input id="la-url" class="ltr" value="${esc(d.base)}"></div>
        <div><label class="fl" for="la-t1">${esc(t('Fast work (T1)'))}</label>${sel('la-t1', d.models.T1)}</div>
        <div><label class="fl" for="la-t2">${esc(t('Drafting and analysis (T2)'))}</label>${sel('la-t2', d.models.T2)}</div>
        <div><label class="fl" for="la-t3">${esc(t('Reasoning and the operator (T3)'))}</label>${sel('la-t3', d.models.T3)}</div>
        <div><label class="fl" for="la-ctx">${esc(t('Context window (tokens)'))}</label><input id="la-ctx" type="number" min="1024" max="32768" value="${d.tuning.numCtx}"></div>
        <div><label class="fl" for="la-thr">${esc(t('Threads (0 = automatic)'))}</label><input id="la-thr" type="number" min="0" max="64" value="${d.tuning.numThread || 0}"></div>
        <div><label class="fl" for="la-ka">${esc(t('Keep loaded for'))}</label><input id="la-ka" value="${esc(d.tuning.keepAlive)}"></div>
        <div><label class="fl" for="la-cc">${esc(t('At a time'))}</label><input id="la-cc" type="number" min="1" max="4" value="${d.tuning.concurrency}"></div>
        <div><label class="fl" for="la-emb">${esc(t('Embedding model'))}</label><input id="la-emb" value="${esc(d.embedding || '')}" placeholder="nomic-embed-text"></div>
        <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button>
          <span class="hint">${esc(t('On two cores, one at a time is faster than two: two answers share the cores and both hold memory.'))}</span></div>
      </form>` : `<div class="hint">${esc(t('Read-only for you.'))}</div>`}
    </div>
  </div>
  ${eng ? enginePanel(eng, canManage) : ''}
  <div class="panel">
    <div class="panel-title">${esc(t('Installed on the server'))} <span class="hint">Ollama</span></div>
    ${d.installed.length ? `<table class="tbl"><thead><tr><th>${esc(t('Model'))}</th><th>${esc(t('Size'))}</th><th>${esc(t('Parameters'))}</th><th>${esc(t('Quantisation'))}</th><th></th></tr></thead><tbody>
      ${d.installed.map((m) => `<tr><td class="ltr">${esc(m.name)} ${d.loaded.some((l) => l.name === m.name) ? `<span class="chip chip-ok">${esc(t('loaded'))}</span>` : ''}</td><td>${num(`${m.sizeGb} GB`)}</td><td>${esc(m.params || '')}</td><td>${esc(m.quant || '')}</td>
        <td class="inline">${canManage ? `${act('/api/localai/bench', 'Benchmark', { body: { model: m.name }, cls: 'btn-sm', done: 'Benchmarked' })}
          ${act('/api/localai/warm', 'Load now', { body: { model: m.name }, cls: 'btn-sm btn-ghost', done: 'Loaded' })}
          ${act('/api/localai/remove', 'Remove', { body: { model: m.name }, cls: 'btn-sm btn-ghost', confirm: 'Delete this model from the server?' })}` : ''}</td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">${esc(t(d.reachable ? 'Nothing installed yet. Pull one from the list below.' : 'Start Ollama on the server to see what is installed.'))}</div>`}
    ${d.bench.length ? `<div class="fl" style="margin-top:12px">${esc(t('Benchmarks on this machine'))}</div>
      <table class="tbl"><tbody>${d.bench.map((b) => `<tr><td class="ltr">${esc(b.model)}</td><td>${b.ok ? num(`${b.tokens_per_sec ?? '—'} tok/s`) : `<span class="chip chip-bad">${esc(t('failed'))}</span>`}</td>
        <td class="sub">${b.prompt_per_sec ? num(`${esc(t('reads'))} ${b.prompt_per_sec} tok/s`) : esc(b.error || '')}</td><td class="sub">${ago(b.created_at)}</td></tr>`).join('')}</tbody></table>` : ''}
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('What fits on this server'))} <span class="hint">${num(`${d.hardware.ramGb} GB`)}, ${num(d.hardware.cpus)} ${esc(t('cores'))}</span></div>
    <div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Model'))}</th><th>${esc(t('Download'))}</th><th>${esc(t('Needs'))}</th><th>${esc(t('Speed on 2 cores'))}</th><th>${esc(t('Good for'))}</th><th></th></tr></thead><tbody>
    ${d.catalogue.map((c) => `<tr class="${c.fits ? '' : 'row-bad'}"><td class="ltr">${esc(c.model)}</td><td>${num(`${c.sizeGb} GB`)}</td><td>${num(`${c.ramGb} GB`)}</td><td>${num(esc(c.speed))}</td><td class="sub">${esc(t(c.use))}</td>
      <td>${c.installed ? `<span class="chip chip-ok">${esc(t('installed'))}</span>` : !c.fits ? `<span class="chip chip-bad">${esc(t('does not fit'))}</span>`
    : canManage && d.reachable ? act('/api/localai/pull', 'Download', { body: { model: c.model }, cls: 'btn-sm', done: 'Downloading — this takes a few minutes' }) : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${d.pulls.length ? `<div class="fl" style="margin-top:12px">${esc(t('Downloads'))}</div><table class="tbl"><tbody>${d.pulls.map((p) => `<tr><td class="ltr">${esc(p.model)}</td><td><span class="chip ${p.state === 'done' ? 'chip-ok' : p.state === 'failed' ? 'chip-bad' : ''}">${esc(t(p.state))}</span></td><td class="sub">${esc(p.detail || '')}</td><td class="sub">${ago(p.created_at)}</td></tr>`).join('')}</tbody></table>` : ''}
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Setting up the VPS'))}</div>
    <p class="hint">${esc(t('The whole install is one script: deploy/vps/install.sh. It adds swap, installs Node and Ollama bound to 127.0.0.1, pulls the two models that fit, and starts AlphaCore with local-first on. By hand, the model part is:'))}</p>
    <pre class="mono la-pre" dir="ltr">curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b
ollama pull qwen2.5:7b
ollama pull nomic-embed-text</pre>
  </div>`;

  wireActs(view, api, toast, renderLocalAI);
  wireCorrections(view, renderLocalAI);
  $('#la-ho')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const goingLocal = $('#la-ho-only').checked && !d.localOnly;
    if (goingLocal && !window.confirm(t('Switch off every hosted provider? All AI work will run on the local model only. The keys stay saved, so this can be switched back.'))) return;
    try {
      await api('/api/localai/config', { method: 'POST', body: {
        enabled: goingLocal ? true : undefined, localOnly: $('#la-ho-only').checked, reviewModel: $('#la-ho-rev').value,
        operatorMode: $('#la-ho-mode').value, roundHour: Number($('#la-ho-hour').value), maxActionsDay: Number($('#la-ho-max').value),
      } });
      toast(t('Saved')); renderLocalAI();
    } catch (err) { toast(err.message, true); }
  });
  $('#la-eng-url')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/localai/engine/model', { method: 'POST', body: { url: $('#la-eng-link').value, role: $('#la-eng-role').value } }); toast(t('Downloading — this takes a few minutes')); renderLocalAI(); } catch (err) { toast(err.message, true); }
  });
  $('#la-ask')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/localai/ask', { method: 'POST', body: { question: $('#la-q').value } }); renderLocalAI(); } catch (err) { toast(err.message, true); }
  });
  $('#la-cfg')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/localai/config', { method: 'POST', body: {
        enabled: $('#la-en').checked, localFirst: $('#la-lf').checked, baseUrl: $('#la-url').value, runtime: $('#la-rt').value,
        modelT1: $('#la-t1').value, modelT2: $('#la-t2').value, modelT3: $('#la-t3').value,
        numCtx: Number($('#la-ctx').value), numThread: Number($('#la-thr').value), keepAlive: $('#la-ka').value,
        concurrency: Number($('#la-cc').value), embedding: $('#la-emb').value,
      } });
      toast(t('Saved')); renderLocalAI();
    } catch (err) { toast(err.message, true); }
  });
  nightShiftPanel(options, canManage).catch(() => { /* the rest of the page stands without it */ });
}

/**
 * The night shift: heavy drafting waits for the quiet hours and the larger
 * model. Hours are stored in UTC and shown here in the reader's own clock.
 */
async function nightShiftPanel(options, canManage) {
  const n = await api('/api/localai/night');
  // Whole hours: the setting is an hour, and a half-hour zone rounds to the nearer one.
  const off = Math.round(new Date().getTimezoneOffset() / -60);
  const toLocal = (h) => ((h + off) % 24 + 24) % 24;
  const toUtc = (h) => ((h - off) % 24 + 24) % 24;
  const hours = (id, cur) => `<select id="${id}">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === cur ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>`;
  const box = document.createElement('div');
  box.className = 'panel';
  box.innerHTML = `<div class="panel-title">${esc(t('Night shift'))}</div>
    <p class="hint">${esc(t('Drafts — policies, audit programmes, gap analyses, briefs — wait for the quiet hours and are written by a larger model; questions are still answered at once by the small one. A draft that cannot wait can be written now from its page.'))}</p>
    <div class="inline"><span class="chip ${n.on ? 'chip-ok' : 'chip-dim'}">${esc(t(n.on ? 'switched on' : 'switched off'))}</span>
      <span class="sub">${n.waiting} ${esc(t('waiting for tonight'))} · ${esc(t(n.inWindow ? 'the shift is working now' : 'next shift'))} ${n.inWindow ? '' : esc(new Date(`${n.nextStart.replace(' ', 'T')}Z`).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}</span></div>
    ${n.runtime !== 'ollama' ? `<p class="sub">${esc(t('The built-in engine holds one model at a time, so here the night shift only moves the work to the quiet hours; the loaded model writes it.'))}</p>` : ''}
    ${canManage ? `<form id="ns-form" class="fields" style="margin-top:10px">
      <div class="wide"><label class="eng-chk"><input type="checkbox" id="ns-on" ${n.on ? 'checked' : ''}> ${esc(t('Use the night shift for drafts'))}</label></div>
      <div><label class="fl" for="ns-model">${esc(t('Night model'))}</label><select id="ns-model">${[...new Set([n.model, ...options])].map((m) => `<option value="${esc(m)}" ${m === n.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
      <div><label class="fl" for="ns-start">${esc(t('Starts'))}</label>${hours('ns-start', toLocal(n.start))}</div>
      <div><label class="fl" for="ns-end">${esc(t('Ends'))}</label>${hours('ns-end', toLocal(n.end))}</div>
      <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button></div></form>` : ''}`;
  view.appendChild(box);
  box.querySelector('#ns-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/localai/night', { method: 'POST', body: { on: $('#ns-on').checked, model: $('#ns-model').value, start: toUtc(Number($('#ns-start').value)), end: toUtc(Number($('#ns-end').value)) } });
      toast(t('Saved')); renderLocalAI();
    } catch (err) { toast(err.message, true); }
  });
}

// The built-in engine: llama.cpp, downloaded and run by AlphaCore itself.
function enginePanel(e, canManage) {
  const proc = (p, label) => (p ? `<span class="chip ${p.state === 'ready' ? 'chip-ok' : p.state === 'failed' || p.state === 'crashed' ? 'chip-bad' : 'chip-warn'}">${esc(t(label))}: ${esc(p.model)} · ${esc(t(p.state))}</span>` : '');
  const pctOf = (i) => (i?.total ? Math.round((i.got / i.total) * 100) : null);
  return `<div class="panel">
    <div class="panel-title">${esc(t('Built-in engine — no other program needed'))}</div>
    <p class="hint">${esc(t('AlphaCore downloads llama.cpp for this machine and GGUF model files from Hugging Face, then runs the model itself on 127.0.0.1: one model in memory, restarted if it crashes, stopped when AlphaCore stops. Ollama becomes optional.'))}</p>
    <div class="inline">
      <span class="chip ${e.binary ? 'chip-ok' : 'chip-warn'}">${e.binary ? `${esc(t('installed'))}${e.version ? ` · ${esc(e.version)}` : ''}` : esc(t('not installed'))}</span>
      <span class="chip ${e.enabled ? 'chip-ok' : ''}">${esc(t(e.enabled ? 'switched on' : 'switched off'))}</span>
      ${proc(e.chat, 'chat')} ${proc(e.embed, 'search')}
      ${e.installing ? `<span class="chip chip-warn">${esc(e.installing.state)}${pctOf(e.installing) != null ? ` · ${pctOf(e.installing)}%` : ''}</span>` : ''}
      ${canManage && e.supported && !e.installing ? act('/api/localai/engine/install', e.binary ? 'Update the engine' : 'Install the engine', { cls: e.binary ? 'btn-sm btn-ghost' : 'btn-sm btn-primary', done: 'Installed' }) : ''}
      ${canManage && e.chat ? act('/api/localai/engine/stop', 'Stop the model', { cls: 'btn-sm btn-ghost' }) : ''}
      ${canManage && e.enabled ? act('/api/localai/engine/disable', 'Switch the engine off', { cls: 'btn-sm btn-ghost', confirm: 'Stop the engine and go back to Ollama or the hosted providers?' }) : ''}
    </div>
    ${!e.supported ? `<p class="hint">${esc(t('There is no prebuilt engine for this platform. Build llama.cpp and set ENGINE_BIN to its llama-server.'))}</p>` : ''}
    <div class="mk-scroll" style="margin-top:10px"><table class="tbl"><thead><tr><th>${esc(t('Model'))}</th><th>${esc(t('Download'))}</th><th>${esc(t('Needs'))}</th><th>${esc(t('Good for'))}</th><th></th></tr></thead><tbody>
    ${e.catalogue.map((g) => {
      const m = e.models.find((x) => x.name === g.name);
      const running = (e.chat?.model === g.name) || (e.embed?.model === g.name);
      return `<tr><td class="ltr">${esc(g.name)}</td><td>${g.sizeGb} GB</td><td>${g.ramGb} GB</td><td class="sub">${esc(t(g.use))}</td>
        <td class="inline">${!m ? (canManage ? act('/api/localai/engine/model', 'Download', { body: { name: g.name }, cls: 'btn-sm', done: 'Downloading — this takes a few minutes' }) : '')
    : m.state === 'downloading' ? `<span class="chip chip-warn">${m.pct ?? 0}%</span>`
      : m.state === 'failed' ? `<span class="chip chip-bad" title="${esc(m.detail || '')}">${esc(t('failed'))}</span>${canManage ? act('/api/localai/engine/model', 'Try again', { body: { name: g.name }, cls: 'btn-sm btn-ghost' }) : ''}`
        : running ? `<span class="chip chip-ok">${esc(t('running'))}</span>`
          : canManage && e.binary ? act('/api/localai/engine/start', 'Start', { body: { name: g.name, role: g.role }, cls: 'btn-sm btn-primary', done: 'Starting — the model is loading' }) : ''}
          ${m && m.state !== 'downloading' && canManage ? act('/api/localai/engine/model/remove', 'Remove', { body: { name: g.name }, cls: 'btn-sm btn-ghost', confirm: 'Delete this model from the server?' }) : ''}</td></tr>`;
    }).join('')}
    ${e.models.filter((m) => !e.catalogue.some((g) => g.name === m.name)).map((m) => `<tr><td class="ltr">${esc(m.name)}</td><td>${m.size ? `${Math.round(m.size / 1e8) / 10} GB` : '—'}</td><td>—</td><td class="sub">${esc(t(m.role))}</td>
      <td class="inline">${m.state === 'ready' && canManage && e.binary ? act('/api/localai/engine/start', 'Start', { body: { name: m.name, role: m.role }, cls: 'btn-sm' }) : `<span class="chip">${esc(t(m.state))}${m.pct != null && m.state === 'downloading' ? ` ${m.pct}%` : ''}</span>`}
        ${canManage ? act('/api/localai/engine/model/remove', 'Remove', { body: { name: m.name }, cls: 'btn-sm btn-ghost', confirm: 'Delete this model from the server?' }) : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${canManage ? `<form id="la-eng-url" class="form-inline" style="margin-top:10px">
      <label class="fl" for="la-eng-link">${esc(t('Another model from Hugging Face (.gguf link)'))}</label>
      <input id="la-eng-link" type="url" required class="ltr" placeholder="https://huggingface.co/…/resolve/main/…Q4_K_M.gguf">
      <label class="fl" for="la-eng-role">${esc(t('For'))}</label><select id="la-eng-role"><option value="chat">${esc(t('chat'))}</option><option value="embed">${esc(t('search'))}</option></select>
      <button class="btn" type="submit">${esc(t('Download'))}</button></form>` : ''}
    ${e.chat?.log?.length ? `<details style="margin-top:10px"><summary>${esc(t('Engine log'))}</summary><pre class="mono la-pre" dir="ltr">${esc(e.chat.log.join('\n'))}</pre></details>` : ''}
  </div>`;
}

// Replacing the subscriptions, and how much of the company the local model runs.
function handoverPanel(d, options, canManage) {
  const h = d.handover || {};
  const op = d.operator || {};
  const row = (label, on, detail, href = null) => `<div class="kv"><span>${esc(t(label))}</span><b><span class="chip ${on ? 'chip-ok' : ''}">${esc(t(on ? 'on' : 'off'))}</span> <span class="sub">${detail}</span>${href ? ` <a href="${href}">${esc(t('Open'))} →</a>` : ''}</b></div>`;
  return `<div class="panel">
    <div class="panel-title">${esc(t('Replace the subscriptions — the local model runs the company'))}</div>
    <p class="hint">${esc(t('Local only switches off every hosted provider — the Claude subscription, Anthropic, OpenAI, DeepSeek, Gemini — and sends all AI work to the model on this server. The keys stay saved. What still waits for a person: money leaving, messages to people outside, publishing, signing and merges. Those are the platform’s rules, not a setting.'))}</p>
    ${row('Local only', d.localOnly, d.localOnly ? esc(t('no hosted provider is asked')) : `${esc(t('hosted providers still in use'))}: ${esc((h.hostedInUse || []).join(', ') || '—')}`)}
    ${row('Independent review', h.reviewIndependent, esc(h.reviewIndependent ? `${d.reviewModel} ${t('checks')} ${d.models?.T3}` : t('reviewers use the same model family — choose a review model from another family')))}
    ${row('Operator acts on its round', op.mode === 'act', `${op.filedToday ?? 0}/${op.maxPerDay ?? 0} ${esc(t('requests filed today'))}`)}
    ${row('Planner (Maestro)', h.maestro, esc(t('plans and dispatches work by itself')), '#/harmony')}
    ${row('Autonomy mode', h.autonomy && h.autonomy !== 'off', `${esc(t(h.autonomy || 'off'))} — ${esc(t('answers your approval queue; owner’s switch'))}`, '#/autopilot')}
    ${canManage ? `<form id="la-ho" class="fields" style="margin-top:12px">
      <div class="wide"><label class="eng-chk"><input type="checkbox" id="la-ho-only" ${d.localOnly ? 'checked' : ''}> ${esc(t('Local only: replace every subscription with the local model'))}</label></div>
      <div><label class="fl" for="la-ho-rev">${esc(t('Review model (another family)'))}</label><select id="la-ho-rev"><option value="">${esc(t('none'))}</option>${options.map((m) => `<option value="${esc(m)}" ${m === d.reviewModel ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
      <div><label class="fl" for="la-ho-mode">${esc(t('The operator'))}</label><select id="la-ho-mode">
        <option value="propose" ${op.mode !== 'act' ? 'selected' : ''}>${esc(t('proposes — you file the requests'))}</option>
        <option value="act" ${op.mode === 'act' ? 'selected' : ''}>${esc(t('acts — files its own requests'))}</option></select></div>
      <div><label class="fl" for="la-ho-hour">${esc(t('Daily round at (UTC hour, -1 for none)'))}</label><input id="la-ho-hour" type="number" min="-1" max="23" value="${op.roundHour ?? 5}"></div>
      <div><label class="fl" for="la-ho-max">${esc(t('Most requests it may file a day'))}</label><input id="la-ho-max" type="number" min="0" max="50" value="${op.maxPerDay ?? 5}"></div>
      <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button></div>
    </form>` : ''}
  </div>`;
}
