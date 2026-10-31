// The workforce map — the self-improvement loop drawn as it runs.
//
// Left to right: what the loop is given (goal, tasks, rubric, history), the
// core, the Coach and the Grader, the employees under test, the tools each one
// really called through the gate, and the pass gate. Every wire is a real
// relationship from /api/selfimprove/map, and every particle on it is work in
// that relationship: denser where runs are in flight, teal toward the gate for
// an employee passing, red for one failing. Nothing moves for decoration — a
// quiet company is a still map.
//
// It updates in place (no re-render while you watch), pans and zooms, opens
// any node into its details, replays a finished loop round by round, and has
// a plain table under it for anyone who would rather read than watch.
import { esc, toast } from '../core/dom.js';
import { api } from '../services/api.js';
import { t } from '/i18n.js';

const SHAPES = {
  tri: 'M13 3 L24 22 H2 Z',
  heart: 'M13 23 C4 16 1.5 11 4 6.5 C6.5 2.5 11 3 13 7 C15 3 19.5 2.5 22 6.5 C24.5 11 22 16 13 23 Z',
  ghost: 'M4 24 V12 A9 9 0 0 1 22 12 V24 L18.5 21 L13 24 L7.5 21 Z',
  blob: 'M6 4 H20 A4 4 0 0 1 24 8 V18 A4 4 0 0 1 20 22 H6 A4 4 0 0 1 2 18 V8 A4 4 0 0 1 6 4 Z',
  star: 'M13 1.5 L15.6 7.2 L21.8 5.2 L19.8 11.4 L25.5 14 L19.8 16.6 L21.8 22.8 L15.6 20.8 L13 26.5 L10.4 20.8 L4.2 22.8 L6.2 16.6 L0.5 14 L6.2 11.4 L4.2 5.2 L10.4 7.2 Z',
};
const GROUPS = {
  run: { color: '--lm-red', shape: 'tri' }, create: { color: '--lm-pink', shape: 'heart' }, discover: { color: '--lm-violet', shape: 'ghost' },
  build: { color: '--lm-orange', shape: 'blob' }, assure: { color: '--lm-teal', shape: 'star' }, steer: { color: '--lm-amber', shape: 'blob' },
};
const groupOf = (g) => GROUPS[g] || GROUPS.run;

export function avatar(group, size = 26) {
  const g = groupOf(group);
  return `<svg class="lm-avatar" viewBox="0 0 26 28" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <path d="${SHAPES[g.shape]}" fill="var(${g.color})" stroke="var(${g.color})" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="8.3" y="10.5" width="2.8" height="5.4" rx="1.4" fill="var(--lm-eye)"/><rect x="14.9" y="10.5" width="2.8" height="5.4" rx="1.4" fill="var(--lm-eye)"/></svg>`;
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const curve = (x1, y1, x2, y2) => { const dx = Math.max(40, (x2 - x1) * 0.5); return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`; };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Where everything sits, for a number of employees, in the column or the card layout. */
function layout(data, cards) {
  const n = Math.max(1, data.workers.length);
  const W = 1500;
  const top = 96;
  const rowH = cards ? 230 : 62;
  const perRow = cards ? 3 : 1;
  const rows = Math.ceil(n / perRow);
  const H = Math.max(780, top + rows * rowH + 70);
  const cy = H / 2;
  const L = {
    W, H, cy,
    inputs: ['goal', 'tasks', 'rubric', 'history'].map((id, i) => ({ id, x: 24, y: H * [0.2, 0.36, 0.64, 0.8][i], w: 96, h: 26 })),
    bot: { x: 280, y: cy, r: 46 },
    coach: { x: 392, y: cy - 282, w: 236, h: 240 },
    grader: { x: 392, y: cy + 42, w: 236, h: 240 },
    gate: { x: W - 110, y: cy, r: 50 },
    workers: data.workers.map((w, i) => (cards
      ? { x: 700 + (i % 3) * 262, y: top + Math.floor(i / 3) * rowH, w: 246, h: 214 }
      : { x: 700, y: top + i * rowH, w: 214, h: 40 })),
    tools: [],
  };
  if (!cards) {
    const names = [...new Set(data.workers.flatMap((w) => w.tools.map((x) => x.name)))].slice(0, 72);
    const cols = Math.max(1, Math.ceil(names.length / Math.max(1, Math.floor((H - top - 60) / 30))));
    const perCol = Math.ceil(names.length / cols) || 1;
    const span = Math.min(30, (H - top - 60) / perCol);
    L.tools = names.map((name, i) => ({ name, x: 1000 + Math.floor(i / perCol) * 140, y: top + (i % perCol) * span + 4, w: 128, h: 20 }));
  }
  return L;
}

/** Mount the map in `root`. Returns { destroy }. */
export function mountLoopMap(root, { source = '/api/selfimprove/map', canManage = false, compact = false, initial = null, onDestroy = null } = {}) {
  let data = null;
  let L = null;
  let cards = localStorage.getItem('alphacore-lm-cards') === '1';
  let view = { s: 1, x: 0, y: 0 };
  let focus = null;
  let viewRound = null;
  let wires = [];
  let particles = [];
  let colors = {};
  let raf = 0;
  let timer = 0;
  let replayTimer = 0;
  let alive = true;
  let last = performance.now();

  root.classList.add('lm');
  root.innerHTML = `
    <div class="lm-head">
      <div class="lm-crumb"><span class="lm-muted">global /</span> <b id="lm-name">…</b> <span class="lm-dot" id="lm-dot"></span></div>
      <div class="lm-metrics" role="status" aria-live="polite">
        <div><b id="lm-m-rounds">—</b><span>${esc(t('rounds'))}</span></div>
        <div><b id="lm-m-pass">—</b><span>${esc(t('pass rate'))}</span></div>
        <div><b id="lm-m-rewrites">—</b><span>${esc(t('prompt rewrites'))}</span></div>
        <div><b id="lm-m-me">—</b><span>${esc(t('edits by me'))}</span></div>
      </div>
    </div>
    <div class="lm-tools-bar">
      <div class="lm-rounds" id="lm-rounds"></div>
      <div class="lm-ctl">
        <button type="button" class="lm-btn" id="lm-layout">${esc(t(cards ? 'Column' : 'Cards'))}</button>
        <button type="button" class="lm-btn" id="lm-replay" hidden>${esc(t('Replay'))}</button>
        ${canManage ? `<button type="button" class="lm-btn lm-btn-hot" id="lm-start">${esc(t('Start a loop'))}</button><button type="button" class="lm-btn" id="lm-stop" hidden>${esc(t('Stop'))}</button>` : ''}
      </div>
    </div>
    <div class="lm-viewport${compact ? ' lm-compact' : ''}" id="lm-vp" tabindex="0" aria-label="${esc(t('The workforce map — drag to move, wheel to zoom'))}">
      <div class="lm-stage" id="lm-stage" dir="ltr"></div>
      <div class="lm-zoom"><button type="button" class="lm-btn" data-z="in" aria-label="${esc(t('Zoom in'))}">+</button><button type="button" class="lm-btn" data-z="out" aria-label="${esc(t('Zoom out'))}">−</button><button type="button" class="lm-btn" data-z="fit" aria-label="${esc(t('Fit to screen'))}">⤢</button></div>
      <button type="button" class="lm-wait" id="lm-wait" hidden></button>
      <aside class="lm-drawer" id="lm-drawer" hidden></aside>
      <div class="lm-done" id="lm-done" hidden></div>
    </div>
    <details class="lm-list"><summary>${esc(t('As a table'))}</summary><div id="lm-table"></div></details>`;
  const $ = (sel) => root.querySelector(sel);
  const vp = $('#lm-vp');
  const stage = $('#lm-stage');

  // --------------------------------------------------------------- build --

  function readColors() {
    const cs = getComputedStyle(root);
    for (const k of ['--lm-red', '--lm-pink', '--lm-violet', '--lm-orange', '--lm-teal', '--lm-amber', '--lm-pass', '--lm-fail', '--lm-ink', '--lm-wire']) colors[k] = cs.getPropertyValue(k).trim() || '#888';
  }

  const passing = (w) => w.pass != null && w.pass >= (data.loop?.target ?? 0.9);
  const workerPass = (w, i) => (viewRound && data.loop ? (w.series[viewRound - 1] ?? null) : w.pass);
  const stateOf = (w, i) => { const p = workerPass(w, i); return p == null ? 'none' : p >= (data.loop?.target ?? 0.9) ? 'pass' : 'fail'; };

  function workerNode(w, i) {
    const p = L.workers[i];
    const st = stateOf(w, i);
    if (!cards) {
      return `<button type="button" class="lm-worker lm-${st}${w.busy ? ' lm-busy' : ''}" data-node="worker" data-i="${i}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--c:var(${groupOf(w.group).color})"
        aria-label="${esc(w.name)}: ${esc(pct(workerPass(w, i)))}">${avatar(w.group)}<span class="lm-wname">${esc(w.name)}</span><span class="lm-wpct">${esc(pct(workerPass(w, i)))}</span><span class="lm-port"></span></button>`;
    }
    return `<button type="button" class="lm-card lm-wcard lm-${st}${w.busy ? ' lm-busy' : ''}" data-node="worker" data-i="${i}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--c:var(${groupOf(w.group).color})" aria-label="${esc(w.name)}">
      <span class="lm-card-head"><b>${esc(w.name)}</b>${avatar(w.group, 30)}</span>
      <span class="lm-toggle"><i></i>${esc(t(w.busy ? 'Working' : 'Enabled'))}</span>
      <span class="lm-sub">${esc(t('Capabilities'))}</span>
      <span class="lm-chips">${(w.tools.length ? w.tools.slice(0, 2).map((x) => x.name) : w.contract.slice(0, 2)).map((x) => `<em>${esc(x)}</em>`).join('')}</span>
      <span class="lm-chips"><em class="lm-self">${esc(t('Prompt (self-edit)'))}${w.version ? ` v${w.version}` : ''}</em></span>
      <span class="lm-sub">${esc(t('Rules from the coach'))}</span>
      <span class="lm-rules">${w.rules.slice(-2).map((r) => `<span>• ${esc(r.slice(0, 48))}</span>`).join('') || `<span class="lm-muted">—</span>`}</span>
      <span class="lm-card-foot"><span>${esc(t('pass'))} <b>${esc(pct(workerPass(w, i)))}</b></span><span>${w.runs} ${esc(t('runs'))}</span></span></button>`;
  }

  function build() {
    L = layout(data, cards);
    const d = data;
    const tags = {
      goal: d.loop ? `${t('pass')} ${Math.round(d.loop.target * 100)}%` : t('live'),
      tasks: `${d.inputs.tasks} ${t('tasks')}`,
      rubric: `${d.inputs.rubric.length} ${t('checks')}`,
      history: d.mode === 'loop' ? `${d.inputs.history} ${t('from history')}` : `${d.inputs.history} ${t('runs')}`,
    };
    const labels = { goal: 'Goal', tasks: 'Tasks', rubric: 'Rubric', history: 'History' };
    wires = [];
    const W = (id, x1, y1, x2, y2, kind, extra = {}) => wires.push({ id, d: curve(x1, y1, x2, y2), kind, ...extra });
    for (const inp of L.inputs) W(`in-${inp.id}`, inp.x + inp.w + 6, inp.y + inp.h / 2, L.bot.x - L.bot.r, L.bot.y + (inp.y < L.cy ? -16 : 16), 'in', { tag: tags[inp.id], node: `input:${inp.id}` });
    W('bot-coach', L.bot.x + L.bot.r, L.bot.y - 10, L.coach.x, L.coach.y + 40, 'bot', { node: 'coach' });
    W('bot-grader', L.bot.x + L.bot.r, L.bot.y + 10, L.grader.x, L.grader.y + 40, 'bot', { node: 'grader' });
    W('coach-grader', L.coach.x + L.coach.w / 2, L.coach.y + L.coach.h, L.grader.x + L.grader.w / 2, L.grader.y, 'bot', { node: 'grader' });
    const toolAt = new Map(L.tools.map((x) => [x.name, x]));
    d.workers.forEach((w, i) => {
      const p = L.workers[i];
      const ty = p.y + (cards ? 30 : p.h / 2);
      W(`coach-w${i}`, L.coach.x + L.coach.w, L.coach.y + 120, p.x, ty, 'coach', { worker: i });
      W(`grader-w${i}`, L.grader.x + L.grader.w, L.grader.y + 100, p.x, ty, 'grader', { worker: i });
      if (!cards) {
        for (const tool of w.tools) {
          const tp = toolAt.get(tool.name);
          if (tp) W(`w${i}-${tool.name}`, p.x + p.w, ty, tp.x, tp.y + tp.h / 2, 'tool', { worker: i, tool });
        }
      }
      const from = cards ? { x: p.x + p.w, y: p.y + p.h / 2 } : { x: p.x + p.w, y: ty };
      const via = !cards && w.tools.length ? toolAt.get(w.tools[0].name) : null;
      W(`w${i}-gate`, via ? via.x + via.w : from.x, via ? via.y + via.h / 2 : from.y, L.gate.x - L.gate.r, L.gate.y + ((i / Math.max(1, d.workers.length - 1)) - 0.5) * 40, 'gate', { worker: i });
    });

    const g = d.gate;
    const coachState = d.loop?.state === 'coaching' || d.coach.busy ? 'Working' : d.loop && ['done', 'stopped'].includes(d.loop.state) ? 'Finished' : 'Enabled';
    const graderState = d.loop?.state === 'grading' ? 'Working' : d.loop && ['done', 'stopped'].includes(d.loop.state) ? 'Finished' : 'Enabled';
    stage.style.width = `${L.W}px`;
    stage.style.height = `${L.H}px`;
    stage.innerHTML = `
      <svg class="lm-wires" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}" aria-hidden="true" focusable="false">
        ${wires.map((w) => `<path id="lm-${esc(w.id)}" class="lm-wire lm-w-${w.kind}${w.tool?.stopped ? ' lm-w-stopped' : ''}" data-worker="${w.worker ?? ''}" d="${w.d}"${w.worker != null ? ` style="--c:var(${groupOf(d.workers[w.worker].group).color})"` : ''}/>`).join('')}
      </svg>
      <canvas class="lm-particles" aria-hidden="true"></canvas>
      ${L.inputs.map((inp) => `<button type="button" class="lm-input" data-node="input:${inp.id}" style="left:${inp.x}px;top:${inp.y}px;width:${inp.w}px;height:${inp.h}px">${esc(t(labels[inp.id]))}<span class="lm-port"></span></button>`).join('')}
      ${wires.filter((w) => w.tag).map((w) => { const inp = L.inputs.find((x) => `in-${x.id}` === w.id); return `<span class="lm-tag" style="left:${inp.x + inp.w + 40}px;top:${(inp.y + L.bot.y) / 2 - 8}px">${esc(w.tag)}</span>`; }).join('')}
      <button type="button" class="lm-bot" data-node="bot" style="left:${L.bot.x - L.bot.r}px;top:${L.bot.y - L.bot.r}px;width:${L.bot.r * 2}px;height:${L.bot.r * 2}px" aria-label="AlphaCore">
        <span class="lm-bot-face"><i></i><i></i></span></button>
      <span class="lm-bot-name" style="left:${L.bot.x - 60}px;top:${L.bot.y + L.bot.r + 10}px">ALPHACORE</span>
      <button type="button" class="lm-card lm-coach lm-st-${coachState.toLowerCase()}" data-node="coach" style="left:${L.coach.x}px;top:${L.coach.y}px;width:${L.coach.w}px;height:${L.coach.h}px" aria-label="${esc(t('Coach'))}">
        <span class="lm-card-head"><b>${esc(t('Coach'))}</b>${avatar('steer', 30)}</span>
        <span class="lm-toggle"><i></i>${esc(t(coachState))}</span>
        <span class="lm-sub">${esc(t('Capabilities'))}</span>
        <span class="lm-chips"><em>${esc(t('Prompt rewrite'))}</em><em>${esc(t('Diff'))}</em></span>
        <span class="lm-chips"><em>${esc(t('Memory (playbooks)'))}</em></span>
        <span class="lm-sub">${esc(t('Mode'))}: <b>${esc(t(d.coach.mode === 'ask' ? 'a person accepts each rewrite' : 'kept only if the next round improves'))}</b></span>
        <span class="lm-card-foot"><span>• ${esc(t('Grader'))} · ${d.workers.length} ${esc(t('workers'))}</span><span>${d.coach.rewrites} ${esc(t('rewrites'))}</span></span></button>
      <button type="button" class="lm-card lm-grader lm-st-${graderState.toLowerCase()}" data-node="grader" style="left:${L.grader.x}px;top:${L.grader.y}px;width:${L.grader.w}px;height:${L.grader.h}px" aria-label="${esc(t('Grader'))}">
        <span class="lm-card-head"><b>${esc(t('Grader'))}</b>${avatar('assure', 30)}</span>
        <span class="lm-toggle"><i></i>${esc(t(graderState))}</span>
        <span class="lm-sub">${esc(t('Capabilities'))}</span>
        <span class="lm-chips"><em>${esc(t('Scoring'))}</em><em>${esc(t('Rubric'))}</em></span>
        <span class="lm-chips"><em>${esc(t('Golden sets'))}</em></span>
        <span class="lm-sub">${esc(t('The rubric is code — no model grades'))}</span>
        <span class="lm-card-foot"><span>• ${d.workers.length} ${esc(t('workers'))} · ${esc(t('Coach'))}</span><span>${d.grader.graded} ${esc(t('graded'))}</span></span></button>
      ${d.workers.map(workerNode).join('')}
      ${d.more && !cards ? `<span class="lm-more" style="left:${L.workers.at(-1)?.x ?? 700}px;top:${(L.workers.at(-1)?.y ?? 0) + 48}px">+${d.more} ${esc(t('more employees'))}</span>` : ''}
      ${L.tools.map((tp) => { const used = d.workers.flatMap((w) => w.tools).filter((x) => x.name === tp.name); const stopped = used.some((x) => x.stopped); const granted = used.every((x) => x.granted);
    return `<span class="lm-tool${stopped ? ' lm-tool-stopped' : ''}${granted ? ' lm-tool-granted' : ''}" style="left:${tp.x}px;top:${tp.y}px;width:${tp.w}px">${stopped ? '× ' : ''}${esc(tp.name)}</span>`; }).join('')}
      <button type="button" class="lm-gate lm-${g.rate == null ? 'none' : g.rate >= (d.loop?.target ?? 0.9) ? 'pass' : 'fail'}" data-node="gate" style="left:${L.gate.x - L.gate.r}px;top:${L.gate.y - L.gate.r}px;width:${L.gate.r * 2}px;height:${L.gate.r * 2}px" aria-label="${esc(t('Pass gate'))}">
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" focusable="false"><path d="M5 12.5 L10 17 L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="lm-gate-label" id="lm-gate-label" style="left:${L.gate.x - 90}px;top:${L.gate.y + L.gate.r + 10}px"></span>`;

    // Sample every wire once, so a particle's position is a lookup, not a path query.
    const svg = stage.querySelector('svg');
    for (const w of wires) {
      const el = svg.querySelector(`#lm-${CSS.escape(w.id)}`);
      w.el = el;
      const len = el.getTotalLength();
      const n = Math.max(12, Math.min(80, Math.round(len / 12)));
      w.pts = Array.from({ length: n + 1 }, (_, k) => { const pt = el.getPointAtLength((k / n) * len); return [pt.x, pt.y]; });
      w.acc = Math.random();
    }
    const canvas = stage.querySelector('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = L.W * dpr; canvas.height = L.H * dpr;
    canvas.style.width = `${L.W}px`; canvas.style.height = `${L.H}px`;
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = [];
    readColors();
    paintDynamic();
    if (!view.fitted) fit();
    applyView();
  }

  // ------------------------------------------------------- live numbers --

  function paintDynamic() {
    const d = data;
    const l = d.loop;
    $('#lm-name').textContent = l ? l.name : t('the workforce, live');
    const running = l && ['grading', 'coaching', 'waiting'].includes(l.state);
    $('#lm-dot').className = `lm-dot${running ? ' lm-dot-on' : l?.state === 'done' ? ' lm-dot-done' : ''}`;
    $('#lm-dot').title = t(l ? l.state : 'live');
    $('#lm-m-rounds').textContent = l ? l.round : '—';
    const passNow = viewRound && l ? (l.rounds[viewRound - 1] ? l.rounds[viewRound - 1].passed / l.rounds[viewRound - 1].total : null) : d.gate.rate;
    const mp = $('#lm-m-pass');
    mp.textContent = pct(passNow);
    mp.className = passNow == null ? '' : passNow >= (l?.target ?? 0.9) ? 'lm-good' : 'lm-warn';
    $('#lm-m-rewrites').textContent = l ? l.metrics.rewrites : d.coach.rewrites;
    $('#lm-m-me').textContent = l ? l.metrics.byMe : '—';
    const rr = l?.rounds || [];
    $('#lm-rounds').innerHTML = rr.length ? `${rr.map((r) => `<button type="button" class="lm-round${(viewRound || rr.length) === r.round ? ' on' : ''}" data-round="${r.round}">${esc(t('Round'))} ${r.round} · ${pct(r.passed / r.total)}</button>`).join('')}${running ? `<span class="lm-round lm-round-now">${esc(t('Round'))} ${l.round} · ${esc(t(l.state))}…</span>` : ''}` : `<span class="lm-muted">${esc(t(l ? 'Round 1 is being graded…' : 'No loop yet — this is the workforce as it works now.'))}</span>`;
    root.querySelectorAll('[data-round]').forEach((b) => b.addEventListener('click', () => { stopReplay(); viewRound = Number(b.dataset.round) === rr.length ? null : Number(b.dataset.round); refreshNodes(); paintDynamic(); }));
    const shown = viewRound && l ? l.rounds[viewRound - 1] : null;
    const gp = shown ? { passed: shown.passed, total: shown.total } : d.gate;
    $('#lm-gate-label').innerHTML = `<b>${esc(t('PASS'))} ${l ? `${Math.round(l.target * 100)}%+` : ''}</b><span>${gp.total ? `${gp.passed} / ${gp.total} ${esc(t('passed'))}` : esc(t('nothing graded yet'))}</span>`;
    const replay = $('#lm-replay');
    if (replay) replay.hidden = !(l && rr.length > 1 && !running);
    const start = $('#lm-start'); const stop = $('#lm-stop');
    if (start) start.hidden = Boolean(running);
    if (stop) stop.hidden = !running;
    const waiting = (l?.coach || []).filter((c) => c.state === 'proposed').length;
    const wait = $('#lm-wait');
    wait.hidden = !(l?.state === 'waiting' && waiting);
    wait.textContent = `● ${waiting} ${t('rewrites wait for a person')}${canManage ? ` — ${t('decide')}` : ''}`;
    const done = $('#lm-done');
    if (l && ['done', 'stopped'].includes(l.state) && !done.dataset.closed) {
      const kept = l.versions.filter((v) => v.state === 'kept').concat(l.versions.filter((v) => v.state !== 'kept')).slice(0, 4);
      const name = (id) => d.workers.find((w) => w.id === id)?.name || id;
      done.hidden = false;
      done.innerHTML = `<button type="button" class="lm-x" aria-label="${esc(t('Close'))}">×</button>
        <div class="lm-done-head">● ${esc(t(l.state === 'done' ? 'LOOP COMPLETE' : 'LOOP STOPPED'))} · ${esc(l.name)}</div>
        <div class="lm-done-big" dir="ltr"><span>${pct(l.firstPass)}</span> → <b>${pct(l.lastPass)}</b></div>
        <div class="lm-done-sub">${l.metrics.rewrites} ${esc(t('prompt rewrites'))} · <b>${l.metrics.fixed}</b> ${esc(t('fails fixed'))} · ${l.metrics.reverted} ${esc(t('reverted'))} · ${l.metrics.byMe} ${esc(t('by me'))}</div>
        <div class="lm-diffs">${kept.map((v) => `<div class="lm-diff lm-diff-${v.state}"><div class="lm-diff-head"><span style="--c:var(${groupOf(d.workers.find((w) => w.id === v.agent_id)?.group).color})"></span>${esc(name(v.agent_id))} · v${v.version} <em>${esc(t(v.state))}</em></div>
          ${v.removed.map((x) => `<div class="lm-del">− ${esc(x)}</div>`).join('')}${v.added.map((x) => `<div class="lm-add">+ ${esc(x)}</div>`).join('')}</div>`).join('') || `<div class="lm-muted">${esc(t('No rewrite was needed.'))}</div>`}</div>`;
      done.querySelector('.lm-x').addEventListener('click', () => { done.hidden = true; done.dataset.closed = '1'; });
    } else if (!(l && ['done', 'stopped'].includes(l.state))) { done.hidden = true; delete done.dataset.closed; }
    table();
  }

  function refreshNodes() {
    data.workers.forEach((w, i) => {
      const el = stage.querySelector(`[data-node="worker"][data-i="${i}"]`);
      if (!el) return;
      el.classList.remove('lm-pass', 'lm-fail', 'lm-none');
      el.classList.add(`lm-${stateOf(w, i)}`);
      el.classList.toggle('lm-busy', Boolean(w.busy));
      const pc = el.querySelector('.lm-wpct') || el.querySelector('.lm-card-foot b');
      if (pc) pc.textContent = pct(workerPass(w, i));
    });
  }

  function table() {
    const d = data;
    $('#lm-table').innerHTML = `<table class="tbl"><thead><tr><th>${esc(t('Employee'))}</th><th>${esc(t('Pass'))}</th><th>${esc(t('By round'))}</th><th>${esc(t('Playbook'))}</th><th>${esc(t('Tools used'))}</th></tr></thead><tbody>
      ${d.workers.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(pct(w.pass))}</td><td class="ltr">${w.series.map(pct).join(' → ') || '—'}</td><td>${w.version ? `v${w.version} · ` : ''}${w.rules.length} ${esc(t('rules'))}</td><td class="ltr">${esc(w.tools.map((x) => x.name).join(', ') || '—')}</td></tr>`).join('')}</tbody></table>`;
  }

  // --------------------------------------------------------- particles --

  /** How much is flowing on a wire right now: real work only. */
  function weight(w) {
    const d = data;
    const l = d.loop;
    const running = l && ['grading', 'coaching', 'waiting'].includes(l.state);
    const wk = w.worker != null ? d.workers[w.worker] : null;
    if (w.kind === 'in') return running ? 0.8 : 0.08;
    if (w.kind === 'bot') return running ? 1.2 : d.workers.some((x) => x.busy) ? 0.4 : 0.05;
    if (w.kind === 'grader') return l?.state === 'grading' ? 0.6 + (wk.busy ? 0.8 : 0) : wk.busy ? 0.3 : 0.02;
    if (w.kind === 'coach') return l?.state === 'coaching' && stateOf(wk, w.worker) === 'fail' ? 1.4 : 0.02;
    if (w.kind === 'tool') return Math.min(1.2, (w.tool.count ? 0.15 + Math.log10(1 + w.tool.count) * 0.4 : 0.03)) * (wk.busy || running ? 1.6 : 0.5);
    if (w.kind === 'gate') return wk.pass == null ? 0.02 : running || wk.busy ? 1 : 0.25;
    return 0;
  }
  function colorOf(w) {
    if (w.kind === 'gate') { const st = stateOf(data.workers[w.worker], w.worker); return st === 'pass' ? colors['--lm-pass'] : st === 'fail' ? colors['--lm-fail'] : colors['--lm-wire']; }
    if (w.kind === 'tool' && w.tool.stopped) return colors['--lm-fail'];
    if (w.worker != null) return colors[groupOf(data.workers[w.worker].group).color];
    return colors['--lm-ink'];
  }

  function frame(now) {
    if (!alive) return;
    if (!document.body.contains(root)) { destroy(); return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const canvas = stage.querySelector('canvas');
    if (canvas && wires.length) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, L.W, L.H);
      if (!reduced()) {
        for (const w of wires) {
          w.acc += weight(w) * dt * 2.2;
          while (w.acc >= 1 && particles.length < 900) { w.acc -= 1; particles.push({ w, t: 0, v: 0.22 + Math.random() * 0.18, c: colorOf(w) }); }
        }
        for (let k = particles.length - 1; k >= 0; k--) {
          const p = particles[k];
          p.t += p.v * dt;
          if (p.t >= 1) { particles.splice(k, 1); continue; }
          const pts = p.w.pts;
          const f = p.t * (pts.length - 1);
          const a = pts[Math.floor(f)]; const b = pts[Math.min(pts.length - 1, Math.floor(f) + 1)];
          const x = a[0] + (b[0] - a[0]) * (f % 1); const y = a[1] + (b[1] - a[1]) * (f % 1);
          const dim = focus != null && p.w.worker !== focus && p.w.kind !== 'bot' && p.w.kind !== 'in';
          ctx.globalAlpha = dim ? 0.08 : 0.28;
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.283); ctx.fill();
          ctx.globalAlpha = dim ? 0.2 : 0.95;
          ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  /** A round finished: a burst toward the gate from every employee that passed. */
  function burst() {
    for (const w of wires.filter((x) => x.kind === 'gate')) for (let k = 0; k < 6; k++) particles.push({ w, t: Math.random() * 0.3, v: 0.5 + Math.random() * 0.3, c: colorOf(w) });
  }

  // ----------------------------------------------------- pan, zoom, fit --

  function applyView() { stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`; }
  function fit() {
    const r = vp.getBoundingClientRect();
    if (!r.width || !L) return;
    view.s = Math.min(1.1, r.width / L.W, Math.max(0.3, (r.height || 700) / L.H));
    view.x = (r.width - L.W * view.s) / 2;
    view.y = Math.max(0, ((r.height || L.H * view.s) - L.H * view.s) / 2);
    view.fitted = true;
    applyView();
  }
  function zoom(f, cx = vp.clientWidth / 2, cy = vp.clientHeight / 2) {
    const s = Math.min(2.5, Math.max(0.25, view.s * f));
    view.x = cx - (cx - view.x) * (s / view.s);
    view.y = cy - (cy - view.y) * (s / view.s);
    view.s = s;
    applyView();
  }
  let drag = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, .lm-drawer, .lm-done, a, input, select, textarea')) return;
    drag = { x: e.clientX - view.x, y: e.clientY - view.y };
    vp.setPointerCapture(e.pointerId);
    vp.classList.add('lm-dragging');
  });
  vp.addEventListener('pointermove', (e) => { if (drag) { view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; applyView(); } });
  vp.addEventListener('pointerup', () => { drag = null; vp.classList.remove('lm-dragging'); });
  vp.addEventListener('wheel', (e) => {
    if (e.target.closest('.lm-drawer, .lm-done')) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  vp.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoom(1.15);
    else if (e.key === '-') zoom(1 / 1.15);
    else if (e.key === '0') fit();
    else if (e.key === 'Escape') closeDrawer();
  });
  root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => (b.dataset.z === 'in' ? zoom(1.2) : b.dataset.z === 'out' ? zoom(1 / 1.2) : fit())));
  const onResize = () => { if (view.fitted) fit(); };
  window.addEventListener('resize', onResize);

  // ------------------------------------------------------ focus, drawer --

  function setFocus(i) {
    focus = i;
    stage.classList.toggle('lm-focusing', i != null);
    stage.querySelectorAll('.lm-wire').forEach((p) => p.classList.toggle('lm-hot', i != null && p.dataset.worker === String(i)));
    stage.querySelectorAll('[data-node="worker"]').forEach((n) => n.classList.toggle('lm-hot', i != null && n.dataset.i === String(i)));
  }
  stage.addEventListener('pointerover', (e) => { const n = e.target.closest('[data-node="worker"]'); setFocus(n ? Number(n.dataset.i) : (drawerFor ?? null)); });
  stage.addEventListener('focusin', (e) => { const n = e.target.closest('[data-node="worker"]'); if (n) setFocus(Number(n.dataset.i)); });
  stage.addEventListener('click', (e) => { const n = e.target.closest('[data-node]'); if (n) openDrawer(n.dataset.node, n.dataset.i); });

  let drawerFor = null;
  function closeDrawer() { $('#lm-drawer').hidden = true; drawerFor = null; setFocus(null); }
  function spark(series, good = true) {
    if (!series.length) return '';
    const w = 220; const h = 50;
    const c = good ? 'var(--lm-pass)' : 'var(--lm-fail)';
    const pts = series.map((v, k) => `${series.length > 1 ? (k / (series.length - 1)) * w : w / 2},${h - 4 - v * (h - 8)}`).join(' ');
    return `<svg class="lm-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2"/>${series.map((v, k) => `<circle cx="${series.length > 1 ? (k / (series.length - 1)) * w : w / 2}" cy="${h - 4 - v * (h - 8)}" r="3" fill="${c}"/>`).join('')}</svg>`;
  }
  function openDrawer(kind, i) {
    const d = data;
    const box = $('#lm-drawer');
    let html = '';
    if (kind === 'worker') {
      const w = d.workers[Number(i)];
      drawerFor = Number(i);
      setFocus(drawerFor);
      const rubric = d.inputs.rubric;
      html = `<div class="lm-dr-head">${avatar(w.group, 34)}<div><b>${esc(w.name)}</b><div class="lm-muted">${esc(w.id)} · ${esc(w.tier || '')}</div></div></div>
        <p class="lm-muted">${esc(w.role)}</p>
        <div class="lm-dr-row"><span>${esc(t('Pass'))}</span><b class="${passing(w) ? 'lm-good' : 'lm-warn'}">${esc(pct(w.pass))}</b></div>
        ${w.series.length ? `<div class="lm-dr-sec">${esc(t('By round'))}</div>${spark(w.series, passing(w))}<div class="lm-muted ltr">${w.series.map(pct).join(' → ')}</div>` : ''}
        ${w.roundTasks.length ? `<div class="lm-dr-sec">${esc(t('This round'))}</div><ul class="lm-dr-list">${w.roundTasks.map((x) => `<li class="lm-${x.verdict === 'pass' ? 'good' : x.verdict === 'fail' ? 'warn' : 'muted'}">${x.verdict === 'pass' ? '✓' : x.verdict === 'fail' ? '✗' : '…'} <span class="ltr">${esc(x.key.replace(/^history:/, 'run '))}</span>${x.failed.length ? ` — ${x.failed.map((c) => esc(t((rubric.find((r) => r.id === c) || {}).label || c))).join(', ')}` : ''}</li>`).join('')}</ul>` : ''}
        <div class="lm-dr-sec">${esc(t('Rules from the coach'))}${w.version ? ` · v${w.version}` : ''}</div>
        <ul class="lm-dr-list">${w.rules.map((r) => `<li>${esc(r)}</li>`).join('') || `<li class="lm-muted">${esc(t('none yet'))}</li>`}</ul>
        <div class="lm-dr-sec">${esc(t('Output contract'))}</div><div class="lm-chips">${w.contract.map((c) => `<em>${esc(c)}</em>`).join('') || '—'}</div>
        <div class="lm-dr-sec">${esc(t('Tools used through the gate'))}</div>
        <ul class="lm-dr-list">${w.tools.map((x) => `<li class="${x.stopped ? 'lm-warn' : ''}"><span class="ltr">${esc(x.name)}</span> · ${x.granted && !x.count ? esc(t('granted, not used yet')) : `${x.count}×${x.stopped ? ` · ${x.stopped} ${esc(t('stopped by the gate'))}` : ''}`}</li>`).join('') || `<li class="lm-muted">${esc(t('none in the last 30 days'))}</li>`}</ul>
        <p><a href="#/agents">${esc(t('Open in Agents'))} →</a> · <a href="#/memory">${esc(t('Its playbook'))} →</a></p>`;
    } else if (kind === 'coach') {
      html = `<div class="lm-dr-head">${avatar('steer', 34)}<div><b>${esc(t('Coach'))}</b><div class="lm-muted">AGT-COACH-001</div></div></div>
        <p>${esc(t('Reads each employee’s graded failures and its playbook, and proposes standing rules to add or remove. It touches only the playbook — never the role, the guards or the permissions — and a rewrite is kept only if the next round scores no lower.'))}</p>
        <div class="lm-dr-row"><span>${esc(t('Rewrites'))}</span><b>${d.coach.rewrites}</b></div>
        ${canManage ? `<div class="lm-dr-sec">${esc(t('Mode'))}</div><div class="lm-seg"><button type="button" data-mode="auto" class="${d.coach.mode === 'auto' ? 'on' : ''}">${esc(t('Keep if better'))}</button><button type="button" data-mode="ask" class="${d.coach.mode === 'ask' ? 'on' : ''}">${esc(t('A person accepts each'))}</button></div>` : ''}
        ${d.loop?.coach?.length ? `<div class="lm-dr-sec">${esc(t('Latest rewrites'))}</div>${d.loop.coach.slice().sort((a, b) => (b.state === 'proposed') - (a.state === 'proposed')).slice(0, 10).map((c) => `<div class="lm-diff lm-diff-${c.state}"><div class="lm-diff-head">${esc(d.workers.find((w) => w.id === c.agent_id)?.name || c.agent_id)} · ${esc(t('round'))} ${c.round} <em>${esc(t(c.state))}</em></div>${c.why ? `<div class="lm-muted" dir="auto">${esc(c.why)}</div>` : ''}${c.removed.map((x) => `<div class="lm-del" dir="auto">− ${esc(x)}</div>`).join('')}${c.added.map((x) => `<div class="lm-add" dir="auto">+ ${esc(x)}</div>`).join('')}${canManage && c.state === 'proposed' ? `<div class="lm-seg"><button type="button" data-rw="${c.id}" data-v="accept">${esc(t('Accept'))}</button><button type="button" data-rw="${c.id}" data-v="reject">${esc(t('Reject'))}</button></div>` : ''}</div>`).join('')}` : ''}`;
    } else if (kind === 'grader' || kind === 'input:rubric') {
      html = `<div class="lm-dr-head">${avatar('assure', 34)}<div><b>${esc(t('Grader'))}</b><div class="lm-muted">${esc(t('The rubric is code — no model grades'))}</div></div></div>
        <p>${esc(t('Every answer is scored against the same checks, so a score cannot be talked up. A task passes only when every check that applies to it holds.'))}</p>
        <ul class="lm-dr-list">${d.inputs.rubric.map((r) => `<li>✓ ${esc(t(r.label))}</li>`).join('')}</ul>
        <div class="lm-dr-row"><span>${esc(t('Graded'))}</span><b>${d.grader.graded}</b></div>`;
    } else if (kind === 'gate') {
      html = `<div class="lm-dr-head"><b>${esc(t('Pass gate'))}</b></div>
        <div class="lm-dr-big">${esc(pct(d.gate.rate))}</div><p>${d.gate.total ? `${d.gate.passed} / ${d.gate.total} ${esc(t('passed'))}` : esc(t('nothing graded yet'))}</p>
        ${d.loop ? `<p class="lm-muted">${esc(t('The loop stops when this reaches the target, or after the last round.'))} ${esc(t('Target'))}: ${Math.round(d.loop.target * 100)}% · ${esc(t('Rounds'))}: ${d.loop.round}/${d.loop.maxRounds}</p>` : `<p class="lm-muted">${esc(t('Out of a loop, this is the share of the last week’s finished runs that did not stop at a person or fail.'))}</p>`}`;
    } else if (kind.startsWith('input:')) {
      const id = kind.slice(6);
      const what = {
        goal: d.loop ? `${t('Reach a pass rate of')} ${Math.round(d.loop.target * 100)}% ${t('within')} ${d.loop.maxRounds} ${t('rounds')}.` : t('No loop is running: the map shows the workforce as it works.'),
        tasks: d.loop ? `${d.inputs.tasks} ${t('tasks')}: ${d.inputs.golden} ${t('golden cases')}, ${d.inputs.history} ${t('from real work')}.` : `${d.inputs.tasks} ${t('finished runs in the last week.')}`,
        history: t('Prompts the employees were really given, replayed as tests — the same tasks every round, so rounds compare.'),
      }[id];
      html = `<div class="lm-dr-head"><b>${esc(t({ goal: 'Goal', tasks: 'Tasks', history: 'History' }[id]))}</b></div><p>${esc(what)}</p>`;
    } else if (kind === 'bot') {
      html = `<div class="lm-dr-head"><b>AlphaCore</b></div><p>${esc(t('The core hands the goal and the tasks to the Grader, and the failures to the Coach. Every wire on this map is a relationship the code really performs, and every particle is work moving along it.'))}</p>`;
    }
    box.innerHTML = `<button type="button" class="lm-x" aria-label="${esc(t('Close'))}">×</button>${html}`;
    box.hidden = false;
    box.querySelector('.lm-x').addEventListener('click', closeDrawer);
    box.querySelectorAll('[data-rw]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/selfimprove/rewrite/${b.dataset.rw}`, { method: 'POST', body: { verdict: b.dataset.v } }); await refresh(); openDrawer('coach'); } catch (err) { toast(err.message, true); }
    }));
    box.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/api/selfimprove/mode', { method: 'POST', body: { mode: b.dataset.mode } }); await refresh(); openDrawer('coach'); } catch (err) { toast(err.message, true); }
    }));
  }

  // ------------------------------------------------- controls, replay --

  $('#lm-wait').addEventListener('click', () => openDrawer('coach'));
  $('#lm-layout').addEventListener('click', () => {
    cards = !cards;
    try { localStorage.setItem('alphacore-lm-cards', cards ? '1' : '0'); } catch { /* fine */ }
    $('#lm-layout').textContent = t(cards ? 'Column' : 'Cards');
    view.fitted = false;
    build();
  });
  function stopReplay() { clearInterval(replayTimer); replayTimer = 0; }
  $('#lm-replay')?.addEventListener('click', () => {
    stopReplay();
    const n = data.loop?.rounds.length || 0;
    let r = 1;
    viewRound = 1; refreshNodes(); paintDynamic(); burst();
    replayTimer = setInterval(() => {
      r += 1;
      if (r > n) { stopReplay(); viewRound = null; refreshNodes(); paintDynamic(); return; }
      viewRound = r === n ? null : r;
      refreshNodes(); paintDynamic(); burst();
    }, 1700);
  });
  $('#lm-stop')?.addEventListener('click', async () => {
    if (!window.confirm(t('Stop this loop? Rewrites already kept stay; nothing else is applied.'))) return;
    try { await api(`/api/selfimprove/${data.loop.id}/stop`, { method: 'POST', body: {} }); await refresh(); } catch (err) { toast(err.message, true); }
  });
  $('#lm-start')?.addEventListener('click', () => {
    const box = $('#lm-drawer');
    drawerFor = null;
    box.innerHTML = `<button type="button" class="lm-x" aria-label="${esc(t('Close'))}">×</button>
      <div class="lm-dr-head"><b>${esc(t('Start a loop'))}</b></div>
      <p class="lm-muted">${esc(t('Each employee is tested on its golden cases and on prompts it was really given; the Coach rewrites the playbooks of those that fail; a rewrite is kept only if the next round scores no lower. Every test is a real model call.'))}</p>
      <form id="lm-start-form" class="lm-form">
        <label>${esc(t('Target pass rate (%)'))}<input name="target" type="number" min="10" max="100" value="95"></label>
        <label>${esc(t('Tasks per employee'))}<input name="batch" type="number" min="1" max="10" value="3"></label>
        <label>${esc(t('Rounds at most'))}<input name="rounds" type="number" min="1" max="10" value="5"></label>
        <button class="lm-btn lm-btn-hot" type="submit">${esc(t('Start'))}</button></form>`;
    box.hidden = false;
    box.querySelector('.lm-x').addEventListener('click', closeDrawer);
    box.querySelector('#lm-start-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('/api/selfimprove', { method: 'POST', body: { target: Number(f.target.value) / 100, batch: Number(f.batch.value), maxRounds: Number(f.rounds.value) } });
        closeDrawer(); viewRound = null; await refresh(true);
      } catch (err) { toast(err.message, true); }
    });
  });

  // ------------------------------------------------------------ data --

  async function refresh(forceBuild = false) {
    if (!alive) return;
    let next;
    if (initial) { next = initial; initial = null; } else {
      try { next = await api(source); } catch (err) {
        if (!data) stage.innerHTML = `<div class="lm-error">${esc(err.message === '403' || /permission/i.test(err.message) ? t('You need the selfimprove.view permission to see the workforce map.') : err.message)}</div>`;
        clearTimeout(timer);
        timer = setTimeout(refresh, 15000);
        return;
      }
    }
    if (!alive) return;
    const shape = (x) => `${x.mode}|${x.loop?.id || ''}|${x.workers.map((w) => `${w.id}:${w.tools.length}`).join(',')}`;
    const rebuild = forceBuild || !data || shape(next) !== shape(data);
    const roundsBefore = data?.loop?.rounds.length || 0;
    data = next;
    if (rebuild) build(); else { refreshNodes(); paintDynamic(); }
    if ((data.loop?.rounds.length || 0) > roundsBefore && roundsBefore) burst();
    if (drawerFor != null && !$('#lm-drawer').hidden) openDrawer('worker', drawerFor);
    clearTimeout(timer);
    const running = data.loop && ['grading', 'coaching', 'waiting'].includes(data.loop.state);
    timer = setTimeout(refresh, running ? 3000 : 12000);
  }

  function destroy() {
    alive = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    stopReplay();
    window.removeEventListener('resize', onResize);
    onDestroy?.();
  }

  refresh(true).then(() => { raf = requestAnimationFrame(frame); });
  return { destroy, refresh };
}
