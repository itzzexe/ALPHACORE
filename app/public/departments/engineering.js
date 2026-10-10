// The engineering floor around the factory: the review board, the GitHub hub,
// the app builder and the numbers.
//
// Every page here reads one route and draws it; every button posts to a route
// that writes the chain. Colour follows the switchboard: indigo when a machine
// is doing something, amber when a person must, green and red for the result.
import { $, esc, toast, view } from '../core/dom.js';
import { api, downloadFile } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { navGeneration } from '../core/shell.js';
import { t } from '/i18n.js';
import { kpi, stateTag, who, ago, emptyCta, hashParam, bar } from '../components/ui.js';

const SEV = ['critical', 'high', 'medium', 'low', 'info'];
const DIM_LABEL = { security: 'Security', tests: 'Tests', quality: 'Quality', performance: 'Performance', accessibility: 'Accessibility', dependencies: 'Dependencies' };
const verdictChip = (v, score = null) => {
  if (!v) return `<span class="chip">${esc(t('running'))}</span>`;
  const cls = v === 'fail' ? 'chip-bad' : v === 'warn' ? 'chip-warn' : 'chip-ok';
  return `<span class="chip ${cls}">${esc(t(v.toUpperCase()))}${score !== null && score !== undefined ? ` · ${score}` : ''}</span>`;
};
const sevBadge = (s) => `<span class="eng-sev sev-${esc(s)}">${esc(t(s))}</span>`;
const gateChip = (g) => {
  if (!g) return '';
  const cls = g.state === 'fail' ? 'chip-bad' : g.state === 'warn' ? 'chip-warn' : g.state === 'pass' ? 'chip-ok' : '';
  return `<span class="chip ${cls}" title="${esc(g.why || '')}">${esc(t(g.state === 'none' ? 'not reviewed' : g.state.toUpperCase()))}</span>`;
};

// ========================================================== review board ==

export async function renderReviews() {
  const [{ overview: o, reviews }, forge] = await Promise.all([api('/api/reviews'), api('/api/forge').catch(() => ({ projects: [] }))]);
  const canRun = hasPermC('reviews.run');
  const pre = hashParam('project');
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Every project read along six dimensions. A deterministic scanner goes first — secrets, dangerous calls, missing tests, unpinned dependencies, images without alt text — then one reviewer per dimension, on a different model family from the engineers, reads what a pattern cannot. Reviewers only find; fixing is a change set a person applies.'))}</p>
  </div>
  <div class="kpis">
    ${kpi('Open findings', o.open, '', o.open ? 'human' : 'ok')}
    ${kpi('Critical', o.critical, esc(t('block a release when the gate is enforced')), o.critical ? 'bad' : '')}
    ${kpi('High', o.high, '', o.high ? 'human' : '')}
    ${kpi('Fixed', o.fixed, `${o.dismissed} ${esc(t('dismissed with a reason'))}`, 'ok')}
    ${kpi('Reviews running', o.running, `${o.reviews} ${esc(t('in total'))}`, o.running ? 'ai' : '')}
  </div>
  <div class="split2">
    <div class="stack">
      ${canRun ? `<form class="panel" id="rv-new">
        <div class="panel-title">${esc(t('Review a project'))}</div>
        <div class="fields">
          <div><label class="fl" for="rv-project">${esc(t('Project'))}</label>
            <select id="rv-project" required>${forge.projects.map((p) => `<option value="${esc(p.slug)}" ${pre === p.slug ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="wide"><span class="fl">${esc(t('Dimensions'))}</span>
            <div class="inline">${o.dimensions.map((d) => `<label class="eng-chk"><input type="checkbox" name="rv-dim" value="${esc(d)}" checked> ${esc(t(DIM_LABEL[d] || d))}</label>`).join('')}</div></div>
          <div class="wide inline">
            <label class="eng-chk"><input type="checkbox" id="rv-tests" ${hasPermC('forge.run') ? 'checked' : 'disabled'}> ${esc(t('Run the test suite too'))}</label>
            <label class="eng-chk"><input type="checkbox" id="rv-agents" checked> ${esc(t('Ask the AI reviewers (not only the scanner)'))}</label>
          </div>
        </div>
        <div class="inline" style="margin-top:12px"><button class="btn btn-primary" type="submit" ${forge.projects.length ? '' : 'disabled'}>${esc(t('Start the review'))}</button>
          ${forge.projects.length ? '' : `<span class="hint">${esc(t('There is no project to review yet.'))}</span>`}</div>
      </form>` : ''}
      <div class="panel">
        <div class="panel-title">${esc(t('Reviews'))}</div>
        <div class="rows">${reviews.map((r) => `
          <a class="row" href="#/reviews/${r.id}">
            ${r.state === 'running' ? stateTag('running') : verdictChip(r.verdict, r.score)}
            <div class="row-main"><div class="row-title">${esc(r.title)}</div>
              <div class="row-meta">${esc(t(r.subject === 'pr' ? 'pull request' : 'project'))} · ${r.dimensions.map((d) => esc(t(DIM_LABEL[d] || d))).join(', ')} · ${esc(ago(r.created_at))} · ${esc(String(r.created_by).replace(/^\w+:/, ''))}</div></div>
            <div class="row-side">${r.critical ? `<span class="chip chip-bad">${r.critical} ${esc(t('critical'))}</span>` : ''}${r.open ? `<span class="chip">${r.open} ${esc(t('open'))}</span>` : ''}</div>
          </a>`).join('') || `<div class="empty">${esc(t('Nothing reviewed yet.'))}</div>`}</div>
      </div>
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-title">${esc(t('Open findings by dimension'))}</div>
        ${o.dimensions.map((d) => bar(t(DIM_LABEL[d] || d), o.open ? Math.round((o.byDimension[d] / o.open) * 100) : 0, { warn: 101, bad: 101, suffix: `% · ${o.byDimension[d]}` })).join('')}
      </div>
      <div class="panel">
        <div class="panel-title">${esc(t('The reviewers'))}</div>
        <div class="rows">${o.reviewers.map((r) => `<div class="row">${who(`agent:${r.agent}`)}<div class="row-main"><div class="row-title">${esc(t(r.label))}</div><div class="row-meta">${esc(t(DIM_LABEL[r.dimension]))}</div></div></div>`).join('')}
          <div class="row"><span class="chip">⚙</span><div class="row-main"><div class="row-title">${esc(t('The scanner'))}</div><div class="row-meta">${esc(t('Deterministic rules for every dimension, and the only reviewer of dependencies'))}</div></div></div></div>
      </div>
      <div class="panel">
        <div class="panel-title">${esc(t('Quality gate'))}</div>
        <p class="muted" style="margin:0 0 10px">${esc(t('Whether a production release waits for a clean review. Off: never asked. Warn: the verdict is written on the release. Enforce: an open critical finding or failing tests stop the release.'))}</p>
        <div class="seg" role="radiogroup" aria-label="${esc(t('Quality gate'))}">${['off', 'warn', 'enforce'].map((m) => `<label><input type="radio" name="rv-gate" value="${m}" ${o.gateMode === m ? 'checked' : ''} ${hasPermC('settings.manage') ? '' : 'disabled'}><b>${esc(t(m === 'off' ? 'Off' : m === 'warn' ? 'Warn' : 'Enforce'))}</b></label>`).join('')}</div>
        ${hasPermC('settings.manage') ? '' : `<div class="hint">${esc(t('Changing it needs settings.manage.'))}</div>`}
      </div>
    </div>
  </div>`;
  $('#rv-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dims = [...view.querySelectorAll('input[name="rv-dim"]:checked')].map((x) => x.value);
    try {
      const r = await api('/api/reviews', { method: 'POST', body: { project: $('#rv-project').value, dimensions: dims, runTests: $('#rv-tests').checked, agents: $('#rv-agents').checked } });
      toast(t('The review board is reading it'));
      location.hash = `#/reviews/${r.id}`;
    } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('input[name="rv-gate"]').forEach((r) => r.addEventListener('change', async () => {
    try { await api('/api/settings', { method: 'POST', body: { key: 'ENG_QUALITY_GATE', value: r.value } }); toast(t('Saved')); }
    catch (err) { toast(err.message, true); }
  }));
}

let reviewFilter = { severity: null, dimension: null, state: 'open' };

export async function renderReview(id) {
  const r = await api(`/api/reviews/${encodeURIComponent(id)}`);
  const canDecide = hasPermC('reviews.decide');
  const canPost = hasPermC('github.post');
  document.getElementById('page-title').textContent = `${t('Review')} #${r.id}`;
  const list = r.findings.filter((f) => (!reviewFilter.severity || f.severity === reviewFilter.severity)
    && (!reviewFilter.dimension || f.dimension === reviewFilter.dimension)
    && (reviewFilter.state === 'all' || f.state === reviewFilter.state || (reviewFilter.state === 'open' && f.state === 'fixing')));
  const open = r.findings.filter((f) => f.state === 'open');
  const studio = (f) => (r.project && f.file ? `#/studio/${encodeURIComponent(r.project.slug)}?file=${encodeURIComponent(f.file)}&line=${f.line || 1}` : null);
  view.innerHTML = `
  <div class="pg-head">
    <div class="inline">
      ${r.state === 'running' ? stateTag('running') : verdictChip(r.verdict, r.score)}
      <b>${esc(r.title)}</b>
      ${r.commit_sha ? `<span class="chip mono">${esc(r.commit_sha)}</span>` : ''}
      ${r.project ? `<a class="chip" href="#/studio/${esc(r.project.slug)}">${esc(t('Open in Dev Studio'))}</a>` : ''}
      ${r.repo ? `<span class="chip mono">${esc(r.repo)}#${r.pr_number}</span>` : ''}
      ${r.posted_at ? `<span class="chip chip-ok">${esc(t('posted on GitHub'))} · ${esc(String(r.posted_by).replace(/^\w+:/, ''))}</span>` : ''}
    </div>
    <div class="pg-actions">
      ${canDecide && r.project && open.some((f) => f.severity !== 'info') ? `<button class="btn btn-primary" type="button" id="rv-fixall">${esc(t('Fix the open findings with an engineer'))}</button>` : ''}
      ${canPost && r.repo && r.state === 'done' && !r.posted_at ? `<button class="btn btn-human" type="button" id="rv-post">${esc(t(r.verdict === 'fail' ? 'Request changes on GitHub' : 'Post the review on GitHub'))}</button>` : ''}
      <button class="btn" type="button" id="rv-md">${esc(t('Copy as Markdown'))}</button>
      ${r.bom.length ? `<button class="btn" type="button" id="rv-sbom">${esc(t('Download the SBOM'))}</button>` : ''}
    </div>
  </div>
  <div class="kpis">
    ${SEV.map((s) => kpi(s.charAt(0).toUpperCase() + s.slice(1), r.stats.bySeverity[s], '', r.stats.bySeverity[s] ? (s === 'critical' ? 'bad' : s === 'high' ? 'human' : '') : '')).join('')}
  </div>
  <div class="split2">
    <div class="stack">
      <div class="panel">
        <div class="panel-title">${esc(t('Findings'))}
          <span class="inline eng-filters">
            <select id="rv-f-sev" aria-label="${esc(t('Severity'))}"><option value="">${esc(t('Every severity'))}</option>${SEV.map((s) => `<option value="${s}" ${reviewFilter.severity === s ? 'selected' : ''}>${esc(t(s))}</option>`).join('')}</select>
            <select id="rv-f-dim" aria-label="${esc(t('Dimension'))}"><option value="">${esc(t('Every dimension'))}</option>${r.dimensions.map((d) => `<option value="${d}" ${reviewFilter.dimension === d ? 'selected' : ''}>${esc(t(DIM_LABEL[d] || d))}</option>`).join('')}</select>
            <select id="rv-f-state" aria-label="${esc(t('State'))}">${[['open', 'Still open'], ['all', 'All'], ['dismissed', 'Dismissed'], ['fixed', 'Fixed']].map(([v, l]) => `<option value="${v}" ${reviewFilter.state === v ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select>
          </span>
        </div>
        ${list.length ? list.map((f) => `
          <div class="eng-finding ${esc(f.state)}">
            <div class="inline">${sevBadge(f.severity)}<span class="chip">${esc(t(DIM_LABEL[f.dimension] || f.dimension))}</span><b class="grow">${esc(f.title)}</b>
              <span class="muted">${esc(t(f.source === 'scanner' ? 'scanner' : f.source === 'tests' ? 'test run' : 'AI reviewer'))}</span>${f.state !== 'open' ? stateTag(f.state) : ''}</div>
            ${f.file ? `<div class="mono ltr">${studio(f) ? `<a href="${studio(f)}">${esc(f.file)}${f.line ? `:${f.line}` : ''}</a>` : `${esc(f.file)}${f.line ? `:${f.line}` : ''}`}</div>` : ''}
            ${f.detail ? `<div class="eng-detail">${esc(f.detail)}</div>` : ''}
            ${f.evidence ? `<pre class="eng-ev ltr" data-no-i18n>${esc(f.evidence)}</pre>` : ''}
            ${f.fix ? `<div class="eng-fix"><b>${esc(t('Fix'))}:</b> ${esc(f.fix)}</div>` : ''}
            <div class="inline">
              ${f.issue_url ? `<a class="chip" href="${esc(f.issue_url)}" target="_blank" rel="noopener">${esc(t('issue on GitHub'))} ↗</a>` : ''}
              ${f.change_id && r.project ? `<a class="chip" href="#/studio/${esc(r.project.slug)}">${esc(t('change set'))} #${f.change_id}</a>` : ''}
              <span class="grow"></span>
              ${canDecide && f.state === 'open' && r.project && f.severity !== 'info' ? `<button class="btn btn-sm" type="button" data-fix="${f.id}">${esc(t('Fix this'))}</button>` : ''}
              ${canPost && r.issueRepo && f.state === 'open' && !f.issue_url ? `<button class="btn btn-sm" type="button" data-issue="${f.id}">${esc(t('Open an issue'))}</button>` : ''}
              ${canDecide && f.state === 'open' ? `<button class="btn btn-sm btn-bad" type="button" data-dismiss="${f.id}" data-sev="${esc(f.severity)}">${esc(t('Dismiss'))}</button>` : ''}
              ${canDecide && f.state === 'dismissed' ? `<button class="btn btn-sm" type="button" data-reopen="${f.id}">${esc(t('Reopen'))}</button>` : ''}
            </div>
          </div>`).join('') : `<div class="empty">${esc(t(r.state === 'running' ? 'The reviewers are still reading.' : 'Nothing here.'))}</div>`}
      </div>
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-title">${esc(t('Who read it'))}</div>
        <div class="rows">
          <div class="row"><span class="chip">⚙</span><div class="row-main"><div class="row-title">${esc(t('The scanner'))}</div><div class="row-meta">${r.findings.filter((f) => f.source === 'scanner').length} ${esc(t('findings'))} · ${r.counts.files ?? '—'} ${esc(t('files'))}${r.counts.tests !== undefined ? ` · ${r.counts.tests} ${esc(t('test files'))}` : ''}</div></div></div>
          ${r.reviewers.map((x) => `<div class="row">${who(`agent:${x.agent_id}`)}<div class="row-main"><div class="row-title">${esc(t(DIM_LABEL[x.dimension] || x.dimension))} ${stateTag(x.state)}</div><div class="row-meta" style="white-space:pre-wrap">${esc(x.summary || '')}</div></div></div>`).join('')}
        </div>
      </div>
      ${r.summary ? `<div class="panel"><div class="panel-title">${esc(t('Summary'))}</div><div style="white-space:pre-wrap" class="muted">${esc(r.summary)}</div></div>` : ''}
      ${r.bom.length ? `<div class="panel"><div class="panel-title">${esc(t('Bill of materials'))}<span class="muted">${r.bom.length}</span></div>
        <table><thead><tr><th>${esc(t('Package'))}</th><th>${esc(t('Version'))}</th><th>${esc(t('Licence'))}</th></tr></thead><tbody>
        ${r.bom.slice(0, 80).map((d) => `<tr><td class="mono">${esc(d.name)}${d.kind === 'dev' ? ` <span class="muted">dev</span>` : ''}</td><td class="mono">${esc(d.installed || d.wanted)}</td><td>${esc(d.licence)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
    </div>
  </div>`;

  const gen = navGeneration;
  const rerender = () => { if (gen === navGeneration) renderReview(id); };
  $('#rv-f-sev').addEventListener('change', (e) => { reviewFilter.severity = e.target.value || null; rerender(); });
  $('#rv-f-dim').addEventListener('change', (e) => { reviewFilter.dimension = e.target.value || null; rerender(); });
  $('#rv-f-state').addEventListener('change', (e) => { reviewFilter.state = e.target.value; rerender(); });
  $('#rv-fixall')?.addEventListener('click', async () => {
    try { const x = await api(`/api/reviews/${r.id}/fix`, { method: 'POST', body: {} }); toast(`${t('An engineer is fixing')} ${x.findings}`); rerender(); }
    catch (err) { toast(err.message, true); }
  });
  $('#rv-post')?.addEventListener('click', async (e) => {
    if (!confirm(t('This posts the review on the pull request, in your name. Continue?'))) return;
    e.target.disabled = true;
    try { await api(`/api/reviews/${r.id}/post`, { method: 'POST', body: {} }); toast(t('Posted')); rerender(); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
  $('#rv-md').addEventListener('click', async () => {
    try { const { markdown } = await api(`/api/reviews/${r.id}/markdown`); await navigator.clipboard.writeText(markdown); toast(t('Copied')); }
    catch (err) { toast(err.message, true); }
  });
  $('#rv-sbom')?.addEventListener('click', () => downloadFile(`/api/reviews/${r.id}/sbom`, `sbom-review-${r.id}.csv`));
  view.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/reviews/${r.id}/fix`, { method: 'POST', body: { ids: [Number(b.dataset.fix)] } }); toast(t('The engineer is on it')); rerender(); }
    catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt(t(['critical', 'high'].includes(b.dataset.sev) ? 'Why is this not a problem? (required)' : 'Why is this not a problem? (optional)'));
    if (note === null) return;
    try { await api(`/api/reviews/findings/${b.dataset.dismiss}/dismiss`, { method: 'POST', body: { note } }); rerender(); }
    catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-reopen]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/reviews/findings/${b.dataset.reopen}/reopen`, { method: 'POST', body: {} }); rerender(); }
    catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-issue]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('This opens an issue in the GitHub repository, in your name. Continue?'))) return;
    try { await api(`/api/reviews/findings/${b.dataset.issue}/issue`, { method: 'POST', body: {} }); toast(t('Issue opened')); rerender(); }
    catch (err) { toast(err.message, true); }
  }));
}

// ============================================================ GitHub hub ==

export async function renderGithub() {
  const h = await api('/api/github');
  const canM = hasPermC('github.manage');
  const canPost = hasPermC('github.post');
  const state = h.connector?.state || 'disconnected';
  const projects = canM ? (await api('/api/forge').catch(() => ({ projects: [] }))).projects : [];
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Your repositories, inside the company. Clone one into the factory to edit it in Dev Studio, have the review board read every pull request, and push back — every call, clone and push passes the one gate and lands on the chain. Merging is not here at all, and an approval on GitHub is a person\'s signature, never an agent\'s.'))}</p>
  </div>
  <div class="kpis">
    ${kpi('Connection', t(state === 'live' ? 'live' : state === 'dry' ? 'dry-run' : 'not connected'), h.connector?.lastCall ? `${esc(t('last call'))} ${esc(ago(h.connector.lastCall))}` : '', state === 'live' ? 'ok' : state === 'dry' ? 'human' : '')}
    ${kpi('Repositories', h.stats.repos, `${h.stats.linked} ${esc(t('in the factory'))}`, '')}
    ${kpi('Open pull requests', h.stats.openPulls, `${h.stats.reviewed} ${esc(t('reviewed'))}`, '')}
    ${kpi('Auto-review', h.stats.autoReview, esc(t('repositories reviewed on every push')), h.stats.autoReview ? 'ai' : '')}
  </div>
  <div class="split2">
    <div class="stack">
      ${canM ? `<form class="panel" id="gh-add">
        <div class="panel-title">${esc(t('Add a repository'))}</div>
        <div class="fields">
          <div><label class="fl" for="gh-repo">${esc(t('Repository'))}</label><input id="gh-repo" required placeholder="owner/name" class="ltr" autocomplete="off"></div>
          <div><label class="fl" for="gh-proj">${esc(t('Already in the factory as'))}</label><select id="gh-proj"><option value="">${esc(t('— not yet —'))}</option>${projects.map((p) => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join('')}</select></div>
        </div>
        <div class="inline" style="margin-top:12px"><button class="btn btn-primary" type="submit">${esc(t('Add'))}</button>
          ${h.hasToken ? `<button class="btn" type="button" id="gh-browse">${esc(t('Browse my repositories'))}</button>` : ''}</div>
        <div id="gh-remote"></div>
      </form>` : ''}
      ${h.repos.length ? h.repos.map((r) => `
        <div class="panel eng-repo">
          <div class="panel-title"><span class="mono ltr">${esc(r.full_name)}</span>
            <span class="inline">${r.private ? `<span class="chip">${esc(t('private'))}</span>` : ''}${r.auto_review ? `<span class="chip chip-ai">${esc(t('auto-review'))}</span>` : ''}</span></div>
          ${r.description ? `<p class="muted" style="margin:0 0 10px">${esc(r.description)}</p>` : ''}
          <div class="inline">
            ${r.project_slug ? `<a class="btn btn-sm btn-primary" href="#/studio/${esc(r.project_slug)}">${esc(t('Open in Dev Studio'))}</a>` : (canM ? `<button class="btn btn-sm btn-primary" type="button" data-gh="import" data-id="${r.id}">${esc(t('Clone into the factory'))}</button>` : '')}
            ${r.project_slug && canM ? `<button class="btn btn-sm" type="button" data-gh="pull" data-id="${r.id}">⇣ ${esc(t('Pull'))}</button>` : ''}
            ${r.project_slug && canPost ? `<button class="btn btn-sm btn-human" type="button" data-gh="push" data-id="${r.id}">⇡ ${esc(t('Push'))}</button>` : ''}
            ${canM ? `<button class="btn btn-sm" type="button" data-gh="sync" data-id="${r.id}">⟳ ${esc(t('Pull requests'))}</button>` : ''}
            <button class="btn btn-sm" type="button" data-gh="actions" data-id="${r.id}">${esc(t('Actions'))}</button>
            <button class="btn btn-sm" type="button" data-gh="issues" data-id="${r.id}">${esc(t('Issues'))}</button>
            <span class="grow"></span>
            ${canM ? `<label class="eng-chk"><input type="checkbox" data-auto="${r.id}" ${r.auto_review ? 'checked' : ''}> ${esc(t('Review every pull request'))}</label>
              <button class="btn btn-sm btn-bad" type="button" data-gh="remove" data-id="${r.id}" aria-label="${esc(t('Remove'))} ${esc(r.full_name)}">✕</button>` : ''}
          </div>
          <div class="rows" style="margin-top:10px">${r.pulls.filter((pr) => pr.state === 'open').map((pr) => `
            <div class="row">
              <span class="chip mono">#${pr.number}</span>
              <div class="row-main"><div class="row-title">${esc(pr.title || '')}${pr.draft ? ` <span class="muted">(${esc(t('draft'))})</span>` : ''}</div>
                <div class="row-meta mono ltr">${esc(pr.head || '')} → ${esc(pr.base || '')} · ${esc(pr.author || '')}${pr.updated ? ` · ${esc(ago(pr.updated))}` : ''}</div></div>
              <div class="row-side">${pr.review_id ? `<a class="chip" href="#/reviews/${pr.review_id}">${esc(t('review'))} #${pr.review_id}</a>` : ''}
                ${hasPermC('github.manage') ? `<button class="btn btn-sm" type="button" data-review="${r.id}:${pr.number}">${esc(t(pr.review_id ? 'Review again' : 'Review'))}</button>` : ''}
                ${pr.url ? `<a class="btn btn-sm" href="${esc(pr.url)}" target="_blank" rel="noopener" aria-label="${esc(t('Open on GitHub'))} #${pr.number}">↗</a>` : ''}</div>
            </div>`).join('') || `<div class="hint">${esc(t(r.last_synced ? 'No open pull requests.' : 'Refresh to read its pull requests.'))}</div>`}</div>
          <div data-extra="${r.id}"></div>
        </div>`).join('') : emptyCta('No repositories yet', 'Connect GitHub with a token, then add a repository by its owner/name.')}
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-title">${esc(t('Connection'))}</div>
        ${!h.hasToken ? (canM ? `<form id="gh-connect">
          <label class="fl" for="gh-token">${esc(t('A fine-grained personal access token'))}</label>
          <input id="gh-token" type="password" required autocomplete="off" placeholder="github_pat_…" class="ltr">
          <div class="hint">${esc(t('Give it Contents (read and write), Pull requests, Issues and Actions (read) on the repositories you want here. It is sealed in the vault and never shown again.'))}</div>
          <div class="inline" style="margin-top:10px"><button class="btn btn-primary" type="submit">${esc(t('Connect'))}</button></div>
        </form>` : `<div class="hint">${esc(t('Somebody with github.manage connects it.'))}</div>`) : `
          <p style="margin:0 0 10px">${esc(t(state === 'live' ? 'Live: calls reach GitHub.' : 'Dry-run: every call is recorded and checked by the gate, and nothing leaves this machine. Switch to live once you have seen what it would do.'))}</p>
          ${canM ? `<div class="inline">${state === 'live' ? `<button class="btn" type="button" id="gh-dry">${esc(t('Back to dry-run'))}</button>` : `<button class="btn btn-human" type="button" id="gh-live">${esc(t('Switch to live'))}</button>`}
            <button class="btn btn-sm" type="button" id="gh-retoken">${esc(t('Replace the token'))}</button></div>` : ''}
          <div class="hint" style="margin-top:8px"><a href="#/egress">${esc(t('Every call is in the gate log'))} →</a></div>`}
      </div>
      <div class="panel">
        <div class="panel-title">${esc(t('Webhook'))}</div>
        <p class="muted" style="margin:0 0 8px">${esc(t('Point a GitHub webhook (pull_request events, JSON) at this address and the review board reads every new or updated pull request on repositories with auto-review on.'))}</p>
        <div class="mono ltr eng-url">${esc(h.webhook.url)}</div>
        ${h.webhook.reachable ? '' : `<div class="callout human" style="margin-top:8px">${esc(t('This address is on localhost, so GitHub cannot reach it. Set the public address in Settings once this runs on a server.'))}</div>`}
        <div class="inline" style="margin-top:10px">${h.webhook.hasSecret ? `<span class="chip chip-ok">${esc(t('secret set'))}</span>` : `<span class="chip chip-warn">${esc(t('no secret yet'))}</span>`}
          ${canM ? `<button class="btn btn-sm" type="button" id="gh-secret">${esc(t(h.webhook.hasSecret ? 'Replace the secret' : 'Make a secret'))}</button>` : ''}</div>
        <div id="gh-secret-out"></div>
        ${h.webhook.deliveries.length ? `<table style="margin-top:10px"><thead><tr><th>${esc(t('Event'))}</th><th>${esc(t('Repository'))}</th><th>${esc(t('Outcome'))}</th><th>${esc(t('When'))}</th></tr></thead><tbody>
          ${h.webhook.deliveries.map((d) => `<tr><td class="mono">${esc(d.event)}${d.action ? `.${esc(d.action)}` : ''}</td><td class="mono">${esc(d.repo || '')}${d.number ? `#${d.number}` : ''}</td><td>${esc(t(d.outcome))}</td><td>${esc(ago(d.received_at))}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>
    </div>
  </div>`;

  const gen = navGeneration;
  const rerender = () => { if (gen === navGeneration) renderGithub(); };
  $('#gh-connect')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/github/connect', { method: 'POST', body: { token: $('#gh-token').value } }); toast(t('Connected in dry-run')); rerender(); }
    catch (err) { toast(err.message, true); }
  });
  $('#gh-retoken')?.addEventListener('click', async () => {
    const token = prompt(t('Paste the new token'));
    if (!token) return;
    try { await api('/api/github/connect', { method: 'POST', body: { token } }); toast(t('Token replaced — back in dry-run')); rerender(); }
    catch (err) { toast(err.message, true); }
  });
  $('#gh-live')?.addEventListener('click', async () => {
    if (!confirm(t('From now on, calls reach GitHub for real. Continue?'))) return;
    try { await api('/api/github/live', { method: 'POST', body: { live: true } }); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#gh-dry')?.addEventListener('click', async () => { try { await api('/api/github/live', { method: 'POST', body: { live: false } }); rerender(); } catch (err) { toast(err.message, true); } });
  $('#gh-secret')?.addEventListener('click', async () => {
    try {
      const s = await api('/api/github/webhook-secret', { method: 'POST', body: {} });
      $('#gh-secret-out').innerHTML = `<div class="callout human" style="margin-top:10px"><b>${esc(t('Copy it now — it is not shown again:'))}</b><div class="mono ltr eng-url">${esc(s.secret)}</div></div>`;
    } catch (err) { toast(err.message, true); }
  });
  $('#gh-add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/github/repos', { method: 'POST', body: { repo: $('#gh-repo').value, project: $('#gh-proj').value || null } }); toast(t('Added')); rerender(); }
    catch (err) { toast(err.message, true); }
  });
  $('#gh-browse')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { repos } = await api('/api/github/remote');
      $('#gh-remote').innerHTML = `<div class="rows" style="margin-top:12px;max-height:320px;overflow:auto">${repos.map((x) => `
        <div class="row"><div class="row-main"><div class="row-title mono ltr">${esc(x.fullName)}</div><div class="row-meta">${esc(x.description || '')} ${x.language ? `· ${esc(x.language)}` : ''}</div></div>
        <button class="btn btn-sm" type="button" data-pick="${esc(x.fullName)}">${esc(t('Add'))}</button></div>`).join('')}</div>`;
      $('#gh-remote').querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
        try { await api('/api/github/repos', { method: 'POST', body: { repo: b.dataset.pick } }); toast(t('Added')); rerender(); } catch (err) { toast(err.message, true); }
      }));
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
  view.querySelectorAll('[data-auto]').forEach((c) => c.addEventListener('change', async () => {
    try { await api(`/api/github/repos/${c.dataset.auto}/settings`, { method: 'POST', body: { autoReview: c.checked } }); toast(t('Saved')); }
    catch (err) { toast(err.message, true); c.checked = !c.checked; }
  }));
  view.querySelectorAll('[data-gh]').forEach((b) => b.addEventListener('click', async () => {
    const { gh: what, id } = b.dataset;
    if (what === 'remove' && !confirm(t('Remove this repository from the hub? The factory project, if any, stays.'))) return;
    if (what === 'push' && !confirm(t('Push the current branch to GitHub, in your name?'))) return;
    if (what === 'actions' || what === 'issues') {
      const box = view.querySelector(`[data-extra="${id}"]`);
      box.innerHTML = `<div class="hint">${esc(t('Loading…'))}</div>`;
      try {
        const data = await api(`/api/github/repos/${id}/${what}`);
        box.innerHTML = what === 'actions'
          ? `<table style="margin-top:10px"><thead><tr><th>${esc(t('Workflow'))}</th><th>${esc(t('Branch'))}</th><th>${esc(t('Result'))}</th><th>${esc(t('When'))}</th></tr></thead><tbody>${data.runs.map((x) => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></td><td class="mono">${esc(x.branch)}</td><td>${esc(x.conclusion || x.status)}</td><td>${esc(ago(x.updated))}</td></tr>`).join('')}</tbody></table>`
          : `<div class="rows" style="margin-top:10px">${data.issues.filter((x) => !x.isPr).map((x) => `<div class="row"><span class="chip mono">#${x.number}</span><div class="row-main"><div class="row-title">${esc(x.title)}</div><div class="row-meta">${esc((x.labels || []).join(', '))} · ${esc(x.author || '')}</div></div><a class="btn btn-sm" href="${esc(x.url)}" target="_blank" rel="noopener" aria-label="${esc(t('Open on GitHub'))} #${x.number}">↗</a></div>`).join('') || `<div class="hint">${esc(t('No open issues.'))}</div>`}</div>`;
      } catch (err) { box.innerHTML = `<div class="callout human">${esc(err.message)}</div>`; }
      return;
    }
    b.disabled = true;
    try {
      const path = what === 'remove' ? 'remove' : what;
      const r = await api(`/api/github/repos/${id}/${path}`, { method: 'POST', body: {} });
      toast(t({ import: 'Cloned into the factory', pull: 'Pulled', push: 'Pushing — watch the terminal in Dev Studio', sync: 'Refreshed', remove: 'Removed' }[what] || 'Done'));
      if (what === 'import' && r.project) { location.hash = `#/studio/${r.project.slug}`; return; }
      rerender();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  }));
  view.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', async () => {
    const [rid, n] = b.dataset.review.split(':');
    b.disabled = true;
    try { const rv = await api(`/api/github/repos/${rid}/pulls/${n}/review`, { method: 'POST', body: {} }); location.hash = `#/reviews/${rv.id}`; }
    catch (err) { toast(err.message, true); b.disabled = false; }
  }));
}

// =========================================================== app builder ==

const STAGE_LABEL = {
  spec: 'Specification', spec_review: 'Approve the specification', arch: 'Architecture', arch_review: 'Approve the design',
  building: 'Building', milestone_review: 'Review the milestone', testing: 'Tests', reviewing: 'Review board', ready: 'Ready',
  failed: 'Stopped', cancelled: 'Cancelled',
};
const STEPS = [['spec', 'Specification'], ['arch', 'Architecture'], ['building', 'Milestones'], ['testing', 'Tests'], ['reviewing', 'Review'], ['ready', 'Ready']];
const stepOf = (state) => ({ spec: 0, spec_review: 0, arch: 1, arch_review: 1, building: 2, milestone_review: 2, testing: 3, reviewing: 4, ready: 5 })[state] ?? -1;
const waitsOnPerson = (s) => ['spec_review', 'arch_review', 'milestone_review'].includes(s);

export async function renderAppBuilder() {
  const { overview: o, builds } = await api('/api/appbuilder');
  const canM = hasPermC('appbuilder.manage');
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('Describe an app in a paragraph. A product manager writes the specification and you approve it; an architect picks the smallest stack and cuts the work into milestones and you approve that; engineers build one milestone at a time, each one a change set you apply; a test engineer who did not write the code writes the tests; and the review board reads the result before anybody calls it ready.'))}</p>
  </div>
  <div class="eng-steps" aria-label="${esc(t('Stages'))}">${STEPS.map(([, l], i) => `<span><i>${i + 1}</i>${esc(t(l))}</span>`).join('')}</div>
  <div class="kpis">
    ${kpi('Builds', o.builds, '', '')}
    ${kpi('Waiting on you', o.waiting, esc(t('a stage to approve or apply')), o.waiting ? 'human' : '')}
    ${kpi('Working', o.working, esc(t('agents writing')), o.working ? 'ai' : '')}
    ${kpi('Ready', o.ready, '', o.ready ? 'ok' : '')}
  </div>
  <div class="split2">
    <div class="stack">
      ${builds.length ? `<div class="cards">${builds.map((b) => `
        <a class="card" href="#/appbuilder/${b.id}">
          <div class="card-top"><div class="card-title">${esc(b.name)}</div><span class="chip ${waitsOnPerson(b.state) ? 'chip-warn' : b.state === 'ready' ? 'chip-ok' : ['failed', 'cancelled'].includes(b.state) ? 'chip-bad' : 'chip-ai'}">${esc(t(STAGE_LABEL[b.state] || b.state))}</span></div>
          <div class="card-meta">${esc(b.idea.slice(0, 140))}</div>
          <div class="eng-prog" aria-hidden="true">${STEPS.map((_, i) => `<i class="${i < stepOf(b.state) || b.state === 'ready' ? 'done' : i === stepOf(b.state) ? 'now' : ''}"></i>`).join('')}</div>
          <div class="card-foot"><span>${b.total ? `${b.done}/${b.total} ${esc(t('milestones'))}` : esc(t({ en: 'English', ar: 'Arabic', both: 'English + Arabic' }[b.language] || b.language))}</span><span>${esc(ago(b.updated_at))}</span></div>
        </a>`).join('')}</div>` : emptyCta('No apps yet', 'Describe the first one on the right.')}
    </div>
    ${canM ? `<form class="panel" id="ab-new">
      <div class="panel-title">${esc(t('A new app'))}</div>
      <div class="fields">
        <div class="wide"><label class="fl" for="ab-name">${esc(t('Name'))}</label><input id="ab-name" required placeholder="${esc(t('e.g. Clinic bookings'))}"></div>
        <div class="wide"><label class="fl" for="ab-idea">${esc(t('The idea'))}</label>
          <textarea id="ab-idea" rows="6" required placeholder="${esc(t('What it does, for whom, and what a good first version must let them do. e.g. Patients book a slot with a doctor; reception sees the day; the doctor can mark no-shows. Email reminders the day before.'))}"></textarea></div>
        <div class="wide"><label class="fl" for="ab-aud">${esc(t('Who will use it (optional)'))}</label><input id="ab-aud"></div>
        <div class="wide"><span class="fl">${esc(t('Language of the interface'))}</span>
          <div class="seg">${[['en', 'English'], ['ar', 'Arabic (right-to-left)'], ['both', 'Both, with a switch']].map(([v, l], i) => `<label><input type="radio" name="ab-lang" value="${v}" ${i === 0 ? 'checked' : ''}><b>${esc(t(l))}</b></label>`).join('')}</div></div>
      </div>
      <div class="inline" style="margin-top:12px"><button class="btn btn-primary" type="submit">${esc(t('Start — the product manager writes the spec'))}</button></div>
    </form>` : ''}
  </div>`;
  $('#ab-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const b = await api('/api/appbuilder', { method: 'POST', body: { name: $('#ab-name').value, idea: $('#ab-idea').value, audience: $('#ab-aud').value, language: view.querySelector('input[name="ab-lang"]:checked').value } });
      location.hash = `#/appbuilder/${b.id}`;
    } catch (err) { toast(err.message, true); }
  });
}

const listItems = (xs) => (Array.isArray(xs) && xs.length ? `<ul class="eng-ul">${xs.map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>` : `<span class="muted">—</span>`);

export async function renderAppBuild(id) {
  const b = await api(`/api/appbuilder/${encodeURIComponent(id)}`);
  const canM = hasPermC('appbuilder.manage');
  document.getElementById('page-title').textContent = b.name;
  const step = stepOf(b.state);
  const m = b.milestones[b.current];
  const gen = navGeneration;
  const rerender = () => { if (gen === navGeneration) renderAppBuild(id); };

  let action = '';
  if (b.state === 'spec_review' && b.spec) {
    action = `<div class="panel eng-gate">
      <div class="panel-title">${esc(t('The specification'))}${who('agent:AGT-PM-001')}</div>
      <p>${esc(b.spec.summary || '')}</p>
      <div class="eng-grid">
        <div><div class="fl">${esc(t('Users'))}</div>${listItems(b.spec.users)}</div>
        <div><div class="fl">${esc(t('Screens'))}</div>${listItems(b.spec.screens)}</div>
      </div>
      <div class="fl">${esc(t('Features'))}</div>
      ${(b.spec.features || []).map((f) => `<div class="eng-feature"><b>${esc(f.name)}</b>${listItems(f.stories)}<div class="fl">${esc(t('Acceptance'))}</div>${listItems(f.acceptance)}</div>`).join('')}
      <div class="eng-grid">
        <div><div class="fl">${esc(t('Data'))}</div>${listItems((b.spec.dataModel || []).map((d) => `${d.entity}: ${(d.fields || []).join(', ')}`))}</div>
        <div><div class="fl">${esc(t('Out of scope'))}</div>${listItems(b.spec.outOfScope)}</div>
      </div>
      <div class="fl">${esc(t('Risks'))}</div>${listItems(b.spec.risks)}
    </div>`;
  } else if (b.state === 'arch_review' && b.arch) {
    action = `<div class="panel eng-gate">
      <div class="panel-title">${esc(t('The design'))}${who('agent:AGT-ARC-001')}</div>
      <p>${esc(b.arch.summary || '')}</p>
      <div class="inline"><span class="chip chip-ai">${esc(b.arch.kind)}</span><span class="chip">${esc(b.arch.stack || '')}</span></div>
      <div class="fl" style="margin-top:12px">${esc(t('Structure'))}</div>
      ${listItems((b.arch.structure || []).map((s) => `${s.path} — ${s.purpose}`))}
      <div class="fl">${esc(t('Milestones'))}</div>
      <ol class="eng-ol">${(b.arch.milestones || []).map((x) => `<li><b>${esc(x.title)}</b><div class="muted">${esc(x.goal || '')}</div>${listItems(x.acceptance)}</li>`).join('')}</ol>
      <div class="eng-grid"><div><div class="fl">${esc(t('Non-functional'))}</div>${listItems(b.arch.nfr)}</div><div><div class="fl">${esc(t('Risks'))}</div>${listItems(b.arch.risks)}</div></div>
    </div>`;
  } else if (b.state === 'milestone_review' && m) {
    action = `<div class="panel eng-gate">
      <div class="panel-title">${esc(t('Milestone'))} ${b.current + 1}/${b.milestones.length}: ${esc(m.title)}${m.change ? who(`agent:${m.change.agent_id}`) : ''}</div>
      <p class="muted">${esc(m.goal)}</p>
      ${m.change?.summary ? `<div style="white-space:pre-wrap">${esc(m.change.summary)}</div>` : ''}
      ${m.change ? `<div class="inline" style="margin-top:10px">${stateTag(m.change.state)}<a class="btn btn-sm" href="#/studio/${esc(b.project.slug)}">${esc(t('Read the change in Dev Studio'))}</a></div>` : ''}
    </div>`;
  } else if (b.state === 'ready') {
    action = `<div class="panel eng-gate ok">
      <div class="panel-title">${esc(t('Built'))}</div>
      <div class="inline">${b.review ? verdictChip(b.review.verdict, b.review.score) : ''}${gateChip(b.gate)}</div>
      <div class="inline" style="margin-top:12px">
        <a class="btn btn-primary" href="#/studio/${esc(b.project.slug)}">${esc(t('Open in Dev Studio'))}</a>
        ${b.review ? `<a class="btn" href="#/reviews/${b.review.id}">${esc(t('What the board found'))}</a>` : ''}
        <a class="btn" href="#/forge/${esc(b.project.slug)}">${esc(t('Preview'))}</a>
        ${hasPermC('deploys.manage') ? `<a class="btn btn-human" href="#/deploys?project=${b.project.id}">🚀 ${esc(t('Deploy'))}</a>` : ''}
      </div>
    </div>`;
  } else if (['spec', 'arch', 'building', 'testing', 'reviewing'].includes(b.state)) {
    action = `<div class="panel eng-gate ai"><div class="panel-title">${esc(t(STAGE_LABEL[b.state]))}</div><div class="muted">${esc(t('The agents are working. This page refreshes itself.'))}</div></div>`;
  }

  view.innerHTML = `
  <div class="pg-head">
    <div class="inline"><span class="chip ${waitsOnPerson(b.state) ? 'chip-warn' : b.state === 'ready' ? 'chip-ok' : 'chip-ai'}">${esc(t(STAGE_LABEL[b.state] || b.state))}</span>
      ${b.project ? `<a class="chip mono" href="#/studio/${esc(b.project.slug)}">${esc(b.project.slug)}</a>` : ''}</div>
    <div class="pg-actions">${canM && !['ready', 'cancelled', 'failed'].includes(b.state) ? `<button class="btn btn-bad btn-sm" type="button" id="ab-cancel">${esc(t('Cancel the build'))}</button>` : ''}</div>
  </div>
  <div class="eng-steps">${STEPS.map(([, l], i) => `<span class="${i < step || b.state === 'ready' ? 'done' : i === step ? 'now' : ''}"><i>${i < step || b.state === 'ready' ? '✓' : i + 1}</i>${esc(t(l))}</span>`).join('')}</div>
  <div class="split2">
    <div class="stack">
      <div class="panel"><div class="panel-title">${esc(t('The idea'))}</div><div style="white-space:pre-wrap">${esc(b.idea)}</div>${b.audience ? `<div class="hint">${esc(t('For'))}: ${esc(b.audience)}</div>` : ''}</div>
      ${action}
      ${canM && waitsOnPerson(b.state) ? `<form class="panel" id="ab-decide">
        <div class="panel-title">${esc(t('Your decision'))}</div>
        <textarea id="ab-fb" rows="3" placeholder="${esc(t(b.state === 'milestone_review' ? 'Guidance for another attempt (only if you send it back)' : 'What should change (only if you send it back)'))}" aria-label="${esc(t('Feedback'))}"></textarea>
        <div class="inline" style="margin-top:10px">
          ${b.state === 'milestone_review'
    ? `${m?.change?.state === 'proposed' ? `<button class="btn btn-human" type="button" id="ab-apply">${esc(t('Apply and continue'))}</button>` : ''}
               <button class="btn" type="button" id="ab-revise">${esc(t('Try again with this guidance'))}</button>
               <button class="btn btn-sm" type="button" id="ab-skip">${esc(t('Skip this milestone'))}</button>`
    : `<button class="btn btn-human" type="button" id="ab-approve">${esc(t('Approve'))}</button><button class="btn" type="button" id="ab-revise">${esc(t('Send it back'))}</button>`}
        </div>
      </form>` : ''}
    </div>
    <div class="stack">
      ${b.milestones.length ? `<div class="panel"><div class="panel-title">${esc(t('Milestones'))}</div>
        <ol class="eng-ms">${b.milestones.map((x, i) => `<li class="${esc(x.state)} ${i === b.current && !['ready'].includes(b.state) ? 'cur' : ''}"><b>${esc(x.title)}</b> ${stateTag(x.state)}</li>`).join('')}</ol></div>` : ''}
      <div class="panel"><div class="panel-title">${esc(t('What happened'))}</div>
        <div class="eng-log">${[...b.log].reverse().map((l) => `<div><span class="muted">${esc(ago(l.at))}</span> ${esc(l.text)}</div>`).join('') || `<div class="hint">—</div>`}</div></div>
    </div>
  </div>`;

  const post = async (path, body = {}) => {
    try { await api(`/api/appbuilder/${b.id}/${path}`, { method: 'POST', body }); rerender(); }
    catch (err) { toast(err.message, true); }
  };
  $('#ab-approve')?.addEventListener('click', () => post('approve'));
  $('#ab-apply')?.addEventListener('click', () => post('apply'));
  $('#ab-skip')?.addEventListener('click', () => { if (confirm(t('Skip this milestone and go on to the next?'))) post('skip'); });
  $('#ab-revise')?.addEventListener('click', () => { const fb = $('#ab-fb').value.trim(); if (!fb) { toast(t('Say what should change first'), true); $('#ab-fb').focus(); return; } post('revise', { feedback: fb }); });
  $('#ab-cancel')?.addEventListener('click', () => { if (confirm(t('Cancel this build? The project, if one was made, stays in the factory.'))) post('cancel'); });
}

// ===================================================== engineering metrics ==

let metricDays = 30;
export async function renderEngMetrics() {
  const m = await api(`/api/engmetrics?days=${metricDays}`);
  const band = (b) => (b ? `<span class="eng-band b-${esc(b)}">${esc(t(b))}</span>` : `<span class="muted">${esc(t('no data'))}</span>`);
  const fmtMin = (v) => (v === null ? '—' : v < 60 ? `${v} ${t('min')}` : v < 1440 ? `${(v / 60).toFixed(1)} ${t('h')}` : `${(v / 1440).toFixed(1)} ${t('days')}`);
  const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const weeks = (rows, key) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return `<div class="eng-bars" role="img" aria-label="${esc(t(key))}">${rows.map((r) => `<span title="${esc(r.wk)} · ${r.n}"><i style="height:${Math.round((r.n / max) * 100)}%"></i>${r.bad ? `<b style="height:${Math.round((r.bad / max) * 100)}%"></b>` : ''}</span>`).join('') || `<div class="hint">${esc(t('no data yet'))}</div>`}</div>`;
  };
  const d = m.dora;
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('The four numbers that say whether a team ships well — deployment frequency, lead time, change failure rate and time to restore — measured from releases, change sets and incidents. Next to them, how often people accept what AI engineers propose, and how much of what the reviewers find gets fixed. A number with nothing behind it says so.'))}</p>
    <div class="pg-actions"><select id="em-days" aria-label="${esc(t('Period'))}">${[7, 30, 90, 365].map((x) => `<option value="${x}" ${x === metricDays ? 'selected' : ''}>${x} ${esc(t('days'))}</option>`).join('')}</select></div>
  </div>
  <div class="eng-dora">
    <div class="panel"><div class="fl">${esc(t('Deployment frequency'))}</div><div class="eng-big">${d.frequency.value}<small> / ${esc(t('week'))}</small></div>${band(d.frequency.band)}<div class="hint">${d.frequency.n} ${esc(t('releases'))}</div></div>
    <div class="panel"><div class="fl">${esc(t('Lead time for changes'))}</div><div class="eng-big">${fmtMin(d.leadTime.value)}</div>${band(d.leadTime.band)}<div class="hint">${esc(t('median, request to applied'))} · ${d.leadTime.n}</div></div>
    <div class="panel"><div class="fl">${esc(t('Change failure rate'))}</div><div class="eng-big">${pct(d.changeFailure.value)}</div>${band(d.changeFailure.band)}<div class="hint">${d.changeFailure.n} ${esc(t('finished releases'))}</div></div>
    <div class="panel"><div class="fl">${esc(t('Time to restore'))}</div><div class="eng-big">${fmtMin(d.timeToRestore.value)}</div>${band(d.timeToRestore.band)}<div class="hint">${esc(t('median'))} · ${d.timeToRestore.n} ${esc(t('incidents'))}</div></div>
  </div>
  <div class="split2" style="margin-top:16px">
    <div class="stack">
      <div class="panel"><div class="panel-title">${esc(t('Releases per week'))}<span class="muted">${esc(t('red: failed or rolled back'))}</span></div>${weeks(m.trend.releases, 'Releases per week')}</div>
      <div class="panel"><div class="panel-title">${esc(t('Projects and their gate'))}<span class="muted">${esc(t('gate'))}: ${esc(t(m.gateMode))}</span></div>
        <table><thead><tr><th>${esc(t('Project'))}</th><th>${esc(t('Gate'))}</th><th class="num">${esc(t('Score'))}</th><th class="num">${esc(t('Critical'))}</th><th>${esc(t('Last release'))}</th><th class="num">${esc(t('Open changes'))}</th></tr></thead><tbody>
        ${m.projects.map((p) => `<tr><td><a href="#/studio/${esc(p.slug)}">${esc(p.name)}</a></td><td>${gateChip(p.gate)}</td><td class="num">${p.gate.score ?? '—'}</td><td class="num">${p.gate.critical ?? '—'}</td><td>${p.lastRelease ? `${esc(t(p.lastRelease.state))} · ${esc(ago(p.lastRelease.started_at))}` : '—'}</td><td class="num">${p.openChanges}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">${esc(t('No projects yet.'))}</td></tr>`}
        </tbody></table></div>
    </div>
    <div class="stack">
      <div class="panel"><div class="panel-title">${esc(t('AI engineers'))}</div>
        <div class="kv"><span>${esc(t('Proposed'))}</span><b>${m.ai.proposed}</b><span>${esc(t('Applied'))}</span><b>${m.ai.applied}</b><span>${esc(t('Rejected'))}</span><b>${m.ai.rejected}</b><span>${esc(t('Acceptance'))}</span><b>${pct(m.ai.acceptance)}</b></div>
        ${weeks(m.trend.changes, 'Change sets per week')}
        <div class="rows">${m.ai.byAgent.map((a) => `<div class="row">${who(`agent:${a.agent}`)}<div class="row-main"><div class="row-meta">${a.applied}/${a.proposed} ${esc(t('applied'))}</div></div></div>`).join('')}</div>
      </div>
      <div class="panel"><div class="panel-title">${esc(t('Quality'))}</div>
        <div class="kv"><span>${esc(t('Reviews'))}</span><b>${m.quality.reviews}</b><span>${esc(t('Average score'))}</span><b>${m.quality.avgScore ?? '—'}</b><span>${esc(t('Open findings'))}</span><b>${m.quality.open}</b>
          <span>${esc(t('Open critical'))}</span><b>${m.quality.openCritical}</b><span>${esc(t('Closed'))}</span><b>${pct(m.quality.closeRate)}</b>
          <span>${esc(t('From the scanner / AI'))}</span><b>${m.quality.fromScanner} / ${m.quality.fromAgents}</b><span>${esc(t('Test runs passing'))}</span><b>${pct(m.quality.testPassRate)} <small class="muted">(${m.quality.testRuns})</small></b></div>
      </div>
    </div>
  </div>`;
  $('#em-days').addEventListener('change', (e) => { metricDays = Number(e.target.value); renderEngMetrics(); });
}
