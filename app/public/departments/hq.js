// Home — how the company is doing, and what it needs from you.
//
// Drawn from one read (/api/hq) and laid out in the two lanes the whole design
// is about: on the left what the machines are doing, on the right what is
// waiting on a person. Below them, what is being built and what is running.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC, currentUser } from '../state/session.js';
import { t, lang } from '/i18n.js';
import { kpi, dot, who, bar, strip, ago, act, wireActs, emptyCta, stateTag } from '../components/ui.js';

const ACTION_LABEL = {
  'run.enqueued': 'queued work for', 'run.done': 'finished', 'forge.change_requested': 'asked an engineer to change',
  'forge.change_applied': 'applied a change to', 'forge.project_created': 'started the project', 'deploy.release_live': 'released',
  'deploy.release_started': 'started a release of', 'servers.command_started': 'ran a command on', 'monitor.down': 'saw an outage on',
  'monitor.up': 'saw a recovery on', 'crew.assigned': 'assigned work', 'crew.plan_dispatched': 'dispatched a plan', 'crew.submit': 'submitted work',
};
/** "nexus.fired" by "nexus" reads "fired", not "nexus nexus fired". */
const verb = (action, actorName) => {
  if (ACTION_LABEL[action]) return t(ACTION_LABEL[action]);
  const [head, ...rest] = String(action).split('.');
  const words = (head === actorName || actorName.startsWith(head) ? rest.join(' ') : String(action)).replace(/[._]/g, ' ');
  return t(words || action);
};
/** The actor id may carry its own kind ("system:monitor"); trust that over the row's. */
const actorOf = (a) => (/^(human|agent|system):/.test(String(a.actor)) ? String(a.actor) : `${a.actorType}:${a.actor}`);

function greeting() {
  const h = new Date().getHours();
  return t(h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
}

export async function renderHQ() {
  const d = await api('/api/hq');
  const m = d.machines;
  const run = d.run;
  const sitesUp = run.monitor ? `${run.monitor.up}/${run.monitor.total}` : '—';
  const name = d.greetingName || currentUser?.displayName || '';
  const today = new Date().toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const quick = [
    hasPermC('forge.manage') ? `<a class="btn btn-primary" href="#/forge?new=1">＋ ${esc(t('New software project'))}</a>` : '',
    hasPermC('sites.manage') ? `<a class="btn" href="#/sites?new=1">${esc(t('Build a website'))}</a>` : '',
    hasPermC('servers.manage') ? `<a class="btn" href="#/servers?new=1">${esc(t('Add a server'))}</a>` : '',
    hasPermC('crew.manage') ? `<a class="btn" href="#/crew?plan=1">${esc(t('Plan work for the team'))}</a>` : '',
  ].join('');

  const waitingRows = (d.people.top || []).map((i) => `
    <div class="row">
      ${i.severity === 'high' ? dot('degraded') : dot('')}
      <a class="row-main" href="${esc(i.href)}" style="text-decoration:none;color:inherit">
        <div class="row-title">${esc(i.title)}</div>
        <div class="row-meta">${esc(t(i.sub || ''))}${i.ageHours ? ` · ${esc(ago(i.at))}` : ''}</div>
      </a>
      <div class="row-side">
        ${i.action ? act(i.action.path, i.actionLabel || 'Approve', { body: i.action.body, cls: 'btn-sm btn-human', done: 'Done' }) : `<a class="btn btn-sm" href="${esc(i.href)}">${esc(t('Open'))}</a>`}
      </div>
    </div>`).join('');

  const activity = (d.activity || []).map((a) => {
    const actor = actorOf(a);
    const name = actor.replace(/^(human|agent|system):/, '');
    return `
    <div class="row">
      ${who(actor)}
      <div class="row-main">
        <div class="row-title" style="font-weight:500">${esc(name)} <span class="muted">${esc(verb(a.action, name))}</span> ${a.subjectId ? `<span class="mono">${esc(String(a.subjectId).slice(0, 18))}</span>` : ''}</div>
        <div class="row-meta">${esc(ago(a.at))}${a.section ? ` · <a href="#/${esc(a.section)}">${esc(t(a.section))}</a>` : ''}</div>
      </div>
    </div>`;
  }).join('');

  const team = (d.people.team || []).map((w) => `
    <div class="row">
      <span class="who-human">${esc(w.name.slice(0, 2).toUpperCase())}</span>
      <div class="row-main"><div class="row-title">${esc(w.name)}</div><div class="row-meta">${w.open} ${esc(t('open'))} · ${w.overdue} ${esc(t('overdue'))} · ${w.loadH}h</div></div>
      <span class="sig ${esc(w.signal)}">${esc(t(w.signal))}</span>
    </div>`).join('');

  const fleet = (run.fleet || []).map((s) => `
    <a class="row" href="#/servers/${s.id}">
      ${dot(s.state)}
      <div class="row-main"><div class="row-title">${esc(s.name)}</div><div class="row-meta">${esc(t(s.environment))}</div></div>
      <div style="width:min(240px,40%);display:grid;gap:4px">${bar('CPU', s.cpu)}${bar('Disk', s.disk)}</div>
    </a>`).join('');

  const checks = (run.checks || []).map((c) => `
    <div class="row">
      ${dot(c.state)}
      <div class="row-main"><div class="row-title">${esc(c.name)}</div><div class="row-meta">${c.uptime == null ? '—' : `${c.uptime}%`} · ${c.latency == null ? '—' : `${c.latency} ms`}</div></div>
      <div style="width:min(200px,38%)">${strip(c.strip)}</div>
    </div>`).join('');

  const projects = (d.build.projects || []).map((p) => `
    <a class="row" href="#/forge/${esc(p.slug)}">
      <span class="who-ai" style="font-size:10px">${esc(p.kind === 'website' ? 'WEB' : '</>')}</span>
      <div class="row-main"><div class="row-title">${esc(p.name)}</div><div class="row-meta">${p.lastCommit ? `<span class="mono">${esc(p.lastCommit.sha)}</span> ${esc(p.lastCommit.subject)}` : esc(t('no commits yet'))}</div></div>
      ${p.pending ? `<span class="chip chip-warn">${p.pending} ${esc(t('to review'))}</span>` : ''}
    </a>`).join('');

  view.innerHTML = `
  <div class="hq-hello">
    <div>
      <h2>${esc(greeting())}${name ? `, <em>${esc(name)}</em>` : ''}.</h2>
      <p>${esc(today)}${d.company && d.company !== 'this company' ? ` · ${esc(d.company)}` : ''}</p>
    </div>
    <div class="quick">${quick}</div>
  </div>

  ${d.mock ? `<div class="callout"><b>${esc(t('Demo mode.'))}</b> ${esc(t('No AI provider is connected, so the workforce answers with placeholders. Everything else — servers, deployments, monitoring, the factory — is real.'))} ${hasPermC('settings.manage') ? `<a href="#/providers">${esc(t('Connect a provider'))} →</a>` : ''}</div>` : ''}

  <div class="kpis">
    ${kpi('Waiting on you', d.people.waiting, d.people.urgent ? `${d.people.urgent} ${esc(t('urgent'))}` : esc(t('all calm')), d.people.waiting ? 'human' : '', '#/approvals')}
    ${kpi('Running now', m.runsInFlight, `${m.doneToday} ${esc(t('finished today'))}`, 'ai', '#/runs')}
    ${kpi('AI employees', m.agentsActive, `$${Number(m.spendToday || 0).toFixed(2)} ${esc(t('spent today'))}`, '', '#/workforce')}
    ${kpi('Sites up', sitesUp, run.monitor?.uptime24 != null ? `${run.monitor.uptime24}% ${esc(t('over 24h'))}` : esc(t('nothing watched yet')), run.monitor?.down ? 'bad' : run.monitor?.total ? 'ok' : '', '#/monitors')}
    ${kpi('Servers online', run.servers ? `${run.servers.online}/${run.servers.total}` : '—', run.servers?.offline ? `${run.servers.offline} ${esc(t('offline'))}` : esc(t('fleet healthy')), run.servers?.offline ? 'bad' : '', '#/servers')}
    ${kpi('Open incidents', d.incidentsOpen, d.chain.ok ? `${esc(t('record intact'))} ✓` : esc(t('record broken')), d.incidentsOpen ? 'bad' : '', '#/incidents')}
  </div>

  <div class="lanes">
    <div class="panel lane-panel">
      <div class="lane-head"><h2>${esc(t('What the machines are doing'))}</h2><span class="lane-note">${m.runsToday} ${esc(t('pieces of work today'))}</span></div>
      <div class="rows" data-keep-scroll style="max-height:460px;overflow:auto">${activity || `<div class="empty">${esc(t('Quiet so far today.'))}</div>`}</div>
    </div>
    <div class="stack">
      <div class="panel lane-panel people">
        <div class="lane-head"><h2>${esc(t('Waiting on a person'))}</h2><a class="lane-note" href="#/approvals">${esc(t('See all'))} →</a></div>
        <div class="rows">${waitingRows || `<div class="empty">${esc(t('Nothing is waiting on a person. The company is running on its own.'))}</div>`}</div>
      </div>
      ${d.people.crew ? `<div class="panel lane-panel people">
        <div class="lane-head"><h2>${esc(t('The team'))}</h2><a class="lane-note" href="#/crew">${esc(t('Workforce command'))} →</a></div>
        <div class="inline" style="margin-bottom:6px">
          <span class="chip">${d.people.crew.people} ${esc(t('people'))}</span>
          <span class="chip ${d.people.crew.overdue ? 'chip-bad' : ''}">${d.people.crew.overdue} ${esc(t('overdue'))}</span>
          <span class="chip ${d.people.crew.blocked ? 'chip-warn' : ''}">${d.people.crew.blocked} ${esc(t('blocked'))}</span>
          <span class="chip">${d.people.crew.checkedInToday} ${esc(t('checked in today'))}</span>
        </div>
        <div class="rows">${team || `<div class="empty">${esc(t(d.people.crew.people ? 'Everyone is on track.' : 'No employees on the roster yet.'))}</div>`}</div>
      </div>` : ''}
    </div>
  </div>

  <div class="grid grid-3">
    <div class="panel">
      <div class="panel-title">${esc(t('Being built'))}<a class="btn btn-sm btn-ghost" href="#/forge">${esc(t('Factory'))} →</a></div>
      <div class="rows">${projects || emptyCta('Nothing being built yet', 'Start a project and an AI engineer writes the first version with you.', hasPermC('forge.manage') ? `<a class="btn btn-primary btn-sm" href="#/forge?new=1">${esc(t('New software project'))}</a>` : '')}</div>
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Servers'))}<a class="btn btn-sm btn-ghost" href="#/servers">${esc(t('Fleet'))} →</a></div>
      <div class="rows">${fleet || emptyCta('No servers yet', 'Add a VPS by its address and an SSH key, or this machine itself.', hasPermC('servers.manage') ? `<a class="btn btn-primary btn-sm" href="#/servers?new=1">${esc(t('Add a server'))}</a>` : '')}</div>
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('Watching'))}<a class="btn btn-sm btn-ghost" href="#/monitors">${esc(t('Monitoring'))} →</a></div>
      <div class="rows">${checks || emptyCta('Nothing watched yet', 'Every site you deploy is watched automatically. You can add any URL or port too.', hasPermC('monitors.manage') ? `<a class="btn btn-sm" href="#/monitors?new=1">${esc(t('Watch something'))}</a>` : '')}</div>
      ${(run.targets || []).length ? `<div class="panel-title" style="margin-top:16px">${esc(t('Deployments'))}</div><div class="rows">${run.targets.map((tg) => `<a class="row" href="#/deploys/${tg.id}">${dot(tg.state)}<div class="row-main"><div class="row-title">${esc(tg.name)}</div><div class="row-meta">${tg.url ? esc(tg.url) : ''}</div></div>${tg.last ? stateTag(tg.last.state) : ''}</a>`).join('')}</div>` : ''}
    </div>
  </div>`;
  wireActs(view, api, toast, renderHQ);
}
