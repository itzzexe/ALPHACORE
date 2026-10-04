// Run — the fleet, one server, deployments and monitoring.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { navGeneration } from '../core/shell.js';
import { t } from '/i18n.js';
import { kpi, dot, stateTag, bar, strip, spark, ago, bytes, dur, emptyCta, tabs, glyph, GLYPH, hashParam, wireActs, act, who } from '../components/ui.js';

const remember = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* fine */ } };
const recall = (k, d) => { try { return sessionStorage.getItem(k) || d; } catch { return d; } };
const uptime = (s) => (s == null ? '—' : s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);

// =============================================================== servers ==

export async function renderServers() {
  const { overview: o, servers, pending } = await api('/api/servers');
  const canM = hasPermC('servers.manage');
  const canX = hasPermC('servers.exec');
  const showNew = hashParam('new') === '1' || (!servers.length && canM);
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Every machine the company runs software on. Add a VPS with its address and an SSH key — or this machine itself — and AlphaCore reads its vital signs, manages its services, provisions it and deploys to it. An AI may ask to run a command; a person decides.'))}</p>
    <div class="pg-actions">${canM ? `<button class="btn btn-primary" id="sv-toggle" type="button">＋ ${esc(t('Add a server'))}</button>` : ''}</div>
  </div>
  ${!o.sshClient ? `<div class="callout human"><b>${esc(t('No SSH client on this machine.'))}</b> ${esc(t('Remote servers need OpenSSH (built into Windows 10+, macOS and Linux). "This machine" works without it.'))}</div>` : ''}
  <div class="kpis">
    ${kpi('Servers', o.total)}
    ${kpi('Online', o.online, '', o.online ? 'ok' : '')}
    ${kpi('Offline', o.offline, '', o.offline ? 'bad' : '')}
    ${kpi('Commands to approve', o.pending, esc(t('asked for by AI employees')), o.pending ? 'human' : '')}
    ${kpi('Running hot', o.hot.length, o.hot.length ? esc(o.hot.join(', ')) : esc(t('all within limits')), o.hot.length ? 'bad' : '')}
  </div>
  ${canM ? `<form class="panel" id="sv-form" ${showNew ? '' : 'hidden'}>
    <div class="panel-title">${esc(t('Add a server'))}</div>
    <div class="fields">
      <div><label class="fl" for="sv-name">${esc(t('Name'))}</label><input id="sv-name" required placeholder="web-1"></div>
      <div><label class="fl" for="sv-env">${esc(t('Environment'))}</label><select id="sv-env"><option value="production">${esc(t('production'))}</option><option value="staging">${esc(t('staging'))}</option><option value="development">${esc(t('development'))}</option></select></div>
      <div><label class="fl" for="sv-transport">${esc(t('Connection'))}</label><select id="sv-transport"><option value="ssh">SSH</option><option value="local">${esc(t('This machine'))}</option></select></div>
      <div class="ssh-only"><label class="fl" for="sv-host">${esc(t('Address (IP or host name)'))}</label><input id="sv-host" class="ltr" placeholder="203.0.113.10"></div>
      <div class="ssh-only"><label class="fl" for="sv-user">${esc(t('User'))}</label><input id="sv-user" class="ltr" placeholder="root"></div>
      <div class="ssh-only"><label class="fl" for="sv-port">${esc(t('SSH port'))}</label><input id="sv-port" class="ltr" value="22"></div>
      <div><label class="fl" for="sv-provider">${esc(t('Provider (optional)'))}</label><input id="sv-provider" placeholder="Hetzner, DigitalOcean, Hostinger…"></div>
      <div class="wide ssh-only"><label class="fl" for="sv-key">${esc(t('Private key'))}</label>
        <textarea id="sv-key" rows="4" class="ltr mono" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
        <div class="hint">${esc(t('Sealed in the vault the moment it arrives and never shown again. Make one with: ssh-keygen -t ed25519 — then put the .pub half in ~/.ssh/authorized_keys on the server.'))}</div></div>
    </div>
    <div class="inline" style="margin-top:14px"><button class="btn btn-primary" type="submit">${esc(t('Add and connect'))}</button></div>
  </form>` : ''}
  ${pending.length ? `<div class="panel lane-panel people"><div class="panel-title">${esc(t('Commands waiting for a person'))}</div><div class="rows">${pending.map((c) => `
    <div class="row">${who(c.requested_by)}<div class="row-main"><div class="row-title">${esc(c.server)} <span class="chip">${esc(t(c.environment))}</span> ${esc(c.purpose || '')}</div><pre class="term" style="max-height:120px;margin-top:6px">${esc(c.command)}</pre></div>
      ${canX ? `<div class="row-side">${act(`/api/servers/commands/${c.id}/decide`, 'Refuse', { body: { approve: false }, cls: 'btn-sm btn-bad' })}${act(`/api/servers/commands/${c.id}/decide`, 'Run it', { body: { approve: true }, cls: 'btn-sm btn-human', done: 'Ran' })}</div>` : ''}
    </div>`).join('')}</div></div>` : ''}
  ${servers.length ? `<div class="cards">${servers.map((s) => `
    <a class="card" href="#/servers/${s.id}">
      <div class="card-top">${glyph(GLYPH.server)}<div class="card-title">${esc(s.name)}</div>${dot(s.state)}</div>
      <div class="card-meta"><span class="chip">${esc(t(s.environment))}</span> <span class="ltr">${esc(s.transport === 'local' ? t('this machine') : `${s.username}@${s.host}`)}</span></div>
      <div class="gauges">${bar('CPU', s.metrics?.cpuPct)}${bar('Memory', s.metrics?.memPct)}${bar('Disk', s.metrics?.diskPct)}</div>
      <div class="card-foot"><span>${esc(s.os || t(s.state))}</span><span>${s.last_seen ? esc(ago(s.last_seen)) : esc(t('never reached'))}</span></div>
    </a>`).join('')}</div>` : (canM ? '' : emptyCta('No servers yet', 'Somebody with server access can add one.'))}`;

  const syncTransport = () => view.querySelectorAll('.ssh-only').forEach((el) => { el.hidden = $('#sv-transport')?.value === 'local'; });
  $('#sv-transport')?.addEventListener('change', syncTransport);
  $('#sv-toggle')?.addEventListener('click', () => { const f = $('#sv-form'); f.hidden = !f.hidden; });
  $('#sv-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const s = await api('/api/servers', { method: 'POST', body: {
        name: $('#sv-name').value, environment: $('#sv-env').value, transport: $('#sv-transport').value, host: $('#sv-host').value,
        username: $('#sv-user').value, port: Number($('#sv-port').value) || 22, provider: $('#sv-provider').value, privateKey: $('#sv-key').value || null,
      } });
      toast(t('Server added — connecting'));
      api(`/api/servers/${s.id}/collect`, { method: 'POST', body: {} }).catch(() => {});
      location.hash = `#/servers/${s.id}`;
    } catch (err) { toast(err.message, true); }
  });
  wireActs(view, api, toast, renderServers);
}

// ============================================================ one server ==

export async function renderServer(id) {
  const gen = navGeneration;
  const s = await api(`/api/servers/${id}`);
  const canM = hasPermC('servers.manage');
  const canX = hasPermC('servers.exec');
  const key = `alphacore-server-tab-${s.id}`;
  let tab = recall(key, 'overview');
  document.getElementById('page-title').textContent = s.name;
  const m = s.metrics || {};
  view.innerHTML = `
  <div class="pg-head">
    <div class="inline">${dot(s.state)} <b>${esc(t(s.state))}</b>
      <span class="chip">${esc(t(s.environment))}</span>
      <span class="chip ltr">${esc(s.transport === 'local' ? t('this machine') : `${s.username}@${s.host}:${s.port}`)}</span>
      ${s.os ? `<span class="chip">${esc(s.os)}</span>` : ''}
      ${s.last_error ? `<span class="chip chip-bad" title="${esc(s.last_error)}">${esc(s.last_error.slice(0, 60))}</span>` : ''}
    </div>
    <div class="pg-actions">
      ${act(`/api/servers/${s.id}/test`, 'Test connection', { cls: 'btn-sm' })}
      ${act(`/api/servers/${s.id}/collect`, 'Refresh vital signs', { cls: 'btn-sm', done: 'Refreshed' })}
      ${canM ? `<button class="btn btn-sm btn-primary" type="button" id="sd-diag">✦ ${esc(t('Diagnose with AI'))}</button>` : ''}
    </div>
  </div>
  <div id="sd-diag-out"></div>
  ${tabs([['overview', 'Overview'], ['terminal', 'Terminal'], ['services', 'Services'], ['provision', 'Provision'], ['settings', 'Settings']], tab)}
  <div id="sd-body"></div>`;
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { remember(key, b.dataset.tab); renderServer(id); }));
  const rerender = () => { if (gen === navGeneration) renderServer(id); };
  wireActs(view.querySelector('.pg-head'), api, toast, rerender);
  $('#sd-diag')?.addEventListener('click', () => diagnose(s, gen));
  const body = $('#sd-body');

  if (tab === 'overview') {
    const hist = s.history || [];
    body.innerHTML = `
    <div class="kpis">
      ${kpi('CPU', m.cpuPct == null ? '—' : `${m.cpuPct}%`, m.cpus ? `${m.cpus} ${esc(t('cores'))} · load ${esc((m.load || []).join(' '))}` : '', m.cpuPct > 85 ? 'bad' : '')}
      ${kpi('Memory', m.memPct == null ? '—' : `${m.memPct}%`, m.memTotalMb ? `${(m.memTotalMb / 1024).toFixed(1)} GB` : '', m.memPct > 90 ? 'bad' : '')}
      ${kpi('Disk', m.diskPct == null ? '—' : `${m.diskPct}%`, m.diskTotalGb ? `${m.diskTotalGb} GB` : '', m.diskPct > 85 ? 'bad' : '')}
      ${kpi('Up for', uptime(m.uptimeS), m.kernel ? esc(m.kernel) : '')}
      ${kpi('Failed services', m.failedUnits ?? '—', m.nginx ? `nginx ${esc(m.nginx)}` : '', m.failedUnits ? 'bad' : '')}
    </div>
    <div class="grid grid-3">
      <div class="panel"><div class="panel-title">${esc(t('CPU, 24 hours'))}</div>${spark(hist.map((h) => h.cpu_pct), { max: 100 })}</div>
      <div class="panel"><div class="panel-title">${esc(t('Memory, 24 hours'))}</div>${spark(hist.map((h) => h.mem_pct), { max: 100 })}</div>
      <div class="panel"><div class="panel-title">${esc(t('Disk, 24 hours'))}</div>${spark(hist.map((h) => h.disk_pct), { max: 100 })}</div>
    </div>
    <div class="grid grid-2">
      <div class="panel"><div class="panel-title">${esc(t('Busiest processes'))}</div>
        ${(m.procs || []).length ? `<table><thead><tr><th>PID</th><th>${esc(t('Process'))}</th><th class="num">CPU</th><th class="num">${esc(t('Memory'))}</th></tr></thead><tbody>${m.procs.map((p) => `<tr><td class="mono">${p.pid}</td><td class="mono">${esc(p.cmd)}</td><td class="num">${p.cpu}%</td><td class="num">${p.mem}%</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('Refresh the vital signs to see this.'))}</div>`}
      </div>
      <div class="panel"><div class="panel-title">${esc(t('Containers'))}</div>
        ${(m.docker || []).length ? `<div class="rows">${m.docker.map((c) => `<div class="row">${dot(/^Up/.test(c.status) ? 'up' : 'down')}<div class="row-main"><div class="row-title mono">${esc(c.name)}</div><div class="row-meta">${esc(c.image)} · ${esc(c.status)}</div></div></div>`).join('')}</div>` : `<div class="empty">${esc(t('No Docker containers.'))}</div>`}
        ${s.targets.length ? `<div class="panel-title" style="margin-top:14px">${esc(t('Deployed here'))}</div><div class="rows">${s.targets.map((tg) => `<a class="row" href="#/deploys/${tg.id}">${dot(tg.state)}<div class="row-main"><div class="row-title">${esc(tg.name)}</div><div class="row-meta">${esc(tg.domain || '')} · ${esc(tg.runtime)}</div></div></a>`).join('')}</div>` : ''}
      </div>
    </div>`;
    return;
  }

  if (tab === 'terminal') {
    const QUICK = ['uptime', 'df -h', 'free -m', 'docker ps', 'systemctl --failed', 'sudo -n tail -n 50 /var/log/nginx/error.log', 'ss -tulpn | head -40', 'journalctl -p err -n 40 --no-pager'];
    body.innerHTML = `
    <div class="split2">
      <div class="panel">
        <div class="panel-title">${esc(t('Run on'))} ${esc(s.name)}</div>
        <div class="term" id="st-out" data-keep-scroll>${esc(t('Every command is recorded before it runs.'))}</div>
        ${canX ? `<form class="term-line" id="st-form"><input id="st-cmd" placeholder="uptime" autocomplete="off" aria-label="${esc(t('Command'))}"><button class="btn btn-primary" type="submit">${esc(t('Run'))}</button></form>
        <div class="inline" style="margin-top:10px">${QUICK.map((c) => `<button class="btn btn-sm" type="button" data-q="${esc(c)}">${esc(c.split(' ').slice(0, 3).join(' '))}</button>`).join('')}</div>`
        : `<div class="callout">${esc(t('Running commands needs the servers.exec permission.'))}</div>`}
      </div>
      <div class="panel"><div class="panel-title">${esc(t('History'))}</div><div class="rows">${s.commands.map((c) => `
        <button class="row" type="button" data-c="${c.id}" style="background:none;border:0;border-bottom:1px solid var(--sx-line-soft);width:100%;text-align:start;cursor:pointer;font:inherit;color:inherit">
          ${who(c.requested_by)}<div class="row-main"><div class="row-title mono ltr">${esc(c.purpose || c.command.split('\n')[0])}</div><div class="row-meta">${esc(ago(c.started_at))} · ${dur(c.duration_ms)}</div></div>${stateTag(c.state)}
        </button>`).join('') || `<div class="empty">${esc(t('Nothing has run here yet.'))}</div>`}</div></div>
    </div>`;
    const out = $('#st-out');
    const show = async (cid) => {
      const c = await api(`/api/servers/commands/${cid}`);
      out.innerHTML = `<span class="t-cmd">$ ${esc(c.command)}</span>\n${esc(c.output || '')}\n<span class="${c.state === 'ok' ? 't-ok' : c.state === 'awaiting_approval' ? 't-cmd' : 't-bad'}">— ${esc(t(c.state))}${c.exit_code != null ? ` (exit ${c.exit_code})` : ''}</span>`;
    };
    const run = async (command) => {
      out.innerHTML = `<span class="t-cmd">$ ${esc(command)}</span>\n…`;
      try { const c = await api(`/api/servers/${s.id}/run`, { method: 'POST', body: { command } }); await show(c.id); }
      catch (e) { out.innerHTML += `\n<span class="t-bad">${esc(e.message)}</span>`; }
    };
    $('#st-form')?.addEventListener('submit', (e) => { e.preventDefault(); const v = $('#st-cmd').value.trim(); if (v) { run(v); $('#st-cmd').value = ''; } });
    body.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => run(b.dataset.q)));
    body.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => show(b.dataset.c)));
    if (s.commands[0]) show(s.commands[0].id);
    return;
  }

  if (tab === 'services') {
    body.innerHTML = `<div class="panel"><div class="empty">${esc(t('Reading services…'))}</div></div>`;
    const r = await api(`/api/servers/${s.id}/services`).catch((e) => ({ ok: false, error: e.message, units: [] }));
    if (gen !== navGeneration) return;
    body.innerHTML = `
    <div class="split2">
      <div class="panel">
        <div class="panel-title">${esc(t('Services'))}<input id="ss-filter" placeholder="${esc(t('Filter'))}" style="max-width:200px;min-height:32px" aria-label="${esc(t('Filter'))}"></div>
        ${r.ok ? `<table><thead><tr><th>${esc(t('Service'))}</th><th>${esc(t('State'))}</th><th></th></tr></thead><tbody>${r.units.map((u) => `
          <tr data-unit="${esc(u.unit)}"><td><div class="mono">${esc(u.unit)}</div><div class="muted" style="font-size:12px">${esc(u.description)}</div></td>
          <td>${dot(u.active === 'active' ? 'up' : u.active === 'failed' ? 'down' : '')} ${esc(u.sub)}</td>
          <td class="num" style="white-space:nowrap"><button class="btn btn-sm" type="button" data-logs="${esc(u.unit)}">${esc(t('Logs'))}</button>
            ${canX ? `<button class="btn btn-sm" type="button" data-svc="${esc(u.unit)}" data-a="restart">${esc(t('Restart'))}</button>${u.active === 'active' ? `<button class="btn btn-sm btn-bad" type="button" data-svc="${esc(u.unit)}" data-a="stop">${esc(t('Stop'))}</button>` : `<button class="btn btn-sm btn-ok" type="button" data-svc="${esc(u.unit)}" data-a="start">${esc(t('Start'))}</button>`}` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div class="callout bad">${esc(r.error || t('Could not read services.'))}</div>`}
      </div>
      <div class="panel"><div class="panel-title">${esc(t('Logs'))} <span class="mono" id="ss-unit" style="text-transform:none"></span></div><pre class="term" id="ss-log" data-keep-scroll style="max-height:620px">${esc(t('Choose a service to read its log.'))}</pre></div>
    </div>`;
    $('#ss-filter')?.addEventListener('input', (e) => { const v = e.target.value.toLowerCase(); body.querySelectorAll('tr[data-unit]').forEach((tr) => { tr.hidden = !tr.dataset.unit.toLowerCase().includes(v); }); });
    body.querySelectorAll('[data-logs]').forEach((b) => b.addEventListener('click', async () => {
      $('#ss-unit').textContent = b.dataset.logs; $('#ss-log').textContent = '…';
      const l = await api(`/api/servers/${s.id}/logs?unit=${encodeURIComponent(b.dataset.logs)}&lines=300`).catch((e) => ({ log: e.message }));
      $('#ss-log').textContent = l.log || t('(empty)');
      $('#ss-log').scrollTop = $('#ss-log').scrollHeight;
    }));
    body.querySelectorAll('[data-svc]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.a === 'stop' && !confirm(`${t('Stop')} ${b.dataset.svc}?`)) return;
      b.disabled = true;
      try { const c = await api(`/api/servers/${s.id}/service`, { method: 'POST', body: { unit: b.dataset.svc, action: b.dataset.a } }); toast(c.state === 'ok' ? t('Done') : `${t('Failed')}: ${String(c.output).slice(0, 120)}`, c.state !== 'ok'); rerender(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    return;
  }

  if (tab === 'provision') {
    const { overview } = await api('/api/servers');
    body.innerHTML = `
    <div class="callout">${esc(t('Ready-made setups for a fresh Ubuntu or Debian server. Each runs as a recorded command; read the script before you run it. The user needs root or password-less sudo.'))}</div>
    <div class="cards">${overview.recipes.map((r) => `
      <div class="card">
        <div class="card-top">${glyph(GLYPH.rocket)}<div class="card-title">${esc(t(r.label))}</div></div>
        <div class="card-meta">${esc(t(r.hint))}</div>
        <div class="card-foot"><span></span>${canX ? act(`/api/servers/${s.id}/provision`, 'Run', { body: { recipe: r.id }, cls: 'btn-sm btn-primary', confirm: 'This changes the server. Run it?', done: 'Finished — see the terminal history' }) : ''}</div>
      </div>`).join('')}</div>`;
    wireActs(body, api, toast, () => { remember(key, 'terminal'); rerender(); });
    return;
  }

  // settings
  body.innerHTML = `
  <form class="panel" id="se-form">
    <div class="panel-title">${esc(t('Server settings'))}</div>
    <div class="fields">
      <div><label class="fl" for="se-name">${esc(t('Name'))}</label><input id="se-name" value="${esc(s.name)}"></div>
      <div><label class="fl" for="se-env">${esc(t('Environment'))}</label><select id="se-env">${['production', 'staging', 'development'].map((e) => `<option value="${e}" ${s.environment === e ? 'selected' : ''}>${esc(t(e))}</option>`).join('')}</select></div>
      ${s.transport === 'ssh' ? `<div><label class="fl" for="se-host">${esc(t('Address'))}</label><input id="se-host" class="ltr" value="${esc(s.host || '')}"></div>
      <div><label class="fl" for="se-user">${esc(t('User'))}</label><input id="se-user" class="ltr" value="${esc(s.username || '')}"></div>
      <div><label class="fl" for="se-port">${esc(t('SSH port'))}</label><input id="se-port" class="ltr" value="${esc(s.port)}"></div>` : ''}
      <div><label class="fl" for="se-provider">${esc(t('Provider'))}</label><input id="se-provider" value="${esc(s.provider || '')}"></div>
      <div class="wide"><label class="fl" for="se-notes">${esc(t('Notes'))}</label><textarea id="se-notes" rows="2">${esc(s.notes || '')}</textarea></div>
    </div>
    ${canM ? `<div class="inline" style="margin-top:14px"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button></div>` : ''}
  </form>
  ${s.transport === 'ssh' && canM ? `<form class="panel" id="se-key"><div class="panel-title">${esc(t('SSH key'))} ${s.hasKey ? `<span class="chip chip-ok">${esc(t('sealed in the vault'))}</span>` : `<span class="chip chip-warn">${esc(t('none'))}</span>`}</div>
    <textarea id="se-keytext" rows="4" class="ltr mono" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
    <div class="inline" style="margin-top:10px"><button class="btn" type="submit">${esc(t('Replace the key'))}</button></div></form>` : ''}
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Remove'))}</div><p class="muted" style="margin:0 0 10px">${esc(t('Removes the server from AlphaCore and its key from the vault. Nothing on the server itself is touched.'))}</p>${act(`/api/servers/${s.id}/remove`, 'Remove this server', { cls: 'btn-sm btn-bad', confirm: 'Remove this server from AlphaCore?' })}</div>` : ''}`;
  $('#se-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/servers/${s.id}/update`, { method: 'POST', body: { name: $('#se-name').value, environment: $('#se-env').value, host: $('#se-host')?.value, username: $('#se-user')?.value, port: $('#se-port')?.value, provider: $('#se-provider').value, notes: $('#se-notes').value } });
      toast(t('Saved')); rerender();
    } catch (err) { toast(err.message, true); }
  });
  $('#se-key')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/servers/${s.id}/key`, { method: 'POST', body: { privateKey: $('#se-keytext').value } }); toast(t('Key replaced')); rerender(); }
    catch (err) { toast(err.message, true); }
  });
  wireActs(body, api, toast, () => { location.hash = '#/servers'; });
}

async function diagnose(s, gen) {
  const out = $('#sd-diag-out');
  const q = prompt(t('Anything specific? (optional) e.g. the site is slow since this morning')) ?? null;
  if (q === null) return;
  out.innerHTML = `<div class="panel lane-panel"><div class="empty">${esc(t('The ops monitor is reading the server…'))}</div></div>`;
  try {
    const { runId } = await api(`/api/servers/${s.id}/diagnose`, { method: 'POST', body: { question: q } });
    const poll = async () => {
      if (gen !== navGeneration) return;
      const d = await api(`/api/servers/diagnosis/${runId}`);
      if (['queued', 'leased', 'running'].includes(d.state)) { setTimeout(poll, 2000); return; }
      const p = d.parsed || {};
      out.innerHTML = `<div class="panel lane-panel">
        <div class="panel-title">${esc(p.title || t('Diagnosis'))}${who('agent:AGT-MON-001')}</div>
        <div style="white-space:pre-wrap">${esc(p.markdown || d.failure || t('No answer.'))}</div>
        ${(p.commands || []).length ? `<div class="panel-title" style="margin-top:14px">${esc(t('Suggested commands'))}</div><div class="rows">${p.commands.map((c) => `<div class="row"><div class="row-main"><pre class="term" style="max-height:90px">${esc(c.command)}</pre><div class="row-meta">${esc(c.why || '')}</div></div>${hasPermC('servers.exec') ? `<button class="btn btn-sm" type="button" data-run="${esc(c.command)}">${esc(t('Run'))}</button>` : ''}</div>`).join('')}</div>` : ''}
      </div>`;
      out.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm(`${t('Run on')} ${s.name}?\n\n${b.dataset.run}`)) return;
        try { const c = await api(`/api/servers/${s.id}/run`, { method: 'POST', body: { command: b.dataset.run } }); toast(c.state === 'ok' ? t('Done') : t('Failed'), c.state !== 'ok'); }
        catch (e) { toast(e.message, true); }
      }));
    };
    poll();
  } catch (e) { out.innerHTML = `<div class="callout bad">${esc(e.message)}</div>`; }
}

// =========================================================== deployments ==

export async function renderDeploys() {
  const [{ overview: o, targets, pending }, forge, fleet] = await Promise.all([
    api('/api/deploys'), api('/api/forge').catch(() => ({ projects: [] })), api('/api/servers').catch(() => ({ servers: [] })),
  ]);
  const canM = hasPermC('deploys.manage');
  const preProject = hashParam('project');
  const preRuntime = hashParam('runtime');
  const showNew = Boolean(preProject) || (!targets.length && canM && forge.projects.length && fleet.servers.length);
  const pre = forge.projects.find((p) => String(p.id) === String(preProject));
  const guessRuntime = preRuntime || (pre ? (['website', 'static-site', 'blank'].includes(pre.kind) ? 'static' : pre.kind === 'python-api' ? 'python' : 'node') : 'node');
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Put a project on a server and keep it there. Each release is packaged here, unpacked into its own folder on the server, and only then switched live — so a failed release leaves the last one serving, and rolling back is instant. nginx and HTTPS are set up for you.'))}</p>
    <div class="pg-actions">${canM ? `<button class="btn btn-primary" type="button" id="dp-toggle">＋ ${esc(t('New deployment'))}</button>` : ''}</div>
  </div>
  <div class="kpis">
    ${kpi('Deployments', o.targets)}
    ${kpi('Live', o.live, '', o.live ? 'ok' : '')}
    ${kpi('Failing', o.failing, '', o.failing ? 'bad' : '')}
    ${kpi('Releases this week', o.releasesWeek, o.failedWeek ? `${o.failedWeek} ${esc(t('failed'))}` : '', '')}
    ${kpi('Waiting for approval', o.pending, esc(t('production releases asked for by AI')), o.pending ? 'human' : '')}
  </div>
  ${canM ? `<form class="panel" id="dp-form" ${showNew ? '' : 'hidden'}>
    <div class="panel-title">${esc(t('New deployment'))}</div>
    ${!forge.projects.length || !fleet.servers.length ? `<div class="callout human">${esc(t('You need a project and a server first.'))} ${!forge.projects.length ? `<a href="#/forge?new=1">${esc(t('Start a project'))}</a>` : ''} ${!fleet.servers.length ? `<a href="#/servers?new=1">${esc(t('Add a server'))}</a>` : ''}</div>` : ''}
    <div class="fields">
      <div><label class="fl" for="dp-project">${esc(t('Project'))}</label><select id="dp-project">${forge.projects.map((p) => `<option value="${p.id}" data-kind="${esc(p.kind)}" ${String(p.id) === String(preProject) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="dp-server">${esc(t('Server'))}</label><select id="dp-server">${fleet.servers.map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(t(s.environment))})</option>`).join('')}</select></div>
      <div class="wide"><span class="fl">${esc(t('How it runs'))}</span><div class="seg">${o.runtimes.map((r) => `<label><input type="radio" name="dp-rt" value="${r.id}" ${guessRuntime === r.id ? 'checked' : ''}><b>${esc(t(r.label))}</b></label>`).join('')}</div></div>
      <div><label class="fl" for="dp-domain">${esc(t('Domain'))}</label><input id="dp-domain" class="ltr" placeholder="app.example.com"><div class="hint">${esc(t('Point its DNS A record at the server first.'))}</div></div>
      <div><label class="fl" for="dp-port">${esc(t('Port the app listens on'))}</label><input id="dp-port" class="ltr" placeholder="3000"></div>
      <div><label class="fl" for="dp-health">${esc(t('Health check path'))}</label><input id="dp-health" class="ltr" value="/"></div>
      <div><label class="fl" for="dp-start">${esc(t('Start command (optional)'))}</label><input id="dp-start" class="ltr" placeholder="/usr/bin/env npm start"></div>
      <div class="wide"><label class="fl" for="dp-env">${esc(t('Environment variables — KEY=VALUE, one per line'))}</label><textarea id="dp-env" rows="3" class="ltr mono" placeholder="DATABASE_URL=…"></textarea><div class="hint">${esc(t('Sealed at rest. Written to the server as a file only the app can read.'))}</div></div>
      <div><label class="inline" style="font-weight:600"><input type="checkbox" id="dp-ssl" style="width:auto;min-height:0"> ${esc(t("HTTPS with Let's Encrypt"))}</label></div>
      <div><label class="fl" for="dp-email">${esc(t('Email for the certificate'))}</label><input id="dp-email" type="email" class="ltr"></div>
    </div>
    <div class="inline" style="margin-top:14px"><button class="btn btn-primary" type="submit">${esc(t('Create and deploy'))}</button></div>
  </form>` : ''}
  ${pending.length ? `<div class="panel lane-panel people"><div class="panel-title">${esc(t('Waiting for a person'))}</div><div class="rows">${pending.map((r) => `<div class="row">${who(r.requested_by)}<div class="row-main"><div class="row-title">${esc(r.target)} → ${esc(r.server)}</div><div class="row-meta">${esc(ago(r.started_at))}</div></div>
    ${canM ? `<div class="row-side">${act(`/api/deploys/releases/${r.id}/decide`, 'Refuse', { body: { approve: false }, cls: 'btn-sm btn-bad' })}${act(`/api/deploys/releases/${r.id}/decide`, 'Release', { body: { approve: true }, cls: 'btn-sm btn-human', done: 'Releasing' })}</div>` : ''}</div>`).join('')}</div></div>` : ''}
  ${targets.length ? `<div class="panel"><div class="rows">${targets.map((tg) => `
    <div class="row">
      ${dot(tg.state)}
      <a class="row-main" href="#/deploys/${tg.id}" style="text-decoration:none;color:inherit">
        <div class="row-title">${esc(tg.name)}</div>
        <div class="row-meta">${esc(tg.project?.name || '')} → ${esc(tg.server?.name || '')} · ${esc(tg.runtime)}${tg.url ? ` · <span class="ltr">${esc(tg.url)}</span>` : ''}${tg.last ? ` · ${esc(ago(tg.last.started_at))}` : ''}</div>
      </a>
      <div class="row-side">${tg.last ? stateTag(tg.last.state) : ''}
        ${tg.url ? `<a class="btn btn-sm" href="${esc(tg.url)}" target="_blank" rel="noopener">${esc(t('Visit'))} ↗</a>` : ''}
        ${canM ? act(`/api/deploys/${tg.id}/release`, 'Deploy now', { cls: 'btn-sm btn-primary', done: 'Release started' }) : ''}
      </div>
    </div>`).join('')}</div></div>` : (canM ? '' : emptyCta('No deployments yet', 'Somebody with deployment access can create one.'))}`;
  // The runtime follows the project chosen: a website is static files, a Python API runs under Python.
  const syncRuntime = () => {
    const kind = $('#dp-project')?.selectedOptions[0]?.dataset.kind;
    if (!kind) return;
    const rt = ['website', 'static-site', 'blank'].includes(kind) ? 'static' : kind === 'python-api' ? 'python' : 'node';
    const input = view.querySelector(`input[name="dp-rt"][value="${rt}"]`);
    if (input) input.checked = true;
  };
  $('#dp-project')?.addEventListener('change', syncRuntime);
  if (!preRuntime) syncRuntime();
  $('#dp-toggle')?.addEventListener('click', () => { const f = $('#dp-form'); f.hidden = !f.hidden; });
  $('#dp-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const tg = await api('/api/deploys', { method: 'POST', body: {
        projectId: Number($('#dp-project').value), serverId: Number($('#dp-server').value),
        runtime: view.querySelector('input[name="dp-rt"]:checked')?.value || 'node', domain: $('#dp-domain').value || null,
        port: $('#dp-port').value ? Number($('#dp-port').value) : null, healthPath: $('#dp-health').value || '/',
        startCommand: $('#dp-start').value || null, env: $('#dp-env').value, ssl: $('#dp-ssl').checked, sslEmail: $('#dp-email').value || null,
      } });
      await api(`/api/deploys/${tg.id}/release`, { method: 'POST', body: {} });
      toast(t('Release started'));
      location.hash = `#/deploys/${tg.id}`;
    } catch (err) { toast(err.message, true); }
  });
  wireActs(view, api, toast, renderDeploys);
}

export async function renderDeployTarget(id) {
  const gen = navGeneration;
  const tg = await api(`/api/deploys/${id}`);
  const canM = hasPermC('deploys.manage');
  document.getElementById('page-title').textContent = tg.name;
  const running = tg.releases.find((r) => r.state === 'running');
  view.innerHTML = `
  <div class="pg-head">
    <div class="inline">${dot(tg.state)} <b>${esc(t(tg.state))}</b>
      <a class="chip" href="#/forge/${esc(tg.project?.slug || '')}">${esc(tg.project?.name || '')}</a> →
      <a class="chip" href="#/servers/${tg.server?.id}">${esc(tg.server?.name || '')} · ${esc(t(tg.server?.environment || ''))}</a>
      <span class="chip">${esc(tg.runtime)}</span>
      ${tg.url ? `<a class="chip chip-ember ltr" href="${esc(tg.url)}" target="_blank" rel="noopener">${esc(tg.url)} ↗</a>` : ''}
    </div>
    <div class="pg-actions">${canM ? `${act(`/api/deploys/${tg.id}/rollback`, 'Roll back', { cls: 'btn-sm', confirm: 'Switch back to the previous release?', done: 'Rolled back' })}${act(`/api/deploys/${tg.id}/release`, 'Deploy now', { cls: 'btn-sm btn-primary', done: 'Release started' })}` : ''}</div>
  </div>
  <div class="split2">
    <div class="stack">
      <div class="panel"><div class="panel-title">${esc(t('Release log'))} <span id="dt-which" class="muted" style="text-transform:none;letter-spacing:0"></span></div><pre class="term" id="dt-log" data-keep-scroll style="max-height:520px">${esc(t('Choose a release.'))}</pre></div>
      <div class="panel"><div class="panel-title">${esc(t('Releases'))}</div>
        <table><thead><tr><th>${esc(t('Version'))}</th><th>${esc(t('State'))}</th><th>${esc(t('Commit'))}</th><th>${esc(t('By'))}</th><th class="num">${esc(t('Took'))}</th></tr></thead><tbody>
        ${tg.releases.map((r) => `<tr class="rowlink" data-rel="${r.id}"><td class="mono">${esc(r.version)}${r.kind === 'rollback' ? ` <span class="chip">${esc(t('rollback'))}</span>` : ''}</td><td>${stateTag(r.state)}</td><td class="mono">${esc(r.commit_sha || '—')}</td><td>${esc(String(r.requested_by).replace(/^\w+:/, ''))}</td><td class="num">${dur(r.duration_ms)}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">${esc(t('No releases yet.'))}</td></tr>`}
        </tbody></table></div>
    </div>
    <div class="stack">
      <div class="panel"><div class="panel-title">${esc(t('What runs on the server'))}</div>
        <dl class="kv"><dt>${esc(t('Folder'))}</dt><dd class="ltr">${esc(tg.remote_dir)}</dd><dt>${esc(t('Service'))}</dt><dd class="ltr">${esc(tg.plan.service)}</dd>
        ${tg.port ? `<dt>${esc(t('Port'))}</dt><dd>${tg.port}</dd>` : ''}<dt>${esc(t('Health check'))}</dt><dd class="ltr">${esc(tg.health_path)}</dd>
        <dt>${esc(t('Environment'))}</dt><dd>${tg.envKeys.length ? tg.envKeys.map((k) => `<span class="chip mono">${esc(k)}</span>`).join(' ') : '—'}</dd><dt>HTTPS</dt><dd>${tg.ssl ? esc(t('yes')) : esc(t('no'))}</dd></dl>
        <details style="margin-top:12px"><summary>${esc(t('The release script'))}</summary><pre class="term">${esc(tg.plan.script)}</pre></details>
        ${tg.plan.unit ? `<details><summary>systemd</summary><pre class="term">${esc(tg.plan.unit)}</pre></details>` : ''}
        ${tg.plan.nginx ? `<details><summary>nginx</summary><pre class="term">${esc(tg.plan.nginx)}</pre></details>` : ''}
      </div>
      ${canM ? `<form class="panel" id="dt-form"><div class="panel-title">${esc(t('Change'))}</div>
        <div class="fields">
          <div><label class="fl" for="dt-domain">${esc(t('Domain'))}</label><input id="dt-domain" class="ltr" value="${esc(tg.domain || '')}"></div>
          <div><label class="fl" for="dt-port">${esc(t('Port'))}</label><input id="dt-port" class="ltr" value="${esc(tg.port || '')}"></div>
          <div class="wide"><label class="fl" for="dt-env">${esc(t('Replace environment variables'))}</label><textarea id="dt-env" rows="3" class="ltr mono" placeholder="${esc(t('Leave empty to keep the current ones'))}"></textarea></div>
        </div>
        <div class="inline" style="margin-top:12px"><button class="btn" type="submit">${esc(t('Save'))}</button><span class="grow"></span>${act(`/api/deploys/${tg.id}/remove`, 'Remove', { cls: 'btn-sm btn-bad', confirm: 'Remove this deployment from AlphaCore? The server is not touched.' })}</div>
      </form>` : ''}
    </div>
  </div>`;
  const showRel = async (rid) => {
    const r = await api(`/api/deploys/releases/${rid}`);
    if (gen !== navGeneration) return;
    $('#dt-which').textContent = `${r.version} · ${t(r.state)}`;
    const log = $('#dt-log');
    log.textContent = r.log || '…';
    log.scrollTop = log.scrollHeight;
    if (r.state === 'running') setTimeout(() => showRel(rid), 1500);
    else if (running && running.id === r.id) renderDeployTarget(id);
  };
  view.querySelectorAll('[data-rel]').forEach((tr) => tr.addEventListener('click', () => showRel(tr.dataset.rel)));
  if (tg.releases[0]) showRel(tg.releases[0].id);
  $('#dt-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { domain: $('#dt-domain').value || undefined, port: $('#dt-port').value || undefined };
    if ($('#dt-env').value.trim()) body.env = $('#dt-env').value;
    try { await api(`/api/deploys/${tg.id}/update`, { method: 'POST', body }); toast(t('Saved — deploy to apply')); renderDeployTarget(id); }
    catch (err) { toast(err.message, true); }
  });
  // After an action the target may be gone (removed): then the list is the page.
  wireActs(view, api, toast, async () => {
    if (gen !== navGeneration) return;
    try { await api(`/api/deploys/${id}`); renderDeployTarget(id); } catch { location.hash = '#/deploys'; }
  });
}

// ============================================================ monitoring ==

export async function renderMonitors() {
  const [{ overview: o, checks }, fleet] = await Promise.all([api('/api/monitors'), api('/api/servers').catch(() => ({ servers: [] }))]);
  const canM = hasPermC('monitors.manage');
  const showNew = hashParam('new') === '1';
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Is it up, is it fast, is it about to run out of something. Two failures in a row mark a check down, notify you and open an incident with a person in command; recovery is noted on the same incident. Every site you deploy is watched automatically.'))}</p>
    <div class="pg-actions">${canM ? `<button class="btn btn-primary" type="button" id="mn-toggle">＋ ${esc(t('Watch something'))}</button>` : ''}</div>
  </div>
  <div class="kpis">
    ${kpi('Checks', o.total)}
    ${kpi('Up', o.up, '', o.up ? 'ok' : '')}
    ${kpi('Down', o.down, '', o.down ? 'bad' : '')}
    ${kpi('Degraded', o.degraded, '', o.degraded ? 'human' : '')}
    ${kpi('Uptime, 24 hours', o.uptime24 == null ? '—' : `${o.uptime24}%`, o.certsExpiring.length ? `${o.certsExpiring.length} ${esc(t('certificate(s) expiring'))}` : esc(t('certificates fine')), o.certsExpiring.length ? 'human' : '')}
  </div>
  ${canM ? `<form class="panel" id="mn-form" ${showNew || !checks.length ? '' : 'hidden'}>
    <div class="panel-title">${esc(t('Watch something'))}</div>
    <div class="fields">
      <div><label class="fl" for="mn-kind">${esc(t('What'))}</label><select id="mn-kind"><option value="http">${esc(t('A website or URL'))}</option><option value="tcp">${esc(t('A port (database, mail…)'))}</option>${fleet.servers.length ? `<option value="server">${esc(t('A server in the fleet'))}</option>` : ''}</select></div>
      <div class="mn-t"><label class="fl" for="mn-target">${esc(t('Address'))}</label><input id="mn-target" class="ltr" placeholder="https://example.com"></div>
      <div class="mn-s" hidden><label class="fl" for="mn-server">${esc(t('Server'))}</label><select id="mn-server">${fleet.servers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="mn-name">${esc(t('Name'))}</label><input id="mn-name" placeholder="${esc(t('e.g. Shop home page'))}"></div>
      <div><label class="fl" for="mn-interval">${esc(t('Every'))}</label><select id="mn-interval"><option value="30">30 s</option><option value="60" selected>1 min</option><option value="300">5 min</option><option value="900">15 min</option></select></div>
      <div class="mn-t"><label class="fl" for="mn-text">${esc(t('Must contain (optional)'))}</label><input id="mn-text"></div>
    </div>
    <div class="inline" style="margin-top:14px"><button class="btn btn-primary" type="submit">${esc(t('Start watching'))}</button></div>
  </form>` : ''}
  ${checks.length ? `<div class="panel"><div class="rows">${checks.map((c) => `
    <div class="row" style="flex-wrap:wrap">
      ${dot(c.state)}
      <div class="row-main" style="min-width:200px">
        <div class="row-title">${esc(c.name)} ${c.certDays != null && c.certDays < 21 ? `<span class="chip chip-warn">${esc(t('certificate'))} ${c.certDays}d</span>` : ''}</div>
        <div class="row-meta ltr" style="text-align:start">${esc(c.kind === 'server' ? `server #${c.target}` : c.target)}${c.last_error ? ` · <span style="color:var(--sx-bad)">${esc(c.last_error)}</span>` : ''}</div>
      </div>
      <div style="width:min(260px,100%)">${strip(c.strip)}</div>
      <div class="row-side" style="min-width:170px;justify-content:flex-end">
        <span class="muted" style="font-size:12px">${c.day.uptime == null ? '—' : `${c.day.uptime}%`} · p95 ${c.day.p95 == null ? '—' : `${c.day.p95} ms`}</span>
        ${canM ? `${act(`/api/monitors/${c.id}/run`, 'Check now', { cls: 'btn-sm' })}${act(`/api/monitors/${c.id}/update`, c.enabled ? 'Pause' : 'Resume', { body: { enabled: !c.enabled }, cls: 'btn-sm' })}${act(`/api/monitors/${c.id}/remove`, '✕', { cls: 'btn-sm btn-ghost', confirm: 'Stop watching this?' })}` : ''}
      </div>
    </div>`).join('')}</div></div>` : ''}`;
  const syncKind = () => {
    const k = $('#mn-kind')?.value;
    view.querySelectorAll('.mn-t').forEach((el) => { el.hidden = k === 'server'; });
    view.querySelectorAll('.mn-s').forEach((el) => { el.hidden = k !== 'server'; });
    if ($('#mn-target')) $('#mn-target').placeholder = k === 'tcp' ? 'db.example.com:5432' : 'https://example.com';
  };
  $('#mn-kind')?.addEventListener('change', syncKind);
  $('#mn-toggle')?.addEventListener('click', () => { const f = $('#mn-form'); f.hidden = !f.hidden; });
  $('#mn-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = $('#mn-kind').value;
    try {
      const c = await api('/api/monitors', { method: 'POST', body: { kind, target: kind === 'server' ? $('#mn-server').value : $('#mn-target').value, name: $('#mn-name').value || null, intervalS: Number($('#mn-interval').value), expectText: $('#mn-text')?.value || null } });
      api(`/api/monitors/${c.id}/run`, { method: 'POST', body: {} }).catch(() => {});
      toast(t('Watching'));
      location.hash = '#/monitors';
      renderMonitors();
    } catch (err) { toast(err.message, true); }
  });
  wireActs(view, api, toast, renderMonitors);
}
