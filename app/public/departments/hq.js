// Home — the command deck: how the company is doing, where it touches the
// world, and what it needs from you.
//
// The top is the deck: the day's brief written from the record, the globe with
// every country the company deals with, the health index, the next mission
// and the person's own pinned places. It is mounted once and updated in place
// when the page refreshes itself, so the globe keeps turning instead of being
// redrawn every fifteen seconds. Below it, the two lanes the whole design is
// about — what the machines are doing, what is waiting on a person — and
// what is being built and what is running.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC, currentUser } from '../state/session.js';
import { t, lang } from '/i18n.js';
import { kpi, dot, who, bar, strip, ago, act, wireActs, emptyCta, stateTag } from '../components/ui.js';
import { whatsNewPanel, wireWhatsNew } from '../components/whatsnew.js';
import { mountGlobe } from '../views/globe.js';
import { countryName, localTime } from '../components/geo.js';
import { openCapture, pinLabel as label, knownPlace } from '../core/command.js';
import { globeLayers } from './command.js';
import { wx, aqiBand } from './horizon.js';

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

let deck = null;

const PILLAR_COLOR = { money: 'var(--sx-human-bright)', operations: 'var(--sx-info)', people: 'var(--sx-human)', ai: 'var(--sx-ai)', governance: 'var(--sx-ok)' };
const bandTone = (b) => ({ strong: 'var(--sx-ok)', steady: 'var(--sx-ai)', strained: 'var(--sx-human-bright)', critical: 'var(--sx-bad)' }[b] || 'var(--sx-faint)');

function heroCopy(d, b, name, today) {
  const lines = (b?.lines || []).slice(0, 6);
  return `
    <div class="deck-eyebrow"><span class="m-live" aria-hidden="true"></span>${esc(t('Live'))} · ${esc(today)}${d.company && d.company !== 'this company' ? ` · ${esc(d.company)}` : ''}</div>
    <h2 class="deck-hello">${esc(greeting())}${name ? `, <em>${esc(name)}</em>` : ''}.</h2>
    <p class="deck-sub">${b?.calm ? `<span class="deck-calm">${esc(t('Everything is in hand.'))}</span> ` : ''}${esc(t(lines.length ? 'This is what the record says this morning:' : 'Nothing in the record needs you right now. The company is running on its own.'))}</p>
    ${lines.length ? `<ul class="deck-brief">${lines.map((l) => `<li><a class="t-${esc(l.tone || '')}" href="${esc(l.href)}"><b>${l.count}</b><span>${esc(t(l.text))}</span></a></li>`).join('')}</ul>` : ''}
    <div class="deck-actions">
      ${d.people.waiting ? `<a class="btn btn-human" href="#/approvals">${esc(t('Decide what waits'))} · ${d.people.waiting}</a>` : ''}
      <button type="button" class="btn btn-primary" data-capture>＋ ${esc(t('Capture'))} <kbd class="m-k">N</kbd></button>
      ${hasPermC('missions.view') ? `<a class="btn" href="#/missions">${esc(t('Missions'))}</a>` : ''}
    </div>`;
}

function globeChrome(g) {
  if (!g) return '';
  const top = [g.home, ...(g.countries || []).map((c) => c.code).filter((c) => c !== g.home)].filter(Boolean).slice(0, 4);
  const clocks = top.map((c) => ({ c, time: localTime(c, lang) })).filter((x) => x.time);
  return `<div class="globe-clocks" aria-label="${esc(t('Local times'))}">${clocks.map((x) => `<span>${esc(countryName(x.c, lang))}<b>${esc(x.time)}</b></span>`).join('')}</div>
    <div class="globe-legend"><span><i style="background:var(--g-home)"></i>${esc(t('Home'))}</span><span><i style="background:var(--g-lit)"></i>${g.totals.countries} ${esc(t('countries in the record'))}</span><span><i style="background:var(--g-city)"></i>${esc(t('night side'))}</span>${g.totals.payments ? `<span><i style="background:var(--g-arc)"></i>${g.totals.payments} ${esc(t('payments'))}</span>` : ''}${g.home ? '' : ` · <a href="#/settings">${esc(t('Set where the company is run from'))}</a>`}</div>`;
}

function ring(score, band) {
  const C = 2 * Math.PI * 70;
  const off = score == null ? C : C * (1 - score / 100);
  return `<div class="ring"><svg viewBox="0 0 168 168" aria-hidden="true" focusable="false"><defs><linearGradient id="m-ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--sx-ai)"/><stop offset="1" stop-color="${bandTone(band)}"/></linearGradient></defs>
    <circle class="ring-track" cx="84" cy="84" r="70"/><circle class="ring-val" cx="84" cy="84" r="70" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>
    <div class="ring-num"><div><b data-count>${score ?? '—'}</b><span>${esc(t(band || 'unknown'))}</span></div></div></div>`;
}

function deckRow(b) {
  const h = b?.health || {};
  const m = b?.missions || {};
  const pins = (b?.prefs?.pins || []).filter(knownPlace);
  return `
    ${hasPermC('healthindex.view') ? `<a class="panel" href="#/healthindex" style="text-decoration:none;color:inherit">
      <div class="panel-title">${esc(t('Health index'))}</div>${ring(h.score, h.band)}
      ${h.focus ? `<p class="sub" style="text-align:center;margin-top:10px">${esc(t('Dragging it'))}: <b>${esc(t(h.focus.label))}</b></p>` : ''}</a>` : ''}
    <div class="panel">
      <div class="panel-title">${esc(t('The five pillars'))}</div>
      <div class="pillars">${(h.pillars || []).map((p) => `<div class="pillar"><span>${esc(t(p.label))}</span><i style="--w:${p.score ?? 0}%;--c:${PILLAR_COLOR[p.id]}"></i><b>${p.score ?? '—'}</b></div>`).join('')}</div>
      ${pins.length ? `<div class="panel-title" style="margin-top:20px">${esc(t('Pinned'))}</div><div class="pins">${pins.map((x) => `<a class="pin" href="${esc(x)}">${esc(label(x))}</a>`).join('')}</div>` : `<p class="sub" style="margin-top:16px">${esc(t('Pin the places you use most with the star at the top of any page, or press F.'))}</p>`}
    </div>
    <div class="panel mission-track">
      <div class="panel-title">${esc(t('Missions'))}<a class="btn btn-sm btn-ghost" href="#/missions">${m.done ?? 0}/${m.total ?? 0} →</a></div>
      <div class="m-bar"><i style="--w:${m.pct || 0}%"></i></div>
      ${m.next ? `<a class="mission-next" href="${esc(m.next.step?.href || '#/missions')}"><span aria-hidden="true" style="font-size:22px">◈</span><span><small>${esc(t('Next'))} · ${esc(t(m.next.title))}</small>${esc(t(m.next.step?.title || ''))}</span></a>`
        : `<p class="deck-calm">${esc(t('Every mission is complete.'))}</p>`}
      <p class="sub">${esc(t('Each step is checked against the record, so a mission is done when the company has done it.'))}</p>
    </div>`;
}

/**
 * The world wire: the home currency, the next day off, the weather at home,
 * and earthquakes near the company's places — from the live-data cache, so
 * the home page never waits on a service out there.
 */
function wireStrip(w) {
  if (!w || w.empty) {
    return hasPermC('livedata.manage')
      ? `<a class="wire wire-off" href="#/livedata"><span class="wire-tag">${esc(t('Live data'))}</span><span class="wire-cells"><span class="wire-cell">${esc(t('Switch on exchange rates, holidays, weather and earthquakes for the places you work'))} →</span></span></a>`
      : '';
  }
  const loc = lang === 'ar' ? 'ar' : 'en-US';
  const n = (x, d) => Number(x).toLocaleString(loc, { maximumFractionDigits: d });
  const cells = [];
  for (const r of w.rates || []) {
    cells.push(`<span class="wire-cell"><small class="ltr">USD/${esc(r.code)}</small><b class="ltr">${n(r.perUsd, r.perUsd > 100 ? 0 : 4)}</b>${r.change90 != null ? `<i class="${r.change90 > 0 ? 'up' : 'down'}">${r.change90 > 0 ? '▲' : '▼'} ${n(Math.abs(r.change90), 1)}% · ${esc(t('90 days'))}</i>` : ''}</span>`);
  }
  if (w.weather) {
    const x = wx(w.weather.code);
    cells.push(`<span class="wire-cell"><small>${esc(countryName(w.home, lang))}</small><b>${x.g} <span class="ltr">${Math.round(w.weather.temp)}°</span></b><i>${esc(t(x.w))}</i></span>`);
  }
  if (w.day) {
    const d = w.day;
    const hijri = lang === 'ar' ? `${n(d.hijri.day, 0)} ${d.hijri.monthAr || ''}` : `${d.hijri.day} ${d.hijri.monthEn || ''}`;
    cells.push(`<span class="wire-cell"><small>${esc(t(d.next?.name || ''))} · ${esc(t('next prayer'))}</small><b class="ltr">${esc(d.next?.at || '—')}</b><i dir="auto">${esc(hijri)}</i></span>`);
    if (d.inRamadan) cells.push(`<span class="wire-cell"><small>${esc(t('Ramadan'))}</small><b>☾</b><i>${esc(t('Iftar'))} <span class="ltr">${esc(d.timings.Maghrib)}</span></i></span>`);
    else if (d.ramadanIn != null && d.ramadanIn >= 0 && d.ramadanIn <= 120) cells.push(`<span class="wire-cell"><small>${esc(t('Ramadan begins in'))}</small><b class="ltr">${n(d.ramadanIn, 0)}</b><i>${esc(t('days'))}</i></span>`);
  }
  if (w.air?.aqi != null) cells.push(`<span class="wire-cell ${aqiBand(w.air.aqi) === 'aq-good' || aqiBand(w.air.aqi) === 'aq-mod' ? '' : 'alert'}"><small>${esc(t('Air at home'))}</small><b class="ltr">${n(w.air.aqi, 0)}</b><i>AQI</i></span>`);
  if (w.holiday) {
    const day = new Date(`${w.holiday.date}T12:00:00Z`).toLocaleDateString(loc, { day: 'numeric', month: 'short' });
    cells.push(`<span class="wire-cell"><small>${esc(t('Next day off'))}</small><b dir="auto">${esc(lang === 'ar' && w.holiday.localName ? w.holiday.localName : w.holiday.name)}</b><i>${esc(day)} · ${esc(countryName(w.holiday.country, lang))}</i></span>`);
  }
  cells.push(`<span class="wire-cell ${w.quakesNear ? 'alert' : ''}"><small>${esc(t('Earthquakes near your places'))}</small><b>${w.quakesNear}</b><i>${esc(t('this week'))}</i></span>`);
  if (w.eventsNear) cells.push(`<span class="wire-cell alert"><small>${esc(t('Natural events near'))}</small><b>${w.eventsNear}</b><i>${esc(t('still open'))}</i></span>`);
  return `<a class="wire ${w.live ? '' : 'wire-paused'}" href="#/livedata"><span class="wire-tag"><span class="m-live" aria-hidden="true"></span>${esc(t(w.live ? 'Live data' : 'Live data · off'))}</span><span class="wire-cells">${cells.join('')}</span></a>`;
}

export async function renderHQ() {
  const canGlobe = hasPermC('globe.view');
  const [d, b, g] = await Promise.all([
    api('/api/hq'),
    api('/api/deck/brief').catch(() => null),
    canGlobe ? Promise.all([api('/api/globe'), globeLayers()]).then(([x, l]) => ({ ...x, ...l })).catch(() => null) : Promise.resolve(null),
  ]);
  const m = d.machines;
  const run = d.run;
  const sitesUp = run.monitor ? `${run.monitor.up}/${run.monitor.total}` : '—';
  const name = d.greetingName || currentUser?.displayName || '';
  const today = new Date().toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const quick = [
    hasPermC('appbuilder.manage') ? `<a class="btn btn-primary" href="#/appbuilder">✦ ${esc(t('Build an app from an idea'))}</a>` : '',
    hasPermC('forge.view') ? `<a class="btn" href="#/studio">⌨ ${esc(t('Open Dev Studio'))}</a>` : '',
    hasPermC('forge.manage') ? `<a class="btn" href="#/forge?new=1">＋ ${esc(t('New software project'))}</a>` : '',
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

  const mounted = deck && view.contains(deck.root);
  if (!mounted) {
    deck?.globe?.destroy();
    view.innerHTML = `
    <section class="deck" id="deck" aria-label="${esc(t('Command deck'))}">
      <div class="deck-hero">
        <div class="deck-copy" id="deck-copy"></div>
        ${g ? `<div class="deck-globe"><div class="globe-host" id="deck-globe"></div><div id="deck-globe-chrome"></div><div class="globe-tip" id="deck-tip" hidden></div></div>` : ''}
      </div>
      <div id="deck-wire"></div>
      <div class="deck-row" id="deck-row"></div>
    </section>
    <div id="hq-rest" style="display:grid;gap:20px"></div>`;
    deck = { root: $('#deck'), globe: null, data: g };
    if (g) {
      const tip = $('#deck-tip');
      deck.globe = mountGlobe($('#deck-globe'), {
        data: g,
        onHover: (code, at) => {
          if (!code || !at) { tip.hidden = true; return; }
          const c = (deck.data?.countries || []).find((x) => x.code === code);
          const bits = c ? [c.parties && `${c.parties} ${t('counterparties')}`, c.beneficiaries && `${c.beneficiaries} ${t('beneficiaries')}`, c.researched && `${c.researched} ${t('researched')}`, c.payments && `${c.payments} ${t('payments')}`].filter(Boolean) : [];
          const time = localTime(code, lang);
          tip.innerHTML = `<b>${esc(countryName(code, lang))}${code === deck.data?.home ? ` · ${esc(t('Home'))}` : ''}</b>${esc(bits.join(' · ') || t('nothing in the record yet'))}${time ? ` · ${esc(time)}` : ''}`;
          tip.style.left = `${at.x}px`; tip.style.top = `${at.y}px`; tip.hidden = false;
        },
        onPick: (code) => { location.hash = `#/globe?c=${code}`; },
      });
    }
  }
  deck.data = g;
  $('#deck-copy').innerHTML = heroCopy(d, b, name, today);
  $('#deck-copy [data-capture]')?.addEventListener('click', () => openCapture());
  $('#deck-wire').innerHTML = wireStrip(b?.wire);
  $('#deck-row').innerHTML = deckRow(b);
  if (g) { deck.globe?.update(g); $('#deck-globe-chrome').innerHTML = globeChrome(g); }

  $('#hq-rest').innerHTML = `
  ${quick ? `<div class="inline" style="flex-wrap:wrap;gap:8px">${quick}</div>` : ''}
  ${whatsNewPanel(hasPermC)}

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
  wireActs($('#hq-rest'), api, toast, renderHQ);
  wireWhatsNew($('#hq-rest'));
}
