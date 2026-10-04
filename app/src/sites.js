// The website builder — a business website from a short brief, in English or
// Arabic, that works the moment it is generated.
//
// A site is a factory project of kind `website`: a real directory, a real git
// history, previewable and deployable like anything else the factory makes.
// What this module adds is the brief and the generator: answers about the
// business go in, a complete responsive site comes out — no model required.
// A copywriter can then rewrite the words, and an engineer can take change
// requests in plain language, both through the same proposal flow as code.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { enqueueRun } from './workflow.js';
import { openPii } from './erasure.js';
import { createProject, projectRow, writeProjectFile, listProjects } from './forge.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exec(`CREATE TABLE IF NOT EXISTS site_copy_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES forge_projects(id),
  run_id      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'drafting',   -- drafting|applied|failed
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export const STYLES = {
  atelier: { label: 'Atelier', hint: 'Warm ivory and forest green, an editorial serif. Restaurants, boutiques, craft.', bg: '#f6f1e7', surface: '#fffaf1', ink: '#1f2a24', mute: '#5b665f', accent: '#2f5d46', accentInk: '#ffffff', display: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif", fonts: 'family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;600', radius: '4px' },
  clinic: { label: 'Clinic', hint: 'Clean white and calm teal. Health, legal, consulting, education.', bg: '#ffffff', surface: '#f2f8f8', ink: '#0f2b2e', mute: '#4d6a6d', accent: '#0f8b8d', accentInk: '#ffffff', display: "'Manrope', system-ui, sans-serif", body: "'Manrope', system-ui, sans-serif", fonts: 'family=Manrope:wght@400;600;800', radius: '14px' },
  studio: { label: 'Studio', hint: 'Charcoal with electric violet, a grotesk display. Tech, agencies, startups.', bg: '#111114', surface: '#1b1b21', ink: '#f1f0f5', mute: '#a3a1b1', accent: '#8b7bff', accentInk: '#0d0b1a', display: "'Space Grotesk', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", fonts: 'family=Space+Grotesk:wght@500;700&family=Inter:wght@400;600', radius: '10px' },
  trade: { label: 'Trade', hint: 'Deep navy and safety amber. Construction, logistics, manufacturing, auto.', bg: '#f4f5f7', surface: '#ffffff', ink: '#14213d', mute: '#55607a', accent: '#f2a541', accentInk: '#14213d', display: "'Archivo', system-ui, sans-serif", body: "'Archivo', system-ui, sans-serif", fonts: 'family=Archivo:wght@400;600;800', radius: '2px' },
  bloom: { label: 'Bloom', hint: 'Blush and plum, a soft high-contrast serif. Beauty, events, fashion.', bg: '#fbf3f1', surface: '#ffffff', ink: '#3b1f2b', mute: '#7a5a66', accent: '#8e3b5b', accentInk: '#ffffff', display: "'DM Serif Display', Georgia, serif", body: "'DM Sans', system-ui, sans-serif", fonts: 'family=DM+Serif+Display&family=DM+Sans:wght@400;600', radius: '999px' },
};

const SECTION_IDS = ['services', 'about', 'process', 'testimonials', 'faq', 'contact'];

const COPY = {
  en: {
    nav: { services: 'Services', about: 'About', process: 'How it works', testimonials: 'Clients', faq: 'Questions', contact: 'Contact' },
    cta: 'Get in touch', servicesTitle: 'What we do', aboutTitle: 'About us', processTitle: 'How it works',
    testimonialsTitle: 'What clients say', faqTitle: 'Questions, answered', contactTitle: 'Talk to us',
    process: [['Tell us what you need', 'A short conversation about the job, the timing and the budget.'], ['Get a clear proposal', 'What we will do, what it costs, and when it will be done — in writing.'], ['We deliver', 'We do the work, keep you posted, and stand behind it.']],
    faq: [['How quickly can you start?', 'Usually within the week. Tell us your timing and we will say honestly whether we can meet it.'], ['Do you give written quotes?', 'Always, before any work begins.'], ['Where do you work?', 'Get in touch with your location and we will confirm.']],
    testimonials: [['They did exactly what they said they would, on time.', 'A recent client'], ['Clear, professional and easy to work with.', 'A returning customer']],
    form: { name: 'Your name', email: 'Email', message: 'How can we help?', send: 'Send message' },
    hours: 'Hours', phone: 'Phone', email: 'Email', address: 'Address', whatsapp: 'WhatsApp', rights: 'All rights reserved.',
    notFound: 'This page could not be found.', home: 'Back to the home page',
  },
  ar: {
    nav: { services: 'خدماتنا', about: 'من نحن', process: 'كيف نعمل', testimonials: 'آراء العملاء', faq: 'أسئلة شائعة', contact: 'تواصل معنا' },
    cta: 'تواصل معنا', servicesTitle: 'ماذا نقدّم', aboutTitle: 'من نحن', processTitle: 'كيف نعمل',
    testimonialsTitle: 'ماذا يقول عملاؤنا', faqTitle: 'إجابات أسئلتكم', contactTitle: 'تحدّث إلينا',
    process: [['أخبرنا بما تحتاج', 'محادثة قصيرة حول العمل والموعد والميزانية.'], ['عرض واضح ومكتوب', 'ما سنقوم به، وكم يكلّف، ومتى ننتهي — كتابةً.'], ['ننجز العمل', 'ننفّذ، ونُبقيك على اطّلاع، ونتحمّل مسؤولية النتيجة.']],
    faq: [['متى يمكنكم البدء؟', 'غالبًا خلال أسبوع. أخبرنا بموعدك وسنقول لك بصدق إن كنا نستطيع الالتزام به.'], ['هل تقدّمون عرض سعر مكتوبًا؟', 'دائمًا، وقبل بدء أي عمل.'], ['أين تعملون؟', 'تواصل معنا مع ذكر موقعك وسنؤكّد لك.']],
    testimonials: [['نفّذوا ما وعدوا به بالضبط وفي الموعد.', 'عميل حديث'], ['تعامل واضح ومهني وسهل.', 'عميل دائم']],
    form: { name: 'الاسم', email: 'البريد الإلكتروني', message: 'كيف يمكننا مساعدتك؟', send: 'أرسل الرسالة' },
    hours: 'ساعات العمل', phone: 'الهاتف', email: 'البريد', address: 'العنوان', whatsapp: 'واتساب', rights: 'جميع الحقوق محفوظة.',
    notFound: 'لم نعثر على هذه الصفحة.', home: 'العودة إلى الصفحة الرئيسية',
  },
};

/** Fill the gaps in a brief with defaults, so a name alone is enough. */
export function normalizeBrief(raw = {}) {
  const lang = raw.language === 'ar' ? 'ar' : 'en';
  const L = COPY[lang];
  const name = String(raw.business || '').trim();
  if (!name) refuse('the website needs the business name');
  const what = String(raw.what || '').trim();
  const services = (Array.isArray(raw.services) ? raw.services : String(raw.services || '').split(/\n|,|،/))
    .map((s) => (typeof s === 'string' ? { title: s.trim(), text: '' } : { title: String(s.title || '').trim(), text: String(s.text || '').trim() }))
    .filter((s) => s.title).slice(0, 9);
  return {
    business: name.slice(0, 80),
    language: lang,
    style: STYLES[raw.style] ? raw.style : 'clinic',
    what: what.slice(0, 400),
    tagline: String(raw.tagline || '').trim().slice(0, 140) || (what ? what.split(/[.!؟?]/)[0].slice(0, 120) : name),
    about: String(raw.about || '').trim().slice(0, 1500) || (lang === 'ar'
      ? `${name} ${what ? `— ${what}` : ''}. نعمل بوضوح ونلتزم بالمواعيد، ونعامل كل عميل كما نحب أن نُعامَل.`
      : `${name}${what ? ` — ${what}` : ''}. We work in the open, keep our promises on time, and treat every client the way we would want to be treated.`),
    services: services.length ? services : [{ title: lang === 'ar' ? 'الخدمة الأولى' : 'Our main service', text: '' }],
    sections: (Array.isArray(raw.sections) && raw.sections.length ? raw.sections : SECTION_IDS).filter((s) => SECTION_IDS.includes(s)),
    contact: {
      email: String(raw.contact?.email || raw.email || '').trim().slice(0, 120),
      phone: String(raw.contact?.phone || raw.phone || '').trim().slice(0, 40),
      whatsapp: String(raw.contact?.whatsapp || raw.whatsapp || '').replace(/[^\d+]/g, '').slice(0, 20),
      address: String(raw.contact?.address || raw.address || '').trim().slice(0, 200),
      hours: String(raw.contact?.hours || raw.hours || '').trim().slice(0, 120),
    },
    domain: String(raw.domain || '').trim().toLowerCase().slice(0, 120),
    copy: raw.copy && typeof raw.copy === 'object' ? raw.copy : {},
    _L: L,
  };
}

/** The whole site, as files. Pure: same brief, same bytes. */
export function generateSite(input) {
  const b = input._L ? input : normalizeBrief(input);
  const L = COPY[b.language];
  const S = STYLES[b.style];
  const c = { ...b.copy };
  const rtl = b.language === 'ar';
  const fonts = rtl ? 'family=IBM+Plex+Sans+Arabic:wght@400;600;700' : S.fonts;
  const display = rtl ? "'IBM Plex Sans Arabic', system-ui, sans-serif" : S.display;
  const body = rtl ? "'IBM Plex Sans Arabic', system-ui, sans-serif" : S.body;
  const has = (s) => b.sections.includes(s);
  const services = (c.services && Array.isArray(c.services) && c.services.length ? c.services : b.services);
  const year = new Date().getFullYear();
  const initials = b.business.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const wa = b.contact.whatsapp ? `https://wa.me/${b.contact.whatsapp.replace(/^\+/, '')}` : '';

  const nav = b.sections.map((s) => `<a href="#${s}">${esc(L.nav[s])}</a>`).join('');
  const sectionsHtml = [
    has('services') ? `
  <section id="services" class="band">
    <div class="wrap">
      <h2>${esc(c.servicesTitle || L.servicesTitle)}</h2>
      <div class="cards">
        ${services.map((s, i) => `<article class="card"><span class="card-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.title)}</h3>${s.text ? `<p>${esc(s.text)}</p>` : ''}</article>`).join('\n        ')}
      </div>
    </div>
  </section>` : '',
    has('about') ? `
  <section id="about" class="band alt">
    <div class="wrap split">
      <h2>${esc(c.aboutTitle || L.aboutTitle)}</h2>
      <div class="prose">${String(c.about || b.about).split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    </div>
  </section>` : '',
    has('process') ? `
  <section id="process" class="band">
    <div class="wrap">
      <h2>${esc(c.processTitle || L.processTitle)}</h2>
      <ol class="steps">
        ${(c.process || L.process).map(([t, d]) => `<li><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join('\n        ')}
      </ol>
    </div>
  </section>` : '',
    has('testimonials') ? `
  <section id="testimonials" class="band alt">
    <div class="wrap">
      <h2>${esc(c.testimonialsTitle || L.testimonialsTitle)}</h2>
      <div class="quotes">
        ${(c.testimonials || L.testimonials).map(([q, who]) => `<figure><blockquote>${esc(q)}</blockquote><figcaption>${esc(who)}</figcaption></figure>`).join('\n        ')}
      </div>
    </div>
  </section>` : '',
    has('faq') ? `
  <section id="faq" class="band">
    <div class="wrap narrow">
      <h2>${esc(c.faqTitle || L.faqTitle)}</h2>
      ${(c.faq || L.faq).map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n      ')}
    </div>
  </section>` : '',
    has('contact') ? `
  <section id="contact" class="band contact">
    <div class="wrap split">
      <div>
        <h2>${esc(c.contactTitle || L.contactTitle)}</h2>
        <dl class="facts">
          ${b.contact.phone ? `<dt>${esc(L.phone)}</dt><dd><a href="tel:${esc(b.contact.phone.replace(/\s/g, ''))}" dir="ltr">${esc(b.contact.phone)}</a></dd>` : ''}
          ${b.contact.email ? `<dt>${esc(L.email)}</dt><dd><a href="mailto:${esc(b.contact.email)}">${esc(b.contact.email)}</a></dd>` : ''}
          ${wa ? `<dt>${esc(L.whatsapp)}</dt><dd><a href="${esc(wa)}" rel="noopener" dir="ltr">${esc(b.contact.whatsapp)}</a></dd>` : ''}
          ${b.contact.address ? `<dt>${esc(L.address)}</dt><dd>${esc(b.contact.address)}</dd>` : ''}
          ${b.contact.hours ? `<dt>${esc(L.hours)}</dt><dd>${esc(b.contact.hours)}</dd>` : ''}
        </dl>
      </div>
      <form class="form" id="contact-form" data-to="${esc(b.contact.email)}">
        <label>${esc(L.form.name)}<input name="name" required autocomplete="name"></label>
        <label>${esc(L.form.email)}<input name="email" type="email" required autocomplete="email"></label>
        <label>${esc(L.form.message)}<textarea name="message" rows="4" required></textarea></label>
        <button class="btn" type="submit">${esc(L.form.send)}</button>
      </form>
    </div>
  </section>` : '',
  ].join('');

  const head = (title) => `<!doctype html>
<html lang="${b.language}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(c.tagline || b.tagline)}">
<meta property="og:title" content="${esc(b.business)}">
<meta property="og:description" content="${esc(c.tagline || b.tagline)}">
<meta name="theme-color" content="${S.accent}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
<link rel="stylesheet" href="styles.css">
</head>`;

  const index = `${head(`${b.business} — ${c.tagline || b.tagline}`)}
<body>
<a class="skip" href="#main">${rtl ? 'انتقل إلى المحتوى' : 'Skip to content'}</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="#"><span class="mark" aria-hidden="true">${esc(initials)}</span>${esc(b.business)}</a>
    <button class="menu" aria-expanded="false" aria-controls="nav" aria-label="${rtl ? 'القائمة' : 'Menu'}"><span></span><span></span></button>
    <nav id="nav">${nav}</nav>
  </div>
</header>
<main id="main">
  <section class="hero">
    <div class="wrap">
      <p class="eyebrow">${esc(b.business)}</p>
      <h1>${esc(c.tagline || b.tagline)}</h1>
      ${(c.lede || b.what) && (c.lede || b.what) !== (c.tagline || b.tagline) ? `<p class="lede">${esc(c.lede || b.what)}</p>` : ''}
      <div class="actions">
        ${has('contact') ? `<a class="btn" href="#contact">${esc(c.cta || L.cta)}</a>` : ''}
        ${wa ? `<a class="btn ghost" href="${esc(wa)}" rel="noopener">${esc(L.whatsapp)}</a>` : ''}
      </div>
    </div>
  </section>${sectionsHtml}
</main>
<footer class="foot"><div class="wrap">© ${year} ${esc(b.business)}. ${esc(L.rights)}</div></footer>
<script src="script.js"></script>
</body>
</html>
`;

  const css = `:root{--bg:${S.bg};--surface:${S.surface};--ink:${S.ink};--mute:${S.mute};--accent:${S.accent};--accent-ink:${S.accentInk};--radius:${S.radius};--display:${display};--body:${body}}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 var(--body);-webkit-font-smoothing:antialiased}
a{color:inherit}
img{max-width:100%}
.skip{position:absolute;inset-inline-start:-999px;top:8px;background:var(--accent);color:var(--accent-ink);padding:8px 12px;z-index:10}
.skip:focus{inset-inline-start:8px}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.narrow{max-width:760px}
h1,h2,h3{font-family:var(--display);line-height:1.15;margin:0 0 .5em}
h1{font-size:clamp(2.2rem,6vw,4.2rem);letter-spacing:-.02em;max-width:18ch}
h2{font-size:clamp(1.7rem,3.6vw,2.6rem)}
h3{font-size:1.2rem}
.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}
.bar{display:flex;align-items:center;justify-content:space-between;height:68px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;text-decoration:none;font-family:var(--display)}
.mark{display:grid;place-items:center;width:34px;height:34px;border-radius:var(--radius);background:var(--accent);color:var(--accent-ink);font-size:.8rem;letter-spacing:.04em}
nav{display:flex;gap:22px}
nav a{text-decoration:none;color:var(--mute);font-weight:600;font-size:.95rem}
nav a:hover{color:var(--ink)}
.menu{display:none;background:none;border:0;padding:8px;cursor:pointer}
.menu span{display:block;width:22px;height:2px;background:var(--ink);margin:5px 0}
.hero{padding:clamp(64px,12vw,140px) 0 clamp(48px,8vw,96px)}
.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:.8rem;font-weight:700;color:var(--accent);margin:0 0 14px}
.lede{font-size:1.2rem;color:var(--mute);max-width:56ch}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);padding:13px 22px;border-radius:var(--radius);font-weight:700;text-decoration:none;border:2px solid var(--accent);cursor:pointer;font:inherit;font-weight:700}
.btn:hover{filter:brightness(1.08)}
.btn.ghost{background:transparent;color:var(--ink);border-color:color-mix(in srgb,var(--ink) 25%,transparent)}
.band{padding:clamp(56px,9vw,104px) 0}
.band.alt{background:var(--surface)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin-top:28px}
.card{background:var(--surface);border:1px solid color-mix(in srgb,var(--ink) 9%,transparent);border-radius:var(--radius);padding:24px}
.band.alt .card{background:var(--bg)}
.card-n{font-family:var(--display);color:var(--accent);font-weight:700;display:block;margin-bottom:10px}
.card p,.steps p{color:var(--mute);margin:0}
.split{display:grid;grid-template-columns:1fr 1.4fr;gap:48px;align-items:start}
.prose p{margin:0 0 1em}
.steps{list-style:none;padding:0;margin:28px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px;counter-reset:s}
.steps li{counter-increment:s;border-top:3px solid var(--accent);padding-top:18px}
.steps li::before{content:counter(s);font-family:var(--display);font-size:2rem;font-weight:700;color:var(--accent);display:block;margin-bottom:6px}
.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;margin-top:24px}
figure{margin:0;padding:26px;background:var(--bg);border-radius:var(--radius)}
blockquote{margin:0 0 12px;font-family:var(--display);font-size:1.25rem;line-height:1.4}
figcaption{color:var(--mute);font-size:.95rem}
details{border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent);padding:16px 0}
summary{cursor:pointer;font-weight:700;font-size:1.05rem}
details p{color:var(--mute);margin:10px 0 0}
.facts{display:grid;grid-template-columns:auto 1fr;gap:10px 18px;margin:20px 0 0}
.facts dt{color:var(--mute);font-weight:600}
.facts dd{margin:0}
.form{display:grid;gap:14px;background:var(--surface);padding:26px;border-radius:var(--radius);border:1px solid color-mix(in srgb,var(--ink) 9%,transparent)}
.form label{display:grid;gap:6px;font-weight:600;font-size:.95rem}
.form input,.form textarea{font:inherit;padding:12px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:calc(var(--radius) / 2 + 2px);background:var(--bg);color:var(--ink)}
.foot{padding:32px 0;color:var(--mute);font-size:.92rem;border-top:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}
.center{min-height:70vh;display:grid;place-content:center;text-align:center;gap:16px}
@media (max-width:820px){
  .split{grid-template-columns:1fr;gap:20px}
  .menu{display:block}
  nav{position:absolute;inset-inline:0;top:68px;flex-direction:column;gap:0;background:var(--bg);border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent);display:none}
  nav.open{display:flex}
  nav a{padding:14px 20px}
}
`;

  const js = `document.querySelector('.menu')?.addEventListener('click', (e) => {
  const nav = document.getElementById('nav');
  const open = nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('#nav a').forEach((a) => a.addEventListener('click', () => document.getElementById('nav').classList.remove('open')));
// No server is needed for the form: it opens the visitor's mail app, addressed
// and filled in. Swap for a form service when one is chosen.
document.getElementById('contact-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const to = f.dataset.to;
  const d = new FormData(f);
  const body = encodeURIComponent(d.get('message') + '\\n\\n' + d.get('name') + ' <' + d.get('email') + '>');
  if (to) location.href = 'mailto:' + to + '?subject=' + encodeURIComponent(document.title) + '&body=' + body;
});
`;

  const notFound = `${head(`${b.business}`)}
<body><main class="wrap center"><h1>404</h1><p>${esc(L.notFound)}</p><p><a class="btn" href="./">${esc(L.home)}</a></p></main></body></html>
`;
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${S.accent}"/><text x="32" y="41" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="${S.accentInk}" text-anchor="middle">${esc(initials)}</text></svg>\n`;
  const files = {
    'index.html': index,
    'styles.css': css,
    'script.js': js,
    '404.html': notFound,
    'favicon.svg': favicon,
    'robots.txt': `User-agent: *\nAllow: /\n${b.domain ? `Sitemap: https://${b.domain}/sitemap.xml\n` : ''}`,
    'README.md': `# ${b.business}\n\nA website generated by the AlphaCore website builder (${S.label} style, ${rtl ? 'Arabic, right to left' : 'English'}).\n\nEdit the brief in the console to regenerate it, ask an engineer for changes in plain language, or edit the files directly.\n`,
  };
  if (b.domain) files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${b.domain}/</loc></url></urlset>\n`;
  return files;
}

const stripInternal = (b) => { const { _L, ...rest } = b; return rest; };

export function createSite({ brief, actor }) {
  const b = normalizeBrief(brief);
  const files = generateSite(b);
  const p = createProject({ name: b.business, kind: 'website', description: b.tagline, meta: { brief: stripInternal(b) }, files, actor });
  audit({ actorType: 'human', actorId: actor, action: 'sites.created', subjectType: 'forgeProject', subjectId: p.id, payload: { style: b.style, language: b.language } });
  return p;
}

/** Change the brief and regenerate — the history keeps every earlier version. */
export function regenerate(projectId, { brief, actor }) {
  const p = projectRow(projectId);
  if (p.kind !== 'website') refuse('only websites made by the builder can be regenerated from a brief');
  const prev = p.meta ? JSON.parse(p.meta).brief || {} : {};
  const b = normalizeBrief({ ...prev, ...(brief || {}), contact: { ...(prev.contact || {}), ...(brief?.contact || {}) } });
  const files = generateSite(b);
  for (const [path, content] of Object.entries(files)) writeProjectFile(p.id, { path, content, commit: false, actor });
  exec("UPDATE forge_projects SET meta = ?, description = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify({ brief: stripInternal(b) }), b.tagline, p.id);
  writeProjectFile(p.id, { path: 'README.md', content: files['README.md'], commit: true, actor });
  audit({ actorType: 'human', actorId: actor, action: 'sites.regenerated', subjectType: 'forgeProject', subjectId: p.id, payload: { style: b.style } });
  return { ok: true };
}

/** Hand the words to the copywriter. The result regenerates the site. */
export function requestCopy(projectId, { notes = '', actor }) {
  const p = projectRow(projectId);
  if (p.kind !== 'website') refuse('only builder websites have copy to write');
  const b = JSON.parse(p.meta || '{}').brief || {};
  const lang = b.language === 'ar' ? 'Arabic (Modern Standard, warm and plain)' : 'English (plain, warm, specific)';
  const runId = enqueueRun({
    agentId: 'AGT-CNT-002',
    taskType: `sites:copy:${p.id}`,
    actor,
    input: {
      prompt: `[SITE-COPY] Write the website copy for this business, in ${lang}. Be specific to what they do; never invent awards, numbers, client names or guarantees.
Business: ${b.business}
What they do: ${b.what || '(not stated)'}
Services: ${(b.services || []).map((s) => s.title).join('; ')}
Contact details exist for: ${Object.entries(b.contact || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
${notes ? `Notes from the owner: ${notes}\n` : ''}
Output JSON: {"siteCopy":{"tagline":"","lede":"","cta":"","about":"","services":[{"title":"","text":""}],"process":[["step","detail"]],"faq":[["question","answer"]],"testimonials":[],"servicesTitle":"","aboutTitle":"","contactTitle":""},"confidence":0.0}
Leave testimonials empty unless the owner supplied real ones.`,
    },
  });
  exec('INSERT INTO site_copy_runs (project_id, run_id, created_by) VALUES (?,?,?)', p.id, runId, actor);
  return { runId };
}

/** Server tick: fold finished copy into the brief and regenerate. */
export function syncSites() {
  for (const r of q("SELECT * FROM site_copy_runs WHERE state = 'drafting'")) {
    const run = one('SELECT state, output FROM runs WHERE id = ?', r.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    let parsed = null;
    try { parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null; } catch { parsed = null; }
    const copy = parsed?.siteCopy && typeof parsed.siteCopy === 'object' ? parsed.siteCopy : null;
    const clean = copy ? Object.fromEntries(Object.entries(copy).filter(([, v]) => (Array.isArray(v) ? v.length : String(v ?? '').trim()))) : {};
    if (!Object.keys(clean).length) { exec("UPDATE site_copy_runs SET state = 'failed' WHERE id = ?", r.id); continue; }
    try {
      regenerate(r.project_id, { brief: { copy: clean }, actor: `${r.created_by} (copy by AGT-CNT-002)` });
      exec("UPDATE site_copy_runs SET state = 'applied' WHERE id = ?", r.id);
    } catch { exec("UPDATE site_copy_runs SET state = 'failed' WHERE id = ?", r.id); }
  }
}

export function listSites() {
  return listProjects().filter((p) => p.kind === 'website').map((p) => ({
    ...p,
    copyRuns: one("SELECT COUNT(*) AS n FROM site_copy_runs WHERE project_id = ? AND state = 'drafting'", p.id).n,
  }));
}

export function sitesOverview() {
  const sites = listSites();
  return {
    sites: sites.length,
    styles: Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label, hint: s.hint, accent: s.accent, bg: s.bg, ink: s.ink })),
    sections: SECTION_IDS,
    drafting: one("SELECT COUNT(*) AS n FROM site_copy_runs WHERE state = 'drafting'").n,
  };
}
