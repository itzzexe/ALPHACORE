// One renderer, twenty-two departments.
//
// A department that is a list of things with a state, a form to add one and a
// couple of buttons is the same page every time. Writing it twenty-two times is
// how twenty-two pages end up disagreeing about what a state chip looks like.

import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { currentUser, hasPermC } from '../state/session.js';
import { tile } from './tile.js';
import { t, lang } from '/i18n.js';

// ---------- the six new departments, one shared renderer ----------
const DEPT_PAGES = {
  pricing: {
    title: 'Pricing', perm: 'pricing.manage', endpoint: '/api/pricing',
    intro: 'Several agents are forbidden from stating a price that is not backed by an approved pricing record. This is that record — a draft is invisible to them, an approved one is quotable.',
    tiles: (d) => [
      ['Records', d.records.length, `${d.approved.length} approved and quotable`],
      ['Approved', d.approved.length, 'agents may cite these'],
      ['Drafts', d.records.filter((r) => r.state === 'draft').length, 'awaiting your approval'],
      ['Retired', d.records.filter((r) => r.state === 'retired').length, 'kept for the record'],
    ],
    form: () => `
      <div class="form-inline">
        <div style="flex:1.5"><label class="fl" for="pc-name">Name</label><input type="text" id="pc-name" placeholder="Pro plan"></div>
        <div><label class="fl" for="pc-amount">Amount</label><input type="text" id="pc-amount" value="0"></div>
        <div style="flex:0.6"><label class="fl" for="pc-cur">Currency</label><input type="text" id="pc-cur" value="USD"></div>
        <div><label class="fl" for="pc-unit">Unit</label><input type="text" id="pc-unit" value="per month"></div>
        <div><label class="fl" for="pc-plan">Plan</label><input type="text" id="pc-plan" value="standard"></div>
        <button class="btn btn-primary" id="pc-go">Draft with analysis</button>
      </div>
      <div><label class="fl" for="pc-why">Why this price?</label><input type="text" id="pc-why" placeholder="what the buyer compares it to, what it must cover"></div>`,
    submit: async () => api('/api/pricing', { method: 'POST', body: { name: $('#pc-name').value, amount: Number($('#pc-amount').value) || 0, currency: $('#pc-cur').value, unit: $('#pc-unit').value, plan: $('#pc-plan').value, rationale: $('#pc-why').value || null } }),
    rows: (d, canM) => d.records.map((r) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(r.name)}</b> <span class="mono">${esc(String(r.amount))} ${esc(r.currency)} ${esc(r.unit)}</span>
            <span class="chip chip-dim">${esc(r.plan)}</span>
            <span class="state state-${r.state === 'approved' ? 'done' : r.state === 'retired' ? 'failed' : 'awaiting_human'}">${esc(r.state)}</span></span>
          <span>${canM && r.state === 'draft' ? `<button class="btn btn-sm btn-ok" data-act='{"path":"/api/pricing/${r.id}/state","body":{"state":"approved"}}'>Approve</button>` : ''}
            ${canM && r.state === 'approved' ? `<button class="btn btn-sm" data-act='{"path":"/api/pricing/${r.id}/state","body":{"state":"retired"}}'>Retire</button>` : ''}</span>
        </div>
        ${r.approved_by ? `<div class="map-legend">approved by ${esc(r.approved_by)}</div>` : ''}
        ${r.rationale ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">the pricing analysis</summary><pre class="json" style="max-height:40vh;white-space:pre-wrap">${esc(r.rationale)}</pre></details>` : '<div class="map-legend">the analyst is working on the rationale…</div>'}
      </div></div>`).join('') || '<div class="empty">No pricing records — until one is approved, no agent may quote a price.</div>',
  },
  success: {
    title: 'Customer success', perm: 'success.manage', endpoint: '/api/success',
    intro: 'The CRM knows who pays. This knows who is actually healthy — judged from ticket history and how recently anyone spoke to them, not from optimism.',
    tiles: (d) => [
      ['Assessed', d.assessed, `of ${d.customers} customers`],
      ['At risk', d.atRisk, `$${d.mrrAtRisk}/mo exposed`],
      ['Average score', d.avgScore ?? '—', 'out of 5'],
      ['Unassessed', Math.max(0, d.customers - d.assessed), 'nobody has looked'],
    ],
    form: () => `<div class="map-legend">Open a customer below and assess them, or run one from the <a href="#/customers">CRM</a>.</div>`,
    rows: (d, canM) => d.rows.map((r) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(r.customer_name)}</b> <span class="mono">$${r.mrr_usd}/mo</span>
            <span class="chip ${['at_risk', 'churn_risk'].includes(r.stage) ? 'chip-bad' : r.stage === 'healthy' ? 'chip-ok' : 'chip-dim'}">${esc(r.stage.replace('_', ' '))}</span>
            <span class="chip chip-dim">${'●'.repeat(r.score)}${'○'.repeat(5 - r.score)}</span></span>
          <span>${canM ? `<button class="btn btn-sm" data-act='{"path":"/api/success/${r.customer_id}/assess","body":{}}'>Re-assess</button>` : ''}</span>
        </div>
        ${r.notes ? `<div class="map-legend">${esc(r.notes)}</div>` : '<div class="map-legend">assessing…</div>'}
        ${r.next_step ? `<div style="font-size:12.5px;margin-top:4px">→ <b>${esc(r.next_step)}</b></div>` : ''}
      </div></div>`).join('') || '<div class="empty">No customers assessed yet.</div>',
    extra: (d) => d.customers > d.assessed ? `<div class="panel"><div class="panel-title">Not yet assessed</div><div class="map-legend">Assess a customer from the <a href="#/customers">CRM</a> — the success desk reads their tickets and interaction history to judge health.</div></div>` : '',
  },
  assets: {
    title: 'Assets', perm: 'assets.manage', endpoint: '/api/assets', listKey: null,
    intro: 'Domains, licences, credentials and devices expire exactly like vendor contracts, and losing one quietly is how companies lose their name. Renewals inside 21 days raise an alert.',
    tiles: (d) => [
      ['Assets', d.length, `${d.filter((a) => a.state === 'active').length} active`],
      ['Monthly cost', `$${d.reduce((a, x) => a + (x.cost_usd || 0), 0)}`, 'across all assets'],
      ['Renewing soon', d.filter((a) => a.renewal_date && a.renewal_date <= new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10)).length, 'within 21 days'],
      ['Kinds', new Set(d.map((a) => a.kind)).size, 'domains, licences, credentials…'],
    ],
    form: () => `
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl" for="as-name">Name</label><input type="text" id="as-name" placeholder="alphacore.iq domain"></div>
        <div><label class="fl" for="as-kind">Kind</label><select id="as-kind" aria-label="Kind"><option>domain</option><option>license</option><option>credential</option><option>device</option><option>repo</option><option>account</option><option>certificate</option></select></div>
        <div><label class="fl" for="as-owner">Owner</label><input type="text" id="as-owner" value="${esc(currentUser?.username || '')}"></div>
        <div style="flex:0.6"><label class="fl" for="as-cost">$/mo</label><input type="text" id="as-cost" value="0"></div>
        <div><label class="fl" for="as-renew">Renews</label><input type="text" id="as-renew" placeholder="2027-01-15"></div>
        <button class="btn btn-primary" id="as-go">Register</button>
      </div>`,
    submit: async () => api('/api/assets', { method: 'POST', body: { name: $('#as-name').value, kind: $('#as-kind').value, owner: $('#as-owner').value, costUsd: Number($('#as-cost').value) || 0, renewalDate: $('#as-renew').value || null } }),
    rows: (d, canM) => `<table><thead><tr><th>Asset</th><th>Kind</th><th>Owner</th><th class="num">$/mo</th><th>Renews</th><th>State</th>${canM ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.map((a) => {
        const soon = a.renewal_date && a.renewal_date <= new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
        return `<tr style="${a.state === 'retired' ? 'opacity:.5' : ''}">
          <td><b>${esc(a.name)}</b>${a.vendor ? ` <a class="chip chip-dim" style="text-decoration:none" href="#/vendors">${esc(a.vendor.name)}</a>` : ''}</td>
          <td><span class="chip chip-steel">${esc(a.kind)}</span></td>
          <td class="mono">${esc(a.owner)}</td>
          <td class="num">${a.cost_usd}</td>
          <td class="mono" style="color:${soon ? 'var(--warn)' : 'var(--ink-faint)'}">${esc(a.renewal_date || '—')}</td>
          <td><span class="chip ${a.state === 'active' ? 'chip-ok' : 'chip-dim'}">${esc(a.state)}</span></td>
          ${canM ? `<td>${a.state !== 'retired' ? `<button class="btn btn-sm" data-act='{"path":"/api/assets/${a.id}/state","body":{"state":"retired"}}'>Retire</button>` : ''}</td>` : ''}
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">No assets registered.</td></tr>'}
    </tbody></table>`,
  },
  localization: {
    title: 'Localization', perm: 'localization.manage', endpoint: '/api/localization', listKey: null,
    intro: 'Adaptation between Arabic and English for meaning and market — not word by word. Formatting, numbers and placeholders are preserved exactly; anything that could not carry over is noted.',
    tiles: (d) => [
      ['Translations', d.length, `${d.filter((l) => l.state === 'approved').length} approved`],
      ['Ready to review', d.filter((l) => l.state === 'ready').length, 'awaiting your sign-off'],
      ['In progress', d.filter((l) => l.state === 'translating').length, 'the localization agent is working'],
      ['Languages', new Set(d.map((l) => l.target_lang)).size, 'targets in use'],
    ],
    form: () => `
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl" for="lo-title">Title</label><input type="text" id="lo-title"></div>
        <div><label class="fl" for="lo-kind">From</label><select id="lo-kind" aria-label="Kind"><option value="manual">pasted text</option><option value="content">content item</option><option value="post">social post</option><option value="doc">design document</option></select></div>
        <div style="flex:0.5"><label class="fl" for="lo-sid">Source #</label><input type="text" id="lo-sid" placeholder="id"></div>
        <div style="flex:0.5"><label class="fl" for="lo-lang">Into</label><select id="lo-lang" aria-label="Language"><option value="ar">العربية</option><option value="en">English</option><option value="ku">Kurdish</option><option value="tr">Türkçe</option></select></div>
        <button class="btn btn-primary" id="lo-go">Translate</button>
      </div>
      <div><label class="fl" for="lo-text">Text (leave blank when pulling from a source above)</label><textarea id="lo-text" style="min-height:80px"></textarea></div>`,
    submit: async () => api('/api/localization', { method: 'POST', body: { title: $('#lo-title').value || null, sourceKind: $('#lo-kind').value, sourceId: $('#lo-sid').value || null, sourceText: $('#lo-text').value || null, targetLang: $('#lo-lang').value } }),
    rows: (d, canM) => d.map((l) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(l.title)}</b> <span class="chip chip-dim">${esc(l.source_kind)}</span> <span class="chip chip-steel">→ ${esc(l.target_lang)}</span>
            <span class="state state-${l.state === 'approved' ? 'done' : l.state === 'ready' ? 'awaiting_human' : l.state === 'failed' ? 'failed' : 'running'}">${esc(l.state)}</span></span>
          <span>${canM && l.state === 'ready' ? `<button class="btn btn-sm btn-ok" data-act='{"path":"/api/localization/${l.id}/approve","body":{}}'>Approve</button>` : ''}</span>
        </div>
        ${l.output ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">read the adaptation</summary><pre class="json" style="max-height:45vh;white-space:pre-wrap">${esc(l.output)}</pre></details>` : '<div class="map-legend">translating…</div>'}
        ${l.notes ? `<div class="map-legend">${esc(l.notes)}</div>` : ''}
      </div></div>`).join('') || '<div class="empty">Nothing translated yet.</div>',
  },
  marketwatch: {
    title: 'Market watch', perm: 'marketwatch.manage', endpoint: '/api/marketwatch', listKey: null,
    intro: 'Intelligence collects prospects. This watches rivals — what they sell, what they charge, where they are weak, and how they would react if we moved into their space.',
    tiles: (d) => [
      ['Competitors', d.length, `${d.filter((c) => c.state === 'watching').length} watched`],
      ['High threat', d.filter((c) => c.threat >= 4).length, 'threat 4 or 5'],
      ['Profiled', d.filter((c) => c.brief).length, 'with a research brief'],
      ['Checked live', d.filter((c) => c.last_checked).length, 'site fetched by the harvester'],
    ],
    form: () => `
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl" for="mw-name">Competitor</label><input type="text" id="mw-name"></div>
        <div style="flex:1.2"><label class="fl" for="mw-site">Website</label><input type="text" id="mw-site" placeholder="example.com"></div>
        <div><label class="fl" for="mw-seg">Segment</label><input type="text" id="mw-seg" placeholder="SME invoicing"></div>
        <button class="btn btn-primary" id="mw-go">Add & research</button>
      </div>`,
    submit: async () => api('/api/marketwatch', { method: 'POST', body: { name: $('#mw-name').value, website: $('#mw-site').value || null, segment: $('#mw-seg').value || null } }),
    rows: (d, canM) => d.map((c) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(c.name)}</b>${c.website ? ` <a href="${esc(/^https?:/.test(c.website) ? c.website : `https://${c.website}`)}" target="_blank" rel="noopener noreferrer" class="chip chip-dim" style="text-decoration:none">${esc(c.website)}</a>` : ''}
            ${c.segment ? `<span class="chip chip-steel">${esc(c.segment)}</span>` : ''}
            <span class="chip ${c.threat >= 4 ? 'chip-bad' : c.threat >= 3 ? 'chip-warn' : 'chip-dim'}">threat ${c.threat}/5</span></span>
          <span>${canM ? `${[1, 2, 3, 4, 5].map((t) => `<button class="btn btn-sm" data-act='{"path":"/api/marketwatch/${c.id}/threat","body":{"threat":${t}}}' style="padding:2px 6px;${c.threat === t ? 'color:var(--ember)' : ''}">${t}</button>`).join('')}
            ${c.website ? `<button class="btn btn-sm" data-act='{"path":"/api/marketwatch/${c.id}/check","body":{}}'>Check site</button>` : ''}` : ''}</span>
        </div>
        ${c.brief ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">the profile${c.last_checked ? ` · last checked ${esc(c.last_checked.slice(0, 16))}` : ''}</summary><pre class="json" style="max-height:45vh;white-space:pre-wrap">${esc(c.brief)}</pre></details>` : '<div class="map-legend">researching…</div>'}
      </div></div>`).join('') || '<div class="empty">No competitors on watch.</div>',
  },
  enablement: {
    title: 'Enablement', perm: 'enablement.manage', endpoint: '/api/enablement', listKey: null,
    intro: 'Evals produce a red number; this turns that number into training. The plan says what wording the role specification needs, what the output contract should tighten, and which cases belong in the golden set.',
    tiles: (d) => [
      ['Plans', d.length, `${d.filter((e) => e.state === 'applied').length} applied to a spec`],
      ['Ready to apply', d.filter((e) => e.state === 'ready').length, 'read and apply them'],
      ['From failed evals', d.filter((e) => e.trigger === 'eval-fail').length, 'raised automatically'],
      ['Analysing', d.filter((e) => e.state === 'analysing').length, 'diagnosis in progress'],
    ],
    form: (extra) => `
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl" for="en-agent">Employee</label><select id="en-agent" aria-label="Agent">${(extra.agents || []).map((a) => `<option value="${esc(a.id)}">${esc(a.id)} — ${esc(a.name)}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="en-go">Analyse and plan</button>
      </div>`,
    submit: async () => api('/api/enablement', { method: 'POST', body: { agentId: $('#en-agent').value } }),
    rows: (d, canM) => d.map((e) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(e.agent_id)}</b> <span class="chip chip-dim">${esc(e.trigger)}</span>
            <span class="state state-${e.state === 'applied' ? 'done' : e.state === 'ready' ? 'awaiting_human' : e.state === 'dismissed' ? 'failed' : 'running'}">${esc(e.state)}</span></span>
          <span>${canM && e.state === 'ready' ? `<button class="btn btn-sm btn-ok" data-act='{"path":"/api/enablement/${e.id}/state","body":{"state":"applied"}}'>Mark applied</button>
            <button class="btn btn-sm" data-act='{"path":"/api/enablement/${e.id}/state","body":{"state":"dismissed"}}'>Dismiss</button>` : ''}</span>
        </div>
        ${e.findings ? `<div class="map-legend">${esc(e.findings)}</div>` : ''}
        ${e.plan ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">the improvement plan</summary><pre class="json" style="max-height:45vh;white-space:pre-wrap">${esc(e.plan)}</pre></details>` : '<div class="map-legend">analysing the failure pattern…</div>'}
        <div class="map-legend">Applying a plan means editing the role specification in <a href="#/org">the org</a> or config, then re-running its <a href="#/evals">eval set</a> to prove it worked.</div>
      </div></div>`).join('') || '<div class="empty">No enablement plans. They are also raised automatically when an eval scores under 70%.</div>',
  },
};
export function makeDeptRenderer(key) {
  return async function renderDept() {
    const cfg = DEPT_PAGES[key];
    const data = await api(cfg.endpoint);
    const canM = hasPermC(cfg.perm);
    const extra = key === 'enablement' ? { agents: await api('/api/agents').catch(() => []) } : {};
    const tiles = cfg.tiles(data);
    view.innerHTML = `
    <div class="grid grid-4">
      ${tiles.map(([label, big, sub], i) => `<div class="panel tile ${i === 1 ? 'tile-steel' : ''}"><div class="panel-title">${esc(label)}</div><div class="big">${esc(String(big))}</div><div class="sub">${sub}</div></div>`).join('')}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(cfg.title)}</div>
      <div class="map-legend">${cfg.intro}</div>
      ${canM ? cfg.form(extra) : ''}
    </div>
    <div class="panel">${cfg.rows(data, canM)}</div>
    ${cfg.extra ? cfg.extra(data) : ''}`;

    view.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      let spec; try { spec = JSON.parse(b.dataset.act); } catch { return; }
      b.disabled = true;
      try { await api(spec.path, { method: 'POST', body: spec.body || {} }); renderDept(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    const goBtn = view.querySelector('#pc-go, #as-go, #lo-go, #mw-go, #en-go');
    goBtn?.addEventListener('click', async () => {
      try { await cfg.submit(); toast('Done'); renderDept(); } catch (e) { toast(e.message, true); }
    });
  };
}
