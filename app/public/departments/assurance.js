// Assurance across departments: the governance map, and the official copy of
// a document, ready to print and verifiable by its code.
import { esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t } from '/i18n.js';
import { hashParam, ago } from '../components/ui.js';
import { qrSvg } from '../components/qr.js';

// --------------------------------------------------------- the map --

// A proposal is said in the reader's language: the sentence is translated and
// the particulars — names, figures — are put back in as they were recorded.
const say = (tpl, params, fallback) => (tpl && params
  ? t(tpl).replace(/\{(\w+)\}/g, (_m, k) => (k === 'line' ? t(String(params[k] ?? '')) : String(params[k] ?? '')))
  : fallback);

const HEAT = { green: 'chip-ok', amber: 'chip-warn', red: 'chip-bad' };
const HEAT_WORD = { green: 'in order', amber: 'needs attention', red: 'act now' };

export async function renderAssuranceMap() {
  const d = await api('/api/assurancemap');
  const canM = hasPermC('assurancemap.manage');
  const open = d.proposals.filter((p) => p.state === 'proposed');
  const done = d.proposals.filter((p) => p.state !== 'proposed');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The departments that keep the company honest, on one sheet: each is green, amber or red from its own figures. Below, the connections between them that a person should make — a finding that should change a rule, a red number that is a nonconformity, a large risk with no insurance behind it. Nothing here acts until a person with that department’s permission accepts it.'))}</p></div>
  <div class="heat-grid">${d.map.map((m) => `<a class="heat-tile heat-${m.status}" href="${esc(m.route)}">
    <div class="heat-top"><b>${esc(t(m.label))}</b><span class="chip ${HEAT[m.status]}">${esc(t(HEAT_WORD[m.status]))}</span></div>
    <dl>${m.figures.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${m.note ? `<div class="sub">${esc(t(m.note))}</div>` : ''}</a>`).join('')}</div>
  <div class="panel"><div class="panel-title">${esc(t('Proposed connections'))} · ${open.length}</div>
    ${open.length ? open.map((p) => `<div class="ent-draft">
      <b dir="auto">${esc(say(p.template?.[0], p.params, p.title))}</b>
      <div class="sub" dir="auto">${esc(say(p.template?.[1], p.params, p.why))}</div>
      <div class="sub">${esc(t('needs'))} <span class="ltr">${esc(p.perm)}</span> · ${ago(p.created_at)}</div>
      ${canM && hasPermC(p.perm) ? `<div class="inline" style="margin-top:6px">
        <button type="button" class="btn btn-sm btn-human" data-gov="${p.id}" data-verdict="accept">${esc(t('Accept and do it'))}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-gov="${p.id}" data-verdict="dismiss">${esc(t('Does not apply'))}</button></div>` : ''}
    </div>`).join('') : `<div class="empty">${esc(t('Nothing to connect — every finding, red number and large risk already has its answer.'))}</div>`}
  </div>
  ${done.length ? `<div class="panel"><div class="panel-title">${esc(t('Decided'))}</div><table class="tbl"><tbody>${done.slice(0, 30).map((p) => `<tr>
    <td dir="auto">${esc(say(p.template?.[0], p.params, p.title))}${p.reason ? `<div class="sub">${esc(p.reason)}</div>` : ''}</td>
    <td><span class="chip ${p.state === 'accepted' ? 'chip-ok' : 'chip-dim'}">${esc(t(p.state))}</span></td>
    <td class="sub">${esc(String(p.decided_by || '').replace(/^human:/, ''))} · ${ago(p.decided_at)}</td>
    <td>${p.route ? `<a href="${esc(p.route)}">${esc(t('Open'))}</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  view.querySelectorAll('[data-gov]').forEach((b) => b.addEventListener('click', async () => {
    const body = { verdict: b.dataset.verdict };
    if (body.verdict === 'dismiss') { body.reason = window.prompt(t('Why does it not apply?')); if (!body.reason) return; }
    try { await api(`/api/assurancemap/${b.dataset.gov}`, { method: 'POST', body }); toast(t(body.verdict === 'accept' ? 'Done — it is on its department’s page' : 'Dismissed')); renderAssuranceMap(); }
    catch (e) { toast(e.message, true); }
  }));
}

// ------------------------------------------------------ official copies --

/**
 * Markdown, the little of it policies use: headings, lists, bold, paragraphs.
 * Escaped first and formatted after, so nothing in a document becomes markup.
 */
function md(src) {
  const out = [];
  let list = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  for (const raw of String(src || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/);
    if (li) { if (!list) { list = []; } list.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    const hd = line.match(/^(#{1,4})\s+(.*)$/);
    if (hd) out.push(`<h${hd[1].length + 2}>${inline(hd[2])}</h${hd[1].length + 2}>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}

const who = (a) => esc(String(a || '—').replace(/^human:/, ''));
const field = (label, value) => (value == null || value === '' ? '' : `<tr><th>${esc(t(label))}</th><td dir="auto">${esc(value)}</td></tr>`);

const BODY = {
  policy: (c) => `
    <table class="doc-meta">${field('Code', c.code)}${field('Kind', t(c.kind))}${field('Version', `v${c.version}`)}${field('Owner', c.owner)}${field('Scope', c.scope)}</table>
    <div class="doc-text">${md(c.body)}</div>
    ${c.steps?.length ? `<h3>${esc(t('Process steps'))}</h3><table class="doc-tbl"><thead><tr><th>#</th><th>${esc(t('Step'))}</th><th>${esc(t('Role'))}</th><th>${esc(t('Control'))}</th></tr></thead>
      <tbody>${c.steps.map((s, i) => `<tr><td>${i + 1}</td><td dir="auto">${esc(s.step)}</td><td dir="auto">${esc(s.role)}</td><td dir="auto">${esc(s.control || '')}</td></tr>`).join('')}</tbody></table>` : ''}
    <table class="doc-sign">${field('Approved by', who(c.approvedBy))}${field('Published', c.publishedAt)}${field('Next review', c.nextReview)}</table>`,
  audit: (c) => `
    <table class="doc-meta">${field('Area', c.area)}${field('Kind', t(c.kind))}${field('Objective', c.objective)}${field('Scope', c.scope)}${field('Lead', c.lead)}</table>
    <p class="doc-opinion">${esc(t('Opinion'))}: <b>${esc(t(String(c.opinion || '').replace(/_/g, ' ')))}</b></p>
    <h3>${esc(t('Findings'))} (${c.findings.length})</h3>
    ${c.findings.map((f, i) => `<div class="doc-finding"><h4>${i + 1}. ${esc(f.title)} <span class="doc-rating">${esc(t(f.rating))}</span></h4>
      <table class="doc-meta">${field('Criteria', f.criteria)}${field('Condition', f.condition)}${field('Cause', f.cause)}${field('Effect', f.effect)}${field('Recommendation', f.recommendation)}${field('Agreed action', f.action_plan)}${field('Owner', f.owner)}${field('Due', f.due)}${field('Status', t(String(f.state).replace(/_/g, ' ')))}</table></div>`).join('') || `<p>${esc(t('No findings.'))}</p>`}
    <table class="doc-sign">${field('Closed', c.closedAt)}</table>`,
  review: (c) => `
    <table class="doc-meta">${field('Standard', c.standard)}${field('Held on', c.heldOn)}${field('Attendees', c.attendees)}</table>
    <h3>${esc(t('Decisions'))}</h3><div class="doc-text">${md(c.decisions)}</div>
    <table class="doc-sign">${field('Recorded by', who(c.heldBy))}</table>`,
  payment: (c) => `
    <table class="doc-meta">${field('Format', c.format)}${field('UETR', c.uetr)}${field('Amount', `${Number(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${c.currency}`)}${field('Charges', c.charges)}
      ${field('Beneficiary', c.beneficiary)}${field('BIC / SWIFT code', c.bic)}${field('Country', c.country)}${field('Value date', c.valueDate)}${field('Payment details (to the beneficiary)', c.remittanceInfo)}</table>
    <table class="doc-sign">${field('Prepared by', who(c.builtBy))}${field('Approved by', who(c.approvedBy))}${field('Released by', who(c.releasedBy))}${field('Released', c.releasedAt)}</table>`,
};

export async function renderDocument() {
  const code = hashParam('code');
  if (!code) { view.innerHTML = `<div class="panel"><div class="empty">${esc(t('No document chosen.'))}</div></div>`; return; }
  const d = await api(`/api/documents/${encodeURIComponent(code)}`);
  // Without a public address the code only works on this network — still
  // printable, but the reader is told rather than handed a QR that leads nowhere.
  const absolute = /^https?:\/\//.test(d.verifyUrl);
  const url = absolute ? d.verifyUrl : `${location.origin}${d.verifyUrl}`;
  view.innerHTML = `
  <div class="doc-tools inline">
    <button class="btn btn-primary" id="doc-print">${esc(t('Print'))}</button>
    ${!d.revokedAt ? `<button class="btn btn-sm btn-ghost" id="doc-revoke">${esc(t('Withdraw this copy'))}</button>` : ''}
    ${!absolute ? `<span class="sub">${esc(t('Set PUBLIC_BASE_URL in Settings so the code can be checked from outside this network.'))}</span>` : ''}
  </div>
  ${d.revokedAt ? `<div class="callout">${esc(t('This copy was withdrawn and must not be relied on.'))}</div>` : ''}
  ${d.inForce === false && !d.revokedAt ? `<div class="callout">${esc(t('Not in force'))}: ${esc(d.note || '')}</div>` : ''}
  <article class="doc-sheet" lang="${esc(document.documentElement.lang || 'en')}">
    <header class="doc-head">
      <div><div class="doc-company">${esc(d.company.name || 'AlphaCore')}</div><div class="doc-address">${esc(d.company.address || '')}</div></div>
      <div class="doc-kind">${esc(t(d.label))}</div>
    </header>
    <h1 class="doc-title" dir="auto">${esc(d.title)}</h1>
    ${BODY[d.type](d.content)}
    <footer class="doc-foot">
      <div class="doc-qr">${qrSvg(url, { size: 112, label: t('Verification code') })}</div>
      <div>
        <div><b>${esc(t('Verification code'))}:</b> <span class="ltr">${esc(d.code)}</span></div>
        <div class="ltr doc-url">${esc(url)}</div>
        <div>${esc(t('Issued'))}: ${esc(d.issuedAt)} UTC · ${who(d.issuedBy)}</div>
        <div>${esc(t('Fingerprint'))}: <span class="ltr">${esc(d.digest.slice(0, 16))}</span></div>
        <div class="doc-note">${esc(t('Scan the code or open the address to check this document against the company’s record.'))}</div>
      </div>
    </footer>
  </article>`;
  document.getElementById('doc-print').addEventListener('click', () => window.print());
  document.getElementById('doc-revoke')?.addEventListener('click', async () => {
    const reason = window.prompt(t('Why is this copy withdrawn?'));
    if (!reason) return;
    try { await api(`/api/documents/${encodeURIComponent(d.code)}/revoke`, { method: 'POST', body: { reason } }); renderDocument(); } catch (e) { toast(e.message, true); }
  });
}

/** A button that issues the official copy of a record and opens it. Wire with wireOfficialCopy. */
export const officialCopyButton = (type, id) => `<button type="button" class="btn btn-sm" data-issue-type="${esc(type)}" data-issue-id="${esc(id)}">${esc(t('Official copy'))}</button>`;

export function wireOfficialCopy(root) {
  root.querySelectorAll('[data-issue-type]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api('/api/documents/issue', { method: 'POST', body: { type: b.dataset.issueType, id: b.dataset.issueId } });
      location.hash = `#/document?code=${encodeURIComponent(r.code)}`;
    } catch (e) { toast(e.message, true); }
  }));
}
