// The approvals surface: every department behind that door.
//
// Grouped by the same mapping the navigation is drawn from, so a module
// boundary and a menu boundary cannot drift apart.

import { $, esc, money, money4, short, toast, view } from '../core/dom.js';
import { DEPT_LABEL, refreshShell, scoreChip, wireXact, xbtn } from '../components/chrome.js';
import { actor, currentUser, hasPermC } from '../state/session.js';
import { api } from '../services/api.js';
import { tile } from '../components/tile.js';
import { t } from '/i18n.js';
import { kpi, tabs, emptyCta, ago } from '../components/ui.js';

// The desk: everything in the company waiting on a decision, in one list, and
// the switch that decides who makes those decisions — people, or the AI.
//
// Two things the old desk did not do and this one does. It shows every kind of
// waiting item the inbox knows, not four of them; and it lets a person decide
// from here, one item or a group of alike items at once. The AI panel is the
// existing autonomy mode, made usable: which categories it may decide, how sure
// it must be, how many decisions a day, and what it is never offered.
const DESK_LEVELS = [
  ['off', 'People decide', 'Nothing is decided without a person. The AI may still prepare the work.'],
  ['full', 'AI decides routine', 'The AI decides what it is sure of in the categories you allow, and holds anything consequential or uncertain for you.'],
  ['unattended', 'AI decides everything', 'The AI decides every delegable item, holds nothing back, and runs the company-wide sweep. Its mistakes are committed, not caught.'],
];
const URGENCY_CLS = { money: 'chip-bad', incident: 'chip-warn', customer: 'chip-warn', blocking: 'chip-dim', routine: 'chip-dim' };
const VERDICT_CLS = { approve: 'chip-ok', reject: 'chip-bad', hold: 'chip-warn', pending: 'chip-dim' };
// Their own words: 'hold' already means keeping a position on the markets desk.
const VERDICT_LABEL = { approve: 'approved', reject: 'rejected', hold: 'held for you', pending: 'pending' };

export async function renderApprovals() {
  const d = await api('/api/approvals');
  const au = d.autonomy || { mode: 'off', policy: { scope: [], minConfidence: 0.7, maxPerDay: 40, decidedToday: 0 }, categories: [], never: [], log: [] };
  const isOwner = Boolean(currentUser?.isOwner) || hasPermC('owner.rule');
  const cat = new URLSearchParams(location.hash.split('?')[1] || '').get('category') || 'all';
  const items = cat === 'all' ? d.items : d.items.filter((i) => i.category === cat);
  const catLabel = Object.fromEntries((au.categories || []).map((c) => [c.id, c.label]));
  const pol = au.policy;

  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Everything in the company waiting on a decision, ordered by what it blocks rather than by who asked. Decide here — one item, or a group of alike items at once — or hand categories of decisions to the AI below.'))}</p>
  </div>
  <div class="kpis">
    ${kpi('Waiting on you', d.yours, esc(t('that you personally can decide')), d.yours ? 'human' : 'ok')}
    ${kpi('Across the company', d.total, esc(t('waiting on somebody')))}
    ${kpi('Overdue', d.overdue, `${esc(t('past the promise of'))} ${d.slaHours}h`, d.overdue ? 'bad' : '')}
    ${kpi('Oldest', `${Math.round(d.oldestHours)}h`, esc(t('the longest anything has waited')))}
    ${kpi('AI decisions today', `${pol.decidedToday}/${pol.maxPerDay}`, esc(t(au.mode === 'off' ? 'the AI is not deciding' : 'within the daily limit')), au.mode === 'off' ? '' : 'ai')}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Who decides'))}</div>
    <div class="dk-levels" role="radiogroup" aria-label="${esc(t('Who decides'))}">
      ${DESK_LEVELS.map(([id, label, why]) => `<button type="button" class="dk-level ${au.mode === id ? 'on' : ''}" role="radio" aria-checked="${au.mode === id}" data-level="${id}" ${isOwner ? '' : 'disabled'}>
        <b>${esc(t(label))}</b><span>${esc(t(why))}</span></button>`).join('')}
    </div>
    ${isOwner ? '' : `<p class="hint">${esc(t('Only the owner can hand decisions to the AI.'))}</p>`}
    <form id="dk-policy" class="fields" style="margin-top:12px">
      <div class="wide"><span class="fl">${esc(t('What the AI may decide'))}</span>
        <div class="inline">${(au.categories || []).map((c) => `<label class="eng-chk"><input type="checkbox" name="dk-cat" value="${esc(c.id)}" ${pol.scope.includes(c.id) ? 'checked' : ''} ${isOwner ? '' : 'disabled'}> ${esc(t(c.label))}
          <span class="sub">${(d.byCategory.find((x) => x.id === c.id) || {}).count || 0}</span></label>`).join('')}</div></div>
      <div><label class="fl" for="dk-conf">${esc(t('Hold anything it is less sure of than'))}</label>
        <input id="dk-conf" type="number" min="0" max="1" step="0.05" value="${pol.minConfidence}" ${isOwner ? '' : 'disabled'}></div>
      <div><label class="fl" for="dk-max">${esc(t('Most AI decisions a day'))}</label>
        <input id="dk-max" type="number" min="0" max="1000" value="${pol.maxPerDay}" ${isOwner ? '' : 'disabled'}></div>
      ${isOwner ? `<div class="wide"><button class="btn" type="submit">${esc(t('Save'))}</button></div>` : ''}
    </form>
    <div class="callout" style="margin-top:12px"><b>${esc(t('Always a person, whatever the switch says:'))}</b>
      ${esc(t('money leaving the company, orders to a real broker, anything the egress gate held, commands on servers, answers to personal-data requests and tax filings. These are the platform’s rules, not a setting.'))}</div>
  </div>

  ${tabs([['all', 'All', d.total], ...d.byCategory.filter((c) => c.count).map((c) => [c.id, c.label, c.count])], cat)}

  ${d.groups.filter((g) => g.decidable).length ? `<div class="panel">
    <div class="panel-title">${esc(t('Alike enough to decide together'))}</div>
    <p class="hint">${esc(t('A group is recorded as one act that names every item — never as separate entries that read like separate judgements.'))}</p>
    <table class="tbl"><tbody>${d.groups.filter((g) => g.decidable).map((g) => `<tr>
      <td><b>${esc(g.kind)}</b> × ${g.count}<div class="sub">${esc(g.because)}</div></td>
      <td class="sub">${esc(t('oldest'))} ${Math.round(g.oldestHours)}h</td>
      <td class="inline"><button class="btn btn-sm btn-ok" data-decide='${esc(JSON.stringify({ kind: g.kind, ids: g.ids, verdict: 'approve' }))}'>${esc(t('Approve all'))}</button>
        <button class="btn btn-sm btn-ghost" data-decide='${esc(JSON.stringify({ kind: g.kind, ids: g.ids, verdict: 'reject' }))}'>${esc(t('Reject all'))}</button></td></tr>`).join('')}</tbody></table>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">${esc(t('The queue'))} ${cat !== 'all' ? `<span class="hint">${esc(t(catLabel[cat] || cat))}</span>` : ''}</div>
    ${items.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Urgency'))}</th><th>${esc(t('What'))}</th><th>${esc(t('Waiting'))}</th><th></th></tr></thead><tbody>
    ${items.map((i) => `<tr class="${i.overdue ? 'row-bad' : ''}">
      <td><span class="chip ${URGENCY_CLS[i.urgency] || ''}" title="${esc(t(i.whyUrgent))}">${esc(t(i.urgency))}</span></td>
      <td><b>${esc(i.title)}</b><div class="sub">${esc(t(catLabel[i.category] || i.category))} · ${esc(i.kind)} — ${esc(i.because)}</div></td>
      <td class="sub">${i.ageHours}h${i.overdue ? ` · <b>${esc(t('overdue'))}</b>` : ''}</td>
      <td class="inline">${i.decidable
    ? `<button class="btn btn-sm btn-ok" data-decide='${esc(JSON.stringify({ kind: i.kind, ids: [i.id], verdict: 'approve' }))}'>${esc(t('Approve'))}</button>
           <button class="btn btn-sm btn-ghost" data-decide='${esc(JSON.stringify({ kind: i.kind, ids: [i.id], verdict: 'reject' }))}'>${esc(t('Reject'))}</button>`
    : i.action && !i.alwaysHuman
      ? `<button class="btn btn-sm btn-ok" data-post='${esc(JSON.stringify(i.action))}'>${esc(t(i.actionLabel || 'Approve'))}</button>
           ${i.secondary ? `<button class="btn btn-sm btn-ghost" data-post='${esc(JSON.stringify(i.secondary))}'>${esc(t(i.secondary.label || 'Reject'))}</button>` : ''}`
      : ''}
        ${i.alwaysHuman ? `<span class="chip chip-warn">${esc(t('always a person'))}</span>` : ''}
        <a class="btn btn-sm btn-ghost" href="${esc(i.route || '#/approvals')}">${esc(t('Open'))}</a></td></tr>`).join('')}
    </tbody></table></div>` : emptyCta('Nothing is waiting', 'Every gate in the company is clear.')}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('What the AI decided'))}</div>
    ${au.log?.length ? `<div class="mk-scroll"><table class="tbl"><tbody>${au.log.slice(0, 20).map((l) => `<tr class="${l.reverted ? 'muted' : ''}">
      <td><span class="chip ${VERDICT_CLS[l.verdict] || ''}">${esc(t(VERDICT_LABEL[l.verdict] || l.verdict))}</span></td>
      <td><b>${esc(l.title)}</b><div class="sub">${esc(l.reason || '')}${l.outcome ? ` → ${esc(l.outcome)}` : ''}</div></td>
      <td class="sub">${ago(l.created_at)}</td>
      <td>${isOwner && !l.reverted && ['approve', 'reject'].includes(l.verdict) ? `<button class="btn btn-sm btn-ghost" data-revert="${l.id}">${esc(t('Disagree'))}</button>` : l.reverted ? `<span class="chip">${esc(t('disagreed'))}</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${esc(t('The AI has not decided anything yet.'))}</div>`}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Delegation'))}</div>
    <p class="hint">${esc(t('Bounded in time, always. Both names go on the chain: who acted, and whose authority they were carrying.'))}</p>
    ${[...d.delegations.toMe.map((x) => `<div>${esc(t('carrying the authority of'))} <b>${esc(x.from_username)}</b> — ${esc(x.expires_at)}</div>`),
    ...d.delegations.fromMe.map((x) => `<div>${esc(t('lent to'))} <b>${esc(x.to_username)}</b> — ${esc(x.expires_at)}</div>`)].join('') || `<div class="sub">${esc(t('Nobody is standing in for anybody.'))}</div>`}
  </div>`;

  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    location.hash = b.dataset.tab === 'all' ? '#/approvals' : `#/approvals?category=${encodeURIComponent(b.dataset.tab)}`;
  }));
  view.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', async () => {
    const spec = JSON.parse(b.dataset.decide);
    if (spec.ids.length > 1 && !window.confirm(`${t(spec.verdict === 'approve' ? 'Approve' : 'Reject')} ${spec.ids.length}?`)) return;
    b.disabled = true;
    try {
      const r = await api('/api/approvals/decide', { method: 'POST', body: spec });
      toast(r.failed?.length ? `${r.decided} ✓ · ${r.failed.length} ✗ — ${r.failed[0].error}` : t('Decided'), Boolean(r.failed?.length));
      renderApprovals(); refreshShell();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  view.querySelectorAll('[data-post]').forEach((b) => b.addEventListener('click', async () => {
    const spec = JSON.parse(b.dataset.post);
    b.disabled = true;
    try { await api(spec.path, { method: spec.method || 'POST', body: spec.body || {} }); toast(t('Decided')); renderApprovals(); refreshShell(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  view.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', async () => {
    const level = b.dataset.level;
    if (level === au.mode) return;
    if (level !== 'off' && !window.confirm(t(level === 'unattended'
      ? 'Let the AI decide everything it is allowed to, holding nothing back? Its mistakes will be committed, not caught. You can switch back at any moment.'
      : 'Let the AI decide routine items in the categories you allow? It holds anything consequential or uncertain for you.'))) return;
    try { await api('/api/autonomy/toggle', { method: 'POST', body: { level } }); toast(t('Saved')); renderApprovals(); refreshShell(); }
    catch (e) { toast(e.message, true); }
  }));
  $('#dk-policy')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/autonomy/policy', { method: 'POST', body: {
        scope: [...view.querySelectorAll('[name="dk-cat"]:checked')].map((x) => x.value),
        minConfidence: Number($('#dk-conf').value), maxPerDay: Number($('#dk-max').value),
      } });
      toast(t('Saved')); renderApprovals();
    } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('[data-revert]').forEach((b) => b.addEventListener('click', async () => {
    const note = window.prompt(t('What was wrong with this decision?'));
    if (note === null) return;
    try { await api(`/api/autonomy/${b.dataset.revert}/revert`, { method: 'POST', body: { note } }); toast(t('Recorded — undo its effect on its own page')); renderApprovals(); }
    catch (e) { toast(e.message, true); }
  }));
  reachPanel().catch(() => { /* the desk stands without it */ });
}

/**
 * Your own phone: a Telegram chat linked to this account hears within a minute
 * that something waits for you, and once a morning what is waiting. A link to
 * the desk, never a button that decides.
 */
async function reachPanel() {
  const r = await api('/api/account/reach');
  const off = Math.round(new Date().getTimezoneOffset() / -60);
  const toLocal = (h) => ((h + off) % 24 + 24) % 24;
  const toUtc = (h) => ((h - off) % 24 + 24) % 24;
  const box = document.createElement('div');
  box.className = 'panel';
  box.innerHTML = `<div class="panel-title">${esc(t('Reach me on my phone'))}</div>
    <p class="hint">${esc(t('A Telegram message when something you can decide arrives, and a morning summary. It carries a link to this desk — deciding still happens here, behind your password and code.'))}</p>
    ${!r.ready ? `<p class="sub">${esc(t('Telegram is not connected yet — an administrator connects the company bot under Integrations.'))}</p>`
    : r.linked ? `<form id="rc-prefs" class="fields">
        <div class="wide"><span class="chip chip-ok">${esc(t('linked'))}</span></div>
        <div class="wide"><label class="eng-chk"><input type="checkbox" id="rc-instant" ${r.instant ? 'checked' : ''}> ${esc(t('Tell me as soon as something arrives'))}</label></div>
        <div><label class="fl" for="rc-hour">${esc(t('Morning summary at'))}</label><select id="rc-hour"><option value="-1">${esc(t('none'))}</option>${Array.from({ length: 24 }, (_, h) => `<option value="${toUtc(h)}" ${r.digestHour >= 0 && toLocal(r.digestHour) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
        <div class="wide inline"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button><button class="btn btn-sm btn-ghost" type="button" id="rc-unlink">${esc(t('Unlink'))}</button></div></form>`
      : `<form id="rc-link" class="fields">
        <div><label class="fl" for="rc-chat">${esc(t('Telegram chat id'))}</label><input id="rc-chat" inputmode="numeric" required value="${esc(r.chatId || '')}"></div>
        <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Send me a code'))}</button></div></form>
        ${r.pending ? `<form id="rc-confirm" class="fields"><div><label class="fl" for="rc-code">${esc(t('Code'))}</label><input id="rc-code" inputmode="numeric" maxlength="6" required></div>
          <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Confirm'))}</button></div></form>` : ''}`}`;
  view.appendChild(box);
  const post = async (path, body, okText) => {
    try { const x = await api(path, { method: 'POST', body }); if (okText) toast(t(okText)); renderApprovals(); return x; } catch (e) { toast(e.message, true); return null; }
  };
  box.querySelector('#rc-link')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = await post('/api/account/reach/link', { chatId: $('#rc-chat').value });
    if (x && !x.sent) toast(`${t('The gate did not send it')}: ${x.why || x.verdict}`, true);
  });
  box.querySelector('#rc-confirm')?.addEventListener('submit', (e) => { e.preventDefault(); post('/api/account/reach/confirm', { code: $('#rc-code').value }, 'Linked'); });
  box.querySelector('#rc-prefs')?.addEventListener('submit', (e) => { e.preventDefault(); post('/api/account/reach/prefs', { instant: $('#rc-instant').checked, digestHour: Number($('#rc-hour').value) }, 'Saved'); });
  box.querySelector('#rc-unlink')?.addEventListener('click', () => post('/api/account/reach/unlink', {}, 'Unlinked'));
}
export async function renderGate() {
  const [box, runs] = await Promise.all([
    api('/api/inbox'), api('/api/runs?state=awaiting_human').catch(() => []),
  ]);
  const runById = Object.fromEntries(runs.map((r) => [r.id, r]));
  const groups = {};
  for (const i of box.items) (groups[i.dept] ||= []).push(i);
  const age = (h) => (h >= 48 ? `${Math.round(h / 24)}d` : h >= 1 ? `${Math.round(h)}h` : 'just now');

  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile ${box.total ? 'tile-warn' : ''}"><div class="panel-title">Waiting on you</div><div class="big">${box.total}</div><div class="sub">across ${Object.keys(groups).length} department(s)</div></div>
    <div class="panel tile ${box.high ? 'tile-warn' : ''}"><div class="panel-title">Needs attention first</div><div class="big">${box.high}</div><div class="sub">gates, sends, live copy, incidents</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">One-click answers</div><div class="big">${box.actionable}</div><div class="sub">approve or send without leaving this page</div></div>
    <div class="panel tile"><div class="panel-title">Oldest item</div><div class="big" style="font-size:24px;padding-top:6px">${box.total ? age(box.oldestHours) : '—'}</div><div class="sub">nothing should wait for days</div></div>
  </div>

  ${box.total ? Object.entries(groups).map(([dept, items]) => `
  <div class="panel">
    <div class="panel-title"><span>${esc(DEPT_LABEL[dept] || dept)} — ${items.length}</span>
      <a class="chip chip-dim" style="text-decoration:none" href="${esc(items[0].href)}">open the section →</a></div>
    ${items.map((i) => `
      <div class="inbox-row ${esc(i.severity)}">
        <div class="ib-main">
          <a class="ib-title" href="${esc(i.href)}">${esc(i.title)}</a>
          ${i.sub ? `<div class="ib-sub">${esc(i.sub)}</div>` : ''}
          ${i.kind === 'run' && runById[i.id]?.output ? `<pre class="json" style="max-height:180px;margin-top:6px">${esc(JSON.stringify(runById[i.id].output.parsed ?? runById[i.id].output, null, 2).slice(0, 900))}</pre>` : ''}
        </div>
        <div class="ib-age mono">${age(i.ageHours)}</div>
        <div class="ib-actions">
          ${i.action ? `<button class="btn btn-sm btn-ok" data-ib='${esc(JSON.stringify(i.action))}' data-label="${esc(i.actionLabel)}">${esc(i.actionLabel)}</button>` : ''}
          ${i.secondary ? `<button class="btn btn-sm ${i.secondary.label === 'Reject' ? 'btn-bad' : ''}" data-ib='${esc(JSON.stringify(i.secondary))}' data-label="${esc(i.secondary.label)}">${esc(i.secondary.label)}</button>` : ''}
          ${!i.action && !i.secondary ? `<a class="btn btn-sm" href="${esc(i.href)}">Open</a>` : ''}
        </div>
      </div>`).join('')}
  </div>`).join('') : `
  <div class="panel"><div class="empty">Nothing anywhere in the company is waiting on a person. Every department reports here — publishing, sending, signing, gate verdicts, design review, verification — so this being empty means it is genuinely empty.</div></div>`}

  <div class="panel">
    <div class="map-legend">
      This queue collects <b>every</b> point where the platform stops for a human, from every department:
      run gate · design documents · social publishing · content approval · design sign-off · campaign go-live ·
      partner outreach · support replies · journey stages · financial reports · decisions · contracts ·
      product gates · intel and knowledge verification · problems, rituals and critical risks · and whatever the
      <a href="#/harmony">orchestrator</a> escalated. If something can wait on you, it appears here — the section
      pages remain the place to read the full context before you answer.
    </div>
  </div>`;

  view.querySelectorAll('[data-ib]').forEach((b) => b.addEventListener('click', async () => {
    let spec;
    try { spec = JSON.parse(b.dataset.ib); } catch { return; }
    b.disabled = true;
    try {
      await api(spec.path, { method: spec.method || 'POST', body: spec.body || {} });
      toast(`${b.dataset.label} — recorded as ${actor()}`);
      renderGate(); refreshShell();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}
export async function renderDecisions() {
  const list = await api('/api/decisions');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Register a decision</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="dec-title">Title</label><input type="text" id="dec-title" placeholder="What is being decided?"></div>
      <div><label class="fl" for="dec-tier">Tier</label><select id="dec-tier" aria-label="Tier"><option>T1</option><option selected>T2</option><option>T3</option></select></div>
      <div><label class="fl" for="dec-owner">Owner (human)</label><input type="text" id="dec-owner" value="CTO"></div>
      <button class="btn btn-primary" id="dec-go">Register</button>
    </div>
    <div><label class="fl" for="dec-context">Context</label><textarea id="dec-context" placeholder="Two-four sentences: what question, why now."></textarea></div>
  </div>
  <div class="panel">
    <div class="panel-title">Registry</div>
    <table>
      <thead><tr><th>ID</th><th>Title</th><th>Tier</th><th>Status</th><th>Owner</th><th class="num">Consensus</th><th>Expiry</th></tr></thead>
      <tbody>${list.map((d) => `
        <tr class="rowlink" onclick="location.hash='#/decisions/${esc(d.id)}'">
          <td class="mono">${esc(d.id)}</td><td>${esc(short(d.title, 56))}</td>
          <td class="mono">${esc(d.tier)}</td>
          <td><span class="state state-${d.status === 'approved' || d.status === 'approved_cond' ? 'done' : d.status === 'rejected' ? 'failed' : d.status === 'escalated' ? 'escalated' : 'awaiting_human'}">${esc(d.status)}</span></td>
          <td>${esc(d.owner_human)}</td>
          <td class="num">${d.consensus_score != null ? Number(d.consensus_score).toFixed(2) : '—'}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(d.expires_at || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">No decisions yet — the registry exists before the platform does.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#dec-go').addEventListener('click', async () => {
    try {
      const d = await api('/api/decisions', { method: 'POST', body: { title: $('#dec-title').value, tier: $('#dec-tier').value, owner: $('#dec-owner').value, context: $('#dec-context').value, actor: actor() } });
      location.hash = `#/decisions/${d.id}`;
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderEvals() {
  const data = await api('/api/evals');
  view.innerHTML = `
  <div class="grid grid-3">
    ${data.sets.map((s) => `
    <div class="panel agent-card">
      <div class="agent-head"><span class="agent-name">${esc(s.agentId)}</span><span class="chip ${s.kind === 'canary' ? 'chip-ember' : 'chip-dim'}">${esc(s.kind)}</span></div>
      <div class="agent-meta">${s.cases.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <div class="map-legend">${s.lastRun ? `last: ${(s.lastRun.score * 100).toFixed(0)}% (${s.lastRun.passed}/${s.lastRun.total}) · ${esc(s.lastRun.created_at)}` : 'never run'}</div>
      <div><button class="btn btn-primary btn-sm" data-eval="${esc(s.agentId)}">Run set (live usage)</button></div>
    </div>`).join('')}
  </div>
  <div class="panel">
    <div class="panel-title">Eval history — scores feed the reputation factor (hard-capped 0.85–1.15)</div>
    <table>
      <thead><tr><th>Agent</th><th>Kind</th><th class="num">Score</th><th class="num">Passed</th><th>Cases</th><th class="num">Cost</th><th>When</th></tr></thead>
      <tbody>${data.runs.map((r) => `
        <tr><td class="mono">${esc(r.agent_id)}</td><td class="mono">${esc(r.kind)}</td>
        <td class="num" style="color:${r.score >= 0.9 ? 'var(--ok)' : r.score >= 0.6 ? 'var(--warn)' : 'var(--bad)'}">${(r.score * 100).toFixed(0)}%</td>
        <td class="num">${r.passed}/${r.total}</td>
        <td class="mono" style="font-size:11px">${r.details.map((d) => `${esc(d.name)}:${d.verdict === 'pass' ? '✓' : '✗'}`).join(' ')}</td>
        <td class="num">${esc(money4(r.cost_usd))}</td>
        <td class="mono" style="color:var(--ink-faint)">${esc(r.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No eval runs yet.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  view.querySelectorAll('[data-eval]').forEach((b) => b.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Running…';
    try {
      const r = await api('/api/evals/run', { method: 'POST', body: { agentId: b.dataset.eval, actor: actor() } });
      toast(`${r.agentId}: ${(r.score * 100).toFixed(0)}% (${r.passed}/${r.total})`); renderEvals();
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Run set (live usage)'; }
  }));
}
export async function renderRisks() {
  const risks = await api('/api/risks');
  const scoreChip = (sc) => `<span class="chip ${sc >= 16 ? 'chip-bad' : sc >= 9 ? 'chip-warn' : 'chip-dim'}">${sc}</span>`;
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New risk — likelihood × impact, residual after designed controls (Part 7 §1)</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="rk-title">Title</label><input type="text" id="rk-title"></div>
      <div style="flex:0.4"><label class="fl" for="rk-l">L 1-5</label><input type="text" id="rk-l" value="3"></div>
      <div style="flex:0.4"><label class="fl" for="rk-i">I 1-5</label><input type="text" id="rk-i" value="3"></div>
      <div><label class="fl" for="rk-owner">Owner</label><input type="text" id="rk-owner" value="${esc(currentUser?.username || '')}"></div>
      <div><label class="fl" for="rk-review">Review</label><input type="text" id="rk-review" placeholder="2026-11-01"></div>
      <button class="btn btn-primary" id="rk-go">Register</button>
    </div>
    <div><label class="fl" for="rk-mit">Mitigation</label><input type="text" id="rk-mit"></div>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>Risk</th><th class="num">L</th><th class="num">I</th><th class="num">Score</th><th>Mitigation</th><th>Owner</th><th>Review</th><th>State</th><th></th></tr></thead>
      <tbody>${risks.map((r) => `
        <tr style="${r.state === 'closed' ? 'opacity:.5' : ''}">
          <td>${esc(r.title)}${r.source === 'blueprint' ? ' <span class="chip chip-dim">blueprint</span>' : ''}</td>
          <td class="num">${r.likelihood}</td><td class="num">${r.impact}</td>
          <td class="num">${scoreChip(r.score)}</td>
          <td>${esc(short(r.mitigation || '—', 60))}</td>
          <td class="mono">${esc(r.owner)}</td>
          <td class="mono" style="color:${r.review_date && r.review_date < new Date().toISOString().slice(0, 10) ? 'var(--bad)' : 'var(--ink-faint)'}">${esc(r.review_date || '—')}</td>
          <td><span class="state state-${r.state === 'open' ? 'failed' : r.state === 'closed' ? 'done' : 'awaiting_human'}">${esc(r.state)}</span></td>
          <td>${r.state !== 'closed' ? ['mitigated', 'accepted', 'closed'].filter((x) => x !== r.state).map((x) => `<button class="btn btn-sm" data-rk="${r.id}" data-to="${x}">${x}</button>`).join(' ') : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
  $('#rk-go').addEventListener('click', async () => {
    try { await api('/api/risks', { method: 'POST', body: { title: $('#rk-title').value, likelihood: $('#rk-l').value, impact: $('#rk-i').value, mitigation: $('#rk-mit').value || null, owner: $('#rk-owner').value, reviewDate: $('#rk-review').value || null } }); renderRisks(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-rk]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/risks/${b.dataset.rk}/state`, { method: 'POST', body: { state: b.dataset.to } }); renderRisks(); } catch (e) { toast(e.message, true); }
  }));
}
export async function renderQuality() {
  const qd = await api('/api/quality');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile ${qd.evalAvg != null && qd.evalAvg < 0.8 ? 'tile-warn' : ''}"><div class="panel-title">Eval average (last 10)</div><div class="big">${qd.evalAvg != null ? Math.round(qd.evalAvg * 100) + '<span class="unit">%</span>' : '—'}</div><div class="sub"><a href="#/evals">run the sets →</a></div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Last canary</div><div class="big">${qd.canaryLast ? Math.round(qd.canaryLast.score * 100) + '<span class="unit">%</span>' : '—'}</div><div class="sub">${qd.canaryLast ? esc(qd.canaryLast.created_at.slice(0, 10)) : 'never run'}</div></div>
    <div class="panel tile ${qd.failedRuns7d ? 'tile-warn' : ''}"><div class="panel-title">Failed runs · 7d</div><div class="big">${qd.failedRuns7d}</div><div class="sub"><a href="#/runs">runs →</a></div></div>
    <div class="panel tile ${qd.openProblems + qd.openIncidents ? 'tile-warn' : ''}"><div class="panel-title">Open problems + incidents</div><div class="big">${qd.openProblems + qd.openIncidents}</div><div class="sub"><a href="#/incidents">incidents →</a> · <a href="#/governance">problems →</a></div></div>
  </div>
  <div class="panel">
    <div class="panel-title">Manual quality review — drills are the proof (Part 5 §1.5)</div>
    <div class="form-inline">
      <div style="flex:1.5"><label class="fl" for="qr-area">Area audited</label><input type="text" id="qr-area" placeholder="e.g. backup restore drill, support drafts sample"></div>
      <div><label class="fl" for="qr-verdict">Verdict</label><select id="qr-verdict" aria-label="Verdict"><option>pass</option><option>fail</option></select></div>
      <button class="btn btn-primary" id="qr-go">Record</button>
    </div>
    <div><label class="fl" for="qr-notes">Notes</label><input type="text" id="qr-notes"></div>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>Area</th><th>Verdict</th><th>Notes</th><th>Reviewer</th><th>When</th></tr></thead>
      <tbody>${qd.reviews.map((r) => `
        <tr><td>${esc(r.area)}</td>
        <td><span class="chip ${r.verdict === 'pass' ? 'chip-ok' : 'chip-bad'}">${esc(r.verdict)}</span></td>
        <td>${esc(short(r.notes || '—', 70))}</td>
        <td class="mono">${esc(r.reviewer)}</td>
        <td class="mono" style="color:var(--ink-faint)">${esc(r.created_at.slice(0, 16))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No reviews recorded.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#qr-go').addEventListener('click', async () => {
    try { await api('/api/quality/review', { method: 'POST', body: { area: $('#qr-area').value, verdict: $('#qr-verdict').value, notes: $('#qr-notes').value || null } }); renderQuality(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderBudgets() {
  const rows = await api('/api/budgets');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Budget scopes — reservation-first; the hard stop fires before the call</div>
    <table>
      <thead><tr><th>Scope</th><th>ID</th><th>Period</th><th style="width:30%">Consumption</th><th class="num">Spent</th><th class="num">Cap</th><th></th></tr></thead>
      <tbody>${rows.map((b) => {
        const pct = Math.min(100, ((b.spent_usd + b.reserved_usd) / b.cap_usd) * 100);
        return `
        <tr>
          <td class="mono">${esc(b.scope)}</td><td class="mono">${esc(b.scope_id)}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(b.period_key)}</td>
          <td><div class="meter-track"><div class="meter-fill ${pct > 80 ? 'hot' : pct > 50 ? '' : 'cool'}" style="width:${pct}%"></div></div></td>
          <td class="num">${esc(money4(b.spent_usd))}</td>
          <td class="num">${esc(money(b.cap_usd))}</td>
          <td>${b.frozen
            ? `<button class="btn btn-sm btn-ok" data-freeze="0" data-scope="${esc(b.scope)}" data-sid="${esc(b.scope_id)}">Unfreeze</button>`
            : `<button class="btn btn-sm btn-bad" data-freeze="1" data-scope="${esc(b.scope)}" data-sid="${esc(b.scope_id)}">Freeze</button>`}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">No budget rows yet — they materialize on first spend.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  view.querySelectorAll('[data-freeze]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/budgets/freeze', { method: 'POST', body: { scope: b.dataset.scope, scopeId: b.dataset.sid, frozen: b.dataset.freeze === '1', actor: actor() } });
      toast(b.dataset.freeze === '1' ? 'Scope frozen' : 'Scope unfrozen — human decision recorded'); renderBudgets();
    } catch (e) { toast(e.message, true); }
  }));
}
// ---------- The shadow company ----------
export async function renderSimulation() {
  const d = await api('/api/simulation');
  const canRun = hasPermC('simulation.run');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Simulations run', d.counts.total, `${d.counts.done} finished`)}
    ${tile('Levers available', d.levers.length, 'each one a small, readable change')}
    ${tile('Measured on', d.metrics.length, 'the same numbers as the real company')}
    ${tile('Company right now', d.now.runs, `${d.now.customers} customers · ${Number(d.now.spendUsd || 0).toFixed(2)} spent`)}
  </div>

  ${canRun ? `
  <div class="panel">
    <div class="panel-title">Ask a question you cannot afford to answer for real</div>
    <div class="form-grid">
      <input id="sm-name" placeholder="a short name, e.g. marketing cut">
      <textarea id="sm-q" rows="2" placeholder="What happens if we cut marketing by forty per cent?"></textarea>
      <div class="form-inline">
        <select id="sm-lever" aria-label="Lever">${d.levers.map((l) => `<option value="${esc(l.id)}">${esc(l.id)} — ${esc(l.describe)}</option>`).join('')}</select>
        <input id="sm-arg" placeholder='{"factor": 0.6}' style="width:180px">
        <button class="btn btn-primary" id="sm-run">Fork and run</button>
      </div>
    </div>
    <div class="map-legend">The fork is a copy of the database on disk with its connectors switched off. A simulated employee <b>cannot</b> send an email — not because a policy forbids it, but because the file it is working in is not connected to anything.</div>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">Runs</div>
    <table><thead><tr><th>#</th><th>Question</th><th>What changed</th><th>State</th><th>When</th><th></th></tr></thead><tbody>
    ${d.simulations.map((s) => `<tr><td class="mono">${s.id}</td>
      <td><b>${esc(s.name)}</b><div class="sub">${esc(short(s.question, 70))}</div></td>
      <td class="mono sub">${esc(short(s.verdict || '', 40))}</td>
      <td><span class="chip ${s.state === 'done' ? 'chip-ok' : s.state === 'failed' ? 'chip-bad' : 'chip-dim'}">${esc(s.state)}</span></td>
      <td class="mono sub">${esc(String(s.created_at).slice(5, 16))}</td>
      <td><button class="btn btn-sm" data-simopen="${s.id}">Compare</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nothing has been simulated yet.</td></tr>'}
    </tbody></table>
    <div id="sm-out"></div>
  </div>`;

  $('#sm-run')?.addEventListener('click', async () => {
    let arg = {};
    try { arg = JSON.parse($('#sm-arg').value || '{}'); } catch { return toast('The lever argument must be JSON', true); }
    try {
      const r = await api('/api/simulation', { method: 'POST', body: {
        name: $('#sm-name').value.trim() || 'simulation',
        question: $('#sm-q').value.trim() || 'what happens?',
        changes: [{ lever: $('#sm-lever').value, ...arg }],
      } });
      toast('Ran'); renderSimulation();
      setTimeout(() => document.querySelector(`[data-simopen="${r.id}"]`)?.click(), 200);
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-simopen]').forEach((b) => b.addEventListener('click', async () => {
    const s = await api(`/api/simulation/${b.dataset.simopen}`);
    $('#sm-out').innerHTML = `
      <div class="sub" style="margin:12px 0"><b>${esc(s.name)}</b> — ${esc(s.question)}<br>changed: <span class="mono">${esc(s.verdict || '')}</span></div>
      <table><thead><tr><th>Measure</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>
      ${Object.entries(s.delta).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td>
        <td class="num mono">${v.before}</td><td class="num mono">${v.after}</td>
        <td class="num mono" style="color:${v.change > 0 ? 'var(--ok)' : v.change < 0 ? 'var(--bad)' : 'var(--ink-faint)'}">${v.change > 0 ? '+' : ''}${v.change}${v.percent !== null ? ` (${v.percent > 0 ? '+' : ''}${v.percent}%)` : ''}</td></tr>`).join('')}
      </tbody></table>`;
  }));
}
export async function renderPmo() {
  const [d, projects] = await Promise.all([api('/api/pmo'), api('/api/projects').catch(() => [])]);
  const canM = hasPermC('pmo.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Pending gates', d.stats.pending, 'waiting for a human ruling', d.stats.pending ? 'tile-warn' : '')}
    ${tile('Passed', d.stats.passed, 'crossings approved')}
    ${tile('Failed', d.stats.failed, 'work sent back')}
    <div class="panel tile"><div class="panel-title">New gate</div>
      ${canM ? `<div class="form-inline" style="flex-direction:column;align-items:stretch;gap:6px">
        <select id="pg-proj" aria-label="Project">${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <input id="pg-gate" placeholder="gate, e.g. Design freeze">
        <button class="btn btn-sm btn-primary" id="pg-go">Create</button></div>` : '<div class="sub">pmo.manage required</div>'}</div>
  </div>
  <div class="panel"><div class="panel-title">Stage gates across all projects</div>
    <table><thead><tr><th>#</th><th>Project</th><th>Gate</th><th>State</th><th>Approver</th><th></th></tr></thead><tbody>
    ${d.gates.map((x) => `<tr>
      <td class="mono">${x.id}</td><td>${esc(x.project_name || x.project_id)}</td><td>${esc(x.gate)}</td>
      <td><span class="chip ${x.state === 'passed' ? 'chip-ok' : x.state === 'failed' ? 'chip-bad' : 'chip-warn'}">${esc(x.state)}</span></td>
      <td class="mono">${esc(x.approver || '—')}</td>
      <td>${canM && x.state === 'pending' ? xbtn(`/api/pmo/${x.id}/resolve`, { state: 'passed' }, 'Pass', 'btn-ok') + xbtn(`/api/pmo/${x.id}/resolve`, { state: 'failed' }, 'Fail', 'btn-bad') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No gates yet.</td></tr>'}
    </tbody></table></div>`;
  wireXact(renderPmo);
  $('#pg-go')?.addEventListener('click', async () => {
    try { await api('/api/pmo', { method: 'POST', body: { projectId: $('#pg-proj').value, gate: $('#pg-gate').value } }); toast('Gate created'); renderPmo(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderAuditor() {
  const d = await api('/api/auditor');
  const canR = hasPermC('auditor.request');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Average score', d.stats.avgScore == null ? '—' : `${Math.round(d.stats.avgScore * 100)}<span class="unit">%</span>`, 'across every audited department')}
    ${tile('Auditing now', d.stats.running, 'in flight')}
    ${tile('Failed', d.stats.failed, 'rejected by the auditor', d.stats.failed ? 'tile-bad' : '')}
    ${tile('All-time', d.stats.total, 'artifacts judged')}
  </div>
  <div class="panel">
    <div class="panel-title">Send anything to the auditor — one standard, every department</div>
    ${canR ? `<div class="form-inline" style="flex-wrap:wrap">
      <select id="au-type" aria-label="Type" style="width:auto">
        <option value="content">content item</option><option value="post">social post</option>
        <option value="ticket">support draft</option><option value="release">release notes</option>
        <option value="brand">brand asset</option><option value="bulletin">bulletin</option>
        <option value="irUpdate">investor update</option><option value="boardRecord">board packet</option>
        <option value="finReport">financial report</option><option value="campaign">campaign copy</option>
        <option value="run">agent run</option><option value="cycle">workstream round</option>
      </select>
      <input id="au-id" placeholder="id" style="width:100px">
      <input id="au-dept" placeholder="department (optional)" style="width:150px">
      <button class="btn btn-sm btn-primary" id="au-go">Audit it</button>
    </div>` : '<div class="map-legend">auditor.request required.</div>'}
  </div>
  ${d.byDept.length ? `<div class="panel"><div class="panel-title">Quality by department — worst first</div>
    <table><thead><tr><th>Department</th><th class="num">Audits</th><th style="width:40%">Average</th></tr></thead><tbody>
    ${d.byDept.map((r) => `<tr><td class="mono">${esc(r.dept)}</td><td class="num">${r.n}</td>
      <td><div class="meter-track"><div class="meter-fill ${r.avg < 0.6 ? 'hot' : r.avg >= 0.85 ? 'cool' : ''}" style="width:${Math.round(r.avg * 100)}%"></div></div></td></tr>`).join('')}
    </tbody></table></div>` : ''}
  <div class="panel">
    <div class="panel-title">Audit log</div>
    <table><thead><tr><th>#</th><th>Subject</th><th>Dept</th><th>Score</th><th>Verdict</th><th>Findings</th></tr></thead><tbody>
    ${d.audits.map((a) => `<tr>
      <td class="mono">${a.id}</td><td class="mono">${esc(a.subject_type)} #${esc(a.subject_id)}</td>
      <td class="mono">${esc(a.dept || '—')}</td><td>${a.state === 'running' ? '<span class="chip chip-warn">auditing…</span>' : scoreChip(a.score)}</td>
      <td>${a.verdict ? `<span class="chip ${a.verdict === 'pass' ? 'chip-ok' : a.verdict === 'fail' ? 'chip-bad' : 'chip-warn'}">${esc(a.verdict)}</span>` : ''}</td>
      <td>${(a.findings || []).slice(0, 3).map((f) => `<div class="map-legend">— ${esc(short(f, 110))}</div>`).join('') || (a.summary ? `<div class="map-legend">${esc(short(a.summary, 130))}</div>` : '')}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing audited yet.</td></tr>'}
    </tbody></table>
  </div>`;
  $('#au-go')?.addEventListener('click', async () => {
    try {
      await api('/api/auditor', { method: 'POST', body: { subjectType: $('#au-type').value, subjectId: $('#au-id').value, dept: $('#au-dept').value || null } });
      toast('Auditor working'); renderAuditor();
    } catch (e) { toast(e.message, true); }
  });
}
