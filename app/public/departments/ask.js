// The ask surface: every department behind that door.
//
// Grouped by the same mapping the navigation is drawn from, so a module
// boundary and a menu boundary cannot drift apart.

import { $, esc, linkFor, money, money4, short, toast, view } from '../core/dom.js';
import { CHAT_EMOJI, REQ_STATE_CLS, bubble, chatState, connBtn, wireConnections, wireDownloads } from '../components/common.js';
import { actor, hasPermC } from '../state/session.js';
import { api } from '../services/api.js';
import { tile } from '../components/tile.js';
import { t } from '/i18n.js';

// The hunt: one pass across everything, or a search that keeps going until it
// finds the answer or runs out of leads, rounds or money.
export async function renderHunt() {
  const h = await api('/api/hunt');
  const src = (s) => `<div class="meter-label"><span>${esc(s.label)}</span><span class="chip ${s.reachesOutside ? 'chip-warn' : 'chip-dim'}">${s.reachesOutside ? 'leaves the building' : 'internal'}</span></div>`;
  const past = (r) => `<tr><td>${esc(r.question)}</td><td><span class="chip ${r.state === 'found' ? 'chip-ok' : 'chip-dim'}">${esc(r.state)}</span></td><td class="num">${r.rounds}</td><td class="num">${esc(money4(r.cost_usd || 0))}</td><td class="sub">${esc(r.stopped || '')}</td></tr>`;
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title"><span>Ask</span><span class="chip chip-dim">${h.tablesSearched} tables · ${h.sources.length} sources</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="hunt-q" class="input" placeholder="What do you want to know?" aria-label="What do you want to know?" style="flex:1;min-width:220px">
      <button class="btn" id="hunt-look">Look</button>
      <button class="btn btn-primary" id="hunt-go">Hunt</button>
    </div>
    <div class="map-legend" style="margin-top:8px">
      <strong>Look</strong> is one pass across every table, the knowledge graph and what the agents remember — instant and free.
      <strong>Hunt</strong> reads what came back, judges whether it actually answers the question, works out what to ask next from what it just learned, and goes again — up to ${h.maxRounds} rounds or ${esc(money(h.maxUsd))}, whichever comes first. It reaches the open web. If it does not find the answer it says so; it never offers a guess.
    </div>
    <div id="hunt-out" style="margin-top:12px"></div>
  </div>

  <div class="grid grid-3">
    <div class="panel tile"><div class="panel-title">Hunts</div><div class="big">${h.total}</div><div class="sub">${h.found} found${h.foundRate !== null ? ` · ${h.foundRate}%` : ''}</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Spent</div><div class="big">${esc(money(h.spentUsd))}</div><div class="sub">across every hunt ever run</div></div>
    <div class="panel"><div class="panel-title">Where it looks</div>${h.sources.map(src).join('')}</div>
  </div>

  <div class="panel">
    <div class="panel-title">Every hunt, and what it tried</div>
    ${h.recent.length
    ? `<div class="table-wrap"><table><thead><tr><th>Question</th><th>Result</th><th class="num">Rounds</th><th class="num">Cost</th><th>Why it stopped</th></tr></thead><tbody>${h.recent.map(past).join('')}</tbody></table></div>`
    : '<div class="empty">nothing asked yet</div>'}
  </div>`;

  const out = $('#hunt-out');
  const term = () => $('#hunt-q').value.trim();

  $('#hunt-look').addEventListener('click', async () => {
    if (!term()) return;
    out.innerHTML = '<div class="empty">looking…</div>';
    try {
      const r = await api(`/api/hunt/lookup?q=${encodeURIComponent(term())}`);
      const hit = (x) => `<tr><td><span class="chip chip-dim">${esc(x.source)}</span></td><td class="mono">${esc(x.where)}</td><td>${esc(x.title)}<div class="sub">${esc(String(x.snippet || '').slice(0, 160))}</div></td></tr>`;
      out.innerHTML = r.total
        ? `<div class="panel-title">${r.total} hit(s) across ${r.tablesSearched} tables</div>
           <div class="table-wrap"><table><thead><tr><th>Source</th><th>Found in</th><th>What</th></tr></thead><tbody>${r.hits.map(hit).join('')}</tbody></table></div>
           <div class="map-legend">${esc(r.note)}</div>`
        : '<div class="empty">nothing matched. A hunt would keep going and follow what it learns.</div>';
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  });

  $('#hunt-go').addEventListener('click', async () => {
    if (!term()) return;
    out.innerHTML = '<div class="empty">hunting — asking every source, judging what came back, then going again…</div>';
    try {
      const r = await api('/api/hunt', { method: 'POST', body: { question: term() } });
      const cite = (c) => `<div class="meter-label"><span>${esc(c.title)}</span><span class="mono" style="font-size:11px">${esc(c.source)}/${esc(c.where)}</span></div>`;
      const step = (t) => `<tr><td class="num">${t.round}</td><td>${esc(t.queries.join(' · '))}</td><td class="num">${t.newHits}</td><td class="sub">${esc(t.missing || (t.next.length ? `next: ${t.next.join(', ')}` : 'stopped'))}</td></tr>`;
      out.innerHTML = `
        <div class="panel-title"><span>${r.found ? 'Found' : 'Not found'}</span><span class="chip ${r.found ? 'chip-ok' : 'chip-dim'}">${r.rounds} round(s) · ${esc(money4(r.costUsd))}</span></div>
        <p class="lede">${esc(r.answer || r.say)}</p>
        ${r.citations.length ? `<div class="panel-title">From</div>${r.citations.map(cite).join('')}` : ''}
        <div class="panel-title" style="margin-top:12px">What it tried</div>
        <div class="table-wrap"><table><thead><tr><th class="num">Round</th><th>Asked</th><th class="num">New</th><th>Then</th></tr></thead><tbody>${r.trail.map(step).join('')}</tbody></table></div>
        <div class="map-legend">${esc(r.stopped)} · asked ${esc(r.sourcesAsked.join(', '))}</div>`;
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  });

  $('#hunt-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#hunt-go').click(); });
}
export async function renderRequests() {
  const [ov, depts] = await Promise.all([api('/api/requests'), api('/api/requests/departments').catch(() => [])]);
  const canC = hasPermC('requests.create');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Requests</div><div class="big">${ov.total}</div><div class="sub">${ov.done} completed</div></div>
    <div class="panel tile ${ov.open ? 'tile-steel' : ''}"><div class="panel-title">Moving now</div><div class="big">${ov.open}</div><div class="sub">travelling between departments</div></div>
    <div class="panel tile ${ov.needsHuman ? 'tile-warn' : ''}"><div class="panel-title">Waiting on you</div><div class="big">${ov.needsHuman}</div><div class="sub"><a href="#/gate">approvals inbox →</a></div></div>
    <div class="panel tile"><div class="panel-title">Departments engaged</div><div class="big">${ov.departmentsTouched}</div><div class="sub">${ov.stepsRun} steps completed automatically</div></div>
  </div>

  ${canC ? `<div class="panel">
    <div class="panel-title">Write what you need — in Arabic or English, however you'd say it to a colleague</div>
    <div><textarea id="rq-body" style="min-height:96px" placeholder="مثال: اريد دراسة كاملة لإطلاق تطبيق فواتير للشركات الصغيرة في العراق — السوق، المتطلبات، التصميم التقني، التكلفة، وخطة التسويق&#10;or: Find me 10 energy companies in Basra with real contact details, then draft an intro email for each"></textarea></div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="rq-title">Title (optional — the router will name it)</label><input type="text" id="rq-title"></div>
      <div><label class="fl" for="rq-prio">Priority</label><select id="rq-prio" aria-label="Priority"><option>normal</option><option>high</option><option>critical</option><option>low</option></select></div>
      <button class="btn btn-primary" id="rq-go">Submit to the company</button>
    </div>
    <div class="map-legend">The intake router reads your request and draws its own route through the departments that must each do something real — it is not a fixed template. Steps run by themselves, open actual work in other sections when needed (an intelligence campaign, a design package, a financial report), and stop only where a person is required. You can watch every step below.</div>
  </div>` : ''}

  ${ov.requests.map((r) => {
    const cur = r.progress.current;
    return `<div class="panel">
      <div class="jr-head">
        <span><a href="#/requests/${r.id}" style="color:var(--ink);text-decoration:none"><b>#${r.id} ${esc(r.title)}</b></a>
          <span class="state state-${REQ_STATE_CLS[r.state] || 'queued'}">${esc(r.state)}</span>
          ${r.priority !== 'normal' ? `<span class="chip ${r.priority === 'critical' ? 'chip-bad' : 'chip-warn'}">${esc(r.priority)}</span>` : ''}</span>
        <span>
          <span class="chip chip-dim">${r.progress.done}/${r.progress.total} steps · ${money4(r.progress.costUsd)}</span>
          ${r.state === 'done' ? `<button class="btn btn-sm" data-download="/api/requests/${r.id}/export" data-filename="request-${r.id}.md">⬇ Deliverable</button>` : ''}
          ${connBtn('request', r.id)}
        </span>
      </div>
      <div class="map-legend">${esc(short(r.body, 190))}</div>
      <div class="jr-track" style="margin:8px 0"><div class="jr-fill" style="width:${r.progress.pct}%"></div></div>
      <div class="route">
        ${r.steps.map((s) => `<a class="route-stop ${esc(s.state)}" href="#/requests/${r.id}" title="${esc(s.title)}${s.note ? ` — ${esc(s.note)}` : ''}">
          <span class="rs-dept">${esc(s.dept)}</span>
          <span class="rs-mark">${s.state === 'done' ? '✓' : s.state === 'active' ? '●' : s.state === 'awaiting_human' ? '⏸' : s.state === 'failed' ? '✕' : '·'}</span>
        </a>`).join('') || '<span class="map-legend">the router is drawing the route…</span>'}
      </div>
      ${cur ? `<div class="map-legend">now at <b style="color:var(--ember)">${esc(cur.dept)}</b> — ${esc(cur.title)}${cur.agent ? ` · ${esc(cur.agent)}` : ''}${cur.state === 'awaiting_human' ? ' · <span style="color:var(--warn)">waiting on you</span>' : ''}</div>` : ''}
    </div>`;
  }).join('') || '<div class="panel"><div class="empty">No requests yet — write one above and watch it travel.</div></div>'}`;

  wireConnections();
  wireDownloads();
  if (!canC) return;
  $('#rq-go')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/requests', { method: 'POST', body: { body: $('#rq-body').value, title: $('#rq-title').value || null, priority: $('#rq-prio').value } });
      toast('Submitted — the intake router is planning its route'); location.hash = `#/requests/${r.id}`;
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderChat() {
  const ov = await api(`/api/chat?actor=${encodeURIComponent(actor())}`);
  if (!chatState.channel) chatState.channel = ov.channels.find((c) => c.key === 'general')?.id || ov.channels[0]?.id;
  const canPost = hasPermC('chat.post');
  const [data] = await Promise.all([api(`/api/chat/${chatState.channel}`)]);
  const ch = data.channel;
  const msgs = data.messages;
  const roster = ov.roster;

  const who = (id) => {
    if (id.startsWith('human:')) return { name: id.replace('human:', ''), kind: 'human' };
    const a = roster.agents.find((x) => x.id === id);
    return { name: a ? a.name : id, kind: id === 'system' ? 'system' : 'agent', id };
  };
  const linkRefs = (refs) => (refs || []).map((r) => `<a class="chat-ref" href="${linkFor(r.type, r.id) || '#/'}">↗ ${esc(r.label || `${r.type} #${r.id}`)}</a>`).join('');
  const mark = (body) => esc(body)
    .replace(/@([A-Za-z0-9_.\-]+)/g, '<span class="chat-at">@$1</span>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');

  const bubble = (m) => {
    const w = who(m.author_id);
    const mine = m.author_id === actor();
    return `<div class="chat-msg ${w.kind}${mine ? ' mine' : ''}${m.state === 'thinking' ? ' thinking' : ''}" data-msg="${m.id}">
      <div class="cm-avatar" title="${esc(m.author_id)}">${esc(w.name.slice(0, 2).toUpperCase())}</div>
      <div class="cm-body">
        <div class="cm-head">
          <b>${esc(w.name)}</b>
          <span class="cm-kind">${w.kind === 'agent' ? 'AI employee' : w.kind}</span>
          <span class="cm-time">${esc(String(m.created_at).slice(11, 16))}</span>
          ${m.pinned ? '<span class="chip chip-warn">pinned</span>' : ''}
          ${m.edited_at ? '<span class="cm-time">(edited)</span>' : ''}
        </div>
        <div class="cm-text">${m.state === 'thinking' ? '<span class="cm-typing"><i></i><i></i><i></i></span> thinking…' : mark(m.body)}</div>
        ${m.action ? `<div class="cm-action ${m.action.ok ? 'ok' : 'bad'}">
          <b>${m.action.ok ? '✔ did it' : '✕ refused'}</b> <span class="mono">${esc(m.action.id)}</span> — ${esc(m.action.detail)}</div>` : ''}
        ${m.refs?.length ? `<div class="cm-refs">${linkRefs(m.refs)}</div>` : ''}
        <div class="cm-tools">
          ${CHAT_EMOJI.map((e) => `<button data-react="${m.id}" data-emoji="${e}">${e}</button>`).join('')}
          <button data-thread="${m.id}">reply${m.replies ? ` (${m.replies})` : ''}</button>
          <button data-pin="${m.id}">pin</button>
          ${mine ? `<button data-del="${m.id}">delete</button>` : ''}
        </div>
        ${m.reactions?.length ? `<div class="cm-reacts">${m.reactions.map((r) => `<span title="${esc(r.who || '')}">${esc(r.emoji)} ${r.n}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  };

  view.innerHTML = `
  <div class="chat-wrap">
    <aside class="chat-side">
      <div class="cs-sec">Channels</div>
      ${ov.channels.filter((c) => c.kind !== 'dm').map((c) => `
        <button class="cs-ch ${c.id === chatState.channel ? 'on' : ''}" data-ch="${c.id}">
          <span>#${esc(c.name)}</span>${c.unread ? `<i class="cs-unread">${c.unread}</i>` : ''}
        </button>`).join('')}
      ${ov.channels.some((c) => c.kind === 'dm') ? `<div class="cs-sec">Direct</div>
        ${ov.channels.filter((c) => c.kind === 'dm').map((c) => `
          <button class="cs-ch ${c.id === chatState.channel ? 'on' : ''}" data-ch="${c.id}">
            <span>@${esc(c.name)}</span>${c.unread ? `<i class="cs-unread">${c.unread}</i>` : ''}
          </button>`).join('')}` : ''}
      <div class="cs-sec">People · ${roster.humans.length}</div>
      ${roster.humans.map((h) => `<button class="cs-person" data-dm="${esc(h.id)}" data-name="${esc(h.name)}">
        <span class="cs-dot human"></span>${esc(h.name)}</button>`).join('')}
      <div class="cs-sec">AI workforce · ${roster.agents.filter((a) => a.status === 'active').length}</div>
      ${roster.agents.map((a) => `<button class="cs-person" data-dm="${esc(a.id)}" data-name="${esc(a.id)}"
          title="${esc(a.name)} · ${esc(a.role || '')} · can: ${esc(a.can.join(', ') || 'talk only')}">
        <span class="cs-dot ${a.busy ? 'busy' : a.status === 'active' ? 'on' : 'off'}"></span>
        <span class="mono">${esc(a.id)}</span>${a.busy ? `<i class="cs-unread">${a.busy}</i>` : ''}</button>`).join('')}
    </aside>

    <section class="chat-main">
      <header class="chat-head">
        <div>
          <b>#${esc(ch.name)}</b>
          <div class="chat-topic">${esc(ch.topic || '')}</div>
        </div>
        <div class="chat-stat mono">${ov.stats.messages} msgs · ${ov.stats.fromAgents} from AI · ${ov.stats.actionsTaken} actions${ov.stats.thinking ? ` · ${ov.stats.thinking} thinking` : ''}</div>
      </header>
      <div class="chat-log" id="chat-log">${msgs.length ? msgs.map(bubble).join('') : '<div class="empty">Nobody has said anything here yet. Mention an employee by name — try <span class="mono">@AGT-DOC-001</span> — and it will answer.</div>'}</div>
      ${canPost ? `<div class="chat-compose">
        ${chatState.thread ? `<div class="chat-replying">replying in thread to #${chatState.thread} <button id="chat-unthread">✕</button></div>` : ''}
        <div class="chat-input-row">
          <textarea id="chat-input" rows="2" placeholder="Write to the room. @mention an employee to bring it in — or ask it to start work."></textarea>
          <button class="btn btn-primary" id="chat-send">Send</button>
        </div>
        <div id="chat-suggest" class="chat-suggest" hidden></div>
        <div class="chat-hint">Enter sends · Shift+Enter for a new line · an employee may act on what you ask, within what its role allows</div>
      </div>` : '<div class="chat-hint">chat.post permission required to write here.</div>'}
    </section>
  </div>`;

  const log = $('#chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  api(`/api/chat/${chatState.channel}/read`, { method: 'POST', body: {} }).catch(() => {});

  view.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => { chatState.channel = Number(b.dataset.ch); chatState.thread = null; renderChat(); }));
  view.querySelectorAll('[data-dm]').forEach((b) => b.addEventListener('click', async () => {
    try { const c = await api('/api/chat/dm', { method: 'POST', body: { with: b.dataset.dm } }); chatState.channel = c.id; renderChat(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/chat/msg/${b.dataset.react}/react`, { method: 'POST', body: { emoji: b.dataset.emoji } }); renderChat(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/chat/msg/${b.dataset.pin}/pin`, { method: 'POST', body: {} }); renderChat(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/chat/msg/${b.dataset.del}/delete`, { method: 'POST', body: {} }); renderChat(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-thread]').forEach((b) => b.addEventListener('click', () => { chatState.thread = Number(b.dataset.thread); renderChat(); }));
  $('#chat-unthread')?.addEventListener('click', () => { chatState.thread = null; renderChat(); });

  const input = $('#chat-input');
  const send = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try { await api(`/api/chat/${chatState.channel}`, { method: 'POST', body: { body, parentId: chatState.thread } }); renderChat(); }
    catch (e) { toast(e.message, true); input.value = body; }
  };
  $('#chat-send')?.addEventListener('click', send);

  // @-autocomplete over every employee and person in the building.
  const suggest = $('#chat-suggest');
  const everyone = [...roster.agents.map((a) => ({ id: a.id, label: `${a.id} — ${a.name}`, can: a.can })),
    ...roster.humans.map((h) => ({ id: h.id.replace('human:', ''), label: `${h.name} (human)`, can: [] }))];
  input?.addEventListener('input', () => {
    const m = input.value.slice(0, input.selectionStart).match(/@([A-Za-z0-9_.\-]*)$/);
    if (!m) { suggest.hidden = true; return; }
    const hits = everyone.filter((e) => e.id.toLowerCase().includes(m[1].toLowerCase())).slice(0, 6);
    suggest.innerHTML = hits.map((h) => `<button data-pick="${esc(h.id)}">${esc(h.label)}${h.can.length ? `<i>${esc(h.can.slice(0, 3).join(', '))}</i>` : ''}</button>`).join('');
    suggest.hidden = !hits.length;
    suggest.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      input.value = input.value.replace(/@([A-Za-z0-9_.\-]*)$/, `@${b.dataset.pick} `);
      suggest.hidden = true; input.focus();
    }));
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') suggest.hidden = true;
  });
}
