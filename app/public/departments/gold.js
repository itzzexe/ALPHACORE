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
const TFS = ['1s', '5s', '15s', '1m', '5m', '15m', '1h'];
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(`gold:${k}`)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(`gold:${k}`, JSON.stringify(v)); } catch { /* a private window */ } } };
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
    if (tab === 'terminal') return refreshTerminal();
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
  if (tab === 'terminal') await refreshTerminal();
}

// ================================================================ terminal ==

const STATIC = {
  terminal: (d, { canManage }) => {
    const ind = store.get('ind', { ema: true, bb: true, cone: true, rsi: true, macd: true, stoch: false });
    const tf = store.get('tf', '15s');
    return `
  <div id="gd-quotes" class="gd-bar"></div>
  <div class="gd-term">
    <aside class="panel gd-watch"><div class="panel-title">${esc(t('Market watch'))}</div><div id="gd-watch"></div></aside>
    <section class="panel gd-chartwrap">
      <div class="gd-tools">
        <div class="seg" role="group" aria-label="${esc(t('Timeframe'))}">${TFS.map((x) => `<button type="button" class="btn btn-sm ${x === tf ? 'btn-primary' : 'btn-ghost'}" data-tf="${x}">${x}</button>`).join('')}</div>
        <div class="inline">${[['ema', 'EMA 9/21/50'], ['bb', 'Bollinger'], ['cone', 'Forecast'], ['rsi', 'RSI'], ['macd', 'MACD'], ['stoch', 'Stochastic']].map(([k, l]) => `<label class="eng-chk"><input type="checkbox" data-ind="${k}" ${ind[k] ? 'checked' : ''}> ${esc(t(l))}</label>`).join('')}</div>
      </div>
      <div id="gd-chart"></div>
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
  view.querySelectorAll('[data-tf]').forEach((b) => b.addEventListener('click', () => {
    store.set('tf', b.dataset.tf);
    view.querySelectorAll('[data-tf]').forEach((x) => x.classList.toggle('btn-primary', x === b));
    view.querySelectorAll('[data-tf]').forEach((x) => x.classList.toggle('btn-ghost', x !== b));
    refreshTerminal();
  }));
  view.querySelectorAll('[data-ind]').forEach((b) => b.addEventListener('change', () => {
    const ind = store.get('ind', {}); ind[b.dataset.ind] = b.checked; store.set('ind', ind); refreshTerminal();
  }));
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

async function refreshTerminal() {
  const tf = store.get('tf', '15s');
  const ind = store.get('ind', { ema: true, bb: true, cone: true, rsi: true, macd: true, stoch: false });
  let d;
  try { d = await api(`/api/gold/live?tf=${encodeURIComponent(tf)}`); } catch { return; }
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
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
  set('#gd-chart', chart(d, ind, tf));
  set('#gd-tech', techPanel(d.tech));
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

/**
 * Candles, the overlays a person chose, and the forecast cone running off the
 * right edge — each horizon placed as many candles ahead as it is long, so a
 * 15-second forecast on a 15-second chart sits one candle out.
 */
function chart(d, ind, tf) {
  const cs = d.candles;
  if (cs.length < 3) return `<div class="empty">${esc(t('Not enough candles yet.'))}</div>`;
  const tfs = { '1s': 1, '5s': 5, '15s': 15, '1m': 60, '5m': 300, '15m': 900, '1h': 3600 }[tf] || 15;
  const cone = ind.cone ? d.forecasts.filter((f) => f.horizon / tfs <= 40 && f.horizon >= tfs) : [];
  const ahead = cone.length ? Math.max(...cone.map((f) => f.horizon / tfs)) + 2 : 2;
  const W = 900; const padR = 70; const H = 360; const padT = 10; const padB = 20;
  const n = cs.length + ahead;
  const bw = (W - padR) / n;
  const vals = [...cs.flatMap((c) => [c.h, c.l]), ...(ind.bb ? [...d.ind.bbUpper, ...d.ind.bbLower].filter((v) => v != null) : []), ...cone.flatMap((f) => [f.low95, f.high95])];
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1));
  const x = (i) => i * bw + bw / 2;
  const line = (arr, cls) => { let p = ''; arr.forEach((v, i) => { if (v != null) p += `${p ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; }); return p ? `<path class="${cls}" d="${p}"/>` : ''; };
  const candles = cs.map((c, i) => `<line class="tr-wick" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${y(c.h).toFixed(1)}" y2="${y(c.l).toFixed(1)}"/><rect class="${c.c >= c.o ? 'tr-up' : 'tr-down'}" x="${(x(i) - bw * 0.35).toFixed(1)}" width="${Math.max(1, bw * 0.7).toFixed(1)}" y="${y(Math.max(c.o, c.c)).toFixed(1)}" height="${Math.max(1, Math.abs(y(c.o) - y(c.c))).toFixed(1)}"/>`).join('');
  const last = cs[cs.length - 1];
  const i0 = cs.length - 1;
  let conePath = '';
  if (cone.length) {
    const pts = cone.map((f) => ({ i: i0 + f.horizon / tfs, f }));
    const band = (lk, hk, cls) => `<path class="${cls}" d="M${x(i0)} ${y(last.c)} ${pts.map((p) => `L${x(p.i).toFixed(1)} ${y(p.f[hk]).toFixed(1)}`).join(' ')} ${[...pts].reverse().map((p) => `L${x(p.i).toFixed(1)} ${y(p.f[lk]).toFixed(1)}`).join(' ')} Z"/>`;
    conePath = band('low95', 'high95', 'mk-cone95') + band('low80', 'high80', 'mk-cone80')
      + `<path class="mk-mid" d="M${x(i0)} ${y(last.c)} ${pts.map((p) => `L${x(p.i).toFixed(1)} ${y(p.f.ens).toFixed(1)}`).join(' ')}"/>`
      + pts.map((p) => `<circle class="gd-pt" cx="${x(p.i).toFixed(1)}" cy="${y(p.f.ens).toFixed(1)}" r="2.5"/><text class="mk-tick" x="${x(p.i).toFixed(1)}" y="${(y(p.f.high95) - 4).toFixed(1)}" text-anchor="middle">${hz(p.f.horizon)}</text>`).join('');
  }
  const main = `<svg direction="ltr" style="direction:ltr" class="mk-chart gd-main tr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('Gold candles with indicators and the forecast'))}" preserveAspectRatio="none">
    ${ind.bb ? line(d.ind.bbUpper, 'gd-bb') + line(d.ind.bbLower, 'gd-bb') + line(d.ind.bbMid, 'gd-bbm') : ''}
    ${candles}
    ${ind.ema ? line(d.ind.ema9, 'gd-e9') + line(d.ind.ema21, 'gd-e21') + line(d.ind.ema50, 'gd-e50') : ''}
    ${conePath}
    <line class="gd-now" x1="0" x2="${W - padR}" y1="${y(last.c).toFixed(1)}" y2="${y(last.c).toFixed(1)}"/>
    <rect class="gd-tag" x="${W - padR + 2}" y="${(y(last.c) - 9).toFixed(1)}" width="${padR - 4}" height="18" rx="3"/><text class="gd-tagt" x="${W - 6}" y="${(y(last.c) + 4).toFixed(1)}" text-anchor="end">${f2(last.c)}</text>
    <text class="mk-tick" x="${W - 6}" y="${padT + 10}" text-anchor="end">${f2(hi)}</text><text class="mk-tick" x="${W - 6}" y="${H - padB - 2}" text-anchor="end">${f2(lo)}</text>
    <text class="mk-tick" x="2" y="${H - 5}">${clock(cs[0].t)}</text><text class="mk-tick" x="${x(i0).toFixed(1)}" y="${H - 5}" text-anchor="end">${clock(last.t)}</text>
  </svg>
  <div class="mk-legend">${ind.ema ? `<span class="k-e9">EMA 9</span><span class="k-e21">EMA 21</span><span class="k-e50">EMA 50</span>` : ''}${ind.bb ? `<span class="k-sma">${esc(t('Bollinger (20, 2)'))}</span>` : ''}${cone.length ? `<span class="k-cone">${esc(t('Forecast: ensemble, 80% and 95% bands'))}</span>` : ''}</div>`;
  const sub = (name, series, { lo: a, hi: b, lines = [], bars = null } = {}) => {
    const h = 80; const all = [...series.flat().filter((v) => v != null), ...(bars || []).filter((v) => v != null), ...lines];
    const l = a ?? Math.min(...all); const u = b ?? Math.max(...all);
    const yy = (v) => 4 + (h - 8) * (1 - (v - l) / (u - l || 1));
    const ln = (arr, cls) => { let p = ''; arr.forEach((v, i) => { if (v != null) p += `${p ? 'L' : 'M'}${x(i).toFixed(1)} ${yy(v).toFixed(1)}`; }); return p ? `<path class="${cls}" d="${p}"/>` : ''; };
    const bs = bars ? bars.map((v, i) => (v == null ? '' : `<rect class="${v >= 0 ? 'tr-up' : 'tr-down'}" x="${(x(i) - bw * 0.3).toFixed(1)}" width="${Math.max(1, bw * 0.6).toFixed(1)}" y="${Math.min(yy(v), yy(0)).toFixed(1)}" height="${Math.max(0.5, Math.abs(yy(v) - yy(0))).toFixed(1)}" opacity="0.6"/>`)).join('') : '';
    return `<div class="gd-subhead sub">${esc(name)} <span class="ltr">${series.map((s) => f2(s[s.length - 1], 2)).join(' · ')}</span></div>
      <svg direction="ltr" style="direction:ltr" class="mk-chart gd-sub" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(name)}" preserveAspectRatio="none">
      ${lines.map((v) => `<line class="mk-axis" x1="0" x2="${W - padR}" y1="${yy(v).toFixed(1)}" y2="${yy(v).toFixed(1)}"/><text class="mk-tick" x="${W - 6}" y="${(yy(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}
      ${bs}${ln(series[0], 'gd-e9')}${series[1] ? ln(series[1], 'gd-e21') : ''}</svg>`;
  };
  return main
    + (ind.rsi ? sub('RSI (14)', [d.ind.rsi], { lo: 0, hi: 100, lines: [30, 70] }) : '')
    + (ind.macd ? sub('MACD (12, 26, 9)', [d.ind.macd, d.ind.macdSignal], { bars: d.ind.macdHist, lines: [0] }) : '')
    + (ind.stoch ? sub('Stochastic (14, 3)', [d.ind.stochK, d.ind.stochD], { lo: 0, hi: 100, lines: [20, 80] }) : '');
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
