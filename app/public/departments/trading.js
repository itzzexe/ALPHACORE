// The trading floor: today's board, the journal in R, the scanner, the Time
// Machine and the desk's rules — and one page per plan, where the chart shows
// the opening range, the entry, the stop and the target before anything else.
//
// The page never says "buy". A scan hit matched a rule; a plan that passed its
// checks is waiting for a person on the portfolio desk; a closed trade is a
// number of R. Every simulated figure says it is simulated.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t } from '/i18n.js';
import { kpi, tabs, act, wireActs, spark, ago, hashParam } from '../components/ui.js';

const fmt = (p) => (p == null || !Number.isFinite(Number(p)) ? '—' : Number(p).toLocaleString('en-US', { maximumFractionDigits: Math.abs(p) < 10 ? 4 : 2, minimumFractionDigits: 2 }));
const num = (x) => `<span class="ltr">${x}</span>`;
const sgn = (x, d = 2) => (x == null ? '—' : `${x > 0 ? '+' : ''}${Number(x).toFixed(d)}`);
const dir = (x) => (x > 0 ? 'mk-up' : x < 0 ? 'mk-down' : '');
const R = (x) => (x == null ? '—' : `<span class="ltr ${dir(x)}">${sgn(x)}R</span>`);
const pctv = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const STATE_CLS = { open: 'chip-ok', proposed: 'chip-ok', triggered: 'chip-ok', refused: 'chip-bad', closed: '', expired: 'chip-dim', cancelled: 'chip-dim', watching: '' };
const stateChip = (s) => `<span class="chip ${STATE_CLS[s] || ''}">${esc(t(s))}</span>`;
const srcChip = (s) => (s === 'live' ? `<span class="chip chip-ok">${esc(t('live data'))}</span>` : `<span class="chip chip-bad">${esc(t('simulated prices'))}</span>`);
const disclaimer = () => `<p class="hint mk-disclaimer">${esc(t('Education and tooling, not financial advice. Day trading loses most people money; a passed check is a rules check, not a recommendation. Paper by default, and only a person approves an order.'))}</p>`;
const failed = (checks) => (checks?.checks || []).filter((c) => !c.ok);
const checkChips = (checks) => failed(checks).map((c) => `<span class="chip ${c.level === 'warn' ? 'chip-dim' : 'chip-bad'}" title="${esc(c.why)}">${esc(t(c.name))}</span>`).join(' ');
const oddsBar = (tm) => (tm?.pTarget == null ? '' : `<div class="tr-odds" role="img" aria-label="${esc(`${t('Target first')} ${pctv(tm.pTarget)}, ${t('stop first')} ${pctv(tm.pStop)}`)}"><span class="t" style="inline-size:${tm.pTarget * 100}%"></span><span class="n" style="inline-size:${(1 - tm.pTarget - tm.pStop) * 100}%"></span><span class="s" style="inline-size:${tm.pStop * 100}%"></span></div>`);

function clockLine(c) {
  const state = { open: t('market open'), pre: t('before the open'), post: t('after the close'), closed: t('market closed') }[c.state] || c.state;
  return `<span class="chip ${c.state === 'open' ? 'chip-ok' : 'chip-dim'}">${esc(state)}</span>
    <span class="tr-clock">${esc(t('New York'))} ${num(esc(c.ny))}</span>
    <span class="sub">${esc(t('entries'))} ${num(`${c.window.from}–${c.window.to}`)} · ${esc(t('flat by'))} ${num(c.window.flatBy)}${c.early ? ` · ${esc(t('early close'))}` : ''}</span>`;
}

// ================================================================ the floor ==

export async function renderTrading() {
  const d = await api('/api/trading');
  const canManage = hasPermC('trading.manage');
  const canConfigure = hasPermC('trading.configure');
  const tab = hashParam('tab') || 'board';
  const s = d.stats;
  const open = d.board.filter((p) => ['open', 'proposed'].includes(p.state));
  const left = Math.max(0, d.today.dailyLimit - Math.max(0, -d.today.realizedUsd) - d.today.openRiskUsd);
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Day trades from the pre-market scan to flat by the close. The numbers decide — the opening range, the trigger, the stop, the target, thousands of replays and the size; the Day Trader chooses what to watch and writes the plan; a person approves every entry on the portfolio desk, and its stop and target travel with it.'))}</p>
    <div class="inline">${srcChip(d.source)} ${clockLine(d.clock)}</div>
  </div>
  ${d.halt.halted ? `<div class="tr-banner" role="alert"><span><b>${esc(t(d.halt.by === 'breaker' ? 'Stopped for the day' : 'Halted'))}</b> — ${esc(d.halt.why)}</span>
    ${canConfigure ? act('/api/trading/resume', 'Lift the halt', { cls: 'btn-sm btn-human', confirm: 'Lift the halt? The desk will arm plans again.' }) : ''}</div>` : ''}
  <div class="kpis">
    ${kpi('Book', num(fmt(d.account.equity)), `${esc(d.account.name)}${d.account.kind === 'paper' ? ` · ${esc(t('paper'))}` : ''}`)}
    ${kpi('Today', `<span class="${dir(d.today.realizedUsd)}">${num(sgn(d.today.realizedUsd))}</span>`, `${num(d.today.entries)} / ${num(d.config.maxTradesDay)} ${esc(t('entries'))}`)}
    ${kpi('Loss left today', num(fmt(left)), `${esc(t('day limit'))} ${num(fmt(d.today.dailyLimit))} · ${esc(t('per trade'))} ${num(fmt(d.today.riskPerTrade))}`, left <= d.today.riskPerTrade ? 'bad' : '')}
    ${kpi('Expectancy', s.n ? R(s.expectancy) : '—', s.n ? `${num(s.n)} ${esc(t('trades'))} · ${num(pctv(s.winRate))} ${esc(t('winners'))}${s.small ? ` · ${esc(t('small sample'))}` : ''}` : esc(t('no closed trades yet')))}
    ${kpi('Profit factor', s.profitFactor != null ? num(s.profitFactor) : '—', s.n ? `${esc(t('max drawdown'))} ${num(`${s.maxDrawdownR}R`)}` : '')}
    <div class="kpi"><div class="k-label">${esc(t('Equity in R'))}</div>${spark(d.curve)}</div>
  </div>
  ${tabs([['board', 'Board', d.board.filter((p) => ['watching', 'triggered', 'proposed', 'open'].includes(p.state)).length], ['journal', 'Trade journal', s.n], ['scan', 'Scanner'], ['whatif', 'Time Machine'], ['rules', 'Rules']], tab)}
  <div id="tr-body">${({ board, journal, scan, whatif, rules })[tab]?.(d, { canManage, canConfigure, open }) || ''}</div>
  <div class="panel">${disclaimer()}</div>`;

  wireActs(view, api, toast, renderTrading);
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/trading?tab=${b.dataset.tab}`; }));
  $('#tr-watch')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/trading/watch', { method: 'POST', body: { symbol: $('#tr-sym').value, setup: $('#tr-setup').value, level: $('#tr-level').value ? Number($('#tr-level').value) : null, why: $('#tr-why').value } });
      toast(t('On the board — the desk watches for the trigger')); renderTrading();
    } catch (err) { toast(err.message, true); }
  });
  $('#tr-wi')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#tr-wi-out');
    out.innerHTML = `<div class="hint">${esc(t('Replaying…'))}</div>`;
    try {
      const r = await api('/api/trading/whatif', { method: 'POST', body: {
        symbol: $('#wi-sym').value, entry: Number($('#wi-entry').value), stop: $('#wi-stop').value ? Number($('#wi-stop').value) : null,
        target: $('#wi-target').value ? Number($('#wi-target').value) : null, entryAt: $('#wi-at').value || '10:00',
      } });
      out.innerHTML = tmPanel(r.tm, r.plan) + `<div class="kv"><span>${esc(t('Size at your limits'))}</span><b>${num(r.sizing.qty)} ${esc(t('shares'))} · ${esc(t('risk'))} ${num(fmt(r.sizing.riskUsd))} · ${esc(t(r.sizing.bound || ''))}</b></div>`;
    } catch (err) { out.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  });
  $('#tr-rules')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    view.querySelectorAll('#tr-rules [data-k]').forEach((el) => {
      if (el.type === 'checkbox') body[el.dataset.k] = el.checked;
      else if (el.value !== '') body[el.dataset.k] = el.dataset.text ? el.value : Number(el.value);
    });
    try { await api('/api/trading/config', { method: 'POST', body }); toast(t('Rules saved')); renderTrading(); } catch (err) { toast(err.message, true); }
  });
}

function board(d, { canManage }) {
  const rows = d.board;
  const gp = d.gameplan;
  return `
  <div class="panel">
    <div class="panel-title">${esc(t('Today’s board'))}
      ${canManage ? `<span class="inline">${act('/api/trading/halt', 'Halt the floor', { cls: 'btn-sm btn-ghost', confirm: 'Halt the trading floor? Open trades keep their stops; nothing new is armed.' })}</span>` : ''}</div>
    ${rows.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Symbol'))}</th><th>${esc(t('State'))}</th><th>${esc(t('Range'))}</th><th>${esc(t('Entry · stop · target'))}</th><th>${esc(t('Size'))}</th><th>${esc(t('Replays'))}</th><th>${esc(t('The rule here'))}</th><th>${esc(t('Result'))}</th><th></th></tr></thead><tbody>
      ${rows.map((p) => `<tr class="${p.state === 'refused' ? 'row-bad' : ''}">
        <td><a href="#/trading/${p.id}"><b>${esc(p.symbol)}</b></a> <span class="sub">${esc(t(p.setup === 'orb' ? 'opening range' : 'level'))}${p.day !== d.clock.day ? ` · ${num(p.day)}` : ''}</span>
          ${p.note ? `<div class="sub">${esc(p.note)}</div>` : ''}${checkChips(p.checks)}</td>
        <td class="tr-nw">${stateChip(p.state)}</td>
        <td>${p.or_low ? num(`${fmt(p.or_low)}–${fmt(p.or_high)}`) : p.level ? num(fmt(p.level)) : '—'}</td>
        <td>${p.entry ? `${num(fmt(p.entry))} · <span class="mk-down">${num(fmt(p.stop))}</span> · <span class="mk-up">${num(fmt(p.target))}</span>` : '—'}${p.price != null ? `<div class="sub">${esc(t('now'))} ${num(fmt(p.price))}</div>` : ''}</td>
        <td>${p.qty ? `${num(p.qty)} <div class="sub">${esc(t('risk'))} ${num(fmt(p.sizing?.riskUsd))}</div>` : '—'}</td>
        <td>${p.tm?.avgR != null ? `${R(p.tm.avgR)}${oddsBar(p.tm)}<div class="sub">${esc(t(p.tm.verdict?.head || ''))}</div>` : p.tm?.skipped ? `<span class="sub">${esc(t('skipped'))}</span>` : '—'}</td>
        <td>${p.history?.n ? `${R(p.history.expectancy)} <div class="sub">${num(p.history.n)} ${esc(t('past triggers'))}</div>` : '—'}</td>
        <td>${p.state === 'closed' ? `${R(p.r_result)}<div class="sub ${dir(p.pnl)}">${num(sgn(p.pnl))} · ${esc(t(p.exit_reason || ''))}</div>` : '—'}</td>
        <td class="inline">
          ${canManage && ['watching', 'triggered'].includes(p.state) ? act(`/api/trading/plan/${p.id}/evaluate`, 'Check now', { cls: 'btn-sm' }) : ''}
          ${p.state === 'proposed' ? `<a class="btn btn-sm btn-human" href="#/portfolio">${esc(t('Approve on the portfolio desk'))}</a>` : ''}
          ${canManage && p.state === 'open' ? act(`/api/trading/plan/${p.id}/flatten`, 'Close now', { cls: 'btn-sm', confirm: 'Close this trade now at the market?' }) : ''}
          ${canManage && ['watching', 'triggered', 'refused', 'proposed'].includes(p.state) ? act(`/api/trading/plan/${p.id}/cancel`, 'Cancel', { cls: 'btn-sm btn-ghost' }) : ''}
        </td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('Nothing on the board. Run the pre-market scan, let the Day Trader pick what to watch, or put a symbol on the board yourself.'))}</div>`}
  </div>
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('The morning plan'))} ${canManage ? act('/api/trading/gameplan', 'Write the game plan', { cls: 'btn-sm' }) : ''}</div>
      ${gp ? noteBody(gp, 'gameplan') : `<div class="empty">${esc(t('No plan yet today. The scan runs at 08:30 New York with the autopilot on; the Day Trader writes the plan from its hits.'))}</div>`}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Watch a symbol'))}</div>
      ${canManage ? `<form id="tr-watch" class="fields">
        <div><label class="fl" for="tr-sym">${esc(t('Symbol'))}</label><input id="tr-sym" required maxlength="7" class="ltr" placeholder="TSLA"></div>
        <div><label class="fl" for="tr-setup">${esc(t('Setup'))}</label><select id="tr-setup"><option value="orb">${esc(t('Opening-range breakout'))}</option><option value="level">${esc(t('Close above a level'))}</option></select></div>
        <div><label class="fl" for="tr-level">${esc(t('Level (level setup only)'))}</label><input id="tr-level" type="number" step="any" min="0" class="ltr"></div>
        <div class="wide"><label class="fl" for="tr-why">${esc(t('Why'))}</label><input id="tr-why" maxlength="1000"></div>
        <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Put it on the board'))}</button></div>
      </form>` : `<div class="hint">${esc(t('Read-only for you.'))}</div>`}
      ${d.review ? `<div class="fl" style="margin-block-start:14px">${esc(t('Last review'))} · ${num(d.review.day)}</div>${noteBody(d.review, 'review')}` : ''}
      ${canManage ? `<div class="inline" style="margin-block-start:8px">${act('/api/trading/review', 'Review today', { cls: 'btn-sm btn-ghost' })}</div>` : ''}
    </div>
  </div>`;
}

function noteBody(n, kind) {
  if (n.state === 'thinking') return `<div class="hint">${esc(t('The Day Trader is writing…'))}</div>`;
  if (n.state === 'failed') return `<div class="empty">${esc(n.summary || t('No answer came back.'))}</div>`;
  const b = n.body || {};
  if (kind === 'gameplan') {
    return `<p class="mk-summary">${esc(n.summary || '')}</p>
      ${(b.watch || []).length ? `<ul class="mk-ideas">${b.watch.map((w) => `<li><b class="ltr">${esc(w.symbol)}</b> — ${esc(w.why || '')}${w.risks ? `<div class="sub">${esc(t('Wrong if'))}: ${esc(w.risks)}</div>` : ''}</li>`).join('')}</ul>` : ''}
      ${(b.avoid || []).length ? `<div class="fl">${esc(t('Avoid today'))}</div><ul class="mk-ideas">${b.avoid.map((w) => `<li><b class="ltr">${esc(w.symbol)}</b> — ${esc(w.why || '')}</li>`).join('')}</ul>` : ''}
      <div class="sub">${esc(n.served_by || '')} · ${ago(n.created_at)}</div>`;
  }
  return `<p class="mk-summary">${esc(n.summary || '')}</p>
    ${(b.mistakes || []).length ? `<div class="fl">${esc(t('Mistakes'))}</div><ul class="mk-ideas">${b.mistakes.map((m) => `<li>${esc(typeof m === 'string' ? m : JSON.stringify(m))}</li>`).join('')}</ul>` : ''}
    ${(b.ruleChanges || []).length ? `<div class="fl">${esc(t('Proposed rule changes'))}</div><ul class="mk-ideas">${b.ruleChanges.map((r) => `<li><b>${esc(r.rule || '')}</b> — ${esc(r.why || '')}</li>`).join('')}</ul>` : ''}`;
}

function journal(d) {
  const by = (list, label) => (list.length ? `<table class="tbl"><thead><tr><th>${esc(t(label))}</th><th>${esc(t('Trades'))}</th><th>${esc(t('Winners'))}</th><th>${esc(t('Expectancy'))}</th><th>${esc(t('Profit factor'))}</th><th>${esc(t('Total'))}</th></tr></thead><tbody>
    ${list.map((b) => `<tr><td>${esc(t(b.key))}</td><td>${num(b.n)}</td><td>${num(pctv(b.winRate))}</td><td>${R(b.expectancy)}</td><td>${num(b.profitFactor ?? '—')}</td><td>${R(b.totalR)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('Nothing closed yet.'))}</div>`);
  return `
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('By setup'))}</div>${by(d.bySetup, 'Setup')}</div>
    <div class="panel"><div class="panel-title">${esc(t('By symbol'))}</div>${by(d.bySymbol, 'Symbol')}</div>
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Days'))}</div>
    ${d.daily.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Day'))}</th><th>${esc(t('Trades'))}</th><th>R</th><th>P&amp;L</th></tr></thead><tbody>
      ${d.daily.slice().reverse().map((x) => `<tr><td>${num(x.day)}</td><td>${num(x.n)}</td><td>${R(x.r)}</td><td class="${dir(x.pnl)}">${num(sgn(x.pnl))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${esc(t('Nothing closed yet.'))}</div>`}
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Every trade'))}</div>
    ${d.journal.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Day'))}</th><th>${esc(t('Symbol'))}</th><th>${esc(t('Entry · stop · target'))}</th><th>${esc(t('Exit'))}</th><th>R</th><th>P&amp;L</th></tr></thead><tbody>
      ${d.journal.map((p) => `<tr><td>${num(p.day)}</td><td><a href="#/trading/${p.id}">${esc(p.symbol)}</a></td><td>${num(`${fmt(p.entry)} · ${fmt(p.stop)} · ${fmt(p.target)}`)}</td>
        <td>${num(fmt(p.exit_price))} <span class="sub">${esc(t(p.exit_reason || ''))}</span></td><td>${R(p.r_result)}</td><td class="${dir(p.pnl)}">${num(sgn(p.pnl))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${esc(t('Nothing closed yet.'))}</div>`}
  </div>`;
}

function scan(d, { canManage }) {
  const daily = d.scans.find((x) => x.mode === 'daily');
  const orb = d.scans.find((x) => x.mode === 'orb');
  const hitsTable = (sc) => (sc?.hits?.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Symbol'))}</th><th>${esc(t(sc.mode === 'orb' ? 'Breakout' : 'Matched'))}</th><th>${esc(t(sc.mode === 'orb' ? 'Range' : 'RSI'))}</th><th></th></tr></thead><tbody>
    ${sc.hits.slice(0, 40).map((h) => `<tr><td><b class="ltr">${esc(h.symbol)}</b>${h.name ? ` <span class="sub">${esc(h.name)}</span>` : ''}</td>
      <td>${sc.mode === 'orb' ? `${num(fmt(h.price))} <span class="sub">${num(`+${h.pctOver}%`)}${h.volumeX ? ` · ${num(`${h.volumeX}×`)} ${esc(t('volume'))}` : ''}</span>` : (h.tags || []).map((x) => `<span class="chip">${esc(t(x))}</span>`).join(' ')}</td>
      <td>${sc.mode === 'orb' ? num(`${fmt(h.orLow)}–${fmt(h.orHigh)}`) : num(h.rsi ?? '—')}</td>
      <td>${canManage ? act('/api/trading/watch', 'Watch', { cls: 'btn-sm', body: { symbol: h.symbol, setup: 'orb', why: sc.mode === 'orb' ? 'opening-range scan' : `pre-market scan: ${(h.tags || []).join(', ')}` } }) : ''}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('No hits.'))}</div>`);
  return `
  <div class="panel">
    <div class="panel-title">${esc(t('Pre-market scan'))} ${canManage ? act('/api/trading/scan', 'Scan the universe', { cls: 'btn-sm', body: { mode: 'daily' } }) : ''}</div>
    <p class="hint">${esc(t('Daily closes for the universe, five rules each: a 20-day breakout, a bull flag, a reclaim of the 20-day average, oversold, and an oversold bounce. A hit matched a rule — it is a reason to watch the open, not a buy.'))}</p>
    ${daily ? `<div class="sub">${num(daily.day)} · ${num(daily.scanned)} ${esc(t('scanned'))}${daily.failed ? ` · ${num(daily.failed)} ${esc(t('failed'))}` : ''} · ${esc(t(daily.source))} · ${ago(daily.created_at)}</div>${hitsTable(daily)}` : ''}
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Opening-range scan'))} ${canManage ? act('/api/trading/scan', 'Scan for breakouts', { cls: 'btn-sm', body: { mode: 'orb' } }) : ''}</div>
    <p class="hint">${esc(t('After the range closes: which symbols have already closed a five-minute bar above their opening range. The daily hits are read first.'))}</p>
    ${orb ? `<div class="sub">${num(orb.day)} · ${num(orb.scanned)} ${esc(t('scanned'))} · ${ago(orb.created_at)}</div>${hitsTable(orb)}` : ''}
  </div>`;
}

function whatif(d, { canManage }) {
  return `
  <div class="panel">
    <div class="panel-title">${esc(t('Time Machine'))}</div>
    <p class="hint">${esc(t('A plan you are thinking about, replayed thousands of times through bars borrowed from the same time of day in the last sixty sessions. The stop is checked before the target inside every bar, so a bar that touches both counts as the loss.'))}</p>
    ${canManage ? `<form id="tr-wi" class="fields">
      <div><label class="fl" for="wi-sym">${esc(t('Symbol'))}</label><input id="wi-sym" required maxlength="7" class="ltr"></div>
      <div><label class="fl" for="wi-entry">${esc(t('Entry'))}</label><input id="wi-entry" type="number" step="any" min="0" required class="ltr"></div>
      <div><label class="fl" for="wi-stop">${esc(t('Stop (empty: 1% under)'))}</label><input id="wi-stop" type="number" step="any" min="0" class="ltr"></div>
      <div><label class="fl" for="wi-target">${esc(t('Target (empty: the desk’s R)'))}</label><input id="wi-target" type="number" step="any" min="0" class="ltr"></div>
      <div><label class="fl" for="wi-at">${esc(t('Entry time, New York'))}</label><input id="wi-at" value="10:00" class="ltr" maxlength="5"></div>
      <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Replay it'))}</button></div>
    </form>` : `<div class="hint">${esc(t('Read-only for you.'))}</div>`}
    <div id="tr-wi-out"></div>
  </div>`;
}

function tmPanel(tm, plan) {
  if (!tm || tm.skipped) return `<div class="empty">${esc(tm?.skipped || t('No replay.'))}</div>`;
  return `<div class="tr-levels">
      ${plan ? `<div><span class="sub">${esc(t('Entry'))}</span><b class="ltr">${fmt(plan.entry)}</b></div><div><span class="sub">${esc(t('Stop'))}</span><b class="ltr mk-down">${fmt(plan.stop)}</b></div><div><span class="sub">${esc(t('Target'))}</span><b class="ltr mk-up">${fmt(plan.target)}</b></div>` : ''}
      <div><span class="sub">${esc(t('Target first'))}</span><b class="ltr">${pctv(tm.pTarget)}</b></div>
      <div><span class="sub">${esc(t('Stop first'))}</span><b class="ltr">${pctv(tm.pStop)}</b></div>
      <div><span class="sub">${esc(t('Neither by the flat-by time'))}</span><b class="ltr">${pctv(tm.pNeither)}</b></div>
      <div><span class="sub">${esc(t('Average R'))}</span><b>${R(tm.avgR)}</b></div>
    </div>
    ${oddsBar(tm)}
    <p><b>${esc(t(tm.verdict?.head || ''))}</b>${tm.verdict?.share != null ? ` — <span class="sub">${esc(t('to break even at'))} ${num(`${tm.rAtTarget}R`)} ${esc(t('the target must come first in'))} ${num(pctv(tm.verdict.breakEven))} ${esc(t('of the replays that reach a side; it did in'))} ${num(pctv(tm.verdict.share))}</span>` : ''}</p>
    ${tm.pNeither > 0.25 ? `<p class="sub">${esc(t('Many replays reach neither level by the flat-by time; the closing price decides those.'))}</p>` : ''}
    ${tm.verdict?.lean && Math.abs(tm.verdict.lean) >= 0.05 && tm.avgR && (tm.avgR > 0) !== (tm.verdict.lean > 0) ? `<p class="sub">${esc(t('The average R points the other way: the replays that reach neither level pull it.'))}</p>` : ''}
    <div class="sub">${num(tm.replays)} ${esc(t('replays'))} · ${num(tm.sessions)} ${esc(t('sessions'))} · ${esc(t('closing price'))} ${num(`${fmt(tm.p5)} / ${fmt(tm.median)} / ${fmt(tm.p95)}`)} (5% / 50% / 95%)</div>`;
}

function rules(d, { canConfigure }) {
  const c = d.config;
  const field = (k, label, v, step = 'any') => `<div><label class="fl" for="cf-${k}">${esc(t(label))}</label><input id="cf-${k}" data-k="${k}" type="number" step="${step}" value="${esc(String(v))}" class="ltr" ${canConfigure ? '' : 'disabled'}></div>`;
  const text = (k, label, v) => `<div><label class="fl" for="cf-${k}">${esc(t(label))}</label><input id="cf-${k}" data-k="${k}" data-text="1" value="${esc(String(v))}" class="ltr" ${canConfigure ? '' : 'disabled'}></div>`;
  const box = (k, label, v) => `<div class="wide"><label class="eng-chk"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''} ${canConfigure ? '' : 'disabled'}> ${esc(t(label))}</label></div>`;
  return `
  <div class="panel">
    <div class="panel-title">${esc(t('The desk’s rules'))}</div>
    <p class="hint">${esc(t('Losses are a share of the book, so the same rules fit a small account and a large one. The order and position limits can only be tighter than the portfolio’s own.'))}</p>
    <form id="tr-rules" class="fields">
      ${field('riskPct', 'Risk a trade (% of the book)', c.riskPct)}
      ${field('maxLossUsd', 'Largest loss a trade ($)', c.maxLossUsd)}
      ${field('maxDailyLossPct', 'Stop for the day at a loss of (% of the book)', c.maxDailyLossPct)}
      ${field('maxTradesDay', 'Entries a day', c.maxTradesDay, 1)}
      ${field('maxConsecLosses', 'Stop after losses in a row', c.maxConsecLosses, 1)}
      ${field('minRR', 'Least reward to risk (R)', c.minRR)}
      ${field('targetR', 'Target (R)', c.targetR)}
      ${field('orMinutes', 'Opening range (minutes)', c.orMinutes, 5)}
      <div><label class="fl" for="cf-stopRule">${esc(t('Stop'))}</label><select id="cf-stopRule" data-k="stopRule" data-text="1" ${canConfigure ? '' : 'disabled'}>
        ${['or-mid', 'or-low', 'atr:1', 'atr:1.5', 'atr:2'].map((r) => `<option value="${r}" ${r === c.stopRule ? 'selected' : ''}>${esc(t(r))}</option>`).join('')}</select></div>
      ${field('minVolumeX', 'Breakout volume, times the range (0: off)', c.minVolumeX)}
      ${field('maxChaseBps', 'Largest chase over the trigger (bps)', c.maxChaseBps)}
      ${field('cashBufferPct', 'Cash kept back (%)', c.cashBufferPct)}
      ${text('noEntriesBefore', 'No entries before', c.noEntriesBefore)}
      ${text('noEntriesAfter', 'No entries after', c.noEntriesAfter)}
      ${text('flatBy', 'Flat by', c.flatBy)}
      ${field('maxWatch', 'Symbols the Day Trader may watch', c.maxWatch, 1)}
      ${box('requireEdge', 'Refuse a plan whose replays and past triggers both lose on average', c.requireEdge)}
      ${box('autoPilot', 'Autopilot: scan before the open, let the Day Trader put its picks on the board, review after the close', c.autoPilot)}
      ${box('pdtGuard', 'Pattern-day-trader guard (three day trades in five sessions under $25,000)', c.pdtGuard)}
      <div class="wide"><label class="fl" for="cf-universe">${esc(t('Universe'))}</label><textarea id="cf-universe" data-k="universe" data-text="1" rows="3" class="ltr" ${canConfigure ? '' : 'disabled'}>${esc(c.universe.join(', '))}</textarea></div>
      <div class="wide"><label class="fl" for="cf-blocked">${esc(t('Never trade'))}</label><input id="cf-blocked" data-k="blocked" data-text="1" class="ltr" value="${esc(c.blocked.join(', '))}" ${canConfigure ? '' : 'disabled'}></div>
      ${canConfigure ? `<div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Save the rules'))}</button></div>` : ''}
    </form>
  </div>
  <div class="panel">
    <div class="panel-title">${esc(t('Where the prices and the orders come from'))}</div>
    <div class="kv"><span>${esc(t('Prices'))}</span><b>${esc(t(d.source === 'live' ? 'live: the markets desk’s feed' : 'simulated — switch the markets desk to live data'))}</b></div>
    <div class="kv"><span>${esc(t('Five-minute bars'))}</span><b>${esc(d.broker?.state === 'live' ? 'Alpaca IEX → Yahoo Finance → Twelve Data' : 'Yahoo Finance → Twelve Data')}</b></div>
    <div class="kv"><span>${esc(t('Orders'))}</span><b>${esc(d.account.kind === 'paper' ? t('the paper book') : d.account.name)}</b></div>
    <p class="hint">${esc(t('Connect Alpaca on the portfolio desk for its free paper account: real market hours, real fills, bracket orders, and its own five-minute bars. Real money is a separate, typed decision.'))}</p>
  </div>`;
}

// ================================================================= one plan ==

function planChart(p) {
  const bars = p.bars || [];
  if (bars.length < 2) return `<div class="empty">${esc(t('No bars for this session yet.'))}</div>`;
  const W = 760; const H = 300; const padL = 8; const padR = 64; const padT = 10; const padB = 20;
  const levels = [p.stop, p.target, p.entry, p.or_high, p.or_low].filter((x) => Number.isFinite(x));
  const lo = Math.min(...bars.map((b) => b.l), ...levels); const hi = Math.max(...bars.map((b) => b.h), ...levels);
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1));
  const n = 78; const bw = (W - padL - padR) / n;
  const x = (min) => padL + ((min - 570) / 5) * bw;
  const candles = bars.map((b) => `<line class="tr-wick" x1="${(x(b.min) + bw / 2).toFixed(1)}" x2="${(x(b.min) + bw / 2).toFixed(1)}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}"/>
    <rect class="${b.c >= b.o ? 'tr-up' : 'tr-down'}" x="${(x(b.min) + 1).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" y="${y(Math.max(b.o, b.c)).toFixed(1)}" height="${Math.max(1, Math.abs(y(b.o) - y(b.c))).toFixed(1)}"/>`).join('');
  let pv = 0; let vol = 0;
  const vw = bars.map((b) => { pv += ((b.h + b.l + b.c) / 3) * (b.v || 0); vol += b.v || 0; return vol ? pv / vol : b.c; });
  const vwPath = vw.map((v, i) => `${i ? 'L' : 'M'}${(x(bars[i].min) + bw / 2).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const hl = (v, cls, label) => (Number.isFinite(v) ? `<line class="${cls}" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="mk-tick" x="${W - 4}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(label)} ${esc(fmt(v))}</text>` : '');
  const orBand = p.or_high && p.or_low ? `<rect class="tr-or" x="${padL}" width="${W - padL - padR}" y="${y(p.or_high).toFixed(1)}" height="${Math.max(1, y(p.or_low) - y(p.or_high)).toFixed(1)}"/>` : '';
  const k = p.entry_at ? (Number(p.entry_at.slice(11, 13)) * 60 + Number(p.entry_at.slice(14, 16)) - 570) / 5 : null;
  const paths = k != null && p.tm?.paths?.length ? p.tm.paths.slice(0, 16).map((path) => path.map((v, i) => `${i ? 'L' : 'M'}${(padL + (k + i) * bw).toFixed(1)} ${y(Math.min(hi, Math.max(lo, v))).toFixed(1)}`).join(' ')).map((d) => `<path class="tr-path" d="${d}"/>`).join('') : '';
  // Prices and times read left to right in either language; an RTL page would
  // otherwise anchor every label from the wrong end and clip it.
  return `<svg direction="ltr" style="direction:ltr" class="mk-chart tr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${p.symbol} ${p.day}: ${t('five-minute bars with the opening range, entry, stop and target')}`)}" preserveAspectRatio="none">
    ${orBand}${paths}${candles}<path class="tr-vwap" d="${vwPath}"/>
    ${hl(p.target, 'tr-target', t('target'))}${hl(p.entry, 'tr-entry', t('entry'))}${hl(p.stop, 'tr-stop', t('stop'))}
    <text class="mk-tick" x="${padL}" y="${H - 5}">09:30</text><text class="mk-tick" x="${W - padR}" y="${H - 5}" text-anchor="end">16:00</text>
  </svg>
  <div class="mk-legend"><span class="k-cone">${esc(t('Opening range'))}</span><span class="k-sma">${esc(t('VWAP'))}</span>${paths ? `<span class="k-line">${esc(t('Sample replays'))}</span>` : ''}</div>`;
}

export async function renderTradePlan(id) {
  const p = await api(`/api/trading/plan/${encodeURIComponent(id)}`);
  const canManage = hasPermC('trading.manage');
  const checks = p.checks?.checks || [];
  view.innerHTML = `
  <div class="mk-hero"><div><a href="#/trading" class="sub">← ${esc(t('Trading floor'))}</a><h2 class="ltr">${esc(p.symbol)}</h2>
    <span class="sub">${num(p.day)} · ${esc(t(p.setup === 'orb' ? 'opening range' : 'level'))} · ${esc(p.created_by)}</span></div>
    <div class="inline">${stateChip(p.state)}
      ${canManage && ['watching', 'triggered'].includes(p.state) ? act(`/api/trading/plan/${p.id}/evaluate`, 'Check now', { cls: 'btn-sm' }) : ''}
      ${p.state === 'proposed' ? `<a class="btn btn-sm btn-human" href="#/portfolio">${esc(t('Approve on the portfolio desk'))}</a>` : ''}
      ${canManage && p.state === 'open' ? act(`/api/trading/plan/${p.id}/flatten`, 'Close now', { cls: 'btn-sm', confirm: 'Close this trade now at the market?' }) : ''}</div></div>
  ${p.note ? `<p class="hint">${esc(p.note)}</p>` : ''}
  <div class="tr-levels">
    <div><span class="sub">${esc(t('Opening range'))}</span><b class="ltr">${p.or_low ? `${fmt(p.or_low)}–${fmt(p.or_high)}` : '—'}</b></div>
    <div><span class="sub">${esc(t('Entry'))}</span><b class="ltr">${fmt(p.entry)}</b><span class="sub ltr">${esc(String(p.entry_at || '').slice(11))}</span></div>
    <div><span class="sub">${esc(t('Stop'))}</span><b class="ltr mk-down">${fmt(p.stop)}</b><span class="sub">${esc(t(p.stop_rule || ''))}</span></div>
    <div><span class="sub">${esc(t('Target'))}</span><b class="ltr mk-up">${fmt(p.target)}</b><span class="sub ltr">${p.target_r ? `${p.target_r}R` : ''}</span></div>
    <div><span class="sub">${esc(t('Size'))}</span><b class="ltr">${p.qty ?? '—'}</b><span class="sub">${p.sizing ? `${esc(t('bound by'))} ${esc(t(p.sizing.bound || ''))}` : ''}</span></div>
    <div><span class="sub">${esc(t('Loss if stopped'))}</span><b class="ltr">${fmt(p.sizing?.riskUsd)}</b></div>
    ${p.state === 'closed' ? `<div><span class="sub">${esc(t('Result'))}</span><b>${R(p.r_result)}</b><span class="sub ltr ${dir(p.pnl)}">${sgn(p.pnl)} · ${esc(t(p.exit_reason || ''))}</span></div>` : ''}
    ${p.vwap ? `<div><span class="sub">VWAP</span><b class="ltr">${fmt(p.vwap)}</b></div>` : ''}
  </div>
  <div class="panel">${planChart(p)}</div>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Time Machine'))}</div>${p.tm ? tmPanel(p.tm, null) : `<div class="empty">${esc(t('Runs when the plan triggers.'))}</div>`}</div>
    <div class="panel"><div class="panel-title">${esc(t('The checks'))}</div>
      ${checks.length ? `<ul class="tr-checks">${checks.map((c) => `<li><span class="chip ${c.ok ? 'chip-ok' : c.level === 'warn' ? 'chip-dim' : 'chip-bad'}">${esc(t(c.ok ? 'pass' : c.level === 'warn' ? 'warn' : 'block'))}</span><b>${esc(t(c.name))}</b><span class="sub">${esc(c.why)}</span></li>`).join('')}</ul>` : `<div class="empty">${esc(t('Run when the plan triggers.'))}</div>`}</div>
  </div>
  <div class="panel"><div class="panel-title">${esc(t('The rule in past sessions'))}</div>
    ${p.history?.n ? `<p>${num(p.history.n)} ${esc(t('triggers in'))} ${num(p.history.sessions)} ${esc(t('sessions'))} · ${num(pctv(p.history.winRate))} ${esc(t('winners'))} · ${esc(t('expectancy'))} ${R(p.history.expectancy)} · ${esc(t('profit factor'))} ${num(p.history.profitFactor ?? '—')}${p.history.small ? ` · <span class="chip chip-dim">${esc(t('small sample'))}</span>` : ''}</p>
      <div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Day'))}</th><th>${esc(t('Entry · stop · target'))}</th><th>${esc(t('Exit'))}</th><th>R</th></tr></thead><tbody>
      ${p.history.trades.slice().reverse().map((x) => `<tr><td>${num(x.day)}</td><td>${num(`${fmt(x.entry)} · ${fmt(x.stop)} · ${fmt(x.target)}`)}</td><td>${num(fmt(x.exit))} <span class="sub">${esc(t(x.outcome))}</span></td><td>${R(x.R)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('Runs when the plan triggers.'))}</div>`}
  </div>
  ${p.order ? `<div class="panel"><div class="panel-title">${esc(t('The order'))}</div><p class="sub">#${num(p.order.id)} · ${esc(t(p.order.state))} · ${esc(p.order.rationale || '')}</p></div>` : ''}
  ${p.why ? `<div class="panel"><div class="panel-title">${esc(t('Why it was watched'))}</div><p>${esc(p.why)}</p></div>` : ''}
  <div class="panel">${disclaimer()}</div>`;
  wireActs(view, api, toast, () => renderTradePlan(id));
}
