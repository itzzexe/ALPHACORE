// The intelligence surface: every department behind that door.
//
// Grouped by the same mapping the navigation is drawn from, so a module
// boundary and a menu boundary cannot drift apart.

import { $, esc, linkFor, short, toast, view } from '../core/dom.js';
import { DS_SOURCE_ICON, ENRICH_CHIP, contactCell, peopleBlock } from '../components/bits.js';
import { actor, hasPermC } from '../state/session.js';
import { api } from '../services/api.js';
import { connBtn, renderConnections, wireConnections, wireDownloads } from '../components/common.js';
import { tile } from '../components/tile.js';
import { wireXact, xbtn } from '../components/chrome.js';

export async function renderEmbeddings() {
  const d = await api('/api/embeddings');
  view.innerHTML = `
  <div class="grid grid-3">
    ${tile('Space', d.space.split(':')[0], d.model ? esc(d.model) : 'string overlap', d.model ? 'tile-ok' : 'tile-warn')}
    ${tile('Indexed', d.spaces.reduce((n, s) => n + s.n, 0), 'things the graph can find')}
    ${tile('Needs reindexing', d.needsReindex, 'in a space that is no longer current', d.needsReindex ? 'tile-warn' : '')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Whether search understands the question, or only its letters</div>
    <div class="map-legend">${esc(d.quality)}<br><br>
      Trigram overlap finds "invoice OCR platform" from "invoice ocr". It does <b>not</b> find "the tool that
      reads receipts" — measured at 0.000 similarity between those two phrases, which is a ceiling on every
      answer the workforce gives rather than a rough edge on a search box. A local model fixes that without
      anything leaving this machine.<br><br>
      Vectors from two models are never compared: each row records the space it belongs to, and a comparison
      across spaces returns nothing rather than a number. A ranked list of nonsense looks exactly like a ranked
      list, which makes that worse than an error.</div>
    <div class="form-inline" style="margin-top:10px">
      ${d.spaces.map((s) => `<span class="chip ${s.space === d.space ? 'chip-ok' : 'chip-warn'}">${esc(s.space)} · ${s.n}</span>`).join('')}
      ${hasPermC('graph.manage') && d.needsReindex ? '<button class="btn btn-primary" id="em-reindex">Reindex</button>' : ''}
    </div>
    ${d.lastDegraded ? `<div class="login-note" style="margin-top:10px">The local model was unreachable at ${esc(d.lastDegraded.occurred_at)} and recall fell back to string overlap.</div>` : ''}
  </div>`;
  $('#em-reindex')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api('/api/embeddings/reindex', { method: 'POST', body: {} }); toast(`${r.reindexed} reindexed, ${r.remaining} to go`); renderEmbeddings(); }
    catch (err) { toast(err.message, true); }
  });
}
export async function renderIntel() {
  const [ov, queries, segments, ruleCatalog] = await Promise.all([
    api('/api/intel/overview'), api('/api/intel'), api('/api/segments').catch(() => []), api('/api/intel/rules').catch(() => []),
  ]);
  const canM = hasPermC('intel.manage');
  const pctBar = (v) => `<div class="meter" style="margin:4px 0 0"><div class="meter-track"><div class="meter-fill ${v >= 70 ? '' : 'hot'}" style="width:${v}%"></div></div></div>`;

  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Records</div><div class="big">${ov.records}</div><div class="sub">${ov.campaigns} campaigns · ${ov.running} running</div></div>
    <div class="panel tile ${ov.withEmail ? 'tile-steel' : 'tile-warn'}"><div class="panel-title">Contactable</div><div class="big">${ov.withEmail}<span class="unit">✉</span> ${ov.withPhone}<span class="unit">☎</span></div><div class="sub">${ov.contacts} contact points harvested</div></div>
    <div class="panel tile"><div class="panel-title">Web-confirmed</div><div class="big">${ov.webConfirmed}</div><div class="sub">fetched from the org's own site</div></div>
    <div class="panel tile"><div class="panel-title">People found</div><div class="big">${ov.people ?? 0}</div><div class="sub">${ov.peopleWithDirect ?? 0} with a direct line or address</div></div>
    <div class="panel tile"><div class="panel-title">Avg completeness</div><div class="big">${ov.avgCompleteness}<span class="unit">%</span></div><div class="sub">${ov.verified} verified · ${ov.targeted} targeted</div>${pctBar(ov.avgCompleteness)}</div>
  </div>

  ${canM ? `<div class="panel">
    <div class="panel-title">New intelligence campaign — precise criteria beat a vague sentence</div>
    <div class="form-inline">
      <div><label class="fl" for="iq-kind">Type</label><select id="iq-kind" aria-label="Kind"><option value="company">companies</option><option value="government body">government bodies</option><option value="ngo">NGOs</option><option value="investor">investors</option><option value="supplier">suppliers</option><option value="distributor">distributors</option></select></div>
      <div><label class="fl" for="iq-sector">Sector / القطاع</label><input type="text" id="iq-sector" placeholder="energy · oil & gas"></div>
      <div><label class="fl" for="iq-country">Country / الدولة</label><input type="text" id="iq-country" placeholder="Iraq"></div>
      <div><label class="fl" for="iq-city">City / المدينة</label><input type="text" id="iq-city" placeholder="Basra"></div>
      <div style="flex:0.5"><label class="fl" for="iq-size">Size</label><select id="iq-size" aria-label="Size"><option value="">any</option><option>SME</option><option>mid-market</option><option>enterprise</option><option>state-owned</option></select></div>
      <div style="flex:0.4"><label class="fl" for="iq-count">Target #</label><input type="text" id="iq-count" value="15"></div>
      <button class="btn btn-primary" id="iq-go">Run campaign</button>
    </div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="iq-keywords">Must relate to (keywords)</label><input type="text" id="iq-keywords" placeholder="refinery services, EPC contracts, solar"></div>
      <div><label class="fl" for="iq-exclude">Exclude</label><input type="text" id="iq-exclude" placeholder="pure retailers"></div>
      <div style="flex:2"><label class="fl" for="iq-q">Analyst note (Arabic or English)</label><input type="text" id="iq-q" placeholder="اريد شركات الطاقة العاملة في العراق مع طرق التواصل"></div>
    </div>

    <div class="panel-title" style="margin-top:14px">Escalation rules — what to do when a record comes back thin</div>
    <div class="rule-grid">
      ${ruleCatalog.map((r) => `
        <label class="rule-card">
          <input type="checkbox" class="iq-rule" value="${esc(r.id)}" ${['people-when-no-phone', 'ask-executives', 'derive-emails', 'deep-when-no-address'].includes(r.id) ? 'checked' : ''}>
          <span><b>${esc(r.label)}</b><span class="rule-detail">${esc(r.detail)}</span></span>
        </label>`).join('')}
    </div>

    <div class="panel-title" style="margin-top:14px">Constraints — a record only counts as a result if it passes these</div>
    <div class="form-inline">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="iq-req-phone"> must have a phone</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="iq-req-email"> must have an email</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="iq-req-site"> site must be reachable</label>
      <div style="flex:0.6"><label class="fl" for="iq-min">Min complete %</label><input type="text" id="iq-min" value="0"></div>
      <div style="flex:1.2"><label class="fl" for="iq-mention">Profile must mention</label><input type="text" id="iq-mention" placeholder="oil, gas, refinery"></div>
      <div style="flex:1"><label class="fl" for="iq-notmention">Reject if it mentions</label><input type="text" id="iq-notmention" placeholder="retail, restaurant"></div>
    </div>

    <div class="map-legend">
      <b>How a campaign runs:</b> ① the Intelligence agent proposes real organizations + their likely official domain →
      ② the platform <b>fetches each site over HTTP</b> (home, /contact, /about) and harvests emails, phones, address, socials — each stamped with its source URL →
      ③ records still missing a domain go back for a better hypothesis and are re-fetched →
      ④ more rounds run until the target count is met or two rounds return nothing new →
      ⑤ every record gets a completeness score and an explicit gap list. Contact details are <b>never</b> model-invented: they are scraped, human-entered, or declared a gap.
    </div>
  </div>` : ''}

  ${queries.map((iq) => {
    const p = iq.progress;
    return `
  <div class="panel">
    <div class="panel-title">
      <span>#${iq.id} · ${esc(short(iq.question, 80))}</span>
      <span>
        <span class="state state-${iq.state === 'ready' ? 'done' : iq.state === 'failed' ? 'failed' : 'running'}">${esc(iq.state)}${iq.state !== 'ready' ? ` · round ${iq.round}` : ''}</span>
        ${iq.records.length ? `
          <button class="btn btn-sm" data-download="/api/intel/export?queryId=${iq.id}&format=xls" data-filename="intel-${iq.id}.xls" title="real Excel workbook — typed columns, Arabic-safe">⬇ Excel</button>
          <button class="btn btn-sm" data-download="/api/intel/export?queryId=${iq.id}&format=csv" data-filename="intel-${iq.id}.csv" title="CSV with UTF-8 BOM">⬇ CSV</button>` : ''}
        ${canM && iq.records.length ? `<button class="btn btn-sm" data-autoseg="${iq.id}">AI segment</button>
        <button class="btn btn-sm btn-ok" data-bulk="${iq.id}">Bulk target verified</button>` : ''}
      </span>
    </div>
    ${iq.criteria ? `<div class="agent-meta">${Object.entries(iq.criteria).map(([k, v]) => `<span class="chip chip-dim">${esc(k)}: ${esc(v)}</span>`).join('')}</div>` : ''}
    ${(iq.rules || []).length || iq.constraints ? `<div class="agent-meta">
      ${(iq.rules || []).map((rid) => `<span class="chip chip-ember" title="${esc(ruleCatalog.find((x) => x.id === rid)?.detail || '')}">⚙ ${esc(ruleCatalog.find((x) => x.id === rid)?.label || rid)}</span>`).join('')}
      ${iq.constraints ? Object.entries(iq.constraints).map(([k, v]) => `<span class="chip chip-warn">must: ${esc(k)}${v === true ? '' : ` = ${esc(v)}`}</span>`).join('') : ''}
    </div>` : ''}
    <div class="agent-meta">
      <span class="chip">${p.collected}/${p.target} collected</span>
      ${p.people ? `<span class="chip chip-steel">👤 ${p.people} people</span>` : ''}
      ${p.rejected ? `<span class="chip chip-bad">${p.rejected} rejected</span>` : ''}
      <span class="chip ${p.withEmail ? 'chip-ok' : 'chip-dim'}">✉ ${p.withEmail}</span>
      <span class="chip ${p.withPhone ? 'chip-ok' : 'chip-dim'}">☎ ${p.withPhone}</span>
      <span class="chip ${p.withAddress ? 'chip-ok' : 'chip-dim'}">⌂ ${p.withAddress}</span>
      <span class="chip chip-steel">${p.enriched} web-confirmed</span>
      ${p.pending ? `<span class="chip chip-warn">${p.pending} harvesting…</span>` : ''}
      <span class="chip">avg ${p.avgCompleteness}%</span>
      ${p.verified ? `<span class="chip chip-ok">${p.verified} verified</span>` : ''}
    </div>
    ${iq.summary ? `<div class="map-legend">${esc(short(iq.summary, 220))}</div>` : ''}
    ${iq.records.length ? `
    <table>
      <thead><tr><th style="width:26%">Organization / المنظمة</th><th>Location · sector</th><th style="width:26%">Contact — with provenance</th><th class="num">Complete</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${iq.records.map((r) => {
        const [chipCls, chipTxt] = ENRICH_CHIP[r.enrichment] || ['chip-dim', r.enrichment];
        const cp = Math.round((r.completeness || 0) * 100);
        return `
        <tr style="${r.rejected_reason ? 'opacity:.5' : ''}">
          <td><b>${esc(r.name)}</b>${r.name_ar ? `<div style="color:var(--ink-mute)">${esc(r.name_ar)}</div>` : ''}
            ${r.profile ? `<div class="map-legend">${esc(short(r.profile, 130))}</div>` : ''}
            <span class="chip ${chipCls}">${chipTxt}</span>${r.size_hint ? `<span class="chip chip-dim">${esc(r.size_hint)}</span>` : ''}
            ${r.rejected_reason ? `<span class="chip chip-bad" title="excluded by a campaign constraint">rejected: ${esc(r.rejected_reason)}</span>` : ''}
            ${r.email_pattern ? `<div class="map-legend">email pattern: <span class="mono">${esc(r.email_pattern)}</span></div>` : ''}
            ${(r.rulesLog || []).length ? `<div class="map-legend" style="color:var(--ink-faint)">${r.rulesLog.map((l) => `⚙ ${esc(l)}`).join('<br>')}</div>` : ''}</td>
          <td class="mono" style="font-size:11.5px">${esc([r.city, r.region, r.country].filter(Boolean).join(', ') || '—')}<div style="color:var(--ink-faint)">${esc(r.sector || '')}</div></td>
          <td style="font-size:11.5px">${contactCell(r)}${peopleBlock(r, canM)}</td>
          <td class="num" style="color:${cp >= 70 ? 'var(--ok)' : cp >= 40 ? 'var(--warn)' : 'var(--bad)'}">${cp}%</td>
          <td>
            <span class="chip ${r.verification === 'verified' ? 'chip-ok' : 'chip-warn'}">${esc(r.verification)}</span>
            ${r.customer_id ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">→ lead #${r.customer_id}</a>` : ''}
          </td>
          <td>${canM ? `
            ${r.verification === 'unverified' ? `<button class="btn btn-sm" data-iverify="${r.id}">Verify</button>` : ''}
            ${!r.customer_id ? `<button class="btn btn-sm btn-ok" data-itarget="${r.id}">→ CRM</button>` : ''}
            <button class="btn btn-sm" data-ifix="${r.id}" title="correct the website / add contacts by hand">Edit</button>
            <button class="btn btn-sm" data-irefetch="${r.id}" title="re-harvest the site now">↻</button>
            <button class="btn btn-sm" data-irules="${r.id}" title="re-run the campaign's escalation rules on this record">⚙</button>
            ${connBtn('intelRecord', r.id)}
            ${segments.length ? `<select data-isegsel="${r.id}" style="width:auto;font-size:11px"><option value="">+seg</option>${segments.map((s) => `<option value="${s.id}">${esc(short(s.name, 18))}</option>`).join('')}</select>` : ''}` : ''}
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>` : ['collecting', 'enriching', 'gapfill'].includes(iq.state) ? '<div class="empty">Working — collecting candidates…</div>' : '<div class="empty">No records.</div>'}
  </div>`;
  }).join('')}

  <div class="panel">
    <div class="panel-title">Where the data comes from — and where it stops</div>
    <div class="map-legend">
      <b>Real sources:</b> each organization's own website (home, contact, about pages) fetched live over HTTP; the source URL is stored per field and exported in the CSV.
      <b>Model knowledge:</b> used only to propose <i>which</i> organizations exist and their likely domain — never to fill a phone number or email.
      <b>Human:</b> the highest-trust source; anything you type in Edit overrides a scraped value and is recorded as such.
      <b>Gaps stay gaps:</b> if a site is unreachable or publishes no contact details, the record says so instead of guessing — that is what makes the export safe to act on.
      Outbound fetching is sandboxed: public http(s) hosts only, 8s timeout, 5 pages per organization.
    </div>
  </div>`;

  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#iq-go')?.addEventListener('click', async () => {
    const criteria = {
      kind: $('#iq-kind').value, sector: $('#iq-sector').value, country: $('#iq-country').value,
      city: $('#iq-city').value, size: $('#iq-size').value, keywords: $('#iq-keywords').value, exclude: $('#iq-exclude').value,
    };
    const rules = [...view.querySelectorAll('.iq-rule:checked')].map((c) => c.value);
    const constraints = {
      requirePhone: $('#iq-req-phone').checked, requireEmail: $('#iq-req-email').checked,
      requireWebsite: $('#iq-req-site').checked,
      minCompleteness: Number($('#iq-min').value) / 100 || null,
      mustMention: $('#iq-mention').value || null, excludeKeywords: $('#iq-notmention').value || null,
    };
    try {
      await api('/api/intel', { method: 'POST', body: { question: $('#iq-q').value || null, criteria, targetCount: Number($('#iq-count').value) || 15, rules, constraints } });
      toast(`Campaign started with ${rules.length} escalation rule(s)`); renderIntel();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-irules]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/records/${b.dataset.irules}/rerun-rules`, { method: 'POST', body: {} }); toast('Re-running escalation rules…'); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-cverify]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/contacts/${b.dataset.cverify}/verify`, { method: 'POST', body: {} }); toast('Contact confirmed — details promoted to the record'); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-iverify]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/records/${b.dataset.iverify}/verify`, { method: 'POST', body: {} }); renderIntel(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-itarget]').forEach((b) => b.addEventListener('click', async () => {
    try { const r = await api(`/api/intel/records/${b.dataset.itarget}/target`, { method: 'POST', body: {} }); toast(`Targeted → CRM lead #${r.customer.id}`); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-ifix]').forEach((b) => b.addEventListener('click', async () => {
    const website = prompt('Official website (leave blank to keep):') || null;
    const email = prompt('Email (leave blank to keep):') || null;
    const phone = prompt('Phone (leave blank to keep):') || null;
    const address = prompt('Address (leave blank to keep):') || null;
    if (!website && !email && !phone && !address) return;
    try {
      await api(`/api/intel/records/${b.dataset.ifix}/edit`, { method: 'POST', body: { website, email, phone, address } });
      if (website) await api(`/api/intel/records/${b.dataset.ifix}/enrich`, { method: 'POST', body: { website } });
      toast('Recorded as human-sourced'); renderIntel();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-irefetch]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/records/${b.dataset.irefetch}/enrich`, { method: 'POST', body: {} }); toast('Re-harvesting the site…'); renderIntel(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Target every verified record in this campaign as a CRM lead?')) return;
    try { const r = await api('/api/intel/bulk-target', { method: 'POST', body: { queryId: Number(b.dataset.bulk), verifiedOnly: true } }); toast(`${r.targeted} targeted · ${r.skipped} skipped`); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-isegsel]').forEach((sel) => sel.addEventListener('change', async () => {
    if (!sel.value) return;
    try { await api(`/api/segments/${sel.value}/members`, { method: 'POST', body: { recordId: Number(sel.dataset.isegsel) } }); toast('Added to segment'); }
    catch (e) { toast(e.message, true); }
    sel.value = '';
  }));
  view.querySelectorAll('[data-autoseg]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api(`/api/intel/${b.dataset.autoseg}/auto-segment`, { method: 'POST', body: {} }); toast('AI segmentation running — see Segments shortly'); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}
export async function renderSegments() {
  const [segments, queries] = await Promise.all([api('/api/segments'), api('/api/intel').catch(() => [])]);
  const canM = hasPermC('segments.manage');
  view.innerHTML = `
  ${canM ? `<div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Build a segment from live filters — intelligence → audience in one step</div>
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl" for="sg-bname">Segment name</label><input type="text" id="sg-bname" placeholder="Iraqi energy — contactable"></div>
        <div><label class="fl" for="sg-country">Country</label><input type="text" id="sg-country" placeholder="Iraq"></div>
        <div><label class="fl" for="sg-sector">Sector</label><input type="text" id="sg-sector" placeholder="energy"></div>
        <div style="flex:0.7"><label class="fl" for="sg-query">Campaign</label><select id="sg-query" aria-label="Query"><option value="">any</option>${queries.map((iq) => `<option value="${iq.id}">#${iq.id} ${esc(short(iq.question, 24))}</option>`).join('')}</select></div>
      </div>
      <div class="form-inline">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="sg-contactable" checked> contactable only (has email or phone)</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="sg-verified"> human-verified only</label>
        <div style="flex:0.5"><label class="fl" for="sg-minc">Min complete %</label><input type="text" id="sg-minc" value="0"></div>
        <button class="btn btn-primary" id="sg-build">Build segment</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">Or start empty and add members by hand</div>
      <div class="form-inline">
        <div><label class="fl" for="sg-name">Name</label><input type="text" id="sg-name"></div>
        <div style="flex:2"><label class="fl" for="sg-desc">Description</label><input type="text" id="sg-desc"></div>
        <button class="btn btn-primary" id="sg-go">Create</button>
      </div>
      <div class="map-legend">Members come from <a href="#/intel">Intelligence</a>. A segment can go straight to <a href="#/marketing">Marketing</a> as a campaign audience, export to Excel, or bulk-target into the <a href="#/customers">CRM</a>. Autopilot also builds segments on its own — see <a href="#/autopilot">the mesh</a>.</div>
    </div>
  </div>` : ''}
  ${segments.map((s) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(s.name)}
        <span class="chip ${{ ai: 'chip-steel', nexus: 'chip-ember', filter: 'chip-ok' }[s.source] || 'chip-dim'}">${esc(s.source)}</span>
        <span class="chip">${s.stats.size} members</span>
        <span class="chip ${s.stats.contactable ? 'chip-ok' : 'chip-warn'}">${s.stats.contactable} contactable</span>
      </span>
      <span>
        ${s.stats.size ? `
          <button class="btn btn-sm" data-download="/api/intel/export?segmentId=${s.id}&format=xls" data-filename="segment-${s.id}.xls">⬇ Excel</button>
          <button class="btn btn-sm" data-download="/api/intel/export?segmentId=${s.id}&format=csv" data-filename="segment-${s.id}.csv">⬇ CSV</button>` : ''}
        ${canM && s.stats.size && !s.campaign ? `<button class="btn btn-sm btn-ok" data-sgcamp="${s.id}">→ Campaign</button>` : ''}
        ${canM && s.stats.size ? `<button class="btn btn-sm" data-sgbulk="${s.id}">→ CRM (verified)</button>` : ''}
        ${connBtn('segment', s.id)}
      </span>
    </div>
    ${s.description ? `<div class="map-legend">${esc(s.description)}</div>` : ''}
    <div class="agent-meta">
      <span class="chip chip-dim">✉ ${s.stats.withEmail}</span>
      <span class="chip chip-dim">☎ ${s.stats.withPhone}</span>
      <span class="chip chip-dim">avg ${s.stats.avgCompleteness}%</span>
      ${s.stats.verified ? `<span class="chip chip-ok">${s.stats.verified} verified</span>` : ''}
      ${s.stats.targeted ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">${s.stats.targeted} in CRM</a>` : ''}
      ${s.campaign ? `<a class="chip chip-ember" style="text-decoration:none" href="#/marketing">campaign #${s.campaign.id} · ${esc(s.campaign.state)}</a>` : ''}
      ${s.stats.countries.map((c) => `<span class="chip chip-dim">${esc(c)}</span>`).join('')}
      ${s.stats.sectors.map((c) => `<span class="chip chip-steel">${esc(c)}</span>`).join('')}
    </div>
    ${s.criteria ? `<div class="map-legend">filters: ${Object.entries(s.criteria).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>` : ''}
    <table>
      <tbody>${s.members.slice(0, 12).map((m) => `
        <tr>
          <td><b>${esc(short(m.name, 34))}</b>${m.name_ar ? `<div style="color:var(--ink-mute);font-size:11px">${esc(m.name_ar)}</div>` : ''}</td>
          <td class="mono" style="font-size:11px">${esc([m.city, m.country].filter(Boolean).join(', ') || '—')}</td>
          <td class="mono" style="font-size:11px">${[m.email, m.phone].filter(Boolean).map(esc).join(' · ') || '<span style="color:var(--warn)">no contact</span>'}</td>
          <td class="num" style="color:${m.completeness >= 0.7 ? 'var(--ok)' : 'var(--warn)'}">${Math.round(m.completeness * 100)}%</td>
          <td>${m.customer_id ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">lead #${m.customer_id}</a>` : `<span class="chip ${m.verification === 'verified' ? 'chip-steel' : 'chip-dim'}">${esc(m.verification)}</span>`}
              ${canM ? `<button class="btn btn-sm" data-sgrm="${s.id}" data-rec="${m.id}" title="remove from segment">✕</button>` : ''}</td>
        </tr>`).join('') || '<tr><td class="empty">Empty — add members from Intelligence.</td></tr>'}
        ${s.members.length > 12 ? `<tr><td colspan="5" class="map-legend">…and ${s.members.length - 12} more — export to see them all</td></tr>` : ''}
      </tbody>
    </table>
  </div>`).join('') || '<div class="panel"><div class="empty">No segments yet — build one above, or let Autopilot group contactable records for you.</div></div>'}`;

  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#sg-go')?.addEventListener('click', async () => {
    try { await api('/api/segments', { method: 'POST', body: { name: $('#sg-name').value, description: $('#sg-desc').value || null } }); renderSegments(); }
    catch (e) { toast(e.message, true); }
  });
  $('#sg-build')?.addEventListener('click', async () => {
    try {
      const s = await api('/api/segments/build', { method: 'POST', body: {
        name: $('#sg-bname').value, country: $('#sg-country').value || null, sector: $('#sg-sector').value || null,
        queryId: $('#sg-query').value ? Number($('#sg-query').value) : null,
        contactableOnly: $('#sg-contactable').checked, verifiedOnly: $('#sg-verified').checked,
        minCompleteness: Number($('#sg-minc').value) / 100 || null,
      } });
      toast(`Segment built — ${s.stats.size} members, ${s.stats.contactable} contactable`); renderSegments();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-sgcamp]').forEach((b) => b.addEventListener('click', async () => {
    try { const c = await api(`/api/segments/${b.dataset.sgcamp}/campaign`, { method: 'POST', body: { channel: 'email' } }); toast(`Campaign #${c.id} created — copy drafting`); location.hash = '#/marketing'; }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-sgbulk]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Target every verified member of this segment into the CRM?')) return;
    try { const r = await api('/api/intel/bulk-target', { method: 'POST', body: { segmentId: Number(b.dataset.sgbulk), verifiedOnly: true } }); toast(`${r.targeted} targeted · ${r.skipped} skipped`); renderSegments(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-sgrm]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/segments/${b.dataset.sgrm}/members/remove`, { method: 'POST', body: { recordId: Number(b.dataset.rec) } }); renderSegments(); }
    catch (e) { toast(e.message, true); }
  }));
}
export async function renderDatasets() {
  const [datasets, sources] = await Promise.all([api('/api/datasets'), api('/api/datasets/sources').catch(() => [])]);
  const canM = hasPermC('datasets.manage');
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">Pull data from inside the company — no copy-paste needed</div>
    <div class="agent-meta">
      ${sources.map((s) => `<button class="btn btn-sm" data-dssrc="${esc(s.id)}" ${s.rows ? '' : 'disabled'} title="${esc(s.label)}">${DS_SOURCE_ICON[s.id] || '▪'} ${esc(s.label)} <span class="chip chip-dim">${s.rows}</span></button>`).join('')}
    </div>
    <div class="map-legend">Each button snapshots that department's live data into a dataset you can clean, summarize, or mine for entities. Summaries flow onward into <a href="#/knowledge">Knowledge</a>; extracted entities open a new <a href="#/intel">Intelligence</a> campaign complete with web enrichment.</div>
  </div>
  <div class="panel">
    <div class="panel-title">Or store your own — paste anything (CSV, JSON, text, mixed Arabic/English)</div>
    <div class="form-inline">
      <div><label class="fl" for="ds-name">Name</label><input type="text" id="ds-name"></div>
    </div>
    <div><label class="fl" for="ds-raw">Raw data (treated as untrusted input — never executed, never obeyed)</label><textarea id="ds-raw" style="min-height:100px"></textarea></div>
      <button class="btn btn-primary form-go" id="ds-go">Store</button>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Datasets — clean · summarize → Knowledge · extract entities → Intelligence</div>
    <table>
      <thead><tr><th>Name</th><th>Source</th><th class="num">Size</th><th>Op</th><th>State</th><th>Flows to</th>${canM ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>${datasets.map((d) => `
        <tr class="rowlink" data-dsrow="${d.id}">
          <td><b>${esc(short(d.name, 46))}</b>${d.parent_id ? ` <span class="chip chip-dim">from #${d.parent_id}</span>` : ''}</td>
          <td><span class="chip ${d.source_kind && d.source_kind !== 'manual' ? 'chip-steel' : 'chip-dim'}">${DS_SOURCE_ICON[d.source_kind] || ''} ${esc(d.source_kind || 'manual')}</span></td>
          <td class="num">${(d.raw_chars / 1024).toFixed(1)} KB</td>
          <td class="mono">${esc(d.op || '—')}</td>
          <td><span class="state state-${d.state === 'done' ? 'done' : d.state === 'failed' ? 'failed' : d.state === 'processing' ? 'running' : 'queued'}">${esc(d.state)}</span></td>
          <td class="mono" style="font-size:11px">${d.state === 'done' && d.op === 'summarize' ? '<a href="#/knowledge">knowledge →</a>' : d.state === 'done' && d.op === 'extract-entities' ? '<a href="#/intel">intel campaign →</a>' : '<a href="#/archive">archive</a>'} ${connBtn('dataset', d.id)}</td>
          ${canM ? `<td>${['stored', 'done', 'failed'].includes(d.state) ? ['clean', 'summarize', 'extract-entities'].map((op) => `<button class="btn btn-sm" data-dsop="${d.id}" data-op="${op}">${op}</button>`).join(' ') : '…'}</td>` : ''}
        </tr>
        <tr class="run-detail" data-dsdetail="${d.id}" hidden><td colspan="7"><pre class="json" id="ds-view-${d.id}">click row again to load…</pre></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No datasets — pull one from a department above.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  view.querySelectorAll('[data-dsrow]').forEach((row) => row.addEventListener('click', async () => {
    const id = row.dataset.dsrow;
    const detail = view.querySelector(`[data-dsdetail="${id}"]`);
    detail.hidden = !detail.hidden;
    if (!detail.hidden) {
      try { const d = await api(`/api/datasets/${id}`); $(`#ds-view-${id}`).textContent = d.result ? JSON.stringify(d.result, null, 2) : d.raw.slice(0, 3000); } catch { /* leave */ }
    }
  }));
  wireConnections();
  if (!canM) return;
  $('#ds-go')?.addEventListener('click', async () => {
    try { await api('/api/datasets', { method: 'POST', body: { name: $('#ds-name').value, raw: $('#ds-raw').value } }); renderDatasets(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-dssrc]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { const d = await api('/api/datasets/from-source', { method: 'POST', body: { source: b.dataset.dssrc } }); toast(`Pulled "${short(d.name, 40)}" — now transform it`); renderDatasets(); }
    catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-dsop]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await api(`/api/datasets/${b.dataset.dsop}/transform`, { method: 'POST', body: { op: b.dataset.op } }); toast(`${b.dataset.op} running`); renderDatasets(); }
    catch (err) { toast(err.message, true); }
  }));
}
export async function renderArchive() {
  const kind = view.dataset.arcKind || '';
  const search = view.dataset.arcSearch || '';
  const { stats, items } = await api(`/api/archive?kind=${encodeURIComponent(kind)}&search=${encodeURIComponent(search)}`);
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Archived items</div><div class="big">${stats.total}</div><div class="sub">${stats.last7d} this week</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">With files</div><div class="big">${stats.withFiles}</div><div class="sub">CSV · SVG · reports on disk</div></div>
    <div class="panel tile"><div class="panel-title">Kinds</div><div class="big">${stats.byKind.length}</div><div class="sub">${stats.byKind.slice(0, 3).map((k) => `${k.kind} ${k.n}`).join(' · ')}</div></div>
    <div class="panel tile"><div class="panel-title">Linked departments</div><div class="big">${stats.bySubject.length}</div><div class="sub">every snapshot points home</div></div>
  </div>
  <div class="panel">
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="arc-q">Search titles</label><input type="text" id="arc-q" value="${esc(search)}" placeholder="intel, contract, journey…"></div>
      <div><label class="fl" for="arc-kind">Kind</label><select id="arc-kind" aria-label="Kind"><option value="">all</option>${stats.byKind.map((k) => `<option value="${esc(k.kind)}" ${k.kind === kind ? 'selected' : ''}>${esc(k.kind)} (${k.n})</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="arc-go">Filter</button>
    </div>
    <div class="agent-meta">${stats.bySubject.map((s) => `<span class="chip chip-dim">${esc(s.subject_type)} · ${s.n}</span>`).join('')}</div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Repository — frozen snapshots from every section (${items.length} shown)</div>
      <table>
        <thead><tr><th>Kind</th><th>Title</th><th>Source</th><th>By</th><th>When</th></tr></thead>
        <tbody>${items.map((a) => `
          <tr class="rowlink" data-arc="${a.id}">
            <td><span class="chip ${{ 'intel-export': 'chip-steel', contract: 'chip-ember', campaign: 'chip-warn', finance: 'chip-ok', dataset: 'chip-dim' }[a.kind] || 'chip-dim'}">${esc(a.kind)}</span></td>
            <td>${esc(short(a.title, 56))}${a.file_ref ? ' <span class="chip chip-dim">file</span>' : ''}</td>
            <td>${(() => { const h = linkFor(a.subject_type, a.subject_id); return h ? `<a class="mono" style="color:var(--steel)" href="${h}">${esc(a.subject_type)} ${esc(short(a.subject_id || '', 12))}</a>` : '<span class="mono" style="color:var(--ink-faint)">—</span>'; })()}</td>
            <td class="mono" style="color:var(--ink-faint)">${esc(short(a.created_by, 16))}</td>
            <td class="mono" style="color:var(--ink-faint)">${esc(a.created_at.slice(0, 16))}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing matches — snapshots arrive automatically as work completes.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-title" id="arc-title">Snapshot viewer</div>
      <pre class="json" id="arc-view" style="max-height:520px">Select an item.</pre>
      <div id="arc-file" class="map-legend"></div>
      <div id="arc-links"></div>
    </div>
  </div>`;
  $('#arc-go').addEventListener('click', () => {
    view.dataset.arcKind = $('#arc-kind').value;
    view.dataset.arcSearch = $('#arc-q').value;
    renderArchive();
  });
  view.querySelectorAll('[data-arc]').forEach((row) => row.addEventListener('click', async () => {
    try {
      const a = await api(`/api/archive/${row.dataset.arc}`);
      $('#arc-title').textContent = a.title;
      $('#arc-view').textContent = a.snapshot ? JSON.stringify(a.snapshot, null, 2) : '(no snapshot payload)';
      const home = linkFor(a.subject_type, a.subject_id);
      $('#arc-file').innerHTML = [
        a.file_ref ? `file: <a href="#/artifacts/${encodeURIComponent(a.file_ref)}" style="color:var(--steel)">${esc(a.file_ref)}</a>` : '',
        home ? `source: <a href="${home}">${esc(a.subject_type)} #${esc(a.subject_id)} →</a>` : '',
      ].filter(Boolean).join(' · ');
      if (a.subject_type && a.subject_id) await renderConnections('#arc-links', a.subject_type, a.subject_id);
      else $('#arc-links').innerHTML = '';
    } catch (e) { toast(e.message, true); }
  }));
}
export async function renderKnowledge() {
  const entries = await api('/api/knowledge');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Organizational memory — unverified claims never become truth (Part 3 §8); verification is human-only</div>
    <div class="form-inline">
      <div><label class="fl" for="kn-layer">Layer</label><select id="kn-layer" aria-label="Layer"><option>org</option><option>lesson</option><option>product</option><option>policy</option><option>project</option></select></div>
      <div style="flex:2"><label class="fl" for="kn-content">Content</label><input type="text" id="kn-content"></div>
      <div><label class="fl" for="kn-src">Source ref</label><input type="text" id="kn-src"></div>
      <button class="btn btn-primary" id="kn-go">Add</button>
    </div>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>Layer</th><th>Content</th><th>Source</th><th>Verification</th><th>By</th><th></th></tr></thead>
      <tbody>${entries.map((m) => `
        <tr style="${m.verification === 'retracted' ? 'opacity:.45;text-decoration:line-through' : ''}">
          <td class="mono">${esc(m.layer)}</td>
          <td>${esc(short(m.content, 90))}</td>
          <td class="mono" style="color:var(--ink-faint)">${(() => { const im = m.source_ref.match(/^incident:(\d+)$/); return im ? `<a href="#/incidents" style="color:var(--steel)">${esc(m.source_ref)}</a>` : esc(short(m.source_ref, 30)); })()}</td>
          <td><span class="chip ${m.verification === 'verified' ? 'chip-ok' : m.verification === 'retracted' ? 'chip-bad' : 'chip-warn'}">${esc(m.verification)}</span></td>
          <td class="mono" style="color:var(--ink-faint)">${esc(short(m.created_by, 20))}</td>
          <td>${m.verification === 'unverified' ? `
            <button class="btn btn-sm btn-ok" data-knv="${m.id}" data-to="verified">Verify (human)</button>
            <button class="btn btn-sm btn-bad" data-knv="${m.id}" data-to="retracted">Retract</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">Empty. Lessons from incidents land here.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#kn-go').addEventListener('click', async () => {
    try { await api('/api/knowledge', { method: 'POST', body: { layer: $('#kn-layer').value, content: $('#kn-content').value, sourceRef: $('#kn-src').value, actor: actor() } }); renderKnowledge(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-knv]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/knowledge/${b.dataset.knv}/verification`, { method: 'POST', body: { verification: b.dataset.to, actor: actor() } }); renderKnowledge(); } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Knowledge graph ----------
export async function renderKnowledgeGraph() {
  const d = await api('/api/kgraph');
  const canM = hasPermC('graph.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Things known', d.counts.nodes, 'customers, employees, deals, work, memories')}
    ${tile('Connections', d.counts.edges, 'drawn from real rows, not guessed')}
    ${tile('Unconnected', d.orphans, 'known, but not yet joined to anything')}
    <div class="panel tile"><div class="panel-title">Rebuild</div>
      ${canM ? xbtn('/api/kgraph/rebuild', {}, 'Rebuild from the database', 'btn-primary') : '<div class="sub">graph.manage required</div>'}
      <div class="sub" style="margin-top:6px">Last built ${esc(String(d.lastBuilt || 'never').slice(0, 16))}</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">Ask about anything — meaning, not spelling</div>
    <div class="form-inline">
      <input id="g-q" placeholder="اسأل بالعربية أو in English — e.g. oil company in Basra" style="width:52%">
      <button class="btn btn-sm btn-primary" id="g-go">Search</button>
    </div>
    <div id="g-out"></div>
    <div class="map-legend">The embeddings are local: hashed character trigrams with the same Arabic folding the memory index uses. No key, no network, no vendor — it keeps working with the line cut, which is the point.</div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Most connected</div>
      <table><thead><tr><th>Thing</th><th>Kind</th><th>Connections</th></tr></thead><tbody>
      ${d.hubs.map((h) => `<tr><td><a href="#" data-node="${esc(h.id)}">${esc(h.label)}</a></td>
        <td><span class="chip chip-dim">${esc(h.kind)}</span></td><td class="num mono">${h.degree}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Shape of what we know</div>
      <table><thead><tr><th>Kind</th><th>Count</th></tr></thead><tbody>
      ${d.byKind.map((k) => `<tr><td class="mono">${esc(k.kind)}</td><td class="num mono">${k.n}</td></tr>`).join('')}
      </tbody></table>
      <div class="panel-title" style="margin-top:12px">Kinds of connection</div>
      <div class="sub">${d.byRel.map((r) => `<span class="chip chip-dim">${esc(r.rel)} ${r.n}</span>`).join(' ')}</div>
    </div>
  </div>`;

  const openNode = async (id) => {
    const nb = await api(`/api/kgraph/node/${encodeURIComponent(id)}`);
    if (!nb) return;
    $('#g-out').innerHTML = `
      <div class="sub" style="margin:10px 0"><b>${esc(nb.centre.label)}</b> <span class="chip chip-dim">${esc(nb.centre.kind)}</span>
        — ${nb.nodes.length} things within two hops</div>
      <table><thead><tr><th>Hop</th><th>Thing</th><th>Kind</th><th>How it connects</th></tr></thead><tbody>
      ${nb.nodes.filter((n) => n.id !== nb.centre.id).map((n) => {
        const via = nb.edges.filter((e) => e.src === n.id || e.dst === n.id).map((e) => e.rel);
        return `<tr><td class="mono">${n.hop}</td><td><a href="#" data-node="${esc(n.id)}">${esc(n.label)}</a></td>
          <td><span class="chip chip-dim">${esc(n.kind)}</span></td>
          <td class="sub mono">${esc([...new Set(via)].join(', '))}</td></tr>`;
      }).join('')}
      </tbody></table>`;
    $('#g-out').querySelectorAll('[data-node]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openNode(a.dataset.node); }));
  };
  view.querySelectorAll('[data-node]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openNode(a.dataset.node); }));
  $('#g-go')?.addEventListener('click', async () => {
    const r = await api(`/api/kgraph/search?q=${encodeURIComponent($('#g-q').value)}`);
    $('#g-out').innerHTML = `<table><thead><tr><th>Match</th><th>Kind</th><th>Closeness</th><th>What we know</th></tr></thead><tbody>
      ${r.results.map((x) => `<tr><td><a href="#" data-node="${esc(x.id)}">${esc(x.label)}</a></td>
        <td><span class="chip chip-dim">${esc(x.kind)}</span></td><td class="num mono">${x.score}</td>
        <td class="sub">${esc(short(Object.entries(x.props).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · '), 70))}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Nothing close enough.</td></tr>'}
      </tbody></table>`;
    $('#g-out').querySelectorAll('[data-node]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openNode(a.dataset.node); }));
  });
  wireXact(renderKnowledgeGraph);
}
export async function renderInsights() {
  const d = await api('/api/insights');
  const maxAct = Math.max(...d.activityByDay.map((x) => x.n), 1);
  const maxSpend = Math.max(...d.spendByDay.map((x) => x.usd), 0.0001);
  const bars = (rows, valKey, maxV, fmt) => `<div style="display:flex;align-items:flex-end;gap:4px;height:90px;padding-top:8px">
    ${rows.map((r) => `<div title="${esc(r.day)}: ${fmt(r[valKey])}" style="flex:1;background:var(--ember);opacity:.75;border-radius:2px 2px 0 0;height:${Math.max(3, (r[valKey] / maxV) * 82)}px"></div>`).join('')}</div>`;
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel"><div class="panel-title">Company activity — audit events per day (14d)</div>${bars(d.activityByDay, 'n', maxAct, (v) => `${v} events`)}</div>
    <div class="panel"><div class="panel-title">Model spend per day (14d)</div>${bars(d.spendByDay, 'usd', maxSpend, (v) => `$${v}`)}</div>
  </div>
  <div class="grid grid-3">
    <div class="panel"><div class="panel-title">Runs by state</div>
      <table><tbody>${d.runsByState.map((r) => `<tr><td class="mono">${esc(r.state)}</td><td class="num mono">${r.n}</td></tr>`).join('')}</tbody></table></div>
    <div class="panel"><div class="panel-title">Busiest employees</div>
      <table><tbody>${d.busiestAgents.map((r) => `<tr><td class="mono">${esc(r.agent_id)}</td><td class="num mono">${r.runs}</td></tr>`).join('')}</tbody></table></div>
    <div class="panel"><div class="panel-title">Most-touched subjects</div>
      <table><tbody>${d.topSubjects.map((r) => `<tr><td class="mono">${esc(r.subject_type)}</td><td class="num mono">${r.n}</td></tr>`).join('')}</tbody></table></div>
  </div>`;
}
