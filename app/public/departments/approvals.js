// The approvals surface: every department behind that door.
//
// Grouped by the same mapping the navigation is drawn from, so a module
// boundary and a menu boundary cannot drift apart.

import { $, esc, money, money4, short, toast, view } from '../core/dom.js';
import { DEPT_LABEL, refreshShell, scoreChip, wireXact, xbtn } from '../components/chrome.js';
import { actor, currentUser, hasPermC } from '../state/session.js';
import { api } from '../services/api.js';
import { tile } from '../components/tile.js';

export async function renderApprovals() {
  const d = await api('/api/approvals');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Waiting on you', d.yours, 'that you personally can act on')}
    ${tile('Waiting on somebody', d.total, 'across the whole company')}
    ${tile('Overdue', d.overdue, `past the ${d.slaHours}h promise`, d.overdue ? 'tile-warn' : '')}
    ${tile('Oldest', `${Math.round(d.oldestHours)}h`, 'the longest anything has waited')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Ordered by what it blocks, not by who asked</div>
    <div class="map-legend">Self-declared priority is always high, so this reads the consequence instead. Urgency
      strictly outranks age; age only breaks ties inside a band, because a queue whose order can be gamed by
      waiting is a queue that teaches people to wait.</div>
    <div class="form-inline" style="margin-top:8px">
      ${d.byUrgency.filter((u) => u.count).map((u) => `<span class="chip ${u.id === 'money' ? 'chip-bad' : u.id === 'incident' ? 'chip-warn' : 'chip-dim'}" title="${esc(u.why)}">${esc(u.id)} ${u.count}</span>`).join('') || '<span class="chip chip-ok">nothing is waiting</span>'}
    </div>
  </div>
  ${d.groups.length ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">Alike enough to decide together</div>
    <div class="map-legend">A batch is recorded as <b>one act naming every item</b>, never as a dozen entries that
      read like a dozen separate judgements. Somebody looking back must be able to tell considered from batched.</div>
    <table><thead><tr><th>Kind</th><th>Because</th><th>Count</th><th>Oldest</th></tr></thead><tbody>
    ${d.groups.map((g) => `<tr><td>${esc(g.kind)}</td><td class="sub">${esc(g.because)}</td><td class="mono">${g.count}</td><td class="mono">${Math.round(g.oldestHours)}h</td></tr>`).join('')}
    </tbody></table></div>` : ''}
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">The queue</div>
    <table><thead><tr><th>Urgency</th><th>Kind</th><th>What</th><th>Because</th><th>Waiting</th><th></th></tr></thead><tbody>
    ${d.items.map((i) => `<tr>
      <td><span class="chip ${i.urgency === 'money' ? 'chip-bad' : i.urgency === 'incident' ? 'chip-warn' : 'chip-dim'}" title="${esc(i.whyUrgent)}">${esc(i.urgency)}</span></td>
      <td>${esc(i.kind)}</td><td>${esc(i.title)}</td><td class="sub">${esc(i.because)}</td>
      <td class="mono">${i.ageHours}h ${i.overdue ? '<span style="color:var(--bad)">overdue</span>' : ''}</td>
      <td><a class="btn btn-sm" href="${esc(i.route)}">Open</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing is waiting on anybody.</td></tr>'}
    </tbody></table>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Delegation — because somebody is always on holiday</div>
    <div class="map-legend">Bounded in time, always. A delegation with no end is a permission grant with extra
      paperwork, and both names go on the chain: who acted, and whose authority they were carrying.</div>
    <div style="margin-top:8px">${[...d.delegations.toMe.map((x) => `<div>carrying <b>${esc(x.from_username)}</b>'s authority until ${esc(x.expires_at)}</div>`),
      ...d.delegations.fromMe.map((x) => `<div>lent to <b>${esc(x.to_username)}</b> until ${esc(x.expires_at)}</div>`)].join('') || '<div class="sub">nobody is standing in for anybody</div>'}</div>
  </div>`;
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
