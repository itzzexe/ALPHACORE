// The work surface: every department behind that door.
//
// Grouped by the same mapping the navigation is drawn from, so a module
// boundary and a menu boundary cannot drift apart.

import { $, esc, money, money4, short, toast, view } from '../core/dom.js';
import { DEPT_COLORS, METHOD_HINT } from '../components/bits.js';
import { actor, currentUser, hasPermC } from '../state/session.js';
import { api } from '../services/api.js';
import { connBtn, wireConnections, wireDownloads } from '../components/common.js';
import { preBody, scoreChip, wireXact, xbtn } from '../components/chrome.js';
import { tile } from '../components/tile.js';
import { t, lang } from '/i18n.js';

export async function renderTiers() {
  const d = await api('/api/tiers');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Which model actually does the work</div>
    <div class="map-legend">A tier is a chain of candidates, tried in order. Changing one changes every employee
      on that tier at once — invisibly, until output quality drops in a way nobody attributes to it. So a change
      is proposed, canaried against the chain in service on the same day, and promoted by a person who has been
      told what regressed.</div>
    <table style="margin-top:10px"><thead><tr><th>Tier</th><th>For</th><th>Chain</th><th></th></tr></thead><tbody>
    ${d.tiers.map((t) => `<tr><td class="mono">${esc(t.tier)}</td><td class="sub">${esc(t.purpose || '')}</td>
      <td class="mono" style="font-size:11px">${t.chain.map((c) => esc(`${c.provider}/${c.model}`)).join(' → ')}</td>
      <td>${t.overridden ? '<span class="chip chip-warn">promoted over the file</span>' : '<span class="chip chip-dim">from the file</span>'}</td></tr>`).join('')}
    </tbody></table>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">What a candidate has to answer first</div>
    <div class="map-legend">Deliberately boring: a regression check, not a benchmark. These are the ways a model
      swap breaks a pipeline quietly.</div>
    ${d.tasks.map((t) => `<div style="margin-top:8px"><b class="mono">${esc(t.id)}</b><div class="sub">${esc(t.why)}</div></div>`).join('')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Proposals</div>
    <table><thead><tr><th>Tier</th><th>Candidate</th><th>State</th><th>Canary</th><th>Who</th></tr></thead><tbody>
    ${d.proposals.map((p) => `<tr><td class="mono">${esc(p.tier)}</td>
      <td class="mono" style="font-size:11px">${p.candidate.map((c) => esc(`${c.provider}/${c.model}`)).join(' → ')}</td>
      <td><span class="chip ${p.state === 'promoted' ? 'chip-ok' : p.state === 'tested' ? 'chip-warn' : 'chip-dim'}">${esc(p.state)}</span></td>
      <td class="sub">${p.summary ? (p.summary.conclusive === false ? esc(`inconclusive — ${p.summary.inconclusiveBecause || ''}`).slice(0, 90) : `${p.summary.candidate}/${p.summary.total} vs ${p.summary.current}/${p.summary.total}${p.summary.regressions?.length ? ` · ${p.summary.regressions.length} regression(s)` : ''}`) : '—'}</td>
      <td class="sub">${esc(p.promotedBy || p.proposedBy || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing has been proposed.</td></tr>'}
    </tbody></table>
  </div>
  ${d.prompts.length ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">Employees whose instructions have changed</div>
    <div class="map-legend">A system prompt is the largest single input to what an employee produces, and it gets
      edited casually. Without a version, "why did this get worse last Tuesday" has no answer.</div>
    <table><thead><tr><th>Employee</th><th>Versions</th><th>Last seen</th></tr></thead><tbody>
    ${d.prompts.map((p) => `<tr><td class="mono">${esc(p.agent_id)}</td><td class="mono">${p.versions}</td><td class="sub">${esc(p.last || '')}</td></tr>`).join('')}
    </tbody></table></div>` : ''}`;
}
// Work that failed for good. Written down since the queue was built and, until
// now, read by nobody.
export async function renderDeadletter() {
  const d = await api('/api/deadletter');
  view.innerHTML = `
  <div class="grid grid-3">
    <div class="panel tile ${d.waiting ? 'tile-warn' : ''}"><div class="panel-title">Dead work</div><div class="big">${d.waiting}</div><div class="sub">${d.total} ever</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Spent on nothing</div><div class="big">${esc(money4(d.wastedUsd))}</div><div class="sub">already paid for, delivered nothing</div></div>
    <div class="panel tile"><div class="panel-title">Last death</div><div class="big" style="font-size:16px">${esc(String(d.lastDeath || '—').slice(0, 16))}</div><div class="sub">${d.byReason.length} distinct reason(s)</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">Why it is dying</div>
    ${d.byReason.length
    ? `<table><thead><tr><th>Reason</th><th class="num">Runs</th><th>Employees</th><th class="num">Cost</th></tr></thead><tbody>${d.byReason.map((r) => `<tr><td>${esc(r.reason)}</td><td class="num">${r.n}</td><td class="mono" style="font-size:11px">${esc(r.agents.join(', ').slice(0, 60))}</td><td class="num">${esc(money4(r.costUsd))}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">nothing has failed for good — the queue is doing its job</div>'}
  </div>

  <div class="panel">
    <div class="panel-title">Each one</div>
    ${d.recent.length
    ? `<div class="table-wrap"><table><thead><tr><th>Run</th><th>Employee</th><th>Task</th><th>Why it died</th><th class="num">Cost</th><th></th></tr></thead><tbody>${d.recent.map((x) => `<tr><td class="mono">${esc(x.run_id)}</td><td class="mono" style="font-size:11px">${esc(x.agent_id || '—')}</td><td>${esc(x.task_type || '')}</td><td class="sub">${esc(String(x.reason || '').slice(0, 90))}</td><td class="num">${esc(money4(x.cost_usd || 0))}</td><td><button class="btn btn-sm" data-revive="${esc(x.run_id)}">Try again</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">nothing waiting</div>'}
  </div>`;

  view.querySelectorAll('[data-revive]').forEach((b) => b.addEventListener('click', async () => {
    // Asked for, because the reason it failed four times may still be there, and
    // a revival that fails four more times has cost the company twice.
    const why = prompt('Why should this run again? What has changed?');
    if (!why) return;
    try { await api(`/api/deadletter/${b.dataset.revive}/revive`, { method: 'POST', body: { why } }); toast('back on the queue'); render(); }
    catch (e) { toast(e.message, true); }
  }));
}
export async function renderRuns() {
  const stateSel = view.dataset.runState || '';
  const [runs, agents] = await Promise.all([
    api('/api/runs' + (stateSel ? `?state=${stateSel}` : '')),
    api('/api/agents'),
  ]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Enqueue a run</div>
    <div class="form-inline">
      <div><label class="fl" for="run-agent">Agent</label><select id="run-agent" aria-label="Agent">${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)} — ${esc(a.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="run-type">Task type</label><input type="text" id="run-type" value="task"></div>
    </div>
    <div><label class="fl" for="run-prompt">Prompt</label><textarea id="run-prompt" placeholder="What should the agent do?"></textarea></div>
    <button class="btn btn-primary form-go" id="run-go">Enqueue</button>
  </div>
  <div class="panel">
    <div class="panel-title"><span>Recent runs</span>
      <select id="run-filter" aria-label="Filter" style="width:auto">
        ${['', 'queued', 'running', 'awaiting_human', 'done', 'failed'].map((s) => `<option value="${s}" ${s === stateSel ? 'selected' : ''}>${s || 'all states'}</option>`).join('')}
      </select>
    </div>
    <table>
      <thead><tr><th>Agent</th><th>Task</th><th>State</th><th>Flags</th><th class="num">Cost</th><th>Created</th></tr></thead>
      <tbody>
        ${runs.map((r) => `
        <tr class="rowlink" data-run="${esc(r.id)}">
          <td class="mono">${esc(r.agent_id)}</td>
          <td>${esc(short(r.input?.prompt || r.task_type, 60))}</td>
          <td><span class="state state-${esc(r.state)}">${esc(r.state)}</span></td>
          <td class="mono">${(r.flags || []).map((f) => `<span class="chip chip-ember">${esc(f)}</span>`).join(' ')}</td>
          <td class="num">${esc(money4(r.cost_usd))}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(r.created_at)}</td>
        </tr>
        <tr class="run-detail" data-detail="${esc(r.id)}" hidden><td colspan="6">
          <div class="agent-meta" style="margin-bottom:6px">
            ${r.pipeline_id ? '<a class="chip" style="text-decoration:none" href="#/pipelines">⚙ pipeline</a>' : ''}
            ${r.decision_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/decisions/${esc(r.decision_id)}">${esc(r.decision_id)}</a>` : ''}
            ${r.task_type?.startsWith('ticket:') ? `<a class="chip chip-warn" style="text-decoration:none" href="#/support">✉ ${esc(r.task_type)}</a>` : ''}
          </div>
          ${r.failure_reason ? `<div class="reason">${esc(r.failure_reason)}</div>` : ''}
          ${r.state === 'done' && r.output?.parsed?.files?.length
            ? `<div style="margin:6px 0"><button class="btn btn-sm btn-ok" data-applyfiles="${esc(r.id)}">Apply ${r.output.parsed.files.length} file(s) to workspace</button></div>` : ''}
          <pre class="json">${esc(JSON.stringify(r.output?.parsed ?? r.output ?? r.input, null, 2))}</pre>
        </td></tr>`).join('') || '<tr><td colspan="6" class="empty">No runs.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#run-filter').addEventListener('change', (e) => { view.dataset.runState = e.target.value; renderRuns(); });
  $('#run-go').addEventListener('click', async () => {
    const prompt = $('#run-prompt').value.trim();
    if (!prompt) return toast('Prompt is required', true);
    try {
      await api('/api/runs', { method: 'POST', body: { agentId: $('#run-agent').value, taskType: $('#run-type').value || 'task', prompt, actor: actor() } });
      toast('Run enqueued'); renderRuns();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-run]').forEach((row) => row.addEventListener('click', () => {
    const d = view.querySelector(`[data-detail="${row.dataset.run}"]`);
    if (d) d.hidden = !d.hidden;
  }));
  view.querySelectorAll('[data-applyfiles]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const r = await api(`/api/runs/${b.dataset.applyfiles}/apply`, { method: 'POST', body: { actor: actor() } });
      toast(`Wrote ${r.written.length} file(s): ${r.written.join(', ').slice(0, 120)}`);
    } catch (err) { toast(err.message, true); }
  }));
}
export async function renderPipelines() {
  const [templates, pipes, products] = await Promise.all([api('/api/pipeline-templates'), api('/api/pipelines'), api('/api/products')]);
  const preselect = localStorage.getItem('alphacore-pl-product') || '';
  localStorage.removeItem('alphacore-pl-product');
  const stepChip = (s) => {
    const st = s.runState || s.stepState;
    const cls = st === 'done' ? 'done' : st === 'awaiting_human' ? 'awaiting_human'
      : ['running', 'leased', 'queued'].includes(st) ? 'running'
      : ['failed', 'cancelled'].includes(st) ? 'failed' : 'queued';
    return `<span class="state state-${cls}" title="${esc(s.agentId)}${s.reason ? ' — ' + esc(s.reason) : ''}">${s.index + 1}. ${esc(s.title)}</span>`;
  };
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Start a pipeline — FORGE chain, each step feeds the next</div>
    <div class="form-inline">
      <div style="flex:1.2"><label class="fl" for="pl-template">Template</label><select id="pl-template" aria-label="Template">${templates.map((t) => `<option value="${esc(t.key)}">${esc(t.title)}</option>`).join('')}</select></div>
      <div><label class="fl" for="pl-product">Product (optional)</label><select id="pl-product" aria-label="Product"><option value="">— none —</option>${products.map((p) => `<option value="${esc(p.id)}" ${p.id === preselect ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="pl-go">Start</button>
    </div>
    <div><label class="fl" for="pl-goal">Goal</label><textarea id="pl-goal" placeholder="What should this pipeline produce?"></textarea></div>
    <div class="map-legend" id="pl-desc">${esc(templates[0]?.description || '')}</div>
  </div>
  ${pipes.map((p) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(p.name)} · <a class="mono" style="letter-spacing:0;color:var(--steel)" href="#/artifacts/${encodeURIComponent(p.workspace)}">${esc(p.workspace)}</a>${p.product_id ? ` · <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(p.product_id)}</a>` : ''}</span>
      <span>
        <span class="state state-${p.state === 'done' ? 'done' : p.state === 'awaiting_human' ? 'awaiting_human' : p.state === 'running' ? 'running' : 'failed'}">${esc(p.state)}</span>
        ${['running', 'awaiting_human'].includes(p.state) ? `<button class="btn btn-sm btn-bad" data-plcancel="${esc(p.id)}">Cancel</button>` : ''}
      </span>
    </div>
    <div style="margin-bottom:10px">${esc(short(p.goal, 160))}</div>
    <div class="agent-meta">${p.steps.map(stepChip).join('<span style="color:var(--ink-faint)">→</span>')}</div>
    <div class="map-legend">
      cost ${esc(money4(p.costUsd))}
      ${p.state === 'awaiting_human' ? ' · waiting at the <a href="#/gate" style="color:var(--warn)">human gate</a>' : ''}
      ${p.steps.some((s) => s.flags?.includes('same-family-review')) ? ' · <span style="color:var(--ember-soft)">same-family review flagged</span>' : ''}
    </div>
  </div>`).join('') || '<div class="panel"><div class="empty">No pipelines yet.</div></div>'}`;

  $('#pl-template').addEventListener('change', (e) => {
    $('#pl-desc').textContent = templates.find((t) => t.key === e.target.value)?.description || '';
  });
  $('#pl-go').addEventListener('click', async () => {
    const goal = $('#pl-goal').value.trim();
    if (!goal) return toast('Goal is required', true);
    try {
      await api('/api/pipelines', { method: 'POST', body: { template: $('#pl-template').value, goal, productId: $('#pl-product').value || null, actor: actor() } });
      toast('Pipeline started'); renderPipelines();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-plcancel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/pipelines/${b.dataset.plcancel}/cancel`, { method: 'POST', body: { actor: actor() } }); renderPipelines(); }
    catch (e) { toast(e.message, true); }
  }));
}
export async function renderArtifacts(filter = null) {
  let files = await api('/api/artifacts');
  if (filter) files = files.filter((f) => f.path.startsWith(filter + '/') || f.path.startsWith(filter));
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">
        <span>Workspace files — real output on disk (${files.length})</span>
        ${filter ? `<span class="chip chip-ember">${esc(filter)} · <a href="#/artifacts" style="color:inherit">clear</a></span>` : ''}
      </div>
      <table>
        <thead><tr><th>Path</th><th class="num">Size</th><th>Modified</th></tr></thead>
        <tbody>${files.map((f) => `
          <tr class="rowlink" data-art="${esc(f.path)}">
            <td class="mono">${esc(f.path)}</td>
            <td class="num">${f.size < 1024 ? f.size + ' B' : (f.size / 1024).toFixed(1) + ' KB'}</td>
            <td class="mono" style="color:var(--ink-faint)">${esc(f.mtime.slice(0, 16).replace('T', ' '))}</td>
          </tr>`).join('') || '<tr><td colspan="3" class="empty">No artifacts yet — run a pipeline, then apply the Engineer’s files from the Runs page.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-title" id="art-title">Viewer</div>
      <pre class="json" id="art-view" style="max-height:560px">Select a file.</pre>
    </div>
  </div>`;
  view.querySelectorAll('[data-art]').forEach((row) => row.addEventListener('click', async () => {
    try {
      const f = await api(`/api/artifacts/file?path=${encodeURIComponent(row.dataset.art)}`);
      $('#art-title').textContent = f.path;
      $('#art-view').textContent = f.content;
    } catch (e) { toast(e.message, true); }
  }));
}
export async function renderProducts() {
  const products = await api('/api/products');
  const gateHints = { 2: 'Gate 2 go requires payment-intent evidence (LOI / pre-order)', 8: 'Gate 8 is a T3 joint CEO+CTO go/no-go' };
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New product — enters the factory at Gate 1</div>
    <div class="form-inline">
      <div style="flex:1"><label class="fl" for="pr-name">Name</label><input type="text" id="pr-name"></div>
      <div style="flex:2"><label class="fl" for="pr-desc">Description</label><input type="text" id="pr-desc"></div>
      <button class="btn btn-primary" id="pr-go">Create</button>
    </div>
  </div>
  ${products.map((p) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(p.name)} <span class="mono" style="letter-spacing:0;color:var(--ink-faint)">· ${esc(p.id)}</span></span>
      <span><span class="chip ${p.state === 'live' ? 'chip-ok' : p.state === 'retired' ? 'chip-bad' : 'chip-ember'}">${esc(p.state)} · gate ${p.stage}/10</span> ${connBtn('product', p.id)}</span>
    </div>
    ${p.description ? `<div style="margin-bottom:6px">${esc(p.description)}</div>` : ''}
    <div class="gatebar">${p.gates.map((g) => `<span class="${esc(g.status)}" data-t="${g.gate}. ${esc(g.title)}${g.date ? ' · ' + esc(g.date) : ''}${g.status === 'active' ? ' · ACTIVE' : ''}"></span>`).join('')}</div>
    <div class="agent-meta">
      <button class="btn btn-sm" data-plnew="${esc(p.id)}">New pipeline →</button>
      ${p.related.pipelines.map((pl) => `<a class="chip" style="text-decoration:none" href="#/artifacts/${encodeURIComponent(pl.workspace)}" title="${esc(pl.state)}">⚙ ${esc(short(pl.name, 24))}</a>`).join('')}
      ${p.related.incidents.map((i) => `<a class="chip ${i.state !== 'closed' ? 'chip-bad' : 'chip-dim'}" style="text-decoration:none" href="#/incidents">⚠ #${i.id} ${esc(i.sev)}</a>`).join('')}
      ${p.related.tickets.map((t) => `<a class="chip chip-dim" style="text-decoration:none" href="#/support">✉ #${t.id}</a>`).join('')}
      ${p.related.gateDecisions.map((g) => `<a class="chip chip-ember" style="text-decoration:none" href="#/decisions/${esc(g.decisionId)}">G${g.gate} → ${esc(g.decisionId)}</a>`).join('')}
    </div>
    <div class="map-legend">active: <b style="color:var(--steel)">${esc(p.gates[p.stage - 1]?.title || '—')}</b>${gateHints[p.stage] ? ' — ' + gateHints[p.stage] : ''}</div>
    ${p.state !== 'retired' ? `
    <div class="form-inline" style="margin-top:10px">
      <div style="flex:2"><label class="fl">Gate note (the decision artifact)</label><input type="text" data-note="${esc(p.id)}"></div>
      <div><label class="fl">Decision ref (optional)</label><input type="text" data-dr="${esc(p.id)}" placeholder="DR-2026-…"></div>
      ${p.stage < 10 ? `<button class="btn btn-ok" data-advance="${esc(p.id)}">Pass gate ${p.stage}</button>` : ''}
      <button class="btn btn-bad" data-retire="${esc(p.id)}">Retire (T3)</button>
    </div>` : ''}
    ${p.gates.filter((g) => g.status === 'passed').map((g) => `<div class="map-legend">✓ G${g.gate} ${esc(g.title)} · ${esc(g.date)}${g.decisionId ? ' · ' + esc(g.decisionId) : ''} — ${esc(short(g.note, 90))}</div>`).join('')}
  </div>`).join('') || '<div class="panel"><div class="empty">No products in the factory yet.</div></div>'}`;

  $('#pr-go').addEventListener('click', async () => {
    try { await api('/api/products', { method: 'POST', body: { name: $('#pr-name').value, description: $('#pr-desc').value, actor: actor() } }); renderProducts(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-advance]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.advance;
    try {
      await api(`/api/products/${id}/advance`, { method: 'POST', body: { note: view.querySelector(`[data-note="${id}"]`).value, decisionId: view.querySelector(`[data-dr="${id}"]`).value || null, actor: actor() } });
      toast('Gate passed'); renderProducts();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-retire]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.retire;
    try {
      await api(`/api/products/${id}/retire`, { method: 'POST', body: { note: view.querySelector(`[data-note="${id}"]`).value, actor: actor() } });
      toast('Product retired — runbook applies (Part 5 §13)'); renderProducts();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-plnew]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('alphacore-pl-product', b.dataset.plnew);
    location.hash = '#/pipelines';
  }));
  wireConnections();
}
export async function renderProjects() {
  const [projects, products] = await Promise.all([api('/api/projects'), api('/api/products').catch(() => [])]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New project</div>
    <div class="form-inline">
      <div style="flex:1.5"><label class="fl" for="pj-name">Name</label><input type="text" id="pj-name"></div>
      <div><label class="fl" for="pj-owner">Owner</label><input type="text" id="pj-owner" value="${esc(currentUser?.username || '')}"></div>
      <div><label class="fl" for="pj-prod">Product</label><select id="pj-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="pj-go">Create</button>
    </div>
  </div>
  ${projects.map((p) => {
    const pct = p.tasks.total ? (p.tasks.done / p.tasks.total) * 100 : 0;
    return `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(p.name)} <span class="chip">${esc(p.owner)}</span>${p.product_id ? ` <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(p.product_id)}</a>` : ''}</span>
      <span class="state state-${p.state === 'done' ? 'done' : p.state === 'active' ? 'running' : 'failed'}">${esc(p.state)}</span>
    </div>
    ${p.description ? `<div class="map-legend">${esc(p.description)}</div>` : ''}
    <div class="meter-label"><span><a href="#/tasks">${p.tasks.done}/${p.tasks.total} tasks</a>${p.tasks.blocked ? ` · <span style="color:var(--warn)">${p.tasks.blocked} blocked</span>` : ''}</span><span class="mono">${pct.toFixed(0)}%</span></div>
    <div class="meter-track"><div class="meter-fill ${pct >= 100 ? '' : 'cool'}" style="width:${pct}%"></div></div>
    ${p.state === 'active' ? `<div style="margin-top:8px">
      <button class="btn btn-sm" data-pjstate="${esc(p.id)}" data-to="paused">Pause</button>
      <button class="btn btn-sm btn-ok" data-pjstate="${esc(p.id)}" data-to="done">Done</button></div>`
      : p.state === 'paused' ? `<div style="margin-top:8px"><button class="btn btn-sm btn-ok" data-pjstate="${esc(p.id)}" data-to="active">Resume</button></div>` : ''}
  </div>`;
  }).join('') || '<div class="panel"><div class="empty">No projects yet.</div></div>'}`;
  $('#pj-go').addEventListener('click', async () => {
    try { await api('/api/projects', { method: 'POST', body: { name: $('#pj-name').value, owner: $('#pj-owner').value, productId: $('#pj-prod').value || null } }); renderProjects(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-pjstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/projects/${b.dataset.pjstate}/state`, { method: 'POST', body: { state: b.dataset.to } }); renderProjects(); } catch (e) { toast(e.message, true); }
  }));
}
export async function renderTasksPage() {
  const [tasks, projects, agents, people] = await Promise.all([
    api('/api/tasks'), api('/api/projects').catch(() => []), api('/api/agents').catch(() => []), api('/api/people').catch(() => []),
  ]);
  const stChip = (s2) => `<span class="state state-${s2 === 'done' ? 'done' : s2 === 'doing' ? 'running' : s2 === 'blocked' ? 'awaiting_human' : s2 === 'cancelled' ? 'failed' : 'queued'}">${esc(s2)}</span>`;
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New task — assign to a human, or delegate to an AI agent (they are the workforce)</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="tk2-title">Title</label><input type="text" id="tk2-title"></div>
      <div><label class="fl" for="tk2-assignee">Assignee</label><select id="tk2-assignee" aria-label="Assignee">
          <optgroup label="AI agents">${agents.map((a) => `<option value="agent:${esc(a.id)}">${esc(a.id)} — ${esc(a.name)}</option>`).join('')}</optgroup>
          <optgroup label="Humans">${people.map((p) => `<option value="human:${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>
        </select></div>
      <div><label class="fl" for="tk2-proj">Project</label><select id="tk2-proj" aria-label="Project"><option value="">—</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="tk2-prio">Priority</label><select id="tk2-prio" aria-label="Priority"><option>normal</option><option>high</option><option>critical</option><option>low</option></select></div>
      <button class="btn btn-primary" id="tk2-go">Create</button>
    </div>
    <div><label class="fl" for="tk2-details">Details</label><textarea id="tk2-details"></textarea></div>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>Task</th><th>Assignee</th><th>Project</th><th>Priority</th><th>State</th><th>Actions</th></tr></thead>
      <tbody>${tasks.map((t) => `
        <tr>
          <td><b>${esc(t.title)}</b>${t.details ? `<div class="map-legend">${esc(short(t.details, 80))}</div>` : ''}</td>
          <td>${t.assignee_type === 'agent'
            ? `<a class="chip chip-steel" style="text-decoration:none" href="#/agents">🤖 ${esc(t.assignee_id || '')}</a>${t.run_id ? ' <a class="chip chip-dim" style="text-decoration:none" href="#/runs">run</a>' : ''}`
            : `<span class="chip">${esc(t.assignee_id || '—')}</span>`}</td>
          <td>${t.project_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/projects">${esc(t.project_id)}</a>` : '—'}</td>
          <td class="mono" style="color:${t.priority === 'critical' ? 'var(--bad)' : t.priority === 'high' ? 'var(--warn)' : 'var(--ink-mute)'}">${esc(t.priority)}</td>
          <td>${stChip(t.state)}</td>
          <td>${['todo', 'blocked'].includes(t.state) ? `<button class="btn btn-sm" data-tk2="${t.id}" data-to="doing">Start</button>` : ''}
              ${t.state !== 'done' && t.state !== 'cancelled' ? `<button class="btn btn-sm btn-ok" data-tk2="${t.id}" data-to="done">Done</button>
              <button class="btn btn-sm btn-bad" data-tk2="${t.id}" data-to="cancelled">✕</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">No tasks.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#tk2-go').addEventListener('click', async () => {
    const [at, aid] = $('#tk2-assignee').value.split(':');
    try {
      await api('/api/tasks', { method: 'POST', body: { title: $('#tk2-title').value, details: $('#tk2-details').value || null, projectId: $('#tk2-proj').value || null, assigneeType: at, assigneeId: aid, priority: $('#tk2-prio').value } });
      toast(at === 'agent' ? 'Delegated — the agent is working now' : 'Task created'); renderTasksPage();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-tk2]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/tasks/${b.dataset.tk2}/state`, { method: 'POST', body: { state: b.dataset.to } }); renderTasksPage(); } catch (e) { toast(e.message, true); }
  }));
}
export async function renderAgents() {
  const agents = await api('/api/agents');
  const groups = {};
  for (const a of agents) (groups[a.role_group] ||= []).push(a);
  view.innerHTML = Object.entries(groups).map(([g, list]) => `
    <div>
      <div class="panel-title" style="margin-bottom:8px">${esc(g)}</div>
      <div class="grid grid-3">
        ${list.map((a) => `
        <div class="panel agent-card">
          <div class="agent-head">
            <span class="agent-name">${esc(a.name)}</span>
            <span class="chip ${a.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(a.status)}</span>
          </div>
          <div class="agent-id">${esc(a.id)} · owner ${esc(a.human_owner)}</div>
          <div class="agent-meta">
            <span class="chip">${esc(a.model_tier)}</span>
            ${a.accuracy ? `<span class="chip ${a.accuracy.factor >= 1 ? 'chip-ok' : 'chip-warn'}" title="gate ✓${a.accuracy.signals.gateApproved} ✗${a.accuracy.signals.gateRejected} · eval ${a.accuracy.signals.lastEvalScore ?? '—'}">rep ${a.accuracy.factor}</span>` : ''}
            ${a.spec?.familyNot ? `<span class="chip chip-ember">family ≠ ${esc(a.spec.familyNot)}</span>` : ''}
            <span class="chip">${esc(a.spec?.failMode || '')}</span>
            ${a.spec?.confidenceFloor ? `<span class="chip">floor ${a.spec.confidenceFloor}</span>` : ''}
            <span class="chip">${esc(a.spec?.sensitivity || 'internal')}</span>
          </div>
          <div>
            <button class="btn btn-sm ${a.status === 'active' ? 'btn-bad' : 'btn-ok'}" data-agent="${esc(a.id)}" data-to="${a.status === 'active' ? 'suspended' : 'active'}">
              ${a.status === 'active' ? 'Suspend' : 'Reactivate'}
            </button>
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('');
  view.querySelectorAll('[data-agent]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/agents/${b.dataset.agent}/status`, { method: 'POST', body: { status: b.dataset.to, actor: actor() } });
      toast(`${b.dataset.agent} → ${b.dataset.to}`); renderAgents();
    } catch (e) { toast(e.message, true); }
  }));
}
export async function renderProviders() {
  const p = await api('/api/providers');
  view.innerHTML = `
  ${p.mockMode ? '<div class="panel" style="border-color:var(--warn)"><div class="panel-title" style="color:var(--warn)">Mock mode</div>No provider keys configured — every call is served by the deterministic mock at zero cost. Add keys to <span class="mono">.env</span> and restart to go live.</div>' : ''}
  <div class="grid grid-3">
    ${p.providers.map((pr) => `
    <div class="panel agent-card">
      <div class="agent-head">
        <span class="agent-name">${esc(pr.name)}</span>
        <span class="chip ${pr.available ? 'chip-ok' : 'chip-dim'}">${pr.available ? 'available' : 'no key'}</span>
      </div>
      <div class="agent-id">family: ${esc(pr.family)} · ${esc(pr.kind)}</div>
      <div class="agent-meta">
        ${pr.models.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}
      </div>
      <div class="agent-meta">
        ${pr.dpa ? '<span class="chip chip-ok">DPA</span>' : '<span class="chip chip-warn">no DPA</span>'}
        ${pr.noTraining ? '<span class="chip chip-ok">no-training</span>' : '<span class="chip chip-warn">may train</span>'}
        ${pr.keyEnv ? `<span class="chip">${esc(pr.keyEnv)}</span>` : ''}
      </div>
    </div>`).join('')}
  </div>
  <div class="panel">
    <div class="panel-title">Routing tiers — pinned chains, fail-closed where it matters</div>
    <table>
      <thead><tr><th>Tier</th><th>Purpose</th><th>Chain</th><th>On exhausted</th></tr></thead>
      <tbody>${Object.entries(p.tiers).map(([t, cfg]) => `
        <tr>
          <td class="mono">${esc(t)}</td><td>${esc(cfg.purpose)}</td>
          <td class="mono">${(cfg.chain || cfg.pair || []).map((s) => `${esc(s.provider)}/${esc(s.model)}`).join(' → ')}</td>
          <td class="mono" style="color:var(--warn)">${esc(cfg.onExhausted || '')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px"><button class="btn btn-primary" id="probe">Test connectivity (T1 probe)</button> <span id="probe-out" class="mono" style="margin-left:10px;color:var(--ink-mute)"></span></div>
  </div>`;
  $('#probe').addEventListener('click', async (e) => {
    e.target.disabled = true; $('#probe-out').textContent = 'probing…';
    try {
      const r = await api('/api/providers/test', { method: 'POST', body: {} });
      $('#probe-out').textContent = `${r.provider}/${r.model} · ${money4(r.costUsd)} · ${short(r.text, 90)}`;
    } catch (err) { $('#probe-out').textContent = 'failed: ' + err.message; }
    e.target.disabled = false;
  });
}
// ---------- Workforce — the AI employees ----------
export async function renderWorkforce() {
  const wf = await api('/api/workforce');
  const groups = [['discover', 'DISCOVER'], ['build', 'BUILD'], ['assure', 'ASSURE'], ['run', 'RUN'], ['create', 'CREATE'], ['steer', 'STEER']];
  const rep = (r) => r == null ? '—' : `<span class="chip ${r >= 1.05 ? 'chip-ok' : r < 0.95 ? 'chip-warn' : 'chip-dim'}">rep ${Number(r).toFixed(2)}</span>`;
  const card = (a) => `
    <div class="panel agent-card" style="border-left:3px solid ${a.busy ? 'var(--ember)' : 'var(--edge)'}">
      <div class="agent-head">
        <span class="agent-name">${esc(a.name)}</span>
        <span>
          ${a.busy ? `<span class="chip chip-ember">● ${a.busy} working</span>` : '<span class="chip chip-dim">idle</span>'}
          <span class="chip ${a.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(a.status)}</span>
        </span>
      </div>
      <div class="agent-id">${esc(a.id)} · tier ${esc(a.tier)} · owner ${esc(a.owner)} · ${esc(a.failMode || '')}</div>
      <div class="agent-meta">
        ${rep(a.reputation)}
        <span class="chip">runs ${a.runs.done}✓ ${a.runs.failed}✗</span>
        <span class="chip">week ${a.week.n} · ${money4(a.week.cost)}</span>
        <span class="chip">tasks ${a.tasksDone} done</span>
        ${a.runs.gate ? `<a class="chip chip-warn" style="text-decoration:none" href="#/gate">⏸ ${a.runs.gate} at gate</a>` : ''}
      </div>
      ${a.journeyStages.length ? `<div class="agent-meta">${a.journeyStages.map((s2) => `
        <a class="chip chip-steel" style="text-decoration:none" href="#/journeys/${s2.journey_id}">🧭 ${esc(short(s2.journey_title, 26))} · ${esc(s2.dept)}${s2.state === 'awaiting_human' ? ' ⏸' : ''}</a>`).join('')}</div>` : ''}
      ${a.openTasks.length ? `<table style="margin-top:8px"><tbody>${a.openTasks.map((t) => `
        <tr><td><a href="#/tasks" style="color:var(--ink)">${esc(short(t.title, 46))}</a></td>
        <td><span class="state state-${t.state === 'doing' ? 'running' : t.state === 'blocked' ? 'awaiting_human' : 'queued'}">${esc(t.state)}</span></td></tr>`).join('')}</tbody></table>` : ''}
      <div class="map-legend" style="margin-top:8px">
        last active: ${a.lastActive ? `${esc(a.lastActive.at.slice(0, 16))} · ${esc(short(a.lastActive.taskType, 30))}` : 'never'}
        · <a href="#/tasks">assign a task →</a>
      </div>
    </div>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Headcount (AI)</div><div class="big">${wf.length}</div><div class="sub">agents on the org chart</div></div>
    <div class="panel tile ${wf.filter((a) => a.busy).length ? 'tile-warn' : ''}"><div class="panel-title">Working right now</div><div class="big">${wf.filter((a) => a.busy).length}</div><div class="sub">with active runs, tasks, or journey stages</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Held at the gate</div><div class="big">${wf.reduce((n, a) => n + (a.runs.gate || 0), 0)}</div><div class="sub"><a href="#/gate">resolve →</a></div></div>
    <div class="panel tile"><div class="panel-title">All-time output</div><div class="big">${wf.reduce((n, a) => n + (a.runs.done || 0), 0)}</div><div class="sub">runs completed · ${money(wf.reduce((n, a) => n + (a.runs.cost || 0), 0))} total</div></div>
  </div>
  ${groups.map(([g, label]) => {
    const members = wf.filter((a) => a.roleGroup === g);
    return members.length ? `<div class="panel-title" style="margin:16px 0 8px">${label} · ${members.length}</div>
      <div class="grid grid-3">${members.map(card).join('')}</div>` : '';
  }).join('')}`;
}
export async function renderJourneys() {
  const [journeys, products] = await Promise.all([api('/api/journeys'), api('/api/products').catch(() => [])]);
  const canM = hasPermC('journeys.manage');
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">Start a company journey — the order crosses ALL 14 departments: strategy → research → product → finance → legal → architecture → engineering → review → QA → security → release → marketing → support → governance</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="jn-title">What is being built / ordered?</label><input type="text" id="jn-title" placeholder="e.g. Invoice OCR micro-SaaS for Iraqi SMEs"></div>
      <div><label class="fl" for="jn-prod">Product (optional)</label><select id="jn-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Autopilot</label><label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:8px 0"><input type="checkbox" id="jn-auto"> minimal human touch</label></div>
      <button class="btn btn-primary" id="jn-go">Launch journey</button>
    </div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Journeys in motion — click one to walk its stations</div>
    ${journeys.map((j) => {
      const pct = Math.round((j.doneCount / j.total) * 100);
      return `<a class="journey-row" href="#/journeys/${j.id}">
        <div class="jr-head">
          <span><b>${esc(j.title)}</b> ${j.product_id ? `<span class="chip chip-ember">${esc(j.product_id)}</span>` : ''}</span>
          <span>
            ${j.activeStage ? `<span class="chip" style="color:${DEPT_COLORS[j.activeStage.dept] || 'var(--ink)'}">now: ${esc(j.activeStage.dept)}${j.activeStage.state === 'awaiting_human' ? ' ⏸ needs a human' : ''}</span>` : ''}
            <span class="state state-${j.state === 'done' ? 'done' : j.state === 'awaiting_human' ? 'awaiting_human' : j.state === 'cancelled' ? 'failed' : 'running'}">${esc(j.state)}</span>
          </span>
        </div>
        <div class="jr-track"><div class="jr-fill" style="width:${pct}%"></div></div>
        <div class="map-legend">${j.doneCount}/${j.total} departments crossed · ${pct}% · cost ${money4(j.costUsd)} · started ${esc(j.created_at.slice(0, 16))}</div>
      </a>`;
    }).join('') || '<div class="empty">No journeys yet — launch one above and watch it travel the company.</div>'}
  </div>`;
  $('#jn-go')?.addEventListener('click', async () => {
    try {
      const auto = $('#jn-auto').checked;
      const j = await api('/api/journeys', { method: 'POST', body: { title: $('#jn-title').value, productId: $('#jn-prod').value || null, autopilot: auto } });
      toast(auto ? 'Autopilot journey launched — only the final sign-off is yours' : 'Journey launched — first stop: strategy sign-off'); location.hash = `#/journeys/${j.id}`;
    } catch (e) { toast(e.message, true); }
  });
}
// ---------- System Design studio ----------
export async function renderSystems() {
  const [blueprints, catalog, products] = await Promise.all([
    api('/api/design'), api('/api/design/catalog'), api('/api/products').catch(() => []),
  ]);
  const canM = hasPermC('design.manage');
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">New design package — one sentence in, a complete specification out</div>
    <div class="form-inline">
      <div style="flex:1.4"><label class="fl" for="bp-name">System name</label><input type="text" id="bp-name" placeholder="Invoice OCR platform"></div>
      <div><label class="fl" for="bp-prod">Product</label><select id="bp-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="bp-go">Generate package</button>
    </div>
    <div><label class="fl" for="bp-goal">Goal — what must this system do, for whom?</label><textarea id="bp-goal" placeholder="A web app that lets Iraqi SMEs photograph supplier invoices and get structured accounting entries, with Arabic OCR and export to their accountant."></textarea></div>
    <div class="form-inline">
      <div><label class="fl" for="bp-audience">Audience / users</label><input type="text" id="bp-audience" placeholder="SME owners, accountants"></div>
      <div><label class="fl" for="bp-scale">Scale</label><input type="text" id="bp-scale" placeholder="5,000 users, 50 req/s peak"></div>
      <div><label class="fl" for="bp-budget">Budget</label><input type="text" id="bp-budget" placeholder="$500/mo infra"></div>
      <div><label class="fl" for="bp-stack">Stack preference</label><input type="text" id="bp-stack" placeholder="any / Node + Postgres"></div>
      <div><label class="fl" for="bp-comp">Compliance</label><input type="text" id="bp-comp" placeholder="Iraqi data residency"></div>
      <div><label class="fl" for="bp-lang">Language</label><select id="bp-lang" aria-label="Language"><option value="English">English</option><option value="Arabic">العربية</option><option value="Arabic and English">both</option></select></div>
    </div>
    <div class="panel-title" style="margin-top:12px">Documents to produce — ${catalog.length} available, all selected by default</div>
    <div class="rule-grid">
      ${catalog.map((d) => `<label class="rule-card">
        <input type="checkbox" class="bp-doc" value="${esc(d.key)}" checked>
        <span><b>${esc(d.title)}</b><span class="rule-detail">${esc(short(d.brief, 130))}</span>
        <span class="rule-detail" style="color:var(--ink-faint)">writer: ${esc(d.agent)}${d.needs.length ? ` · needs: ${d.needs.join(', ')}` : ''}</span></span>
      </label>`).join('')}
    </div>
    <div class="map-legend">Documents are written in dependency order, each one seeing the approved output of the ones it depends on — so the architecture cannot contradict the requirements. The final document is a <b>build brief you can hand to any AI coding agent</b> to produce the whole application.</div>
  </div>` : ''}
  ${blueprints.map((b) => {
    const pct = Math.round((b.progress.done / Math.max(1, b.progress.total)) * 100);
    return `<div class="panel">
      <div class="jr-head">
        <span><b>${esc(b.name)}</b> ${b.product_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(b.product_id)}</a>` : ''}
          <span class="state state-${b.state === 'ready' ? 'done' : b.state === 'awaiting_human' ? 'awaiting_human' : b.state === 'cancelled' ? 'failed' : 'running'}">${esc(b.state)}</span></span>
        <span>
          <span class="chip">${b.progress.done}/${b.progress.total} docs</span>
          <span class="chip chip-dim">${b.progress.words.toLocaleString()} words · ${money4(b.progress.costUsd)}</span>
          ${b.progress.done ? `<button class="btn btn-sm" data-download="/api/design/${b.id}/bundle" data-filename="design-package-${b.id}.md">⬇ Full package</button>
          <button class="btn btn-sm btn-ok" data-download="/api/design/${b.id}/build-brief" data-filename="BUILD-BRIEF-${b.id}.md" title="paste this into an AI coding agent">⬇ Build brief</button>` : ''}
          ${connBtn('blueprint', b.id)}
          ${canM && !['ready', 'cancelled'].includes(b.state) ? `<button class="btn btn-sm btn-bad" data-bpcancel="${b.id}">✕</button>` : ''}
        </span>
      </div>
      <div class="map-legend">${esc(short(b.goal, 200))}</div>
      <div class="jr-track" style="margin:8px 0"><div class="jr-fill" style="width:${pct}%"></div></div>
      <div class="doc-grid">
        ${b.docs.map((d) => `<a class="doc-chip ${d.state}" href="#/systems/${b.id}/${esc(d.doc_key)}" title="${esc(d.title)}">
          <span class="dc-seq">${d.seq}</span><span class="dc-title">${esc(short(d.title, 30))}</span>
          <span class="dc-state">${d.state === 'done' ? '✓' : d.state === 'writing' ? '✎' : d.state === 'awaiting_human' ? '⏸' : '·'}</span>
        </a>`).join('')}
      </div>
      ${b.progress.blocked ? `<div class="reason">${b.progress.blocked} document(s) need you — open them to retry or approve.</div>` : ''}
    </div>`;
  }).join('') || '<div class="panel"><div class="empty">No design packages yet — describe a system above and the studio writes the whole specification.</div></div>'}`;
  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#bp-go')?.addEventListener('click', async () => {
    const docKeys = [...view.querySelectorAll('.bp-doc:checked')].map((c) => c.value);
    try {
      const b = await api('/api/design', { method: 'POST', body: {
        name: $('#bp-name').value, goal: $('#bp-goal').value, docKeys,
        productId: $('#bp-prod').value || null,
        context: { audience: $('#bp-audience').value, scale: $('#bp-scale').value, budget: $('#bp-budget').value, stack: $('#bp-stack').value, compliance: $('#bp-comp').value, language: $('#bp-lang').value },
      } });
      toast(`Package started — ${b.progress.total} documents queued`); renderSystems();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-bpcancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Cancel this design package?')) return;
    try { await api(`/api/design/${b.dataset.bpcancel}/cancel`, { method: 'POST', body: {} }); renderSystems(); } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Infrastructure ----------
export async function renderInfra() {
  const [{ overview, plans }, sections, blueprints] = await Promise.all([
    api('/api/infra'), api('/api/infra/sections'), api('/api/design').catch(() => []),
  ]);
  const canM = hasPermC('infra.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Plans</div><div class="big">${overview.total}</div><div class="sub">${overview.ready} ready · ${overview.drafting} drafting</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Estimated infra cost</div><div class="big">${esc(money(overview.estimatedMonthlyUsd))}</div><div class="sub">per month, across ready plans</div></div>
    <div class="panel tile"><div class="panel-title">Sections</div><div class="big">${sections.length}</div><div class="sub">full plan or one layer at a time</div></div>
    <div class="panel tile"><div class="panel-title">Linked designs</div><div class="big">${plans.filter((p) => p.blueprint_id).length}</div><div class="sub">sized against a real architecture</div></div>
  </div>
  ${canM ? `<div class="panel">
    <div class="panel-title">Plan the infrastructure — sized from the load you state, with the arithmetic shown</div>
    <div class="form-inline">
      <div style="flex:1.4"><label class="fl" for="if-name">Name</label><input type="text" id="if-name" placeholder="Invoice OCR — production"></div>
      <div><label class="fl" for="if-section">Section</label><select id="if-section" aria-label="Section">${sections.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}</select></div>
      <div><label class="fl" for="if-bp">From design</label><select id="if-bp" aria-label="Blueprint"><option value="">—</option>${blueprints.map((b) => `<option value="${b.id}">${esc(short(b.name, 26))}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="if-go">Design it</button>
    </div>
    <div class="form-inline">
      <div><label class="fl" for="if-users">Users</label><input type="text" id="if-users" placeholder="5000"></div>
      <div><label class="fl" for="if-rps">Peak req/sec</label><input type="text" id="if-rps" placeholder="50"></div>
      <div><label class="fl" for="if-data">Data (GB)</label><input type="text" id="if-data" placeholder="200"></div>
      <div><label class="fl" for="if-budget">Budget $/mo</label><input type="text" id="if-budget" placeholder="500"></div>
      <div><label class="fl" for="if-cloud">Cloud</label><input type="text" id="if-cloud" placeholder="AWS / Hetzner / any"></div>
      <div><label class="fl" for="if-regions">Regions</label><input type="text" id="if-regions" placeholder="eu-central, me-south"></div>
      <div><label class="fl" for="if-avail">Availability</label><input type="text" id="if-avail" placeholder="99.9%"></div>
      <div><label class="fl" for="if-comp">Compliance</label><input type="text" id="if-comp" placeholder="GDPR"></div>
    </div>
  </div>` : ''}
  ${plans.map((p) => `
  <div class="panel">
    <div class="jr-head">
      <span><b>${esc(p.name)}</b> <span class="chip chip-steel">${esc(p.section)}</span>
        ${p.blueprint ? `<a class="chip chip-ember" style="text-decoration:none" href="#/design">${esc(short(p.blueprint.name, 24))}</a>` : ''}
        <span class="state state-${p.state === 'ready' ? 'done' : p.state === 'failed' ? 'failed' : 'running'}">${esc(p.state)}</span></span>
      <span>
        ${p.costTable.length ? `<span class="chip">${esc(money(p.costTable.reduce((a, c) => a + (Number(c.monthlyUsd) || 0), 0)))}/mo</span>` : ''}
        ${p.content ? `<button class="btn btn-sm" data-download="/api/infra/${p.id}/export" data-filename="infra-${p.id}.md">⬇ Markdown</button>` : ''}
        ${connBtn('infraPlan', p.id)}
      </span>
    </div>
    <div class="map-legend">${Object.entries(p.spec).filter(([, v]) => v).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ') || 'no load stated'}</div>
    ${p.costTable.length ? `<table style="margin-top:8px"><thead><tr><th>Line item</th><th class="num">Monthly</th></tr></thead><tbody>
      ${p.costTable.map((c) => `<tr><td>${esc(c.item)}</td><td class="num">${esc(money(c.monthlyUsd))}</td></tr>`).join('')}
    </tbody></table>` : ''}
    ${p.content ? `<details style="margin-top:8px"><summary class="map-legend" style="cursor:pointer">read the plan</summary><pre class="json" style="max-height:60vh;white-space:pre-wrap">${esc(p.content)}</pre></details>`
      : `<div class="empty">${p.state === 'drafting' ? 'The infrastructure agent is working…' : 'No content.'}</div>`}
  </div>`).join('')}`;
  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#if-go')?.addEventListener('click', async () => {
    try {
      await api('/api/infra', { method: 'POST', body: {
        name: $('#if-name').value, section: $('#if-section').value,
        blueprintId: $('#if-bp').value ? Number($('#if-bp').value) : null,
        spec: { users: $('#if-users').value, rps: $('#if-rps').value, dataGb: $('#if-data').value, budgetUsd: $('#if-budget').value, cloud: $('#if-cloud').value, regions: $('#if-regions').value, availability: $('#if-avail').value, compliance: $('#if-comp').value },
      } });
      toast('Infrastructure agent is designing'); renderInfra();
    } catch (e) { toast(e.message, true); }
  });
}
// ---------- The queue ----------
export async function renderJobs() {
  const d = await api('/api/jobs');
  const canM = hasPermC('jobs.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Waiting', d.counts.queued, 'due now or backing off')}
    ${tile('Running', d.counts.running, 'in flight')}
    ${tile('Finished', d.counts.done, 'completed and closed')}
    ${tile('Dead', d.counts.dead, 'gave up after every attempt', d.counts.dead ? 'tile-bad' : '')}
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">By kind</div>
      <table><thead><tr><th>Kind</th><th>Jobs</th><th>Dead</th><th>Avg attempts</th></tr></thead><tbody>
      ${d.kinds.map((k) => `<tr><td class="mono">${esc(k.kind)}</td><td class="num mono">${k.n}</td>
        <td class="num mono" style="${k.dead ? 'color:var(--bad)' : ''}">${k.dead || 0}</td><td class="num mono">${k.avg_attempts}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Nothing has been queued.</td></tr>'}
      </tbody></table>
      <div class="map-legend">Registered handlers: ${d.registered.map((r) => `<span class="chip chip-dim">${esc(r)}</span>`).join(' ') || 'none'}</div>
    </div>
    <div class="panel">
      <div class="panel-title">Gave up — somebody should look</div>
      <table><thead><tr><th>#</th><th>Kind</th><th>Tries</th><th>Last error</th><th></th></tr></thead><tbody>
      ${d.deadLetter.map((j) => `<tr><td class="mono">${j.id}</td><td class="mono">${esc(j.kind)}</td><td class="num mono">${j.attempts}</td>
        <td class="sub">${esc(short(j.error || '', 60))}</td>
        <td>${canM ? xbtn(`/api/jobs/${j.id}/retry`, {}, 'Try again') : ''}</td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">Nothing has been abandoned.</td></tr>'}
      </tbody></table>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Recent</div>
    <table><thead><tr><th>#</th><th>Kind</th><th>State</th><th>Tries</th><th>Error</th><th>Queued</th><th></th></tr></thead><tbody>
    ${d.recent.map((j) => `<tr><td class="mono">${j.id}</td><td class="mono">${esc(j.kind)}</td>
      <td><span class="chip ${j.state === 'done' ? 'chip-ok' : j.state === 'dead' ? 'chip-bad' : j.state === 'running' ? 'chip-ember' : 'chip-dim'}">${esc(j.state)}</span></td>
      <td class="num mono">${j.attempts}</td><td class="sub">${esc(short(j.last_error || '', 44))}</td>
      <td class="mono sub">${esc(String(j.created_at).slice(5, 16))}</td>
      <td>${canM && j.state === 'queued' ? xbtn(`/api/jobs/${j.id}/cancel`, {}, 'Cancel') : ''}</td></tr>`).join('')}
    </tbody></table>
    <div class="map-legend">A failed job is re-queued with a growing pause between attempts — five seconds, ten, twenty, and so on to an hour — and an idempotency key means the same logical work can never be queued twice. After the last attempt it is shelved rather than retried forever, because a job that cannot succeed should be read by a person, not repeated by a machine.</div>
  </div>`;
  wireXact(renderJobs);
}
// ---------- Department packages ----------
export async function renderPackages() {
  const d = await api('/api/packages');
  const canI = hasPermC('packages.install');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Installed', d.counts.installed, 'departments running from a manifest', d.counts.installed ? 'tile-ok' : '')}
    ${tile('Available', d.counts.available, 'registered, not yet installed')}
    ${tile('Failed', d.counts.failed, 'rolled back, nothing left behind', d.counts.failed ? 'tile-bad' : '')}
    ${tile('Sections contributed', d.sections.length, 'they appear on the map like any other')}
  </div>

  <div class="panel">
    <div class="panel-title">Packages</div>
    <table><thead><tr><th>Package</th><th>Version</th><th>State</th><th>What it adds</th><th></th></tr></thead><tbody>
    ${d.packages.map((p) => `<tr>
      <td><b>${esc(p.name)}</b><div class="sub">${esc(short(p.description || '', 80))}</div></td>
      <td class="mono">${esc(p.version)}${p.author ? `<div class="sub">${esc(p.author)}</div>` : ''}</td>
      <td><span class="chip ${p.state === 'installed' ? 'chip-ok' : p.state === 'failed' ? 'chip-bad' : 'chip-dim'}">${esc(p.state)}</span>${p.last_error ? `<div class="sub" style="color:var(--bad)">${esc(short(p.last_error, 50))}</div>` : ''}</td>
      <td class="sub"><button class="btn btn-sm" data-pkgview="${esc(p.id)}">Read the manifest</button></td>
      <td>${canI && p.state !== 'installed' ? xbtn(`/api/packages/${p.id}/install`, {}, 'Install', 'btn-primary') : ''}
          ${canI && p.state === 'installed' ? xbtn(`/api/packages/${p.id}/uninstall`, {}, 'Uninstall') : ''}</td>
    </tr>`).join('')}
    </tbody></table>
    <div id="pkg-detail"></div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">What a package may and may not do</div>
      <table><tbody>${d.rules.map((r) => `<tr><td>${esc(r)}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Write one</div>
      ${canI ? `
      <textarea id="pk-manifest" rows="10" placeholder="paste a manifest…" style="width:100%;font-family:var(--font-mono);font-size:11px"></textarea>
      <div class="form-inline" style="margin-top:8px">
        <button class="btn btn-sm" id="pk-check">Check it</button>
        <button class="btn btn-sm btn-primary" id="pk-add">Register</button>
        <button class="btn btn-sm" id="pk-example">Load the example</button>
      </div>
      <div id="pk-out"></div>` : '<div class="empty">packages.install required</div>'}
    </div>
  </div>`;

  wireXact(renderPackages);
  view.querySelectorAll('[data-pkgview]').forEach((b) => b.addEventListener('click', async () => {
    const p = await api(`/api/packages/${b.dataset.pkgview}`);
    $('#pkg-detail').innerHTML = `<div class="sub" style="margin-top:12px"><b>${esc(p.name)}</b> — ${Object.entries(p.rows).map(([t, n]) => `${t}: ${n ?? '—'} rows`).join(' · ') || 'no tables yet'}</div>${preBody(JSON.stringify(p.manifest, null, 1))}`;
  }));
  $('#pk-example')?.addEventListener('click', () => { $('#pk-manifest').value = JSON.stringify(d.example, null, 2); });
  const readManifest = () => { try { return JSON.parse($('#pk-manifest').value); } catch { toast('That is not valid JSON', true); return null; } };
  $('#pk-check')?.addEventListener('click', async () => {
    const manifest = readManifest(); if (!manifest) return;
    const r = await api('/api/packages/validate', { method: 'POST', body: { manifest } });
    $('#pk-out').innerHTML = r.ok
      ? '<div class="chip chip-ok" style="margin-top:10px">This manifest can be installed.</div>'
      : `<div style="margin-top:10px">${r.problems.map((p) => `<div class="chip chip-bad" style="margin:2px">${esc(p)}</div>`).join('')}</div>`;
  });
  $('#pk-add')?.addEventListener('click', async () => {
    const manifest = readManifest(); if (!manifest) return;
    try { await api('/api/packages', { method: 'POST', body: { manifest } }); toast('Registered'); renderPackages(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderCapacity() {
  const rows = await api('/api/capacity');
  const sat = rows.filter((r) => r.saturated).length;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Active employees', rows.length, 'AI workforce on shift')}
    ${tile('Saturated', sat, 'over 3 live runs or 80% daily budget', sat ? 'tile-warn' : '')}
    ${tile('Live work items', rows.reduce((a, b) => a + b.active, 0), 'queued + leased + running')}
    ${tile('Waiting on humans', rows.reduce((a, b) => a + b.waiting, 0), 'at the gate')}
  </div>
  <div class="panel"><div class="panel-title">Load board — live per employee</div>
    <table><thead><tr><th>Agent</th><th>Group</th><th class="num">Active</th><th class="num">Gate</th><th class="num">Done 7d</th><th style="width:22%">Daily budget</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td class="mono">${esc(r.id)}</td><td class="mono">${esc(r.role_group)}</td>
      <td class="num">${r.active}</td><td class="num">${r.waiting}</td><td class="num">${r.done7}</td>
      <td><div class="meter-track"><div class="meter-fill ${r.budgetPct > 80 ? 'hot' : ''}" style="width:${Math.min(100, r.budgetPct)}%"></div></div></td>
      <td>${r.saturated ? '<span class="chip chip-warn">saturated</span>' : '<span class="chip chip-ok">ok</span>'}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
}
export async function renderLab() {
  const rows = await api('/api/lab');
  const canM = hasPermC('lab.manage');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New experiment — two prompts race, you judge the winner</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="lx-name" placeholder="name" style="width:180px">
      <input id="lx-hypo" placeholder="hypothesis (optional)" style="width:260px">
      <textarea id="lx-a" placeholder="variant A prompt" style="width:100%;height:56px"></textarea>
      <textarea id="lx-b" placeholder="variant B prompt" style="width:100%;height:56px"></textarea>
      <button class="btn btn-sm btn-primary" id="lx-go">Run A/B</button></div>` : '<div class="map-legend">lab.manage required to start experiments.</div>'}
  </div>
  ${rows.map((x) => `
  <div class="panel">
    <div class="panel-title"><span>#${x.id} ${esc(x.name)} <span class="chip ${x.state === 'concluded' ? 'chip-ok' : 'chip-warn'}">${esc(x.state)}</span>${x.winner ? ` <span class="chip chip-ember">winner: ${esc(x.winner)}</span>` : ''}</span>
      <span>${canM && x.state === 'running' && x.result_a && x.result_b ? xbtn(`/api/lab/${x.id}/conclude`, { winner: 'a' }, 'A wins') + xbtn(`/api/lab/${x.id}/conclude`, { winner: 'b' }, 'B wins') + xbtn(`/api/lab/${x.id}/conclude`, { winner: 'inconclusive' }, 'Inconclusive') : ''}</span></div>
    ${x.hypothesis ? `<div class="map-legend">${esc(x.hypothesis)}</div>` : ''}
    <div class="grid grid-2">
      <div><b style="font-size:12px">A</b>${preBody(x.result_a || '⏳ running…')}</div>
      <div><b style="font-size:12px">B</b>${preBody(x.result_b || '⏳ running…')}</div>
    </div>
  </div>`).join('') || '<div class="panel"><div class="empty">No experiments yet.</div></div>'}`;
  wireXact(renderLab);
  $('#lx-go')?.addEventListener('click', async () => {
    try {
      await api('/api/lab', { method: 'POST', body: { name: $('#lx-name').value, hypothesis: $('#lx-hypo').value || null, variantA: $('#lx-a').value, variantB: $('#lx-b').value } });
      toast('Experiment running'); renderLab();
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderReleases() {
  const rows = await api('/api/releases');
  const canM = hasPermC('releases.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Draft a release — notes compile themselves from completed work</div>
    ${canM ? `<div class="form-inline">
      <input id="rl-ver" placeholder="version, e.g. 1.4.0" style="width:160px">
      <button class="btn btn-sm btn-primary" id="rl-go">Draft notes</button></div>` : ''}
  </div>
  ${rows.map((r) => `
  <div class="panel">
    <div class="panel-title"><span>v${esc(r.version)} <span class="chip ${r.state === 'published' ? 'chip-ok' : 'chip-warn'}">${esc(r.state)}</span></span>
      <span>${canM && r.state === 'draft' && r.notes ? xbtn(`/api/releases/${r.id}/publish`, {}, 'Publish', 'btn-ok') : ''}</span></div>
    ${preBody(r.notes || '⏳ the agent is compiling the changelog…')}
  </div>`).join('') || '<div class="panel"><div class="empty">No releases yet.</div></div>'}`;
  wireXact(renderReleases);
  $('#rl-go')?.addEventListener('click', async () => {
    try { await api('/api/releases', { method: 'POST', body: { version: $('#rl-ver').value } }); toast('Drafting'); renderReleases(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderWorkstreams() {
  const d = await api('/api/workstreams');
  const canM = hasPermC('workstreams.manage');
  const waiting = d.workstreams.filter((w) => w.state === 'awaiting_human').length;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Running', d.workstreams.filter((w) => w.state === 'running').length, 'cycling right now')}
    ${tile('Waiting on you', waiting, 'a human decision unblocks them', waiting ? 'tile-warn' : '')}
    ${tile('Rounds run', d.workstreams.reduce((a, w) => a + w.cycles, 0), 'produce → review → audit')}
    ${tile('Accepted', d.workstreams.filter((w) => w.state === 'done').length, 'closed by a human')}
  </div>
  <div class="panel">
    <div class="panel-title">Start a workstream — pick the methodology the work actually needs</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap;gap:8px">
      <input id="ws-title" placeholder="title" style="width:220px">
      <select id="ws-method" aria-label="Method" style="width:auto">${Object.entries(d.methods).map(([k, m]) => `<option value="${k}" ${k === 'kaizen' ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <input id="ws-target" aria-label="Target" type="number" step="0.05" min="0.5" max="1" value="0.85" title="quality target" style="width:80px">
      <input id="ws-cycles" aria-label="Cycles" type="number" min="1" max="8" value="4" title="cycle budget" style="width:70px">
      <select id="ws-reviewers" aria-label="Reviewers" style="width:auto" title="peer reviewers per round"><option value="1">1 reviewer</option><option value="2" selected>2 reviewers</option><option value="3">3 reviewers</option></select>
      <textarea id="ws-goal" placeholder="the goal — what must exist when this is done" style="width:100%;height:52px"></textarea>
      <div style="width:100%">
        <div class="map-legend" style="margin:0 0 4px">Route — the departments this work travels through, in order (click to toggle):</div>
        <div id="ws-route" class="route-picker">${d.departments.map((dep) => `<button data-dep="${esc(dep)}" class="${['research', 'engineering', 'docs'].includes(dep) ? 'on' : ''}">${esc(dep)}</button>`).join('')}</div>
      </div>
      <button class="btn btn-sm btn-primary" id="ws-go">Start cycling</button>
      <span id="ws-method-hint" class="map-legend" style="margin:0">${esc(METHOD_HINT.kaizen)}</span>
    </div>` : '<div class="map-legend">workstreams.manage required to start one.</div>'}
  </div>
  <div class="panel">
    <div class="panel-title">Workstreams</div>
    <table><thead><tr><th>#</th><th>Title</th><th>Method</th><th>Route</th><th class="num">Round</th><th class="num">Best</th><th>State</th><th></th></tr></thead><tbody>
    ${d.workstreams.map((w) => `<tr>
      <td class="mono">${w.id}</td>
      <td><a href="#/workstreams/${w.id}"><b>${esc(w.title)}</b></a>${w.note ? `<div class="map-legend">${esc(w.note)}</div>` : ''}</td>
      <td><span class="chip chip-ember">${esc(d.methods[w.method]?.label || w.method)}</span></td>
      <td class="mono" style="font-size:10px">${w.route.map((r) => esc(r)).join(' → ')}</td>
      <td class="num mono">${w.current_cycle}/${w.max_cycles}</td>
      <td class="num">${scoreChip(w.best_score)}</td>
      <td><span class="chip ${w.state === 'done' ? 'chip-ok' : w.state === 'awaiting_human' ? 'chip-warn' : w.state === 'cancelled' ? 'chip-dim' : 'chip-ember'}">${esc(w.state)}</span></td>
      <td><a class="btn btn-sm" href="#/workstreams/${w.id}">Open</a></td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">No workstreams yet — this is where one-shot tasks become work that improves itself.</td></tr>'}
    </tbody></table>
  </div>`;
  view.querySelectorAll('#ws-route button').forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));
  $('#ws-method')?.addEventListener('change', (e) => { $('#ws-method-hint').textContent = METHOD_HINT[e.target.value] || ''; });
  $('#ws-go')?.addEventListener('click', async () => {
    const route = [...view.querySelectorAll('#ws-route button.on')].map((b) => b.dataset.dep);
    try {
      const r = await api('/api/workstreams', { method: 'POST', body: {
        title: $('#ws-title').value, goal: $('#ws-goal').value, method: $('#ws-method').value,
        route, qualityTarget: Number($('#ws-target').value), maxCycles: Number($('#ws-cycles').value),
        reviewers: Number($('#ws-reviewers').value),
      } });
      toast('Workstream started — round 1 producing'); location.hash = `#/workstreams/${r.id}`;
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderSprints() {
  const [sprints, tasks] = await Promise.all([api('/api/sprints'), api('/api/tasks').catch(() => [])]);
  const canM = hasPermC('sprints.manage');
  const backlog = tasks.filter((t) => !t.sprint_id && !['done', 'cancelled'].includes(t.state));
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New iteration</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="sp-name" placeholder="sprint name, e.g. Sprint 4" style="width:170px">
      <input id="sp-goal" placeholder="sprint goal — one sentence" style="width:340px">
      <input id="sp-start" aria-label="Start" type="date" style="width:140px"><input id="sp-end" aria-label="End" type="date" style="width:140px">
      <button class="btn btn-sm btn-primary" id="sp-go">Create</button></div>` : ''}
  </div>
  ${sprints.map((s) => {
    const pct = s.tasks.points ? Math.round((s.tasks.pointsDone / s.tasks.points) * 100) : 0;
    return `<div class="panel">
    <div class="panel-title"><span>${esc(s.name)}
      <span class="chip ${s.state === 'closed' ? 'chip-ok' : s.state === 'active' ? 'chip-ember' : 'chip-warn'}">${esc(s.state)}</span>
      ${s.velocity != null ? `<span class="chip chip-dim">velocity ${s.velocity}</span>` : ''}</span>
      <span>${canM && s.state === 'planning' ? xbtn(`/api/sprints/${s.id}/state`, { state: 'active' }, 'Start sprint', 'btn-primary') : ''}
        ${canM && s.state === 'active' ? xbtn(`/api/sprints/${s.id}/state`, { state: 'review' }, 'Go to review') : ''}</span></div>
    ${s.goal ? `<div class="map-legend">${esc(s.goal)}</div>` : ''}
    <div class="form-inline" style="margin-top:6px">
      <span class="chip">${s.tasks.done}/${s.tasks.total} tasks</span>
      <span class="chip">${s.tasks.pointsDone}/${s.tasks.points} points</span>
      <div class="meter-track" style="flex:1"><div class="meter-fill ${pct >= 80 ? 'cool' : ''}" style="width:${pct}%"></div></div>
    </div>
    ${canM && ['planning', 'active'].includes(s.state) && backlog.length ? `<div class="form-inline" style="margin-top:8px">
      <select id="sp-task-${s.id}" style="width:50%">${backlog.map((t) => `<option value="${t.id}">#${t.id} ${esc(short(t.title, 60))}</option>`).join('')}</select>
      <input id="sp-pts-${s.id}" type="number" min="1" max="13" value="3" style="width:70px" title="story points">
      <button class="btn btn-sm" data-assign="${s.id}">Commit to sprint</button></div>` : ''}
    ${s.state === 'review' && canM ? `<div class="form-inline" style="margin-top:8px">
      <input id="sp-retro-${s.id}" placeholder="retrospective — what to change next iteration (required)" style="width:60%">
      <button class="btn btn-sm btn-ok" data-close="${s.id}">Close with retro</button></div>` : ''}
    ${s.retro ? `<div class="map-legend"><b>Retro:</b> ${esc(s.retro)}</div>` : ''}
  </div>`;
  }).join('') || '<div class="panel"><div class="empty">No sprints yet.</div></div>'}`;
  wireXact(renderSprints);
  $('#sp-go')?.addEventListener('click', async () => {
    try {
      await api('/api/sprints', { method: 'POST', body: { name: $('#sp-name').value, goal: $('#sp-goal').value || null, startsOn: $('#sp-start').value || null, endsOn: $('#sp-end').value || null } });
      toast('Sprint created'); renderSprints();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', async () => {
    const sid = b.dataset.assign;
    try {
      await api(`/api/sprints/${sid}/assign`, { method: 'POST', body: { taskId: Number($(`#sp-task-${sid}`).value), points: Number($(`#sp-pts-${sid}`).value) } });
      toast('Committed'); renderSprints();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', async () => {
    const sid = b.dataset.close;
    try { await api(`/api/sprints/${sid}/state`, { method: 'POST', body: { state: 'closed', retro: $(`#sp-retro-${sid}`).value } }); toast('Closed'); renderSprints(); }
    catch (e) { toast(e.message, true); }
  }));
}
