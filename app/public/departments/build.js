// Build — the software factory, one project's workspace, and the website builder.
import { $, esc, toast, view } from '../core/dom.js';
import { api, downloadFile } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { navGeneration } from '../core/shell.js';
import { t } from '/i18n.js';
import { kpi, stateTag, who, ago, bytes, dur, emptyCta, tabs, glyph, GLYPH, hashParam, wireActs, act } from '../components/ui.js';

const KIND_GLYPH = { website: GLYPH.site, 'static-site': GLYPH.site };
const tabKey = (slug) => `alphacore-forge-tab-${slug}`;
const remember = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* fine */ } };
const recall = (k, d) => { try { return sessionStorage.getItem(k) || d; } catch { return d; } };

// ============================================================ the factory ==

export async function renderForge() {
  const { overview: o, projects } = await api('/api/forge');
  const canM = hasPermC('forge.manage');
  const showNew = hashParam('new') === '1' || (!projects.length && canM);
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Real code in real repositories. Write it yourself, or describe what you want and an AI engineer proposes the change — you read it and apply it. Run tests, preview it, then ship it to a server.'))}</p>
    <div class="pg-actions">${canM ? `<button class="btn btn-primary" id="fg-new-toggle" type="button">＋ ${esc(t('New software project'))}</button>` : ''}</div>
  </div>
  <div class="kpis">
    ${kpi('Projects', o.projects, '', '')}
    ${kpi('Changes to review', o.proposed, esc(t('proposed by engineers')), o.proposed ? 'human' : '')}
    ${kpi('Engineers working', o.drafting, esc(t('change sets being written')), o.drafting ? 'ai' : '')}
    ${kpi('Commands today', o.commandsToday, o.failingToday ? `${o.failingToday} ${esc(t('failed'))}` : esc(t('none failed')), o.failingToday ? 'bad' : '')}
    ${kpi('Previews running', o.previews, esc(t(o.git ? 'git is available' : 'git is not installed — history is off')), '')}
  </div>
  ${canM ? `<form class="panel" id="fg-new" ${showNew ? '' : 'hidden'}>
    <div class="panel-title">${esc(t('Start a project'))}</div>
    <div class="fields">
      <div><label class="fl" for="fg-name">${esc(t('Name'))}</label><input id="fg-name" required placeholder="${esc(t('e.g. Booking API'))}"></div>
      <div class="wide"><label class="fl" for="fg-desc">${esc(t('What is it for?'))}</label><input id="fg-desc" placeholder="${esc(t('One sentence — the engineer reads it on every change'))}"></div>
      <div class="wide"><span class="fl">${esc(t('Start from'))}</span>
        <div class="seg">${o.kinds.filter((k) => k.id !== 'website').map((k, i) => `<label><input type="radio" name="fg-kind" value="${esc(k.id)}" ${i === 2 ? 'checked' : ''}><b>${esc(t(k.label))}</b><small>${esc(t(k.hint))}</small></label>`).join('')}</div>
      </div>
      <div class="wide"><label class="fl" for="fg-prompt">${esc(t('What should the first version do? (optional)'))}</label>
        <textarea id="fg-prompt" rows="3" placeholder="${esc(t('e.g. An API for appointments: clients, time slots, bookings and cancellations, with tests.'))}"></textarea>
        <div class="hint">${esc(t('If you write something here, an AI engineer starts on it straight away and proposes the code for you to review.'))}</div>
      </div>
    </div>
    <div class="inline" style="margin-top:14px"><button class="btn btn-primary" type="submit">${esc(t('Create the project'))}</button></div>
  </form>` : ''}
  ${projects.length ? `<div class="cards">${projects.map((p) => `
    <a class="card" href="#/forge/${esc(p.slug)}">
      <div class="card-top">${glyph(KIND_GLYPH[p.kind] || GLYPH.code)}<div class="card-title">${esc(p.name)}</div>${p.pending ? `<span class="chip chip-warn">${p.pending}</span>` : ''}</div>
      <div class="card-meta">${esc(p.description || t(o.kinds.find((k) => k.id === p.kind)?.label || p.kind))}</div>
      <div class="card-foot">
        <span>${p.files} ${esc(t('files'))}${p.preview?.running ? ` · <span style="color:var(--sx-ok)">● ${esc(t('preview running'))}</span>` : ''}</span>
        <span class="mono">${p.lastCommit ? esc(p.lastCommit.sha) : ''}</span>
      </div>
    </a>`).join('')}</div>` : (canM ? '' : emptyCta('No projects yet', 'Somebody with factory access can start one.'))}`;

  $('#fg-new-toggle')?.addEventListener('click', () => { const f = $('#fg-new'); f.hidden = !f.hidden; if (!f.hidden) $('#fg-name').focus(); });
  $('#fg-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      const p = await api('/api/forge', { method: 'POST', body: {
        name: $('#fg-name').value, description: $('#fg-desc').value,
        kind: view.querySelector('input[name="fg-kind"]:checked')?.value || 'node-api', prompt: $('#fg-prompt').value,
      } });
      toast(t(p.firstChange ? 'Project created — an engineer is writing the first version' : 'Project created'));
      if (p.firstChange) remember(tabKey(p.slug), 'ai');
      location.hash = `#/forge/${p.slug}`;
    } catch (err) { toast(err.message, true); if (btn) btn.disabled = false; }
  });
}

// =========================================================== one project ==

let openFile = null;
let liveCommand = null;

export async function renderForgeProject(slug) {
  const gen = navGeneration;
  const p = await api(`/api/forge/${encodeURIComponent(slug)}`);
  const canM = hasPermC('forge.manage');
  const canRun = hasPermC('forge.run');
  const isSite = p.kind === 'website';
  let tab = recall(tabKey(p.slug), isSite ? 'site' : 'code');
  const proposed = p.changes.filter((c) => c.state === 'proposed').length;
  const drafting = p.changes.filter((c) => c.state === 'drafting').length;
  const tabList = [
    ...(isSite ? [['site', 'Website']] : []),
    ['code', 'Code', p.tree.length],
    ['ai', 'AI engineer', proposed || drafting || ''],
    ['terminal', 'Terminal'],
    ['preview', 'Preview'],
    ['history', 'History', p.git.log.length || ''],
    ['settings', 'Settings'],
  ];
  if (!tabList.some(([id]) => id === tab)) tab = tabList[0][0];
  document.getElementById('page-title').textContent = p.name;

  view.innerHTML = `
  <div class="pg-head">
    <div class="inline">
      <span class="chip chip-ember">${esc(t(p.kindLabel))}</span>
      ${p.git.log[0] ? `<span class="chip mono">${esc(p.git.log[0].sha)} · ${esc(p.git.log[0].subject.slice(0, 50))}</span>` : ''}
      ${p.git.status.length ? `<span class="chip chip-warn">${p.git.status.length} ${esc(t('uncommitted'))}</span>` : ''}
      ${p.autopilot ? `<span class="chip chip-ember">${esc(t('autopilot on'))}</span>` : ''}
      ${p.preview.running ? `<span class="chip chip-ok">● ${esc(t('preview running'))}</span>` : ''}
    </div>
    <div class="pg-actions">
      <button class="btn btn-sm" type="button" id="fp-download">⬇ ${esc(t('Download'))}</button>
      ${hasPermC('deploys.manage') ? `<a class="btn btn-sm btn-primary" href="#/deploys?project=${p.id}">🚀 ${esc(t('Deploy'))}</a>` : ''}
    </div>
  </div>
  ${tabs(tabList, tab)}
  <div id="fp-body"></div>`;

  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { remember(tabKey(p.slug), b.dataset.tab); renderForgeProject(slug); }));
  $('#fp-download').addEventListener('click', () => downloadFile(`/api/forge/${p.slug}/download`, `${p.slug}.tar.gz`));
  const body = $('#fp-body');
  const rerender = () => { if (gen === navGeneration) renderForgeProject(slug); };

  if (tab === 'code') return drawCode(body, p, canM, rerender);
  if (tab === 'ai') return drawAi(body, p, canM, canRun, rerender);
  if (tab === 'terminal') return drawTerminal(body, p, canRun, gen);
  if (tab === 'preview') return drawPreview(body, p, canRun, rerender);
  if (tab === 'history') return drawHistory(body, p, canRun, rerender);
  if (tab === 'site') return drawSite(body, p, rerender);
  return drawSettings(body, p, canM, rerender);
}

// ---- code ----
function drawCode(body, p, canM, rerender) {
  if (!openFile || openFile.slug !== p.slug || !p.tree.some((f) => f.path === openFile.path)) {
    const first = p.tree.find((f) => /^(README|index\.html|src\/app|server|app\.py)/i.test(f.path)) || p.tree.find((f) => f.text);
    openFile = first ? { slug: p.slug, path: first.path } : null;
  }
  // Group the tree by directory, so a project reads as a project.
  const dirs = new Map();
  for (const f of p.tree) {
    const d = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    if (!dirs.has(d)) dirs.set(d, []);
    dirs.get(d).push(f);
  }
  const treeHtml = [...dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, files]) =>
    `${d ? `<div class="dir">${esc(d)}/</div>` : ''}${files.map((f) => `<button type="button" data-file="${esc(f.path)}" class="${openFile?.path === f.path ? 'on' : ''}" ${f.text ? '' : 'disabled'}>${esc(f.path.split('/').pop())}</button>`).join('')}`).join('');
  body.innerHTML = `
  <div class="ide">
    <div class="ide-tree" data-keep-scroll>${treeHtml || `<div class="empty">${esc(t('Empty'))}</div>`}
      ${canM ? `<div style="padding:10px 12px"><button class="btn btn-sm" type="button" id="fc-newfile" style="width:100%">＋ ${esc(t('New file'))}</button></div>` : ''}
    </div>
    <div class="ide-main">
      <div class="ide-bar">
        <span class="path" id="fc-path">${esc(openFile?.path || '')}</span>
        <span class="muted" id="fc-state" style="font-size:12px"></span>
        ${canM ? `<button class="btn btn-sm btn-bad" type="button" id="fc-del">${esc(t('Delete'))}</button><button class="btn btn-sm btn-primary" type="button" id="fc-save">${esc(t('Save & commit'))}</button>` : ''}
      </div>
      <div class="ide-edit"><div class="ide-gutter" id="fc-gutter">1</div><textarea id="fc-text" spellcheck="false" aria-label="${esc(t('File contents'))}" ${canM ? '' : 'readonly'}></textarea></div>
    </div>
  </div>`;
  const ta = $('#fc-text');
  const gutter = $('#fc-gutter');
  const paintGutter = () => { const n = ta.value.split('\n').length; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); };
  ta.addEventListener('input', () => { paintGutter(); $('#fc-state').textContent = t('unsaved'); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); paintGutter(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#fc-save')?.click(); }
  });
  const load = async (path) => {
    if (!path) { ta.value = ''; return; }
    const f = await api(`/api/forge/${p.slug}/file?path=${encodeURIComponent(path)}`);
    ta.value = f.binary ? t('(binary file — not shown)') : f.content;
    ta.defaultValue = ta.value;     // so the auto-refresh guard sees it as clean
    $('#fc-path').textContent = path;
    $('#fc-state').textContent = bytes(f.size);
    paintGutter();
  };
  body.querySelectorAll('[data-file]').forEach((b) => b.addEventListener('click', async () => {
    if (ta.value !== ta.defaultValue && !confirm(t('Discard the unsaved changes?'))) return;
    openFile = { slug: p.slug, path: b.dataset.file };
    body.querySelectorAll('[data-file]').forEach((x) => x.classList.toggle('on', x === b));
    await load(openFile.path);
  }));
  load(openFile?.path).catch((e) => toast(e.message, true));
  $('#fc-save')?.addEventListener('click', async () => {
    if (!openFile) return;
    try {
      const r = await api(`/api/forge/${p.slug}/file`, { method: 'POST', body: { path: openFile.path, content: ta.value } });
      ta.defaultValue = ta.value;
      $('#fc-state').textContent = r.commit ? `${t('saved')} · ${r.commit}` : t('saved');
      toast(t('Saved'));
    } catch (e) { toast(e.message, true); }
  });
  $('#fc-newfile')?.addEventListener('click', async () => {
    const path = prompt(t('Path of the new file, e.g. src/routes/users.js'));
    if (!path) return;
    try { await api(`/api/forge/${p.slug}/file`, { method: 'POST', body: { path, content: '' } }); openFile = { slug: p.slug, path }; rerender(); }
    catch (e) { toast(e.message, true); }
  });
  $('#fc-del')?.addEventListener('click', async () => {
    if (!openFile || !confirm(`${t('Delete')} ${openFile.path}?`)) return;
    try { await api(`/api/forge/${p.slug}/file/delete`, { method: 'POST', body: { path: openFile.path } }); openFile = null; rerender(); }
    catch (e) { toast(e.message, true); }
  });
}

// ---- the engineer ----
function drawAi(body, p, canM, canRun, rerender) {
  const changes = p.changes;
  body.innerHTML = `
  <div class="split2">
    <div class="stack">
      ${canM ? `<form class="panel" id="fa-form">
        <div class="panel-title">${esc(t('Ask an engineer for a change'))}</div>
        <textarea id="fa-prompt" rows="5" required placeholder="${esc(t('Describe the change in plain words. e.g. Add login with email and password, store users in a JSON file, and add tests.'))}"></textarea>
        <div class="inline" style="margin-top:10px">
          <select id="fa-agent" style="width:auto" aria-label="${esc(t('Engineer'))}">
            <option value="">${esc(t('Best engineer for this project'))}</option>
            <option value="AGT-ENG-001">${esc(t('Software Engineer'))}</option>
            <option value="AGT-ENG-002">${esc(t('Frontend Engineer'))}</option>
            <option value="AGT-ENG-003">${esc(t('Data Engineer'))}</option>
          </select>
          <button class="btn btn-primary" type="submit">${esc(t('Ask'))}</button>
        </div>
        <div class="hint">${esc(t(p.autopilot ? 'Autopilot is on: the change applies itself when it comes back. Turn it off in Settings to review first.' : 'The engineer reads the repository and returns whole files. Nothing changes until you apply it.'))}</div>
      </form>` : ''}
      ${changes.length ? changes.map((c) => `
        <div class="change ${esc(c.state)}">
          <div class="inline">${who(`agent:${c.agent_id}`)}<b class="grow">${esc(c.prompt.split('\n')[0].slice(0, 120))}</b>${stateTag(c.state)}</div>
          ${c.summary ? `<div style="white-space:pre-wrap">${esc(c.summary)}</div>` : c.state === 'drafting' ? `<div class="muted">${esc(t('The engineer is reading the code and writing…'))}</div>` : ''}
          ${c.files.length ? `<div class="change-files">${c.files.map((f, i) => `<code data-view="${c.id}:${i}" style="cursor:pointer" title="${esc(t('Show'))}">${esc(f.path)} · ${bytes(f.bytes)}</code>`).join('')}${c.deletes.map((d) => `<code style="text-decoration:line-through">${esc(d)}</code>`).join('')}</div>` : ''}
          <pre class="term" id="fv-${c.id}" hidden></pre>
          ${c.gaps.length ? `<div class="callout human"><b>${esc(t('What the engineer says is not done:'))}</b> ${c.gaps.map((g) => esc(String(g))).join(' · ')}</div>` : ''}
          <div class="inline">
            <span class="muted" style="font-size:12px">${esc(ago(c.created_at))}${c.commit_sha ? ` · <span class="mono">${esc(c.commit_sha)}</span>` : ''}${c.decided_by ? ` · ${esc(c.decided_by)}` : ''}</span>
            <span class="grow"></span>
            ${c.state === 'proposed' && canM ? `${act(`/api/forge/changes/${c.id}/reject`, 'Reject', { cls: 'btn-sm btn-bad', done: 'Rejected' })}${act(`/api/forge/changes/${c.id}/apply`, 'Apply & commit', { cls: 'btn-sm btn-human', done: 'Applied' })}` : ''}
            ${c.state === 'applied' && canRun ? c.commands.map((cmd) => `<button class="btn btn-sm" type="button" data-run="${esc(cmd)}">▶ ${esc(cmd)}</button>`).join('') : ''}
          </div>
        </div>`).join('') : emptyCta('No changes yet', 'Describe what you want. The engineer proposes whole files; you read them and apply.')}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('How this works'))}</div>
      <ol style="margin:0;padding-inline-start:18px;display:grid;gap:8px;color:var(--sx-mute)">
        <li>${esc(t('You describe a change in plain words.'))}</li>
        <li>${esc(t('An AI engineer reads the repository and returns complete files — never a guess at a diff.'))}</li>
        <li>${esc(t('You read what it wrote, then apply it. The change is committed with both your names on it.'))}</li>
        <li>${esc(t('Run the tests from the terminal, preview it, and deploy it.'))}</li>
      </ol>
      <div class="callout" style="margin-top:14px">${esc(t('A model that is not connected writes a note instead of code, and says so. Connect a provider in Settings for real engineering.'))}</div>
    </div>
  </div>`;
  $('#fa-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/forge/${p.slug}/ask`, { method: 'POST', body: { prompt: $('#fa-prompt').value, agentId: $('#fa-agent').value || null } });
      toast(t('The engineer is on it'));
      rerender();
    } catch (err) { toast(err.message, true); }
  });
  body.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => {
    const [cid, i] = el.dataset.view.split(':');
    const c = changes.find((x) => String(x.id) === cid);
    const pre = $(`#fv-${cid}`);
    pre.hidden = !pre.hidden || pre.dataset.i !== i ? false : true;
    pre.dataset.i = i;
    pre.textContent = c.files[Number(i)].content;
  }));
  body.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/forge/${p.slug}/run`, { method: 'POST', body: { command: b.dataset.run } }); remember(tabKey(p.slug), 'terminal'); rerender(); }
    catch (e) { toast(e.message, true); }
  }));
  wireActs(body, api, toast, rerender);
  // Keep the page fresh while an engineer is still writing.
  if (changes.some((c) => c.state === 'drafting')) {
    const gen = navGeneration;
    setTimeout(() => { if (gen === navGeneration && !$('#fa-prompt')?.value) rerender(); }, 4000);
  }
}

// ---- terminal ----
function drawTerminal(body, p, canRun, gen) {
  body.innerHTML = `
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Terminal'))}<span class="muted" style="text-transform:none;letter-spacing:0">${esc(t('runs in the project folder on this machine'))}</span></div>
      <div class="term" id="ft-out" data-keep-scroll>${esc(t('Pick a command on the right, or type one below.'))}</div>
      ${canRun ? `<form class="term-line" id="ft-form">
        <input id="ft-cmd" list="ft-scripts" placeholder="npm test" autocomplete="off" aria-label="${esc(t('Command'))}">
        <datalist id="ft-scripts">${p.scripts.map((s) => `<option value="${esc(s)}">`).join('')}<option value="npm install"><option value="git status"><option value="node --version"></datalist>
        <button class="btn btn-primary" type="submit">${esc(t('Run'))}</button>
        <button class="btn btn-bad" type="button" id="ft-kill" hidden>${esc(t('Stop'))}</button>
      </form>
      <div class="inline" style="margin-top:10px">${p.scripts.map((s) => `<button class="btn btn-sm" type="button" data-quick="${esc(s)}">▶ ${esc(s)}</button>`).join('')}</div>` : `<div class="callout">${esc(t('You need the forge.run permission to run commands.'))}</div>`}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Recent commands'))}</div>
      <div class="rows">${p.commands.map((c) => `
        <button class="row" type="button" data-cmd="${c.id}" style="background:none;border:0;border-bottom:1px solid var(--sx-line-soft);text-align:start;cursor:pointer;width:100%;font:inherit;color:inherit">
          ${stateTag(c.state)}<div class="row-main"><div class="row-title mono ltr">${esc(c.command)}</div><div class="row-meta">${esc(ago(c.started_at))} · ${dur(c.duration_ms)} · ${esc(String(c.started_by).replace(/^\w+:/, ''))}</div></div>
        </button>`).join('') || `<div class="empty">${esc(t('Nothing has run here yet.'))}</div>`}</div>
      <div class="hint" style="margin-top:10px">${esc(t('Only build tools run here: node, npm, git, python, docker and the like. Nothing passes through a shell.'))}</div>
    </div>
  </div>`;
  const out = $('#ft-out');
  const show = async (id) => {
    liveCommand = id;
    const tick = async () => {
      if (gen !== navGeneration || liveCommand !== id) return;
      const c = await api(`/api/forge/commands/${id}`).catch(() => null);
      if (!c) return;
      const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 30;
      out.innerHTML = `<span class="t-cmd">$ ${esc(c.command)}</span>\n${esc(c.output || '')}${c.state === 'running' ? '\n▍' : `\n<span class="${c.state === 'ok' ? 't-ok' : 't-bad'}">— ${esc(c.state)} (exit ${c.exit_code ?? '?'}, ${dur(c.duration_ms)})</span>`}`;
      if (atBottom) out.scrollTop = out.scrollHeight;
      const kill = $('#ft-kill');
      if (kill) { kill.hidden = c.state !== 'running'; kill.onclick = () => api(`/api/forge/commands/${id}/kill`, { method: 'POST', body: {} }).catch((e) => toast(e.message, true)); }
      if (c.state === 'running') setTimeout(tick, 800);
    };
    tick();
  };
  const run = async (command) => {
    try { const r = await api(`/api/forge/${p.slug}/run`, { method: 'POST', body: { command } }); show(r.id); }
    catch (e) { toast(e.message, true); }
  };
  $('#ft-form')?.addEventListener('submit', (e) => { e.preventDefault(); const v = $('#ft-cmd').value.trim(); if (v) { run(v); $('#ft-cmd').value = ''; } });
  body.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => run(b.dataset.quick)));
  body.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.cmd))));
  if (p.commands[0]) show(p.commands[0].id);
}

// ---- preview ----
function drawPreview(body, p, canRun, rerender) {
  const pv = p.preview;
  body.innerHTML = `
  <div class="panel">
    <div class="panel-title">${esc(t('Preview'))}
      <span class="inline">
        ${canRun && pv.mode !== 'static' ? (pv.running ? act(`/api/forge/${p.slug}/preview/stop`, 'Stop', { cls: 'btn-sm btn-bad' }) : act(`/api/forge/${p.slug}/preview/start`, 'Start the app', { cls: 'btn-sm btn-primary', done: 'Starting' })) : ''}
        ${pv.mode === 'process' && !pv.running && canRun ? '' : `<a class="btn btn-sm" href="${esc(pv.url)}" target="_blank" rel="noopener">${esc(t('Open in a new tab'))} ↗</a>`}
      </span>
    </div>
    ${pv.mode === 'none' && !pv.running ? `<div class="callout">${esc(t('This project runs as a process. Start it and the preview appears here, served through AlphaCore so it works from anywhere you can reach the console.'))}</div>` : ''}
    ${pv.mode === 'static' || pv.running ? `<iframe class="preview-frame" src="${esc(pv.url)}" title="${esc(t('Preview'))}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>` : ''}
    ${pv.running ? `<div class="panel-title" style="margin-top:14px">${esc(t('Output'))} <span class="mono" style="text-transform:none">${esc(pv.command)} · :${pv.port}</span></div><pre class="term" id="fpv-log" data-keep-scroll>…</pre>` : ''}
  </div>`;
  wireActs(body, api, toast, () => setTimeout(rerender, 900));
  if (pv.running) {
    const gen = navGeneration;
    const tick = async () => {
      if (gen !== navGeneration) return;
      const l = await api(`/api/forge/${p.slug}/preview`).catch(() => null);
      const el = $('#fpv-log');
      if (l && el) { el.textContent = l.log || t('(no output yet)'); setTimeout(tick, 2500); }
    };
    tick();
  }
}

// ---- history ----
function drawHistory(body, p, canRun, rerender) {
  body.innerHTML = `
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Commits'))}</div>
      ${p.git.available ? `<table><thead><tr><th>${esc(t('Commit'))}</th><th>${esc(t('What changed'))}</th><th>${esc(t('When'))}</th></tr></thead><tbody>
        ${p.git.log.map((c) => `<tr><td class="mono">${esc(c.sha)}</td><td>${esc(c.subject)}</td><td class="muted">${esc(ago(c.date))}</td></tr>`).join('')}
      </tbody></table>` : `<div class="callout human">${esc(t('git is not installed on this machine, so the factory cannot keep a history. Install git and restart AlphaCore.'))}</div>`}
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-title">${esc(t('Not yet committed'))}</div>
        ${p.git.status.length ? `<div class="rows">${p.git.status.map((s) => `<div class="row"><span class="chip">${esc(s.code)}</span><span class="mono ltr">${esc(s.path)}</span></div>`).join('')}</div>` : `<div class="empty">${esc(t('Everything is committed.'))}</div>`}
      </div>
      <div class="panel">
        <div class="panel-title">${esc(t('Push to GitHub'))}</div>
        ${p.repo_url ? `<div class="mono ltr" style="margin-bottom:10px">${esc(p.repo_url)}</div>${canRun ? `<button class="btn btn-primary btn-sm" type="button" id="fh-push">${esc(t('Push'))}</button>` : ''}
          <div class="hint">${esc(t('Uses the GITHUB_TOKEN in the vault if there is one. The token is never written into the command record.'))}</div>`
        : `<div class="muted">${esc(t('Set the repository URL in Settings to push this project to GitHub.'))}</div>`}
      </div>
    </div>
  </div>`;
  $('#fh-push')?.addEventListener('click', async () => {
    try { await api(`/api/forge/${p.slug}/push`, { method: 'POST', body: {} }); remember(tabKey(p.slug), 'terminal'); rerender(); }
    catch (e) { toast(e.message, true); }
  });
}

// ---- settings ----
function drawSettings(body, p, canM, rerender) {
  body.innerHTML = `
  <form class="panel" id="fs-form">
    <div class="panel-title">${esc(t('Project settings'))}</div>
    <div class="fields">
      <div><label class="fl" for="fs-name">${esc(t('Name'))}</label><input id="fs-name" value="${esc(p.name)}" ${canM ? '' : 'disabled'}></div>
      <div><label class="fl" for="fs-repo">${esc(t('Repository URL'))}</label><input id="fs-repo" value="${esc(p.repo_url || '')}" placeholder="https://github.com/org/repo.git" ${canM ? '' : 'disabled'}></div>
      <div class="wide"><label class="fl" for="fs-desc">${esc(t('What is it for?'))}</label><input id="fs-desc" value="${esc(p.description || '')}" ${canM ? '' : 'disabled'}></div>
      <div class="wide"><label class="inline" style="font-weight:600"><input type="checkbox" id="fs-auto" ${p.autopilot ? 'checked' : ''} ${canM ? '' : 'disabled'} style="width:auto;min-height:0"> ${esc(t('Autopilot: apply AI changes without waiting for review'))}</label>
        <div class="hint">${esc(t('Every applied change is still committed and recorded. Only a person can switch this on.'))}</div></div>
    </div>
    ${canM ? `<div class="inline" style="margin-top:14px"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button><span class="grow"></span><button class="btn btn-bad" type="button" id="fs-archive">${esc(t('Archive the project'))}</button></div>` : ''}
  </form>
  <div class="panel"><div class="panel-title">${esc(t('Where it lives'))}</div>
    <dl class="kv"><dt>${esc(t('Folder'))}</dt><dd class="ltr">workspace/_apps/${esc(p.slug)}</dd><dt>${esc(t('Created by'))}</dt><dd>${esc(p.created_by)} · ${esc(ago(p.created_at))}</dd></dl>
  </div>`;
  $('#fs-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/forge/${p.slug}/settings`, { method: 'POST', body: { name: $('#fs-name').value, description: $('#fs-desc').value, repoUrl: $('#fs-repo').value, autopilot: $('#fs-auto').checked } });
      toast(t('Saved')); rerender();
    } catch (err) { toast(err.message, true); }
  });
  $('#fs-archive')?.addEventListener('click', async () => {
    if (!confirm(t('Archive this project? Its files stay on disk.'))) return;
    try { await api(`/api/forge/${p.slug}/settings`, { method: 'POST', body: { archived: true } }); location.hash = '#/forge'; }
    catch (err) { toast(err.message, true); }
  });
}

// ======================================================== the website =====

function briefForm(o, b = {}, { submitLabel = 'Generate the website' } = {}) {
  const c = b.contact || {};
  const secs = b.sections || o.sections;
  const SEC_LABEL = { services: 'Services', about: 'About', process: 'How it works', testimonials: 'Client quotes', faq: 'Questions', contact: 'Contact form' };
  return `
    <div class="fields">
      <div><label class="fl" for="sb-business">${esc(t('Business name'))}</label><input id="sb-business" required value="${esc(b.business || '')}" placeholder="${esc(t('e.g. Al-Rayan Bakery'))}"></div>
      <div><label class="fl" for="sb-lang">${esc(t('Language'))}</label><select id="sb-lang"><option value="en" ${b.language === 'ar' ? '' : 'selected'}>English</option><option value="ar" ${b.language === 'ar' ? 'selected' : ''}>العربية</option></select></div>
      <div class="wide"><label class="fl" for="sb-what">${esc(t('What do you do, and for whom?'))}</label><input id="sb-what" value="${esc(b.what || '')}" placeholder="${esc(t('e.g. Fresh bread and pastries every morning for homes and cafés in Baghdad'))}"></div>
      <div class="wide"><label class="fl" for="sb-services">${esc(t('Services or products — one per line'))}</label><textarea id="sb-services" rows="3">${esc((b.services || []).map((s) => s.title).join('\n'))}</textarea></div>
      <div class="wide"><span class="fl">${esc(t('Style'))}</span>
        <div class="seg">${o.styles.map((s) => `<label><input type="radio" name="sb-style" value="${esc(s.id)}" ${(b.style || 'clinic') === s.id ? 'checked' : ''}>
          <span class="swatch"><i style="background:${esc(s.bg)}"></i><i style="background:${esc(s.accent)}"></i><i style="background:${esc(s.ink)}"></i></span>
          <b>${esc(t(s.label))}</b><small>${esc(t(s.hint))}</small></label>`).join('')}</div>
      </div>
      <div class="wide"><span class="fl">${esc(t('Sections'))}</span>
        <div class="inline">${o.sections.map((s) => `<label class="chip" style="cursor:pointer"><input type="checkbox" name="sb-sec" value="${s}" ${secs.includes(s) ? 'checked' : ''} style="width:auto;min-height:0"> ${esc(t(SEC_LABEL[s] || s))}</label>`).join('')}</div>
      </div>
      <div><label class="fl" for="sb-phone">${esc(t('Phone'))}</label><input id="sb-phone" type="tel" value="${esc(c.phone || '')}" class="ltr"></div>
      <div><label class="fl" for="sb-wa">${esc(t('WhatsApp number'))}</label><input id="sb-wa" type="tel" value="${esc(c.whatsapp || '')}" class="ltr"></div>
      <div><label class="fl" for="sb-email">${esc(t('Email'))}</label><input id="sb-email" type="email" value="${esc(c.email || '')}" class="ltr"></div>
      <div><label class="fl" for="sb-hours">${esc(t('Opening hours'))}</label><input id="sb-hours" value="${esc(c.hours || '')}"></div>
      <div class="wide"><label class="fl" for="sb-address">${esc(t('Address'))}</label><input id="sb-address" value="${esc(c.address || '')}"></div>
      <div><label class="fl" for="sb-domain">${esc(t('Domain (optional)'))}</label><input id="sb-domain" value="${esc(b.domain || '')}" placeholder="example.com" class="ltr"></div>
    </div>
    <div class="inline" style="margin-top:14px"><button class="btn btn-primary" type="submit">${esc(t(submitLabel))}</button></div>`;
}
const readBrief = () => ({
  business: $('#sb-business').value, language: $('#sb-lang').value, what: $('#sb-what').value,
  services: $('#sb-services').value, style: view.querySelector('input[name="sb-style"]:checked')?.value,
  sections: [...view.querySelectorAll('input[name="sb-sec"]:checked')].map((x) => x.value),
  contact: { phone: $('#sb-phone').value, whatsapp: $('#sb-wa').value, email: $('#sb-email').value, hours: $('#sb-hours').value, address: $('#sb-address').value },
  domain: $('#sb-domain').value,
});

export async function renderSites() {
  const { overview: o, sites } = await api('/api/sites');
  const canM = hasPermC('sites.manage');
  const showNew = hashParam('new') === '1' || (!sites.length && canM);
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('A complete business website from a few answers — responsive, fast, in English or Arabic, with no model required. Then let a copywriter polish the words, ask an engineer for changes, and publish it to your server with HTTPS.'))}</p>
    <div class="pg-actions">${canM ? `<button class="btn btn-primary" type="button" id="sb-toggle">＋ ${esc(t('Build a website'))}</button>` : ''}</div>
  </div>
  ${canM ? `<form class="panel" id="sb-form" ${showNew ? '' : 'hidden'}><div class="panel-title">${esc(t('Tell us about the business'))}</div>${briefForm(o)}</form>` : ''}
  ${sites.length ? `<div class="cards">${sites.map((s) => {
    const st = o.styles.find((x) => x.id === s.meta?.brief?.style) || o.styles[0];
    return `<a class="card" href="#/forge/${esc(s.slug)}">
      <div class="swatch" style="height:64px;border-radius:10px"><i style="background:${esc(st.bg)}"></i><i style="background:${esc(st.accent)};flex:.5"></i><i style="background:${esc(st.ink)};flex:.3"></i></div>
      <div class="card-top"><div class="card-title">${esc(s.name)}</div><span class="chip">${esc(s.meta?.brief?.language === 'ar' ? 'العربية' : 'English')}</span></div>
      <div class="card-meta">${esc(s.description || '')}</div>
      <div class="card-foot"><span>${esc(t(st.label))}</span><span>${s.copyRuns ? esc(t('copywriter working…')) : esc(ago(s.updated_at))}</span></div>
    </a>`;
  }).join('')}</div>` : (canM ? '' : emptyCta('No websites yet', 'Somebody with website access can build one.'))}`;
  $('#sb-toggle')?.addEventListener('click', () => { const f = $('#sb-form'); f.hidden = !f.hidden; });
  $('#sb-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const p = await api('/api/sites', { method: 'POST', body: { brief: readBrief() } });
      toast(t('Website generated'));
      remember(tabKey(p.slug), 'site');
      location.hash = `#/forge/${p.slug}`;
    } catch (err) { toast(err.message, true); }
  });
}

/** The website tab inside a builder project: the brief, regenerate, copy, publish. */
async function drawSite(body, p, rerender) {
  const { overview: o } = await api('/api/sites');
  const canM = hasPermC('sites.manage');
  const b = p.meta?.brief || {};
  body.innerHTML = `
  <div class="split2">
    <div class="panel" style="padding:12px">
      <iframe class="preview-frame" style="height:640px" src="${esc(p.preview.url)}" title="${esc(t('Preview'))}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>
      <div class="inline" style="margin-top:10px"><a class="btn btn-sm" href="${esc(p.preview.url)}" target="_blank" rel="noopener">${esc(t('Open in a new tab'))} ↗</a>
        <span class="grow"></span>${hasPermC('deploys.manage') ? `<a class="btn btn-sm btn-primary" href="#/deploys?project=${p.id}&runtime=static">🚀 ${esc(t('Publish to a server'))}</a>` : ''}</div>
    </div>
    <div class="stack">
      ${canM ? `<div class="panel">
        <div class="panel-title">${esc(t('Words'))}</div>
        <p class="muted" style="margin:0 0 10px">${esc(t('A copywriter rewrites every heading and paragraph for this business. The result regenerates the site; the history keeps the old version.'))}</p>
        <form id="sc-form" class="inline"><input id="sc-notes" class="grow" placeholder="${esc(t('Anything to stress? e.g. family-run since 1998'))}"><button class="btn btn-primary btn-sm" type="submit">${esc(t('Let AI write the copy'))}</button></form>
      </div>
      <div class="panel">
        <div class="panel-title">${esc(t('Changes in plain words'))}</div>
        <form id="sx-form" class="inline"><input id="sx-ask" class="grow" placeholder="${esc(t('e.g. Add a price list with three packages'))}"><button class="btn btn-sm" type="submit">${esc(t('Ask an engineer'))}</button></form>
        <div class="hint">${esc(t('Proposals appear under the AI engineer tab for you to apply.'))}</div>
      </div>
      <form class="panel" id="sb-form"><div class="panel-title">${esc(t('The brief'))}</div>${briefForm(o, b, { submitLabel: 'Regenerate the website' })}</form>` : ''}
    </div>
  </div>`;
  $('#sb-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm(t('Regenerating rewrites the generated files. Changes made by hand or by an engineer to those files will be replaced (they stay in the history). Continue?'))) return;
    try { await api(`/api/sites/${p.id}/regenerate`, { method: 'POST', body: { brief: readBrief() } }); toast(t('Regenerated')); rerender(); }
    catch (err) { toast(err.message, true); }
  });
  $('#sc-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/sites/${p.id}/copy`, { method: 'POST', body: { notes: $('#sc-notes').value } }); toast(t('The copywriter is writing')); $('#sc-notes').value = ''; }
    catch (err) { toast(err.message, true); }
  });
  $('#sx-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#sx-ask').value.trim();
    if (!v) return;
    try { await api(`/api/forge/${p.slug}/ask`, { method: 'POST', body: { prompt: v, agentId: 'AGT-ENG-002' } }); toast(t('The engineer is on it')); remember(tabKey(p.slug), 'ai'); rerender(); }
    catch (err) { toast(err.message, true); }
  });
}
