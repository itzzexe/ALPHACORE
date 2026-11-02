// Ask about an instrument: a box where a person writes "how is gold", "Apple"
// or "$NVDA", and one card that answers with everything the desks know — the
// price, which way each timeframe points, the forecasts with their ranges and
// chances, the levels, the advice with its reasons, and the record of
// forecasts like these. Used by the gold desk and the markets desk.
//
// The last answer is kept per page, so a page that redraws itself on a poll
// draws the answer again instead of losing it.
import { esc, toast } from '../core/dom.js';
import { api } from '../services/api.js';
import { t } from '/i18n.js';

const f2 = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sg = (x, d = 2) => (x == null ? '—' : `${x > 0 ? '+' : ''}${f2(x, d)}`);
const pct = (x, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const cls = (x) => (x > 0 ? 'mk-up' : x < 0 ? 'mk-down' : '');
const ltr = (x) => `<span class="ltr">${x}</span>`;
const hz = (a, h) => (a.kind === 'gold' ? (h < 60 ? `${h}s` : h < 3600 ? `${h / 60}m` : `${h / 3600}h`) : `${h} ${t('sessions')}`);
const DIR = { up: ['chip-ok', '↑', 'Rising'], down: ['chip-bad', '↓', 'Falling'], flat: ['', '→', 'Sideways'] };
const dirChip = (d) => { const [c, g, l] = DIR[d] || ['chip-dim', '·', 'Not enough data']; return `<span class="chip ${c}">${g} ${esc(t(l))}</span>`; };
const ACT = { buy: ['chip-ok', 'Buy'], sell: ['chip-bad', 'Sell'], wait: ['chip-dim', 'Wait'], 'strong buy': ['chip-ok', 'strong buy'], 'strong sell': ['chip-bad', 'strong sell'], hold: ['chip-dim', 'hold'] };
const actChip = (a, big = false) => { const [c, l] = ACT[a] || ['', a]; return `<span class="chip ${c}${big ? ' mq-big' : ''}">${esc(t(l))}</span>`; };
const WHY = { 'no-edge': 'the expected move does not clear the spread', unsure: 'the chance of the direction is too low', unproven: 'the desk has not beaten “no change” at this horizon', 'against-trend': 'against the higher-timeframe trend', 'no-room': 'the stop would sit inside the spread' };

const kept = new Map();

export function askPanel(scope) {
  const last = kept.get(scope);
  return `<section class="panel mq-panel" data-mq="${esc(scope)}">
    <form class="mq-form" data-mq-form>
      <label class="fl" for="mq-${esc(scope)}">${esc(t('Ask about gold, a stock, an index or a coin'))}</label>
      <div class="mq-row">
        <input id="mq-${esc(scope)}" data-mq-text type="text" maxlength="300" autocomplete="off" placeholder="${esc(t('e.g. how is gold doing? · Apple · $NVDA · Bitcoin · oil'))}">
        <button class="btn btn-primary" type="submit">${esc(t('Analyse'))}</button>
      </div>
      <div class="inline mq-eg">${['ما حالة الذهب؟', 'Apple', 'NVDA', 'Bitcoin', 'النفط', 'S&P 500'].map((x) => `<button type="button" class="btn btn-sm btn-ghost" data-mq-eg="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    </form>
    <div data-mq-out>${last ? answerCard(last) : ''}</div>
  </section>`;
}

export function wireAsk(root) {
  root.querySelectorAll('[data-mq]').forEach((panel) => {
    const scope = panel.dataset.mq;
    const input = panel.querySelector('[data-mq-text]');
    const out = panel.querySelector('[data-mq-out]');
    const run = async (text) => {
      out.innerHTML = `<div class="hint">${esc(t('Reading the desks…'))}</div>`;
      try {
        const a = await api('/api/markets/ask', { method: 'POST', body: { text } });
        kept.set(scope, a);
        out.innerHTML = answerCard(a);
        // The question is answered; the box is no longer an unsaved form that should hold the page still.
        input.defaultValue = input.value;
      } catch (err) { out.innerHTML = ''; toast(err.message, true); }
    };
    panel.querySelector('[data-mq-form]').addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim()) run(input.value.trim()); });
    panel.querySelectorAll('[data-mq-eg]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.mqEg; run(b.dataset.mqEg); }));
    out.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mq-brief]');
      if (!b) return;
      try {
        await api(b.dataset.mqBrief === 'gold' ? '/api/gold/brief' : '/api/markets/brief', { method: 'POST', body: b.dataset.mqBrief === 'gold' ? {} : { symbol: b.dataset.mqBrief } });
        toast(t('The analyst is writing'));
      } catch (err) { toast(err.message, true); }
    });
  });
}

/** Closes and the forecast's 80% fan running off the right edge. */
function miniChart(a) {
  const xs = a.chart.filter((v) => Number.isFinite(v));
  if (xs.length < 3) return '';
  const unit = a.chartUnit;
  const fan = a.forecasts.map((f) => ({ k: (f.horizon * (a.kind === 'gold' ? 1 : 86400)) / unit, f })).filter((p) => p.k >= 1 && p.k <= Math.max(60, xs.length / 2));
  const ahead = fan.length ? Math.max(...fan.map((p) => p.k)) : 0;
  const W = 640; const H = 170; const n = xs.length + ahead;
  const vals = [...xs, ...fan.flatMap((p) => [p.f.low80, p.f.high80])];
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const x = (i) => (i / Math.max(1, n - 1)) * (W - 8) + 4;
  const y = (v) => 6 + (H - 12) * (1 - (v - lo) / (hi - lo || 1));
  const i0 = xs.length - 1;
  const line = xs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const band = fan.length ? `<path class="mk-cone80" d="M${x(i0).toFixed(1)} ${y(xs[i0]).toFixed(1)} ${fan.map((p) => `L${x(i0 + p.k).toFixed(1)} ${y(p.f.high80).toFixed(1)}`).join(' ')} ${[...fan].reverse().map((p) => `L${x(i0 + p.k).toFixed(1)} ${y(p.f.low80).toFixed(1)}`).join(' ')} Z"/>
    <path class="mk-mid" d="M${x(i0).toFixed(1)} ${y(xs[i0]).toFixed(1)} ${fan.map((p) => `L${x(i0 + p.k).toFixed(1)} ${y(p.f.expected).toFixed(1)}`).join(' ')}"/>` : '';
  return `<svg class="mk-chart mq-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t('Price and forecast range'))}">
    ${band}<path class="mk-line" d="${line}"/><line class="mk-axis" x1="${x(i0).toFixed(1)}" x2="${x(i0).toFixed(1)}" y1="0" y2="${H}"/></svg>`;
}

export function answerCard(a) {
  const gold = a.kind === 'gold';
  const tfs = a.timeframes.filter((x) => x.dir);
  const ups = tfs.filter((x) => x.dir === 'up').length; const downs = tfs.filter((x) => x.dir === 'down').length;
  const overall = ups > downs ? 'up' : downs > ups ? 'down' : 'flat';
  const short = a.timeframes[0]?.dir; const long = a.timeframes[a.timeframes.length - 1]?.dir;
  const verdict = gold ? a.advice.verdict.action : a.signal.label;
  const best = gold && a.advice.verdict.horizon ? a.advice.list.find((x) => x.horizon === a.advice.verdict.horizon) : null;

  const summary = `<p class="mq-summary">
    <b>${esc(t(a.name))}</b> · ${esc(t('Overall direction'))}: ${dirChip(overall)} · ${esc(t('Short term'))}: ${dirChip(short)} · ${esc(t('Long term'))}: ${dirChip(long)}
    ${gold ? `· ${esc(t('Technical summary'))} (5m): ${a.technical ? actChip(a.technical.verdict.all) : '—'}` : `· ${esc(t('Score'))}: ${ltr(sg(a.signal.score, 0))}`}</p>`;

  const adviceBlock = gold ? `<div class="mq-advice">
      <div class="mq-verdict">${actChip(verdict, true)} ${best ? `<span>${esc(t('at'))} ${ltr(hz(a, best.horizon))}</span>` : ''}</div>
      ${best ? `<div class="tr-levels">
        <div><span class="sub">${esc(t('Entry'))}</span><b class="ltr">${f2(best.entry)}</b></div>
        <div><span class="sub">${esc(t('Stop loss'))}</span><b class="ltr mk-down">${f2(best.stop)}</b></div>
        <div><span class="sub">${esc(t('Take profit'))}</span><b class="ltr mk-up">${f2(best.target)}</b></div>
        <div><span class="sub">${esc(t('Chance the direction is right'))}</span><b class="ltr">${pct(best.p)}</b></div>
        <div><span class="sub">${esc(t('Size for the risk set'))}</span><b class="ltr">${best.oz} oz</b></div>
        <div><span class="sub">${esc(t('Grade'))}</span><b>${esc(best.grade)}</b></div></div>`
      : `<p class="hint">${esc(t('No horizon has everything a trade needs right now. Waiting is advice too: each line below says what is missing.'))}</p>`}
      <table class="tbl"><thead><tr><th>${esc(t('Horizon'))}</th><th>${esc(t('Advice'))}</th><th>${esc(t('Leans'))}</th><th>${esc(t('Chance'))}</th><th>${esc(t('Expected after the spread'))}</th><th>${esc(t('Grade'))}</th><th>${esc(t('Why'))}</th></tr></thead><tbody>
      ${a.advice.list.map((x) => `<tr><td>${ltr(hz(a, x.horizon))}</td><td>${actChip(x.action)}</td><td>${actChip(x.lean)}</td><td class="ltr">${pct(x.p)}</td><td class="ltr ${cls(x.ev)}">${sg(x.ev)}</td><td>${esc(x.grade)}</td><td class="sub">${x.why.map((w) => esc(t(WHY[w] || w))).join(' · ') || '—'}</td></tr>`).join('')}
      </tbody></table></div>`
    : `<div class="mq-advice">
      <div class="mq-verdict">${actChip(verdict, true)} <span class="ltr">${sg(a.signal.score, 0)} / 100</span>
        ${a.proven ? '' : `<span class="chip chip-bad">${esc(t('not shown to beat the baseline'))}</span>`}</div>
      ${a.proven ? '' : `<p class="hint">${esc(t('In the walk-forward test this forecast called the direction less often than simply assuming the usual direction. Read the score as a description of the chart, not as an edge.'))}</p>`}
      <table class="tbl"><thead><tr><th>${esc(t('Part'))}</th><th>${esc(t('Points'))}</th><th>${esc(t('Why'))}</th></tr></thead><tbody>
      ${a.signal.components.map((c) => `<tr><td>${esc(t(c.part))}</td><td class="ltr ${cls(c.points)}">${sg(c.points, 1)}</td><td class="sub">${esc(t(c.why))}</td></tr>`).join('')}</tbody></table>
      ${a.sizing ? `<div class="tr-levels">
        <div><span class="sub">${esc(t('Stop loss'))}</span><b class="ltr mk-down">${f2(a.sizing.stop)}</b></div>
        <div><span class="sub">${esc(t('Take profit'))}</span><b class="ltr mk-up">${f2(a.sizing.target)}</b></div>
        <div><span class="sub">${esc(t('Weight in a portfolio'))}</span><b class="ltr">${pct(a.sizing.weight, 1)}</b></div></div>` : ''}</div>`;

  const fc = `<table class="tbl"><thead><tr><th>${esc(t('Horizon'))}</th><th>${esc(t('Forecast'))}</th><th>${esc(t('Range (80%)'))}</th><th>${esc(t('Chance up'))}</th><th>${esc(t('Record'))}</th></tr></thead><tbody>
    ${a.forecasts.map((f) => `<tr><td>${ltr(hz(a, f.horizon))}</td><td class="ltr ${cls(f.expected - a.price)}">${f2(f.expected)} <span class="sub">${sg(((f.expected / a.price) - 1) * 100, 3)}%</span></td>
      <td class="ltr">${f2(f.low80)} – ${f2(f.high80)}</td><td class="ltr">${pct(f.pUp)}</td>
      <td class="sub ltr">${!f.record?.n ? esc(t('no record yet')) : gold ? `${pct(f.record.hitRate)} ${esc(t('direction'))} · ${f.record.skillPct == null ? '—' : `${sg(f.record.skillPct, 1)}%`} ${esc(t('skill'))}` : `${pct(f.record.hitRate)} ${esc(t('direction'))} / ${pct(f.record.baseline)} ${esc(t('baseline'))}`}</td></tr>`).join('')}</tbody></table>`;

  const levels = `<div class="mq-levels">${a.levels.map(([l, v]) => `<span class="chip ${v > a.price ? 'chip-bad' : 'chip-ok'}">${esc(t(l))} ${ltr(f2(v))}</span>`).join('')}</div>`;

  return `<article class="mq-card">
    <header class="mq-head">
      <div><b class="mq-name">${esc(t(a.name))}</b> <span class="sub ltr">${esc(a.symbol)}</span>
        ${a.source === 'live' ? `<span class="chip chip-ok">${esc(t('live prices'))}</span>` : `<span class="chip chip-bad">${esc(t('simulated prices'))}</span>`}</div>
      <div class="mq-price"><b class="ltr">${f2(a.price)}</b> <span class="ltr ${cls(a.changePct)}">${sg(a.changePct)}%</span>
        <span class="sub">${esc(t(a.period === '24h' ? '24h range' : '52-week range'))} ${ltr(`${f2(a.low)} – ${f2(a.high)}`)}</span></div>
    </header>
    ${summary}
    <div class="mq-grid">
      <div>${miniChart(a)}
        <div class="mq-tfs">${a.timeframes.map((x) => `<div><span class="sub">${esc(x.tf)}</span>${dirChip(x.dir)}<span class="sub ltr">RSI ${f2(x.rsi, 0)} · ${sg(x.change, 2)}%</span></div>`).join('')}</div>
        <div class="fl">${esc(t('Levels'))}</div>${levels}</div>
      <div><div class="fl">${esc(t('The advice'))}</div>${adviceBlock}</div>
    </div>
    <div class="fl">${esc(t('Forecasts'))}</div>${fc}
    ${a.news?.length ? `<div class="fl">${esc(t('In the news'))}</div><ul class="mq-news">${a.news.map((n) => `<li>${esc(n.title)} <span class="sub">${esc(n.source || '')}</span></li>`).join('')}</ul>` : ''}
    <div class="inline mq-actions">
      <a class="btn btn-sm" href="${esc(a.open)}">${esc(t('Open the full chart'))}</a>
      <button type="button" class="btn btn-sm btn-ghost" data-mq-brief="${gold ? 'gold' : esc(a.symbol)}">${esc(t('Ask the analyst to write it up'))}</button>
    </div>
    <p class="hint mk-disclaimer">${esc(t(a.note))}</p>
  </article>`;
}
