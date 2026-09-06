// The company surface: how it governs itself, and what it owes.
//
// Grouped by the same mapping the navigation is drawn from.

import { $, esc, linkFor, money, money4, short, toast, view } from '../core/dom.js';
import { TOKEN_KEY, actor, currentUser, hasPermC } from '../state/session.js';
import { api, downloadFile } from '../services/api.js';
import { connBtn, wireConnections } from '../components/common.js';
import { disablePush, enablePush, preBody, pushState, refreshShell, wireXact, xbtn } from '../components/chrome.js';
import { tile } from '../components/tile.js';
import { t } from '/i18n.js';

export async function renderAnchors() {
  const d = await api('/api/anchors');
  const v = d.verification;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Witnessed', d.anchors.filter((a) => a.ok).length, 'times the chain was written down elsewhere')}
    ${tile('Height', v.highestAnchoredHeight || 0, 'the last entry a third party saw')}
    ${tile('Unwitnessed', v.unanchoredEntries || 0, 'entries provable only against themselves', v.unanchoredEntries > 500 ? 'tile-warn' : '')}
    ${tile('Agrees with the world', v.ok ? 'yes' : 'NO', v.ok ? 'and with itself' : 'history was rewritten after it was anchored', v.ok ? 'tile-ok' : 'tile-bad')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Two questions, deliberately kept apart</div>
    <div class="map-legend">
      <b>${v.internallyConsistent ? '✓' : '✗'} It agrees with itself.</b> Every hash follows from the one before it.
      This is necessary and it is not evidence: anybody who owns this file can rewrite history and recompute every
      hash, and the result passes this check perfectly.<br><br>
      <b>${v.ok ? '✓' : '✗'} It agrees with the world.</b> The chain still hashes to what ${esc(d.witness)} wrote
      down, at a time nobody here chose. This is the one that cannot be forged on the machine holding the file.
    </div>
    ${!d.witnessIsExternal ? `<div class="login-note" style="margin-top:10px">The witness is <b>${esc(d.witness)}</b>, which is not external. A local file is rewritable by anybody who can rewrite the database — it exists to exercise the mechanism, not to prove anything.</div>` : ''}
    <div class="form-inline" style="margin-top:10px">
      <span class="chip ${d.last ? 'chip-ok' : 'chip-warn'}">${d.last ? `witnessed ${d.ageHours}h ago` : 'never witnessed'}</span>
      <span class="sub">every ${d.everyHours}h · ${esc(d.witness)}</span>
      ${hasPermC('settings.manage') ? '<button class="btn btn-primary" id="an-now">Anchor now</button>' : ''}
    </div>
  </div>
  ${v.findings.length ? `<div class="panel" style="margin-top:16px;border-color:var(--bad)">
    <div class="panel-title" style="color:var(--bad)">History was rewritten after it was witnessed</div>
    ${v.findings.map((f) => `<div>${esc(f)}</div>`).join('')}</div>` : ''}
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Every attempt, including the ones that failed</div>
    <table><thead><tr><th>When</th><th>Witness</th><th>Height</th><th></th><th>Evidence</th></tr></thead><tbody>
    ${d.anchors.map((a) => `<tr>
      <td class="mono">${esc(a.at || a.createdAt)}</td>
      <td>${esc(a.witness)}</td><td class="mono">${a.height}</td>
      <td><span class="chip ${a.ok ? 'chip-ok' : 'chip-bad'}">${a.ok ? 'witnessed' : 'failed'}</span></td>
      <td class="sub">${esc(a.note || a.ref || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing has been witnessed yet.</td></tr>'}
    </tbody></table>
  </div>`;
  $('#an-now')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api('/api/anchors', { method: 'POST', body: {} }); toast(r.ok ? `witnessed at height ${r.height}` : r.reason || r.error, !r.ok); renderAnchors(); }
    catch (err) { toast(err.message, true); }
  });
}
export async function renderErasure() {
  const d = await api('/api/erasure');
  view.innerHTML = `
  <div class="grid grid-3">
    ${tile('People on file', d.known, 'known to this install by a one-way reference')}
    ${tile('Erased', d.erased, 'keys destroyed; the rows and their hashes remain')}
    ${tile('Columns walked', d.columnsCovered.length, 'a list, never a guess')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Forgetting somebody inside a record that cannot forget</div>
    <div class="map-legend">Their details are sealed under a key that belongs only to them, before the audit
      payload is hashed — so the chain covers the ciphertext and never knew the plaintext. Erasing destroys the
      key: the rows stay byte for byte as they were, every hash still verifies, and what was inside them is gone
      in the only sense that matters. What survives is that somebody existed under a reference, that they asked,
      and when it was done. The identifier itself is never written down.</div>
    ${hasPermC('compliance.view') ? `<div class="form-inline" style="margin-top:10px">
      <div style="flex:1"><label class="fl" for="er-id">Email or telephone number</label>
        <input type="text" id="er-id" placeholder="someone@example.com"></div>
      <button class="btn" id="er-find">What do we hold?</button>
      ${hasPermC('compliance.manage') ? '<button class="btn btn-bad" id="er-go">Erase</button>' : ''}
    </div><div id="er-out" style="margin-top:12px"></div>` : '<div class="empty">compliance.view required</div>'}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">What an erasure walks</div>
    <div class="sub">${d.columnsCovered.map(esc).join(' · ')}</div>
    <div class="map-legend">Anything not on this list is not touched. A regex that decides at runtime what counts
      as personal data is a regex that will one day decide wrongly and silently.</div>
  </div>`;
  const show = (r) => { $('#er-out').innerHTML = `<pre class="mono" style="white-space:pre-wrap;font-size:11.5px">${esc(JSON.stringify(r, null, 2))}</pre>`; };
  $('#er-find')?.addEventListener('click', async () => {
    try { show(await api('/api/erasure/find', { method: 'POST', body: { identifier: $('#er-id').value } })); }
    catch (e) { toast(e.message, true); }
  });
  $('#er-go')?.addEventListener('click', async () => {
    if (!confirm('This destroys their key. It cannot be undone, and it is meant not to be.')) return;
    try {
      show(await api('/api/erasure/erase', { method: 'POST', body: { identifier: $('#er-id').value, reason: 'requested' } }));
      renderErasure();
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderRoles() {
  const d = await api('/api/roles');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Jobs, instead of two hundred and four checkboxes</div>
    <div class="map-legend">A fresh install otherwise asks somebody to assemble a job out of 204 individual
      permissions before anybody can do anything, and nobody does that carefully at nine in the morning.
      Each irreversible power — releasing money, letting something out, reading every credential, restoring a
      backup, amending the constitution — sits in <b>exactly one</b> template. Spreading them across convenient
      bundles is how they end up held by people nobody meant to give them to.</div>
  </div>
  <div class="grid grid-2" style="margin-top:16px">
  ${d.templates.map((t) => `<div class="panel">
    <div class="panel-title">${esc(t.label)} <span class="chip chip-dim">${t.count} permissions</span></div>
    <div class="sub" style="margin-top:6px">${esc(t.describes)}</div>
    ${t.irreversible.length ? `<div style="margin-top:10px">${t.irreversible.map((p) => `<span class="chip chip-bad" title="irreversible">${esc(p)}</span> `).join('')}</div>` : '<div class="sub" style="margin-top:10px;color:var(--ink-faint)">nothing irreversible</div>'}
  </div>`).join('')}
  </div>`;
}
export async function renderObservability() {
  const d = await api('/api/observability');
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Database', mb(d.size.bytes), `${d.size.totalRows.toLocaleString()} rows`)}
    ${tile('Write-ahead log', mb(d.size.walBytes), 'folded in at every backup')}
    ${tile('Event loop lag', `${d.loop.lagMs} ms`, 'how late everything is running', d.loop.lagMs > 200 ? 'tile-bad' : d.loop.lagMs > 80 ? 'tile-warn' : 'tile-ok')}
    ${tile('Worst since boot', `${d.loop.worstLagMs} ms`, 'the longest anything blocked')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">The hazard, said out loud</div>
    <div class="map-legend">${esc(d.loop.note)}</div>
    ${d.loop.slowest.length ? `<table style="margin-top:10px"><thead><tr><th>Operation</th><th>Blocked for</th><th>When</th></tr></thead><tbody>
      ${d.loop.slowest.map((s) => `<tr><td class="mono">${esc(s.label)}</td><td class="mono">${s.ms} ms</td><td class="sub">${esc(s.at)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="sub" style="margin-top:10px">Nothing has blocked longer than the threshold since this process started.</div>'}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Retention — and what is never deleted</div>
    <div class="map-legend">A chain that is never deleted plus a history that only grows is a disk-full outage
      with a long fuse, and a full disk stops the database dead. Deleting happens in bounded batches, because a
      single DELETE of two million rows would hold the event loop for as long as it takes — housekeeping causing
      the outage it exists to prevent.<br><br>
      <b>Never touched:</b> ${d.retention.neverDeleted.map(esc).join(', ')}. Deleting a chain entry breaks every
      hash after it.</div>
    <table style="margin-top:10px"><thead><tr><th>Table</th><th>Kept for</th><th>Held now</th><th>Due</th><th>Why</th></tr></thead><tbody>
    ${d.retention.plan.filter((p) => !p.missing).map((p) => `<tr><td class="mono">${esc(p.table)}</td><td class="mono">${p.days}d</td>
      <td class="mono">${p.total}</td><td class="mono">${p.due}</td><td class="sub">${esc(p.why)}</td></tr>`).join('')}
    </tbody></table>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Biggest tables</div>
    <table><thead><tr><th>Table</th><th>Rows</th></tr></thead><tbody>
    ${d.size.tables.slice(0, 12).map((t) => `<tr><td class="mono">${esc(t.table)}</td><td class="mono">${t.rows.toLocaleString()}</td></tr>`).join('')}
    </tbody></table>
    <div class="map-legend">Scraped by Prometheus at <span class="mono">${esc(d.metricsEndpoint)}</span>, which
      answers only this machine until METRICS_TOKEN is set.</div>
  </div>`;
}
// Things the company keeps doing without being asked again.
export async function renderStanding() {
  const s = await api('/api/standing');
  const order = (o) => `<tr>
      <td>${esc(o.goal)}<div class="sub">${esc(o.reason || '')}</div></td>
      <td><span class="chip chip-dim">${esc(o.kindLabel)}</span></td>
      <td class="sub">${esc(o.scheduleLabel)}</td>
      <td><span class="chip ${{ active: 'chip-ok', paused: 'chip-warn' }[o.state] || 'chip-dim'}">${esc(o.state)}</span>${o.paused_reason ? `<div class="sub">${esc(String(o.paused_reason).slice(0, 70))}</div>` : ''}</td>
      <td class="num">${o.firings}</td>
      <td class="num">${esc(money4(o.spent_usd || 0))}<div class="sub">of ${esc(money(o.lifetime_usd || 0))}</div></td>
      <td class="mono" style="font-size:11px">${esc(o.owner)}</td>
      <td>
        <button class="btn btn-sm" data-fire="${o.id}">Run now</button>
        ${o.state === 'paused'
    ? `<button class="btn btn-sm" data-resume="${o.id}">Resume</button>`
    : `<button class="btn btn-sm" data-pause="${o.id}">Pause</button>`}
        <button class="btn btn-sm btn-bad" data-del="${o.id}">Delete</button>
      </td>
    </tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Standing orders</div><div class="big">${s.active}</div><div class="sub">running without being asked</div></div>
    <div class="panel tile ${s.paused ? 'tile-warn' : ''}"><div class="panel-title">Turned off</div><div class="big">${s.paused}</div><div class="sub">paused, with the reason on them</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Firings</div><div class="big">${s.firings}</div><div class="sub">${s.failures} failed</div></div>
    <div class="panel tile"><div class="panel-title">Spent</div><div class="big">${esc(money(s.spentUsd))}</div><div class="sub">across every order</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">Add one</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="so-goal" class="input" placeholder="What should keep happening?" aria-label="What should keep happening?" style="flex:1;min-width:220px">
      <select id="so-kind" class="input input-sm" aria-label="What kind of work" style="width:190px">${s.kinds.map((k) => `<option value="${esc(k.key)}">${esc(k.label)}</option>`).join('')}</select>
      <select id="so-sched" class="input input-sm" aria-label="How often" style="width:140px">${s.schedules.map((k) => `<option value="${esc(k.key)}"${k.key === 'weekly' ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}</select>
      <button class="btn btn-primary" id="so-add">Add</button>
    </div>
    <input id="so-why" class="input" placeholder="Why should this keep happening? (required — an order nobody can explain never gets deleted)" aria-label="Why should this keep happening?" style="width:100%;margin-top:8px">
    <div class="map-legend" style="margin-top:8px">${esc(s.inherits)}</div>
  </div>

  <div class="panel">
    <div class="panel-title">Orders</div>
    ${s.orders.length
    ? `<div class="table-wrap"><table><thead><tr><th>Goal</th><th>Kind</th><th>How often</th><th>State</th><th class="num">Ran</th><th class="num">Spent</th><th>Owner</th><th></th></tr></thead><tbody>${s.orders.map(order).join('')}</tbody></table></div>`
    : '<div class="empty">nothing standing yet</div>'}
  </div>

  <div class="panel">
    <div class="panel-title">Every firing</div>
    ${s.recent.length
    ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Order</th><th>Result</th><th class="num">Cost</th></tr></thead><tbody>${s.recent.map((f) => `<tr><td class="mono" style="font-size:11px">${esc(String(f.at || '').slice(0, 16))}</td><td>${esc(String(f.goal || '').slice(0, 60))}</td><td><span class="chip ${f.ok ? 'chip-ok' : 'chip-bad'}">${f.ok ? 'ok' : 'failed'}</span> <span class="sub">${esc(String(f.note || '').slice(0, 80))}</span></td><td class="num">${esc(money4(f.cost_usd || 0))}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">nothing has fired yet</div>'}
  </div>`;

  const act = async (id, path, body = {}) => {
    try { await api(`/api/standing/${id}/${path}`, { method: 'POST', body }); render(); }
    catch (e) { toast(e.message, true); }
  };
  view.querySelectorAll('[data-fire]').forEach((b) => b.addEventListener('click', async () => {
    toast('running…');
    await act(b.dataset.fire, 'fire');
  }));
  view.querySelectorAll('[data-pause]').forEach((b) => b.addEventListener('click', () => act(b.dataset.pause, 'pause', { why: 'paused by hand' })));
  view.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => act(b.dataset.resume, 'resume')));
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Delete this standing order?')) act(b.dataset.del, 'delete');
  }));

  $('#so-add').addEventListener('click', async () => {
    const goal = $('#so-goal').value.trim();
    const reason = $('#so-why').value.trim();
    if (!goal) { toast('what should keep happening?', true); return; }
    if (!reason) { toast('say why — an order nobody can explain never gets deleted', true); return; }
    try {
      await api('/api/standing', { method: 'POST', body: { goal, reason, kind: $('#so-kind').value, schedule: $('#so-sched').value } });
      toast('standing'); render();
    } catch (e) { toast(e.message, true); }
  });
}
// Draining, alerting, and whether a copy has ever left this machine.
export async function renderContinuity() {
  const l = await api('/api/lifecycle');
  const row = (k, v) => `<div class="meter-label"><span>${esc(k)}</span><span class="mono">${esc(String(v ?? '—'))}</span></div>`;
  view.innerHTML = `
  <div class="grid grid-3">
    <div class="panel tile ${l.draining ? 'tile-warn' : ''}"><div class="panel-title">State</div><div class="big">${l.draining ? 'draining' : 'serving'}</div><div class="sub">${l.draining ? 'finishing what it started' : 'accepting work'}</div></div>
    <div class="panel tile ${l.alerts?.configured ? '' : 'tile-warn'}"><div class="panel-title">Reachable at 3am</div><div class="big" style="font-size:18px">${esc(l.alerts?.channel || 'nobody')}</div><div class="sub">${l.alerts?.configured ? 'an alert reaches a person' : `set ALERT_CHANNEL — ${esc((l.alerts?.channels || []).join(', '))}`}</div></div>
    <div class="panel tile ${l.offsite?.lastShippedAt ? '' : 'tile-warn'}"><div class="panel-title">Off this machine</div><div class="big" style="font-size:18px">${l.offsite?.lastShippedAt ? 'yes' : 'never'}</div><div class="sub">${l.offsite?.lastShippedAt ? esc(String(l.offsite.lastShippedAt).slice(0, 16)) : (l.offsite?.configured ? 'configured, never run' : 'set BACKUP_SHIP_COMMAND')}</div></div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Everything this reports</div>
      ${Object.entries(l).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.entries(v).map(([k2, v2]) => row(`${k}.${k2}`, Array.isArray(v2) ? v2.join(', ') : v2))
    : [row(k, Array.isArray(v) ? v.join(', ') : v)])).join('')}
    </div>
    <div class="panel">
      <div class="panel-title">Write-ahead log</div>
      ${l.walArchive ? Object.entries(l.walArchive).map(([k, v]) => row(k, v)).join('') : '<div class="empty">nothing archived yet</div>'}
      <div class="map-legend">Between backups, the write-ahead log is the difference between losing a day and losing four minutes.</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Why this page exists</div>
    <p class="lede">These are the two findings the launch audit reports and nothing in the console could answer: whether a copy of the company has ever left this disk, and whether anyone can be reached when it is three in the morning and something is on fire. Both are settings, and both are decisions — so they are shown here rather than assumed.</p>
    <div><a class="btn" href="#/settings">Settings</a> <a class="btn" href="#/backups">Backups</a> <a class="btn" href="#/incidents">Incidents</a></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// The departments a company discovers it needed once somebody audited it.
// Every one of these pages leads with the number that would embarrass it, not
// the number that flatters it — a tax page whose headline is "12 classified"
// tells you nothing; "3 waiting on a person" tells you what to do today.
// ---------------------------------------------------------------------------
export async function renderPrivacy() {
  const d = await api('/api/privacy');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Overdue', d.overdue, `answers past ${d.dueDays} days`, d.overdue ? 'bad' : '')}
    ${tile('Open requests', d.open, 'people waiting to hear back')}
    ${tile('High risk, undecided', d.highRiskUndecided, 'flows nobody has ruled on', d.highRiskUndecided ? 'bad' : '')}
    ${tile('Copies handed over', d.exports.length, 'the half of the law built second')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Not the same question as security</div>
    <div class="map-legend">The SOC asks whether somebody can take this. This department asks whether the company may
      hold it at all, on what basis, and for how long. ${esc(d.note)}</div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Requests from people about their own data</div>
    ${d.requests.length ? `<table class="tbl"><thead><tr><th>Kind</th><th>Reference</th><th>Received</th><th>Due</th><th>State</th></tr></thead><tbody>
      ${d.requests.map((r) => {
    const late = ['received', 'working'].includes(r.state) && new Date(r.due_at.replace(' ', 'T') + 'Z') < new Date();
    return `<tr class="${late ? 'row-bad' : ''}"><td>${esc(r.kind)}</td><td class="mono">${esc(r.subject_ref)}</td>
      <td>${esc(r.received_at)}</td><td>${esc(r.due_at)}${late ? ' <span class="pill bad">overdue</span>' : ''}</td>
      <td>${esc(r.state)}</td></tr>`;
  }).join('')}
    </tbody></table>` : '<div class="empty">Nobody has asked. That is normal and does not mean the path works — try one.</div>'}
    ${hasPermC('privacy.assess') ? `<div class="form-inline" style="margin-top:10px">
      <div><label class="fl" for="pv-kind">Kind</label><select id="pv-kind">${d.kinds.map((k) => `<option>${k}</option>`).join('')}</select></div>
      <div style="flex:1"><label class="fl" for="pv-id">Email or telephone they used</label><input id="pv-id" placeholder="someone@example.com"></div>
      <button class="btn" id="pv-log">Log request</button>
    </div>` : ''}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Data flows</div>
    ${d.flows.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Purpose</th><th>Basis</th><th>Keeps</th><th>Risk</th><th>State</th></tr></thead><tbody>
      ${d.flows.map((f) => `<tr><td>${esc(f.name)}</td><td class="sub">${esc(f.purpose)}</td><td>${esc(f.lawful_basis)}</td>
        <td>${f.retention_days ? `${f.retention_days}d` : '<span class="pill bad">for ever</span>'}</td>
        <td>${f.risk === 'high' ? '<span class="pill bad">high</span>' : esc(f.risk)}</td><td>${esc(f.state)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No flow registered. Anything that moves personal data should be here before it runs.</div>'}
  </div>`;
  $('#pv-log')?.addEventListener('click', async () => {
    try {
      await api('/api/privacy/request', { method: 'POST', body: { kind: $('#pv-kind').value, identifier: $('#pv-id').value } });
      toast('Logged — the clock has started'); renderPrivacy();
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderIp() {
  const d = await api('/api/ip');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Lapsing within 90 days', d.dueSoon.length, 'a date nobody watches is how a mark is lost', d.dueSoon.length ? 'bad' : '')}
    ${tile('Registered', d.registered, 'granted or registered')}
    ${tile('Unclaimed', d.unclaimed.length, 'shipped and never protected')}
    ${tile('Spent', money(d.spend), 'filing and renewal')}
  </div>
  ${d.dueSoon.length ? `<div class="panel" style="margin-top:16px"><div class="panel-title">Renewals</div>
    <table class="tbl"><thead><tr><th>Name</th><th>Kind</th><th>Where</th><th>Renew by</th></tr></thead><tbody>
    ${d.dueSoon.map((a) => `<tr class="row-bad"><td>${esc(a.name)}</td><td>${esc(a.kind)}</td><td>${esc(a.jurisdiction || '—')}</td><td>${esc(a.renewal_at)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">What the company owns</div>
    ${d.assets.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Kind</th><th>Where</th><th>Reference</th><th>State</th><th>Owner</th></tr></thead><tbody>
      ${d.assets.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.kind)}</td><td>${esc(a.jurisdiction || '—')}</td>
        <td class="mono">${esc(a.reference || '—')}</td><td>${esc(a.state)}</td><td>${esc(a.owner)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Nothing registered.</div>'}
    ${hasPermC('ip.manage') ? `<div class="form-inline" style="margin-top:10px">
      <div style="flex:1"><label class="fl" for="ip-name">Name</label><input id="ip-name" placeholder="AlphaCore"></div>
      <div><label class="fl" for="ip-kind">Kind</label><select id="ip-kind">${d.kinds.map((k) => `<option>${k}</option>`).join('')}</select></div>
      <div><label class="fl" for="ip-owner">Owner</label><input id="ip-owner" placeholder="the company"></div>
      <button class="btn" id="ip-add">Record</button>
    </div>` : ''}
  </div>
  ${d.unclaimed.length ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">Shipped and unprotected</div>
    <div class="map-legend">Things this company made and never claimed. Not every one of these should be registered —
      but somebody should have decided, rather than nobody noticing.</div>
    <div class="sub" style="margin-top:8px">${d.unclaimed.map((u) => `${esc(u.name)} <span class="pill">${esc(u.suggest)}</span>`).join(' · ')}</div>
  </div>` : ''}`;
  $('#ip-add')?.addEventListener('click', async () => {
    try {
      await api('/api/ip', { method: 'POST', body: { name: $('#ip-name').value, kind: $('#ip-kind').value, owner: $('#ip-owner').value } });
      toast('Recorded'); renderIp();
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderDataGov() {
  const d = await api('/api/datagov');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Personal and unerasable', d.gap, 'the finding this department exists for', d.gap ? 'bad' : '')}
    ${tile('Columns', d.columns, `${d.classified} classified, ${d.reviewed} by a person`)}
    ${tile('Personal', d.personal, `${d.erasable} the erasure walk reaches`)}
    ${tile('Past retention', d.retention.length, 'tables holding rows longer than their class allows')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">The cross-check</div>
    <div class="map-legend">A column classified as personal that the erasure walk cannot reach means
      <em>a person can be forgotten</em> is untrue for whatever is in it. Neither module can see that on its own,
      which is the whole reason this comparison is run here — against the real walk, not a description of it.
      ${esc(d.note)}</div>
  </div>
  ${d.unerasable.length ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">Personal data an erasure would not touch</div>
    <table class="tbl"><thead><tr><th>Column</th><th>Class</th><th>Reviewed by</th><th>Note</th></tr></thead><tbody>
    ${d.unerasable.map((r) => `<tr class="row-bad"><td class="mono">${esc(r.table_name)}.${esc(r.column_name)}</td>
      <td>${esc(r.class_name || '—')}</td><td>${esc(r.reviewed_by || 'nobody yet')}</td><td class="sub">${esc(r.note || '')}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
  ${d.retention.length ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">Kept longer than the class allows</div>
    <div class="map-legend">Reported, never deleted here. Deleting somebody's data because a timer expired is a
      decision, and it belongs to a person.</div>
    <table class="tbl"><thead><tr><th>Table</th><th>Class</th><th>Keeps</th><th>Older rows</th></tr></thead><tbody>
    ${d.retention.map((r) => `<tr><td class="mono">${esc(r.table)}</td><td>${esc(r.class)}</td><td>${r.retainDays}d</td><td>${r.older}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Classes</div>
    <table class="tbl"><thead><tr><th>Name</th><th>Sensitivity</th><th>Keeps</th><th>Definition</th></tr></thead><tbody>
    ${d.classes.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.sensitivity)}</td>
      <td>${c.retain_days ? `${c.retain_days}d` : 'no limit'}</td><td class="sub">${esc(c.definition)}</td></tr>`).join('')}
    </tbody></table>
    ${hasPermC('datagov.classify') ? '<button class="btn" id="dg-rebuild" style="margin-top:10px">Rediscover columns from the schema</button>' : ''}
  </div>`;
  $('#dg-rebuild')?.addEventListener('click', async () => {
    try { const r = await api('/api/datagov/rebuild', { method: 'POST', body: {} }); toast(`${r.added} new column(s), ${r.gap} personal and unerasable`); renderDataGov(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderIncidents() {
  const incidents = await api('/api/incidents');
  const NEXT = { open: ['mitigated', 'resolved'], mitigated: ['resolved', 'open'], resolved: ['closed', 'open'], closed: [] };
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Declare an incident — a human commands, always</div>
    <div class="form-inline">
      <div style="flex:0.6"><label class="fl" for="in-sev">Severity</label><select id="in-sev" aria-label="Severity"><option>SEV1</option><option>SEV2</option><option selected>SEV3</option><option>SEV4</option></select></div>
      <div style="flex:2"><label class="fl" for="in-title">Title</label><input type="text" id="in-title"></div>
      <div><label class="fl" for="in-cmd">Commander (human)</label><input type="text" id="in-cmd" value="${esc(actor())}"></div>
      <button class="btn btn-primary" id="in-go">Declare</button>
    </div>
  </div>
  ${incidents.map((i) => `
  <div class="panel">
    <div class="panel-title">
      <span><span class="chip ${i.sev === 'SEV1' ? 'chip-bad' : i.sev === 'SEV2' ? 'chip-warn' : 'chip-dim'}">${esc(i.sev)}</span> #${i.id} · ${esc(i.title)}</span>
      <span><span class="state state-${i.state === 'closed' ? 'done' : i.state === 'open' ? 'failed' : 'awaiting_human'}">${esc(i.state)}</span> ${connBtn('incident', i.id)}</span>
    </div>
    <div class="map-legend">commander ${esc(i.commander)} · declared ${esc(i.created_at)}
      ${i.product_id ? ` · <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(i.product_id)}</a>` : ''}
      ${i.postmortem_pipeline_id ? ` · <a href="#/pipelines" class="chip chip-ok" style="text-decoration:none">postmortem pipeline ⚙</a>` : ''}
    </div>
    ${['SEV1', 'SEV2'].includes(i.sev) && !i.postmortem_pipeline_id ? `<div style="margin:6px 0"><button class="btn btn-sm" data-ipm-pipe="${i.id}">Draft postmortem via pipeline</button></div>` : ''}
    <div style="margin:8px 0">${i.timeline.map((t) => `<div class="mono" style="font-size:11.5px;padding:2px 0"><span style="color:var(--ink-faint)">${esc(t.t.slice(11, 19))}</span> <span style="color:var(--steel)">${esc(t.who)}</span> — ${esc(t.note)}</div>`).join('')}</div>
    ${i.postmortem ? `<div class="panel-title">Postmortem</div><pre class="json">${esc(i.postmortem)}</pre>` : ''}
    ${['resolved', 'closed'].includes(i.state) ? `
    <div class="form-inline" style="margin-top:6px">
      <div style="flex:2"><input type="text" data-ilesson="${i.id}" placeholder="One-line lesson → organizational memory (verified by this act)"></div>
      <button class="btn btn-sm btn-ok" data-ilessongo="${i.id}">Record lesson</button>
    </div>` : ''}
    ${i.state !== 'closed' ? `
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Timeline update</label><input type="text" data-inote="${i.id}"></div>
      <button class="btn btn-sm" data-iupd="${i.id}">Add update</button>
      ${NEXT[i.state].map((s) => `<button class="btn btn-sm ${s === 'closed' ? 'btn-ok' : ''}" data-istate="${i.id}" data-to="${s}">→ ${s}</button>`).join('')}
    </div>
    ${['SEV1', 'SEV2'].includes(i.sev) && !i.postmortem ? `<div style="margin-top:8px"><label class="fl">Postmortem (required before ${esc(i.sev)} closes)</label><textarea data-ipm="${i.id}"></textarea></div>` : ''}` : ''}
  </div>`).join('') || '<div class="panel"><div class="empty">No incidents. May it stay that way.</div></div>'}`;

  $('#in-go').addEventListener('click', async () => {
    try { await api('/api/incidents', { method: 'POST', body: { sev: $('#in-sev').value, title: $('#in-title').value, commander: $('#in-cmd').value, actor: actor() } }); renderIncidents(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-iupd]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/incidents/${b.dataset.iupd}/update`, { method: 'POST', body: { note: view.querySelector(`[data-inote="${b.dataset.iupd}"]`).value, actor: actor() } }); renderIncidents(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-istate]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.istate;
    try {
      await api(`/api/incidents/${id}/state`, { method: 'POST', body: { state: b.dataset.to, postmortem: view.querySelector(`[data-ipm="${id}"]`)?.value || null, actor: actor() } });
      renderIncidents();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-ipm-pipe]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/incidents/${b.dataset.ipmPipe}/postmortem-pipeline`, { method: 'POST', body: { actor: actor() } });
      toast('Postmortem pipeline started — see Pipelines'); renderIncidents();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-ilessongo]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.ilessongo;
    try {
      await api(`/api/incidents/${id}/lesson`, { method: 'POST', body: { content: view.querySelector(`[data-ilesson="${id}"]`).value, actor: actor() } });
      toast('Lesson recorded in Knowledge (verified)'); renderIncidents();
    } catch (e) { toast(e.message, true); }
  }));
  wireConnections();
}
export async function renderGovernance() {
  const [notif, rituals, problems, fin] = await Promise.all([
    api('/api/notifications'), api('/api/rituals'), api('/api/problems'), api('/api/finance'),
  ]);
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title"><span>Notifications (${notif.unread} unread)</span><button class="btn btn-sm" id="nt-read">Mark all read</button></div>
      ${notif.items.slice(0, 30).map((n) => {
        const href = linkFor(n.subject_type, n.subject_id);
        return `
        <div class="round"><div class="round-body">
          <span class="chip ${n.level === 'crit' ? 'chip-bad' : n.level === 'warn' ? 'chip-warn' : 'chip-dim'}">${esc(n.level)}</span>
          ${href ? `<a href="${href}" style="color:inherit;${n.read ? 'color:var(--ink-faint)' : ''}"> ${esc(n.message)} →</a>` : `<span style="${n.read ? 'color:var(--ink-faint)' : ''}"> ${esc(n.message)}</span>`}
          <div class="map-legend">${esc(n.source)} · ${esc(n.created_at)}</div>
        </div></div>`;
      }).join('') || '<div class="empty">All quiet.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Governance calendar — no artifact, no meeting</div>
      ${rituals.map((r) => `
        <div class="round"><div class="round-body">
          <div class="agent-head">
            <span><b>${esc(r.title)}</b> <span class="chip chip-dim">${esc(r.cadence)}</span></span>
            <span class="mono" style="color:${r.overdue ? 'var(--bad)' : r.dueToday ? 'var(--warn)' : 'var(--ink-faint)'}">due ${esc(r.next_due)}</span>
          </div>
          <div class="map-legend">${esc(r.description || '')}${r.last_done ? ` · last done ${esc(r.last_done)}: ${esc(short(r.last_note, 60))}` : ''}</div>
          <div class="form-inline" style="margin-top:4px">
            <div style="flex:2"><input type="text" data-rnote="${esc(r.id)}" placeholder="artifact note…"></div>
            <button class="btn btn-sm btn-ok" data-rdone="${esc(r.id)}">Complete</button>
          </div>
        </div></div>`).join('')}
    </div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Open problems (immune system)</div>
      ${problems.filter((p) => p.state === 'open').map((p) => `
        <div class="round"><div class="round-body">
          <div class="agent-head"><span class="mono">${esc(p.signature)}</span><button class="btn btn-sm btn-ok" data-presolve="${p.id}">Resolve</button></div>
          <div class="map-legend">count ${p.count} · ${esc(short(p.note, 100))}</div>
        </div></div>`).join('') || '<div class="empty">No open problems.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title"><span>Finance pack — ${esc(fin.month)}</span><button class="btn btn-sm" id="fin-export">Export .md</button></div>
      <dl class="kv">
        <dt>Cash spend</dt><dd>${esc(money4(fin.totalCostUsd))} of ${esc(money(fin.capUsd))} (${fin.capConsumedPct.toFixed(1)}%)</dd>
        <dt>Governance</dt><dd>${esc(money4(fin.governanceUsd))} (${fin.governancePctOfSpend.toFixed(1)}% of spend)</dd>
        <dt>Subscription</dt><dd>${fin.subscription.calls} calls · ${fin.subscription.tin.toLocaleString()} in / ${fin.subscription.tout.toLocaleString()} out tok · $0</dd>
        <dt>Activity</dt><dd>${fin.activity.pipelines} pipelines · ${fin.activity.decisions} decisions · ${fin.activity.incidents} incidents · ${fin.activity.ticketsSent} tickets sent</dd>
        <dt>Commercial</dt><dd>MRR <a href="#/customers">${esc(money(fin.commercial.mrrUsd))}</a> · CAC ${fin.commercial.cashCacUsd !== null ? esc(money(fin.commercial.cashCacUsd)) : '—'} · <a href="#/vendors">vendor burn ${esc(money(fin.commercial.vendorBurnUsd))}/mo</a></dd>
      </dl>
      <table style="margin-top:10px">
        <thead><tr><th>Provider</th><th class="num">Calls</th><th class="num">Cost</th></tr></thead>
        <tbody>${fin.byProvider.map((p) => `<tr><td class="mono">${esc(p.provider)}</td><td class="num">${p.calls}</td><td class="num">${esc(money4(p.cost))}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;

  $('#nt-read').addEventListener('click', async () => { await api('/api/notifications/read', { method: 'POST', body: {} }); renderGovernance(); refreshShell(); });
  $('#fin-export').addEventListener('click', async () => {
    try { const r = await api('/api/finance/export', { method: 'POST', body: { actor: actor() } }); toast(`Exported ${r.path} — see Artifacts`); } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-rdone]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/rituals/${b.dataset.rdone}/complete`, { method: 'POST', body: { note: view.querySelector(`[data-rnote="${b.dataset.rdone}"]`).value, actor: actor() } }); toast('Ritual completed'); renderGovernance(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-presolve]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/problems/${b.dataset.presolve}/resolve`, { method: 'POST', body: { actor: actor() } }); renderGovernance(); } catch (e) { toast(e.message, true); }
  }));
}
export async function renderLegal() {
  const [contracts, vendors, products] = await Promise.all([api('/api/contracts'), api('/api/vendors'), api('/api/products')]);
  const NEXT = { draft: ['under_review'], under_review: ['signed', 'draft'], signed: ['expired'], expired: [] };
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New legal item — signing is human-only and named, always (Part 1 §6.1)</div>
    <div class="form-inline">
      <div><label class="fl" for="lg-kind">Kind</label><select id="lg-kind" aria-label="Kind"><option>contract</option><option>tos</option><option>privacy</option><option>dpa</option><option>nda</option><option>provider-terms</option></select></div>
      <div style="flex:1.5"><label class="fl" for="lg-title">Title</label><input type="text" id="lg-title"></div>
      <div><label class="fl" for="lg-cp">Counterparty</label><input type="text" id="lg-cp"></div>
      <div><label class="fl" for="lg-due">Review due</label><input type="text" id="lg-due" placeholder="2026-12-01"></div>
      <div><label class="fl" for="lg-vendor">Vendor</label><select id="lg-vendor" aria-label="Vendor"><option value="">—</option>${vendors.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="lg-prod">Product</label><select id="lg-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="lg-go">Register</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Legal register</div>
    <table>
      <thead><tr><th>Kind</th><th>Title</th><th>Counterparty</th><th>State</th><th>Review due</th><th>Links</th><th>Actions</th></tr></thead>
      <tbody>${contracts.map((c) => `
        <tr>
          <td class="mono">${esc(c.kind)}</td>
          <td>${esc(c.title)}${c.signed_by ? `<div class="map-legend">signed by ${esc(c.signed_by)} · ${esc(c.signed_at || '')}</div>` : ''}</td>
          <td>${esc(c.counterparty)}</td>
          <td><span class="state state-${c.state === 'signed' ? 'done' : c.state === 'expired' ? 'failed' : 'awaiting_human'}">${esc(c.state)}</span></td>
          <td class="mono" style="color:${c.review_due && c.review_due < new Date().toISOString().slice(0, 10) ? 'var(--bad)' : 'var(--ink-faint)'}">${esc(c.review_due || '—')}</td>
          <td>${c.vendor_id ? `<a class="chip chip-dim" style="text-decoration:none" href="#/vendors">${esc(c.vendor_id)}</a>` : ''}
              ${c.product_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(c.product_id)}</a>` : ''}
              ${c.decision_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/decisions/${esc(c.decision_id)}">${esc(c.decision_id)}</a>` : ''}</td>
          <td>${(NEXT[c.state] || []).map((s2) => `<button class="btn btn-sm ${s2 === 'signed' ? 'btn-ok' : ''}" data-lgstate="${c.id}" data-to="${s2}">${s2 === 'signed' ? `Sign as ${esc(actor())}` : '→ ' + s2}</button>`).join(' ')}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing registered. A5/A6 closure lives here (Part 7 §4).</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#lg-go').addEventListener('click', async () => {
    try {
      await api('/api/contracts', { method: 'POST', body: { kind: $('#lg-kind').value, title: $('#lg-title').value, counterparty: $('#lg-cp').value, reviewDue: $('#lg-due').value || null, vendorId: $('#lg-vendor').value || null, productId: $('#lg-prod').value || null, actor: actor() } });
      renderLegal();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-lgstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/contracts/${b.dataset.lgstate}/state`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderLegal(); } catch (e) { toast(e.message, true); }
  }));
}
export async function renderVendors() {
  const vendors = await api('/api/vendors');
  const total = vendors.filter((v) => v.state === 'active').reduce((a, v) => a + v.monthly_usd, 0);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title"><span>Vendor register — surprise renewals must be 0 (Part 2 §3.6)</span><span class="chip chip-ember">fixed burn ${esc(money(total))}/mo</span></div>
    <table>
      <thead><tr><th>Vendor</th><th>Service</th><th class="num">$/mo</th><th>Renewal</th><th>Owner</th><th>Contracts</th><th></th></tr></thead>
      <tbody>${vendors.map((v) => `
        <tr style="${v.state === 'cancelled' ? 'opacity:.5' : ''}">
          <td><b>${esc(v.name)}</b>${v.source === 'model-provider' ? ' <span class="chip chip-steel">provider</span>' : ''}</td>
          <td>${esc(v.service)}</td>
          <td class="num">${esc(money(v.monthly_usd))}</td>
          <td class="mono" style="color:${v.renewal_date && v.renewal_date <= new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) ? 'var(--warn)' : 'var(--ink-faint)'}">${esc(v.renewal_date || '—')}</td>
          <td class="mono">${esc(v.owner)}</td>
          <td>${v.contracts.map((c) => `<a class="chip ${c.state === 'signed' ? 'chip-ok' : 'chip-dim'}" style="text-decoration:none" href="#/legal">${esc(c.kind)}</a>`).join(' ') || '<span class="chip chip-warn">no contract</span>'}</td>
          <td>${v.state === 'active' ? `<button class="btn btn-sm btn-bad" data-vstate="${esc(v.id)}" data-to="cancelled">Cancel</button>` : `<button class="btn btn-sm btn-ok" data-vstate="${esc(v.id)}" data-to="active">Reactivate</button>`}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="panel">
    <div class="panel-title">Add a vendor</div>
    <div class="form-inline">
      <div><label class="fl" for="vn-name">Name</label><input type="text" id="vn-name"></div>
      <div style="flex:1.5"><label class="fl" for="vn-svc">Service</label><input type="text" id="vn-svc"></div>
      <div><label class="fl" for="vn-usd">$/month</label><input type="text" id="vn-usd" value="0"></div>
      <div><label class="fl" for="vn-renew">Renewal</label><input type="text" id="vn-renew" placeholder="2027-01-01"></div>
      <button class="btn btn-primary" id="vn-go">Add</button>
    </div>
  </div>`;
  $('#vn-go').addEventListener('click', async () => {
    try { await api('/api/vendors', { method: 'POST', body: { name: $('#vn-name').value, service: $('#vn-svc').value, monthlyUsd: Number($('#vn-usd').value) || 0, renewalDate: $('#vn-renew').value || null, actor: actor() } }); renderVendors(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-vstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/vendors/${b.dataset.vstate}/state`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderVendors(); } catch (e) { toast(e.message, true); }
  }));
}
export async function renderObjectives() {
  const [objectives, products] = await Promise.all([api('/api/objectives'), api('/api/products')]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New objective</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="ob-title">Title</label><input type="text" id="ob-title"></div>
      <div><label class="fl" for="ob-q">Quarter</label><input type="text" id="ob-q" value="2026-Q3"></div>
      <div><label class="fl" for="ob-owner">Owner</label><input type="text" id="ob-owner" value="CEO"></div>
      <div><label class="fl" for="ob-prod">Product</label><select id="ob-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="ob-go">Create</button>
    </div>
    <div><label class="fl" for="ob-krs">Key results — one per line: description | target | unit</label><textarea id="ob-krs" placeholder="First paying customer | 1 | customers&#10;Escaped defects per release | 1 | defects"></textarea></div>
  </div>
  ${objectives.map((o) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(o.title)} <span class="chip chip-dim">${esc(o.quarter)}</span> <span class="chip">${esc(o.owner)}</span>${o.product_id ? ` <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(o.product_id)}</a>` : ''}</span>
      <span class="state state-${o.state === 'done' ? 'done' : o.state === 'dropped' ? 'failed' : 'running'}">${esc(o.state)}</span>
    </div>
    ${o.krs.map((kr, ki) => {
      const pct = kr.target ? Math.min(100, (Number(kr.current || 0) / Number(kr.target)) * 100) : 0;
      return `
      <div style="margin:8px 0">
        <div class="meter-label"><span>${esc(kr.kr)}</span><span class="mono">${esc(String(kr.current ?? 0))} / ${esc(String(kr.target))} ${esc(kr.unit || '')}</span></div>
        <div class="meter-track"><div class="meter-fill ${pct >= 100 ? '' : 'cool'}" style="width:${pct}%"></div></div>
        ${o.state === 'active' ? `<div class="form-inline" style="margin-top:4px"><div style="flex:0.3"><input type="text" data-krv="${esc(o.id)}:${ki}" value="${esc(String(kr.current ?? 0))}"></div><button class="btn btn-sm" data-krupd="${esc(o.id)}" data-ki="${ki}">Update</button></div>` : ''}
      </div>`;
    }).join('')}
    ${o.state === 'active' ? `<div style="margin-top:6px"><button class="btn btn-sm btn-ok" data-obstate="${esc(o.id)}" data-to="done">Mark done</button> <button class="btn btn-sm btn-bad" data-obstate="${esc(o.id)}" data-to="dropped">Drop</button></div>` : ''}
  </div>`).join('') || '<div class="panel"><div class="empty">No objectives. The M-milestones (Part 1 §11) belong here.</div></div>'}`;

  $('#ob-go').addEventListener('click', async () => {
    const krs = $('#ob-krs').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [kr, target, unit] = l.split('|').map((x) => x.trim());
      return { kr, target: Number(target) || 1, current: 0, unit: unit || '' };
    });
    try { await api('/api/objectives', { method: 'POST', body: { title: $('#ob-title').value, quarter: $('#ob-q').value, owner: $('#ob-owner').value, productId: $('#ob-prod').value || null, krs, actor: actor() } }); renderObjectives(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-krupd]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.krupd; const ki = Number(b.dataset.ki);
    const o = objectives.find((x) => x.id === id);
    o.krs[ki].current = Number(view.querySelector(`[data-krv="${id}:${ki}"]`).value) || 0;
    try { await api(`/api/objectives/${id}/update`, { method: 'POST', body: { krs: o.krs, actor: actor() } }); renderObjectives(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-obstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/objectives/${b.dataset.obstate}/update`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderObjectives(); } catch (e) { toast(e.message, true); }
  }));
}
export async function renderOversight() {
  const o = await api('/api/oversight');
  view.innerHTML = `
  <div class="grid grid-3">
    <div class="panel">
      <div class="panel-title"><span>Chain</span><span class="chip ${o.chain.ok ? 'chip-ok' : 'chip-bad'}">${o.chain.ok ? `intact · ${o.chain.checked}` : 'BROKEN'}</span></div>
      <div class="panel-title" style="margin-top:10px">Human actions · 7d</div>
      ${o.humanActions7d.map((h) => `<div class="meter-label"><span class="mono">${esc(h.actor_id)}</span><span class="mono">${h.n}</span></div>`).join('') || '<div class="empty">quiet</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Suspended agents</div>
      ${o.suspendedAgents.map((a) => `<div class="meter-label"><a class="mono" href="#/agents" style="color:var(--bad)">${esc(a.id)}</a><span class="mono">${esc(a.human_owner)}</span></div>`).join('') || '<div class="empty">none</div>'}
      <div class="panel-title" style="margin-top:10px">Frozen budgets</div>
      ${o.frozenBudgets.map((b) => `<div class="meter-label"><a class="mono" href="#/budgets" style="color:var(--warn)">${esc(b.scope)}/${esc(b.scope_id)}</a><span class="mono">${esc(money4(b.spent_usd))}/${esc(money(b.cap_usd))}</span></div>`).join('') || '<div class="empty">none</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">The rule</div>
      <div class="map-legend" style="font-size:11.5px;line-height:1.7">Agents execute; humans are accountable — always. Every approval below carries a named human. Suspension and freezes are reversible containment; resumption is a human decision recorded on the chain.</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Approvals ledger — who approved what</div>
    <table>
      <thead><tr><th class="num">#</th><th>Gate</th><th>Subject</th><th>Verdict</th><th>Approver</th><th>Note</th><th>When</th></tr></thead>
      <tbody>${o.approvals.map((a) => `
        <tr><td class="num">${a.id}</td>
        <td class="mono">${esc(a.gate)}</td>
        <td class="mono">${esc(a.subject_type)}${a.agent_id ? ` <span class="chip chip-dim">${esc(a.agent_id)}</span>` : ''}</td>
        <td><span class="chip ${a.verdict === 'approved' ? 'chip-ok' : 'chip-bad'}">${esc(a.verdict)}</span></td>
        <td class="mono" style="color:var(--steel)">${esc(a.approver_human)}</td>
        <td>${esc(short(a.note || '—', 40))}</td>
        <td class="mono" style="color:var(--ink-faint)">${esc(a.created_at.slice(0, 16))}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No approvals yet.</td></tr>'}
      </tbody>
    </table>
  </div>`;
}
export async function renderUsers() {
  const [users, perms] = await Promise.all([api('/api/users'), api('/api/perms')]);
  const groups = {};
  for (const p of perms) { const g = p.split('.')[0]; (groups[g] ||= []).push(p); }
  const permBoxes = (checked = [], prefix = 'np') => Object.entries(groups).map(([g, list]) => `
    <div style="margin:4px 0"><span class="mono" style="color:var(--ink-faint);font-size:10px;text-transform:uppercase;letter-spacing:.15em">${esc(g)}</span><br>
    ${list.map((p) => `<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-family:var(--font-mono);font-size:11px"><input type="checkbox" class="${prefix}-perm" value="${esc(p)}" ${checked.includes(p) ? 'checked' : ''}>${esc(p.split('.')[1])}</label>`).join('')}</div>`).join('');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Create user — grant exactly the permissions they need, down to a single one</div>
    <div class="form-inline">
      <div><label class="fl" for="us-name">Username</label><input type="text" id="us-name"></div>
      <div><label class="fl" for="us-disp">Display name</label><input type="text" id="us-disp"></div>
      <div><label class="fl" for="us-pass">Password</label><input type="password" id="us-pass"></div>
      <button class="btn btn-primary" id="us-go">Create</button>
    </div>
    <div class="panel-title" style="margin-top:10px">Permissions</div>
    ${permBoxes([], 'np')}
  </div>
  ${users.map((u) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(u.display_name)} <span class="mono" style="letter-spacing:0;color:var(--ink-faint)">@${esc(u.username)}</span>
        <span class="chip ${u.role === 'superadmin' ? 'chip-ember' : 'chip-dim'}">${esc(u.role)}</span></span>
      <span>
        <span class="chip ${u.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(u.status)}</span>
        ${u.role !== 'superadmin' ? `<button class="btn btn-sm ${u.status === 'active' ? 'btn-bad' : 'btn-ok'}" data-ustatus="${u.id}" data-to="${u.status === 'active' ? 'disabled' : 'active'}">${u.status === 'active' ? 'Disable' : 'Enable'}</button>` : ''}
        <button class="btn btn-sm" data-utoggle="${u.id}">Edit</button>
      </span>
    </div>
    <div class="agent-meta">${u.role === 'superadmin' ? '<span class="chip chip-ember">* — everything</span>' : u.perms.map((p) => `<span class="chip">${esc(p)}</span>`).join('') || '<span class="chip chip-warn">no permissions</span>'}</div>
    <div data-uedit="${u.id}" hidden style="margin-top:10px">
      ${u.role !== 'superadmin' ? `<div class="panel-title">Permissions</div>${permBoxes(u.perms, `up${u.id}`)}
      <button class="btn btn-sm btn-ok" data-usaveperms="${u.id}">Save permissions</button>` : ''}
      <div class="form-inline" style="margin-top:8px">
        <div><input type="password" data-unewpass="${u.id}" placeholder="new password"></div>
        <button class="btn btn-sm" data-uresetpw="${u.id}">Reset password</button>
      </div>
    </div>
  </div>`).join('')}`;
  $('#us-go').addEventListener('click', async () => {
    const permsSel = [...view.querySelectorAll('.np-perm:checked')].map((c) => c.value);
    try { await api('/api/users', { method: 'POST', body: { username: $('#us-name').value, displayName: $('#us-disp').value || null, password: $('#us-pass').value, perms: permsSel } }); toast('User created'); renderUsers(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-utoggle]').forEach((b) => b.addEventListener('click', () => {
    const d = view.querySelector(`[data-uedit="${b.dataset.utoggle}"]`); d.hidden = !d.hidden;
  }));
  view.querySelectorAll('[data-ustatus]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/users/${b.dataset.ustatus}/update`, { method: 'POST', body: { status: b.dataset.to } }); renderUsers(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-usaveperms]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.usaveperms;
    const sel = [...view.querySelectorAll(`.up${id}-perm:checked`)].map((c) => c.value);
    try { await api(`/api/users/${id}/update`, { method: 'POST', body: { perms: sel } }); toast('Permissions saved'); renderUsers(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-uresetpw]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.uresetpw;
    const pw = view.querySelector(`[data-unewpass="${id}"]`).value;
    try { await api(`/api/users/${id}/update`, { method: 'POST', body: { password: pw } }); toast('Password reset'); } catch (e) { toast(e.message, true); }
  }));
}
export async function renderSettings() {
  const s = await api('/api/settings');
  // The consultant's own panel. Degrades to an empty shape rather than losing
  // the whole page on an install that predates the endpoint.
  const o = await api('/api/oracle').catch(() => ({
    id: 'AGT-ORACLE-001', name: 'The Consultant', enabled: false, model: '', models: [], persona: '',
    keyConfigured: false, keyTail: null, ready: false, recent: [], note: 'This install has no consultant endpoint yet.',
  }));
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">This company — the name every agent, report and letter uses</div>
    <div class="map-legend">The platform is AlphaCore. The company it runs is yours: set the name here and
      it replaces <span class="mono">this company</span> in every system prompt, investor update and
      generated document. The public address is what outbound links and webhook callbacks point at.</div>
    <div class="form-inline" style="margin-top:10px">
      <div style="flex:1"><label class="fl" for="s-company">Company name</label><input type="text" id="s-company" value="${esc(s.company?.name || '')}" placeholder="e.g. Northwind Trading"></div>
      <div style="flex:1"><label class="fl" for="s-baseurl">Public address</label><input type="text" id="s-baseurl" value="${esc(s.company?.publicBaseUrl || '')}" placeholder="https://ops.yourcompany.com"></div>
      <button class="btn btn-primary" id="s-identity">Save</button>
    </div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">
      <span>${esc(t('Production mode'))}</span>
      <span class="chip ${s.production ? 'chip-bad' : 'chip-dim'}">${s.production ? esc(t('PRODUCTION')) : 'off'}</span>
    </div>
    <div class="map-legend">${esc(t('Held to two things every public machine needs: a master key from outside this disk, and https behind a trusted proxy. Without them it refuses to start.'))}</div>
    <div class="form-inline" style="margin-top:10px">
      <div><label class="fl" for="s-prod">${esc(t('Production mode'))}</label>
        <select id="s-prod" aria-label="${esc(t('Production mode'))}">
          <option value="false"${s.production ? '' : ' selected'}>off</option>
          <option value="true"${s.production ? ' selected' : ''}>on</option>
        </select></div>
      <button class="btn" id="s-prod-save">Save</button>
      <span class="sub">${esc(t('The master key comes from'))}: <b>${esc(s.masterKeySource || '—')}</b></span>
    </div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">This account — a second factor, and where it is signed in</div>
    <div class="map-legend">A password is one secret, and it is reused, phished and leaked more often than
      anybody admits. A one-time code from a phone is the cheapest thing that makes a stolen password
      useless on its own. Recovery codes are shown once, when it is switched on: a lost phone must not
      mean a lost company.</div>
    <div id="sec-body" class="sub" style="margin-top:10px">…</div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Being told — notifications on this device</div>
    <div class="map-legend">The company stops at a gate until a person answers it. Somebody who is not looking at a tab
      cannot answer, so autonomy waits, and nothing appears to be wrong. This is the only path to them: a title, a line,
      and a route — never a record. Turn it on once per device.</div>
    <div class="form-inline" style="margin-top:10px">
      <span id="push-state" class="chip chip-dim">…</span>
      <button class="btn" id="push-on">Turn on for this device</button>
      <button class="btn btn-sm" id="push-off">Turn off</button>
      <button class="btn btn-sm" id="push-test">Send myself one</button>
    </div>
    <div id="push-list" class="sub" style="margin-top:10px"></div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">AI providers — keys are stored locally (SQLite), never echoed back; a secret manager replaces this in real deployment (Part 3 §6.3)</div>
    <table>
      <thead><tr><th>Provider</th><th>Key / flag</th><th>Status</th><th>Set value</th><th></th></tr></thead>
      <tbody>${s.providers.map((p) => `
        <tr>
          <td><b>${esc(p.provider)}</b> <span class="chip chip-dim">${esc(p.kind)}</span></td>
          <td class="mono" style="font-size:11px">${esc(p.keyName)}${p.configured && p.tail ? ` <span style="color:var(--ink-faint)">····${esc(p.tail)}</span>` : ''}${p.source ? ` <span class="chip chip-dim">${esc(p.source)}</span>` : ''}</td>
          <td>${p.available ? '<span class="chip chip-ok">available</span>' : '<span class="chip chip-warn">off</span>'}</td>
          <td>${p.kind === 'claude-cli'
            ? `<select data-skey="${esc(p.keyName)}" aria-label="${esc(p.provider)} — enabled or disabled" style="width:auto"><option value="true" ${p.configured ? 'selected' : ''}>enabled</option><option value="" ${p.configured ? '' : 'selected'}>disabled</option></select>`
            : `<input type="password" data-skey="${esc(p.keyName)}" placeholder="${p.configured ? 'replace key…' : 'paste API key…'}" style="width:220px">`}</td>
          <td><button class="btn btn-sm btn-ok" data-ssave="${esc(p.keyName)}">Save</button>
              ${p.configured && p.source === 'settings' ? `<button class="btn btn-sm btn-bad" data-sclear="${esc(p.keyName)}">Clear</button>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="form-inline" style="margin-top:12px">
      <span class="chip ${s.mockMode ? 'chip-warn' : 'chip-ok'}">${s.mockMode ? 'MOCK MODE' : 'LIVE'}</span>
      <button class="btn btn-sm" id="s-mock">${s.mockForced ? 'Disable forced mock' : 'Force mock mode'}</button>
      <button class="btn btn-sm" id="s-probe">Test connectivity (T1)</button>
      <span id="s-probe-out" class="mono" style="color:var(--ink-mute)"></span>
    </div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">
      <span>${esc(t('The consultant — one employee who answers anything'))}</span>
      <span class="chip ${o.ready ? 'chip-ok' : 'chip-warn'}">${esc(o.ready ? t('answering') : o.enabled ? t('needs a key') : t('off'))}</span>
    </div>
    <div class="map-legend">${esc(t(o.note))}</div>
    <div class="form-inline" style="margin-top:12px">
      <div><label class="fl" for="o-on">${esc(t('Hired'))}</label>
        <select id="o-on" aria-label="${esc(t('Hired'))}">
          <option value="false"${o.enabled ? '' : ' selected'}>${esc(t('off'))}</option>
          <option value="true"${o.enabled ? ' selected' : ''}>${esc(t('on'))}</option>
        </select></div>
      <div><label class="fl" for="o-name">${esc(t('Name on the floor'))}</label><input type="text" id="o-name" value="${esc(o.name)}" style="width:190px"></div>
      <div><label class="fl" for="o-model">${esc(t('Model'))}</label>
        <select id="o-model" aria-label="${esc(t('Model'))}">${o.models.map((mm) => `<option value="${esc(mm)}"${mm === o.model ? ' selected' : ''}>${esc(mm)}</option>`).join('')}</select></div>
      <div style="flex:1;min-width:220px"><label class="fl" for="o-key">${esc(t('DeepSeek API key'))}${o.keyConfigured ? ` <span class="sub">····${esc(o.keyTail)}</span>` : ''}</label>
        <input type="password" id="o-key" placeholder="${esc(o.keyConfigured ? t('set — paste a new one to replace it') : 'sk-…')}" autocomplete="new-password" style="width:100%"></div>
      <div style="flex:1;min-width:200px"><label class="fl" for="o-url">${esc(t('Address (a mirror or proxy, if any)'))}</label>
        <input type="text" id="o-url" dir="ltr" value="${esc(o.baseUrlOverridden ? o.baseUrl : '')}" placeholder="${esc(o.baseUrlDefault || '')}" style="width:100%"></div>
      <button class="btn btn-primary" id="o-save">${esc(t('Save'))}</button>
    </div>
    <div style="margin-top:10px">
      <label class="fl" for="o-persona">${esc(t('How it should answer — its whole system prompt'))}</label>
      <textarea id="o-persona" dir="auto" rows="6" style="width:100%;font-family:var(--font-mono);font-size:11.5px">${esc(o.persona)}</textarea>
    </div>
    <div class="form-inline" style="margin-top:8px">
      <button class="btn btn-sm" id="o-reset">${esc(t('Restore the default prompt'))}</button>
      <a class="btn btn-sm" href="#/chat">${esc(t('Talk to it on the floor'))} →</a>
      <span class="sub">${esc(t('Mention'))} <span class="mono">@${esc(o.id)}</span> ${esc(t('in any channel, or open a direct message.'))}</span>
    </div>
    ${o.recent?.length ? `<div class="table-wrap" style="margin-top:12px"><table class="tbl"><thead><tr>
      <th>${esc(t('Run'))}</th><th>${esc(t('State'))}</th><th class="num">${esc(t('Cost'))}</th><th>${esc(t('When'))}</th><th>${esc(t('If it stopped'))}</th>
    </tr></thead><tbody>${o.recent.map((r) => `<tr>
      <td class="mono">${esc(String(r.id).slice(0, 8))}</td>
      <td><span class="chip ${r.state === 'done' ? 'chip-ok' : r.state === 'failed' ? 'chip-bad' : 'chip-warn'}">${esc(r.state)}</span></td>
      <td class="num">${money(r.cost_usd || 0)}</td>
      <td class="mono sub">${esc(String(r.created_at || '').slice(0, 16))}</td>
      <td class="sub">${esc(r.failure_reason || '—')}</td>
    </tr>`).join('')}</tbody></table></div>` : ''}
  </div>
  ${currentUser?.role === 'superadmin' ? `
  <div class="panel" style="margin-top:16px;border-color:#e5533d">
    <div class="panel-title" style="color:#e5533d">Danger zone — wipe all data</div>
    <p style="color:var(--ink-mute);margin:0 0 10px;max-width:70ch">
      Erases every record in the company — runs, decisions, pipelines, tickets, customers,
      intelligence, projects, notifications, and the audit chain, which restarts with a genesis
      entry naming who wiped it. Default agents, rituals, and registers are re-seeded so the
      platform stays usable. <b>This cannot be undone.</b>
    </p>
    <label style="display:block;margin:4px 0"><input type="checkbox" id="wipe-full">
      Full factory reset — also delete user accounts, sessions, and provider settings
      (you will be signed out; a fresh owner account is created and its password printed once to the server console)</label>
    <label style="display:block;margin:4px 0 12px"><input type="checkbox" id="wipe-ws">
      Also delete produced workspace files (blueprints, designs, exports…)</label>
    <div class="form-inline">
      <input id="wipe-confirm" placeholder="Type: WIPE ALL DATA" style="width:200px">
      <input id="wipe-pass" type="password" placeholder="Your password" autocomplete="current-password" style="width:170px">
      <button class="btn btn-bad" id="wipe-go">Wipe all data</button>
      <span id="wipe-out" class="mono" style="color:var(--ink-mute)"></span>
    </div>
  </div>` : ''}`;
  view.querySelectorAll('[data-ssave]').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.ssave;
    const el = view.querySelector(`[data-skey="${key}"]`);
    try { await api('/api/settings', { method: 'POST', body: { key, value: el.value } }); toast('Saved — takes effect immediately'); renderSettings(); refreshShell(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-sclear]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/settings', { method: 'POST', body: { key: b.dataset.sclear, value: null } }); renderSettings(); refreshShell(); } catch (e) { toast(e.message, true); }
  }));

  // The consultant. The key is sent only when something was typed into it, so
  // saving the persona does not wipe a key that is already there.
  $('#o-save')?.addEventListener('click', async () => {
    const body = {
      enabled: $('#o-on').value === 'true',
      name: $('#o-name').value,
      model: $('#o-model').value || undefined,
      persona: $('#o-persona').value,
    };
    if ($('#o-key').value.trim()) body.apiKey = $('#o-key').value.trim();
    // Sent even when empty: clearing the field is how the default address
    // comes back, and a save that silently kept an old proxy would be worse.
    body.baseUrl = $('#o-url').value.trim();
    try {
      const r = await api('/api/oracle', { method: 'POST', body });
      toast(r.ready ? t('Hired — mention it on the floor.') : r.enabled ? t('Saved. It still needs a DeepSeek key.') : t('Saved.'));
      renderSettings(); refreshShell();
    } catch (e) { toast(e.message, true); }
  });
  $('#o-reset')?.addEventListener('click', async () => {
    try { await api('/api/oracle', { method: 'POST', body: { persona: '' } }); renderSettings(); } catch (e) { toast(e.message, true); }
  });
  (async () => {
    const box = $('#sec-body');
    if (!box) return;
    const paint = async () => {
      const sec = await api('/api/account/security');
      box.innerHTML = `
        <div class="form-inline" style="align-items:center">
          <span class="chip ${sec.totp.enabled ? 'chip-ok' : 'chip-warn'}">${esc(sec.totp.enabled ? t('one-time code is on') : t('password only'))}</span>
          ${sec.totp.enabled ? `<span class="sub">${sec.recoveryRemaining} ${esc(t('recovery codes left'))}</span>` : ''}
          ${sec.totp.enabled
            ? `<input type="password" id="sec-pw" placeholder="${esc(t('your password'))}" style="width:180px"><button class="btn btn-sm btn-bad" id="sec-off">${esc(t('Turn it off'))}</button>`
            : `<button class="btn btn-primary" id="sec-on">${esc(t('Set up a one-time code'))}</button>`}
          <button class="btn btn-sm" id="sec-purge">${esc(t('Sign out everywhere else'))}</button>
        </div>
        <div id="sec-setup" style="margin-top:12px"></div>
        <div style="margin-top:14px">
          <div class="fl">${esc(t('Signed in'))}</div>
          ${sec.sessions.map((x) => `<div><span class="mono">${esc(x.id)}</span> · ${esc(x.ip || '—')} · ${esc(t('last seen'))} ${esc(x.lastSeen || x.createdAt)}</div>`).join('') || `<div style="color:var(--ink-faint)">—</div>`}
        </div>
        <div style="margin-top:14px">
          <div class="fl">${esc(t('Recent sign-in attempts'))}</div>
          ${sec.recentAttempts.slice(0, 8).map((x) => `<div><span style="color:var(--${x.ok ? 'ok' : 'bad'})">${x.ok ? '✓' : '✗'}</span> ${esc(x.at)} · ${esc(x.ip || '—')}${x.reason ? ' · ' + esc(x.reason) : ''}</div>`).join('') || `<div style="color:var(--ink-faint)">—</div>`}
        </div>`;

      $('#sec-on')?.addEventListener('click', async () => {
        try {
          const b = await api('/api/account/totp/begin', { method: 'POST', body: {} });
          $('#sec-setup').innerHTML = `
            <div class="login-note" style="max-width:70ch">
              ${esc(t('Add this to your authenticator, then type the code it shows to prove it works.'))}
            </div>
            <div class="form-inline" style="margin-top:8px">
              <div style="flex:2"><label class="fl">${esc(t('Secret'))}</label><input type="text" class="mono" value="${esc(b.secret)}" readonly></div>
              <div><label class="fl" for="sec-code">${esc(t('Code'))}</label><input type="text" id="sec-code" inputmode="numeric" maxlength="6" placeholder="000000"></div>
              <button class="btn btn-primary" id="sec-confirm">${esc(t('Confirm'))}</button>
            </div>
            <div class="sub" style="margin-top:6px;word-break:break-all">${esc(b.otpauth)}</div>`;
          $('#sec-confirm').addEventListener('click', async () => {
            try {
              const c = await api('/api/account/totp/confirm', { method: 'POST', body: { code: $('#sec-code').value } });
              // Shown once, and never again — so it is not a toast.
              $('#sec-setup').innerHTML = `<div class="login-note" style="max-width:70ch"><b>${esc(t('Write these down now.'))}</b> ${esc(c.note)}</div>
                <div class="mono" style="margin-top:8px;line-height:2">${c.recoveryCodes.map(esc).join('<br>')}</div>`;
            } catch (e) { toast(e.message, true); }
          });
        } catch (e) { toast(e.message, true); }
      });
      $('#sec-off')?.addEventListener('click', async () => {
        try { await api('/api/account/totp/disable', { method: 'POST', body: { password: $('#sec-pw').value } }); toast(t('Turned off')); paint(); }
        catch (e) { toast(e.message, true); }
      });
      $('#sec-purge')?.addEventListener('click', async () => {
        try {
          const r = await api('/api/account/sessions/end-others', { method: 'POST', body: { keep: localStorage.getItem(TOKEN_KEY) } });
          toast(`${r.ended} ${t('other session(s) signed out')}`); paint();
        } catch (e) { toast(e.message, true); }
      });
    };
    paint().catch(() => { box.textContent = t('could not read this account'); });
  })();
  (async () => {
    const chip = $('#push-state');
    if (!chip) return;
    const st = await pushState();
    chip.textContent = !st.supported ? t('unavailable')
      : st.subscribed ? t('on for this device')
      : st.permission === 'denied' ? t('blocked in this browser')
      : t('off for this device');
    chip.className = 'chip ' + (st.subscribed ? 'chip-ok' : st.supported ? 'chip-warn' : 'chip-dim');
    if (!st.supported) chip.title = st.why;
    // The subscription check is slow on a phone; if the person has already
    // left this page by the time it answers, there is nothing to update.
    if (!$('#push-on') || !$('#push-off') || !$('#push-test')) return;
    $('#push-on').disabled = !st.supported || st.subscribed;
    $('#push-off').disabled = !st.subscribed;
    $('#push-test').disabled = !st.subscribed;
    try {
      const o = await api('/api/push');
      $('#push-list').innerHTML = o.subscriptions.length
        ? o.subscriptions.map((x) => `<div>${esc(x.username || '—')} · <span class="mono">${esc(x.service)}</span>${x.retiredAt ? ' · <span style="color:var(--ink-faint)">retired</span>' : ''}${x.lastError ? ` · <span style="color:var(--bad)">${esc(x.lastError)}</span>` : ''}</div>`).join('')
        : `<div style="color:var(--ink-faint)">${esc(t('No device is subscribed yet.'))}</div>`;
    } catch { /* not permitted to see everybody's, which is fine */ }
  })();
  $('#push-on')?.addEventListener('click', async () => { if (await enablePush()) renderSettings(); });
  $('#push-off')?.addEventListener('click', async () => { await disablePush(); renderSettings(); });
  $('#push-test')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/push/test', { method: 'POST', body: {} });
      toast(r.delivered ? t('Sent — it should appear in a moment') : t('The push service refused it; the Settings list says why'), !r.delivered);
    } catch (e) { toast(e.message, true); }
  });
  $('#s-identity').addEventListener('click', async () => {
    try {
      await api('/api/settings', { method: 'POST', body: { key: 'COMPANY_NAME', value: $('#s-company').value.trim() } });
      await api('/api/settings', { method: 'POST', body: { key: 'PUBLIC_BASE_URL', value: $('#s-baseurl').value.trim() } });
      toast('Saved — the next run already uses it'); renderSettings();
    } catch (e) { toast(e.message, true); }
  });
  $('#s-mock').addEventListener('click', async () => {
    try { await api('/api/settings', { method: 'POST', body: { key: 'ALPHACORE_MOCK', value: s.mockForced ? null : 'true' } }); renderSettings(); refreshShell(); } catch (e) { toast(e.message, true); }
  });
  // Turning this on can stop the next boot. Say so before it is saved rather
  // than after somebody restarts a machine and finds it will not come back.
  $('#s-prod-save')?.addEventListener('click', async () => {
    const on = $('#s-prod').value === 'true';
    if (on && !confirm(t('This install will refuse to start unless the master key comes from outside this disk and the public address is https behind a trusted proxy. Continue?'))) return;
    try {
      await api('/api/settings', { method: 'POST', body: { key: 'PRODUCTION_MODE', value: on ? 'true' : 'false' } });
      toast(t('Saved')); renderSettings(); refreshShell();
    } catch (e) { toast(e.message, true); }
  });
  $('#s-probe').addEventListener('click', async (e) => {
    e.target.disabled = true; $('#s-probe-out').textContent = 'probing…';
    try { const r = await api('/api/providers/test', { method: 'POST', body: { tier: 'T1' } }); $('#s-probe-out').textContent = `${r.provider}/${r.model} · ${short(r.text, 60)}`; }
    catch (err) { $('#s-probe-out').textContent = 'failed: ' + err.message; }
    e.target.disabled = false;
  });
  $('#wipe-go')?.addEventListener('click', async (e) => {
    const full = $('#wipe-full').checked;
    e.target.disabled = true; $('#wipe-out').textContent = 'wiping…';
    try {
      const r = await api('/api/system/wipe', { method: 'POST', body: {
        confirm: $('#wipe-confirm').value.trim(), password: $('#wipe-pass').value,
        full, workspace: $('#wipe-ws').checked,
      } });
      if (full) { localStorage.removeItem(TOKEN_KEY); location.hash = '#/'; location.reload(); return; }
      toast(`Wiped ${r.tablesCleared} tables — fresh company, chain restarted`);
      location.hash = '#/'; location.reload();
    } catch (err) {
      $('#wipe-out').textContent = err.message; toast(err.message, true); e.target.disabled = false;
    }
  });
}
export async function renderAudit() {
  const [rows, chain] = await Promise.all([api('/api/audit?limit=150'), api('/api/audit/verify')]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">
      <span>Append-only hash chain</span>
      <span class="chip ${chain.ok ? 'chip-ok' : 'chip-bad'}">${chain.ok ? `intact · ${chain.checked} entries` : `BROKEN at seq ${chain.brokenAt}`}</span>
    </div>
    <table>
      <thead><tr><th class="num">Seq</th><th>Time</th><th>Actor</th><th>Action</th><th>Subject</th><th>Hash</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td class="num">${r.seq}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(r.occurred_at)}</td>
          <td class="mono">${esc(r.actor_type)}:${esc(short(r.actor_id, 22))}</td>
          <td class="mono" style="color:${r.actor_type === 'human' ? 'var(--steel)' : 'var(--ink)'}">${esc(r.action)}</td>
          <td class="mono">${(() => { const h = linkFor(r.subject_type, r.subject_id); const label = esc(short((r.subject_type || '') + ' ' + (r.subject_id || ''), 30)); return h ? `<a href="${h}" style="color:var(--steel)">${label}</a>` : `<span style="color:var(--ink-faint)">${label}</span>`; })()}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(r.hash.slice(0, 10))}…</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}
// ---------- Autopilot — the Nexus ----------
export async function renderAutopilot() {
  const { rules, feed } = await api('/api/autopilot');
  const canM = hasPermC('autopilot.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Rules armed</div><div class="big">${rules.filter((r) => r.enabled).length}<span class="unit">/${rules.length}</span></div><div class="sub">departments creating work for each other</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Automatic actions</div><div class="big">${feed.length ? rules.reduce((a, r) => a + r.runs, 0) : 0}</div><div class="sub">zero human keystrokes involved</div></div>
    <div class="panel tile"><div class="panel-title">What stays human</div><div class="big" style="font-size:20px;line-height:1.5">publish · sign · gate</div><div class="sub">the load-bearing moments — everything else self-drives</div></div>
    <div class="panel tile tile-warn"><div class="panel-title">Every firing audited</div><div class="big" style="font-size:20px;line-height:1.5">system:nexus</div><div class="sub">on the <a href="#/audit">chain</a>, rule by rule</div></div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">The mesh — watch A, act in B</div>
      ${rules.map((r) => `
        <div class="round"><div class="round-body">
          <div class="agent-head">
            <span><b class="mono" style="color:var(--ember)">${esc(r.id)}</b> — ${esc(r.name)}</span>
            <span>
              <span class="chip chip-dim">${r.runs}× fired</span>
              ${canM ? `<button class="btn btn-sm ${r.enabled ? 'btn-bad' : 'btn-ok'}" data-ap="${esc(r.id)}" data-en="${r.enabled ? 0 : 1}">${r.enabled ? 'disarm' : 'arm'}</button>` : `<span class="chip ${r.enabled ? 'chip-ok' : 'chip-dim'}">${r.enabled ? 'armed' : 'off'}</span>`}
            </span>
          </div>
          <div class="map-legend">${esc(r.why)}</div>
          ${r.recent.length ? `<div class="map-legend" style="color:var(--ink-mute)">${r.recent.map((x) => `→ ${esc(short(x.note, 70))}`).join('<br>')}</div>` : ''}
        </div></div>`).join('')}
    </div>
    <div class="panel">
      <div class="panel-title">Live feed — the company running itself</div>
      ${feed.map((f) => `
        <div class="round"><div class="round-body" style="display:flex;justify-content:space-between;gap:10px">
          <span><span class="chip chip-ember">${esc(f.rule_id)}</span> ${esc(short(f.note, 80))}</span>
          <span class="mono" style="color:var(--ink-faint);flex:none">${esc(f.created_at.slice(5, 16))}</span>
        </div></div>`).join('') || '<div class="empty">Nothing yet — the rules fire as soon as their conditions appear.</div>'}
    </div>
  </div>`;
  view.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/autopilot/rule', { method: 'POST', body: { id: b.dataset.ap, enabled: b.dataset.en === '1' } }); renderAutopilot(); } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Company Scorecard (BI) ----------
export async function renderScorecard() {
  const s = await api('/api/scorecard');
  const pct = (n) => n != null ? Math.round(n * 100) + '%' : '—';
  const auto = s.autopilot.humanActions7d + s.autopilot.agentActions7d;
  const autoShare = auto ? Math.round((s.autopilot.agentActions7d / auto) * 100) : 0;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">MRR</div><div class="big">${esc(money(s.revenue.mrr))}</div><div class="sub">${s.revenue.customersActive} active customers</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Sales pipeline</div><div class="big">${esc(money(s.revenue.pipelineValue))}</div><div class="sub">${s.revenue.dealsOpen} open · ${esc(money(s.revenue.wonValue))} won</div></div>
    <div class="panel tile tile-warn"><div class="panel-title">AI share of work · 7d</div><div class="big">${autoShare}<span class="unit">%</span></div><div class="sub">${s.autopilot.agentActions7d} agent vs ${s.autopilot.humanActions7d} human actions</div></div>
    <div class="panel tile"><div class="panel-title">Autopilot actions</div><div class="big">${s.autopilot.actionsTotal}</div><div class="sub">${s.autopilot.actions7d} this week · <a href="#/autopilot">the mesh →</a></div></div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Creative output</div>
      <table><tbody>
        <tr><td>Posts published</td><td class="num">${s.creative.postsPublished}</td><td><a href="#/social">social →</a></td></tr>
        <tr><td>Followers (connected channels)</td><td class="num">${s.creative.followers}</td><td></td></tr>
        <tr><td>Content published</td><td class="num">${s.creative.contentPublished}</td><td><a href="#/content">studio →</a></td></tr>
        <tr><td>Designs approved</td><td class="num">${s.creative.designsApproved}</td><td><a href="#/design">gallery →</a></td></tr>
        <tr><td>Campaigns live</td><td class="num">${s.creative.campaignsLive}</td><td><a href="#/marketing">marketing →</a></td></tr>
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Production</div>
      <table><tbody>
        <tr><td>Journeys completed / moving</td><td class="num">${s.production.journeysDone} / ${s.production.journeysMoving}</td><td><a href="#/journeys">journeys →</a></td></tr>
        <tr><td>Runs done · 7d</td><td class="num">${s.production.runsDone7d}</td><td><a href="#/runs">runs →</a></td></tr>
        <tr><td>Tasks done · 7d</td><td class="num">${s.production.tasksDone7d}</td><td><a href="#/tasks">tasks →</a></td></tr>
        <tr><td>Products live</td><td class="num">${s.production.productsLive}</td><td><a href="#/products">factory →</a></td></tr>
        <tr><td>Model spend · month</td><td class="num">${esc(money(s.spendMonth))}</td><td><a href="#/budgets">budgets →</a></td></tr>
      </tbody></table>
    </div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Trust & control</div>
      <table><tbody>
        <tr><td>Open incidents</td><td class="num" style="color:${s.trust.incidentsOpen ? 'var(--bad)' : 'var(--ok)'}">${s.trust.incidentsOpen}</td><td><a href="#/incidents">incidents →</a></td></tr>
        <tr><td>Critical risks (≥16)</td><td class="num" style="color:${s.trust.risksCritical ? 'var(--warn)' : 'var(--ok)'}">${s.trust.risksCritical}</td><td><a href="#/risks">register →</a></td></tr>
        <tr><td>Eval average</td><td class="num">${pct(s.trust.evalAvg)}</td><td><a href="#/evals">evals →</a></td></tr>
        <tr><td>Waiting on a human</td><td class="num" style="color:${s.trust.awaitingHuman ? 'var(--warn)' : 'var(--ok)'}">${s.trust.awaitingHuman}</td><td><a href="#/gate">gate →</a></td></tr>
        <tr><td>Audit chain entries</td><td class="num">${s.trust.chainEntries}</td><td><a href="#/audit">chain →</a></td></tr>
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Relationships</div>
      <table><tbody>
        <tr><td>Active partners</td><td class="num">${s.relations.partnersActive}</td><td><a href="#/relations">RM →</a></td></tr>
        <tr><td>Interactions · 30d</td><td class="num">${s.relations.interactions30d}</td><td></td></tr>
      </tbody></table>
      <div class="map-legend" style="margin-top:10px">The whole company on one board — every number clicks through to its department, every department feeds the <a href="#/audit">audit chain</a>, and the <a href="#/autopilot">Nexus</a> moves work between them without a human in the loop.</div>
    </div>
  </div>`;
}
// ---------- Harmony — the orchestration layer ----------
export async function renderHarmony() {
  const [h, auto] = await Promise.all([api('/api/harmony'), api('/api/autonomy').catch(() => null)]);
  const canM = hasPermC('harmony.manage');
  const isOwner = currentUser?.isOwner;
  const s = h.snapshot;
  const hs = h.harmony;
  const scoreColor = hs.score >= 80 ? 'var(--ok)' : hs.score >= 55 ? 'var(--warn)' : 'var(--bad)';
  const latest = h.cycles[0];
  view.innerHTML = `
  ${auto?.enabled ? `
  <div class="panel autonomy-live">
    <div class="panel-title" style="color:var(--bad)">⚠ AUTONOMY MODE IS ON — the AI is deciding for you</div>
    <div style="font-size:12.5px;line-height:1.6">
      Since <b>${esc(String(auto.since || '').slice(0, 16).replace('T', ' '))}</b>, the Acting Executive has been answering the queue that would normally wait for you:
      approving, rejecting, publishing, sending, signing and ruling. <b>${auto.stats.decided}</b> decision(s) made, <b>${auto.stats.held}</b> held back for you deliberately${auto.stats.failed ? `, <b>${auto.stats.failed}</b> failed to execute` : ''}.
    </div>
    ${isOwner ? '<div style="margin-top:10px"><button class="btn btn-bad" id="au-off">Take back control now</button></div>' : '<div class="map-legend" style="margin-top:8px">Only the owner can switch this off.</div>'}
  </div>` : ''}

  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Harmony score</div><div class="big" style="color:${scoreColor}">${hs.score}<span class="unit">%</span></div><div class="sub">${hs.parts.filter((p) => p.ok).length}/${hs.parts.length} checks passing</div></div>
    <div class="panel tile ${h.enabled ? 'tile-steel' : 'tile-warn'}"><div class="panel-title">Orchestrator</div><div class="big" style="font-size:22px;padding-top:8px">${h.enabled ? 'RUNNING' : 'PAUSED'}</div><div class="sub">${esc(h.mode)} mode · hourly cycles</div></div>
    <div class="panel tile"><div class="panel-title">Actions dispatched</div><div class="big">${h.dispatchedTotal}</div><div class="sub">${h.dispatched7d} this week, no human keystrokes</div></div>
    <div class="panel tile"><div class="panel-title">AI vs human · 7d</div><div class="big">${s.automation.agentActions7d}<span class="unit">/${s.automation.humanActions7d}</span></div><div class="sub">${s.automation.nexusActions7d} reflex actions from <a href="#/autopilot">Nexus</a></div></div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">
        <span>Is the company moving in step?</span>
        ${canM ? `<span>
          <button class="btn btn-sm ${h.enabled ? 'btn-bad' : 'btn-ok'}" id="hm-toggle">${h.enabled ? 'Pause orchestrator' : 'Start orchestrator'}</button>
          <button class="btn btn-sm" id="hm-mode">${h.mode === 'live' ? 'Switch to dry-run' : 'Switch to live'}</button>
          <button class="btn btn-primary btn-sm" id="hm-cycle">Run a cycle now</button>
        </span>` : ''}
      </div>
      ${hs.parts.map((p) => `<div class="harm-part">
        <span class="hp-ok" style="color:${p.ok ? 'var(--ok)' : 'var(--warn)'}">${p.ok ? '✓' : '!'}</span>
        <span>${esc(p.key)}</span>
        <span class="hp-detail">${esc(p.detail)}</span>
      </div>`).join('')}
      ${hs.score < 100 && canM ? `<div style="margin-top:12px">
        <button class="btn btn-primary" id="hm-boost">Raise the score — do everything an agent can</button>
        <div class="map-legend" style="margin-top:6px">This dispatches every fix the workforce is allowed to make on its own, then tells you precisely what is left that only a person can finish. It cannot publish, send, sign or pass a gate — so a perfect score is reached with you, not instead of you.</div>
      </div>` : ''}
      <div id="hm-boost-out"></div>
      <div class="map-legend" style="margin-top:10px">Each check is something that quietly stops work when ignored. The orchestrator reads exactly this state before it plans.</div>
    </div>

    <div class="panel">
      <div class="panel-title">What it is allowed to do — ${h.catalog.length} actions</div>
      <div class="agent-meta">${h.catalog.map((a) => `<span class="chip chip-dim" title="${esc(a.describe)}">${esc(a.id)}</span>`).join('')}</div>
      <div class="map-legend" style="margin-top:10px">
        <b>Not in the catalog, by design:</b> publishing a post, sending a message to a customer or partner, approving spend, signing a contract, and gate verdicts. The planner physically cannot reach those — when one is what the company needs, it must raise <span class="mono">human.flag</span> instead.
      </div>
      <div class="map-legend" style="margin-top:8px">
        Other guardrails: at most 5 actions per cycle, a ${6}-hour cooldown per identical action, a hard stop below 10% budget headroom, and every dispatch on the <a href="#/audit">audit chain</a> as <span class="mono">system:maestro</span>.
      </div>
    </div>
  </div>

  <div class="panel ${auto?.enabled ? 'autonomy-live' : ''}">
    <div class="panel-title">${auto?.enabled ? 'Autonomy is running' : 'Hand the company to the AI'}</div>
    <div class="danger-note">
      <div class="dn-title">Read this before switching it on</div>
      <p>Everything in this platform is built on one rule: <b>a machine prepares, a person decides</b>. This switch suspends that rule. With it on, the Acting Executive answers your queue — it approves work, publishes posts, sends replies to customers, signs contracts, approves campaigns and money reports, and rules on disputes between employees. Nothing waits for you any more.</p>
      <p><b>Agents get things wrong.</b> They misread context, they are confident when they should not be, and they cannot see what you know but never wrote down. Today those mistakes are caught at the gate because you look at them. With autonomy on, the same mistakes are <b>committed instead of caught</b> — a wrong reply is sent, a bad campaign goes live, a contract is signed. That is the entire trade.</p>
      <p>Highest-risk categories it will act on: ${auto ? auto.highStakes.map((x) => `<span class="chip chip-bad">${esc(x)}</span>`).join(' ') : ''}</p>
      <p>What stays true even in autonomy: budgets still hard-stop, the audit chain still records everything as <span class="mono">system:autonomy</span>, every decision is logged <b>with the reason given for it</b> so you can read what happened in your absence, the executive may deliberately <b>hold</b> anything it judges too consequential, and the off switch is immediate and yours alone.</p>
    </div>
    ${isOwner ? `<div style="margin-top:12px">
      ${auto?.enabled
        ? '<button class="btn btn-bad" id="au-toggle-off">Turn autonomy OFF — return decisions to humans</button>'
        : '<button class="btn btn-bad" id="au-toggle-on">Turn autonomy ON — let the AI run the company</button>'}
      <span class="map-legend" style="margin-left:10px">You will be asked to confirm.</span>
    </div>` : '<div class="map-legend" style="margin-top:10px">Only the owner can hand over or take back the company\'s decisions.</div>'}
    ${auto && auto.stats.total ? `<div class="agent-meta" style="margin-top:10px">
      <span class="chip">${auto.stats.total} handled</span>
      <span class="chip chip-ok">${auto.stats.decided} decided</span>
      <span class="chip chip-warn">${auto.stats.held} held for you</span>
      ${auto.stats.failed ? `<span class="chip chip-bad">${auto.stats.failed} failed</span>` : ''}
      ${auto.stats.reverted ? `<span class="chip chip-bad">${auto.stats.reverted} you disagreed with</span>` : ''}
      <span class="chip chip-dim">${auto.stats.last24h} in the last 24h</span>
    </div>` : ''}
  </div>

  ${auto?.log?.length ? `<div class="panel">
    <div class="panel-title">What the AI decided in your place — read it, reverse what you disagree with</div>
    ${auto.log.map((l) => `
      <div class="inbox-row ${l.verdict === 'hold' ? 'low' : l.ok ? '' : 'high'}" style="${l.reverted ? 'opacity:.5' : ''}">
        <div class="ib-main">
          <span class="chip ${l.verdict === 'approve' ? 'chip-ok' : l.verdict === 'reject' ? 'chip-bad' : l.verdict === 'hold' ? 'chip-warn' : 'chip-dim'}">${esc(l.verdict)}</span>
          <span class="ib-title">${esc(l.title)}</span>
          <div class="ib-sub">${esc(l.reason || 'no reason recorded')}</div>
          <div class="map-legend">${esc(l.outcome || 'pending')} · <span class="mono">${esc(l.kind)} #${esc(l.subject_id)}</span>${l.reverted ? ' · <b style="color:var(--bad)">you marked this wrong</b>' : ''}</div>
        </div>
        <div class="ib-age mono">${esc(l.created_at.slice(5, 16))}</div>
        <div class="ib-actions">
          ${linkFor(l.kind, l.subject_id) ? `<a class="btn btn-sm" href="${linkFor(l.kind, l.subject_id)}">Open</a>` : ''}
          ${isOwner && !l.reverted && l.ok && l.verdict !== 'hold' ? `<button class="btn btn-sm btn-bad" data-au-revert="${l.id}">Disagree</button>` : ''}
        </div>
      </div>`).join('')}
  </div>` : ''}

  ${latest ? `<div class="panel">
    <div class="panel-title">
      <span>Latest cycle #${latest.id} — ${esc(latest.state)}${latest.mode === 'dry-run' ? ' · dry-run' : ''}</span>
      <span class="mono" style="color:var(--ink-faint)">${esc(latest.created_at)}</span>
    </div>
    ${latest.assessment ? `<div style="font-size:12.5px;margin-bottom:8px">${esc(latest.assessment)}</div>` : ''}
    ${latest.flags?.length ? `<div class="reason">Needs a human: ${latest.flags.map(esc).join(' · ')}</div>` : ''}
    ${latest.plan?.length ? latest.plan.map((p, i) => {
      const done = (latest.executed || []).find((x) => x.action === p.action && x.why === p.why) || (latest.executed || [])[i];
      return `<div class="plan-step ${done && !done.ok ? 'failed' : ''}">
        <div class="ps-action">${esc(p.action)} <span style="color:var(--ink-faint)">${esc(short(JSON.stringify(p.params || {}), 90))}</span></div>
        <div class="ps-why">${esc(p.why || '')}</div>
        ${done ? `<div class="ps-result">${done.ok ? '✓' : '✕'} ${esc(done.detail || '')}</div>` : '<div class="ps-result">pending</div>'}
      </div>`;
    }).join('') : `<div class="empty">${latest.state === 'planning' ? 'The orchestrator is thinking…' : 'No actions this cycle.'}</div>`}
  </div>` : '<div class="panel"><div class="empty">No cycles yet — run one to see the orchestrator read the company and dispatch work.</div></div>'}

  ${h.cycles.length > 1 ? `<div class="panel">
    <div class="panel-title">Cycle history</div>
    <table>
      <thead><tr><th>#</th><th>When</th><th>Mode</th><th>State</th><th class="num">Planned</th><th class="num">Dispatched</th><th>Assessment</th></tr></thead>
      <tbody>${h.cycles.slice(1).map((c) => `<tr>
        <td class="mono">${c.id}</td>
        <td class="mono" style="color:var(--ink-faint)">${esc(c.created_at.slice(5, 16))}</td>
        <td><span class="chip chip-dim">${esc(c.mode)}</span></td>
        <td><span class="state state-${c.state === 'executed' ? 'done' : c.state === 'failed' ? 'failed' : 'queued'}">${esc(c.state)}</span></td>
        <td class="num">${c.plan?.length || 0}</td>
        <td class="num">${(c.executed || []).filter((x) => x.ok).length}</td>
        <td>${esc(short(c.assessment || '—', 80))}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : ''}`;

  // Autonomy: switching it on takes a typed confirmation, switching it off never does.
  const setAutonomy = async (on) => {
    if (on && !confirm(
      'Hand every decision in the company to the AI?\n\n'
      + 'It will approve work, publish posts, send customer replies, sign contracts, approve campaigns and financial reports, and rule on disputes — without waiting for you.\n\n'
      + 'Agents make mistakes. With this on, those mistakes are committed instead of caught.\n\n'
      + 'Every decision is logged with its reason, and you can switch this off at any moment.',
    )) return;
    try {
      await api('/api/autonomy/toggle', { method: 'POST', body: { enabled: on } });
      toast(on ? 'Autonomy ON — the AI is now deciding. Watch the log.' : 'Autonomy OFF — decisions wait for a human again.', on);
      renderHarmony(); refreshShell();
    } catch (e) { toast(e.message, true); }
  };
  $('#au-toggle-on')?.addEventListener('click', () => setAutonomy(true));
  $('#au-toggle-off')?.addEventListener('click', () => setAutonomy(false));
  $('#au-off')?.addEventListener('click', () => setAutonomy(false));
  view.querySelectorAll('[data-au-revert]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt('What was wrong with this decision?') || null;
    try {
      const r = await api(`/api/autonomy/${b.dataset.auRevert}/revert`, { method: 'POST', body: { note } });
      toast(r.note || 'Recorded'); renderHarmony();
    } catch (e) { toast(e.message, true); }
  }));

  if (!canM) return;
  $('#hm-toggle')?.addEventListener('click', async () => {
    try { await api('/api/harmony/toggle', { method: 'POST', body: { enabled: !h.enabled } }); toast(h.enabled ? 'Orchestrator paused' : 'Orchestrator running — a cycle every hour'); renderHarmony(); }
    catch (e) { toast(e.message, true); }
  });
  $('#hm-mode')?.addEventListener('click', async () => {
    try { await api('/api/harmony/mode', { method: 'POST', body: { mode: h.mode === 'live' ? 'dry-run' : 'live' } }); renderHarmony(); }
    catch (e) { toast(e.message, true); }
  });
  $('#hm-cycle')?.addEventListener('click', async () => {
    try { await api('/api/harmony/cycle', { method: 'POST', body: {} }); toast('Cycle started — the orchestrator is reading the company'); renderHarmony(); }
    catch (e) { toast(e.message, true); }
  });
  $('#hm-boost')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Working…';
    try {
      const r = await api('/api/harmony/boost', { method: 'POST', body: {} });
      $('#hm-boost-out').innerHTML = `
        <div class="panel" style="margin-top:10px;border-color:var(--ember)">
          <div class="panel-title">Harmony ${r.before}% → ${r.after}%</div>
          ${r.dispatched.length ? `<div class="panel-title" style="margin-top:6px">Done automatically</div>
            ${r.dispatched.map((x) => `<div class="harm-part"><span class="hp-ok" style="color:var(--ok)">✓</span><span>${esc(x.key)}</span><span class="hp-detail">${esc(x.detail)}</span></div>`).join('')}` : ''}
          ${r.remaining.length ? `<div class="panel-title" style="margin-top:8px">Only you can finish these</div>
            ${r.remaining.map((x) => `<div class="harm-part"><span class="hp-ok" style="color:var(--warn)">!</span><span><a href="${esc(x.href)}">${esc(x.key)}</a></span><span class="hp-detail">${esc(x.how)}</span></div>`).join('')}
            <div class="map-legend" style="margin-top:8px">These are the load-bearing human moments — publishing, sending, signing, gate verdicts. The platform will not do them for you, which is the point.</div>`
            : '<div class="map-legend" style="margin-top:8px">Nothing is left that a person must do. The next refresh should read 100%.</div>'}
        </div>`;
      toast(`Harmony ${r.before}% → ${r.after}% · ${r.dispatched.length} dispatched, ${r.remaining.length} for you`);
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Raise the score — do everything an agent can'; }
  });
}
// ---------- The constitution ----------
export async function renderConstitution() {
  const d = await api('/api/constitution');
  const canAmend = hasPermC('constitution.amend');
  const sev = (s) => `<span class="chip ${s === 'block' ? 'chip-bad' : s === 'gate' ? 'chip-warn' : 'chip-dim'}">${esc(s)}</span>`;
  const byArticle = {};
  for (const r of d.rules.filter((x) => x.state === 'active')) (byArticle[r.article] ||= []).push(r);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Rules in force', d.counts.active, `across ${d.articles.length} articles`)}
    ${tile('Machine-checkable', d.counts.enforceable, 'the gate can evaluate these before anything leaves', 'tile-ok')}
    ${tile('Absolute refusals', d.counts.blocking, 'no scope can override them')}
    ${tile('People left alone', d.suppression.length, 'asked not to be contacted, permanently')}
  </div>

  ${Object.entries(byArticle).map(([article, rules]) => `
  <div class="panel">
    <div class="panel-title">${esc(article)}</div>
    <table><tbody>
    ${rules.map((r) => `<tr>
      <td style="width:60%"><b>${esc(r.text)}</b>
        <div class="sub mono" style="margin-top:4px">${esc(r.rule_id)}${r.machine ? ` · ${esc(short(JSON.stringify(r.machine), 90))}` : ' · read by people, not enforced by machine'}</div></td>
      <td>${sev(r.severity)}</td>
      <td class="num mono" title="times this rule has fired">${r.hits}</td>
      <td>${canAmend ? xbtn(`/api/constitution/${r.rule_id}/retire`, {}, 'Retire') : ''}</td>
    </tr>`).join('')}
    </tbody></table>
  </div>`).join('')}

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">When the rules actually bit</div>
      <table><thead><tr><th>Rule</th><th>On</th><th>Verdict</th><th>When</th></tr></thead><tbody>
      ${d.recentHits.map((h) => `<tr><td class="mono">${esc(h.rule_id)}</td><td class="sub">${esc(short(h.subject || '', 40))}</td>
        <td>${sev(h.verdict)}</td><td class="mono sub">${esc(String(h.created_at).slice(5, 16))}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">No rule has fired yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Add a rule</div>
      ${canAmend ? `
      <div class="form-grid">
        <input id="ct-id" placeholder="rule id, e.g. no-weekend-calls">
        <input id="ct-article" placeholder="article, e.g. Consent">
        <textarea id="ct-text" rows="3" placeholder="The sentence a person reads."></textarea>
        <input id="ct-machine" placeholder='machine form (optional): {"gate": {"capabilityIn": ["call.place"]}}'>
        <select id="ct-sev" aria-label="Severity"><option value="warn">warn</option><option value="gate">stop for a person</option><option value="block">refuse outright</option></select>
        <button class="btn btn-primary" id="ct-add">Enact</button>
      </div>
      <div class="map-legend">A rule nobody can check is a slogan; a check nobody can read is a trap. Write both halves. Amending replaces the rule with a new version and leaves the old one in the record — the constitution has a history, not a current state.</div>
      ` : '<div class="empty">Only the owner amends the constitution.</div>'}
    </div>
  </div>`;
  wireXact(renderConstitution);
  $('#ct-add')?.addEventListener('click', async () => {
    let machine = null;
    const raw = $('#ct-machine').value.trim();
    if (raw) { try { machine = JSON.parse(raw); } catch { return toast('The machine form must be JSON', true); } }
    try {
      await api('/api/constitution', { method: 'POST', body: {
        ruleId: $('#ct-id').value.trim(), article: $('#ct-article').value.trim(),
        text: $('#ct-text').value.trim(), machine, severity: $('#ct-sev').value,
      } });
      toast('Enacted'); renderConstitution();
    } catch (e) { toast(e.message, true); }
  });
}
// ---------- Provenance ----------
export async function renderProvenance() {
  const d = await api('/api/provenance');
  const canIssue = hasPermC('provenance.issue');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Receipts issued', d.counts.total, `${d.counts.today} today`)}
    ${tile('Runs not yet sealed', d.unsealed.runs, 'sealed automatically as they finish', d.unsealed.runs ? 'tile-warn' : '')}
    ${tile('Kinds of work', d.counts.subjects.length, d.counts.subjects.map((s) => `${s.n} ${s.subject_type}`).join(' · '))}
    <div class="panel tile"><div class="panel-title">Seal now</div>
      ${canIssue ? xbtn('/api/provenance/seal', {}, 'Sign everything finished', 'btn-primary') : '<div class="sub">provenance.issue required</div>'}
      <div class="sub" style="margin-top:6px">Ed25519 over a canonical description of the work.</div></div>
  </div>
  <div class="panel">
    <div class="panel-title">Receipts</div>
    <table><thead><tr><th>#</th><th>What</th><th>Fingerprint</th><th>Made by</th><th>Model</th><th>Reviewed by</th><th>Cost</th><th></th></tr></thead><tbody>
    ${d.recent.map((r) => `<tr>
      <td class="mono">${r.id}</td>
      <td class="mono">${esc(r.subject_type)}:${esc(short(String(r.subject_id), 12))}</td>
      <td class="mono sub">${esc(r.content_hash)}</td>
      <td class="mono">${esc(r.made_by || '—')}</td>
      <td class="mono sub">${esc(r.model || '—')}</td>
      <td class="sub">${(JSON.parse(r.reviewers || '[]')).join(', ') || '—'}</td>
      <td class="num mono">${r.cost_usd ? `${Number(r.cost_usd).toFixed(4)}` : '—'}</td>
      <td>${xbtn(`/api/provenance/${r.id}/verify`, {}, 'Verify')}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing sealed yet.</td></tr>'}
    </tbody></table>
  </div>
  <div class="panel">
    <div class="panel-title">The public key — publish this</div>
    <div class="map-legend">Anyone holding this key can verify a receipt offline, forever, without asking us anything. That is the point: the proof does not depend on our database still existing or on us being trusted.</div>
    ${preBody(d.publicKey)}
  </div>`;
  wireXact(renderProvenance);
}
// ---------- The time machine ----------
export async function renderTimeMachine() {
  const d = await api('/api/timemachine');
  const canSnap = hasPermC('timemachine.snapshot');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Entries on the chain', d.chain.checked, d.chain.ok ? 'every one verifies' : `broken at ${d.chain.brokenAt}`, d.chain.ok ? 'tile-ok' : 'tile-bad')}
    ${tile('Marks you can stand at', d.snapshots.length, 'named points in the company’s life')}
    ${tile('First recorded moment', String(d.chain.since || '—').slice(0, 10), 'the beginning of the record')}
    <div class="panel tile"><div class="panel-title">Mark now</div>
      ${canSnap ? `<div class="form-inline"><input id="tm-label" placeholder="what is happening" style="width:60%"><button class="btn btn-sm btn-primary" id="tm-snap">Mark</button></div>` : '<div class="sub">timemachine.snapshot required</div>'}
    </div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Marks</div>
      <table><thead><tr><th>Label</th><th>Entry</th><th>What existed then</th><th></th></tr></thead><tbody>
      ${d.snapshots.map((s) => `<tr><td><b>${esc(s.label)}</b><div class="sub mono">${esc(String(s.created_at).slice(0, 16))}</div></td>
        <td class="mono">${s.seq}</td>
        <td class="sub">${Object.entries(s.counts).filter(([, v]) => v).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' · ')}</td>
        <td><button class="btn btn-sm" data-standat="${s.seq}">Stand here</button></td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">No marks yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Days of the company</div>
      <table><thead><tr><th>Day</th><th>Moves</th><th>Who acted</th></tr></thead><tbody>
      ${d.days.map((x) => `<tr><td class="mono">${esc(x.day)}</td><td class="num mono">${x.moves}</td><td class="num mono">${x.actors}</td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Replay a stretch</div>
    <div class="form-inline">
      <input id="tm-from" type="number" placeholder="from entry" style="width:120px">
      <input id="tm-to" type="number" placeholder="to entry" value="${d.chain.tip}" style="width:120px">
      <button class="btn btn-sm btn-primary" id="tm-replay">Replay</button>
    </div>
    <div id="tm-out"></div>
  </div>`;

  $('#tm-snap')?.addEventListener('click', async () => {
    try { await api('/api/timemachine/snapshot', { method: 'POST', body: { label: $('#tm-label').value.trim() || 'mark' } }); toast('Marked'); renderTimeMachine(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-standat]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api(`/api/timemachine/at/${b.dataset.standat}`);
    $('#tm-out').innerHTML = `
      <div class="sub" style="margin:10px 0">Standing at entry ${r.seq}, ${esc(String(r.at))} — the company had spent ${Number(r.money.spent || 0).toFixed(2)} by then.</div>
      <div class="grid grid-2">
        <div><div class="panel-title">What had been done</div><table><tbody>${r.actions.slice(0, 12).map((a) => `<tr><td class="mono">${esc(a.action)}</td><td class="num mono">${a.n}</td></tr>`).join('')}</tbody></table></div>
        <div><div class="panel-title">Who had acted</div><table><tbody>${r.actors.slice(0, 12).map((a) => `<tr><td class="mono">${esc(a.actor_id)}</td><td class="num mono">${a.n}</td></tr>`).join('')}</tbody></table></div>
      </div>`;
  }));
  $('#tm-replay')?.addEventListener('click', async () => {
    try {
      const r = await api(`/api/timemachine/replay/${Number($('#tm-from').value || 1)}/${Number($('#tm-to').value || d.chain.tip)}`);
      $('#tm-out').innerHTML = `<div class="sub" style="margin:10px 0">${r.moves} moves${r.span ? ` between ${esc(String(r.span.start).slice(0, 16))} and ${esc(String(r.span.end).slice(0, 16))}` : ''}</div>
        <table><thead><tr><th>#</th><th>When</th><th>Who</th><th>Did</th><th>To</th></tr></thead><tbody>
        ${r.entries.slice(-60).reverse().map((e) => `<tr><td class="mono">${e.seq}</td><td class="mono sub">${esc(String(e.occurred_at).slice(5, 16))}</td>
          <td class="mono">${esc(e.actor_id)}</td><td class="mono">${esc(e.action)}</td>
          <td class="mono sub">${esc(e.subject_type || '')} ${esc(short(String(e.subject_id || ''), 18))}</td></tr>`).join('')}
        </tbody></table>`;
    } catch (e) { toast(e.message, true); }
  });
}
// ---------- Red team ----------
export async function renderRedteam() {
  const d = await api('/api/redteam');
  const canRun = hasPermC('redteam.run');
  const sev = (s) => `<span class="chip ${s === 'critical' ? 'chip-bad' : s === 'high' ? 'chip-warn' : 'chip-dim'}">${esc(s)}</span>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Got through', d.counts.breached, 'open, unfixed', d.counts.breached ? 'tile-bad' : 'tile-ok')}
    ${tile('Held', d.counts.defended, 'the defence worked')}
    ${tile('Attacks in the suite', d.attacks.length, 'run on a timer, not on request')}
    <div class="panel tile"><div class="panel-title">Attack ourselves</div>
      ${canRun ? xbtn('/api/redteam/run', {}, 'Run the whole suite', 'btn-primary') : '<div class="sub">redteam.run required</div>'}
      <div class="sub" style="margin-top:6px">Last sweep: ${esc(String(d.lastSweep || 'never').slice(0, 16))}</div></div>
  </div>

  ${d.open.length ? `
  <div class="panel">
    <div class="panel-title" style="color:var(--bad)">Open — these got through and are not fixed</div>
    <table><thead><tr><th>Attack</th><th>Against</th><th>What happened</th><th>Severity</th><th></th></tr></thead><tbody>
    ${d.open.map((r) => `<tr><td class="mono">${esc(r.attack)}</td><td class="sub">${esc(r.target)}</td>
      <td>${esc(r.detail)}</td><td>${sev(r.severity)}</td>
      <td>${canRun ? xbtn(`/api/redteam/${r.id}/fixed`, {}, 'Mark fixed', 'btn-ok') : ''}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">The suite</div>
    <table><thead><tr><th>Attack</th><th>What it tries</th><th>Severity</th><th></th></tr></thead><tbody>
    ${d.attacks.map((a) => `<tr><td class="mono">${esc(a.id)}</td><td>${esc(a.describe)}</td><td>${sev(a.severity)}</td>
      <td>${canRun ? xbtn('/api/redteam/run', { only: a.id }, 'Try it now') : ''}</td></tr>`).join('')}
    </tbody></table>
    <div class="map-legend">The moment an employee can read a web page or an email and then send one, open a pull request or move money, a hostile page becomes a command channel. That is the main threat this company faces, and the only honest response is to keep trying it on ourselves and to write down what happens. A breach here is a finding, not an incident.</div>
  </div>

  <div class="panel">
    <div class="panel-title">History</div>
    <table><thead><tr><th>#</th><th>Attack</th><th>Result</th><th>Detail</th><th>When</th></tr></thead><tbody>
    ${d.recent.map((r) => `<tr><td class="mono">${r.id}</td><td class="mono">${esc(r.attack)}</td>
      <td><span class="chip ${r.outcome === 'defended' ? 'chip-ok' : r.outcome === 'breached' ? 'chip-bad' : 'chip-dim'}">${esc(r.outcome)}</span>${r.fixed_at ? ' <span class="chip chip-ok">fixed</span>' : ''}</td>
      <td class="sub">${esc(short(r.detail || '', 70))}</td><td class="mono sub">${esc(String(r.created_at).slice(5, 16))}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">No sweep has run yet.</td></tr>'}
    </tbody></table>
  </div>`;
  wireXact(renderRedteam);
}
// ---------- The operating rhythm ----------
export async function renderChief() {
  const d = await api('/api/chief');
  const canRun = hasPermC('chief.run');
  const s = d.situation;
  const period = (p) => `
    <tr>
      <td><span class="chip ${p.kind === 'quarter' ? 'chip-ember' : p.kind === 'week' ? 'chip-steel' : 'chip-dim'}">${esc(p.kind)}</span></td>
      <td class="mono"><b>${esc(p.label)}</b></td>
      <td class="sub">${esc(short(
        p.plan?.focus ? `focus: ${p.plan.focus} · target ${p.plan.targetRuns ?? '—'} on ${p.plan.budgetUsd ?? '—'}`
          : p.plan?.objectives ? p.plan.objectives.join(' · ')
            : (p.plan?.moves || []).join(' · ') || '—', 130,
      ))}</td>
      <td class="sub">${p.review ? esc(`${p.review.runsDone} done, ${p.review.runsFailed} failed, ${p.review.spentUsd}`) : '<span class="sub">still open</span>'}</td>
      <td class="sub" style="color:var(--warn)">${(p.corrections || []).length ? esc(short(p.corrections.join(' · '), 90)) : ''}</td>
      <td class="mono sub">${esc(String(p.opened_at).slice(5, 16))}</td>
    </tr>`;

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Autonomy', esc(d.autonomy), d.autonomy === 'off' ? 'the rhythm follows it — it is not running' : 'the rhythm is keeping the clocks', d.autonomy === 'off' ? 'tile-warn' : 'tile-ok')}
    ${tile('Days run', d.counts.days, `${d.counts.weeks} weeks · ${d.counts.quarters} quarters`)}
    ${tile('Corrections made', d.counts.corrections, 'weeks where the plan and reality disagreed')}
    <div class="panel tile"><div class="panel-title">Turn the clock now</div>
      ${canRun ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        ${xbtn('/api/chief/turn', { force: 'day' }, 'Day', 'btn-primary')}
        ${xbtn('/api/chief/turn', { force: 'week' }, 'Week')}
        ${xbtn('/api/chief/turn', { force: 'quarter' }, 'Quarter')}
      </div>` : '<div class="sub">chief.run required</div>'}
      <div class="sub" style="margin-top:6px">Each clock only acts when its period has turned over.</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">What the company can see about itself right now</div>
    <div class="grid grid-4" style="gap:var(--s3)">
      <div><div class="panel-title">Queue</div><table><tbody>
        <tr><td>waiting</td><td class="num mono">${s.queue.queued}</td></tr>
        <tr><td>running</td><td class="num mono">${s.queue.running}</td></tr>
        <tr><td>stalled</td><td class="num mono" style="${s.queue.stuck ? 'color:var(--bad)' : ''}">${s.queue.stuck}</td></tr>
        <tr><td>at a human gate</td><td class="num mono">${s.queue.awaitingHuman}</td></tr>
      </tbody></table></div>
      <div><div class="panel-title">Money</div><table><tbody>
        <tr><td>this month</td><td class="num mono">${Number(s.money.monthUsd).toFixed(2)}</td></tr>
        <tr><td>cap</td><td class="num mono">${Number(s.money.capUsd).toFixed(0)}</td></tr>
        <tr><td>today</td><td class="num mono">${Number(s.money.todayUsd).toFixed(2)}</td></tr>
        <tr><td>frozen budgets</td><td class="num mono">${s.money.frozen}</td></tr>
      </tbody></table></div>
      <div><div class="panel-title">Work</div><table><tbody>
        <tr><td>workstreams open</td><td class="num mono">${s.work.workstreamsOpen}</td></tr>
        <tr><td>revision rounds</td><td class="num mono">${s.work.revisions}</td></tr>
        <tr><td>failed audits</td><td class="num mono">${s.work.auditsFailed}</td></tr>
        <tr><td>incidents open</td><td class="num mono">${s.work.incidentsOpen}</td></tr>
      </tbody></table></div>
      <div><div class="panel-title">Outside</div><table><tbody>
        <tr><td>connectors live</td><td class="num mono">${s.outside.connectorsLive}</td></tr>
        <tr><td>refused today</td><td class="num mono">${s.outside.egressBlocked}</td></tr>
        <tr><td>waiting for a person</td><td class="num mono">${s.outside.gatedWaiting}</td></tr>
        <tr><td>open breaches</td><td class="num mono" style="${s.outside.breaches ? 'color:var(--bad)' : ''}">${s.outside.breaches}</td></tr>
      </tbody></table></div>
    </div>
    <div class="map-legend">This is the read the rhythm takes before it decides anything. Every move it makes is derived from these numbers, and the numbers are on the same page as the decision so the two can be checked against each other.</div>
  </div>

  <div class="panel">
    <div class="panel-title">Goals the company set itself</div>
    <table><thead><tr><th>Objective</th><th>Quarter</th><th>How it will know</th></tr></thead><tbody>
    ${d.objectives.map((o) => `<tr><td><b>${esc(o.title)}</b></td><td class="mono">${esc(o.quarter)}</td>
      <td class="sub">${(o.krs || []).map((k) => `<span class="chip chip-dim">${esc(
        // The rhythm writes key results as sentences; the ones a person entered
        // earlier are objects with a target and a current value. Both are real
        // key results, so both render.
        typeof k === 'string' ? k : `${k.kr}: ${k.current ?? 0} / ${k.target}${k.unit ? ` ${k.unit}` : ''}`,
      )}</span>`).join(' ')}</td></tr>`).join('')
      || '<tr><td colspan="3" class="empty">No objectives yet — turn the quarter.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">The record — every period, its plan, what happened, what changed</div>
    <table><thead><tr><th>Clock</th><th>Period</th><th>Planned</th><th>Happened</th><th>Corrected</th><th>Opened</th></tr></thead>
      <tbody>${d.periods.map(period).join('') || '<tr><td colspan="6" class="empty">Nothing yet.</td></tr>'}</tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">What autonomy does not cross</div>
    <table><tbody>${d.limits.map((l) => `<tr><td>${esc(l)}</td></tr>`).join('')}</tbody></table>
    <div class="map-legend">"Runs without intervention" means nobody has to be present for the work. It does not mean nobody is responsible for the consequences — which is why these four stay, and why every turn above is written down with the numbers it decided from.</div>
  </div>`;
  wireXact(renderChief);
}
// ---------- Watchtower ----------
export async function renderObserve() {
  const d = await api('/api/observe');
  const canRun = hasPermC('observe.run');
  const spark = (series, colour) => {
    if (!series.length) return '<div class="sub">no measurements yet</div>';
    const max = Math.max(...series.map((p) => p.v), 0.0001);
    return `<svg aria-hidden="true" focusable="false" viewBox="0 0 100 30" preserveAspectRatio="none" style="width:100%;height:36px">
      <polyline fill="none" stroke="${colour}" stroke-width="1.5" vector-effect="non-scaling-stroke"
        points="${series.map((p, i) => `${(i / Math.max(1, series.length - 1)) * 100},${28 - (p.v / max) * 26}`).join(' ')}"/>
    </svg>`;
  };
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Promises kept', d.counts.ok, `of ${d.counts.total} the company holds itself to`, d.counts.breached ? '' : 'tile-ok')}
    ${tile('Broken now', d.counts.breached, 'each one has a remedy, not just a colour', d.counts.breached ? 'tile-bad' : '')}
    ${tile('Remedies applied', d.counts.remediesApplied, 'the company fixing itself')}
    <div class="panel tile"><div class="panel-title">Check now</div>
      ${canRun ? xbtn('/api/observe/check', {}, 'Measure and act', 'btn-primary') : '<div class="sub">observe.run required</div>'}
      <div class="sub" style="margin-top:6px">Runs every thirty seconds on its own.</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">What the company promised itself</div>
    <table><thead><tr><th>Promise</th><th>Watching</th><th>Now</th><th>Target</th><th>State</th><th>If it breaks</th></tr></thead><tbody>
    ${d.slos.map((s) => `<tr>
      <td><b>${esc(s.describe)}</b><div class="sub mono">${esc(s.name)}</div></td>
      <td class="mono sub">${esc(s.metric)} · ${s.window_h}h</td>
      <td class="num mono">${s.last_value === null ? '—' : Number(s.last_value).toFixed(2)}</td>
      <td class="num mono sub">${s.comparison === 'lte' ? '≤' : '≥'} ${s.target}</td>
      <td><span class="chip ${s.state === 'ok' ? 'chip-ok' : 'chip-bad'}">${esc(s.state)}</span>${s.breached_at ? `<div class="sub mono">since ${esc(String(s.breached_at).slice(5, 16))}</div>` : ''}</td>
      <td class="mono sub">${esc(s.remedy)}</td>
    </tr>`).join('')}
    </tbody></table>
    <div class="map-legend">A dashboard that goes red and waits is a dashboard for a company with people watching it. Every promise here carries a specific, bounded remedy the company applies to itself — and the ones with no safe automatic fix page a person instead of pretending.</div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Last day</div>
      <div class="sub">Queue depth</div>${spark(d.series.queue, 'var(--ember)')}
      <div class="sub" style="margin-top:10px">Spend this month</div>${spark(d.series.spend, 'var(--warn)')}
      <div class="sub" style="margin-top:10px">API error rate</div>${spark(d.series.errors, 'var(--bad)')}
    </div>
    <div class="panel">
      <div class="panel-title">What it fixed</div>
      <table><thead><tr><th>Promise</th><th>Did</th><th>Result</th><th>When</th></tr></thead><tbody>
      ${d.remedies.map((r) => `<tr><td class="mono">${esc(r.slo)}</td><td class="mono">${esc(r.action)}</td>
        <td class="sub">${esc(short(r.detail || '', 50))}</td><td class="mono sub">${esc(String(r.created_at).slice(5, 16))}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Nothing has needed fixing.</td></tr>'}
      </tbody></table>
      <div class="panel-title" style="margin-top:14px">Health</div>
      <table><tbody>
        <tr><td>chain entries</td><td class="num mono">${d.health.chain}</td></tr>
        <tr><td>jobs abandoned</td><td class="num mono" style="${d.health.jobsDead ? 'color:var(--bad)' : ''}">${d.health.jobsDead}</td></tr>
        <tr><td>connectors failing</td><td class="num mono" style="${d.health.connectorsFailing ? 'color:var(--bad)' : ''}">${d.health.connectorsFailing}</td></tr>
        <tr><td>webhooks paused</td><td class="num mono">${d.health.webhooksPaused}</td></tr>
      </tbody></table>
    </div>
  </div>`;
  wireXact(renderObserve);
}
// ---------- Backups ----------
export async function renderBackups() {
  const d = await api('/api/backups');
  const canTake = hasPermC('backups.take');
  const canRestore = hasPermC('backups.restore');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Copies kept', d.counts.total, `newest ${d.newest ? `${d.newest.ageHours}h old` : 'none yet'}`, d.newest && d.newest.ageHours > 12 ? 'tile-warn' : '')}
    ${tile('Verified', d.counts.verified, 'opened again and read', d.counts.verified ? 'tile-ok' : '')}
    ${tile('Missing files', d.counts.missing, 'recorded but no longer on disk', d.counts.missing ? 'tile-bad' : '')}
    <div class="panel tile"><div class="panel-title">Take one now</div>
      ${canTake ? xbtn('/api/backups', {}, 'Back up the company', 'btn-primary') : '<div class="sub">backups.take required</div>'}
      <div class="sub" style="margin-top:6px">Automatic every six hours · keeping ${d.keeping}</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">Copies</div>
    <table><thead><tr><th>#</th><th>File</th><th>Kind</th><th>Size</th><th>Chain tip</th><th>Verified</th><th>Taken</th><th></th></tr></thead><tbody>
    ${d.backups.map((b) => `<tr>
      <td class="mono">${b.id}</td>
      <td class="mono sub">${esc(short(b.file, 44))}${!b.exists ? ' <span class="chip chip-bad">gone</span>' : ''}</td>
      <td><span class="chip ${b.kind === 'pre-restore' ? 'chip-warn' : 'chip-dim'}">${esc(b.kind)}</span></td>
      <td class="num mono">${((b.bytes || 0) / 1e6).toFixed(1)} MB</td>
      <td class="num mono">${b.chain_tip}${b.chain_tip === d.chainNow ? ' <span class="chip chip-ok">current</span>' : ''}</td>
      <td>${b.verified === 1 ? '<span class="chip chip-ok">yes</span>' : b.verified === -1 ? '<span class="chip chip-bad">failed</span>' : '<span class="chip chip-dim">not checked</span>'}</td>
      <td class="mono sub">${esc(String(b.created_at).slice(5, 16))}</td>
      <td>${xbtn(`/api/backups/${b.id}/verify`, {}, 'Verify')}
          ${canRestore ? `<button class="btn btn-sm btn-bad" data-restore="${b.id}">Restore</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">No backups yet — take one.</td></tr>'}
    </tbody></table>
    <div id="bk-out"></div>
    <div class="map-legend">Every copy is taken from a checkpointed database, so it is a whole file rather than a file plus whatever was still in the write-ahead log. Each records the chain entry it was taken at, so "which backup is this" has an answer that cannot drift. Verifying re-opens the file and reads its chain — a copy nobody has checked is a hope, not a backup.</div>
  </div>

  <div class="panel">
    <div class="panel-title">Take it somewhere that is not SQLite</div>
    <button class="btn btn-sm" id="bk-export">Export everything as JSON</button>
    <div class="map-legend">Every table, the chain verification, and no credentials — an export is for moving a company, not for moving its keys. Those are re-issued at the destination.</div>
  </div>`;

  wireXact(renderBackups);
  $('#bk-export')?.addEventListener('click', () => downloadFile('/api/backups/export', 'alphacore-export.json'));
  view.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    const typed = prompt('Restoring replaces the live database with this copy.\nA backup of the present is taken first.\n\nType RESTORE to continue:');
    if (!typed) return;
    try {
      const r = await api(`/api/backups/${b.dataset.restore}/restore`, { method: 'POST', body: { confirm: typed } });
      $('#bk-out').innerHTML = `<div class="chip chip-warn" style="margin-top:12px">Staged. ${esc(r.next)}</div>${preBody(`staged: ${r.staged}\nsafety copy: ${r.safetyBackup}`)}`;
      toast('Staged — finish it with the server stopped');
    } catch (e) { toast(e.message, true); }
  }));
}
export async function renderSecurity() {
  const d = await api('/api/security');
  const canM = hasPermC('security.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Open findings', d.stats.open, 'need triage', d.stats.open ? 'tile-warn' : '')}
    ${tile('High severity', d.stats.high, 'act now', d.stats.high ? 'tile-bad' : '')}
    ${tile('All-time findings', d.stats.total, 'swept from real runs and configs')}
    <div class="panel tile"><div class="panel-title">Sweep</div>
      ${canM ? xbtn('/api/security/scan', {}, 'Run security sweep', 'btn-primary') : '<div class="sub">security.manage required</div>'}
      <div class="sub" style="margin-top:6px">Checks run inputs for injection phrasing, outputs for secret-shaped strings, vendors for missing DPAs, users for over-broad grants.</div></div>
  </div>
  <div class="panel">
    <div class="panel-title">Findings</div>
    <table><thead><tr><th>#</th><th>Kind</th><th>Sev</th><th>Summary</th><th>State</th><th></th></tr></thead><tbody>
    ${d.events.map((e) => `<tr>
      <td class="mono">${e.id}</td><td class="mono">${esc(e.kind)}</td>
      <td><span class="chip ${e.severity === 'high' ? 'chip-bad' : e.severity === 'medium' ? 'chip-warn' : 'chip-dim'}">${esc(e.severity)}</span></td>
      <td>${esc(e.summary)}</td><td class="mono">${esc(e.state)}</td>
      <td>${canM && e.state === 'open' ? xbtn(`/api/security/${e.id}/state`, { state: 'triaged' }, 'Triage') : ''}
          ${canM && e.state !== 'closed' ? xbtn(`/api/security/${e.id}/state`, { state: 'closed' }, 'Close', 'btn-ok') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No findings yet — run a sweep.</td></tr>'}
    </tbody></table>
  </div>`;
  wireXact(renderSecurity);
}
export async function renderCompliance() {
  const d = await api('/api/compliance');
  const canM = hasPermC('compliance.manage');
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel"><div class="panel-title">Provider posture — from live config</div>
      <table><thead><tr><th>Provider</th><th>DPA</th><th>No-training</th></tr></thead><tbody>
      ${d.providers.map((p) => `<tr><td class="mono">${esc(p.name)}</td>
        <td>${p.dpa ? '<span class="chip chip-ok">signed</span>' : '<span class="chip chip-bad">missing</span>'}</td>
        <td>${p.noTraining ? '<span class="chip chip-ok">yes</span>' : '<span class="chip chip-warn">unknown</span>'}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="panel"><div class="panel-title">Data processing register</div>
      <table><thead><tr><th>Store</th><th>Contains</th><th>Basis</th></tr></thead><tbody>
      ${d.dataRegister.map((r) => `<tr><td class="mono">${esc(r.store)}</td><td>${esc(r.contains)}</td><td class="mono">${esc(r.basis)}</td></tr>`).join('')}
      </tbody></table></div>
  </div>
  <div class="panel">
    <div class="panel-title">Attestations — human-signed, auditor-ready</div>
    ${canM ? `<div class="form-inline">
      <input id="cc-area" placeholder="area, e.g. access-control" style="width:200px">
      <select id="cc-status" aria-label="Status" style="width:auto"><option value="ok">ok</option><option value="gap">gap</option><option value="na">n/a</option></select>
      <input id="cc-note" placeholder="note" style="width:280px">
      <button class="btn btn-sm btn-primary" id="cc-go">Record check</button></div>` : ''}
    <table><thead><tr><th>Area</th><th>Status</th><th>Note</th><th>By</th><th>When</th></tr></thead><tbody>
    ${d.checks.map((c) => `<tr><td class="mono">${esc(c.area)}</td>
      <td><span class="chip ${c.status === 'ok' ? 'chip-ok' : c.status === 'gap' ? 'chip-bad' : 'chip-dim'}">${esc(c.status)}</span></td>
      <td>${esc(c.note || '')}</td><td class="mono">${esc(c.checked_by)}</td><td class="mono">${esc(c.created_at.slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No attestations recorded yet.</td></tr>'}
    </tbody></table>
  </div>`;
  $('#cc-go')?.addEventListener('click', async () => {
    try {
      await api('/api/compliance/check', { method: 'POST', body: { area: $('#cc-area').value, status: $('#cc-status').value, note: $('#cc-note').value || null } });
      toast('Recorded'); renderCompliance();
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderSustainability() {
  const d = await api('/api/sustainability');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Energy (est.)', `${d.totalKwh}<span class="unit">kWh</span>`, 'all model calls, all time')}
    ${tile('Carbon (est.)', `${d.totalGco2}<span class="unit">g</span>`, 'at 400 g/kWh grid average')}
    ${tile('Providers metered', d.byProvider.length, 'from the live token meters')}
    <div class="panel tile"><div class="panel-title">Method</div><div class="sub">${esc(d.note)}</div></div>
  </div>
  <div class="panel"><div class="panel-title">By provider</div>
    <table><thead><tr><th>Provider</th><th class="num">Tokens</th><th class="num">kWh</th><th class="num">gCO2</th><th class="num">Cost</th></tr></thead><tbody>
    ${d.byProvider.map((p) => `<tr><td class="mono">${esc(p.provider)}</td><td class="num mono">${p.tokens}</td><td class="num mono">${p.kwh}</td><td class="num mono">${p.gco2}</td><td class="num mono">$${p.cost?.toFixed?.(4) ?? p.cost}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No model calls yet.</td></tr>'}
    </tbody></table></div>
  <div class="panel"><div class="panel-title">Efficiency playbook</div>
    ${d.tips.map((t) => `<div class="map-legend">— ${esc(t)}</div>`).join('')}</div>`;
}
export async function renderIr() {
  const rows = await api('/api/ir');
  const canM = hasPermC('ir.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Investor updates — drafted from the live ledger, sent by you</div>
    ${canM ? `<div class="form-inline">
      <input id="ir-period" placeholder="period, e.g. 2026-08" style="width:140px">
      <button class="btn btn-sm btn-primary" id="ir-go">Draft update</button></div>` : ''}
  </div>
  ${rows.map((u) => `
  <div class="panel">
    <div class="panel-title"><span>${esc(u.period)} <span class="chip ${u.state === 'sent' ? 'chip-ok' : 'chip-warn'}">${esc(u.state)}</span></span>
      <span>${canM && u.state === 'draft' && u.body ? xbtn(`/api/ir/${u.id}/send`, {}, 'Mark sent', 'btn-ok') : ''}</span></div>
    ${preBody(u.body || '⏳ drafting from live numbers…')}
  </div>`).join('') || '<div class="panel"><div class="empty">No investor updates yet.</div></div>'}`;
  wireXact(renderIr);
  $('#ir-go')?.addEventListener('click', async () => {
    try { await api('/api/ir', { method: 'POST', body: { period: $('#ir-period').value } }); toast('Drafting'); renderIr(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderBoard() {
  const rows = await api('/api/board');
  const canM = hasPermC('board.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Board room — the packet reads the company, the humans resolve</div>
    ${canM ? `<div class="form-inline">
      <input id="bd-period" placeholder="period, e.g. 2026-Q3" style="width:140px">
      <button class="btn btn-sm btn-primary" id="bd-go">Prepare packet</button></div>` : ''}
  </div>
  ${rows.map((b) => `
  <div class="panel">
    <div class="panel-title">${esc(b.period)} <span class="chip ${b.state === 'held' ? 'chip-ok' : 'chip-warn'}">${esc(b.state)}</span></div>
    ${preBody(b.packet || '⏳ preparing the packet…')}
    ${b.state === 'held' ? `<div class="map-legend"><b>Resolutions:</b> ${esc(b.resolutions)}</div>`
      : canM && b.packet ? `<div class="form-inline" style="margin-top:8px">
          <input id="bd-res-${b.id}" placeholder="resolutions taken by the board" style="width:60%">
          <button class="btn btn-sm btn-ok" data-hold="${b.id}">Record meeting held</button></div>` : ''}
  </div>`).join('') || '<div class="panel"><div class="empty">No board records yet.</div></div>'}`;
  wireXact(renderBoard);
  $('#bd-go')?.addEventListener('click', async () => {
    try { await api('/api/board', { method: 'POST', body: { period: $('#bd-period').value } }); toast('Preparing'); renderBoard(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-hold]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/board/${b.dataset.hold}/hold`, { method: 'POST', body: { resolutions: $(`#bd-res-${b.dataset.hold}`).value } }); toast('Recorded'); renderBoard(); }
    catch (e) { toast(e.message, true); }
  }));
}
export async function renderComms() {
  const rows = await api('/api/comms');
  const canM = hasPermC('comms.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Internal comms — the bulletin writes itself from the week's real events</div>
    ${canM ? xbtn('/api/comms', {}, 'Draft this week’s bulletin', 'btn-primary') : ''}
  </div>
  ${rows.map((b) => `
  <div class="panel">
    <div class="panel-title"><span>Week of ${esc(b.week)} <span class="chip ${b.state === 'published' ? 'chip-ok' : 'chip-warn'}">${esc(b.state)}</span></span>
      <span>${canM && b.state === 'draft' && b.body ? xbtn(`/api/comms/${b.id}/publish`, {}, 'Publish', 'btn-ok') : ''}</span></div>
    ${preBody(b.body || '⏳ the editor is reading the audit chain…')}
  </div>`).join('') || '<div class="panel"><div class="empty">No bulletins yet.</div></div>'}`;
  wireXact(renderComms);
}
