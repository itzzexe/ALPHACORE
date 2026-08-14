// The world surface: every department behind that door.
//
// Grouped by the same mapping the navigation is drawn from, so a module
// boundary and a menu boundary cannot drift apart.

import { $, esc, money, money4, short, toast, view } from '../core/dom.js';
import { PLATFORM_ICONS, mktState, mktTab, renderWebPage, stateChip, verdictChip } from '../components/widgets.js';
import { actor, currentUser, hasPermC } from '../state/session.js';
import { api } from '../services/api.js';
import { connBtn, wireConnections } from '../components/common.js';
import { preBody, wireXact, xbtn } from '../components/chrome.js';
import { tile } from '../components/tile.js';
import { t, lang } from '/i18n.js';

export async function renderDeliverability() {
  const d = await api('/api/deliverability');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Whether mail arrives, or silently goes to spam</div>
    <div class="map-legend">An unsigned message from a domain with no policy goes to spam, and spam is
      indistinguishable from "they ignored us" in every report this company will produce. Nothing fails, the send
      is recorded as successful, and the pipeline reports a healthy rate into a void.</div>
    <div class="form-inline" style="margin-top:10px">
      <span class="chip ${d.domain ? 'chip-ok' : 'chip-warn'}">${d.domain ? esc(d.domain) : 'no MAIL_DOMAIN set'}</span>
      <span class="chip ${d.signing ? 'chip-ok' : 'chip-warn'}">${d.signing ? 'signing' : 'no key yet'}</span>
      <button class="btn" id="dl-pre">Check what the world can see</button>
    </div>
    ${d.publishThis ? `<div style="margin-top:12px">
      <div class="fl">Publish this in your DNS — it cannot be done from here</div>
      <div class="mono" style="font-size:11px;word-break:break-all;margin-top:4px">${esc(d.publishThis.name)} &nbsp; TXT &nbsp; ${esc(String(d.publishThis.value).slice(0, 120))}…</div>
    </div>` : ''}
    <div id="dl-out" style="margin-top:12px"></div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Whether a call may be recorded</div>
    <div class="map-legend">It depends on where the other party is, and getting it wrong is criminal in several
      places rather than a compliance finding. ${d.recording.countriesKnown} jurisdictions are listed, plus the
      ${d.recording.usAllPartyStates} US states that require everybody's consent — a single "US" answer is wrong
      often enough to be dangerous. Anywhere not listed gets <b>${esc(d.recording.defaultForUnknown)}</b>.
      A starting position from where the other party is, not legal advice.</div>
    <div class="form-inline" style="margin-top:10px">
      <div><label class="fl" for="dl-cc">Country</label><input type="text" id="dl-cc" placeholder="GB" maxlength="2"></div>
      <div><label class="fl" for="dl-rg">Region</label><input type="text" id="dl-rg" placeholder="WA" maxlength="3"></div>
      <button class="btn" id="dl-consent">May we record?</button>
    </div>
    <div id="dl-consent-out" style="margin-top:10px"></div>
  </div>`;
  $('#dl-pre')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/api/deliverability/preflight');
      $('#dl-out').innerHTML = `<div class="chip ${r.ok ? 'chip-ok' : 'chip-bad'}">${r.ok ? 'a receiver would accept this' : 'mail from here will be treated as suspicious'}</div>
        ${(r.findings || []).map((f) => `<div style="margin-top:6px"><b style="color:var(--${f.level === 'blocker' ? 'bad' : f.level === 'warn' ? 'warn' : 'ink-mute'})">${esc(f.what)}</b><div class="sub">${esc(f.why)}</div></div>`).join('')}
        <div class="sub" style="margin-top:10px">${esc(r.note || '')}</div>`;
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  });
  $('#dl-consent')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/deliverability/consent', { method: 'POST', body: { country: $('#dl-cc').value, region: $('#dl-rg').value || null } });
      $('#dl-consent-out').innerHTML = `<span class="chip ${r.mayRecord ? 'chip-ok' : 'chip-warn'}">${r.mayRecord ? 'one-party — may record' : 'all parties must agree'}</span>
        ${r.announcement ? `<div style="margin-top:8px">Say first: <b>"${esc(r.announcement)}"</b></div>` : ''}
        <div class="sub" style="margin-top:6px">${esc(r.note)}</div>`;
    } catch (err) { toast(err.message, true); }
  });
}
// The browser the employees drive. Every step is here with the picture it was
// looking at — you can read back exactly what it saw when it did the thing you
// are asking about, rather than taking its word for it.
export async function renderBrowser() {
  const b = await api('/api/browser');
  const row = (s) => `<tr>
      <td class="mono">${s.id}</td>
      <td>${esc(s.goal)}</td>
      <td><span class="chip ${{ done: 'chip-ok', waiting: 'chip-warn', running: 'chip-steel' }[s.state] || 'chip-dim'}">${esc(s.state)}</span></td>
      <td class="num">${s.steps || 0}</td>
      <td class="num">${esc(money4(s.cost_usd || 0))}</td>
      <td class="sub">${esc(String(s.outcome || '').slice(0, 90))}</td>
      <td><button class="btn btn-sm" data-open="${s.id}">Open</button></td>
    </tr>`;

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">
      <span>Give it something to do</span>
      <span class="chip ${b.live.attached ? 'chip-ok' : 'chip-bad'}">${b.live.attached ? esc(b.live.browser) : 'no browser attached'}</span>
    </div>
    ${b.live.attached ? '' : `<div class="empty" style="text-align:left">${esc(b.live.how)}</div>`}
    ${b.search && !b.search.configured ? `<div class="empty" style="text-align:left;border-color:#c0563a">
      <b>Do not point this at a search engine.</b> ${esc(b.search.why)}
      <div style="margin-top:6px"><a class="btn btn-sm" href="#/settings">Add a search key</a>
      <a class="btn btn-sm" href="#/hunt">Deep search</a></div>
    </div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
      <input id="br-goal" class="input" placeholder="What should it do? e.g. find the pricing page for acme.com and tell me the top tier" aria-label="What should the browser do?" style="flex:1;min-width:240px">
      <input id="br-url" class="input input-sm" placeholder="start at (optional)" aria-label="Start URL" style="width:190px">
      <button class="btn btn-primary" id="br-go" ${b.live.attached ? '' : 'disabled'}>Send it</button>
    </div>
    <div class="map-legend" style="margin-top:8px">
      It looks at the page, picks one action, does it, then looks again — up to ${b.maxSteps} steps or ${esc(money(b.maxUsd))}.
      You can watch it happen in the browser window; every step is kept here with its screenshot.
    </div>
    <div id="br-out" style="margin-top:12px"></div>
  </div>

  <div class="grid grid-3">
    <div class="panel tile"><div class="panel-title">Sessions</div><div class="big">${b.total}</div><div class="sub">${b.done} finished the job</div></div>
    <div class="panel tile ${b.waiting.length ? 'tile-warn' : ''}"><div class="panel-title">Waiting on you</div><div class="big">${b.waiting.length}</div><div class="sub">${b.waiting.length ? 'a step that leaves the building' : 'nothing held'}</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Spent</div><div class="big">${esc(money(b.spentUsd))}</div><div class="sub">across every session</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">What it will not do</div>
    ${b.refuses.map((r) => `<div class="meter-label"><span>${esc(r)}</span></div>`).join('')}
  </div>

  <div class="panel">
    <div class="panel-title">Sessions</div>
    ${b.recent.length
    ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Goal</th><th>State</th><th class="num">Steps</th><th class="num">Cost</th><th>Outcome</th><th></th></tr></thead><tbody>${b.recent.map(row).join('')}</tbody></table></div>`
    : '<div class="empty">nothing yet</div>'}
  </div>`;

  const out = $('#br-out');

  // One session, step by step: the picture, what it was thinking, what it did.
  const showSession = async (id) => {
    const s = await api(`/api/browser/${id}`);
    const step = (x) => `<div class="panel" style="margin:0 0 10px">
        <div class="panel-title">
          <span>${x.step}. ${esc(x.action || '')}</span>
          <span>${x.gated ? '<span class="chip chip-warn">held</span> ' : ''}${x.resolved ? `<span class="chip ${x.resolved === 'approved' ? 'chip-ok' : 'chip-bad'}">${esc(x.resolved)}</span>` : ''}</span>
        </div>
        <div class="sub mono" style="font-size:11px">${esc(String(x.url || '').slice(0, 120))}</div>
        ${x.thought ? `<p class="lede" style="margin:6px 0">${esc(x.thought)}</p>` : ''}
        ${x.gate_reason ? `<div class="meter-label" style="color:var(--warn)">${esc(x.gate_reason)}</div>` : ''}
        <div class="sub">${esc(x.result || '')}</div>
        ${x.screenshot ? `<img src="${esc(x.screenshot)}" alt="What the browser was looking at on step ${x.step}: ${esc(String(x.title || x.url || '').slice(0, 80))}" style="max-width:100%;border:1px solid var(--seam);border-radius:6px;margin-top:8px">` : ''}
        ${x.elements?.length ? `<details style="margin-top:8px"><summary class="sub">the ${x.elements.length} element(s) it was choosing from</summary>
          <div class="mono" style="font-size:11px;line-height:1.7;margin-top:6px">${x.elements.map((e) => `[${e.n}] ${esc(e.kind)} ${esc(e.label || '')}${e.onScreen ? '' : ' (below the fold)'}`).join('<br>')}</div>
        </details>` : ''}
      </div>`;
    out.innerHTML = `
      <div class="panel-title">
        <span>Session ${s.id} — ${esc(s.goal)}</span>
        <span class="chip ${s.state === 'done' ? 'chip-ok' : (s.state === 'waiting' ? 'chip-warn' : 'chip-dim')}">${esc(s.state)}</span>
      </div>
      ${s.state === 'waiting' ? `<div class="panel" style="border-color:var(--warn)">
        <div class="panel-title">This step needs you</div>
        <p class="lede">${esc(s.steps.filter((x) => x.gated && !x.resolved).slice(-1)[0]?.gate_reason || 'a step that leaves the building')}</p>
        <div><button class="btn btn-primary" id="br-ok">Approve this step</button> <button class="btn btn-bad" id="br-no">Refuse</button></div>
      </div>` : ''}
      ${s.steps.map(step).join('') || '<div class="empty">no steps yet</div>'}`;

    const ok = $('#br-ok');
    if (ok) {
      ok.addEventListener('click', async () => {
        // The approval is for the step on screen. The next one that commits
        // stops again — a session-wide yes would mean this screenshot
        // authorised every click after it.
        if (!confirm('Approve this one step? The next step that leaves the building will stop again.')) return;
        try { await api(`/api/browser/${id}/approve`, { method: 'POST', body: {} }); toast('approved — carrying on'); showSession(id); }
        catch (e) { toast(e.message, true); }
      });
      $('#br-no').addEventListener('click', async () => {
        const why = prompt('Why not?');
        if (why === null) return;
        try { await api(`/api/browser/${id}/refuse`, { method: 'POST', body: { why } }); toast('refused'); showSession(id); }
        catch (e) { toast(e.message, true); }
      });
    }
  };

  view.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => showSession(btn.dataset.open)));

  $('#br-go').addEventListener('click', async () => {
    const goal = $('#br-goal').value.trim();
    if (!goal) return;
    out.innerHTML = '<div class="empty">working — watch the browser window…</div>';
    try {
      const r = await api('/api/browser', { method: 'POST', body: { goal, startUrl: $('#br-url').value.trim() || null } });
      toast(r.say || r.state);
      await showSession(r.id);
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  });
  $('#br-goal').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#br-go').click(); });

  if (b.waiting.length) showSession(b.waiting[0].id);
}
export async function renderHelp() {
  const d = await api('/api/help');
  const rate = d.tickets ? Math.round((d.deflections / Math.max(1, d.tickets)) * 100) : 0;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Asked three times, unanswered', d.repeated, 'the queue that should decide what to write', d.repeated ? 'bad' : '')}
    ${tile('Published', d.published, `${d.drafts} in draft`)}
    ${tile('Read', d.views, 'article views')}
    ${tile('Tickets avoided', d.deflections, `${rate}% of the ticket volume`)}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Not support, and not the academy</div>
    <div class="map-legend">Support answers one person; the academy trains the workforce. This is written once for
      everybody who bought the product, and it is judged on the replies that never had to be written.</div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Questions with no article</div>
    ${d.gaps.length ? `<table class="tbl"><thead><tr><th>Question</th><th>Asked</th><th>State</th><th></th></tr></thead><tbody>
      ${d.gaps.map((g) => `<tr class="${g.seen >= 3 && g.state === 'open' ? 'row-bad' : ''}">
        <td>${esc(g.question)}</td><td>${g.seen}×</td><td>${esc(g.state)}</td>
        <td>${g.state === 'open' && hasPermC('help.write') ? `<button class="btn btn-sm" data-draft="${g.id}">draft it</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No gaps recorded. Sweep support to find them.</div>'}
    ${hasPermC('help.write') ? '<button class="btn" id="hc-sweep" style="margin-top:10px">Sweep support for repeated questions</button>' : ''}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Articles</div>
    ${d.articles.length ? `<table class="tbl"><thead><tr><th>Title</th><th>For</th><th>State</th><th>Views</th><th>Deflected</th><th></th></tr></thead><tbody>
      ${d.articles.map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.audience)}</td><td>${esc(a.state)}</td>
        <td>${a.views}</td><td>${a.deflections}</td>
        <td>${a.state !== 'published' && hasPermC('help.publish') ? `<button class="btn btn-sm" data-pub="${a.id}">publish</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Nothing written yet.</div>'}
  </div>`;
  $('#hc-sweep')?.addEventListener('click', async () => {
    try { const r = await api('/api/help/sweep', { method: 'POST', body: {} }); toast(`${r.newGaps} new, ${r.repeatedUnanswered} repeating`); renderHelp(); }
    catch (e) { toast(e.message, true); }
  });
  for (const b of view.querySelectorAll('[data-draft]')) {
    b.addEventListener('click', async () => {
      try { await api(`/api/help/gap/${b.dataset.draft}/draft`, { method: 'POST', body: {} }); toast('An employee is writing it'); renderHelp(); }
      catch (e) { toast(e.message, true); }
    });
  }
  for (const b of view.querySelectorAll('[data-pub]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Publishing puts this in front of customers in the company\'s name.')) return;
      try { await api(`/api/help/article/${b.dataset.pub}/publish`, { method: 'POST', body: {} }); renderHelp(); }
      catch (e) { toast(e.message, true); }
    });
  }
}
export async function renderStatus() {
  const d = await api('/api/status');
  const cls = { operational: '', maintenance: '', degraded: 'bad', partial: 'bad', major: 'bad' };
  view.innerHTML = `
  <div class="grid grid-3">
    ${tile('Overall', esc(d.overall), 'what a customer would see', cls[d.overall] || '')}
    ${tile('Open notices', d.notices.filter((n) => n.state !== 'resolved').length, 'said in public')}
    ${tile('Never mentioned', d.unannounced.length, 'open incidents with no public notice', d.unannounced.length ? 'bad' : '')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">A page that quietly goes green teaches people not to read it</div>
    <div class="map-legend">${esc(d.note)}</div>
  </div>
  ${d.unannounced.length ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">Open incidents customers have not been told about</div>
    <table class="tbl"><thead><tr><th>#</th><th>Title</th><th>Severity</th></tr></thead><tbody>
    ${d.unannounced.map((i) => `<tr class="row-bad"><td>${i.id}</td><td>${esc(i.title)}</td><td>${esc(i.sev || '')}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Components</div>
    ${d.components.length ? `<table class="tbl"><thead><tr><th>Name</th><th>State</th><th>Updated</th></tr></thead><tbody>
      ${d.components.map((c) => `<tr class="${cls[c.state] ? 'row-bad' : ''}"><td>${esc(c.name)}<div class="sub">${esc(c.descr || '')}</div></td>
        <td>${esc(c.state)}</td><td>${esc(c.updated_at)}</td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">No components yet.
      ${hasPermC('status.post') ? '<button class="btn" id="st-seed">Create the usual four</button>' : ''}</div>`}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">What the company promised</div>
    ${d.standing.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Target</th><th>Window</th><th>Credit</th><th>Measured by</th></tr></thead><tbody>
      ${d.standing.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.target_pct}%</td><td>${s.window_days}d</td><td>${s.credit_pct}%</td>
        <td>${s.measuredBy === 'nothing yet' ? '<span class="pill bad">nothing yet</span>' : esc(s.measuredBy)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No SLA recorded. A promise nobody wrote down is a promise nobody can keep.</div>'}
  </div>`;
  $('#st-seed')?.addEventListener('click', async () => {
    try { await api('/api/status/seed', { method: 'POST', body: {} }); renderStatus(); } catch (e) { toast(e.message, true); }
  });
}
export async function renderGrowth() {
  const d = await api('/api/growth');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Waiting on a decision', d.awaitingDecision.length, 'results in, nobody deciding', d.awaitingDecision.length ? 'bad' : '')}
    ${tile('Running', d.running, 'hypotheses in flight')}
    ${tile('Shipped', `${d.winRate}%`, 'of concluded experiments that changed something')}
    ${tile('Inconclusive', d.inconclusive, 'the most common honest answer')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">A hypothesis is required before the result</div>
    <div class="map-legend">Deciding what would count as success after seeing the numbers is how every experiment
      succeeds. An experiment also cannot be concluded without saying what happens next — ship it, drop it, or run it
      again bigger. ${esc(d.note)}</div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Experiments</div>
    ${d.experiments.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Moving</th><th>A</th><th>B</th><th>Uplift</th><th>Winner</th><th>Then what</th></tr></thead><tbody>
      ${d.experiments.map((x) => `<tr class="${x.state === 'running' && x.result_a !== null ? 'row-bad' : ''}">
        <td>${esc(x.name)}<div class="sub">${esc(x.hypothesis || '')}</div></td>
        <td>${esc(x.metric || '—')}</td><td>${esc(x.result_a ?? '—')}</td><td>${esc(x.result_b ?? '—')}</td>
        <td>${x.uplift === null || x.uplift === undefined ? '—' : `${x.uplift}%`}</td>
        <td>${esc(x.winner || '—')}</td><td class="sub">${esc(x.decision || '')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No growth experiment yet. The Lab compares prompts; this compares what a customer sees.</div>'}
    ${hasPermC('growth.run') ? `<div class="form-inline" style="margin-top:10px">
      <div><label class="fl" for="gr-name">Name</label><input id="gr-name" placeholder="Shorter sign-up"></div>
      <div style="flex:1"><label class="fl" for="gr-hyp">Hypothesis</label><input id="gr-hyp" placeholder="Removing the company field will raise completion, because it is the only optional field people stop at"></div>
      <div><label class="fl" for="gr-metric">Metric</label><input id="gr-metric" placeholder="signup completion"></div>
      <button class="btn" id="gr-add">Start</button>
    </div>
    <div class="form-inline">
      <div style="flex:1"><label class="fl" for="gr-a">Variant A</label><input id="gr-a" placeholder="the form as it is"></div>
      <div style="flex:1"><label class="fl" for="gr-b">Variant B</label><input id="gr-b" placeholder="without the company field"></div>
    </div>` : ''}
  </div>`;
  $('#gr-add')?.addEventListener('click', async () => {
    try {
      await api('/api/growth', { method: 'POST', body: {
        name: $('#gr-name').value, hypothesis: $('#gr-hyp').value, metric: $('#gr-metric').value,
        variantA: $('#gr-a').value, variantB: $('#gr-b').value,
      } });
      toast('Started'); renderGrowth();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------------------------------------------------------------------------
// The offices, drawn.
//
// The first version of this page was a floor plan with nobody identifiable on
// it: figures seven pixels tall, no names, and a colour key promising a mood
// indicator that was not there. It looked like a company and could not be used
// to watch one. What follows was rebuilt from a screenshot of that.
//
// Three things a person actually does here: see at a glance where everybody is
// and how they are; find one employee; read what was just said. Everything is
// arranged around those and nothing else.
//
// Drawn by hand in SVG. No sprite sheet, no icon font, no request to anybody —
// the console makes no external requests and that is checked, not intended.
// ---------------------------------------------------------------------------
export async function renderSupport() {
  const [tickets, stats, products] = await Promise.all([api('/api/tickets'), api('/api/support/stats'), api('/api/products')]);
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Inbound ticket (AI drafts — a human always sends)</div>
      <div class="form-inline">
        <div><label class="fl" for="tk-cust">Customer</label><input type="text" id="tk-cust"></div>
        <div><label class="fl" for="tk-cat">Category</label><input type="text" id="tk-cat" value="general"></div>
        <div><label class="fl" for="tk-prod">Product</label><select id="tk-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      </div>
      <div class="form-inline">
        <div style="flex:1"><label class="fl" for="tk-subj">Subject</label><input type="text" id="tk-subj"></div>
      </div>
      <div><label class="fl" for="tk-body">Message</label><textarea id="tk-body"></textarea></div>
        <button class="btn btn-primary form-go" id="tk-go">Receive</button>
    </div>
    <div class="panel">
      <div class="panel-title">Graduation ladder — ≥100 sent · ≥95% unedited; auto-recall &lt;90%</div>
      <table>
        <thead><tr><th>Category</th><th class="num">Sent</th><th class="num">Unedited</th><th class="num">Acceptance</th><th class="num">Escalated</th><th>Status</th></tr></thead>
        <tbody>${stats.map((s) => `
          <tr><td class="mono">${esc(s.category)}</td><td class="num">${s.sent}</td><td class="num">${s.unedited}</td>
          <td class="num">${s.acceptance !== null ? (s.acceptance * 100).toFixed(0) + '%' : '—'}</td>
          <td class="num">${s.escalated}</td>
          <td>${s.graduated ? '<span class="chip chip-ok">graduated</span>' : s.recalled ? '<span class="chip chip-bad">recalled</span>' : '<span class="chip chip-dim">draft-only</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No tickets yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
  ${tickets.map((t) => `
  <div class="panel">
    <div class="panel-title">
      <span>#${t.id} · ${esc(t.subject)} <span class="mono" style="letter-spacing:0;color:var(--ink-faint)">· ${esc(t.customer)} · ${esc(t.category)}</span></span>
      <span class="state state-${t.state === 'sent' || t.state === 'closed' ? 'done' : t.state === 'escalated' ? 'escalated' : t.state === 'draft_ready' ? 'awaiting_human' : 'running'}">${esc(t.state)}</span>
    </div>
    <div class="map-legend">
      ${t.product_id ? `<a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(t.product_id)}</a> ` : ''}
      ${t.incident_id ? `<a href="#/incidents" class="chip chip-bad" style="text-decoration:none">⚠ incident #${t.incident_id}</a>` : ''}
    </div>
    <pre class="json" style="max-height:120px">${esc(t.body)}</pre>
    ${!t.incident_id && t.state !== 'closed' ? `
      <div class="form-inline" style="margin:6px 0">
        <div style="flex:0.4"><select data-tsev="${t.id}"><option>SEV3</option><option>SEV2</option><option>SEV1</option><option>SEV4</option></select></div>
        <button class="btn btn-sm btn-bad" data-traise="${t.id}">Raise incident</button>
      </div>` : ''}
    ${['draft_ready', 'escalated'].includes(t.state) ? `
      <div style="margin-top:8px"><label class="fl">${t.state === 'escalated' ? 'Escalated — human writes/edits the reply' : 'AI draft — edit if needed, then send'}</label>
      <textarea data-tbody="${t.id}" style="min-height:110px">${esc(t.draft || '')}</textarea></div>
      <div class="form-inline" style="margin-top:6px">
        <button class="btn btn-ok" data-tsend="${t.id}">Send as ${esc(actor())}</button>
        <button class="btn btn-sm" data-tclose="${t.id}">Close without reply</button>
      </div>` : ''}
    ${t.state === 'sent' ? `<div class="map-legend">sent ${esc(t.sent_at)} · ${t.edited ? '<span style="color:var(--warn)">edited before send</span>' : '<span style="color:var(--ok)">accepted unedited</span>'}</div><pre class="json" style="max-height:140px">${esc(t.sent_body)}</pre>` : ''}
  </div>`).join('')}`;

  $('#tk-go').addEventListener('click', async () => {
    try {
      await api('/api/tickets', { method: 'POST', body: { customer: $('#tk-cust').value, category: $('#tk-cat').value, subject: $('#tk-subj').value, body: $('#tk-body').value, productId: $('#tk-prod').value || null } });
      toast('Ticket received — Support agent is drafting'); renderSupport();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-tsend]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/tickets/${b.dataset.tsend}/send`, { method: 'POST', body: { body: view.querySelector(`[data-tbody="${b.dataset.tsend}"]`).value, actor: actor() } }); toast('Reply sent by human'); renderSupport(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-tclose]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/tickets/${b.dataset.tclose}/close`, { method: 'POST', body: { actor: actor() } }); renderSupport(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-traise]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.traise;
    try {
      await api(`/api/tickets/${id}/incident`, { method: 'POST', body: { sev: view.querySelector(`[data-tsev="${id}"]`).value, commander: actor(), actor: actor() } });
      toast('Incident raised and linked'); renderSupport();
    } catch (e) { toast(e.message, true); }
  }));
}
export async function renderMarketing() {
  const [campaigns, products] = await Promise.all([api('/api/campaigns'), api('/api/products')]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New campaign — AI drafts the copy, a human approves before it goes live</div>
    <div class="form-inline">
      <div><label class="fl" for="cm-name">Name</label><input type="text" id="cm-name"></div>
      <div><label class="fl" for="cm-chan">Channel</label><select id="cm-chan" aria-label="Channel"><option>landing</option><option>email</option><option>paid</option><option>content</option><option>social</option></select></div>
      <div><label class="fl" for="cm-prod">Product</label><select id="cm-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="cm-budget">Budget $</label><input type="text" id="cm-budget" value="0"></div>
      <button class="btn btn-primary" id="cm-go">Create</button>
    </div>
    <div><label class="fl" for="cm-brief">Brief</label><textarea id="cm-brief" placeholder="Audience, promise, call to action…"></textarea></div>
  </div>
  ${campaigns.map((c) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(c.name)} <span class="chip chip-dim">${esc(c.channel)}</span>${c.product_id ? ` <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(c.product_id)}</a>` : ''}</span>
      <span><span class="state state-${c.state === 'live' ? 'done' : c.state === 'paused' ? 'failed' : c.state === 'pending_approval' ? 'awaiting_human' : 'running'}">${esc(c.state)}</span> ${connBtn('campaign', c.id)}</span>
    </div>
    <div class="map-legend">budget ${esc(money(c.budget_usd))} · spent ${esc(money(c.spent_usd))} · signups ${c.metrics.signups} · qualified ${c.metrics.qualified} · customers <a href="#/customers">${c.customers}</a>${c.approved_by ? ` · approved by ${esc(c.approved_by)}` : ''}</div>
    ${c.budget_usd > 0 ? `<div class="meter"><div class="meter-track"><div class="meter-fill ${c.spent_usd > c.budget_usd ? 'hot' : ''}" style="width:${Math.min(100, (c.spent_usd / c.budget_usd) * 100)}%"></div></div></div>` : ''}
    ${c.state === 'pending_approval' ? `
      <div style="margin-top:8px"><label class="fl">Copy — edit then approve (publishing is human-only)</label>
      <textarea data-cmcopy="${c.id}" style="min-height:100px">${esc(c.draft || '')}</textarea></div>
      <div style="margin-top:6px"><button class="btn btn-ok btn-sm" data-cmapprove="${c.id}">Approve → live</button></div>` : ''}
    ${['live', 'paused'].includes(c.state) ? `
      <div class="form-inline" style="margin-top:8px">
        <div><label class="fl">Spent $</label><input type="text" data-cmspent="${c.id}" value="${c.spent_usd}"></div>
        <div><label class="fl">Signups</label><input type="text" data-cmsign="${c.id}" value="${c.metrics.signups}"></div>
        <div><label class="fl">Qualified</label><input type="text" data-cmqual="${c.id}" value="${c.metrics.qualified}"></div>
        <button class="btn btn-sm" data-cmupd="${c.id}">Update</button>
        ${c.state === 'live' ? `<button class="btn btn-sm btn-bad" data-cmstate="${c.id}" data-to="paused">Pause</button>` : `<button class="btn btn-sm btn-ok" data-cmstate="${c.id}" data-to="live">Resume (human)</button>`}
        <button class="btn btn-sm" data-cmstate="${c.id}" data-to="done">Done</button>
      </div>` : ''}
    ${c.draft && c.state !== 'pending_approval' ? `<pre class="json" style="max-height:120px">${esc(c.draft)}</pre>` : ''}
  </div>`).join('') || ''}`;

  $('#cm-go').addEventListener('click', async () => {
    try {
      await api('/api/campaigns', { method: 'POST', body: { name: $('#cm-name').value, channel: $('#cm-chan').value, productId: $('#cm-prod').value || null, budgetUsd: Number($('#cm-budget').value) || 0, brief: $('#cm-brief').value, actor: actor() } });
      toast('Campaign created — Docs agent is drafting copy'); renderMarketing();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-cmapprove]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/campaigns/${b.dataset.cmapprove}/approve`, { method: 'POST', body: { copy: view.querySelector(`[data-cmcopy="${b.dataset.cmapprove}"]`).value, actor: actor() } }); toast('Live — approved by human'); renderMarketing(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-cmupd]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.cmupd;
    try { await api(`/api/campaigns/${id}/update`, { method: 'POST', body: { spentUsd: Number(view.querySelector(`[data-cmspent="${id}"]`).value), signups: Number(view.querySelector(`[data-cmsign="${id}"]`).value), qualified: Number(view.querySelector(`[data-cmqual="${id}"]`).value), actor: actor() } }); renderMarketing(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-cmstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/campaigns/${b.dataset.cmstate}/update`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderMarketing(); } catch (e) { toast(e.message, true); }
  }));
  wireConnections();
}
export async function renderSocial() {
  const [ov, posts, campaigns] = await Promise.all([
    api('/api/studio'), api('/api/posts'), api('/api/campaigns').catch(() => []),
  ]);
  const canM = hasPermC('social.manage');
  const pb = ov.postsByState || {};
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Channels</div><div class="big">${ov.channels.filter((c) => c.state === 'connected').length}</div><div class="sub">${ov.followers} followers total</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Scheduled</div><div class="big">${pb.scheduled || 0}</div><div class="sub">${pb.draft_ready || 0} drafts awaiting review</div></div>
    <div class="panel tile"><div class="panel-title">Published</div><div class="big">${pb.published || 0}</div><div class="sub">reach ${ov.reach} · humans pressed every button</div></div>
    <div class="panel tile ${pb.drafting ? 'tile-warn' : ''}"><div class="panel-title">Drafting now</div><div class="big">${pb.drafting || 0}</div><div class="sub">AGT-SMM-001 at work → <a href="#/workforce">workforce</a></div></div>
  </div>
  ${canM ? `<div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Connect a channel</div>
      <div class="form-inline">
        <div><label class="fl" for="ch-platform">Platform</label><select id="ch-platform" aria-label="Platform"><option>x</option><option>linkedin</option><option>instagram</option><option>facebook</option><option>tiktok</option><option>youtube</option><option>telegram</option></select></div>
        <div><label class="fl" for="ch-handle">Handle</label><input type="text" id="ch-handle" placeholder="@alphacore"></div>
        <div style="flex:0.5"><label class="fl" for="ch-followers">Followers</label><input type="text" id="ch-followers" value="0"></div>
        <button class="btn btn-primary" id="ch-go">Connect</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">New post — the SMM agent drafts, you publish</div>
      <div class="form-inline">
        <div><label class="fl" for="po-channel">Channel</label><select id="po-channel" aria-label="Channel"><option value="">any</option>${ov.channels.map((c) => `<option value="${c.id}">${esc(c.platform)} @${esc(c.handle)}</option>`).join('')}</select></div>
        <div><label class="fl" for="po-kind">Kind</label><select id="po-kind" aria-label="Kind"><option>post</option><option>thread</option><option>reel-script</option><option>story</option></select></div>
        <div><label class="fl" for="po-camp">Campaign</label><select id="po-camp" aria-label="Campaign"><option value="">—</option>${campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="po-go">Draft it</button>
      </div>
      <div><label class="fl" for="po-brief">Brief</label><textarea id="po-brief" placeholder="What should this post say / achieve?"></textarea></div>
    </div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Channel register</div>
    <div class="agent-meta">${ov.channels.map((c) => `
      <span class="chip ${c.state === 'connected' ? 'chip-ok' : 'chip-dim'}" title="${c.posts} posts · ${c.published} published">
        ${PLATFORM_ICONS[c.platform] || '●'} ${esc(c.platform)} @${esc(c.handle)} · ${c.followers}
        ${canM && c.state === 'connected' ? `<a href="#" data-ch-pause="${c.id}" style="color:var(--warn);margin-left:4px" title="pause">⏸</a>` : ''}
        ${canM && c.state !== 'connected' ? `<a href="#" data-ch-resume="${c.id}" style="color:var(--ok);margin-left:4px" title="reconnect">▶</a>` : ''}
      </span>`).join('') || '<span class="empty">No channels connected yet.</span>'}
    </div>
  </div>
  ${ov.upcoming.length ? `<div class="panel">
    <div class="panel-title">Publishing calendar — next up</div>
    ${ov.upcoming.map((p) => `<div class="round"><div class="round-body" style="display:flex;justify-content:space-between;gap:10px">
      <span><span class="chip chip-steel">${esc(p.platform || 'any')}</span> ${esc(short(p.draft || p.brief, 90))}</span>
      <span class="mono" style="color:var(--warn)">${esc(p.schedule_at || '')}</span>
    </div></div>`).join('')}
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Posts</div>
    ${posts.map((p) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span>
            <span class="chip chip-steel">${esc(p.channel ? `${p.channel.platform} @${p.channel.handle}` : 'any channel')}</span>
            <span class="chip chip-dim">${esc(p.kind)}</span>
            ${p.campaign_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/marketing">campaign #${p.campaign_id}</a>` : ''}
            <span class="state state-${p.state === 'published' ? 'done' : p.state === 'scheduled' ? 'running' : p.state === 'draft_ready' ? 'awaiting_human' : p.state === 'cancelled' ? 'failed' : 'queued'}">${esc(p.state)}</span>
          </span>
          <span>${canM && ['draft_ready', 'scheduled'].includes(p.state) ? `
            <button class="btn btn-sm" data-po-sched="${p.id}">Schedule</button>
            <button class="btn btn-sm btn-ok" data-po-pub="${p.id}">Publish (as ${esc(currentUser?.username || 'me')})</button>
            <button class="btn btn-sm btn-bad" data-po-cancel="${p.id}">✕</button>` : ''}</span>
        </div>
        <div style="font-size:12.5px;margin:6px 0">${esc(p.draft || `(drafting…) ${short(p.brief, 80)}`)}</div>
        <div class="map-legend">
          ${(p.hashtags || []).map((h) => `<span class="chip chip-dim">${esc(h)}</span>`).join(' ')}
          ${p.best_time ? ` · best time: ${esc(p.best_time)}` : ''}
          ${p.state === 'published' ? ` · published by <b>${esc(p.published_by || '')}</b> ${esc((p.published_at || '').slice(0, 16))} · ♥ ${p.metrics.likes} ↺ ${p.metrics.shares} reach ${p.metrics.reach}${canM ? ` · <a href="#" data-po-metrics="${p.id}">update metrics</a>` : ''}` : ''}
        </div>
      </div></div>`).join('') || '<div class="empty">No posts yet — brief the SMM agent above.</div>'}
  </div>`;
  if (!canM) return;
  $('#ch-go')?.addEventListener('click', async () => {
    try { await api('/api/channels', { method: 'POST', body: { platform: $('#ch-platform').value, handle: $('#ch-handle').value, followers: Number($('#ch-followers').value) || 0 } }); toast('Channel connected'); renderSocial(); }
    catch (e) { toast(e.message, true); }
  });
  $('#po-go')?.addEventListener('click', async () => {
    try {
      await api('/api/posts', { method: 'POST', body: { channelId: $('#po-channel').value ? Number($('#po-channel').value) : null, kind: $('#po-kind').value, campaignId: $('#po-camp').value ? Number($('#po-camp').value) : null, brief: $('#po-brief').value } });
      toast('SMM agent is drafting — the post appears below'); renderSocial();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-ch-pause]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await api(`/api/channels/${b.dataset.chPause}/update`, { method: 'POST', body: { state: 'paused' } }); renderSocial(); } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-ch-resume]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await api(`/api/channels/${b.dataset.chResume}/update`, { method: 'POST', body: { state: 'connected' } }); renderSocial(); } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-po-sched]').forEach((b) => b.addEventListener('click', async () => {
    const when = prompt('Schedule for (YYYY-MM-DD HH:MM):');
    if (!when) return;
    try { await api(`/api/posts/${b.dataset.poSched}/schedule`, { method: 'POST', body: { scheduleAt: when } }); toast('Scheduled'); renderSocial(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-po-pub]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/posts/${b.dataset.poPub}/publish`, { method: 'POST', body: {} }); toast(`Published — on the record as ${actor()}`); renderSocial(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-po-cancel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/posts/${b.dataset.poCancel}/cancel`, { method: 'POST', body: {} }); renderSocial(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-po-metrics]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    const likes = prompt('Likes:'); const shares = prompt('Shares:'); const reach = prompt('Reach:');
    try { await api(`/api/posts/${b.dataset.poMetrics}/metrics`, { method: 'POST', body: { likes: likes || null, shares: shares || null, reach: reach || null } }); renderSocial(); } catch (err) { toast(err.message, true); }
  }));
}
// ---------- Content Studio ----------
export async function renderContent() {
  const items = await api('/api/content');
  const canM = hasPermC('content.manage');
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">Brief the Content Creator — articles, scripts, emails, landing copy</div>
    <div class="form-inline">
      <div><label class="fl" for="ct-kind">Kind</label><select id="ct-kind" aria-label="Kind"><option>article</option><option>blog</option><option>video-script</option><option>email</option><option>landing</option><option>doc</option></select></div>
      <div style="flex:2"><label class="fl" for="ct-title">Title</label><input type="text" id="ct-title"></div>
    </div>
    <div><label class="fl" for="ct-brief">Brief</label><textarea id="ct-brief" placeholder="Audience, angle, key points, call to action…"></textarea></div>
      <button class="btn btn-primary form-go" id="ct-go">Draft it</button>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Content pipeline — AI drafts · human approves · human publishes</div>
    ${items.map((c) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><span class="chip chip-dim">${esc(c.kind)}</span> <b>${esc(c.title)}</b>
            <span class="state state-${c.state === 'published' ? 'done' : c.state === 'draft_ready' ? 'awaiting_human' : c.state === 'approved' ? 'running' : c.state === 'cancelled' ? 'failed' : 'queued'}">${esc(c.state)}</span></span>
          <span>${canM && c.state === 'draft_ready' ? `
            <button class="btn btn-sm btn-ok" data-ct-v="${c.id}" data-to="approved">Approve</button>
            <button class="btn btn-sm btn-bad" data-ct-v="${c.id}" data-to="cancelled">Reject</button>` : ''}
            ${canM && c.state === 'approved' ? `<button class="btn btn-sm btn-ok" data-ct-v="${c.id}" data-to="published">Publish (as ${esc(currentUser?.username || 'me')})</button>` : ''}</span>
        </div>
        ${c.draft ? `<div style="font-size:12.5px;margin:6px 0;white-space:pre-wrap">${esc(short(c.draft, 600))}</div>` : `<div class="map-legend">drafting… brief: ${esc(short(c.brief, 100))}</div>`}
        <div class="map-legend">
          ${(c.seo || []).map((k) => `<span class="chip chip-dim">${esc(k)}</span>`).join(' ')}
          ${c.product_id ? ` · <a href="#/products">product ${esc(c.product_id)}</a>` : ''}
          ${c.approved_by ? ` · approved by <b>${esc(c.approved_by)}</b>` : ''}
        </div>
      </div></div>`).join('') || '<div class="empty">Nothing in the studio yet.</div>'}
  </div>`;
  if (!canM) return;
  $('#ct-go')?.addEventListener('click', async () => {
    try { await api('/api/content', { method: 'POST', body: { kind: $('#ct-kind').value, title: $('#ct-title').value, brief: $('#ct-brief').value } }); toast('Content agent is writing'); renderContent(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-ct-v]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/content/${b.dataset.ctV}/verdict`, { method: 'POST', body: { verdict: b.dataset.to } }); toast(`Content ${b.dataset.to}`); renderContent(); } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Design Studio ----------
export async function renderDesign() {
  const designs = await api('/api/designs');
  const canM = hasPermC('design.manage');
  const svgSrc = (svg) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">Brief the Designer — logos, banners, UI mockups, brand assets: designs for everything, delivered as real SVG files</div>
    <div class="form-inline">
      <div><label class="fl" for="ds-kind">Kind</label><select id="ds-kind" aria-label="Kind"><option>social-visual</option><option>logo</option><option>banner</option><option>ui</option><option>brand</option><option>diagram</option></select></div>
      <div style="flex:2"><label class="fl" for="ds-title">Title</label><input type="text" id="ds-title"></div>
    </div>
    <div><label class="fl" for="ds-brief">Brief</label><textarea id="ds-brief" placeholder="Purpose, mood, colors, text to include, dimensions…"></textarea></div>
      <button class="btn btn-primary form-go" id="ds-go">Design it</button>
  </div>` : ''}
  <div class="grid grid-3">
    ${designs.map((d) => `
    <div class="panel agent-card">
      <div class="agent-head">
        <span><span class="chip chip-dim">${esc(d.kind)}</span> <b>${esc(short(d.title, 30))}</b></span>
        <span class="state state-${d.state === 'approved' ? 'done' : d.state === 'draft_ready' ? 'awaiting_human' : d.state === 'cancelled' ? 'failed' : 'queued'}">${esc(d.state)}</span>
      </div>
      ${d.svg ? `<img class="design-thumb" alt="${esc(d.title)}" src="${svgSrc(d.svg)}">` : '<div class="empty" style="padding:30px 0">designing…</div>'}
      ${d.spec ? `<div class="map-legend" style="margin-top:6px">${esc(short(d.spec, 120))}</div>` : ''}
      <div class="map-legend" style="margin-top:6px">
        ${d.file_ref ? `<a href="#/artifacts/${encodeURIComponent(d.file_ref)}">📁 ${esc(d.file_ref)}</a> · ` : ''}
        ${d.approved_by ? `approved by <b>${esc(d.approved_by)}</b>` : ''}
        ${canM && d.state === 'draft_ready' ? `<button class="btn btn-sm btn-ok" data-ds-ok="${d.id}" style="margin-top:6px">Approve</button>` : ''}
      </div>
    </div>`).join('') || '<div class="empty">No designs yet — brief the Designer above.</div>'}
  </div>`;
  if (!canM) return;
  $('#ds-go')?.addEventListener('click', async () => {
    try { await api('/api/designs', { method: 'POST', body: { kind: $('#ds-kind').value, title: $('#ds-title').value, brief: $('#ds-brief').value } }); toast('Designer is working — the SVG lands below and on disk'); renderDesign(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-ds-ok]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/designs/${b.dataset.dsOk}/approve`, { method: 'POST', body: {} }); toast('Design approved & archived'); renderDesign(); } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Integrations ----------
export async function renderConnectors() {
  const d = await api('/api/connectors');
  const canM = hasPermC('connectors.manage');
  const row = (c) => `
    <tr>
      <td><b>${esc(c.label)}</b><div class="sub mono">${esc(c.id)}</div></td>
      <td>${stateChip(c.state)}</td>
      <td class="mono">${esc(c.driverInfo?.auth || '—')}</td>
      <td class="sub">${(c.scopes || []).slice(0, 4).map((s) => `<span class="chip chip-dim">${esc(s)}</span>`).join(' ')}${c.scopes.length > 4 ? ` +${c.scopes.length - 4}` : ''}</td>
      <td class="mono">${(c.allowlist || []).join(', ') || '<span class="sub">anything</span>'}</td>
      <td class="num mono">${c.today}${c.blockedToday ? ` <span style="color:var(--bad)">/${c.blockedToday} blocked</span>` : ''}</td>
      <td>
        ${canM && c.state === 'disconnected' ? `<button class="btn btn-sm" data-connect="${esc(c.id)}">Connect</button>` : ''}
        ${canM && c.state === 'dry' ? xbtn(`/api/connectors/${c.id}/state`, { state: 'live' }, 'Arm it', 'btn-primary') : ''}
        ${canM && c.state === 'live' ? xbtn(`/api/connectors/${c.id}/state`, { state: 'dry' }, 'Back to dry') : ''}
        ${canM && c.state !== 'disconnected' ? xbtn(`/api/connectors/${c.id}/state`, { state: 'paused' }, 'Pause') : ''}
        ${canM && c.driverInfo?.auth === 'oauth2' ? `<button class="btn btn-sm" data-oauth="${esc(c.id)}">OAuth…</button>` : ''}
      </td>
    </tr>`;

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Services reachable', d.counts.total, `${d.counts.live} armed · ${d.counts.dry} in dry-run`)}
    ${tile('Live', d.counts.live, 'can actually touch the world', d.counts.live ? 'tile-ok' : '')}
    ${tile('Dry-run', d.counts.dry, 'everything runs except the part that leaves', d.counts.dry ? 'tile-warn' : '')}
    ${tile('Not connected', d.counts.disconnected, 'no credential handed over yet')}
  </div>

  <div class="panel">
    <div class="panel-title">Every service the company can reach</div>
    <table><thead><tr><th>Service</th><th>State</th><th>Auth</th><th>Can do</th><th>Allowlist</th><th>Today</th><th></th></tr></thead>
      <tbody>${d.connectors.map(row).join('')}</tbody></table>
    <div class="map-legend">A connector starts <b>disconnected</b>. Handing it a credential moves it to <b>dry-run</b>, where every call executes and is recorded and <b>nothing leaves the machine</b> — that is how an integration is proven before it is trusted. Arming it is a separate, deliberate act by a person.</div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Add any HTTP API — no code</div>
      ${canM ? `
      <div class="form-grid">
        <input id="hc-id" placeholder="id, e.g. supplier-portal">
        <input id="hc-label" placeholder="what it is called">
        <input id="hc-base" placeholder="https://api.example.com/v1">
        <input id="hc-allow" placeholder="allowlist: example.com, partner.iq">
        <textarea id="hc-ops" rows="5" placeholder='{"order.create": {"method": "POST", "path": "/orders", "targetFrom": "customer"}, "order.read": {"method": "GET", "path": "/orders/{id}"}}'></textarea>
        <button class="btn btn-primary" id="hc-add">Create the connector</button>
      </div>
      <div class="map-legend">Describe the operations and it becomes a connector with the same gate, allowlist and ledger as Gmail. Path templates take <span class="mono">{name}</span> from the arguments.</div>
      ` : '<div class="empty">connectors.manage required</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Drivers available</div>
      <table><thead><tr><th>Driver</th><th>Auth</th><th>Capabilities</th></tr></thead><tbody>
        ${d.drivers.map((x) => `<tr><td><b>${esc(x.label)}</b><div class="sub mono">${esc(x.id)}</div></td>
          <td class="mono">${esc(x.auth)}</td>
          <td class="sub">${x.capabilities.map((c) => `<span class="chip chip-dim">${esc(c)}</span>`).join(' ')}</td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Try a call by hand</div>
    <div class="form-inline">
      <select id="cc-conn" aria-label="Connector">${d.connectors.filter((c) => c.state !== 'disconnected').map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('') || '<option>connect something first</option>'}</select>
      <input id="cc-cap" placeholder="capability, e.g. mail.read" style="width:180px">
      <input id="cc-args" placeholder='{"query":"is:unread","max":3}' style="width:38%">
      <button class="btn btn-sm btn-primary" id="cc-go">Call</button>
    </div>
    <div id="cc-out"></div>
  </div>`;

  wireXact(renderConnectors);
  view.querySelectorAll('[data-connect]').forEach((b) => b.addEventListener('click', async () => {
    const secret = prompt(`Paste the credential for ${b.dataset.connect}.\nIt is encrypted before it is stored and never shown again.`);
    if (!secret) return;
    try { await api(`/api/connectors/${b.dataset.connect}/connect`, { method: 'POST', body: { secret } }); toast('Connected — in dry-run'); renderConnectors(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-oauth]').forEach((b) => b.addEventListener('click', async () => {
    const clientId = prompt('OAuth client id for ' + b.dataset.oauth);
    if (!clientId) return;
    const clientSecret = prompt('OAuth client secret (leave blank if the provider does not use one)') || '';
    try {
      const r = await api(`/api/connectors/${b.dataset.oauth}/authorize`, { method: 'POST', body: { clientId, clientSecret } });
      toast('Opening the provider…');
      window.open(r.url, '_blank', 'noopener');
    } catch (e) { toast(e.message, true); }
  }));
  const add = $('#hc-add');
  if (add) add.addEventListener('click', async () => {
    let ops;
    try { ops = JSON.parse($('#hc-ops').value || '{}'); } catch { return toast('The operations must be valid JSON', true); }
    try {
      await api('/api/connectors', { method: 'POST', body: {
        id: $('#hc-id').value.trim(), driver: 'http', label: $('#hc-label').value.trim(),
        config: { baseUrl: $('#hc-base').value.trim(), auth: { in: 'header', name: 'authorization', prefix: 'Bearer ' }, ops },
        allowlist: $('#hc-allow').value.split(',').map((s) => s.trim()).filter(Boolean),
      } });
      toast('Created'); renderConnectors();
    } catch (e) { toast(e.message, true); }
  });
  $('#cc-go')?.addEventListener('click', async () => {
    let args = {};
    try { args = JSON.parse($('#cc-args').value || '{}'); } catch { return toast('Arguments must be JSON', true); }
    try {
      const r = await api(`/api/connectors/${$('#cc-conn').value}/call`, { method: 'POST', body: { capability: $('#cc-cap').value.trim(), args } });
      $('#cc-out').innerHTML = `<div style="margin-top:10px">${verdictChip(r.verdict)} ${esc(r.why || '')}</div>${preBody(JSON.stringify(r.result ?? r, null, 1))}`;
    } catch (e) { $('#cc-out').innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; }
  });
}
// ---------- The gate ----------
export async function renderEgress() {
  const d = await api('/api/egress');
  const canRelease = hasPermC('egress.release');
  const canGrant = hasPermC('scopes.grant');
  const c = d.counts || {};
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Let through today', c.allowed || 0, 'reached the outside world', 'tile-ok')}
    ${tile('Refused', c.blocked || 0, 'a rule said no', (c.blocked || 0) ? 'tile-bad' : '')}
    ${tile('Waiting for a person', c.gated || 0, 'irreversible, so it stops here', (c.gated || 0) ? 'tile-warn' : '')}
    ${tile('Dry-run', c.dry || 0, 'executed, recorded, never sent')}
  </div>

  <div class="panel">
    <div class="panel-title">Held for a person — nothing here happened yet</div>
    <table><thead><tr><th>#</th><th>Service</th><th>What</th><th>Who asked</th><th>Target</th><th>Why held</th><th></th></tr></thead><tbody>
    ${d.waiting.map((e) => `<tr>
      <td class="mono">${e.id}</td><td class="mono">${esc(e.connector)}</td><td class="mono">${esc(e.capability)}</td>
      <td class="mono">${esc(e.agent_id || e.actor || '—')}</td><td>${esc(short(e.target || '—', 40))}</td>
      <td class="sub">${esc(e.blocked_by || '')}${e.value_usd ? ` · ${e.value_usd}` : ''}</td>
      <td>${canRelease ? `${xbtn(`/api/egress/${e.id}/release`, {}, 'Release', 'btn-primary')} ${xbtn(`/api/egress/${e.id}/deny`, { why: 'refused from the gate' }, 'Refuse', 'btn-bad')}` : '<span class="sub">egress.release required</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing is waiting.</td></tr>'}
    </tbody></table>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">What gets refused, and by which rule</div>
      <table><thead><tr><th>Service</th><th>What</th><th>Rule</th><th>Times</th></tr></thead><tbody>
      ${d.blocked.map((b) => `<tr><td class="mono">${esc(b.connector)}</td><td class="mono">${esc(b.capability)}</td>
        <td><span class="chip chip-bad">${esc(b.blocked_by || 'unknown')}</span></td><td class="num mono">${b.n}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing has been refused.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Per service, today</div>
      <table><thead><tr><th>Service</th><th>State</th><th>Calls</th><th>Quota</th><th>Health</th></tr></thead><tbody>
      ${d.byConnector.map((x) => `<tr><td>${esc(x.label)}</td><td>${stateChip(x.state)}</td>
        <td class="num mono">${x.today}</td><td class="num mono">${x.quota_day}</td>
        <td><span class="chip ${x.health === 'ok' ? 'chip-ok' : x.health === 'failing' ? 'chip-bad' : 'chip-dim'}">${esc(x.health)}</span></td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Who may reach what — ${d.totalScopes} grants, none of them a wildcard</div>
    ${canGrant ? `
    <div class="form-inline">
      <input id="sc-agent" placeholder="AGT-REL-001" style="width:150px">
      <input id="sc-conn" placeholder="gmail" style="width:110px">
      <input id="sc-cap" placeholder="mail.send" style="width:130px">
      <input id="sc-limit" placeholder='{"domain":"client.com"}' style="width:220px">
      <button class="btn btn-sm btn-primary" id="sc-grant">Grant</button>
    </div>` : ''}
    <table><thead><tr><th>Employee</th><th>Service</th><th>May</th><th>Only for</th><th></th></tr></thead><tbody>
    ${d.scopes.map((s) => `<tr><td class="mono">${esc(s.agent_id)}</td><td class="mono">${esc(s.connector)}</td>
      <td><span class="chip chip-steel">${esc(s.capability)}</span></td>
      <td class="mono sub">${esc(s.constraint_json || 'anything the connector allows')}</td>
      <td>${canGrant ? xbtn('/api/scopes/revoke', { agentId: s.agent_id, connector: s.connector, capability: s.capability }, 'Revoke') : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Nobody holds an outside scope. Nothing can leave.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">The ledger — every attempt, in order</div>
    <table><thead><tr><th>#</th><th>When</th><th>Service</th><th>What</th><th>Who</th><th>Target</th><th>Verdict</th></tr></thead><tbody>
    ${d.recent.map((e) => `<tr><td class="mono">${e.id}</td><td class="mono sub">${esc(String(e.created_at).slice(5, 16))}</td>
      <td class="mono">${esc(e.connector)}</td><td class="mono">${esc(e.capability)}</td>
      <td class="mono">${esc(e.agent_id || e.actor || '—')}</td><td>${esc(short(e.target || '—', 30))}</td>
      <td>${verdictChip(e.verdict)}${e.blocked_by ? ` <span class="sub mono">${esc(e.blocked_by)}</span>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Nothing has tried to leave yet.</td></tr>'}
    </tbody></table>
  </div>`;

  wireXact(renderEgress);
  $('#sc-grant')?.addEventListener('click', async () => {
    let constraint = null;
    const raw = $('#sc-limit').value.trim();
    if (raw) { try { constraint = JSON.parse(raw); } catch { return toast('The limit must be JSON', true); } }
    try {
      await api('/api/scopes', { method: 'POST', body: {
        agentId: $('#sc-agent').value.trim(), connector: $('#sc-conn').value.trim(),
        capability: $('#sc-cap').value.trim(), constraint,
      } });
      toast('Granted'); renderEgress();
    } catch (e) { toast(e.message, true); }
  });
}
// ---------- The vault ----------
export async function renderVault() {
  const d = await api('/api/vault');
  const canM = hasPermC('vault.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Credentials held', d.counts.total, 'encrypted with AES-256-GCM')}
    ${tile('Expired', d.counts.expired, 'will not be handed out', d.counts.expired ? 'tile-bad' : '')}
    ${tile('Expiring within a fortnight', d.counts.expiringSoon, 'rotate before they bite', d.counts.expiringSoon ? 'tile-warn' : '')}
    ${tile('Never used', d.counts.stale, 'a key nobody uses is a liability')}
  </div>
  <div class="panel">
    <div class="panel-title">The vault</div>
    ${canM ? `
    <div class="form-inline">
      <input id="v-name" placeholder="NAME_LIKE_THIS" style="width:200px">
      <input id="v-val" type="password" placeholder="the value — stored encrypted, never shown again" style="width:34%">
      <input id="v-conn" placeholder="connector (optional)" style="width:130px">
      <input id="v-exp" aria-label="Expires" type="date" title="expires">
      <button class="btn btn-sm btn-primary" id="v-put">Store</button>
    </div>` : '<div class="empty">vault.manage required</div>'}
    <table><thead><tr><th>Name</th><th>Kind</th><th>For</th><th>Ends</th><th>Expires</th><th>Last used</th><th></th></tr></thead><tbody>
    ${d.secrets.map((s) => `<tr>
      <td class="mono">${esc(s.name)}</td>
      <td><span class="chip chip-dim">${esc(s.kind)}</span></td>
      <td class="mono sub">${esc(s.connector || '—')}</td>
      <td class="mono">…${esc(s.tail || '••')}</td>
      <td class="mono sub">${s.expires_at ? `<span class="chip ${s.expired ? 'chip-bad' : s.expiringSoon ? 'chip-warn' : 'chip-dim'}">${esc(String(s.expires_at).slice(0, 10))}</span>` : '—'}</td>
      <td class="mono sub">${s.last_used ? esc(String(s.last_used).slice(0, 16)) : '<span style="color:var(--warn)">never</span>'}</td>
      <td>${canM ? `<button class="btn btn-sm btn-bad" data-drop="${esc(s.name)}">Delete</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">Empty.</td></tr>'}
    </tbody></table>
    <div class="map-legend">The value goes in and never comes back out: what you see is the last four characters. The master key lives in <span class="mono">data/master.key</span>, outside the database, so a copied <span class="mono">.db</span> is not a copied set of keys. On a shared host this raises the cost of theft rather than making it impossible — a second machine wants a real key manager.</div>
  </div>`;
  $('#v-put')?.addEventListener('click', async () => {
    try {
      await api('/api/vault', { method: 'POST', body: {
        name: $('#v-name').value.trim(), value: $('#v-val').value,
        connector: $('#v-conn').value.trim() || null, expiresAt: $('#v-exp').value || null,
      } });
      toast('Stored'); renderVault();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete ${b.dataset.drop}? Anything using it stops working.`)) return;
    try { await api(`/api/vault/${b.dataset.drop}`, { method: 'DELETE' }); toast('Deleted'); renderVault(); }
    catch (e) { toast(e.message, true); }
  }));
}
// ---------- The open web ----------
export async function renderWeb(id) {
  // #/web/12 opens one page as it was actually read, hash and all.
  if (id) return renderWebPage(id);
  const d = await api('/api/web');
  const canUse = hasPermC('web.use');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Pages read today', d.counts.today, `${d.counts.total} all time`)}
    ${tile('Failed or refused', d.counts.failed, 'private addresses are blocked outright')}
    ${tile('Hijack attempts caught', d.counts.injections, 'text that tried to give orders', d.counts.injections ? 'tile-warn' : '')}
    <div class="panel tile"><div class="panel-title">Search engines</div>
      <div class="sub" style="margin-top:8px">
        ${Object.entries(d.engines).map(([k, on]) => `<span class="chip ${on ? 'chip-ok' : 'chip-dim'}">${esc(k)}</span>`).join(' ')}
      </div>
      <div class="sub" style="margin-top:6px">Add BRAVE_SEARCH_KEY, TAVILY_API_KEY or SERPAPI_KEY to the vault.</div></div>
  </div>

  ${canUse ? `
  <div class="panel">
    <div class="panel-title">Reach out — three ways, weakest first</div>
    <div class="form-inline">
      <input id="w-url" placeholder="https://example.com  or  a search phrase" style="width:48%">
      <button class="btn btn-sm btn-primary" id="w-fetch">Fetch</button>
      <button class="btn btn-sm" id="w-search">Search</button>
      <button class="btn btn-sm" id="w-browse">Browse (real Chrome)</button>
    </div>
    <div id="w-out"></div>
    <div class="map-legend"><b>Fetch</b> reads the HTML. <b>Search</b> asks an engine. <b>Browse</b> drives a real browser for pages that are an application rather than a document. Everything read is kept with the hash of what it actually said, so any claim made from it can be traced back — and any text in it that tries to give orders is flagged and filed as an attack, never obeyed.</div>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">What the company has read</div>
    <table><thead><tr><th>#</th><th>Mode</th><th>Page</th><th>Status</th><th>Bytes</th><th>Fingerprint</th><th>Who</th><th>When</th></tr></thead><tbody>
    ${d.recent.map((r) => `<tr>
      <td class="mono">${r.id}</td>
      <td><span class="chip ${r.mode === 'browse' ? 'chip-steel' : r.mode === 'search' ? 'chip-ember' : 'chip-dim'}">${esc(r.mode)}</span></td>
      <td><a href="#/web/${r.id}" class="mono">${esc(short(r.title || r.url, 52))}</a></td>
      <td class="mono ${r.error ? 'sub' : ''}" style="${r.error ? 'color:var(--bad)' : ''}">${r.error ? esc(short(r.error, 26)) : r.status}</td>
      <td class="num mono">${r.bytes || 0}</td>
      <td class="mono sub">${esc((r.content_hash || '').slice(0, 12) || '—')}</td>
      <td class="mono sub">${esc(r.agent_id || 'human')}</td>
      <td class="mono sub">${esc(String(r.created_at).slice(5, 16))}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing has been read from the web yet.</td></tr>'}
    </tbody></table>
  </div>`;

  const show = async (path, body) => {
    $('#w-out').innerHTML = '<div class="empty">working…</div>';
    try {
      const r = await api(path, { method: 'POST', body });
      if (r.results) {
        $('#w-out').innerHTML = `<div class="sub" style="margin:8px 0">${esc(r.engine || 'no engine')} · ${r.results.length} results</div>` +
          r.results.map((x) => `<div style="margin:6px 0"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><div class="sub">${esc(short(x.snippet || '', 160))}</div></div>`).join('')
          + (r.note ? `<div class="empty">${esc(r.note)}</div>` : '');
        return;
      }
      const warn = r.injection && !r.injection.clean
        ? `<div class="chip chip-bad" style="margin:8px 0">This page tried to give instructions — recorded as an attack, not obeyed</div>` : '';
      $('#w-out').innerHTML = `${warn}<div class="sub" style="margin:8px 0"><b>${esc(r.title || '')}</b> · ${r.cached ? 'from cache' : 'fresh'} · ${esc((r.contentHash || '').slice(0, 16))}</div>
        ${r.screenshot ? `<img src="${r.screenshot}" style="max-width:100%;border:1px solid var(--seam);border-radius:8px">` : ''}
        ${preBody(short(r.text || '', 4000))}`;
    } catch (e) { $('#w-out').innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; }
  };
  $('#w-fetch')?.addEventListener('click', () => show('/api/web/fetch', { url: $('#w-url').value.trim() }));
  $('#w-search')?.addEventListener('click', () => show('/api/web/search', { query: $('#w-url').value.trim() }));
  $('#w-browse')?.addEventListener('click', () => show('/api/web/browse', { url: $('#w-url').value.trim(), screenshot: true }));
}
// ---------- MCP ----------
export async function renderMcp() {
  const d = await api('/api/mcp');
  const canM = hasPermC('mcp.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Servers registered', d.counts.registered, `${d.counts.connected} answering`)}
    ${tile('Tools reachable', d.counts.tools, 'things the workforce can now do', d.counts.tools ? 'tile-ok' : '')}
    ${tile('Tool calls made', d.counts.calls, 'by employees, on real work')}
    ${tile('AlphaCore exposes', 7, 'tools an outside agent can drive us with', 'tile-steel')}
  </div>

  <div class="panel">
    <div class="panel-title">Servers the company can reach</div>
    <table><thead><tr><th>Server</th><th>Transport</th><th>State</th><th>Tools</th><th>Calls</th><th></th></tr></thead><tbody>
    ${d.servers.map((s) => `<tr>
      <td><b>${esc(s.label)}</b><div class="sub mono">${esc(s.command || s.url || s.id)}</div></td>
      <td class="mono">${esc(s.transport)}</td>
      <td><span class="chip ${s.state === 'connected' ? 'chip-ok' : s.state === 'failed' ? 'chip-bad' : 'chip-dim'}">${esc(s.state)}</span>${s.last_error ? `<div class="sub" style="color:var(--bad)">${esc(short(s.last_error, 60))}</div>` : ''}</td>
      <td class="sub">${s.tools.slice(0, 5).map((t) => `<span class="chip chip-dim">${esc(t.name)}</span>`).join(' ')}${s.tools.length > 5 ? ` +${s.tools.length - 5}` : ''}</td>
      <td class="num mono">${s.calls}</td>
      <td>${canM ? xbtn(`/api/mcp/${s.id}/sync`, {}, 'Sync', 'btn-primary') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No servers yet — add one below.</td></tr>'}
    </tbody></table>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Add a server</div>
      ${canM ? `
      <div class="form-grid">
        <input id="mc-id" placeholder="id, e.g. filesystem">
        <input id="mc-label" placeholder="what it is">
        <input id="mc-cmd" placeholder="command, e.g. npx">
        <input id="mc-args" placeholder='args, comma separated: -y, @modelcontextprotocol/server-filesystem, .'>
        <button class="btn btn-primary" id="mc-add">Register</button>
      </div>
      <div class="sub" style="margin-top:10px">Worth having:</div>
      <table><tbody>${d.suggestions.map((s) => `<tr>
        <td><b>${esc(s.label)}</b><div class="sub">${esc(s.why)}</div></td>
        <td><button class="btn btn-sm" data-suggest="${encodeURIComponent(JSON.stringify(s))}">Add</button></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">mcp.manage required</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">AlphaCore as a server — drive this company from outside</div>
      <div class="map-legend">Point Claude Code, Claude Desktop or any MCP client at the endpoint below with your own AlphaCore token. You get exactly the permissions your account holds — there is no wider back door.</div>
      ${preBody(JSON.stringify({
        mcpServers: {
          alphacore: {
            type: 'http',
            url: `${location.origin}/mcp`,
            headers: { 'x-auth-token': 'YOUR-ALPHACORE-TOKEN' },
          },
        },
      }, null, 2))}
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Recent tool calls</div>
    <table><thead><tr><th>#</th><th>Server</th><th>Tool</th><th>Who</th><th>Result</th><th>ms</th><th>When</th></tr></thead><tbody>
    ${d.recent.map((c) => `<tr><td class="mono">${c.id}</td><td class="mono">${esc(c.server_id)}</td><td class="mono">${esc(c.tool)}</td>
      <td class="mono sub">${esc(c.agent_id || 'human')}</td>
      <td>${c.ok ? '<span class="chip chip-ok">ok</span>' : '<span class="chip chip-bad">failed</span>'}</td>
      <td class="num mono">${c.ms || 0}</td><td class="mono sub">${esc(String(c.created_at).slice(5, 16))}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">No tool has been called yet.</td></tr>'}
    </tbody></table>
  </div>`;

  wireXact(renderMcp);
  $('#mc-add')?.addEventListener('click', async () => {
    try {
      await api('/api/mcp', { method: 'POST', body: {
        id: $('#mc-id').value.trim(), label: $('#mc-label').value.trim(),
        command: $('#mc-cmd').value.trim(),
        args: $('#mc-args').value.split(',').map((s) => s.trim()).filter(Boolean),
      } });
      toast('Registered'); renderMcp();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', async () => {
    const s = JSON.parse(decodeURIComponent(b.dataset.suggest));
    try { await api('/api/mcp', { method: 'POST', body: { id: s.id, label: s.label, command: s.command, args: s.args } }); toast('Registered — press Sync'); renderMcp(); }
    catch (e) { toast(e.message, true); }
  }));
}
// ---------- Companies (tenants) ----------
export async function renderTenants() {
  const d = await api('/api/tenants');
  const canM = hasPermC('tenants.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Companies here', d.counts.total, `${d.counts.running} running`)}
    ${tile('Running', d.counts.running, 'each in its own process', d.counts.running ? 'tile-ok' : '')}
    ${tile('Paused', d.counts.paused, 'over cap or stopped by hand', d.counts.paused ? 'tile-warn' : '')}
    ${tile('Spend this month', `${Number(d.spendThisMonthUsd).toFixed(2)}`, 'across every company')}
  </div>

  <div class="panel">
    <div class="panel-title">Companies on this installation</div>
    <table><thead><tr><th>Company</th><th>State</th><th>Address</th><th>This month</th><th>Cap</th><th>Runs today</th><th></th></tr></thead><tbody>
    ${d.tenants.map((t) => `<tr>
      <td><b>${esc(t.name)}</b><div class="sub mono">${esc(t.id)} · ${esc(t.db_file)}</div></td>
      <td><span class="chip ${t.up ? 'chip-ok' : t.state === 'failed' ? 'chip-bad' : 'chip-dim'}">${t.up ? 'running' : esc(t.state)}</span>${t.last_error ? `<div class="sub" style="color:var(--bad)">${esc(short(t.last_error, 40))}</div>` : ''}</td>
      <td class="mono sub">${t.up ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.url)}</a>` : esc(t.url)}</td>
      <td class="num mono">${Number(t.monthUsd || 0).toFixed(2)}</td>
      <td class="num mono sub">${Number(t.monthly_cap_usd).toFixed(0)}</td>
      <td class="num mono">${t.todayRuns}</td>
      <td>
        ${canM && !t.up ? xbtn(`/api/tenants/${t.id}/start`, {}, 'Start', 'btn-primary') : ''}
        ${canM && t.up ? xbtn(`/api/tenants/${t.id}/stop`, {}, 'Stop') : ''}
        ${canM ? `<button class="btn btn-sm btn-bad" data-deltenant="${esc(t.id)}">Delete</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">Only this company so far.</td></tr>'}
    </tbody></table>
    <div class="map-legend">${esc(d.isolation)}. The cost is a process per company; the benefit is that a forgotten <span class="mono">WHERE</span> clause cannot leak one company's customers into another's screen.</div>
  </div>

  ${canM ? `
  <div class="panel">
    <div class="panel-title">Add a company</div>
    <div class="form-inline">
      <input id="tn-name" placeholder="what it is called" style="width:200px">
      <input id="tn-id" placeholder="id (optional — made from the name)" style="width:180px">
      <input id="tn-email" placeholder="owner email" style="width:180px">
      <input id="tn-cap" type="number" placeholder="monthly cap $" value="200" style="width:120px">
      <button class="btn btn-sm btn-primary" id="tn-add">Provision</button>
    </div>
    <div class="map-legend">Provisioning creates the database file and reserves a port; starting it brings the company up on its own process. A company past its monthly cap is paused rather than allowed to keep spending.</div>
  </div>` : ''}`;

  wireXact(renderTenants);
  $('#tn-add')?.addEventListener('click', async () => {
    try {
      await api('/api/tenants', { method: 'POST', body: {
        name: $('#tn-name').value.trim(), id: $('#tn-id').value.trim() || undefined,
        ownerEmail: $('#tn-email').value.trim() || null, monthlyCapUsd: Number($('#tn-cap').value || 200),
      } });
      toast('Provisioned'); renderTenants();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-deltenant]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.deltenant;
    const typed = prompt(`This deletes ${id} and its database. There is no undo.\n\nType the company id to confirm:`);
    if (!typed) return;
    try { await api(`/api/tenants/${id}?confirm=${encodeURIComponent(typed)}`, { method: 'DELETE' }); toast('Deleted'); renderTenants(); }
    catch (e) { toast(e.message, true); }
  }));
}
// ---------- API keys ----------
export async function renderKeys() {
  const d = await api('/api/keys');
  const canM = hasPermC('keys.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Keys in use', d.counts.active, `${d.counts.revoked} revoked`)}
    ${tile('Calls today', d.counts.callsToday, 'from other software, not browsers')}
    ${tile('Permissions available', d.availableScopes.length, 'a key may hold any subset, never the wildcard')}
    <div class="panel tile"><div class="panel-title">How to call</div>
      <div class="mono sub" style="margin-top:8px;font-size:10px">curl ${location.origin}/api/stats \\<br>&nbsp;&nbsp;-H "x-api-key: ck_…"</div></div>
  </div>

  ${canM ? `
  <div class="panel">
    <div class="panel-title">Mint a key</div>
    <div class="form-inline">
      <input id="ak-name" placeholder="what it is for, e.g. reporting script" style="width:220px">
      <input id="ak-rate" aria-label="Rate" type="number" value="120" title="calls per minute" style="width:110px">
      <input id="ak-exp" aria-label="Expires" type="date" title="expires">
      <button class="btn btn-sm btn-primary" id="ak-make">Create</button>
    </div>
    <div class="sub" style="margin-top:8px">Scopes — pick only what it needs:</div>
    <div id="ak-scopes" style="max-height:160px;overflow:auto;border:1px solid var(--seam);border-radius:8px;padding:8px;margin-top:6px">
      ${d.availableScopes.map((s) => `<label class="chip chip-dim" style="cursor:pointer;margin:2px"><input type="checkbox" value="${esc(s)}" style="margin-inline-end:4px">${esc(s)}</label>`).join('')}
    </div>
    <div id="ak-out"></div>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">Keys</div>
    <table><thead><tr><th>Name</th><th>Key</th><th>May</th><th>Rate</th><th>Calls</th><th>Last used</th><th>State</th><th></th></tr></thead><tbody>
    ${d.keys.map((k) => `<tr>
      <td><b>${esc(k.name)}</b><div class="sub mono">by ${esc(k.created_by)}</div></td>
      <td class="mono">${esc(k.prefix)}…</td>
      <td class="sub">${k.scopes.slice(0, 3).map((s) => `<span class="chip chip-dim">${esc(s)}</span>`).join(' ')}${k.scopes.length > 3 ? ` +${k.scopes.length - 3}` : ''}</td>
      <td class="num mono sub">${k.rate_per_min}/min</td>
      <td class="num mono">${k.calls}</td>
      <td class="mono sub">${k.last_used ? esc(String(k.last_used).slice(5, 16)) : 'never'}</td>
      <td><span class="chip ${k.state === 'active' && !k.expired ? 'chip-ok' : 'chip-bad'}">${k.expired ? 'expired' : esc(k.state)}</span></td>
      <td>${canM && k.state === 'active' ? xbtn(`/api/keys/${k.id}/revoke`, {}, 'Revoke', 'btn-bad') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">No keys yet.</td></tr>'}
    </tbody></table>
    <div class="map-legend">A session token belongs to a person at a keyboard and carries their whole permission set. A key belongs to a script, lasts months, and should be able to do exactly one thing — so it is a separate mechanism with its own scopes, its own rate limit and its own ledger. What is stored is a hash: the key itself is shown once and never again.</div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Busiest endpoints</div>
      <table><thead><tr><th>Endpoint</th><th>Calls</th><th>Avg ms</th></tr></thead><tbody>
      ${d.busiest.map((b) => `<tr><td class="mono">${esc(b.method)} ${esc(b.path)}</td><td class="num mono">${b.n}</td><td class="num mono">${b.avg_ms}</td></tr>`).join('')
        || '<tr><td colspan="3" class="empty">No calls yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Recent calls</div>
      <table><thead><tr><th>Key</th><th>Call</th><th>Status</th><th>ms</th></tr></thead><tbody>
      ${d.recent.map((c) => `<tr><td class="mono sub">${esc(c.key_name || '—')}</td>
        <td class="mono">${esc(c.method)} ${esc(short(c.path, 28))}</td>
        <td class="mono" style="${c.status >= 400 ? 'color:var(--bad)' : ''}">${c.status}</td>
        <td class="num mono">${c.ms}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing yet.</td></tr>'}
      </tbody></table>
    </div>
  </div>`;

  wireXact(renderKeys);
  $('#ak-make')?.addEventListener('click', async () => {
    const scopes = [...view.querySelectorAll('#ak-scopes input:checked')].map((i) => i.value);
    try {
      const r = await api('/api/keys', { method: 'POST', body: {
        name: $('#ak-name').value.trim(), scopes,
        ratePerMin: Number($('#ak-rate').value || 120), expiresAt: $('#ak-exp').value || null,
      } });
      $('#ak-out').innerHTML = `<div class="chip chip-warn" style="margin-top:12px">${esc(r.note)}</div>${preBody(r.key)}`;
      toast('Created — copy the key now');
    } catch (e) { toast(e.message, true); }
  });
}
// ---------- Webhooks ----------
export async function renderWebhooks() {
  const d = await api('/api/webhooks');
  const canM = hasPermC('webhooks.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Subscriptions', d.counts.active, `${d.counts.paused} paused`)}
    ${tile('Delivered today', d.counts.deliveredToday, 'receiver answered 2xx', d.counts.deliveredToday ? 'tile-ok' : '')}
    ${tile('Failed deliveries', d.counts.failing, 'retried on the queue, then paused', d.counts.failing ? 'tile-warn' : '')}
    <div class="panel tile"><div class="panel-title">Verify a delivery</div>
      <div class="sub" style="margin-top:8px">HMAC-SHA256 over <span class="mono">timestamp.body</span>, in <span class="mono">x-alphacore-signature</span>. Five-minute replay window.</div></div>
  </div>

  ${canM ? `
  <div class="panel">
    <div class="panel-title">Subscribe</div>
    <div class="form-inline">
      <input id="wh-url" placeholder="https://your-service.example/hooks/alphacore" style="width:44%">
      <input id="wh-events" placeholder="run.*, egress.blocked, decision.*  (or * for everything)" style="width:34%">
      <button class="btn btn-sm btn-primary" id="wh-add">Add</button>
    </div>
    <div id="wh-out"></div>
    <div class="map-legend">The audit chain is the event source, so a webhook can never announce something that did not happen. Delivery runs on the job queue: a receiver that is down costs a retry, not an event. Twenty consecutive failures pause the subscription and say so on the chain.</div>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">Subscriptions</div>
    <table><thead><tr><th>Where</th><th>Listening for</th><th>State</th><th>Last fired</th><th>Failures</th><th></th></tr></thead><tbody>
    ${d.webhooks.map((w) => `<tr>
      <td class="mono">${esc(short(w.url, 46))}</td>
      <td class="sub">${w.events.map((e) => `<span class="chip chip-dim">${esc(e)}</span>`).join(' ')}</td>
      <td><span class="chip ${w.state === 'active' ? 'chip-ok' : 'chip-warn'}">${esc(w.state)}</span></td>
      <td class="mono sub">${w.last_fired ? esc(String(w.last_fired).slice(5, 16)) : 'never'}</td>
      <td class="num mono" style="${w.failures ? 'color:var(--bad)' : ''}">${w.failures}</td>
      <td>${canM ? `${xbtn(`/api/webhooks/${w.id}/state`, { state: w.state === 'active' ? 'paused' : 'active' }, w.state === 'active' ? 'Pause' : 'Resume')}
        <button class="btn btn-sm btn-bad" data-delhook="${w.id}">Remove</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">Nobody is listening yet.</td></tr>'}
    </tbody></table>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Recent deliveries</div>
      <table><thead><tr><th>Event</th><th>To</th><th>Status</th><th>Tries</th></tr></thead><tbody>
      ${d.recent.map((r) => `<tr><td class="mono">${esc(r.event)}</td><td class="mono sub">${esc(short(r.url || '', 26))}</td>
        <td class="mono" style="${r.status >= 400 || r.error ? 'color:var(--bad)' : ''}">${r.status || esc(short(r.error || 'pending', 18))}</td>
        <td class="num mono">${r.attempts}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing sent yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">What you can listen for</div>
      <table><thead><tr><th>Event</th><th>Last week</th></tr></thead><tbody>
      ${d.commonEvents.map((e) => `<tr><td class="mono">${esc(e.action)}</td><td class="num mono">${e.n}</td></tr>`).join('')}
      </tbody></table>
      <div class="map-legend">Anything on the chain can be subscribed to; these are simply the ones that happen most.</div>
    </div>
  </div>`;

  wireXact(renderWebhooks);
  $('#wh-add')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/webhooks', { method: 'POST', body: {
        url: $('#wh-url').value.trim(),
        events: ($('#wh-events').value.trim() || '*').split(',').map((s) => s.trim()).filter(Boolean),
      } });
      $('#wh-out').innerHTML = `<div class="chip chip-warn" style="margin-top:12px">${esc(r.note)}</div>${preBody(r.secret)}`;
      toast('Subscribed — copy the signing secret');
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-delhook]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/webhooks/${b.dataset.delhook}`, { method: 'DELETE' }); toast('Removed'); renderWebhooks(); }
    catch (e) { toast(e.message, true); }
  }));
}
// ---------- Events ----------
export async function renderEvents() {
  const d = await api('/api/mkt/events');
  const canM = hasPermC('marketing.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Rooms booked', d.counts.planned, 'planned or briefed')}
    ${tile('Run', d.counts.done, 'and finished')}
    ${tile('Leads out of them', d.counts.leads, 'people who wanted to keep talking', d.counts.leads ? 'tile-ok' : '')}
    ${tile('Cost per lead', d.costPerLead === null ? '—' : `${d.costPerLead}`, `${d.counts.spentUsd} spent in total`)}
  </div>
  ${canM ? `
  <div class="panel">
    <div class="panel-title">Book a room</div>
    <div class="form-grid">
      <input id="ev-name" placeholder="what it is called">
      <div class="form-inline">
        <select id="ev-kind" aria-label="Kind"><option value="webinar">webinar</option><option value="roundtable">roundtable</option><option value="conference">conference</option><option value="meetup">meetup</option></select>
        <select id="ev-format" aria-label="Format"><option value="online">online</option><option value="in-person">in person</option><option value="hybrid">hybrid</option></select>
        <input id="ev-when" aria-label="When" type="datetime-local" style="width:210px">
        <input id="ev-city" placeholder="city" style="width:130px">
        <input id="ev-budget" type="number" placeholder="budget $" style="width:120px">
      </div>
      <input id="ev-audience" placeholder="who should be in the room">
      <input id="ev-goal" placeholder="what we want to leave with">
      <button class="btn btn-primary" id="ev-add">Plan it</button>
    </div>
    <div class="map-legend">Booking it commissions the run-of-show from the events producer: the promise that makes somebody attend, an agenda in minutes, and the single thing that happens the morning after. An event with no follow-up is a party.</div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Events</div>
    <table><thead><tr><th>Event</th><th>When</th><th>State</th><th class="num">Registered</th><th class="num">Came</th><th class="num">Leads</th><th class="num">Spent</th><th></th></tr></thead><tbody>
    ${d.events.map((e) => `<tr>
      <td><b>${esc(e.name)}</b><div class="sub">${esc(e.kind)} · ${esc(e.format)}${e.city ? ` · ${esc(e.city)}` : ''}${e.audience ? ` · ${esc(short(e.audience, 40))}` : ''}</div></td>
      <td class="mono sub">${esc(String(e.starts_at || '—').slice(0, 16))}</td>
      <td>${mktState(e.state)}</td>
      <td class="num mono">${e.registered}</td><td class="num mono">${e.attended}</td>
      <td class="num mono" style="${e.leads ? 'color:var(--ok)' : ''}">${e.leads}</td>
      <td class="num mono">${Number(e.spent_usd).toFixed(0)}/${Number(e.budget_usd).toFixed(0)}</td>
      <td>${canM ? `<button class="btn btn-sm" data-evrec="${e.id}">Record</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">No events yet.</td></tr>'}
    </tbody></table>
  </div>`;
  $('#ev-add')?.addEventListener('click', async () => {
    try {
      await api('/api/mkt/events', { method: 'POST', body: {
        name: $('#ev-name').value.trim(), kind: $('#ev-kind').value, format: $('#ev-format').value,
        startsAt: $('#ev-when').value || null, city: $('#ev-city').value.trim() || null,
        budgetUsd: Number($('#ev-budget').value || 0),
        audience: $('#ev-audience').value.trim() || null, goal: $('#ev-goal').value.trim() || null,
      } });
      toast('Planned — the run-of-show is being written'); renderEvents();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-evrec]').forEach((b) => b.addEventListener('click', async () => {
    const registered = prompt('How many registered?');
    if (registered === null) return;
    const attended = prompt('How many actually came?');
    const leads = prompt('How many wanted to keep talking?');
    const spent = prompt('What did it cost?');
    try {
      await api(`/api/mkt/events/${b.dataset.evrec}`, { method: 'POST', body: {
        registered: Number(registered) || 0, attended: Number(attended) || 0,
        leads: Number(leads) || 0, spent: Number(spent) || 0, state: 'done',
      } });
      toast('Recorded'); renderEvents();
    } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Press ----------
export async function renderPress() {
  const d = await api('/api/mkt/press');
  const canM = hasPermC('marketing.manage');
  const canApprove = hasPermC('press.approve');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('In draft', d.counts.drafts, 'written, not yet approved')}
    ${tile('Approved, unsent', d.counts.awaiting, 'a person has signed off', d.counts.awaiting ? 'tile-warn' : '')}
    ${tile('Published', d.counts.published, 'somebody printed it', d.counts.published ? 'tile-ok' : '')}
    ${tile('Outlets', d.counts.outlets, 'places that have carried us')}
  </div>
  ${canM ? `
  <div class="panel">
    <div class="panel-title">Write something</div>
    <div class="form-grid">
      <div class="form-inline">
        <select id="pr-kind" aria-label="Kind"><option value="release">press release</option><option value="pitch">pitch</option><option value="briefing">briefing</option></select>
        <input id="pr-outlet" placeholder="outlet" style="width:180px">
        <input id="pr-journalist" placeholder="journalist" style="width:180px">
      </div>
      <input id="pr-title" placeholder="the news, in one line">
      <input id="pr-angle" placeholder="why this outlet should care">
      <button class="btn btn-primary" id="pr-add">Draft it</button>
    </div>
    <div class="map-legend">The draft is written against the ledger: customer counts, revenue and shipped releases are read from the database and handed to the writer as evidence. A claim that cannot be supported is left out rather than softened — and the constitution refuses the send if one slips through.</div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Press</div>
    <table><thead><tr><th>Item</th><th>Outlet</th><th>State</th><th>Coverage</th><th></th></tr></thead><tbody>
    ${d.items.map((p) => `<tr>
      <td><b>${esc(p.title)}</b><div class="sub">${esc(p.kind)}${p.angle ? ` · ${esc(short(p.angle, 60))}` : ''}</div></td>
      <td>${esc(p.outlet || '—')}${p.journalist ? `<div class="sub">${esc(p.journalist)}</div>` : ''}</td>
      <td>${mktState(p.state)}${p.approved_by ? `<div class="sub mono">${esc(p.approved_by)}</div>` : ''}</td>
      <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">read</a>` : ''}${p.sentiment ? ` <span class="chip chip-dim">${esc(p.sentiment)}</span>` : ''}</td>
      <td>${canApprove && p.state === 'draft' ? xbtn(`/api/mkt/press/${p.id}/approve`, {}, 'Approve', 'btn-primary') : ''}
          ${canM && p.state === 'approved' ? `<button class="btn btn-sm" data-prcov="${p.id}">Record coverage</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing written yet.</td></tr>'}
    </tbody></table>
    <div class="map-legend">Approving is a human act and its own permission: a press release is the company speaking on record, which is not the same power as running a campaign.</div>
  </div>`;
  wireXact(renderPress);
  $('#pr-add')?.addEventListener('click', async () => {
    try {
      await api('/api/mkt/press', { method: 'POST', body: {
        kind: $('#pr-kind').value, title: $('#pr-title').value.trim(),
        outlet: $('#pr-outlet').value.trim() || null, journalist: $('#pr-journalist').value.trim() || null,
        angle: $('#pr-angle').value.trim() || null,
      } });
      toast('Drafting'); renderPress();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-prcov]').forEach((b) => b.addEventListener('click', async () => {
    const url = prompt('Where did it run?');
    if (!url) return;
    try { await api(`/api/mkt/press/${b.dataset.prcov}/coverage`, { method: 'POST', body: { url, sentiment: 'positive' } }); toast('Recorded'); renderPress(); }
    catch (e) { toast(e.message, true); }
  }));
}
// ---------- Community ----------
export async function renderCommunity() {
  const d = await api('/api/mkt/community');
  const canM = hasPermC('marketing.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('People', d.counts.total, 'we know by name')}
    ${tile('Advocates', d.counts.advocates, 'who speak for us unpaid', d.counts.advocates ? 'tile-ok' : '')}
    ${tile('Unhappy', d.counts.critics, 'and saying so in public', d.counts.critics ? 'tile-warn' : '')}
    ${tile('Reach', d.counts.reach.toLocaleString(), 'combined audience of the people above')}
  </div>
  ${canM ? `
  <div class="panel">
    <div class="panel-title">Add somebody</div>
    <div class="form-inline">
      <input id="cm-handle" placeholder="@handle or name" style="width:200px">
      <input id="cm-channel" placeholder="where — x, linkedin, telegram…" style="width:170px">
      <select id="cm-role" aria-label="Role"><option value="member">member</option><option value="advocate">advocate</option><option value="ambassador">ambassador</option><option value="critic">critic</option></select>
      <input id="cm-reach" type="number" placeholder="reach" style="width:110px">
      <button class="btn btn-sm btn-primary" id="cm-add">Add</button>
    </div>
  </div>` : ''}
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">The room</div>
      <table><thead><tr><th>Who</th><th>Where</th><th>Role</th><th class="num">Reach</th><th></th></tr></thead><tbody>
      ${d.members.map((m) => `<tr>
        <td><b>${esc(m.handle)}</b>${m.notes ? `<div class="sub">${esc(short(m.notes, 50))}</div>` : ''}</td>
        <td class="mono sub">${esc(m.channel)}</td>
        <td><span class="chip ${m.role === 'critic' ? 'chip-bad' : ['advocate', 'ambassador'].includes(m.role) ? 'chip-ok' : 'chip-dim'}">${esc(m.role)}</span></td>
        <td class="num mono">${(m.reach || 0).toLocaleString()}</td>
        <td>${canM ? `<button class="btn btn-sm" data-cmrole="${m.id}">Change</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">Nobody yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">By channel</div>
      <table><thead><tr><th>Channel</th><th class="num">People</th><th class="num">Reach</th></tr></thead><tbody>
      ${d.byChannel.map((c) => `<tr><td class="mono">${esc(c.channel)}</td><td class="num mono">${c.n}</td><td class="num mono">${(c.reach || 0).toLocaleString()}</td></tr>`).join('')
        || '<tr><td colspan="3" class="empty">—</td></tr>'}
      </tbody></table>
      <div class="map-legend">A critic is tracked in the same list as an advocate on purpose. The two are usually the same kind of person at a different moment, and the one worth acting on is the critic.</div>
    </div>
  </div>`;
  $('#cm-add')?.addEventListener('click', async () => {
    try {
      await api('/api/mkt/community', { method: 'POST', body: {
        handle: $('#cm-handle').value.trim(), channel: $('#cm-channel').value.trim() || 'other',
        role: $('#cm-role').value, reach: Number($('#cm-reach').value || 0),
      } });
      toast('Added'); renderCommunity();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-cmrole]').forEach((b) => b.addEventListener('click', async () => {
    const role = prompt('member, advocate, ambassador or critic?');
    if (!role) return;
    try { await api(`/api/mkt/community/${b.dataset.cmrole}`, { method: 'POST', body: { role } }); toast('Changed'); renderCommunity(); }
    catch (e) { toast(e.message, true); }
  }));
}
// ---------- Attribution ----------
export async function renderAttribution() {
  const d = await api('/api/mkt/attribution');
  const max = Math.max(...d.byChannel.map((c) => Math.max(c.first, c.last, c.even)), 1);
  const bar = (v, colour) => `<div style="height:6px;width:${(v / max) * 100}%;background:${colour};border-radius:1px;min-width:${v ? '2px' : '0'}"></div>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Journeys credited', d.journeys, 'subjects with at least one touch')}
    ${tile('Touches recorded', d.touches, 'written as they happened, not typed later')}
    ${tile('Channels involved', d.byChannel.length, 'that got credit under any model')}
    ${tile('Longest path', d.longest[0]?.touches ?? 0, d.longest[0] ? esc(short(d.longest[0].subject, 24)) : 'nothing yet')}
  </div>
  <div class="panel">
    <div class="panel-title">Who gets the credit — three answers, side by side</div>
    <table><thead><tr><th>Channel</th><th>First touch</th><th>Last touch</th><th>Even split</th></tr></thead><tbody>
    ${d.byChannel.map((c) => `<tr>
      <td class="mono">${esc(c.channel)}</td>
      <td style="width:26%"><div class="mono sub">${c.first}</div>${bar(c.first, 'var(--ink-faint)')}</td>
      <td style="width:26%"><div class="mono sub">${c.last}</div>${bar(c.last, 'var(--accent)')}</td>
      <td style="width:26%"><div class="mono sub">${c.even}</div>${bar(c.even, 'var(--steel)')}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">No touches recorded yet — channels write them as they happen.</td></tr>'}
    </tbody></table>
    <div class="map-legend">${esc(d.note)} Last touch is the number everybody quotes and the one most likely to be wrong, so it is never shown on its own here.</div>
  </div>
  <div class="panel">
    <div class="panel-title">Longest journeys</div>
    <table><thead><tr><th>Subject</th><th class="num">Touches</th></tr></thead><tbody>
    ${d.longest.map((l) => `<tr><td class="mono">${esc(l.subject)}</td><td class="num mono">${l.touches}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">—</td></tr>'}
    </tbody></table>
  </div>`;
}
// ---------- Landing pages ----------
export async function renderPages() {
  const d = await api('/api/mkt/pages');
  const canM = hasPermC('marketing.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Live', d.counts.live, 'pages a campaign can point at', d.counts.live ? 'tile-ok' : '')}
    ${tile('In progress', d.counts.draft, 'written or in review')}
    ${tile('Visits', d.counts.visits.toLocaleString(), 'across every live page')}
    ${tile('Conversions', d.counts.conversions, d.counts.visits ? `${((d.counts.conversions / d.counts.visits) * 100).toFixed(1)}% of visits` : 'nothing measured yet')}
  </div>
  ${canM ? `
  <div class="panel">
    <div class="panel-title">Write a page</div>
    <div class="form-inline">
      <input id="pg-slug" placeholder="slug, e.g. oil-and-gas-arabic" style="width:230px">
      <input id="pg-title" placeholder="title" style="width:200px">
      <select id="pg-persona" aria-label="Persona"><option value="">any persona</option>${d.personas.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="pg-add">Draft</button>
    </div>
    <input id="pg-purpose" placeholder="what one action this page is for" style="width:60%;margin-top:8px">
    <div class="map-legend">The draft is written for the persona you pick, not for everyone — headline, subhead, three short sections, one call to action, and the objection that stops people, answered.</div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Pages</div>
    <table><thead><tr><th>Page</th><th>State</th><th class="num">Visits</th><th class="num">Conversions</th><th class="num">Rate</th><th></th></tr></thead><tbody>
    ${d.pages.map((p) => `<tr>
      <td><b>${esc(p.title)}</b><div class="sub mono">/${esc(p.slug)}${p.purpose ? ` · ${esc(short(p.purpose, 44))}` : ''}</div></td>
      <td>${mktState(p.state)}</td>
      <td class="num mono">${p.visits}</td><td class="num mono">${p.conversions}</td>
      <td class="num mono">${p.visits ? `${((p.conversions / p.visits) * 100).toFixed(1)}%` : '—'}</td>
      <td>${canM && p.state !== 'live' ? xbtn(`/api/mkt/pages/${p.id}/state`, { state: 'live' }, 'Publish', 'btn-primary') : ''}
          ${canM ? `<button class="btn btn-sm" data-pgres="${p.id}">Record</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No pages yet.</td></tr>'}
    </tbody></table>
  </div>`;
  wireXact(renderPages);
  $('#pg-add')?.addEventListener('click', async () => {
    try {
      await api('/api/mkt/pages', { method: 'POST', body: {
        slug: $('#pg-slug').value.trim(), title: $('#pg-title').value.trim(),
        purpose: $('#pg-purpose').value.trim() || null, personaId: Number($('#pg-persona').value) || null,
      } });
      toast('Drafting'); renderPages();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-pgres]').forEach((b) => b.addEventListener('click', async () => {
    const visits = prompt('Visits?'); if (visits === null) return;
    const conversions = prompt('Conversions?');
    try { await api(`/api/mkt/pages/${b.dataset.pgres}/result`, { method: 'POST', body: { visits: Number(visits) || 0, conversions: Number(conversions) || 0 } }); toast('Recorded'); renderPages(); }
    catch (e) { toast(e.message, true); }
  }));
}
// ---------- Marketing operations ----------
export async function renderMktOps() {
  const d = await api('/api/mkt/ops');
  const canM = hasPermC('marketing.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Entries', d.counts.total, 'tools, rules, conventions and tracking')}
    ${tile('Active', d.counts.active, 'in force right now')}
    ${tile('Scoring rules', d.counts.rules, 'that decide when sales gets a lead')}
    ${tile('Touches tracked', d.health.touchpoints, 'the proof the plumbing works', d.health.touchpoints ? 'tile-ok' : 'tile-warn')}
  </div>
  <div class="panel">
    <div class="panel-title">The plumbing</div>
    <table><thead><tr><th>Kind</th><th>Name</th><th>Detail</th><th>Value</th><th>State</th></tr></thead><tbody>
    ${d.entries.map((o) => `<tr>
      <td><span class="chip chip-dim">${esc(o.kind)}</span></td>
      <td><b>${esc(o.name)}</b></td>
      <td class="sub">${esc(o.detail || '')}</td>
      <td class="mono">${esc(o.value || '—')}</td>
      <td>${mktState(o.state)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing configured.</td></tr>'}
    </tbody></table>
  </div>
  <div class="panel">
    <div class="panel-title">Does the plumbing actually carry anything?</div>
    <table><tbody>
      <tr><td>Touchpoints recorded</td><td class="num mono">${d.health.touchpoints}</td></tr>
      <tr><td>Keywords tracked</td><td class="num mono">${d.health.keywords}</td></tr>
      <tr><td>Paid channels measured</td><td class="num mono">${d.health.channels}</td></tr>
      <tr><td>Sequences built</td><td class="num mono">${d.health.sequences}</td></tr>
      <tr><td>Calendar entries</td><td class="num mono">${d.health.calendar}</td></tr>
    </tbody></table>
    <div class="map-legend">A convention nobody follows is a comment. These counts are the difference between a documented process and a working one.</div>
  </div>
  ${canM ? `
  <div class="panel">
    <div class="panel-title">Add a rule or a tool</div>
    <div class="form-inline">
      <select id="op-kind" aria-label="Kind"><option value="tool">tool</option><option value="rule">rule</option><option value="tracking">tracking</option><option value="convention">convention</option></select>
      <input id="op-name" placeholder="name" style="width:180px">
      <input id="op-value" placeholder="value" style="width:120px">
      <button class="btn btn-sm btn-primary" id="op-add">Add</button>
    </div>
    <input id="op-detail" placeholder="what it means in practice" style="width:70%;margin-top:8px">
  </div>` : ''}`;
  $('#op-add')?.addEventListener('click', async () => {
    try {
      await api('/api/mkt/ops', { method: 'POST', body: {
        kind: $('#op-kind').value, name: $('#op-name').value.trim(),
        detail: $('#op-detail').value.trim() || null, value: $('#op-value').value.trim() || null,
      } });
      toast('Added'); renderMktOps();
    } catch (e) { toast(e.message, true); }
  });
}
// ---------- Search ----------
export async function renderSeo() {
  const d = await api('/api/mkt/seo');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Keywords', d.counts.total, 'researched and kept')}
    ${tile('Targeted', d.counts.targeted, 'pointing at a real page', d.counts.targeted ? 'tile-ok' : '')}
    ${tile('Languages', d.counts.languages, 'Arabic counts separately, and should')}
    ${tile('Unwritten', d.unwritten.length, 'worth winning, nobody has written for', d.unwritten.length ? 'tile-warn' : '')}
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Nobody has written for these</div>
      <table><thead><tr><th>Keyword</th><th>Intent</th><th class="num">Difficulty</th></tr></thead><tbody>
      ${d.unwritten.map((k) => `<tr><td><b>${esc(k.keyword)}</b></td><td class="mono sub">${esc(k.intent || '—')}</td><td class="num mono">${k.difficulty ?? '—'}</td></tr>`).join('')
        || '<tr><td colspan="3" class="empty">Every keyword has a piece written for it.</td></tr>'}
      </tbody></table>
      <div class="map-legend">A keyword nobody has written for is a keyword nobody is winning. This list is the brief queue for the content studio.</div>
    </div>
    <div class="panel">
      <div class="panel-title">By intent</div>
      <table><tbody>${d.byIntent.map((i) => `<tr><td class="mono">${esc(i.intent)}</td><td class="num mono">${i.n}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</tbody></table>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Every keyword</div>
    <table><thead><tr><th>Keyword</th><th>Language</th><th>Intent</th><th class="num">Volume</th><th class="num">Difficulty</th><th>Target</th></tr></thead><tbody>
    ${d.keywords.map((k) => `<tr><td>${esc(k.keyword)}</td><td class="mono sub">${esc(k.language)}</td>
      <td class="mono sub">${esc(k.intent || '—')}</td><td class="num mono">${k.volume ?? '—'}</td>
      <td class="num mono">${k.difficulty ?? '—'}</td><td class="mono sub">${esc(short(k.target_url || '—', 30))}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">No keywords yet — research a topic from the marketing desk.</td></tr>'}
    </tbody></table>
  </div>`;
}
// ---------- Paid media ----------
export async function renderPaidMedia() {
  const d = await api('/api/mkt/paid');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Channels live', d.counts.live, 'buying attention right now')}
    ${tile('Budget', `${d.counts.budgetUsd}`, `${d.counts.spentUsd} spent`)}
    ${tile('Leads bought', d.counts.leads, 'people who raised a hand')}
    ${tile('Cost per lead', d.counts.leads ? `${(d.counts.spentUsd / d.counts.leads).toFixed(2)}` : '—', 'across every channel')}
  </div>
  <div class="panel">
    <div class="panel-title">Which channel earned its money</div>
    <table><thead><tr><th>Channel</th><th class="num">Spent</th><th class="num">Leads</th><th class="num">Customers</th><th class="num">Cost per lead</th><th>Verdict</th></tr></thead><tbody>
    ${d.verdicts.map((v) => {
      const cpl = v.cost_per_lead;
      const verdict = !v.leads ? 'nothing back yet' : cpl < 20 ? 'paying for itself' : cpl < 80 ? 'watch it' : 'stop it';
      return `<tr><td class="mono">${esc(v.channel)}</td>
        <td class="num mono">${Number(v.spent).toFixed(2)}</td>
        <td class="num mono">${v.leads}</td><td class="num mono">${v.customers}</td>
        <td class="num mono">${cpl ? `${cpl}` : '—'}</td>
        <td><span class="chip ${verdict === 'paying for itself' ? 'chip-ok' : verdict === 'stop it' ? 'chip-bad' : 'chip-warn'}">${verdict}</span></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No paid channels planned yet.</td></tr>'}
    </tbody></table>
    <div class="map-legend">The verdict is arithmetic, not opinion: spend over leads. A channel that has taken money and returned nothing says so on its own line rather than being averaged into the total.</div>
  </div>
  <div class="panel">
    <div class="panel-title">Every channel</div>
    <table><thead><tr><th>Campaign</th><th>Channel</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Impressions</th><th class="num">Clicks</th><th class="num">Leads</th><th>State</th></tr></thead><tbody>
    ${d.channels.map((c) => `<tr><td>${esc(c.campaign || '—')}</td><td class="mono">${esc(c.channel)}</td>
      <td class="num mono">${Number(c.budget_usd).toFixed(0)}</td><td class="num mono">${Number(c.spent_usd).toFixed(0)}</td>
      <td class="num mono">${c.impressions || 0}</td><td class="num mono">${c.clicks || 0}</td><td class="num mono">${c.leads || 0}</td>
      <td>${mktState(c.state)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">—</td></tr>'}
    </tbody></table>
  </div>`;
}
// ---------- Lifecycle email ----------
export async function renderLifecycle() {
  const d = await api('/api/mkt/lifecycle');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Live sequences', d.counts.live, 'sending right now', d.counts.live ? 'tile-ok' : '')}
    ${tile('In draft', d.counts.draft, 'written, not switched on')}
    ${tile('Sent', d.counts.sent, 'messages that actually went')}
    <div class="panel tile"><div class="panel-title">The mailbox</div>
      <div class="sub" style="margin-top:8px">${d.gate.connector ? `<span class="chip ${d.gate.connector.state === 'live' ? 'chip-ok' : 'chip-warn'}">gmail · ${esc(d.gate.connector.state)}</span>` : '<span class="chip chip-dim">no mailbox connected</span>'}</div>
      <div class="sub" style="margin-top:6px">Nothing sends until a connector is armed.</div></div>
  </div>
  <div class="panel">
    <div class="panel-title">Sequences</div>
    ${d.sequences.map((s) => `
      <div style="border-top:1px solid var(--seam-soft);padding:var(--s4) 0">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--s3)">
          <div><b>${esc(s.name)}</b> ${mktState(s.state)}<div class="sub">${esc(s.goal || '')}${s.audience ? ` · ${esc(s.audience)}` : ''}</div></div>
          <div class="mono sub">${(s.steps || []).length} emails · ${s.sent || 0} sent</div>
        </div>
        <table style="margin-top:var(--s3)"><tbody>
        ${(s.steps || []).map((st) => `<tr><td class="mono sub" style="width:64px">day ${st.day ?? '—'}</td><td><b>${esc(st.subject || '')}</b><div class="sub">${esc(short(st.body || st.preview || '', 110))}</div></td></tr>`).join('')
          || '<tr><td class="empty">Still being written.</td></tr>'}
        </tbody></table>
      </div>`).join('') || '<div class="empty">No sequences yet.</div>'}
    <div class="map-legend">${esc(d.gate.note)}</div>
  </div>`;
}
// ---------- Editorial calendar ----------
export async function renderCalendar() {
  const d = await api('/api/mkt/calendar');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Planned', d.counts.planned, 'on the calendar, not started')}
    ${tile('In flight', d.counts.inFlight, 'briefed or being written')}
    ${tile('Late', d.counts.late, 'past its date and unpublished', d.counts.late ? 'tile-bad' : '')}
    ${tile('Published', d.counts.published, 'out in the world', d.counts.published ? 'tile-ok' : '')}
  </div>
  <div class="panel">
    <div class="panel-title">What is going out, and when</div>
    <table><thead><tr><th>Piece</th><th>Channel</th><th>Stage</th><th>For</th><th>Due</th><th>State</th></tr></thead><tbody>
    ${d.items.map((c) => {
      const late = c.due_date && c.due_date < new Date().toISOString().slice(0, 10) && c.state !== 'published';
      return `<tr><td><b>${esc(c.title)}</b></td>
        <td class="mono sub">${esc(c.channel || '—')}</td>
        <td><span class="chip chip-dim">${esc(c.stage || '—')}</span></td>
        <td class="sub">${esc(c.persona || 'anyone')}</td>
        <td class="mono sub" style="${late ? 'color:var(--bad)' : ''}">${esc(c.due_date || '—')}</td>
        <td>${mktState(c.state)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">Nothing scheduled.</td></tr>'}
    </tbody></table>
  </div>
  <div class="panel">
    <div class="panel-title">By funnel stage</div>
    <table><tbody>${d.byStage.map((s) => `<tr><td class="mono">${esc(s.stage || 'unset')}</td><td class="num mono">${s.n}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</tbody></table>
    <div class="map-legend">A calendar weighted entirely to one stage is a department talking to itself. Awareness with no decision-stage pieces produces readers; decision with no awareness produces nobody to read them.</div>
  </div>`;
}
// ---------- Personas and positioning, as their own pages ----------
export async function renderPersonas() {
  const d = await api('/api/mkt');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Personas', (d.personas || []).length, 'people we decided we are talking to')}
    ${tile('Grounded', (d.personas || []).filter((p) => p.evidence).length, 'built from real customers and intel', 'tile-ok')}
    ${tile('Approved', (d.personas || []).filter((p) => p.state === 'approved').length, 'a person signed them off')}
    ${tile('Calendar pieces', (d.calendar || []).length, 'written for one of them')}
  </div>
  <div class="panel">
    <div class="panel-title">Who we are talking to</div>
    ${(d.personas || []).map((p) => `
      <div style="border-top:1px solid var(--seam-soft);padding:var(--s4) 0">
        <div style="display:flex;justify-content:space-between;gap:var(--s3)"><div><b>${esc(p.name)}</b> ${mktState(p.state)}<div class="sub">${esc(p.job_title || '')}${p.segment ? ` · ${esc(p.segment)}` : ''}</div></div></div>
        ${p.pains ? `<div class="sub" style="margin-top:6px"><b>What hurts:</b> ${esc(short(p.pains, 260))}</div>` : ''}
        ${p.gains ? `<div class="sub"><b>What they want:</b> ${esc(short(p.gains, 200))}</div>` : ''}
        ${p.objections ? `<div class="sub"><b>Why they say no:</b> ${esc(short(p.objections, 200))}</div>` : ''}
        ${p.channels ? `<div class="sub"><b>Found on:</b> ${esc(short(p.channels, 160))}</div>` : ''}
      </div>`).join('') || '<div class="empty">No personas yet — build one from the marketing desk.</div>'}
    <div class="map-legend">A persona is only worth having if it was built from somebody real. These are grounded in the customer list and the intelligence file, which is why they name actual companies rather than "enterprise decision makers".</div>
  </div>`;
}
export async function renderPositioning() {
  const d = await api('/api/mkt');
  const rows = d.positioning || [];
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Statements', rows.length, 'versions of the promise')}
    ${tile('Approved', rows.filter((p) => p.state === 'approved').length, 'the one everybody repeats', 'tile-ok')}
    ${tile('Campaigns carrying it', (d.campaigns || []).length, 'the promise, out in a channel')}
    ${tile('Proof points', rows.filter((p) => p.proof).length, 'claims with evidence behind them')}
  </div>
  <div class="panel">
    <div class="panel-title">The promise</div>
    ${rows.map((p) => `
      <div style="border-top:1px solid var(--seam-soft);padding:var(--s5) 0">
        ${p.tagline ? `<div style="font-family:var(--font-display);font-size:24px;line-height:1.3">${esc(p.tagline)}</div>` : ''}
        <div class="sub" style="margin-top:8px">${mktState(p.state)} · for ${esc(p.audience || 'everyone')}${p.category ? ` · in ${esc(p.category)}` : ''}</div>
        ${p.promise ? `<div style="margin-top:10px">${esc(p.promise)}</div>` : ''}
        ${p.proof ? `<div class="sub" style="margin-top:8px"><b>Proof:</b> ${esc(short(p.proof, 300))}</div>` : ''}
        ${p.alternatives ? `<div class="sub"><b>Instead of:</b> ${esc(short(p.alternatives, 200))}</div>` : ''}
      </div>`).join('') || '<div class="empty">No positioning yet — write one from the marketing desk.</div>'}
    <div class="map-legend">Positioning is written against real alternatives from the market watch, not in a vacuum. If the promise is true of a competitor as well, it is not positioning — it is a description.</div>
  </div>`;
}
export async function renderBrand() {
  const rows = await api('/api/brand');
  const canM = hasPermC('brand.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Brand studio — the identity every agent must obey</div>
    ${canM ? `<div class="form-inline">
      <select id="br-kind" aria-label="Kind" style="width:auto"><option>voice</option><option>palette</option><option>logo-spec</option><option>boilerplate</option><option>guideline</option></select>
      <input id="br-name" placeholder="asset name" style="width:220px">
      <button class="btn btn-sm btn-primary" id="br-go">Draft with an agent</button></div>` : ''}
  </div>
  ${rows.map((a) => `
  <div class="panel">
    <div class="panel-title"><span>${esc(a.kind)} · ${esc(a.name)} <span class="chip ${a.state === 'approved' ? 'chip-ok' : 'chip-warn'}">${esc(a.state)}</span></span>
      <span>${canM && a.state === 'draft' && a.content ? xbtn(`/api/brand/${a.id}/approve`, {}, 'Approve', 'btn-ok') : ''}</span></div>
    ${preBody(a.content || '⏳ drafting…')}
  </div>`).join('') || '<div class="panel"><div class="empty">No brand assets yet.</div></div>'}`;
  wireXact(renderBrand);
  $('#br-go')?.addEventListener('click', async () => {
    try { await api('/api/brand', { method: 'POST', body: { kind: $('#br-kind').value, name: $('#br-name').value } }); toast('Drafting'); renderBrand(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderMarketingDept() {
  const d = await api('/api/mkt');
  const canM = hasPermC('marketing.manage');
  const f = d.funnel;
  const step = (label, n, sub) => `<div class="fn-step"><b>${n}</b><span>${esc(label)}</span><i>${esc(sub || '')}</i></div>`;
  const tabs = [['plan', 'Plan'], ['channels', 'Channels & spend'], ['calendar', 'Calendar'], ['seo', 'Search'], ['email', 'Lifecycle'], ['team', 'The team']];

  const body = {
    plan: () => `
      <div class="grid grid-2">
        <div class="panel"><div class="panel-title">Who we are talking to</div>
          ${canM ? `<div class="form-inline">
            <input id="pa-name" placeholder="persona name, e.g. Finance Manager in Basra" style="width:280px">
            <input id="pa-seg" placeholder="segment" style="width:140px">
            <button class="btn btn-sm btn-primary" id="pa-go">Draft persona</button></div>` : ''}
          ${d.personas.map((p) => `<div class="ms-row" style="cursor:default">
            <span class="ms-dir">${p.state === 'active' ? '●' : '○'}</span>
            <b>${esc(p.name)}</b><span class="ms-cnt">${esc(p.job_title || 'drafting…')}</span>
            <div class="ms-lbl">${p.pains ? `<b>pains:</b> ${esc(short(p.pains, 110))}` : ''}${p.channels ? `<br><b>found on:</b> ${esc(short(p.channels, 90))}` : ''}
              ${canM && p.state === 'draft' && p.job_title ? ` <button class="btn btn-sm btn-ok" data-pa="${p.id}">Activate</button>` : ''}</div>
          </div>`).join('') || '<div class="empty">No personas yet — everything downstream guesses without one.</div>'}
        </div>
        <div class="panel"><div class="panel-title">What we promise</div>
          ${canM ? `<div class="form-inline">
            <input id="po-aud" placeholder="audience" style="width:180px">
            <input id="po-pro" placeholder="the promise" style="width:240px">
            <button class="btn btn-sm btn-primary" id="po-go">Sharpen</button></div>` : ''}
          ${d.positioning.map((p) => `<div class="ms-row" style="cursor:default">
            <span class="ms-dir">${p.state === 'approved' ? '✓' : '○'}</span>
            <b>${esc(p.tagline || p.promise)}</b>
            <div class="ms-lbl">for <b>${esc(p.audience)}</b>${p.category ? ` · in ${esc(p.category)}` : ''}
              ${p.proof ? `<br><b>proof:</b> ${esc(short(p.proof, 120))}` : ''}
              ${p.messages?.length ? `<br>${p.messages.map((m) => `<span class="edge-tag">${esc(short(m, 40))}</span>`).join(' ')}` : ''}
              ${canM && p.state === 'draft' && p.tagline ? ` <button class="btn btn-sm btn-ok" data-po="${p.id}">Approve</button>` : ''}</div>
          </div>`).join('') || '<div class="empty">Nothing positioned yet.</div>'}
        </div>
      </div>`,
    channels: () => `
      <div class="panel"><div class="panel-title">Channel performance — what each one cost and returned</div>
        ${canM ? `<div class="form-inline">
          <select id="cc-camp" aria-label="Campaign" style="width:auto">${d.campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">no campaigns</option>'}</select>
          <select id="cc-chan" aria-label="Channel" style="width:auto">${['search', 'social', 'email', 'content', 'events', 'partners', 'outbound'].map((c) => `<option>${c}</option>`).join('')}</select>
          <input id="cc-bud" type="number" placeholder="budget $" style="width:110px">
          <button class="btn btn-sm btn-primary" id="cc-go">Plan channel</button></div>` : ''}
        <table><thead><tr><th>Channel</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Impr.</th><th class="num">Clicks</th><th class="num">CTR</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Customers</th><th class="num">CAC</th><th>Verdict</th></tr></thead><tbody>
        ${d.channels.map((c) => {
          const v = d.verdicts.find((x) => x.channel === c.channel);
          return `<tr><td><b>${esc(c.channel)}</b></td>
            <td class="num mono">${money(c.budget)}</td><td class="num mono">${money(c.spent)}</td>
            <td class="num mono">${c.impressions}</td><td class="num mono">${c.clicks}</td><td class="num mono">${c.ctr ?? '—'}%</td>
            <td class="num mono">${c.leads}</td><td class="num mono">${c.cpl ? money(c.cpl) : '—'}</td>
            <td class="num mono">${c.customers}</td><td class="num mono">${c.cac ? money(c.cac) : '—'}</td>
            <td><span class="chip ${v?.verdict === 'paying' ? 'chip-ok' : v?.verdict === 'expensive' ? 'chip-bad' : 'chip-dim'}" title="${esc(v?.detail || '')}">${esc(v?.verdict || '—')}</span></td></tr>`;
        }).join('') || '<tr><td colspan="11" class="empty">No channel has been planned yet.</td></tr>'}
        </tbody></table>
      </div>
      <div class="panel"><div class="panel-title">Campaigns and their channel plans</div>
        ${d.campaigns.map((c) => `<div class="ms-row" style="cursor:default">
          <span class="ms-dir">${c.state === 'live' ? '●' : '○'}</span><b>${esc(c.name)}</b>
          <span class="ms-cnt">${money(c.budget_usd)}</span>
          <div class="ms-lbl">${c.channels.length ? c.channels.map((x) => `<span class="edge-tag">${esc(x.channel)} ${money(x.spent_usd)}/${money(x.budget_usd)}</span>`).join(' ') : 'no channels planned'}</div>
        </div>`).join('') || '<div class="empty">No campaigns.</div>'}
      </div>`,
    calendar: () => `
      <div class="panel"><div class="panel-title">Editorial calendar — planned against the funnel, not the mood</div>
        ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
          <input id="cal-t" placeholder="title" style="width:240px">
          <select id="cal-ch" aria-label="Channel" style="width:auto">${['blog', 'social', 'email', 'video', 'landing'].map((x) => `<option>${x}</option>`).join('')}</select>
          <select id="cal-st" aria-label="State" style="width:auto">${['awareness', 'consideration', 'decision', 'retention'].map((x) => `<option>${x}</option>`).join('')}</select>
          <select id="cal-pa" aria-label="Party A" style="width:auto"><option value="">— persona —</option>${d.personas.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <input id="cal-due" aria-label="Due" type="date" style="width:150px">
          <button class="btn btn-sm btn-primary" id="cal-go">Add to calendar</button></div>` : ''}
        <table><thead><tr><th>Due</th><th>Title</th><th>Channel</th><th>Stage</th><th>Persona</th><th>State</th><th></th></tr></thead><tbody>
        ${d.calendar.map((c) => `<tr>
          <td class="mono">${esc(c.due_date || '—')}</td><td>${esc(c.title)}</td>
          <td class="mono">${esc(c.channel)}</td><td><span class="edge-tag">${esc(c.stage)}</span></td>
          <td>${esc(c.persona || '—')}</td>
          <td><span class="chip ${c.state === 'published' ? 'chip-ok' : c.state === 'ready' ? 'chip-warn' : 'chip-dim'}">${esc(c.state)}</span></td>
          <td>${canM && c.state === 'idea' ? `<button class="btn btn-sm" data-comm="${c.id}">Commission</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">Calendar is empty.</td></tr>'}
        </tbody></table>
      </div>`,
    seo: () => `
      <div class="panel"><div class="panel-title">Search — the queries worth winning</div>
        ${canM ? `<div class="form-inline">
          <input id="seo-t" placeholder="topic, e.g. invoice data extraction" style="width:280px">
          <select id="seo-l" aria-label="Level" style="width:auto"><option value="en">English</option><option value="ar">العربية</option></select>
          <button class="btn btn-sm btn-primary" id="seo-go">Research</button></div>
          <div class="map-legend">The SEO lead returns keywords with intent and difficulty. Volumes stay empty unless real data is supplied — an invented number is worse than none.</div>` : ''}
        <table><thead><tr><th>Keyword</th><th>Lang</th><th>Intent</th><th class="num">Difficulty</th><th class="num">Priority</th></tr></thead><tbody>
        ${d.keywords.map((k) => `<tr><td>${esc(k.keyword)}</td><td class="mono">${esc(k.language)}</td>
          <td><span class="edge-tag">${esc(k.intent || '—')}</span></td>
          <td class="num mono">${k.difficulty ?? '—'}</td><td class="num mono">${k.priority}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No keywords yet.</td></tr>'}
        </tbody></table>
      </div>`,
    email: () => `
      <div class="panel"><div class="panel-title">Lifecycle sequences</div>
        ${canM ? `<div class="form-inline">
          <input id="sq-n" placeholder="sequence name" style="width:180px">
          <input id="sq-g" placeholder="goal" style="width:240px">
          <button class="btn btn-sm btn-primary" id="sq-go">Write it</button></div>` : ''}
        ${d.sequences.map((s) => `<div class="panel" style="background:var(--bg-sunk);margin-top:10px">
          <div class="panel-title"><span>${esc(s.name)} <span class="chip ${s.state === 'live' ? 'chip-ok' : 'chip-dim'}">${esc(s.state)}</span></span>
            <span>${canM && s.state === 'ready' ? xbtn(`/api/mkt/sequences/${s.id}/state`, { state: 'live' }, 'Set live', 'btn-ok') : ''}</span></div>
          <div class="map-legend">${esc(s.goal || '')}</div>
          ${(s.steps || []).map((x) => `<div class="ms-row" style="cursor:default">
            <span class="ms-dir">D${x.day ?? '?'}</span><b>${esc(x.subject || '')}</b>
            <div class="ms-lbl">${esc(short(x.body || '', 220))}</div></div>`).join('') || '<div class="map-legend">⏳ being written…</div>'}
        </div>`).join('') || '<div class="empty">No sequences yet.</div>'}
      </div>`,
    team: () => `
      <div class="panel"><div class="panel-title">The marketing team — real employees on the roster</div>
        <div class="map-legend">Mention any of them by ID in <a href="#/chat">the floor</a> and give them work directly.</div>
        <table><thead><tr><th>Employee</th><th>Speciality</th><th>Mission</th><th class="num">In flight</th><th>Status</th></tr></thead><tbody>
        ${d.team.map((m) => `<tr>
          <td class="mono">${esc(m.id)}<div class="map-legend">${esc(m.name)}</div></td>
          <td><span class="edge-tag">${esc(m.speciality)}</span></td>
          <td>${esc(m.mission)}</td>
          <td class="num mono">${m.load}</td>
          <td><span class="chip ${m.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(m.status)}</span></td>
        </tr>`).join('')}
        </tbody></table>
      </div>`,
  };

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">The funnel — measured, not assumed</div>
    <div class="funnel">
      ${step('impressions', f.impressions, '')}
      ${step('clicks', f.clicks, f.ctr !== null ? `${f.ctr}% CTR` : '')}
      ${step('leads', f.leads, f.leadRate !== null ? `${f.leadRate}% of clicks` : '')}
      ${step('customers', f.customers, f.closeRate !== null ? `${f.closeRate}% of leads` : '')}
    </div>
    <div class="form-inline" style="margin-top:10px">
      <span class="chip">spent ${money(f.spent)} of ${money(f.budget)}</span>
      <span class="chip ${f.cac ? 'chip-warn' : 'chip-dim'}">CAC ${f.cac ? money(f.cac) : '—'}</span>
      <span class="chip chip-ok">attributed MRR ${money(f.mrrAttributed)}</span>
      <span class="chip">payback ${f.paybackMonths ? `${f.paybackMonths} mo` : '—'}</span>
      <span class="chip chip-dim">${d.stats.personas} personas · ${d.stats.liveCampaigns} live campaigns · ${d.stats.plannedContent} pieces planned · ${d.stats.keywords} keywords · ${d.stats.sequencesLive} sequences live</span>
    </div>
  </div>
  <div class="map-style-picker" style="margin-bottom:12px">
    ${tabs.map(([k, l]) => `<button data-mtab="${k}" class="${mktTab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}
  </div>
  ${(body[mktTab] || body.plan)()}`;

  view.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => { mktTab = b.dataset.mtab; renderMarketingDept(); }));
  wireXact(renderMarketingDept);
  const post = async (path, payload, msg) => {
    try { await api(path, { method: 'POST', body: payload }); toast(msg); renderMarketingDept(); }
    catch (e) { toast(e.message, true); }
  };
  $('#pa-go')?.addEventListener('click', () => post('/api/mkt/personas', { name: $('#pa-name').value, segment: $('#pa-seg').value || null }, 'Persona drafting'));
  $('#po-go')?.addEventListener('click', () => post('/api/mkt/positioning', { audience: $('#po-aud').value, promise: $('#po-pro').value }, 'Sharpening'));
  $('#cc-go')?.addEventListener('click', () => post('/api/mkt/channels', { campaignId: Number($('#cc-camp').value), channel: $('#cc-chan').value, budgetUsd: Number($('#cc-bud').value) || 0 }, 'Channel planned'));
  $('#cal-go')?.addEventListener('click', () => post('/api/mkt/calendar', { title: $('#cal-t').value, channel: $('#cal-ch').value, stage: $('#cal-st').value, personaId: Number($('#cal-pa').value) || null, dueDate: $('#cal-due').value || null }, 'Added'));
  $('#seo-go')?.addEventListener('click', () => post('/api/mkt/seo', { topic: $('#seo-t').value, language: $('#seo-l').value }, 'Researching'));
  $('#sq-go')?.addEventListener('click', () => post('/api/mkt/sequences', { name: $('#sq-n').value, goal: $('#sq-g').value }, 'Writing'));
  view.querySelectorAll('[data-pa]').forEach((b) => b.addEventListener('click', () => post(`/api/mkt/personas/${b.dataset.pa}/state`, { state: 'active' }, 'Activated')));
  view.querySelectorAll('[data-po]').forEach((b) => b.addEventListener('click', () => post(`/api/mkt/positioning/${b.dataset.po}/approve`, {}, 'Approved')));
  view.querySelectorAll('[data-comm]').forEach((b) => b.addEventListener('click', () => post(`/api/mkt/calendar/${b.dataset.comm}/commission`, {}, 'Commissioned — the studio is writing it')));
}
// ---------- Contact centre ----------
export async function renderContact() {
  const c = await api('/api/contact');
  const canM = hasPermC('contact.manage');
  const agents = await api('/api/agents').catch(() => []);
  const st = (s) => `<span class="chip ${['completed', 'sent', 'delivered', 'received'].includes(s) ? 'chip-ok' : ['queued', 'drafting', 'ringing', 'live'].includes(s) ? 'chip-warn' : 'chip-dim'}">${esc(s)}</span>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Calls out', c.stats.callsOut, `${c.stats.awaitingDial} waiting to dial`, c.stats.awaitingDial ? 'tile-warn' : '')}
    ${tile('Calls in', c.stats.callsIn, 'answered by the company number')}
    ${tile('Messages', `${c.stats.messagesOut}/${c.stats.messagesIn}`, 'out / in', '')}
    ${tile('Voices', c.voices.length, 'Arabic and English', 'tile-steel')}
  </div>

  <div class="panel">
    <div class="panel-title"><span>Company numbers</span><span class="chip ${c.mode === 'live' ? 'chip-ok' : 'chip-dim'}">${esc(c.mode)}</span></div>
    <div class="map-legend">${c.mode === 'live'
      ? 'Live: calls and messages go through the carrier.'
      : 'Simulated: the whole flow works and nothing dials. To go live, buy a number from Twilio, add <span class="mono">TWILIO_ACCOUNT_SID</span> and <span class="mono">TWILIO_AUTH_TOKEN</span> in Settings, set <span class="mono">PUBLIC_BASE_URL</span>, and point the number\'s voice webhook at <span class="mono">/webhooks/voice</span> and its messaging webhook at <span class="mono">/webhooks/sms</span>.'}</div>
    ${canM ? `<div class="form-inline">
      <input id="n-num" placeholder="+9647701234567" style="width:190px">
      <input id="n-label" placeholder="label" style="width:160px">
      <button class="btn btn-sm btn-primary" id="n-add">Register number</button></div>` : ''}
    <table><tbody>${c.numbers.map((x) => `<tr><td class="mono">${esc(x.number)}</td><td>${esc(x.label)}</td>
      <td><span class="chip ${x.provider === 'twilio' ? 'chip-ok' : 'chip-dim'}">${esc(x.provider)}</span></td></tr>`).join('') || '<tr><td class="empty">No number yet — register one you own.</td></tr>'}</tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Voices</div>
    <div class="form-inline" style="flex-wrap:wrap">
      ${c.voices.map((v) => `<span class="chip" title="${esc(v.twilio)} · ${esc(v.language)}"><b class="mono">${esc(v.id)}</b> — ${esc(v.label)}</span>`).join('')}
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Calls — an employee writes the script, then a human dials</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="c-to" placeholder="+964..." style="width:150px">
      <input id="c-why" placeholder="purpose of the call" style="width:260px">
      <select id="c-voice" aria-label="Voice" style="width:auto">${c.voices.map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('')}</select>
      <select id="c-lang" aria-label="Language" style="width:auto"><option value="en">English</option><option value="ar">العربية</option></select>
      <select id="c-agent" aria-label="Agent" style="width:auto"><option value="">— any employee —</option>${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="c-add">Queue call</button></div>` : ''}
    <table><thead><tr><th>#</th><th>To</th><th>Purpose</th><th>Voice</th><th>State</th><th></th></tr></thead><tbody>
    ${c.calls.map((x) => `<tr>
      <td class="mono">${x.id}${x.direction === 'in' ? ' ←' : ' →'}</td>
      <td class="mono">${esc(x.direction === 'in' ? x.from_number : x.to_number)}</td>
      <td>${esc(x.purpose || '')}${x.script ? `<div class="map-legend">"${esc(short(x.script, 120))}"</div>` : ''}${x.transcript ? `<div class="map-legend" style="color:var(--steel)">${esc(short(x.transcript, 120))}</div>` : ''}</td>
      <td class="mono">${esc(x.voice)}</td>
      <td>${st(x.state)}${x.outcome ? ` <span class="chip chip-dim">${esc(x.outcome)}</span>` : ''}</td>
      <td>${canM && x.state === 'queued' ? `<button class="btn btn-sm btn-ok" data-dial="${x.id}">Dial</button>` : ''}
          ${canM && x.state === 'completed' && !x.outcome ? `<button class="btn btn-sm" data-disp="${x.id}">Mark reached</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No calls yet.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Messages — SMS and WhatsApp threads</div>
    ${canM ? `<div class="form-inline">
      <input id="s-to" placeholder="+964..." style="width:150px">
      <input id="s-body" placeholder="message (leave empty to have an employee write it)" style="width:320px">
      <select id="s-chan" aria-label="Channel" style="width:auto"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
      <select id="s-agent" aria-label="Agent" style="width:auto"><option value="">— draft with —</option>${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="s-add">Queue message</button></div>` : ''}
    ${c.threads.map((t) => `<div class="panel" style="margin-top:10px;background:var(--bg-sunk)">
      <div class="panel-title mono" style="font-size:11px">${esc(t.key)} · ${t.count}</div>
      ${t.messages.map((m) => `<div class="ms-row" style="cursor:default">
        <span class="ms-dir">${m.direction === 'in' ? '←' : '→'}</span>
        <b>${esc(m.body === '…' ? 'writing…' : short(m.body, 90))}</b>
        <span class="ms-cnt">${st(m.state)}</span>
        <div class="ms-lbl">${esc(String(m.created_at).slice(0, 16))} · ${esc(m.channel)}${m.agent_id ? ` · ${esc(m.agent_id)}` : ''}
          ${canM && m.state === 'queued' ? `<button class="btn btn-sm btn-ok" data-send="${m.id}">Send</button>` : ''}</div>
      </div>`).join('')}
    </div>`).join('') || '<div class="empty">No messages yet.</div>'}
  </div>`;
  const post = async (path, body, msg) => {
    try { await api(path, { method: 'POST', body }); toast(msg); renderContact(); } catch (e) { toast(e.message, true); }
  };
  $('#n-add')?.addEventListener('click', () => post('/api/contact/numbers', { number: $('#n-num').value, label: $('#n-label').value }, 'Number registered'));
  $('#c-add')?.addEventListener('click', () => post('/api/contact/calls', { toNumber: $('#c-to').value, purpose: $('#c-why').value, voice: $('#c-voice').value, language: $('#c-lang').value, agentId: $('#c-agent').value || null }, 'Queued — the script is being written'));
  $('#s-add')?.addEventListener('click', () => post('/api/contact/messages', { toNumber: $('#s-to').value, body: $('#s-body').value || null, channel: $('#s-chan').value, draftWith: $('#s-agent').value || null }, 'Queued'));
  view.querySelectorAll('[data-dial]').forEach((b) => b.addEventListener('click', () => post(`/api/contact/calls/${b.dataset.dial}/place`, {}, 'Dialling')));
  view.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => post(`/api/contact/messages/${b.dataset.send}/send`, {}, 'Sent')));
  view.querySelectorAll('[data-disp]').forEach((b) => b.addEventListener('click', () => post(`/api/contact/calls/${b.dataset.disp}/disposition`, { outcome: 'reached' }, 'Dispositioned')));
}
