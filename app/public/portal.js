// The portal page a customer or supplier opens from their link.
//
// The token arrives in the address's fragment — which a browser never sends to
// a server or puts in a referrer — is kept for this tab only, and is taken out
// of the address bar at once, so a screenshot or a shared screen does not
// carry it. Everything else is the same plain page as the console: no
// framework, no external request, both languages.
import { t, lang, setLang, applyLang } from '/i18n.js';

const KEY = 'alphacore-portal';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = document.getElementById('portal');

let token = null;
const fromHash = new URLSearchParams(location.hash.slice(1)).get('t');
if (fromHash) {
  try { sessionStorage.setItem(KEY, fromHash); } catch { /* the tab keeps it in memory instead */ }
  token = fromHash;
  history.replaceState(null, '', location.pathname);
} else {
  try { token = sessionStorage.getItem(KEY); } catch { token = null; }
}

async function call(path, { method = 'GET', body = null } = {}) {
  const r = await fetch(`/portal-api${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-portal-token': token || '' }, body: body ? JSON.stringify(body) : null,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j;
}

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleDateString([], { dateStyle: 'medium' }) : '—');

function readFile(input) {
  const f = input?.files?.[0];
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, mime: f.type, data: String(r.result).replace(/^data:[^,]*,/, '') });
    r.onerror = () => reject(new Error(t('The file could not be read')));
    r.readAsDataURL(f);
  });
}

function langButton() {
  return `<button type="button" class="btn btn-sm btn-ghost" id="pt-lang">${lang === 'ar' ? 'English' : 'العربية'}</button>`;
}

async function render() {
  applyLang();
  if (!token) {
    root.innerHTML = `<div class="panel"><h1>${esc(t('Portal'))}</h1><p>${esc(t('Open the link the company sent you. This page needs it to know who you are.'))}</p>${langButton()}</div>`;
    wireLang();
    return;
  }
  let me; let inv; let msgs;
  try {
    [me, inv, msgs] = await Promise.all([call('/me'), call('/invoices'), call('/messages')]);
  } catch (e) {
    root.innerHTML = `<div class="panel"><h1>${esc(t('Portal'))}</h1><p>${esc(e.status === 401 ? t('This link has expired or was withdrawn — ask the company for a new one.') : e.message)}</p>${langButton()}</div>`;
    wireLang();
    return;
  }
  document.title = `${me.company || t('Portal')} · ${t('Portal')}`;
  const supplier = me.kind === 'supplier';
  root.innerHTML = `
  <header class="portal-head"><div><div class="sub">${esc(me.company)}</div><h1 dir="auto">${esc(me.name)}</h1>
    <div class="sub">${esc(t(supplier ? 'Supplier' : 'Customer'))} · ${esc(t('this link works until'))} ${esc(when(me.expires))}</div></div>${langButton()}</header>
  <section class="panel"><h2 class="panel-title">${esc(t(supplier ? 'Your bills with us' : 'Your invoices'))}</h2>
    ${inv.items.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Reference'))}</th><th>${esc(t('Amount'))}</th><th>${esc(t('Issued'))}</th><th>${esc(t('Due'))}</th><th>${esc(t('Status'))}</th></tr></thead><tbody>
      ${inv.items.map((i) => `<tr><td class="ltr">${esc(i.ref)}${i.description ? `<div class="sub" dir="auto">${esc(i.description)}</div>` : ''}</td><td class="ltr">${money(i.total)} ${esc(i.currency)}</td><td>${esc(when(i.issued))}</td><td>${esc(when(i.due))}</td><td>${esc(t(i.state))}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="sub">${esc(t('Nothing here yet.'))}</p>`}
    ${me.payInstructions ? `<div class="callout" dir="auto">${esc(me.payInstructions)}</div>` : ''}</section>
  <section class="panel"><h2 class="panel-title">${esc(t('Write to us'))}</h2>
    <form id="pt-msg" class="fields"><div class="wide"><label class="fl" for="pt-subject">${esc(t('Subject'))}</label><input id="pt-subject" dir="auto"></div>
      <div class="wide"><label class="fl" for="pt-body">${esc(t('Message'))}</label><textarea id="pt-body" rows="4" dir="auto" required></textarea></div>
      <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Send'))}</button></div></form></section>
  <section class="panel"><h2 class="panel-title">${esc(t('Send us a document'))}</h2>
    <form id="pt-up" class="fields">
      <div><label class="fl" for="pt-purpose">${esc(t('What is it?'))}</label><select id="pt-purpose">
        ${supplier ? `<option value="invoice">${esc(t('An invoice'))}</option>` : ''}<option value="kyc">${esc(t('Identity or company documents'))}</option><option value="other">${esc(t('Something else'))}</option></select></div>
      <div><label class="fl" for="pt-file">${esc(t('File (PDF, PNG, JPG — up to 10 MB)'))}</label><input type="file" id="pt-file" accept="application/pdf,image/png,image/jpeg" required></div>
      <div class="wide"><label class="fl" for="pt-note">${esc(t('A note, if any'))}</label><input id="pt-note" dir="auto"></div>
      <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Upload'))}</button></div></form></section>
  <section class="panel"><h2 class="panel-title">${esc(t('Messages'))}</h2>
    ${msgs.items.length ? `<div class="wa-thread">${msgs.items.slice().reverse().map((m) => `<div class="wa-msg wa-${m.direction === 'in' ? 'out' : 'in'}">${m.subject ? `<b dir="auto">${esc(m.subject)}</b>` : ''}<div dir="auto">${esc(m.body)}</div>${m.file ? `<div class="sub">📎 ${esc(m.file)}</div>` : ''}<div class="sub">${esc(t(m.direction === 'in' ? 'You' : me.company || 'Company'))} · ${esc(when(m.created_at))}</div></div>`).join('')}</div>`
    : `<p class="sub">${esc(t('No messages yet.'))}</p>`}</section>
  <p class="sub portal-foot">${esc(t('Anything the company issues you with a verification code can be checked at'))} <span class="ltr">${esc(location.origin)}/verify/…</span></p>
  <div id="pt-status" role="status" class="sub"></div>`;
  wireLang();
  const status = (s, bad = false) => { const el = document.getElementById('pt-status'); el.textContent = s; el.style.color = bad ? 'var(--bad)' : ''; };
  document.getElementById('pt-msg').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await call('/message', { method: 'POST', body: { subject: document.getElementById('pt-subject').value, body: document.getElementById('pt-body').value } }); render(); }
    catch (err) { status(err.message, true); }
  });
  document.getElementById('pt-up').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const file = await readFile(document.getElementById('pt-file'));
      if (!file) return;
      status(t('Uploading…'));
      await call('/upload', { method: 'POST', body: { ...file, purpose: document.getElementById('pt-purpose').value, note: document.getElementById('pt-note').value } });
      render();
    } catch (err) { status(err.message, true); }
  });
}

function wireLang() {
  document.getElementById('pt-lang')?.addEventListener('click', () => { setLang(lang === 'ar' ? 'en' : 'ar'); render(); });
}

render();
