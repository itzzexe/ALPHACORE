// The gold desk: a trading screen, the forecasts and their grading, the
// learning, the simulator and the paper book.
//
// The terminal mounts once and its poll replaces only the live regions — the
// quotes, the chart, the summary, the account and the tape — so a price typed
// into the order ticket is still there two seconds later. Every simulated
// figure says it is simulated, and the accuracy page leads with skill against
// "no change", because a percentage error of 0.003% sounds like genius and is
// what any forecast gets at five seconds.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t } from '/i18n.js';
import { kpi, tabs, act, wireActs, spark, ago, hashParam } from '../components/ui.js';

const num = (x) => `<span class="ltr">${x}</span>`;
const f2 = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sg = (x, d = 2) => (x == null ? '—' : `${x > 0 ? '+' : ''}${f2(x, d)}`);
const dir = (x) => (x > 0 ? 'mk-up' : x < 0 ? 'mk-down' : '');
const pct = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const hz = (h) => (h < 60 ? `${h}s` : h < 3600 ? `${h / 60}m` : `${h / 3600}h`);
const clock = (ms) => new Date(ms).toISOString().slice(11, 19);
const MODEL = { naive: 'No change', drift: 'Drift', momentum: 'Momentum', meanrev: 'Mean reversion', ar: 'Autoregression', ens: 'Ensemble' };
const TF_SEC = { '1s': 1, '5s': 5, '15s': 15, '30s': 30, '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600 };
const TFS = Object.keys(TF_SEC);
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(`gold:${k}`)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(`gold:${k}`, JSON.stringify(v)); } catch { /* a private window */ } } };

// ------------------------------------------------------------ the chart --
//
// Everything a person sets on the chart lives in one record in this browser:
// the timeframe, the drawing, the history, the indicators and their periods,
// and the levels they drew. The zoom and the scroll are this visit's only.

const TYPES = [['candles', 'Candles'], ['hollow', 'Hollow candles'], ['ha', 'Heikin Ashi'], ['bars', 'OHLC bars'], ['line', 'Line'], ['area', 'Area']];
const HEIGHTS = { s: 260, m: 380, l: 520, xl: 680 };
const IND = [['ema', 'EMA'], ['sma', 'SMA'], ['bb', 'Bollinger'], ['cone', 'Forecast'], ['pos', 'Positions'], ['levels', 'Levels'], ['rsi', 'RSI'], ['macd', 'MACD'], ['stoch', 'Stochastic'], ['cci', 'CCI'], ['wr', 'Williams %R'], ['atr', 'ATR']];
const SUBS = ['rsi', 'macd', 'stoch', 'cci', 'wr', 'atr'];
const DEF = {
  tf: '15s', type: 'candles', bars: 240, height: 'm', time: 'utc', cross: true, levels: [],
  ind: { ema: true, sma: false, bb: true, cone: true, pos: true, levels: true, rsi: true, macd: true, stoch: false, cci: false, wr: false, atr: false },
  p: { ema: [9, 21, 50], sma: 20, bb: [20, 2], rsi: 14, macd: [12, 26, 9], stoch: [14, 3], cci: 20, wr: 14, atr: 14 },
};

/** What this browser kept, held to the lists it may name — a stored value is read like an address bar's. */
function chartCfg() {
  const s = store.get('chart', null) || { tf: store.get('tf', DEF.tf), ind: store.get('ind', {}) };
  const one = (v, ok, d) => (ok.includes(v) ? v : d);
  return {
    tf: one(s.tf, TFS, DEF.tf),
    type: one(s.type, TYPES.map(([k]) => k), DEF.type),
    bars: one(Number(s.bars), [120, 240, 500], DEF.bars),
    height: one(s.height, Object.keys(HEIGHTS), DEF.height),
    time: one(s.time, ['utc', 'local'], DEF.time),
    cross: s.cross !== false,
    levels: Array.isArray(s.levels) ? s.levels.map(Number).filter(Number.isFinite).slice(0, 20) : [],
    ind: Object.fromEntries(IND.map(([k]) => [k, typeof s.ind?.[k] === 'boolean' ? s.ind[k] : DEF.ind[k]])),
    p: { ...DEF.p, ...(s.p && typeof s.p === 'object' ? s.p : {}) },
  };
}
const saveCfg = (c) => store.set('chart', c);
const query = (c) => new URLSearchParams({
  tf: c.tf, bars: String(c.bars), ema: c.p.ema.join(','), sma: String(c.p.sma), bb: c.p.bb.join(','), rsi: String(c.p.rsi),
  macd: c.p.macd.join(','), stoch: c.p.stoch.join(','), cci: String(c.p.cci), wr: String(c.p.wr), atr: String(c.p.atr),
}).toString();

const vw = { span: null, off: 0 };
let screen = null;
let hover = null;
let geo = null;
let drawing = false;
let drag = null;
let frame = 0;
let timer = null;
let inflight = false;
const redraw = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; drawChart(); }); };

// The screen keeps its own one-second clock. The console's poll stops while
// anything on a page is being typed into or differs from how it loaded — the
// right rule for a form, and the wrong one here: ticking an indicator or typing
// a stop into the ticket froze the price. Only the live regions are replaced,
// so nothing typed is lost.
function startLoop() {
  if (timer) return;
  timer = setInterval(() => {
    if (!view.querySelector('#gd-root[data-tab="terminal"]')) { clearInterval(timer); timer = null; return; }
    if (!document.hidden) refreshTerminal();
  }, 1000);
}

let sized = false;
function watchSize() {
  if (sized) return;
  sized = true;
  window.addEventListener('resize', redraw);
  document.addEventListener('fullscreenchange', redraw);
}
const srcChip = (s) => (s === 'live' ? `<span class="chip chip-ok">${esc(t('live prices'))}</span>` : `<span class="chip chip-bad">${esc(t('simulated prices'))}</span>`);
const disclaimer = () => `<p class="hint mk-disclaimer">${esc(t('Analysis and simulation, not financial advice. At a horizon of seconds gold is close to a random walk: the error in percent looks tiny because the price barely moves — skill against "no change" and the direction hit rate are the numbers that matter. Paper only; nothing here moves money.'))}</p>`;
const VERDICT_CLS = { 'strong buy': 'chip-ok', buy: 'chip-ok', neutral: '', sell: 'chip-bad', 'strong sell': 'chip-bad' };

let lastSlow = 0;

// The tab comes from the address bar, so it is matched against this list
// before it names anything: an unknown or hostile value ("constructor") is
// the terminal, never a property looked up on an object.
const TABS = ['terminal', 'forecast', 'accuracy', 'learning', 'simulator', 'settings'];
const pick = (map, tab) => (Object.prototype.hasOwnProperty.call(map, tab) ? map[tab] : null);

export async function renderGold() {
  const asked = hashParam('tab');
  const tab = TABS.includes(asked) ? asked : 'terminal';
  const root = view.querySelector('#gd-root');
  // A poll on a mounted page refreshes only what moves.
  if (root && root.dataset.tab === tab) {
    if (tab === 'terminal') return startLoop();
    if (Date.now() - lastSlow < 8000) return;
    lastSlow = Date.now();
    const d = await api('/api/gold');
    const slow = pick(SLOW, tab);
    const dyn = $('#gd-dyn'); if (dyn) dyn.innerHTML = slow ? slow(d) : '';
    return;
  }
  lastSlow = Date.now();
  const d = await api('/api/gold');
  const canManage = hasPermC('gold.manage');
  const canConfigure = hasPermC('gold.configure');
  const canFeed = hasPermC('connectors.manage');
  view.innerHTML = `<div id="gd-root" data-tab="${esc(tab)}">
  <div class="pg-head">
    <p>${esc(t('Spot gold by the second. Five models and an ensemble forecast every horizon from five seconds to an hour; every forecast is written down before its moment and graded when it comes; the ensemble re-weights itself after every grade, re-fits its error bands, and retunes its models every hour. Ask for any moment in the future, test the forecasts in the simulator, and trade them on paper.'))}</p>
    <div class="inline">${srcChip(d.source)} <span class="sub">${num(Math.floor(d.seconds / 60))} ${esc(t('minutes of one-second prices'))}</span></div>
  </div>
  ${tabs([['terminal', 'Trading screen'], ['forecast', 'Forecasts'], ['accuracy', 'Accuracy'], ['learning', 'Learning'], ['simulator', 'Simulator'], ['settings', 'Settings']], tab)}
  ${pick(STATIC, tab)?.(d, { canManage, canConfigure, canFeed }) || ''}
  <div id="gd-dyn">${tab === 'terminal' ? '' : pick(SLOW, tab)?.(d) || ''}</div>
  <div class="panel">${disclaimer()}</div></div>`;
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/gold?tab=${b.dataset.tab}`; }));
  wireActs(view, api, toast, () => { view.innerHTML = ''; renderGold(); });
  wire(tab);
  if (tab === 'terminal') { await refreshTerminal(); startLoop(); }
}

// ================================================================ terminal ==

const STATIC = {
  terminal: (d, { canManage }) => {
    const c = chartCfg();
    const sel = (key, label, opts) => `<label class="gd-sel"><span class="sub">${esc(t(label))}</span><select data-cc="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(c[key]) === String(v) ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select></label>`;
    const zb = (k, label, glyph) => `<button type="button" class="btn btn-sm btn-ghost" data-cz="${k}" aria-label="${esc(t(label))}" title="${esc(t(label))}">${glyph}</button>`;
    const pf = (k, label, v) => `<div><label class="fl" for="gp-${k}">${esc(t(label))}</label><input id="gp-${k}" data-p="${k}" class="ltr" value="${esc(Array.isArray(v) ? v.join(', ') : String(v))}"></div>`;
    return `
  <div id="gd-quotes" class="gd-bar"></div>
  <div class="gd-term">
    <aside class="panel gd-watch"><div class="panel-title">${esc(t('Market watch'))}</div><div id="gd-watch"></div></aside>
    <section class="panel gd-chartwrap" id="gd-chartwrap">
      <div class="gd-tools">
        <div class="seg" role="group" aria-label="${esc(t('Timeframe'))}">${TFS.map((x) => `<button type="button" class="btn btn-sm ${x === c.tf ? 'btn-primary' : 'btn-ghost'}" data-tf="${x}">${x}</button>`).join('')}</div>
        <div class="inline">
          ${sel('type', 'Chart type', TYPES)}
          ${sel('bars', 'History', [[120, '120 candles'], [240, '240 candles'], [500, '500 candles']])}
          ${sel('height', 'Height', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']])}
          ${sel('time', 'Time', [['utc', 'UTC'], ['local', 'Your clock']])}
        </div>
      </div>
      <div class="gd-tools">
        <div class="inline" role="group" aria-label="${esc(t('Chart controls'))}">
          ${zb('in', 'Zoom in', '+')}${zb('out', 'Zoom out', '−')}${zb('left', 'Older', '◀')}${zb('right', 'Newer', '▶')}${zb('fit', 'Show all candles', '⤢')}
          <button type="button" class="btn btn-sm btn-ghost" data-cz="cross" aria-pressed="${c.cross}">${esc(t('Crosshair'))}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-cz="draw" aria-pressed="false">${esc(t('Draw a level'))}</button>
          ${zb('full', 'Full screen', '⛶')}
          <button type="button" class="btn btn-sm btn-primary" data-cz="live" id="gd-golive" hidden>${esc(t('Back to live'))} ▶▶</button>
        </div>
        <span id="gd-tick" class="sub"></span>
      </div>
      <div class="gd-tools gd-inds" role="group" aria-label="${esc(t('Indicators'))}">${IND.map(([k, l]) => `<label class="eng-chk"><input type="checkbox" data-ind="${k}" ${c.ind[k] ? 'checked' : ''}> ${esc(t(l))}</label>`).join('')}</div>
      <details class="gd-params"><summary class="sub">${esc(t('Indicator settings'))}</summary>
        <form id="gd-params" class="fields">
          ${pf('ema', 'EMA periods (three)', c.p.ema)}${pf('sma', 'SMA period', c.p.sma)}${pf('bb', 'Bollinger: period, deviations', c.p.bb)}
          ${pf('rsi', 'RSI period', c.p.rsi)}${pf('macd', 'MACD: fast, slow, signal', c.p.macd)}${pf('stoch', 'Stochastic: %K, %D', c.p.stoch)}
          ${pf('cci', 'CCI period', c.p.cci)}${pf('wr', 'Williams %R period', c.p.wr)}${pf('atr', 'ATR period', c.p.atr)}
          <div class="wide inline"><button class="btn btn-sm btn-primary" type="submit">${esc(t('Apply'))}</button><button class="btn btn-sm btn-ghost" type="button" data-cz="pdefault">${esc(t('Standard settings'))}</button></div>
        </form>
      </details>
      <div id="gd-levels" class="inline gd-levels"></div>
      <div id="gd-readout" class="gd-readout ltr" dir="ltr"></div>
      <div id="gd-chart" class="gd-chart" dir="ltr" tabindex="0" role="group" aria-label="${esc(t('Gold chart: drag to scroll, the wheel or + and − to zoom, arrow keys to move, Home for live'))}"></div>
    </section>
    <aside class="gd-side">
      <div class="panel"><div class="panel-title">${esc(t('Order ticket'))} <span class="chip chip-dim">${esc(t('paper'))}</span></div>
        ${canManage ? `<form id="gd-ticket" class="fields">
          <div><label class="fl" for="gd-oz">${esc(t('Ounces'))}</label><input id="gd-oz" type="number" step="any" min="0.01" value="10" class="ltr"></div>
          <div><label class="fl" for="gd-exp">${esc(t('Close after (seconds, optional)'))}</label><input id="gd-exp" type="number" step="1" min="1" class="ltr"></div>
          <div><label class="fl" for="gd-sl">${esc(t('Stop loss'))}</label><input id="gd-sl" type="number" step="any" class="ltr"></div>
          <div><label class="fl" for="gd-tp">${esc(t('Take profit'))}</label><input id="gd-tp" type="number" step="any" class="ltr"></div>
          <div class="wide gd-buysell"><button type="button" class="btn gd-sell" data-side="sell">${esc(t('Sell'))} <b id="gd-bid" class="ltr">—</b></button><button type="button" class="btn gd-buy" data-side="buy">${esc(t('Buy'))} <b id="gd-ask" class="ltr">—</b></button></div>
        </form>` : `<div class="hint">${esc(t('Read-only for you.'))}</div>`}
      </div>
      <div class="panel" id="gd-acct"></div>
      <div class="panel" id="gd-tech"></div>
    </aside>
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Positions, forecasts and their grades'))}</div><div id="gd-bottom"></div></div>`;
  },
  forecast: (d, { canManage }) => `
  <div class="panel">
    <div class="panel-title">${esc(t('Ask for any moment'))}</div>
    <p class="hint">${esc(t('Up to two hours ahead the one-second ensemble answers, with the weights and settings it learned for the nearest horizon; up to five days, a drift model on one-minute prices; further, the daily model on the gold future. Every answer is graded when its moment comes.'))}</p>
    ${canManage ? `<form id="gd-ask" class="fields">
      <div class="wide"><label class="fl" for="gd-at">${esc(t('Date and time (your clock)'))}</label><input id="gd-at" type="datetime-local" step="1" required class="ltr"></div>
      <div class="wide inline">${[[30, '+30s'], [300, '+5m'], [3600, '+1h'], [86400, '+1d'], [604800, '+1w'], [2592000, '+30d']].map(([s, l]) => `<button type="button" class="btn btn-sm btn-ghost" data-plus="${s}">${l}</button>`).join('')}</div>
      <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Forecast it'))}</button></div>
    </form><div id="gd-ask-out"></div>` : `<div class="hint">${esc(t('Read-only for you.'))}</div>`}
  </div>`,
  simulator: (d, { canManage, canConfigure }) => `
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Replay the strategy'))}</div>
      <p class="hint">${esc(t('Every moment of the stored seconds, as if it were now: the ensemble forecasts, the strategy trades when the expected move clears the spread, and every model is scored on the same moments.'))}</p>
      ${canManage ? `<form id="gd-bt" class="fields">
        <div><label class="fl" for="bt-min">${esc(t('Minutes of history'))}</label><input id="bt-min" type="number" value="90" min="15" max="120" class="ltr"></div>
        <div><label class="fl" for="bt-h">${esc(t('Horizon'))}</label><select id="bt-h">${[5, 15, 30, 60, 300].map((h) => `<option value="${h}" ${h === 60 ? 'selected' : ''}>${hz(h)}</option>`).join('')}</select></div>
        <div><label class="fl" for="bt-x">${esc(t('Expected move, times the spread'))}</label><input id="bt-x" type="number" step="0.1" value="1.5" class="ltr"></div>
        <div><label class="fl" for="bt-p">${esc(t('Least confidence in the direction'))}</label><input id="bt-p" type="number" step="0.01" value="0.55" min="0.5" max="0.99" class="ltr"></div>
        <div><label class="fl" for="bt-oz">${esc(t('Ounces'))}</label><input id="bt-oz" type="number" step="any" value="10" class="ltr"></div>
        <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Run the simulation'))}</button></div>
      </form>` : ''}
    </div>
    <div class="panel"><div class="panel-title">${esc(t('The paper bot'))} ${d.config.bot ? `<span class="chip chip-ok">${esc(t('on'))}</span>` : `<span class="chip chip-dim">${esc(t('off'))}</span>`}</div>
      <p class="hint">${esc(t('The same strategy on the live tape, on paper, one trade at a time, closed at the horizon. Its record answers whether the forecasts make money after the spread.'))}</p>
      <div class="kv"><span>${esc(t('Horizon'))}</span><b>${num(hz(d.config.botHorizon))}</b></div>
      <div class="kv"><span>${esc(t('Expected move, times the spread'))}</span><b>${num(d.config.botEdgeX)}</b></div>
      <div class="kv"><span>${esc(t('Least confidence in the direction'))}</span><b>${num(d.config.botMinP)}</b></div>
      <div class="kv"><span>${esc(t('Ounces'))}</span><b>${num(d.config.botOz)}</b></div>
      ${canConfigure ? `<div class="inline" style="margin-block-start:8px">${act('/api/gold/bot', d.config.bot ? 'Switch the bot off' : 'Switch the bot on', { cls: 'btn-sm btn-human', body: { on: !d.config.bot } })}</div>` : ''}
    </div>
  </div>`,
  settings: (d, { canConfigure, canFeed }) => {
    const c = d.config;
    const f = (k, l, v, step = 'any') => `<div><label class="fl" for="gs-${k}">${esc(t(l))}</label><input id="gs-${k}" data-k="${k}" type="number" step="${step}" value="${esc(String(v))}" class="ltr" ${canConfigure ? '' : 'disabled'}></div>`;
    return `
  <div class="panel"><div class="panel-title">${esc(t('The feed'))} ${srcChip(d.source)}</div>
    <p class="hint">${esc(t('Live: Swissquote’s public bid and ask, then gold-api.com, then the gold future on Yahoo — read through the egress gate, one pass per short window. Switching drops the simulated history so the two are never read as one.'))}</p>
    ${canFeed ? `<div class="inline">${d.source === 'live' ? act('/api/gold/feed/simulated', 'Switch to the simulated tape', { cls: 'btn-sm' }) : act('/api/gold/feed/live', 'Switch to live prices', { cls: 'btn-sm btn-human', confirm: 'Read live gold prices through the gate every few seconds?' })}</div>` : ''}
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Settings'))}</div>
    <form id="gd-cfg" class="fields">
      ${f('streamSeconds', 'Seconds per feed window', c.streamSeconds, 1)}
      ${f('streamInterval', 'Seconds between quotes', c.streamInterval, 1)}
      ${f('spread', 'Spread when the feed has none ($)', c.spread)}
      ${f('leverage', 'Paper leverage', c.leverage)}
      ${f('maxOz', 'Largest trade (oz)', c.maxOz)}
      ${f('startCash', 'Paper book ($)', c.startCash)}
      ${f('botHorizon', 'Bot horizon (seconds)', c.botHorizon, 1)}
      ${f('botEdgeX', 'Bot: expected move, times the spread', c.botEdgeX)}
      ${f('botMinP', 'Bot: least confidence in the direction', c.botMinP)}
      ${f('botOz', 'Bot: ounces', c.botOz)}
      ${f('simPattern', 'Simulated tape: planted pattern (0 = pure random walk)', c.simPattern)}
      ${canConfigure ? `<div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button></div>` : ''}
    </form>
    ${canConfigure ? `<div class="inline" style="margin-block-start:10px">${act('/api/gold/reset-paper', 'Reset the paper book', { cls: 'btn-sm btn-ghost', confirm: 'Close every paper trade and reset the cash?' })}
      ${act('/api/gold/reset-learning', 'Forget what the models learned', { cls: 'btn-sm btn-ghost', confirm: 'Reset the weights, bands and tuned settings to their defaults? The scores are kept.' })}</div>` : ''}
  </div>`;
  },
};

function wire(tab) {
  if (tab === 'terminal') wireChart();
  view.querySelectorAll('#gd-ticket [data-side]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const body = { side: b.dataset.side, oz: Number($('#gd-oz').value), sl: $('#gd-sl').value || null, tp: $('#gd-tp').value || null, expiresIn: $('#gd-exp').value ? Number($('#gd-exp').value) : null };
      const tr = await api('/api/gold/trade', { method: 'POST', body });
      toast(`${t(tr.side)} ${tr.oz} oz @ ${f2(tr.open_price)}`); refreshTerminal();
    } catch (err) { toast(err.message, true); }
  }));
  const at = $('#gd-at');
  if (at) {
    const setAt = (ms) => { const d = new Date(ms); at.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
    setAt(Date.now() + 300_000);
    view.querySelectorAll('[data-plus]').forEach((b) => b.addEventListener('click', () => setAt(Date.now() + Number(b.dataset.plus) * 1000)));
    $('#gd-ask').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/gold/ask', { method: 'POST', body: { at: new Date(at.value).toISOString() } });
        $('#gd-ask-out').innerHTML = askCard(r);
      } catch (err) { toast(err.message, true); }
    });
  }
  $('#gd-bt')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      toast(t('Replaying…'));
      await api('/api/gold/backtest', { method: 'POST', body: { minutes: Number($('#bt-min').value), horizon: Number($('#bt-h').value), edgeX: Number($('#bt-x').value), minP: Number($('#bt-p').value), oz: Number($('#bt-oz').value) } });
      lastSlow = 0; const d = await api('/api/gold'); $('#gd-dyn').innerHTML = SLOW.simulator(d);
    } catch (err) { toast(err.message, true); }
  });
  $('#gd-cfg')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {}; view.querySelectorAll('#gd-cfg [data-k]').forEach((el) => { if (el.value !== '') body[el.dataset.k] = Number(el.value); });
    try { await api('/api/gold/config', { method: 'POST', body }); toast(t('Saved')); } catch (err) { toast(err.message, true); }
  });
  if (tab === 'terminal') {
    view.querySelector('#gd-bottom')?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-close]');
      if (!b) return;
      try { await api(`/api/gold/trade/${b.dataset.close}/close`, { method: 'POST', body: {} }); toast(t('Closed')); refreshTerminal(); } catch (err) { toast(err.message, true); }
    });
  }
}

const shown = new WeakMap();
/** Replace a region only when what it shows changed: a table rebuilt every second loses the text a person selected in it. */
const set = (id, html) => { const el = $(id); if (!el || shown.get(el) === html) return false; el.innerHTML = html; shown.set(el, html); return true; };

function tickNote(d) {
  const x = d.xau;
  if (!x) return '';
  const age = Math.max(0, Math.round((d.now - x.ts) / 1000));
  return `${esc(t('Last price'))} <span class="ltr">${clock(x.ts)} UTC</span> ${age > 5
    ? `<span class="chip chip-bad">${esc(t('no new price for'))} ${num(`${age}s`)}</span>`
    : `<span class="chip chip-ok">${esc(t('updating every second'))}</span>`}`;
}

async function refreshTerminal() {
  if (inflight) return;
  inflight = true;
  let d;
  try { d = await api(`/api/gold/live?${query(chartCfg())}`); } catch { return; } finally { inflight = false; }
  // The timeframe may have changed while the answer was on its way.
  if (d.tf !== chartCfg().tf || !$('#gd-chart')) return;
  screen = d;
  const x = d.xau; const s = d.xag;
  set('#gd-quotes', x ? `
    <div class="gd-q"><span class="sub">XAU/USD</span><b class="ltr gd-big">${f2(x.mid)}</b><span class="ltr ${dir(x.change)}">${sg(x.change)} (${sg(x.changePct, 3)}%)</span></div>
    <div class="gd-q"><span class="sub">${esc(t('Bid'))}</span><b class="ltr mk-down">${f2(d.quote?.bid)}</b></div>
    <div class="gd-q"><span class="sub">${esc(t('Ask price'))}</span><b class="ltr mk-up">${f2(d.quote?.ask)}</b></div>
    <div class="gd-q"><span class="sub">${esc(t('Spread'))}</span><b class="ltr">${f2(d.quote?.spread, 3)}</b></div>
    <div class="gd-q"><span class="sub">${esc(t('24h range'))}</span><b class="ltr">${f2(x.low24)} – ${f2(x.high24)}</b></div>
    <div class="gd-q"><span class="sub">XAG/USD</span><b class="ltr">${f2(s?.mid, 3)}</b><span class="ltr ${dir(s?.change)}">${sg(s?.changePct, 3)}%</span></div>
    <div class="gd-q"><span class="sub">${esc(t('Gold / silver'))}</span><b class="ltr">${f2(d.ratio)}</b></div>
    <div class="gd-q"><span class="sub">${esc(t('Price source'))}</span><b class="ltr">${esc(x.src)}</b><span class="sub ltr">${clock(x.ts)} UTC</span></div>
    ${d.streamError ? `<div class="gd-q"><span class="chip chip-bad" title="${esc(d.streamError)}">${esc(t('feed error'))}</span></div>` : ''}`
    : `<div class="empty">${esc(t('Waiting for the first price…'))}</div>`);
  set('#gd-bid', f2(d.quote?.bid)); set('#gd-ask', f2(d.quote?.ask));
  set('#gd-watch', `<table class="tbl gd-mw"><tbody>
    ${x ? `<tr><td><b>XAU/USD</b></td><td class="ltr">${f2(x.mid)}</td><td class="ltr ${dir(x.changePct)}">${sg(x.changePct, 2)}%</td></tr>` : ''}
    ${s ? `<tr><td><b>XAG/USD</b></td><td class="ltr">${f2(s.mid, 3)}</td><td class="ltr ${dir(s.changePct)}">${sg(s.changePct, 2)}%</td></tr>` : ''}
    ${d.watch.map((w) => `<tr><td>${esc(w.symbol)}</td><td class="ltr">${f2(w.price)}</td><td class="ltr ${dir(w.change_pct)}">${sg(w.change_pct, 2)}%</td></tr>`).join('')}
    </tbody></table><p class="sub">${esc(t('Others from the markets desk'))}</p>`);
  drawChart();
  set('#gd-tick', tickNote(d));
  const open = $('#gd-tech details')?.open;
  if (set('#gd-tech', techPanel(d.tech)) && open) $('#gd-tech details').open = true;
  const a = d.account;
  set('#gd-acct', `<div class="panel-title">${esc(t('Paper account'))}</div>
    <div class="kv"><span>${esc(t('Equity'))}</span><b class="ltr">${f2(a.equity)}</b></div>
    <div class="kv"><span>${esc(t('Open P&L'))}</span><b class="ltr ${dir(a.upnl)}">${sg(a.upnl)}</b></div>
    <div class="kv"><span>${esc(t('Margin used'))}</span><b class="ltr">${f2(a.margin)}</b></div>
    <div class="kv"><span>${esc(t('Free margin'))}</span><b class="ltr">${f2(a.free)}</b></div>
    <div class="kv"><span>${esc(t('Return'))}</span><b class="ltr ${dir(a.returnPct)}">${sg(a.returnPct, 3)}%</b></div>`);
  set('#gd-bottom', `
    ${a.open.length ? `<table class="tbl"><thead><tr><th>#</th><th>${esc(t('Side'))}</th><th>oz</th><th>${esc(t('Opened at'))}</th><th>${esc(t('Now'))}</th><th>SL / TP</th><th>P&amp;L</th><th>${esc(t('By'))}</th><th></th></tr></thead><tbody>
      ${a.open.map((o) => `<tr><td>${num(o.id)}</td><td><span class="chip ${o.side === 'buy' ? 'chip-ok' : 'chip-bad'}">${esc(t(o.side))}</span></td><td class="ltr">${o.oz}</td><td class="ltr">${f2(o.open_price)}</td><td class="ltr">${f2(o.price)}</td>
        <td class="ltr">${f2(o.sl)} / ${f2(o.tp)}</td><td class="ltr ${dir(o.upnl)}">${sg(o.upnl)}</td><td class="sub">${esc(t(o.source))}</td>
        <td>${o.source === 'person' && hasPermC('gold.manage') ? `<button type="button" class="btn btn-sm" data-close="${o.id}">${esc(t('Close'))}</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="sub">${esc(t('No open positions.'))}</p>`}
    <div class="split2">
      <div class="mk-scroll"><div class="fl">${esc(t('Forecasts waiting for their moment'))}</div>
        <table class="tbl"><thead><tr><th>${esc(t('Horizon'))}</th><th>${esc(t('Due'))}</th><th>${esc(t('From price'))}</th><th>${esc(t('Forecast'))}</th><th>${esc(t('Chance up'))}</th></tr></thead><tbody>
        ${d.pending.map((p) => `<tr><td>${hz(p.horizon)}</td><td class="ltr">${clock(p.due_at)}</td><td class="ltr">${f2(p.base)}</td><td class="ltr ${dir(p.ens - p.base)}">${f2(p.ens)}</td><td class="ltr">${pct(p.p_up, 0)}</td></tr>`).join('')}</tbody></table></div>
      <div class="mk-scroll gd-tape"><div class="fl">${esc(t('Just graded'))}</div>
        <table class="tbl"><thead><tr><th>${esc(t('Horizon'))}</th><th>${esc(t('Forecast'))}</th><th>${esc(t('Actual'))}</th><th>${esc(t('Error'))}</th><th>${esc(t('Direction'))}</th><th>${esc(t('Band'))}</th></tr></thead><tbody>
        ${d.tape.slice(0, 14).map((p) => `<tr><td>${hz(p.horizon)} <span class="sub ltr">${clock(p.due_at)}</span></td><td class="ltr">${f2(p.ens)}</td><td class="ltr">${f2(p.actual)}</td>
          <td class="ltr">${sg(p.err)} <span class="sub">${((Math.abs(p.err) / p.actual) * 100).toFixed(4)}%</span></td>
          <td>${p.hit == null ? '<span class="chip chip-dim">—</span>' : p.hit ? `<span class="chip chip-ok">${esc(t('right'))}</span>` : `<span class="chip chip-bad">${esc(t('wrong'))}</span>`}</td>
          <td aria-label="${esc(t(p.inside80 ? 'inside the band' : 'outside the band'))}">${p.inside80 ? '✓' : '✗'}</td></tr>`).join('')}</tbody></table></div>
    </div>`);
}

function techPanel(tech) {
  if (!tech) return `<div class="panel-title">${esc(t('Technical summary'))}</div><div class="empty">${esc(t('Not enough candles yet.'))}</div>`;
  const row = (label, v, tally) => `<div class="kv"><span>${esc(t(label))}</span><b><span class="chip ${VERDICT_CLS[v] || ''}">${esc(t(v))}</span> <span class="sub ltr">${tally.buy}/${tally.neutral}/${tally.sell}</span></b></div>`;
  return `<div class="panel-title">${esc(t('Technical summary'))}</div>
    <div class="gd-gauge"><span class="chip ${VERDICT_CLS[tech.verdict.all] || ''}">${esc(t(tech.verdict.all))}</span></div>
    ${row('Oscillators', tech.verdict.oscillators, tech.tally.oscillators)}
    ${row('Moving averages', tech.verdict.movingAverages, tech.tally.movingAverages)}
    <details><summary class="sub">${esc(t('Every indicator'))}</summary>
    <table class="tbl"><tbody>${[...tech.oscillators, ...tech.movingAverages].map((o) => `<tr><td>${esc(o.name)}</td><td class="ltr">${f2(o.value, 2)}</td><td><span class="chip ${VERDICT_CLS[o.action] || ''}">${esc(t(o.action))}</span></td></tr>`).join('')}</tbody></table></details>
    <p class="sub">${esc(t('A description of the chart, not a forecast — the accuracy page shows how little it says about the next minute.'))}</p>`;
}

/** Heikin Ashi: each candle averaged with the one before it, so a run reads as one colour. */
function heikin(cs) {
  const out = [];
  cs.forEach((k, i) => {
    const c = (k.o + k.h + k.l + k.c) / 4;
    const o = i ? (out[i - 1].o + out[i - 1].c) / 2 : (k.o + k.c) / 2;
    out.push({ ...k, o, c, h: Math.max(k.h, o, c), l: Math.min(k.l, o, c) });
  });
  return out;
}

/** Round prices for the scale: steps of 1, 2, 2.5 or 5 times a power of ten. */
function niceTicks(lo, hi, want) {
  const raw = (hi - lo) / Math.max(1, want);
  if (!(raw > 0)) return [];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function stamp(ms, tfs, c, long = false) {
  const d = new Date(ms);
  const u = c.time !== 'local';
  const p2 = (n) => String(n).padStart(2, '0');
  const hh = p2(u ? d.getUTCHours() : d.getHours());
  const mm = p2(u ? d.getUTCMinutes() : d.getMinutes());
  const ss = p2(u ? d.getUTCSeconds() : d.getSeconds());
  if (long) return `${p2((u ? d.getUTCMonth() : d.getMonth()) + 1)}-${p2(u ? d.getUTCDate() : d.getDate())} ${hh}:${mm}:${ss}`;
  return tfs < 60 ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

/**
 * The chart, drawn from the last answer, the settings and this visit's zoom.
 * It is redrawn on every price and on every movement of the pointer, so it
 * reads nothing from the server itself. The candles are placed one per slot;
 * at the live edge the forecast cone runs off the right, each horizon as many
 * candles ahead as it is long, so a 15-second forecast on a 15-second chart
 * sits one candle out.
 */
function drawChart() {
  const host = $('#gd-chart');
  if (!host) return;
  const d = screen;
  const c = chartCfg();
  const golive = $('#gd-golive');
  if (!d || d.candles.length < 3) {
    set('#gd-chart', `<div class="empty">${esc(t(d ? 'Not enough candles yet.' : 'Loading…'))}</div>`); set('#gd-readout', ''); geo = null;
    return;
  }
  const real = d.candles;
  const all = c.type === 'ha' ? heikin(real) : real;
  const len = all.length;
  const span = Math.min(len, Math.max(10, Math.round(vw.span ?? Math.min(len, 120))));
  const off = Math.min(len - span, Math.max(0, Math.round(vw.off)));
  vw.off = off;
  if (vw.span != null) vw.span = span;
  const a = len - off - span; const b = len - off;
  const cs = all.slice(a, b); const rs = real.slice(a, b);
  const cut = (arr) => (arr || []).slice(a, b);
  const I = Object.fromEntries(Object.entries(d.ind).map(([k, v]) => [k, k === 'ema' ? v.map(cut) : cut(v)]));
  const tfs = TF_SEC[d.tf] || 15;
  const atLive = off === 0;
  const cone = c.ind.cone && atLive ? d.forecasts.filter((f) => f.horizon >= tfs && f.horizon / tfs <= Math.max(8, span / 2)) : [];
  const ahead = cone.length ? Math.max(...cone.map((f) => f.horizon / tfs)) + 2 : atLive ? 3 : 1;
  const subs = SUBS.filter((k) => c.ind[k]);
  const full = Boolean(document.fullscreenElement?.contains(host));
  const W = Math.max(320, Math.round(host.clientWidth || 900));
  const H = full ? Math.max(HEIGHTS[c.height], Math.round(window.innerHeight - 300 - subs.length * 104)) : HEIGHTS[c.height];
  const padR = 78; const padT = 14; const padB = 24;
  const n = span + ahead;
  const bw = (W - padR) / n;
  const x = (i) => i * bw + bw / 2;
  const vals = [
    ...cs.flatMap((k) => [k.h, k.l]),
    ...(c.ind.bb ? [...I.bbUpper, ...I.bbLower] : []),
    ...(c.ind.ema ? I.ema.flat() : []),
    ...(c.ind.sma ? I.sma : []),
    ...cone.flatMap((f) => [f.low95, f.high95]),
  ].filter((v) => v != null && Number.isFinite(v));
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  const padV = (hi - lo) * 0.06 || 1;
  lo -= padV; hi += padV;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
  const inY = (v) => v != null && v >= lo && v <= hi;
  const P = (v) => v.toFixed(1);
  const path = (arr, cls, yy = y) => { let p = ''; arr.forEach((v, i) => { if (v != null) p += `${p ? 'L' : 'M'}${P(x(i))} ${P(yy(v))}`; }); return p ? `<path class="${cls}" d="${p}"/>` : ''; };
  const hline = (v, cls) => `<line class="${cls}" x1="0" x2="${W - padR}" y1="${P(y(v))}" y2="${P(y(v))}"/>`;
  const tag = (v, cls, label) => `<rect class="${cls}" x="${W - padR + 2}" y="${P(y(v) - 9)}" width="${padR - 4}" height="18" rx="3"/><text class="${cls}t" x="${W - 6}" y="${P(y(v) + 4)}" text-anchor="end">${label}</text>`;

  const ticks = niceTicks(lo, hi, Math.max(3, Math.round(H / 60)));
  const dec = ticks.length > 1 && ticks[1] - ticks[0] < 0.1 ? 3 : 2;
  const every = Math.max(1, Math.ceil(110 / bw));
  const grid = ticks.map((v) => `${hline(v, 'gd-grid')}<text class="mk-tick" x="${W - 6}" y="${P(y(v) + 4)}" text-anchor="end">${f2(v, dec)}</text>`).join('')
    // Labels are pinned to the clock, not to the slot, so they stay on their candle as the chart scrolls.
    + cs.map((k, i) => (Math.round(k.t / 1000 / tfs) % every === 0 ? `<line class="gd-grid" x1="${P(x(i))}" x2="${P(x(i))}" y1="${padT}" y2="${H - padB}"/><text class="mk-tick" x="${P(x(i))}" y="${H - 7}" text-anchor="middle">${stamp(k.t, tfs, c)}</text>` : '')).join('');

  let series = '';
  if (c.type === 'line' || c.type === 'area') {
    const closes = cs.map((k) => k.c);
    if (c.type === 'area') series += `<path class="gd-area" d="M${P(x(0))} ${P(y(lo))} ${closes.map((v, i) => `L${P(x(i))} ${P(y(v))}`).join(' ')} L${P(x(cs.length - 1))} ${P(y(lo))} Z"/>`;
    series += path(closes, 'gd-line');
  } else if (c.type === 'bars') {
    const tk = Math.max(1.5, bw * 0.35);
    series = cs.map((k, i) => `<path class="${k.c >= k.o ? 'gd-bar-up' : 'gd-bar-down'}" d="M${P(x(i))} ${P(y(k.h))}V${P(y(k.l))}M${P(x(i) - tk)} ${P(y(k.o))}H${P(x(i))}M${P(x(i))} ${P(y(k.c))}H${P(x(i) + tk)}"/>`).join('');
  } else {
    const hollow = c.type === 'hollow';
    series = cs.map((k, i) => {
      const up = k.c >= k.o;
      return `<line class="tr-wick" x1="${P(x(i))}" x2="${P(x(i))}" y1="${P(y(k.h))}" y2="${P(y(k.l))}"/><rect class="${up ? (hollow ? 'gd-hup' : 'tr-up') : 'tr-down'}" x="${P(x(i) - bw * 0.35)}" width="${P(Math.max(1, bw * 0.7))}" y="${P(y(Math.max(k.o, k.c)))}" height="${P(Math.max(1, Math.abs(y(k.o) - y(k.c))))}"/>`;
    }).join('');
  }

  const overlays = (c.ind.bb ? path(I.bbUpper, 'gd-bb') + path(I.bbLower, 'gd-bb') + path(I.bbMid, 'gd-bbm') : '')
    + (c.ind.sma ? path(I.sma, 'gd-sma') : '')
    + (c.ind.ema ? I.ema.map((e, j) => path(e, ['gd-e9', 'gd-e21', 'gd-e50'][j])).join('') : '');

  const lastReal = real[len - 1];
  const i0 = cs.length - 1;
  let conePath = '';
  if (cone.length) {
    const pts = cone.map((f) => ({ i: i0 + f.horizon / tfs, f }));
    const band = (lk, hk, cls) => `<path class="${cls}" d="M${P(x(i0))} ${P(y(lastReal.c))} ${pts.map((p) => `L${P(x(p.i))} ${P(y(p.f[hk]))}`).join(' ')} ${[...pts].reverse().map((p) => `L${P(x(p.i))} ${P(y(p.f[lk]))}`).join(' ')} Z"/>`;
    conePath = band('low95', 'high95', 'mk-cone95') + band('low80', 'high80', 'mk-cone80')
      + `<path class="mk-mid" d="M${P(x(i0))} ${P(y(lastReal.c))} ${pts.map((p) => `L${P(x(p.i))} ${P(y(p.f.ens))}`).join(' ')}"/>`
      + pts.map((p) => `<circle class="gd-pt" cx="${P(x(p.i))}" cy="${P(y(p.f.ens))}" r="2.5"/><text class="mk-tick" x="${P(x(p.i))}" y="${P(y(p.f.high95) - 4)}" text-anchor="middle">${hz(p.f.horizon)}</text>`).join('');
  }

  const positions = c.ind.pos ? d.account.open.flatMap((o) => [
    [o.open_price, 'tr-entry', `#${o.id} ${t(o.side)} ${o.oz} oz`], [o.sl, 'tr-stop', `SL #${o.id}`], [o.tp, 'tr-target', `TP #${o.id}`],
  ]).filter(([v]) => inY(v)).map(([v, cls, label]) => `${hline(v, cls)}<text class="mk-tick" x="4" y="${P(y(v) - 3)}">${esc(label)}</text>`).join('') : '';
  const levels = c.ind.levels ? c.levels.filter(inY).map((v) => hline(v, 'gd-level') + tag(v, 'gd-ltag', f2(v))).join('') : '';

  const h = c.cross && hover ? hover : null;
  const hi_ = h && h.i >= 0 && h.i < cs.length ? h.i : null;
  const cross = h ? `${hi_ != null ? `<line class="gd-cross" x1="${P(x(hi_))}" x2="${P(x(hi_))}" y1="${padT}" y2="${H - padB}"/><rect class="gd-ctag" x="${P(x(hi_) - 52)}" y="${H - padB + 3}" width="104" height="18" rx="3"/><text class="gd-ctagt" x="${P(x(hi_))}" y="${H - 8}" text-anchor="middle">${stamp(cs[hi_].t, tfs, c, true)}</text>` : ''}
    ${h.price != null && inY(h.price) ? hline(h.price, 'gd-cross') + tag(h.price, 'gd-ctag', f2(h.price, dec)) : ''}` : '';

  const main = `<svg class="mk-chart gd-main tr-chart" style="block-size:${H}px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t('Gold candles with indicators and the forecast'))}">
    ${grid}${overlays}${series}${conePath}${positions}${levels}
    ${atLive ? hline(lastReal.c, 'gd-now') + tag(lastReal.c, 'gd-tag', f2(lastReal.c)) : ''}
    ${cross}</svg>`;

  // The panes below share the candles' slots, so the crosshair runs through all of them.
  const p = d.params;
  const SPEC = {
    rsi: [`RSI (${p.rsi})`, [I.rsi], { lo: 0, hi: 100, lines: [30, 70] }],
    macd: [`MACD (${p.macd.join(', ')})`, [I.macd, I.macdSignal], { bars: I.macdHist, lines: [0] }],
    stoch: [`Stochastic (${p.stoch.join(', ')})`, [I.stochK, I.stochD], { lo: 0, hi: 100, lines: [20, 80] }],
    cci: [`CCI (${p.cci})`, [I.cci], { lines: [-100, 0, 100] }],
    wr: [`Williams %R (${p.wr})`, [I.willR], { lo: -100, hi: 0, lines: [-80, -20] }],
    atr: [`ATR (${p.atr})`, [I.atr], {}],
  };
  const pane = (key) => {
    const [name, series2, { lo: l0, hi: u0, lines = [], bars = null }] = SPEC[key];
    const ph = 84;
    const all2 = [...series2.flat(), ...(bars || []), ...lines].filter((v) => v != null && Number.isFinite(v));
    const l = l0 ?? Math.min(...all2); const u = u0 ?? Math.max(...all2);
    const yy = (v) => 4 + (ph - 8) * (1 - (v - l) / (u - l || 1));
    const at = hi_ ?? cs.length - 1;
    const bs = bars ? bars.map((v, i) => (v == null ? '' : `<rect class="${v >= 0 ? 'tr-up' : 'tr-down'}" x="${P(x(i) - bw * 0.3)}" width="${P(Math.max(1, bw * 0.6))}" y="${P(Math.min(yy(v), yy(0)))}" height="${P(Math.max(0.5, Math.abs(yy(v) - yy(0))))}" opacity="0.6"/>`)).join('') : '';
    return `<div class="gd-subhead sub">${esc(t(name.split(' (')[0]))} <span class="ltr">(${esc(name.split(' (')[1] || '')} ${series2.map((s) => f2(s[at], 2)).join(' · ')}</span></div>
      <svg class="mk-chart gd-sub" style="block-size:${ph}px" viewBox="0 0 ${W} ${ph}" preserveAspectRatio="none" role="img" aria-label="${esc(name)}">
      ${lines.map((v) => `<line class="mk-axis" x1="0" x2="${W - padR}" y1="${P(yy(v))}" y2="${P(yy(v))}"/><text class="mk-tick" x="${W - 6}" y="${P(yy(v) + 4)}" text-anchor="end">${v}</text>`).join('')}
      ${bs}${path(series2[0], 'gd-e9', yy)}${series2[1] ? path(series2[1], 'gd-e21', yy) : ''}
      ${hi_ != null ? `<line class="gd-cross" x1="${P(x(hi_))}" x2="${P(x(hi_))}" y1="0" y2="${ph}"/>` : ''}</svg>`;
  };

  // The readout: the candle under the pointer, or the last one — real prices even when Heikin Ashi is drawn.
  const ri = hi_ ?? cs.length - 1;
  const k = rs[ri];
  const prev = real[a + ri - 1];
  const chg = prev ? k.c - prev.c : null;
  set('#gd-readout', `<b>${stamp(k.t, tfs, c, true)}</b>
    <span>O <b>${f2(k.o)}</b></span><span>H <b>${f2(k.h)}</b></span><span>L <b>${f2(k.l)}</b></span><span>C <b>${f2(k.c)}</b></span>
    ${chg != null ? `<span class="${dir(chg)}">${sg(chg)} (${sg((chg / prev.c) * 100, 3)}%)</span>` : ''}
    ${c.ind.ema ? p.ema.map((e, j) => `<span class="r-e${j}">EMA ${e} <b>${f2(I.ema[j][ri])}</b></span>`).join('') : ''}
    ${c.ind.sma ? `<span class="r-sma">SMA ${p.sma} <b>${f2(I.sma[ri])}</b></span>` : ''}
    ${c.ind.bb ? `<span class="r-bb">BB ${p.bb.join(', ')} <b>${f2(I.bbUpper[ri])} / ${f2(I.bbLower[ri])}</b></span>` : ''}
    ${c.type === 'ha' ? `<span class="sub">${esc(t('Heikin Ashi drawn; the prices read here are the real ones'))}</span>` : ''}`);

  host.innerHTML = main + subs.map(pane).join('');
  shown.delete(host);
  host.classList.toggle('gd-drawing', drawing);
  geo = { W, H, padT, padB, padR, bw, lo, hi, span, a, len };
  if (golive) golive.hidden = atLive;
}

/** Where the pointer is, in candles and in price; null off the candles. */
function pointAt(e) {
  const svg = $('#gd-chart .gd-main');
  if (!svg || !geo) return null;
  const r = svg.getBoundingClientRect();
  const px = (e.clientX - r.left) * (geo.W / r.width);
  if (px < 0 || px > geo.W - geo.padR) return null;
  const py = (e.clientY - r.top) * (geo.H / r.height);
  const inside = py >= geo.padT && py <= geo.H - geo.padB;
  return { i: Math.floor(px / geo.bw), price: inside ? geo.lo + (1 - (py - geo.padT) / (geo.H - geo.padT - geo.padB)) * (geo.hi - geo.lo) : null };
}

/** Zoom keeps the live edge where it is; scrolled back, it keeps the candle under the pointer where it is. */
function zoom(f, at = null) {
  if (!geo) return;
  const next = Math.min(geo.len, Math.max(10, Math.round(geo.span * f)));
  if (next === geo.span) return;
  if (vw.off > 0) {
    const fr = at == null ? 0.5 : Math.min(1, Math.max(0, at / geo.span));
    vw.off = Math.round(geo.len - (geo.a + fr * (geo.span - next) + next));
  }
  vw.span = next;
  redraw();
}
const pan = (by) => { if (!geo) return; vw.off = Math.min(geo.len - geo.span, Math.max(0, vw.off + by)); redraw(); };
const step = () => Math.max(1, Math.round((geo?.span || 60) / 10));

function paintLevels() {
  const c = chartCfg();
  set('#gd-levels', c.levels.length ? `<span class="sub">${esc(t('Levels'))}</span> ${c.levels.map((v, i) => `<span class="chip">${num(f2(v))} <button type="button" class="gd-x" data-unlevel="${i}" aria-label="${esc(t('Remove level'))} ${f2(v)}">×</button></span>`).join('')}
    <button type="button" class="btn btn-sm btn-ghost" data-cz="clear">${esc(t('Clear levels'))}</button>` : '');
}

const parseNums = (s, n, lo, hi, whole = true) => {
  const xs = String(s).split(/[\s,،]+/).filter(Boolean).map(Number);
  return xs.length === n && xs.every((v) => Number.isFinite(v) && v >= lo && v <= hi && (!whole || Number.isInteger(v))) ? xs : null;
};

function wireChart() {
  watchSize();
  hover = null; drawing = false; drag = null;
  const host = $('#gd-chart');
  const wrap = $('#gd-chartwrap');
  if (!host || !wrap) return;
  paintLevels();
  const update = (fn, { refetch = false } = {}) => { const c = chartCfg(); fn(c); saveCfg(c); if (refetch) refreshTerminal(); redraw(); };

  view.querySelectorAll('[data-tf]').forEach((b) => b.addEventListener('click', () => {
    update((c) => { c.tf = b.dataset.tf; });
    view.querySelectorAll('[data-tf]').forEach((x) => { x.classList.toggle('btn-primary', x === b); x.classList.toggle('btn-ghost', x !== b); });
    vw.span = null; vw.off = 0; hover = null; screen = null;
    refreshTerminal();
  }));
  // Each control is marked as matching what was loaded once it is stored, so
  // the console does not count a chart setting as an unsaved form.
  wrap.querySelectorAll('[data-cc]').forEach((s) => s.addEventListener('change', () => {
    const k = s.dataset.cc;
    update((c) => { c[k] = k === 'bars' ? Number(s.value) : s.value; }, { refetch: k === 'bars' });
    for (const o of s.options) o.defaultSelected = o.selected;
  }));
  wrap.querySelectorAll('[data-ind]').forEach((b) => b.addEventListener('change', () => {
    update((c) => { c.ind[b.dataset.ind] = b.checked; });
    b.defaultChecked = b.checked;
  }));
  $('#gd-params')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (k) => $(`#gp-${k}`).value;
    const bbp = parseNums(v('bb'), 2, 0.5, 200, false);
    const p = {
      ema: parseNums(v('ema'), 3, 2, 200), sma: parseNums(v('sma'), 1, 2, 200)?.[0],
      bb: bbp && Number.isInteger(bbp[0]) && bbp[0] >= 2 && bbp[1] <= 4 ? bbp : null,
      rsi: parseNums(v('rsi'), 1, 2, 200)?.[0], macd: parseNums(v('macd'), 3, 2, 200), stoch: parseNums(v('stoch'), 2, 2, 200),
      cci: parseNums(v('cci'), 1, 2, 200)?.[0], wr: parseNums(v('wr'), 1, 2, 200)?.[0], atr: parseNums(v('atr'), 1, 2, 200)?.[0],
    };
    if (Object.values(p).some((x) => x == null) || p.macd[0] >= p.macd[1]) {
      toast(t('Each period is a whole number from 2 to 200, Bollinger’s deviations are from 0.5 to 4, and MACD’s fast average is shorter than its slow one.'), true);
      return;
    }
    update((c) => { c.p = p; }, { refetch: true });
    wrap.querySelectorAll('#gd-params [data-p]').forEach((el) => { el.defaultValue = el.value; });
    toast(t('Saved'));
  });

  wrap.addEventListener('click', (e) => {
    const un = e.target.closest('[data-unlevel]');
    if (un) { update((c) => { c.levels.splice(Number(un.dataset.unlevel), 1); }); paintLevels(); return; }
    const b = e.target.closest('[data-cz]');
    if (!b) return;
    const k = b.dataset.cz;
    if (k === 'in') zoom(1 / 1.25);
    else if (k === 'out') zoom(1.25);
    else if (k === 'left') pan(step());
    else if (k === 'right') pan(-step());
    else if (k === 'fit') { vw.span = geo?.len || null; vw.off = 0; redraw(); }
    else if (k === 'live') { vw.off = 0; redraw(); }
    else if (k === 'cross') { update((c) => { c.cross = !c.cross; }); b.setAttribute('aria-pressed', String(chartCfg().cross)); }
    else if (k === 'draw') { drawing = !drawing; b.setAttribute('aria-pressed', String(drawing)); host.classList.toggle('gd-drawing', drawing); if (drawing) toast(t('Click the chart where the level goes.')); }
    else if (k === 'clear') { update((c) => { c.levels = []; }); paintLevels(); }
    else if (k === 'full') { if (document.fullscreenElement) document.exitFullscreen?.(); else wrap.requestFullscreen?.().catch(() => {}); }
    else if (k === 'pdefault') {
      update((c) => { c.p = { ...DEF.p }; }, { refetch: true });
      wrap.querySelectorAll('#gd-params [data-p]').forEach((el) => { const v = DEF.p[el.dataset.p]; el.value = Array.isArray(v) ? v.join(', ') : String(v); el.defaultValue = el.value; });
    }
  });

  host.addEventListener('pointermove', (e) => {
    if (drag && geo) {
      const r = $('#gd-chart .gd-main')?.getBoundingClientRect();
      const px = r ? geo.bw * (r.width / geo.W) : geo.bw;
      vw.off = Math.min(geo.len - geo.span, Math.max(0, drag.off + Math.round((e.clientX - drag.x) / px)));
      hover = null;
      redraw();
      return;
    }
    hover = pointAt(e);
    redraw();
  });
  host.addEventListener('pointerleave', () => { hover = null; redraw(); });
  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (drawing) {
      const pt = pointAt(e);
      if (pt?.price == null) return;
      update((c) => { c.levels = [...c.levels, Math.round(pt.price * 100) / 100].slice(-20); });
      drawing = false;
      wrap.querySelector('[data-cz="draw"]')?.setAttribute('aria-pressed', 'false');
      paintLevels();
      return;
    }
    drag = { x: e.clientX, off: vw.off };
    host.setPointerCapture?.(e.pointerId);
  });
  const endDrag = () => { drag = null; };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);
  host.addEventListener('dblclick', () => { vw.span = null; vw.off = 0; redraw(); });
  host.addEventListener('wheel', (e) => {
    if (!geo) return;
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { pan(Math.sign(e.deltaX || e.deltaY) * -step()); return; }
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, pointAt(e)?.i ?? null);
  }, { passive: false });
  host.addEventListener('keydown', (e) => {
    const keys = { '+': () => zoom(1 / 1.25), '=': () => zoom(1 / 1.25), '-': () => zoom(1.25), ArrowLeft: () => pan(step()), ArrowRight: () => pan(-step()), Home: () => { vw.off = 0; redraw(); }, End: () => { vw.off = geo?.len || 0; redraw(); }, Escape: () => { drawing = false; redraw(); } };
    if (Object.hasOwn(keys, e.key)) { e.preventDefault(); keys[e.key](); }
  });
}

// ================================================================ the rest ==

function askCard(a) {
  const graded = a.actual != null;
  return `<div class="tr-levels">
    <div><span class="sub">${esc(t('For'))}</span><b class="ltr">${esc(new Date(a.target_at).toLocaleString())}</b><span class="sub ltr">${hz(a.horizon)}</span></div>
    <div><span class="sub">${esc(t('From price'))}</span><b class="ltr">${f2(a.base)}</b></div>
    <div><span class="sub">${esc(t('Forecast'))}</span><b class="ltr ${dir(a.expected - a.base)}">${f2(a.expected)}</b><span class="sub ltr">${esc(t('Chance up'))} ${pct(a.p_up, 0)}</span></div>
    <div><span class="sub">80%</span><b class="ltr">${f2(a.low80)} – ${f2(a.high80)}</b></div>
    <div><span class="sub">95%</span><b class="ltr">${f2(a.low95)} – ${f2(a.high95)}</b></div>
    ${graded ? `<div><span class="sub">${esc(t('Actual'))}</span><b class="ltr">${f2(a.actual)}</b><span class="sub ltr">${esc(t('Error'))} ${sg(a.err)} (${((Math.abs(a.err) / a.actual) * 100).toFixed(3)}%)</span></div>` : ''}
  </div>
  <p class="sub">${esc(t('Method'))}: ${esc(a.method)}${a.record?.n ? ` · ${esc(t('at'))} ${hz(a.record.horizon)} ${esc(t('over the last week'))}: ${esc(t('direction right'))} ${pct(a.record.hitRate)}, ${esc(t('skill vs no change'))} ${num(`${a.record.skillPct ?? '—'}%`)}` : ''}${a.record?.beyondData ? ` · ${esc(t('further ahead than anything the desk has graded'))}` : ''}</p>`;
}

function boardTable(board, title) {
  const rowOf = (h) => {
    const e = h.models.ens || {}; const nv = h.models.naive || {};
    return `<tr><td><b>${hz(h.horizon)}</b></td><td>${num(e.n || 0)}</td>
      <td class="ltr">${e.accuracyPct != null ? `${e.accuracyPct.toFixed(4)}%` : '—'}</td><td class="ltr">${e.mapePct != null ? `${e.mapePct.toFixed(5)}%` : '—'}</td>
      <td class="ltr">${f2(e.mae, 3)}</td><td class="ltr">${f2(nv.mae, 3)}</td>
      <td class="ltr ${dir(e.skillPct)}"><b>${e.skillPct != null ? `${sg(e.skillPct)}%` : '—'}</b></td>
      <td class="ltr ${e.hitRate > 0.5 ? 'mk-up' : e.hitRate < 0.5 ? 'mk-down' : ''}">${pct(e.hitRate)}</td>
      <td class="ltr">${pct(e.coverage80, 0)} / ${pct(e.coverage95, 0)}</td><td>${esc(t(MODEL[h.best] || '—'))}</td></tr>`;
  };
  return `<div class="panel"><div class="panel-title">${esc(t(title))}</div><div class="mk-scroll"><table class="tbl"><thead><tr>
    <th>${esc(t('Horizon'))}</th><th>${esc(t('Graded'))}</th><th>${esc(t('Accuracy (100 − error %)'))}</th><th>${esc(t('Error %'))}</th><th>${esc(t('Error $'))}</th><th>${esc(t('No-change error $'))}</th>
    <th>${esc(t('Skill vs no change'))}</th><th>${esc(t('Direction right'))}</th><th>${esc(t('Inside 80% / 95%'))}</th><th>${esc(t('Best model'))}</th></tr></thead>
    <tbody>${board.map(rowOf).join('')}</tbody></table></div>
    <details><summary class="sub">${esc(t('Every model'))}</summary>
    <table class="tbl"><thead><tr><th>${esc(t('Horizon'))}</th>${[...Object.keys(MODEL)].map((m) => `<th>${esc(t(MODEL[m]))}</th>`).join('')}</tr></thead><tbody>
    ${board.map((h) => `<tr><td>${hz(h.horizon)}</td>${Object.keys(MODEL).map((m) => { const s = h.models[m]; return `<td class="ltr">${s?.n ? `${f2(s.mae, 3)} <span class="sub">${pct(s.hitRate, 0)}${s.skillPct != null ? ` · ${sg(s.skillPct, 1)}%` : ''}</span>` : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
    <p class="sub">${esc(t('Each cell: average error in dollars, direction right, and skill against no change.'))}</p></details></div>`;
}

function curveChart(curve, label) {
  if (curve.length < 2) return `<div class="empty">${esc(t('The curve draws itself after two hours of graded forecasts.'))}</div>`;
  return `<div class="kpi"><div class="k-label">${esc(t(label))}</div>${spark(curve.map((c) => c.skillPct ?? 0))}
    <div class="sub ltr">${curve.slice(-6).map((c) => `${c.at.slice(11, 13)}h ${sg(c.skillPct, 1)}% · ${pct(c.hit, 0)}`).join(' | ')}</div></div>`;
}

const SLOW = {
  forecast: (d) => `
  <div class="panel"><div class="panel-title">${esc(t('Your questions and how they came out'))}</div>
    ${d.asks.length ? d.asks.map((a) => `<div class="gd-ask">${askCard(a)}</div>`).join('') : `<div class="empty">${esc(t('No questions yet.'))}</div>`}</div>`,
  accuracy: (d) => {
    const s60 = d.today.find((h) => h.horizon === 60)?.models.ens || {};
    const s5 = d.today.find((h) => h.horizon === 5)?.models.ens || {};
    return `
  <div class="kpis">
    ${kpi('Skill at 1 minute', s60.skillPct != null ? `<span class="${dir(s60.skillPct)}">${num(`${sg(s60.skillPct)}%`)}</span>` : '—', esc(t('error smaller than “no change” by this much')))}
    ${kpi('Direction at 1 minute', s60.hitRate != null ? num(pct(s60.hitRate)) : '—', `${num(s60.n || 0)} ${esc(t('graded'))} · ${esc(t('a coin is 50%'))}`)}
    ${kpi('Direction at 5 seconds', s5.hitRate != null ? num(pct(s5.hitRate)) : '—', `${num(s5.n || 0)} ${esc(t('graded'))}`)}
    ${kpi('Band honesty (80%)', s60.coverage80 != null ? num(pct(s60.coverage80, 0)) : '—', esc(t('should land near 80%')))}
  </div>
  ${boardTable(d.today, 'Today')}
  ${boardTable(d.week, 'Last seven days')}
  <div class="panel"><p class="hint">${esc(t('How to read this: the error in percent is always tiny at seconds, because gold moves a few cents a second — so “accuracy 99.99%” is true and means nothing. Skill is the honest measure: positive means the forecast beat “the price stays the same”; zero means it did not. Direction right is how often it called up or down correctly, against 50% for a coin. The bands are honest when about 80% and 95% of outcomes land inside them.'))}</p></div>`;
  },
  learning: (d) => `
  <div class="kpis">${curveChart(d.curve, 'Skill at 1 minute, hour by hour')}${curveChart(d.curve5, 'Skill at 5 seconds, hour by hour')}
    ${kpi('Last retuned', d.tunedAt ? ago(new Date(d.tunedAt).toISOString()) : '—', esc(t('every hour, on the last two hours')))}</div>
  <div class="panel"><div class="panel-title">${esc(t('What the ensemble trusts now'))} ${hasPermC('gold.manage') ? act('/api/gold/tune', 'Retune now', { cls: 'btn-sm' }) : ''}</div>
    <div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Horizon'))}</th>${['naive', 'drift', 'momentum', 'meanrev', 'ar'].map((m) => `<th>${esc(t(MODEL[m]))}</th>`).join('')}<th>${esc(t('Band width (80%)'))}</th><th>${esc(t('Tuned settings'))}</th></tr></thead><tbody>
    ${d.today.map((h) => `<tr><td><b>${hz(h.horizon)}</b></td>${['naive', 'drift', 'momentum', 'meanrev', 'ar'].map((m) => `<td><div class="gd-w"><i style="inline-size:${Math.round((h.weights[m] || 0) * 100)}%"></i></div><span class="sub ltr">${Math.round((h.weights[m] || 0) * 100)}%</span></td>`).join('')}
      <td class="ltr">${h.calib ? `${h.calib.k80}σ` : '1.28σ'}</td><td class="sub ltr">${esc(Object.entries(h.params || {}).map(([m, p]) => `${m}: ${Object.values(p).join('/')}`).join(' · ') || '—')}</td></tr>`).join('')}</tbody></table></div>
    <p class="sub">${esc(t('The weights move after every graded forecast toward the models that have been right lately (Hedge, with a memory that fades). The band width is re-fitted every fifty grades from the errors actually made. The settings are retuned every hour and kept only where they beat the ones in use.'))}</p></div>
  <div class="panel"><div class="panel-title">${esc(t('Learning log'))}</div>
    ${d.learning.length ? `<table class="tbl"><thead><tr><th>${esc(t('When'))}</th><th>${esc(t('What'))}</th><th>${esc(t('Horizon'))}</th><th>${esc(t('Model'))}</th><th>${esc(t('Before'))}</th><th>${esc(t('After'))}</th><th></th></tr></thead><tbody>
      ${d.learning.map((l) => `<tr><td class="sub">${ago(l.at)}</td><td>${esc(t(l.kind))}</td><td>${l.horizon ? hz(l.horizon) : '—'}</td><td>${esc(t(MODEL[l.model] || l.model || '—'))}</td><td class="ltr">${f2(l.before, 4)}</td><td class="ltr ${l.after < l.before ? 'mk-up' : ''}">${f2(l.after, 4)}</td>
        <td class="sub ltr">${esc(l.detail?.to ? JSON.stringify(l.detail.to) : l.detail?.why || '')}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('Nothing learned yet: the first retune needs forty minutes of prices.'))}</div>`}</div>`,
  simulator: (d) => {
    const bt = d.backtests;
    const res = (b) => { const r = b.result; const st = r.strategy; return `<div class="panel"><div class="panel-title">${esc(t('Simulation'))} #${num(b.id)} · ${hz(r.horizon)} · ${num(Math.round(r.seconds / 60))} ${esc(t('minutes'))} <span class="sub">${ago(b.created_at)}</span></div>
      <div class="tr-levels">
        <div><span class="sub">${esc(t('Trades'))}</span><b class="ltr">${st.trades}</b></div>
        <div><span class="sub">${esc(t('Profit after the spread'))}</span><b class="ltr ${dir(st.pnl)}">${sg(st.pnl)}</b></div>
        <div><span class="sub">${esc(t('Spread paid'))}</span><b class="ltr">${f2(st.spreadCost)}</b></div>
        <div><span class="sub">${esc(t('Winners'))}</span><b class="ltr">${pct(st.winRate)}</b></div>
        <div><span class="sub">${esc(t('Direction right'))}</span><b class="ltr">${pct(st.directionRight)}</b></div>
        <div><span class="sub">${esc(t('Holding instead'))}</span><b class="ltr ${dir(st.buyAndHold)}">${sg(st.buyAndHold)}</b></div>
      </div>${st.curve.length > 1 ? spark(st.curve) : ''}
      <table class="tbl"><thead><tr><th>${esc(t('Model'))}</th><th>${esc(t('Error $'))}</th><th>${esc(t('Direction right'))}</th><th>${esc(t('Skill vs no change'))}</th></tr></thead><tbody>
      ${Object.entries(r.models).map(([m, s]) => `<tr><td>${esc(t(MODEL[m]))}</td><td class="ltr">${f2(s.mae, 4)}</td><td class="ltr">${pct(s.hit)}</td><td class="ltr ${dir(s.skillPct)}">${s.skillPct != null ? `${sg(s.skillPct)}%` : '—'}</td></tr>`).join('')}</tbody></table></div>`; };
    return `${bt.length ? bt.slice(0, 3).map(res).join('') : `<div class="panel"><div class="empty">${esc(t('No simulation yet.'))}</div></div>`}
    <div class="panel"><div class="panel-title">${esc(t('Paper record'))}</div>
      <div class="kv"><span>${esc(t('You'))}</span><b class="ltr">${d.stats.person.n} · ${sg(d.stats.person.pnl)} · ${pct(d.stats.person.winRate)}</b></div>
      <div class="kv"><span>${esc(t('The bot'))}</span><b class="ltr">${d.stats.bot.n} · ${sg(d.stats.bot.pnl)} · ${pct(d.stats.bot.winRate)}</b></div>
      ${d.trades.length ? `<table class="tbl"><thead><tr><th>#</th><th>${esc(t('Side'))}</th><th>oz</th><th>${esc(t('Opened at'))}</th><th>${esc(t('Close'))}</th><th>${esc(t('Why'))}</th><th>P&amp;L</th><th>${esc(t('By'))}</th></tr></thead><tbody>
        ${d.trades.slice(0, 25).map((x) => `<tr><td>${num(x.id)}</td><td>${esc(t(x.side))}</td><td class="ltr">${x.oz}</td><td class="ltr">${f2(x.open_price)}</td><td class="ltr">${f2(x.close_price)}</td><td>${esc(t(x.close_reason))}</td><td class="ltr ${dir(x.pnl)}">${sg(x.pnl)}</td><td class="sub">${esc(t(x.source))}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>`;
  },
  settings: (d) => `<div class="panel"><div class="panel-title">${esc(t('Gold analyst'))} ${hasPermC('gold.manage') ? act('/api/gold/brief', 'Write the brief', { cls: 'btn-sm' }) : ''}</div>
    ${d.brief ? (d.brief.state === 'thinking' ? `<div class="hint">${esc(t('Writing…'))}</div>` : `<p class="mk-summary">${esc(d.brief.summary || '')}</p>${d.brief.body?.levels ? `<p class="sub">${esc(t('Support'))}: ${num(esc((d.brief.body.levels.support || []).join(' · ')))} — ${esc(t('Resistance'))}: ${num(esc((d.brief.body.levels.resistance || []).join(' · ')))}</p>` : ''}`) : `<div class="empty">${esc(t('No brief yet.'))}</div>`}
    ${d.pivots ? `<div class="kv"><span>${esc(t('Pivot levels (24h)'))}</span><b class="ltr">S2 ${f2(d.pivots.s2)} · S1 ${f2(d.pivots.s1)} · P ${f2(d.pivots.pivot)} · R1 ${f2(d.pivots.r1)} · R2 ${f2(d.pivots.r2)}</b></div>` : ''}</div>`,
};
