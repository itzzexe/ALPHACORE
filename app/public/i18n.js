// Arabic — a first-class language, not a translation layer bolted on.
//
// Two mechanisms, because the app has two kinds of text:
//   t(key)        for strings the shell writes itself (nav, palette, chrome)
//   translateDom  for the ninety page renderers, whose English is baked into
//                 template literals. After each render we walk the fresh DOM
//                 and swap text nodes that exactly match the dictionary.
//
// Exact matching only, and never inside .mono/code/pre/inputs: an ID, a hash,
// an agent name or a model id must survive the flip untouched. Technical terms
// (API, DPA, Sprint, RAG, SEV1) stay English on purpose — translating them
// costs the reader more than it gains.
export const LANGS = { en: 'English', ar: 'العربية' };
const KEY = 'alphacore-lang';

export let lang = localStorage.getItem(KEY) || 'en';

// ---------- division + section names ----------
export const DIV_AR = {
  world: 'العالم الخارجي',
  engine: 'المحرك', build: 'البناء', decide: 'القرار', data: 'البيانات',
  marketing: 'التسويق', commerce: 'التجارة', capital: 'المال', operate: 'التشغيل',
  talent: 'الكوادر', trust: 'الثقة', exec: 'الإدارة العليا', govern: 'الحوكمة',
};

export const SECTION_AR = {
  requests: 'مكتب الطلبات', agents: 'الوكلاء', workforce: 'القوى العاملة', runs: 'طابور التشغيل',
  pipelines: 'خطوط الإنتاج', providers: 'المزوّدون', artifacts: 'المخرجات', capacity: 'السعة',
  workstreams: 'دورات العمل',
  systems: 'تصميم الأنظمة', infra: 'البنية التحتية', products: 'المنتجات', journeys: 'الرحلات',
  projects: 'المشاريع', tasks: 'المهام', lab: 'المختبر', releases: 'الإصدارات', sprints: 'السبرنتات',
  gate: 'بوابة الموافقة', decisions: 'القرارات', budgets: 'الميزانيات', risks: 'المخاطر',
  quality: 'الجودة', evals: 'التقييمات', pmo: 'بوابات المشاريع', auditor: 'المدقق الذكي',
  intel: 'الاستخبارات', segments: 'الشرائح', data: 'مجموعات البيانات', archive: 'الأرشيف',
  knowledge: 'المعرفة', insights: 'التحليلات',
  localization: 'الترجمة والتوطين', social: 'التواصل الاجتماعي', content: 'استوديو المحتوى',
  design: 'استوديو التصميم', marketing: 'الحملات', brand: 'الهوية',
  pricing: 'التسعير', success: 'نجاح العملاء', marketwatch: 'مراقبة السوق', sales: 'المبيعات',
  customers: 'العملاء', relations: 'العلاقات', procurement: 'المشتريات',
  finance: 'المالية', finreports: 'التقارير المالية', finops: 'كفاءة الإنفاق',
  incidents: 'الحوادث', support: 'الدعم', assets: 'الأصول', legal: 'القانوني',
  vendors: 'المورّدون', objectives: 'الأهداف',
  people: 'الموارد البشرية', org: 'الهيكل والشخصيات', society: 'المجتمع', disputes: 'النزاعات',
  recruiting: 'التوظيف', academy: 'الأكاديمية', enablement: 'التمكين', memory: 'ذاكرة الوكلاء',
  security: 'الأمن السيبراني', compliance: 'الامتثال', sustainability: 'الاستدامة',
  board: 'مجلس الإدارة', ir: 'علاقات المستثمرين', comms: 'الاتصال الداخلي',
  harmony: 'التناغم', autopilot: 'الطيار الآلي', governance: 'الحوكمة', oversight: 'الرقابة',
  scorecard: 'لوحة الأداء', users: 'المستخدمون والصلاحيات', settings: 'الإعدادات', audit: 'سلسلة التدقيق',
  owner: 'وحدة المالك', graph: 'جدول العلاقات',
  // the departments added last: chat, marketing, treasury, money and the phones
  chat: 'الساحة (المحادثة)', mkt: 'قسم التسويق', treasury: 'الخزينة (كربتو)',
  money: 'إدارة الأموال', contact: 'مركز الاتصال',
  // العالم الخارجي — كل ما يجعل الشركة تلمس ما هو خارجها
  // قسم التسويق كاملًا
  personas: 'الشخصيات', positioning: 'التموضع', seo: 'محرّكات البحث',
  paidmedia: 'الإعلانات المدفوعة', lifecycle: 'بريد دورة الحياة', calendar: 'التقويم التحريري',
  events: 'الفعاليات', press: 'الصحافة والإعلام', community: 'المجتمع',
  attribution: 'إسناد المصدر', pages: 'صفحات الهبوط', mktops: 'عمليات التسويق',
  connectors: 'التكاملات', egress: 'البوابة الخارجية', vault: 'الخزنة',
  web: 'الويب المفتوح', mcp: 'بروتوكول MCP', jobs: 'طابور المهام',
  constitution: 'الدستور', provenance: 'إثبات الأصل', redteam: 'الفريق الأحمر',
  timemachine: 'آلة الزمن', simulation: 'الشركة الظل', skills: 'سوق المهارات',
  kgraph: 'الرسم المعرفي', revenue: 'حلقة الإيراد',
  // طبقة المنصّة
  chief: 'إيقاع التشغيل', observe: 'برج المراقبة', tenants: 'الشركات',
  keys: 'مفاتيح الواجهة', webhooks: 'الويب هوكس', packages: 'حزم الأقسام',
  backups: 'النسخ الاحتياطية',
  // الدفاتر والبحث العميق
  ledger: 'دفتر الأستاذ', bookkeeper: 'المحاسبة الآلية', hunt: 'البحث العميق',
  browser: 'المتصفح',
  economics: 'الجدوى', standing: 'الأوامر الدائمة', deadletter: 'العمل الميت', continuity: 'الاستمرارية',
  // النواة الثانية — مجرّة المؤسسة
  workforce2: 'الموظفون', orgchart: 'الهيكل التنظيمي', docs: 'الوثائق', time: 'الحضور والإجازات',
  meetings: 'الاجتماعات', finops2: 'العمليات المالية', procure: 'المشتريات التشغيلية', talent2: 'دورة حياة الموظف',
  map2: 'المجرّتان', bridges: 'الجسور',
  hrops: 'قواعد الوقت', comp: 'التعويضات والمزايا', budgets2: 'الموازنات', payables: 'الذمم الدائنة',
  receivables: 'الذمم المدينة', fixedassets: 'الأصول الثابتة', bank: 'المصرف', inventory: 'المخزون',
  facilities: 'المرافق والأسطول', helpdesk: 'مكتب المساعدة', secretariat: 'السكرتارية', legalcases: 'القضايا القانونية',
  regulatory: 'الالتزامات والتراخيص', me: 'مساحتي',
};

// ---------- interface strings ----------
const AR = {
  // وضع الإنتاج — الفرق بين حاسبة شخصية وآلة يصلها الإنترنت
  'PRODUCTION': 'إنتاج',
  'Production mode': 'وضع الإنتاج',
  'This install declares itself production: the master key must come from outside this disk, and the public address must be https behind a trusted proxy.':
    'هذا التنصيب يعلن أنه إنتاجي: يجب أن يأتي المفتاح الرئيسي من خارج هذا القرص، وأن يكون العنوان العام https خلف وكيل موثوق.',
  'Held to two things every public machine needs: a master key from outside this disk, and https behind a trusted proxy. Without them it refuses to start.':
    'يُلزَم بأمرين تحتاجهما كل آلة عامة: مفتاح رئيسي من خارج هذا القرص، وhttps خلف وكيل موثوق. وبدونهما يرفض الإقلاع.',
  'The master key comes from': 'المفتاح الرئيسي يأتي من',
  'this disk': 'هذا القرص',
  'outside this disk': 'خارج هذا القرص',

  // الدفاتر — المصطلحات المحاسبية بالعربية المستعملة فعلاً، لا الترجمة الحرفية
  'Trial balance': 'ميزان المراجعة',
  'Balance sheet': 'الميزانية العمومية',
  'Chart of accounts': 'دليل الحسابات',
  'Journal': 'دفتر اليومية',
  'Ledger': 'دفتر الأستاذ',
  'Add account': 'إضافة حساب',
  'New entry': 'قيد جديد',
  'Post': 'ترحيل',
  'Reverse': 'قيد عكسي',
  'Ref': 'المرجع',
  'Date': 'التاريخ',
  'Memo': 'البيان',
  'Lines': 'الأطراف',
  'Total': 'المجموع',
  'By': 'بواسطة',
  'Accounts': 'الحسابات',
  'Balance': 'الرصيد',
  'Type': 'النوع',
  'Revenue': 'الإيرادات',
  'Expenses': 'المصروفات',
  'ASSETS': 'الأصول',
  'LIABILITIES': 'الخصوم',
  'EQUITY': 'حقوق الملكية',
  'Total assets': 'إجمالي الأصول',
  'Liabilities + equity': 'الخصوم + حقوق الملكية',
  'balances': 'متوازن',
  'reversed': 'معكوس',
  'draft': 'مسودة',
  'open': 'مفتوحة',
  'closed': 'مقفلة',
  'find an entry': 'ابحث عن قيد',
  'Search the journal': 'ابحث في دفتر اليومية',
  'no entries yet — the bookkeeper writes them as things happen': 'لا قيود بعد — المحاسب الآلي يكتبها مع وقوع الأحداث',

  // المحاسبة الآلية
  'Recorded': 'مُسجّل',
  'The limit': 'الحد',
  'Reconciliation': 'المطابقة',
  'What this means': 'ما معنى هذا',
  'Sweep now': 'مسح الآن',
  'Waiting for a signature': 'بانتظار توقيع',
  'What the controller found': 'ما وجده المراقب',
  'Events it could not book': 'أحداث تعذّر قيدها',
  'Drafted by': 'صاغه',
  'clean': 'سليم',
  'the books match what happened': 'الدفاتر تطابق ما حدث',
  'the ledger matches the operational tables': 'دفتر الأستاذ يطابق الجداول التشغيلية',
  'events turned into entries': 'أحداث تحوّلت إلى قيود',
  'above the limit, so drafted not posted': 'فوق الحد، فصيغت مسودة ولم تُرحّل',
  'per entry, unattended': 'لكل قيد، دون إشراف',

  // الجدوى — هل يغطّي الموظفون كلفتهم
  'Cost per run': 'كلفة الجولة',
  'Cost per delivered': 'كلفة المُنجَز',
  'Wasted on failures': 'ضائع على الإخفاقات',
  'Does it pay for itself?': 'هل يغطّي نفسه؟',
  'Cost per unit of work': 'الكلفة لكل وحدة عمل',
  'By department': 'حسب القسم',
  'Every employee that did something': 'كل موظف فعل شيئًا',
  'What each customer costs to serve': 'كلفة خدمة كل عميل',
  'Employee': 'الموظف',
  'Delivered': 'المُنجَز',
  'Wasted': 'الضائع',
  'Touched': 'لامَسه',
  'Per dollar': 'لكل دولار',
  'Paid': 'المدفوع',
  'Sales': 'المبيعات',
  'Support': 'الدعم',
  'Net of model spend': 'الصافي بعد إنفاق النماذج',
  'per model call': 'لكل نداء نموذج',
  'per ticket': 'لكل تذكرة',
  'per deal won': 'لكل صفقة مربوحة',
  'the books agree': 'الدفاتر متطابقة',
  'the books disagree': 'الدفاتر غير متطابقة',
  'idle': 'خامل',
  'no work yet this month': 'لا عمل بعد هذا الشهر',
  'nobody has done anything this month': 'لم يفعل أحد شيئًا هذا الشهر',

  // الأوامر الدائمة
  'Standing orders': 'الأوامر الدائمة',
  'Firings': 'مرات التشغيل',
  'Add one': 'أضف واحدًا',
  'What should keep happening?': 'ما الذي يجب أن يستمر؟',
  'How often': 'كل كم',
  'Orders': 'الأوامر',
  'Every firing': 'كل تشغيل',
  'Run now': 'شغّل الآن',
  'Resume': 'استأنف',
  'nothing standing yet': 'لا أوامر دائمة بعد',
  'nothing has fired yet': 'لم يُشغَّل شيء بعد',
  'running without being asked': 'يعمل دون أن يُطلب منه',
  'paused, with the reason on them': 'موقوفة، والسبب مدوَّن عليها',
  'across every order': 'عبر كل الأوامر',
  'every hour': 'كل ساعة',
  'every day': 'كل يوم',
  'every week': 'كل أسبوع',
  'every month': 'كل شهر',
  'find something out': 'اعرف شيئًا',
  'do something on the web': 'افعل شيئًا على الويب',
  'keep the books up to date': 'أبقِ الدفاتر محدَّثة',
  'ask the company for something': 'اطلب من الشركة شيئًا',

  // العمل الميت
  'Dead work': 'العمل الميت',
  'Spent on nothing': 'أُنفق بلا مقابل',
  'Last death': 'آخر موت',
  'Why it is dying': 'لماذا يموت',
  'Each one': 'كل واحدة',
  'Why it died': 'سبب موته',
  'nothing waiting': 'لا شيء بالانتظار',
  'already paid for, delivered nothing': 'مدفوع سلفًا، ولم يُنتج شيئًا',

  // الاستمرارية
  'Continuity': 'الاستمرارية',
  'Reachable at 3am': 'يمكن بلوغه الثالثة فجرًا',
  'Off this machine': 'خارج هذا الجهاز',
  'Write-ahead log': 'سجلّ الكتابة المسبقة',
  'Everything this reports': 'كل ما يبلّغ عنه',
  'Why this page exists': 'لماذا توجد هذه الصفحة',
  'serving': 'يخدم',
  'draining': 'يُفرَّغ',
  'accepting work': 'يقبل العمل',
  'nobody': 'لا أحد',

  // المتصفح الذي يقوده الوكلاء
  'Give it something to do': 'أعطه مهمة',
  'What should it do? e.g. find the pricing page for acme.com and tell me the top tier': 'ما المطلوب؟ مثلًا: افتح صفحة الأسعار لـ acme.com وأخبرني بأعلى باقة',
  'What should the browser do?': 'ما المطلوب من المتصفح؟',
  'start at (optional)': 'ابدأ من (اختياري)',
  'Start URL': 'رابط البداية',
  'Send it': 'أرسله',
  'Sessions': 'الجلسات',
  'What it will not do': 'ما لن يفعله',
  'This step needs you': 'هذه الخطوة تحتاجك',
  'Approve this step': 'وافق على هذه الخطوة',
  'Open': 'افتح',
  'Goal': 'الهدف',
  'State': 'الحالة',
  'Steps': 'الخطوات',
  'Outcome': 'النتيجة',
  'no browser attached': 'لا متصفح موصول',
  'nothing held': 'لا شيء محجوز',
  'a step that leaves the building': 'خطوة تغادر المبنى',
  'across every session': 'عبر كل الجلسات',
  'no steps yet': 'لا خطوات بعد',
  'nothing yet': 'لا شيء بعد',
  'working — watch the browser window…': 'يعمل — راقب نافذة المتصفح…',
  'held': 'محجوزة',
  'approved': 'موافق عليها',
  'refused': 'مرفوضة',
  'Why not?': 'لماذا لا؟',

  // البحث العميق
  'Ask': 'اسأل',
  'Look': 'ابحث',
  'Hunt': 'تعمّق',
  'What do you want to know?': 'ما الذي تريد معرفته؟',
  'Where it looks': 'أين يبحث',
  'Hunts': 'عمليات البحث',
  'Spent': 'المُنفق',
  'Question': 'السؤال',
  'Result': 'النتيجة',
  'Rounds': 'الجولات',
  'Cost': 'الكلفة',
  'Why it stopped': 'لماذا توقّف',
  'What it tried': 'ما جرّبه',
  'Round': 'الجولة',
  'Asked': 'سأل',
  'New': 'جديد',
  'Then': 'ثم',
  'From': 'من',
  'Found': 'وجده',
  'Not found': 'لم يجده',
  'Source': 'المصدر',
  'Found in': 'وُجد في',
  'What': 'ماذا',
  'internal': 'داخلي',
  'leaves the building': 'يغادر المبنى',
  'nothing asked yet': 'لم يُسأل شيء بعد',
  'Every hunt, and what it tried': 'كل عملية بحث وما جرّبته',
  'looking…': 'يبحث…',
  'nothing matched. A hunt would keep going and follow what it learns.': 'لا نتائج. البحث العميق يواصل ويتتبّع ما يتعلّمه.',
  'hunting — asking every source, judging what came back, then going again…': 'يتعمّق — يسأل كل مصدر، يحكم على ما عاد، ثم يعيد الكرّة…',

  // shell
  'Overview': 'الرئيسية',
  'Search departments, actions…': 'ابحث في الأقسام والإجراءات…',
  'Search  Ctrl+K': 'بحث · Ctrl+K',
  'Jump to a department…': 'انتقل إلى قسم…',
  navigate: 'تنقّل', open: 'فتح', close: 'إغلاق',
  'Sign in': 'تسجيل الدخول', Username: 'اسم المستخدم', Password: 'كلمة المرور',
  'Sign out': 'تسجيل الخروج',
  'chain —': 'السلسلة —',
  '✎ auto-refresh paused': '✎ التحديث التلقائي متوقف',
  'Nothing found': 'لا نتائج',
  'After dark': 'الوضع الليلي', 'Back to daylight': 'العودة إلى النهار',
  // the way in
  'The company that runs itself': 'الشركة التي تدير نفسها',
  // the bar at the bottom of a phone
  'Departments': 'الأقسام', 'Search': 'بحث', 'Account': 'الحساب',
  // the second factor
  'One-time code': 'رمز لمرة واحدة',
  'Six digits from your authenticator, or one of your recovery codes.':
    'ستة أرقام من تطبيق المصادقة، أو أحد رموز الاسترداد.',
  'Enter the code from your authenticator': 'أدخل الرمز من تطبيق المصادقة',
  'This account — a second factor, and where it is signed in':
    'هذا الحساب — عامل ثانٍ، وأين هو مسجَّل الدخول',
  'one-time code is on': 'الرمز المؤقّت مفعّل', 'password only': 'كلمة مرور فقط',
  'recovery codes left': 'رموز استرداد متبقية', 'your password': 'كلمة مرورك',
  'Turn it off': 'أوقفه', 'Set up a one-time code': 'فعّل الرمز المؤقّت',
  'Sign out everywhere else': 'سجّل الخروج من كل مكان آخر',
  'other session(s) signed out': 'جلسة أخرى سُجّل خروجها',
  'Signed in': 'الجلسات المفتوحة', 'last seen': 'آخر ظهور',
  'Recent sign-in attempts': 'محاولات الدخول الأخيرة',
  'Add this to your authenticator, then type the code it shows to prove it works.':
    'أضف هذا إلى تطبيق المصادقة، ثم اكتب الرمز الذي يظهر لإثبات أنه يعمل.',
  'Secret': 'السرّ', 'Code': 'الرمز', 'Confirm': 'تأكيد',
  'Write these down now.': 'اكتب هذه الآن.',
  'Turned off': 'أُوقف', 'could not read this account': 'تعذّرت قراءة هذا الحساب',
  // being told
  'Being told — notifications on this device': 'أن تُبلَّغ — الإشعارات على هذا الجهاز',
  'Turn on for this device': 'فعّل على هذا الجهاز', 'Turn off': 'أوقف',
  'Send myself one': 'أرسل لي واحداً',
  'on for this device': 'مفعّل على هذا الجهاز', 'off for this device': 'متوقف على هذا الجهاز',
  'blocked in this browser': 'محجوب في هذا المتصفح', 'unavailable': 'غير متاح',
  'No device is subscribed yet.': 'لا جهاز مشترك بعد.',
  'This browser cannot receive notifications': 'هذا المتصفح لا يستقبل الإشعارات',
  'Notifications need HTTPS — over plain http only localhost counts as secure':
    'الإشعارات تحتاج HTTPS — على http العادي لا يُعدّ آمناً إلا localhost',
  'Notifications were refused — the browser will not ask again until you clear it in site settings':
    'رُفضت الإشعارات — لن يسأل المتصفح مجدداً حتى تمسح ذلك من إعدادات الموقع',
  'This device will now be told when something is waiting on you':
    'سيُبلَّغ هذا الجهاز حين ينتظرك شيء',
  'This device will no longer be told': 'لن يُبلَّغ هذا الجهاز بعد الآن',
  'Sent — it should appear in a moment': 'أُرسل — سيظهر بعد لحظة',
  'The push service refused it; the Settings list says why': 'رفضته خدمة الدفع؛ القائمة في الإعدادات تبيّن السبب',
  'If your browser filled the password in for you, clear the field and type it by hand. A new one can be issued on the machine itself with: npm run reset-password':
    'إن ملأ المتصفح كلمة المرور نيابةً عنك، امسح الحقل واكتبها بيدك. ويمكن إصدار واحدة جديدة على الجهاز نفسه بالأمر: npm run reset-password',
  'No connection to the company — this is the last thing your phone kept.':
    'لا اتصال بالشركة — هذا آخر ما احتفظ به هاتفك.',
  'Current password': 'كلمة المرور الحالية', 'New password': 'كلمة المرور الجديدة',
  'Type it again': 'أعد كتابتها', 'Set the password': 'اعتمد كلمة المرور',
  'Those two do not match': 'الكلمتان غير متطابقتين',
  'Password set. Sign in with it.': 'تم الاعتماد. سجّل الدخول بها.',
  'This account is still using the password generated when the server first started. Choose your own before going any further.':
    'هذا الحساب ما زال يستعمل كلمة المرور التي وُلّدت عند أول تشغيل للخادم. اختر كلمتك قبل أي شيء آخر.',

  // universal verbs and states
  Save: 'حفظ', Cancel: 'إلغاء', Create: 'إنشاء', Open: 'فتح', Close: 'إغلاق', Delete: 'حذف',
  Edit: 'تعديل', Approve: 'اعتماد', Reject: 'رفض', Send: 'إرسال', Publish: 'نشر', Start: 'بدء',
  Stop: 'إيقاف', Resume: 'استئناف', Retry: 'إعادة المحاولة', Apply: 'تطبيق', Verify: 'تحقّق',
  Freeze: 'تجميد', Unfreeze: 'إلغاء التجميد', Suspend: 'تعليق', Reactivate: 'إعادة تفعيل',
  Done: 'مكتمل', Failed: 'فشل', Pending: 'قيد الانتظار', Running: 'قيد التنفيذ', Queued: 'في الطابور',
  Cancelled: 'ملغى', Blocked: 'محجوب', Active: 'نشط', Closed: 'مغلق', Draft: 'مسودة',
  Approved: 'معتمد', Rejected: 'مرفوض', Published: 'منشور', Verified: 'موثّق', Unverified: 'غير موثّق',
  // frequent labels
  State: 'الحالة', Status: 'الحالة', Owner: 'المسؤول', Agent: 'الوكيل', Agents: 'الوكلاء',
  Title: 'العنوان', Name: 'الاسم', Notes: 'ملاحظات', Note: 'ملاحظة', Score: 'الدرجة',
  Verdict: 'الحكم', Findings: 'الملاحظات', Department: 'القسم', Departments: 'الأقسام',
  Priority: 'الأولوية', Created: 'أُنشئ', Updated: 'حُدّث', Actions: 'إجراءات', Total: 'الإجمالي',
  Details: 'التفاصيل', Summary: 'الملخّص', Reason: 'السبب', Type: 'النوع', Kind: 'النوع',
  Round: 'الجولة', Rounds: 'الجولات', Goal: 'الهدف', Method: 'المنهجية', Route: 'المسار',
  Quality: 'الجودة', Episodes: 'التجارب', Lessons: 'الدروس', Playbook: 'الدفتر',
  Provider: 'المزوّد', Model: 'النموذج', Cost: 'الكلفة', Tokens: 'التوكنز', Spend: 'الإنفاق',
  Budget: 'الميزانية', Human: 'بشري', Company: 'الشركة', Sprint: 'سبرنت', Velocity: 'السرعة',
  // recurring sentences
  'Waiting on you': 'ينتظر قرارك',
  'Open the section': 'افتح القسم',
  'click to open': 'انقر للفتح',
  'No records yet.': 'لا توجد سجلات بعد.',
  'Nothing here yet.': 'لا شيء هنا بعد.',
  'Loading…': 'جارٍ التحميل…',
  'permission required': 'الصلاحية مطلوبة',
  Owner: 'المالك',
  // table headers and column labels seen across the pages
  Task: 'المهمة', Tasks: 'المهام', Project: 'المشروع', Projects: 'المشاريع',
  Assignee: 'المسند إليه', Due: 'الاستحقاق', Progress: 'التقدّم', Result: 'النتيجة',
  Version: 'الإصدار', Period: 'الفترة', Amount: 'المبلغ', Item: 'البند', Vendor: 'المورّد',
  Customer: 'العميل', Product: 'المنتج', Ticket: 'التذكرة', Incident: 'الحادثة',
  Decision: 'القرار', Risk: 'الخطر', Gate: 'البوابة', Approver: 'المعتمِد', Reviewer: 'المراجع',
  Severity: 'الخطورة', Impact: 'الأثر', Likelihood: 'الاحتمالية', Mitigation: 'المعالجة',
  Sev: 'الخطورة', Scope: 'النطاق', Stage: 'المرحلة', Channel: 'القناة', Language: 'اللغة',
  Findings: 'الملاحظات', Criteria: 'المعايير', Evidence: 'الأدلة', Source: 'المصدر',
  Confidence: 'الثقة', Tier: 'الطبقة', Family: 'العائلة', Latency: 'زمن الاستجابة',
  Balance: 'الرصيد', Revenue: 'الإيراد', Burn: 'الحرق', Cap: 'السقف', Spent: 'المصروف',
  Points: 'النقاط', Retro: 'المراجعة الختامية', Backlog: 'قائمة الأعمال',
  // states as they actually appear in the data (lower case)
  done: 'مكتمل', failed: 'فشل', pending: 'قيد الانتظار', running: 'قيد التنفيذ',
  queued: 'في الطابور', cancelled: 'ملغى', blocked: 'محجوب', active: 'نشط', closed: 'مغلق',
  draft: 'مسودة', approved: 'معتمد', rejected: 'مرفوض', published: 'منشور', sent: 'أُرسل',
  open: 'مفتوح', doing: 'قيد العمل', todo: 'للتنفيذ', paused: 'متوقف', live: 'حي',
  verified: 'موثّق', unverified: 'غير موثّق', high: 'عالٍ', normal: 'عادي', low: 'منخفض',
  critical: 'حرج', warn: 'تحذير', info: 'معلومة', pass: 'ناجح', revise: 'يحتاج مراجعة',
  fail: 'راسب', awaiting_human: 'ينتظر إنسانًا', hired: 'مُوظَّف', trial: 'تجربة',
  screening: 'فرز', drafting: 'قيد الصياغة', concluded: 'منتهٍ', planning: 'تخطيط',
  review: 'مراجعة', accept: 'قبول', reject: 'رفض', ordered: 'تم الطلب', requested: 'مطلوب',
  // frequent short phrases
  'Add note': 'أضف ملاحظة', 'View': 'عرض', 'Back': 'رجوع', 'More': 'المزيد',
  'No results': 'لا نتائج', 'Refresh': 'تحديث', 'Export': 'تصدير', 'Import': 'استيراد',
  'Run': 'تشغيل', 'run': 'تشغيلة', 'Search': 'بحث', 'Filter': 'تصفية', 'All': 'الكل',
  'Yes': 'نعم', 'No': 'لا', 'None': 'لا شيء', 'Today': 'اليوم', 'This week': 'هذا الأسبوع',
  'Never': 'أبدًا', 'Now': 'الآن', 'ago': 'مضت',
  // The Stream: its six stages and the two arcs that are not progress
  'Intake': 'الاستقبال', 'Produce': 'الإنتاج', 'Peer review': 'مراجعة الأقران',
  'Audit': 'التدقيق', 'Human gate': 'البوابة البشرية', 'Landed': 'وصل ونُشر',
  'requests · chat · orchestrator': 'الطلبات · المحادثة · المنسّق',
  'employees do the work': 'الموظفون ينفّذون العمل',
  'someone who did not write it': 'يراجعه من لم يكتبه',
  'one standard, every department': 'معيار واحد لكل الأقسام',
  'a person decides': 'إنسان يقرّر',
  'shipped · archived · on the chain': 'مُسلَّم · مؤرشف · على السلسلة',
  'sent back to be improved': 'أُعيدت للتحسين',
  'revision rounds run': 'جولة مراجعة جرت',
  'human rulings — rejected work returns to the maker':
    'قرارًا بشريًا — والمرفوض يعود إلى من صنعه',
  'HARMONY': 'الانسجام', 'DEPARTMENTS TOUCHED': 'قسمًا لامسه العمل',
  'REVIEWERS': 'مراجعًا', 'MEMORY RECALLS': 'استدعاء ذاكرة',
  'WIDTH = REAL VOLUME · ARCS ABOVE AND BELOW ARE NOT PROGRESS':
    'العرض = حجم حقيقي · القوسان أعلى وأسفل ليسا تقدّمًا',
  'DEPARTMENTS': 'قسمًا', 'DISTRICTS': 'حيًّا', 'RELATIONSHIPS': 'علاقة',
  'ROUNDS RUN': 'جولة جرت',
  // the map panel: header, the two styles, and how to drive it
  'The company as it actually is': 'الشركة كما هي فعلًا',
  'sections': 'قسمًا', 'relationships live': 'علاقة حيّة', 'system map': 'خريطة النظام',
  'wired': 'موصولة', 'orphan': 'قسم معزول', 'no orphans': 'لا قسم معزول',
  'relationship table': 'جدول العلاقات',
  'The Hive': 'الخليّة', 'The Stream': 'المجرى',
  'Every department as a cell, grouped into districts — hover one to see only what it touches':
    'كل قسم خليّة، والخلايا مجموعة في أحياء — مرّر على واحدة لترى ما تلمسه وحدها',
  'Where work actually is: intake to produce to review to audit to the gate, loops included':
    'أين العمل فعلًا: استقبال ثم إنتاج ثم مراجعة ثم تدقيق ثم البوابة، مع دورات العودة',
  'The Hive: one cell per department, cells grouped into the district that owns them, and the orchestrator in the middle. Relationships stay hidden until you point at a cell, because two hundred lines at once is noise and seven lines is an answer.':
    'الخليّة: خليّة لكل قسم، والخلايا مجموعة في الحي الذي يملكها، والمنسّق في المنتصف. العلاقات تبقى مخفية حتى تشير إلى خليّة، لأن مئتي خط دفعةً واحدة ضجيج، وسبعة خطوط جواب.',
  'The Stream: six stages of one piece of work. A pillar is as tall as the volume actually sitting in it, a ribbon as thick as the work crossing between two stages, and the two arcs are the paths that are not progress — work sent back to be improved, and rulings a person made.':
    'المجرى: ست مراحل لقطعة عمل واحدة. ارتفاع العمود بحجم ما يقف فيه فعلًا، وسماكة الشريط بحجم ما يعبر بين مرحلتين، والقوسان مساران ليسا تقدّمًا — عمل أُعيد للتحسين، وقرارات اتخذها إنسان.',
  'Click': 'اضغط', 'a cell to open that department': 'على خليّة لتفتح ذلك القسم',
  'right-click': 'الزر الأيمن', 'for everything it touches and a hop-by-hop': 'يعرض كل ما تلمسه، وتتبّعًا خطوةً بخطوة',
  'Trace flow': 'تتبّع المسار', 'drag / wheel': 'السحب والعجلة', 'pans and zooms': 'يحرّكان ويكبّران',
  'click a relationship line to read what kind of movement it is': 'واضغط على خط علاقة لتقرأ نوع الحركة التي يمثّلها',
  'Unwired': 'غير موصول',
  'reconnecting…': 'إعادة اتصال…',
  // ---- the outside world: the labels these fourteen pages actually show ----
  // Integrations
  'Services reachable': 'خدمات يمكن الوصول إليها', 'Live': 'مُفعّلة',
  'Dry-run': 'تشغيل جاف', 'Not connected': 'غير موصولة',
  'Every service the company can reach': 'كل خدمة تستطيع الشركة الوصول إليها',
  'Add any HTTP API — no code': 'أضف أي واجهة API بلا برمجة',
  'Drivers available': 'المشغّلات المتاحة', 'Try a call by hand': 'جرّب نداءً يدويًا',
  'Connect': 'اربط', 'Arm it': 'فعّلها', 'Back to dry': 'أعدها للتشغيل الجاف', 'Pause': 'أوقف مؤقتًا',
  'Service': 'الخدمة', 'Auth': 'المصادقة', 'Can do': 'يستطيع', 'Allowlist': 'قائمة السماح',
  'Today': 'اليوم', 'anything': 'أي شيء',
  // The gate
  'Let through today': 'سُمح به اليوم', 'Refused': 'مرفوض',
  'Waiting for a person': 'ينتظر إنسانًا',
  'Held for a person — nothing here happened yet': 'محجوز لإنسان — لم يحدث شيء منه بعد',
  'What gets refused, and by which rule': 'ما يُرفض، وبأي قاعدة',
  'Per service, today': 'لكل خدمة، اليوم',
  'The ledger — every attempt, in order': 'السجل — كل محاولة بترتيبها',
  'Release': 'أفرج', 'Refuse': 'ارفض', 'Revoke': 'اسحب', 'Grant': 'امنح',
  'Target': 'الهدف', 'Who asked': 'من طلب', 'Why held': 'سبب الحجز',
  // The vault
  'Credentials held': 'اعتمادات محفوظة', 'Expired': 'منتهية',
  'Expiring within a fortnight': 'تنتهي خلال أسبوعين', 'Never used': 'لم تُستعمل قط',
  'The vault': 'الخزنة', 'Store': 'احفظ', 'never': 'أبدًا', 'Ends': 'تنتهي بـ',
  // The web
  'Pages read today': 'صفحات قُرئت اليوم', 'Failed or refused': 'فشلت أو رُفضت',
  'Hijack attempts caught': 'محاولات اختطاف أُمسكت', 'Search engines': 'محركات البحث',
  'Reach out — three ways, weakest first': 'اخرج إلى الويب — ثلاث طرق، الأضعف أولًا',
  'What the company has read': 'ما قرأته الشركة',
  'Fetch': 'اجلب', 'Search': 'ابحث', 'Browse (real Chrome)': 'تصفّح (كروم حقيقي)',
  'Fingerprint': 'البصمة', 'Mode': 'النمط', 'Page': 'الصفحة',
  // MCP
  'Servers registered': 'خوادم مسجّلة', 'Tools reachable': 'أدوات متاحة',
  'Tool calls made': 'نداءات أدوات', 'AlphaCore exposes': 'كروسيبل تعرض',
  'Servers the company can reach': 'الخوادم التي تصلها الشركة',
  'Add a server': 'أضف خادمًا', 'Register': 'سجّل', 'Sync': 'زامن',
  'Recent tool calls': 'آخر نداءات الأدوات',
  // The queue
  'Waiting': 'ينتظر', 'Running': 'قيد التنفيذ', 'Finished': 'منتهٍ', 'Dead': 'ميت',
  'By kind': 'حسب النوع', 'Gave up — somebody should look': 'استسلمت — ينبغي أن ينظر فيها أحد',
  'Try again': 'أعد المحاولة', 'Tries': 'المحاولات',
  // The constitution
  'Rules in force': 'قواعد سارية', 'Machine-checkable': 'قابلة للفحص آليًا',
  'Absolute refusals': 'رفض مطلق', 'People left alone': 'أشخاص طلبوا أن يُتركوا',
  'When the rules actually bit': 'متى عضّت القواعد فعلًا',
  'Add a rule': 'أضف قاعدة', 'Enact': 'سنّ', 'Retire': 'تقاعَد',
  // Provenance
  'Receipts issued': 'إيصالات صادرة', 'Runs not yet sealed': 'تشغيلات لم تُختم بعد',
  'Kinds of work': 'أنواع العمل', 'Seal now': 'اختم الآن', 'Receipts': 'الإيصالات',
  'The public key — publish this': 'المفتاح العام — انشره',
  // The time machine
  'Entries on the chain': 'قيود على السلسلة', 'Marks you can stand at': 'علامات يمكنك الوقوف عندها',
  'First recorded moment': 'أول لحظة مسجّلة', 'Mark now': 'ضع علامة الآن',
  'Marks': 'العلامات', 'Days of the company': 'أيام الشركة',
  'Replay a stretch': 'أعد تشغيل فترة', 'Stand here': 'قف هنا', 'Replay': 'أعد',
  // The shadow company
  'Simulations run': 'محاكاة جرت', 'Levers available': 'روافع متاحة',
  'Measured on': 'تُقاس على', 'Company right now': 'الشركة الآن',
  'Ask a question you cannot afford to answer for real': 'اسأل سؤالًا لا تحتمل الإجابة عنه على الحقيقة',
  'Fork and run': 'انسخ وشغّل', 'Compare': 'قارن', 'Runs': 'التشغيلات',
  'What changed': 'ما تغيّر', 'Before': 'قبل', 'After': 'بعد', 'Change': 'الفرق',
  // Skills
  'In use': 'قيد الاستعمال', 'Proposed': 'مقترحة', 'Being tested': 'تحت الاختبار',
  'Adopted methods — these go into the next prompt': 'الطرق المعتمدة — تدخل في التعليمة التالية',
  'All proposals': 'كل المقترحات', 'Put it on trial': 'ضعها تحت التجربة',
  'Model tournaments — which model actually wins which work': 'بطولات النماذج — أي نموذج يفوز بأي عمل',
  'Run a tournament': 'شغّل بطولة',
  // Red team
  'Got through': 'اخترق', 'Held': 'صُدّ', 'Attacks in the suite': 'هجمات في المجموعة',
  'Attack ourselves': 'هاجم أنفسنا', 'Run the whole suite': 'شغّل المجموعة كاملة',
  'The suite': 'المجموعة', 'Try it now': 'جرّبها الآن', 'Mark fixed': 'علّمها كمُصلحة',
  'History': 'السجل', 'What it tries': 'ما تحاوله',
  // Knowledge graph
  'Things known': 'أشياء معروفة', 'Connections': 'روابط', 'Unconnected': 'غير مرتبطة',
  'Rebuild': 'أعد البناء', 'Rebuild from the database': 'أعد البناء من قاعدة البيانات',
  'Ask about anything — meaning, not spelling': 'اسأل عن أي شيء — بالمعنى لا بالحروف',
  'Most connected': 'الأكثر ارتباطًا', 'Shape of what we know': 'شكل ما نعرفه',
  'Kinds of connection': 'أنواع الروابط', 'Closeness': 'القرب', 'What we know': 'ما نعرفه',
  // Revenue loop
  'Deals moving': 'صفقات تتحرك', 'Value in flight': 'قيمة في الطريق',
  'Collected': 'محصّلة', 'Waiting on a person': 'تنتظر إنسانًا',
  'The path — a name on a list to money in the account': 'المسار — اسم في قائمة إلى مال في الحساب',
  'Deals': 'الصفقات', 'Recent moves': 'آخر التحركات',
  'Source new deals from intelligence': 'استخرج صفقات جديدة من الاستخبارات',
  'Move everything that can move': 'حرّك كل ما يمكن تحريكه',
  'Send the approach': 'أرسل المقاربة', 'Invoice': 'أصدر فاتورة',
  // ---- the atlas ----
  'Map': 'الخريطة', 'Dashboards': 'اللوحات', 'empty': 'فارغ',
  'the whole company': 'الشركة كاملة',
  'a district to go inside': 'على حي لتدخله',
  'The whole company as one drawing: a dense core of the orchestrator and the chain, and a tree for every district growing out of it. Every leaf is a department. Point at a district to bring up its colour; open it to go inside.':
    'الشركة كلها في رسم واحد: نواة كثيفة فيها المنسّق والسلسلة، وشجرة لكل حي تنمو منها. كل ورقة قسم. مرّر على حي ليظهر لونه، وافتحه لتدخله.',
  'One district, and the departments inside it. Each mark is a department; a filled one holds records, a hollow one is declared and still empty. The arrows walk you round the rim.':
    'حي واحد والأقسام التي فيه. كل علامة قسم؛ المملوءة تحمل سجلات والمجوّفة معلنة وما زالت فارغة. والسهمان يمشيان بك حول المحيط.',
  // ---- the platform ----
  'Autonomy': 'الاستقلالية', 'Days run': 'أيام جرت', 'Corrections made': 'تصحيحات أُجريت',
  'Turn the clock now': 'أدر الساعة الآن', 'Day': 'يوم', 'Week': 'أسبوع', 'Quarter': 'ربع',
  'What the company can see about itself right now': 'ما تراه الشركة عن نفسها الآن',
  'Queue': 'الطابور', 'Money': 'المال', 'Work': 'العمل', 'Outside': 'الخارج',
  'Goals the company set itself': 'أهداف وضعتها الشركة لنفسها',
  'The record — every period, its plan, what happened, what changed': 'السجل — كل فترة وخطتها وما حدث وما تغيّر',
  'What autonomy does not cross': 'ما لا تتجاوزه الاستقلالية',
  'Clock': 'الساعة', 'Period': 'الفترة', 'Planned': 'مُخطَّط', 'Happened': 'حدث', 'Corrected': 'صُحّح',
  'Promises kept': 'وعود محفوظة', 'Broken now': 'مكسورة الآن', 'Remedies applied': 'علاجات طُبّقت',
  'Check now': 'افحص الآن', 'Measure and act': 'قِس وتصرّف',
  'What the company promised itself': 'ما وعدت به الشركة نفسها',
  'Promise': 'الوعد', 'Watching': 'يراقب', 'Now': 'الآن', 'Target': 'المستهدف', 'If it breaks': 'إن انكسر',
  'Last day': 'آخر يوم', 'What it fixed': 'ما أصلحته', 'Health': 'الصحة',
  'Companies here': 'شركات هنا', 'Paused': 'موقوفة', 'Spend this month': 'إنفاق هذا الشهر',
  'Companies on this installation': 'الشركات على هذا التنصيب', 'Add a company': 'أضف شركة',
  'Provision': 'جهّز', 'Address': 'العنوان', 'This month': 'هذا الشهر', 'Runs today': 'تشغيلات اليوم',
  'Keys in use': 'مفاتيح مستعملة', 'Calls today': 'نداءات اليوم',
  'Permissions available': 'صلاحيات متاحة', 'How to call': 'كيف تنادي',
  'Mint a key': 'أصدر مفتاحًا', 'Keys': 'المفاتيح', 'Busiest endpoints': 'أكثر المسارات ازدحامًا',
  'Recent calls': 'آخر النداءات', 'Rate': 'المعدّل', 'Last used': 'آخر استعمال',
  'Subscriptions': 'الاشتراكات', 'Delivered today': 'سُلّم اليوم', 'Failed deliveries': 'تسليمات فاشلة',
  'Verify a delivery': 'تحقّق من تسليم', 'Subscribe': 'اشترك',
  'Recent deliveries': 'آخر التسليمات', 'What you can listen for': 'ما يمكنك الاستماع إليه',
  'Where': 'إلى أين', 'Listening for': 'يستمع إلى', 'Last fired': 'آخر إطلاق', 'Failures': 'إخفاقات',
  'Installed': 'مُنصَّبة', 'Available': 'متاحة', 'Sections contributed': 'أقسام أضافتها',
  'Packages': 'الحزم', 'Install': 'نصّب', 'Uninstall': 'أزل', 'Register': 'سجّل',
  'Check it': 'افحصها', 'Load the example': 'حمّل المثال', 'Write one': 'اكتب واحدة',
  'What a package may and may not do': 'ما يجوز وما لا يجوز للحزمة',
  'Read the manifest': 'اقرأ البيان', 'The manifest it came from': 'البيان الذي جاءت منه',
  'Copies kept': 'نسخ محفوظة', 'Verified': 'مُتحقَّق منها', 'Missing files': 'ملفات مفقودة',
  'Take one now': 'خذ نسخة الآن', 'Back up the company': 'انسخ الشركة احتياطيًا',
  'Copies': 'النسخ', 'Restore': 'استعد', 'Chain tip': 'رأس السلسلة',
  'Take it somewhere that is not SQLite': 'انقلها إلى خارج SQLite',
  'Export everything as JSON': 'صدّر كل شيء بصيغة JSON',
  // the five kinds of movement a line can be, and the tally under them
  'hand-off': 'تسليم', 'sent back to improve': 'أُعيد للتحسين',
  'independent peer review': 'مراجعة قرين مستقلة', 'audit verdict': 'حكم التدقيق',
  'stops for a human': 'يقف عند إنسان', 'memory recalled / kept': 'ذاكرة تُستدعى وتُحفظ',
  'rounds': 'جولة', 'sent back': 'أُعيدت', 'hand-offs across': 'تسليمًا عبر',
  'departments': 'قسمًا', 'peer reviews by': 'مراجعة قرين نفّذها', 'reviewers': 'مراجعًا',
  'audits over': 'تدقيقًا على', 'human rulings': 'قرارًا بشريًا', 'memory recalls': 'استدعاء ذاكرة',
  // the window that opens over the map, and the trace bar
  'record': 'سجل', 'records': 'سجلًا', 'relationships': 'علاقة',
  'Sends to': 'يُرسل إلى', 'Receives from': 'يستقبل من', 'Universal': 'ثابت في كل قسم',
  'Every action here lands on the audit chain; produced items freeze into the archive.':
    'كل إجراء هنا يُسجَّل على سلسلة التدقيق، وما يُنتَج يُجمَّد في الأرشيف.',
  'on this join right now': 'على هذا الوصل الآن',
  'Where this is written': 'من أين يأتي هذا الرقم',
  'The count comes from a live query, so this line disappears the moment the relationship stops being real.':
    'الرقم من استعلام حيّ، فيختفي هذا الخط لحظة أن تتوقف العلاقة عن كونها حقيقية.',
  'reaches': 'يصل إلى', 'departments in': 'قسمًا خلال', 'hop': 'خطوة', 'hops': 'خطوات',
  'showing': 'يُعرض', 'within': 'ضمن', 'all': 'الكل', 'Show every hop': 'اعرض كل الخطوات',
  'Stop trace': 'أوقف التتبّع',
  // what each kind of line actually means
  'Work moves forward: the source department finishes something and the target picks it up. The number is how many times this has actually happened, counted straight from the database — not a diagram of intent.':
    'العمل يتقدّم: القسم المصدر ينهي شيئًا والقسم الهدف يلتقطه. الرقم هو كم مرة حدث هذا فعلًا، محسوبًا من قاعدة البيانات مباشرة — لا رسمًا لنيّة.',
  'The return path. Work that did not clear the bar goes back carrying every finding with it, and the next round must address them. This is the line that makes output improve instead of merely ship.':
    'مسار العودة. العمل الذي لم يبلغ المستوى يرجع حاملًا كل الملاحظات معه، والجولة التالية ملزمة بمعالجتها. هذا هو الخط الذي يجعل الناتج يتحسّن لا أن يُشحن فقط.',
  'A second opinion from someone who did not do the work. Reviewers are chosen to exclude the producer, and where possible from a different model family, so a mistake is not confirmed by the mind that made it.':
    'رأي ثانٍ ممن لم ينفّذ العمل. يُختار المراجع بحيث يُستبعد المنتج، ومن عائلة نماذج مختلفة متى أمكن، كي لا يصادق على الخطأ العقل الذي ارتكبه.',
  'One independent auditor judges output from every department against the same criteria and returns a score plus concrete findings. A failing verdict blocks the work and opens the return path.':
    'مدقق مستقل واحد يحكم على مخرجات كل الأقسام بالمعايير نفسها، ويعيد درجة وملاحظات محددة. والحكم الراسب يوقف العمل ويفتح مسار العودة.',
  'A hard stop. The machine prepares, a named person decides, and the decision is written to the hash chain with their name on it. Nothing crosses this line automatically.':
    'وقفة إلزامية. الآلة تُجهّز، وشخص باسمه يقرّر، ويُكتب القرار على سلسلة التجزئة باسمه. ولا شيء يعبر هذا الخط تلقائيًا.',
  'Experience moving in and out of storage: finished work leaves an episode behind, and future work retrieves what is relevant before it starts — so the same mistake is not made twice.':
    'الخبرة تدخل وتخرج من المخزن: العمل المنتهي يترك أثرًا، والعمل القادم يسترجع ما يخصّه قبل أن يبدأ — كي لا يتكرر الخطأ ذاته مرتين.',

  // النواة الثانية — سجلّ الشركة الحقيقي، بجوار نواة الذكاء لا تابعًا لها
  'Employees': 'الموظفون',
  'Organization': 'الهيكل التنظيمي',
  'The bridges': 'الجسور',
  'People on file': 'الأشخاص المسجّلون',
  'Employed': 'على رأس العمل',
  'With a login': 'لديهم حساب دخول',
  'Unsealed': 'غير مختوم',
  'every human the company knows': 'كل إنسان تعرفه الشركة',
  'with terms and a reporting line': 'بشروط عمل وخط تبعية',
  'a person is not automatically a user': 'الشخص ليس مستخدمًا تلقائيًا',
  'no contact detail, so nothing to seal under': 'لا وسيلة اتصال، فلا مفتاح يُختم تحته',
  'One human, one row': 'إنسان واحد، صف واحد',
  'Number': 'الرقم',
  'Name': 'الاسم',
  'Employment': 'نوع التعاقد',
  'State': 'الحالة',
  'Since': 'منذ',
  'Contact': 'وسيلة الاتصال',
  'Reference': 'المرجع',
  'none on file': 'لا شيء مسجّل',
  'Nobody on file yet.': 'لا أحد مسجّل بعد.',
  'Nobody is employed yet. A person comes first, then their terms.':
    'لا أحد على رأس العمل بعد. الشخص أولًا، ثم شروط تعاقده.',
  'Record a person': 'تسجيل شخص',
  'Record': 'سجّل',
  'Full name': 'الاسم الكامل',
  'Personal email': 'البريد الشخصي',
  'Personal phone': 'الهاتف الشخصي',
  'The contact details are sealed under this person\'s own key before the row exists. The name stays readable, because every screen and every report groups by it.':
    'تُختم تفاصيل الاتصال تحت مفتاح هذا الشخص نفسه قبل أن يوجد الصف. ويبقى الاسم مقروءًا، لأن كل شاشة وكل تقرير يجمع به.',
  'You do not have permission to see the employee record.': 'لا تملك صلاحية الاطلاع على سجل الموظفين.',
  'You do not have permission to see the organization.': 'لا تملك صلاحية الاطلاع على الهيكل التنظيمي.',
  'You do not have permission to see the bridges.': 'لا تملك صلاحية الاطلاع على الجسور.',
  'full-time': 'دوام كامل', 'part-time': 'دوام جزئي', 'contract': 'عقد',
  'intern': 'متدرّب', 'fractional': 'بدوام موزّع',
  'pending': 'قيد الانتظار', 'suspended': 'موقوف', 'notice': 'في مهلة الإنهاء', 'ended': 'منتهٍ',

  // الهيكل
  'Units': 'الوحدات',
  'People placed': 'موزّعون على وحدات',
  'Top level': 'المستوى الأعلى',
  'active parts of the company': 'أجزاء الشركة الفاعلة',
  'employed and assigned to a unit': 'على رأس العمل ومسنَدون إلى وحدة',
  'units reporting to nobody': 'وحدات لا تتبع أحدًا',
  'The shape of the company': 'شكل الشركة',
  'No units yet.': 'لا وحدات بعد.',
  'answers to': 'تتبع',
  'A reporting line points at another employment, by number. It is not a name and it cannot be an AI employee — the column is an integer in a STRICT table, so an org chart with an agent on it is not something this schema can express.':
    'خط التبعية يشير إلى تعاقد آخر برقمه. ليس اسمًا، ولا يمكن أن يكون موظفًا اصطناعيًا — فالعمود عدد صحيح في جدول STRICT، وهيكلٌ فيه وكيل ذكاء ليس شيئًا يستطيع هذا المخطط التعبير عنه أصلًا.',

  // الجسور
  'Tools': 'الأدوات',
  'Calls through the gate': 'نداءات عبر البوابة',
  'Held for a person': 'محجوزة بانتظار إنسان',
  'Identity bar': 'حاجز الهوية',
  'holds': 'صامد', 'BROKEN': 'مكسور',
  'one action each, no catch-all': 'فعل واحد لكل أداة، بلا أداة جامعة',
  'every one checked like an outside call': 'كل نداء يُفحص كأنه نداء إلى الخارج',
  'gated, waiting on a human': 'موقوفة بانتظار إنسان',
  'an agent cannot occupy a human slot': 'لا يمكن لوكيل أن يشغل موضع إنسان',
  'Nothing crosses except through these': 'لا شيء يعبر إلا من خلالها',
  'Commands a machine may never complete alone': 'أوامر لا يجوز لآلة أن تُتمّها وحدها',
  'Gated whatever the amount and whatever the agent\'s scopes say. A termination is not a large expense; it is a different kind of act.':
    'موقوفة مهما كان المبلغ ومهما قالت صلاحيات الوكيل. إنهاء خدمة موظف ليس نفقة كبيرة، بل فعل من نوع آخر.',
  'The tool surface': 'سطح الأدوات',
  'Tool': 'الأداة', 'Writes': 'يكتب', 'Permission': 'الصلاحية', 'What for': 'لماذا',
  'Events, and which reach the chain': 'الأحداث، وأيّها يبلغ السلسلة',
  'Highlighted events are also written to the audit chain. The rest stay in the operational log — a chain of every attendance ping buries the signal it exists to carry.':
    'الأحداث المميّزة تُكتب أيضًا على سلسلة التدقيق. وما عداها يبقى في السجل التشغيلي — فسلسلة تحوي كل نبضة حضور تدفن الإشارة التي وُجدت لتحملها.',

  // الخريطة الثانية — مجرّتان وشركة واحدة
  'The two galaxies': 'المجرّتان',
  'Two galaxies, one company': 'مجرّتان، وشركة واحدة',
  'CORE 1 — THINKS AND ACTS': 'النواة ١ — تفكّر وتتصرّف',
  'CORE 2 — RECORDS THE TRUTH': 'النواة ٢ — تسجّل الحقيقة',
  'The tunnels': 'الأنفاق',
  'Enterprise': 'المؤسسة',
  'AI core': 'نواة الذكاء',
  'Why they are joined': 'لماذا هما موصولان',
  'The first map': 'الخريطة الأولى',
  'reached by a tunnel': 'يصلها نفق',
  'departments': 'قسمًا',
  'The AI core thinks and acts; the enterprise core records what is true. Nothing crosses between them except the tunnels drawn here — and every tunnel is a declared relationship the connectivity audit checks, not a line on a picture. This is the same catalogue as the first map, projected so the seam is the subject.': 'نواة الذكاء تفكّر وتتصرّف؛ ونواة المؤسسة تسجّل ما هو حقيقي. لا شيء يعبر بينهما إلا الأنفاق المرسومة هنا — وكل نفق علاقة معلنة يفحصها تدقيق الترابط، لا خطًا على صورة. هذه الكتالوج نفسه الذي ترسمه الخريطة الأولى، مُسقطًا بحيث يصبح خطّ الالتحام هو الموضوع.',
  'A tunnel with no declared edge behind it cannot exist on this page — the drawing is derived, never drawn.': 'نفقٌ بلا علاقة معلنة خلفه لا يمكن أن يوجد في هذه الصفحة — فالرسم مُشتق، لا مرسوم باليد.',
  'You do not have permission to see the map.': 'لا تملك صلاحية الاطلاع على الخريطة.',

  // اسأل عبر النواتين
  'From the record': 'من السجل',
  'Open the page': 'افتح الصفحة',
  '1 in, 1 absent': '1 حاضر، 1 غائب',

  // دورة حياة الموظف — الدخول والنمو والخروج، والأحكام تبقى بشرية
  'People lifecycle': 'دورة حياة الموظف',
  'Open vacancies': 'شواغر مفتوحة',
  'In the pipeline': 'في المسار',
  'Unrated reviews': 'تقييمات بلا حكم',
  'Offboarding open': 'مغادرات جارية',
  'positions looking for a person': 'مناصب تبحث عن شخص',
  'applications not yet decided': 'طلبات لم يُبتّ فيها',
  'evidence written, judgment pending': 'الشواهد مكتوبة والحكم منتظر',
  'assets and access still to recover': 'عهدة وصلاحيات لم تُستردّ بعد',
  'Two species, two pipelines': 'جنسان، ومساران',
  'Applications': 'الطلبات',
  'Vacancy': 'الشاغر',
  'Decided by': 'قرّرها',
  'Nobody has applied yet.': 'لم يتقدّم أحد بعد.',
  'Competency matrix': 'مصفوفة الكفاءات',
  'Course': 'الدورة',
  'Earned': 'نالها',
  'Standing': 'الوضع',
  'current': 'سارية', 'expired': 'منتهية',
  'No certificates yet.': 'لا شهادات بعد.',
  'What a machine may and may not do here': 'ما يجوز للآلة هنا وما لا يجوز',
  'An AI screens applications, drafts review evidence and computes checklists. It cannot make an offer, hire, reject, rate, or terminate — those refuse a machine inside the record itself, whatever the agent\'s scopes say, and each one is chained when a human does it.':
    'الذكاء الاصطناعي يفرز الطلبات ويكتب شواهد التقييم ويحسب قوائم المهام. ولا يستطيع أن يعرض وظيفة أو يوظّف أو يرفض أو يقيّم أو ينهي خدمة — فهذه يرفضها السجل نفسه من أي آلة مهما كانت صلاحيات الوكيل، وكلٌّ منها يُقيَّد على السلسلة حين يفعلها إنسان.',
  'You do not have permission to see the people lifecycle.': 'لا تملك صلاحية الاطلاع على دورة حياة الموظف.',
  'applied': 'مقدَّم', 'screening': 'فرز', 'interview': 'مقابلة', 'offer': 'عرض', 'hired': 'موظَّف',

  // المال — دفتر واحد، وسيّد واحد
  'Finance ops': 'العمليات المالية',
  'Procurement ops': 'عمليات المشتريات',
  'Expenses waiting': 'نفقات معلّقة',
  'Active loans': 'قروض قائمة',
  'Payroll runs': 'دورات الرواتب',
  'Cost centers': 'مراكز الكلفة',
  'submitted, not yet decided': 'مقدَّمة ولم يُبتّ فيها',
  'repaid through payroll': 'تُسدَّد عبر الرواتب',
  'drafted by arithmetic, approved by people': 'تُحسب آليًا وتُعتمد بشريًا',
  'budgets with spend counted against them': 'موازنات يُحسب الإنفاق عليها',
  'One ledger, one master': 'دفتر واحد، سيّد واحد',
  'Period': 'الفترة',
  'Gross': 'الإجمالي',
  'Net': 'الصافي',
  'Approved by': 'اعتمدها',
  'No payroll yet.': 'لا رواتب بعد.',
  'Individual slips are sealed under each employee\'s own key. The totals stay readable because the ledger entry the close posts shows the aggregate regardless.':
    'قسائم الرواتب مختومة تحت مفتاح كل موظف. وتبقى المجاميع مقروءة لأن قيد الدفتر الذي يُنشئه الإقفال يُظهر المجموع على أي حال.',
  'Expenses': 'النفقات',
  'Category': 'الفئة',
  'Amount': 'المبلغ',
  'advance': 'سلفة',
  'Pay': 'ادفع',
  'No expenses.': 'لا نفقات.',
  'You do not have permission to see finance operations.': 'لا تملك صلاحية الاطلاع على العمليات المالية.',
  'draft': 'مسودة', 'closed': 'مقفلة', 'paid': 'مدفوعة',

  // المشتريات — سلسلة لا تقبل القفز
  'Open purchases': 'مشتريات مفتوحة',
  'Awaiting approval': 'بانتظار الاعتماد',
  'Contracts expiring': 'عقود تنتهي',
  'somewhere along the chain': 'في موضع ما من السلسلة',
  'a human decision, not a ceiling': 'قرار بشري، لا سقف مبلغ',
  'inside ninety days': 'خلال تسعين يومًا',
  'The chain refuses to skip': 'السلسلة ترفض القفز',
  'Purchases': 'المشتريات',
  'Vendor': 'المورّد',
  'PO': 'أمر شراء',
  'to': 'إلى',
  'Nothing being purchased.': 'لا مشتريات جارية.',
  'Contracts expiring soon': 'عقود تنتهي قريبًا',
  'Counterparty': 'الطرف الآخر',
  'Expires': 'تنتهي',
  'Nothing lapses inside ninety days.': 'لا شيء ينتهي خلال تسعين يومًا.',
  'The contract record itself lives in Legal': 'سجل العقد نفسه في القسم القانوني',
  'You do not have permission to see procurement.': 'لا تملك صلاحية الاطلاع على المشتريات.',
  'requested': 'مطلوب', 'po': 'أمر شراء', 'delivered': 'مستلَم', 'invoiced': 'مفوتَر',

  // الدوام والإجازات — التفويض في التقديم لا في القرار
  'Attendance & leave': 'الدوام والإجازات',
  'Present': 'حاضرون',
  'Absent': 'غائبون',
  'On leave': 'في إجازة',
  'Waiting on a manager': 'بانتظار مدير',
  'checked in today': 'سجّلوا حضورهم اليوم',
  'no mark and not on leave': 'بلا تسجيل وليسوا في إجازة',
  'approved and away': 'إجازة معتمدة',
  'leave requests pending': 'طلبات إجازة معلّقة',
  'Filing can be delegated; deciding cannot': 'التقديم يُفوَّض؛ أما القرار فلا',
  'Today': 'اليوم',
  'In': 'دخول',
  'Out': 'خروج',
  'on leave': 'في إجازة',
  'present': 'حاضر',
  'absent': 'غائب',
  'Leave requests': 'طلبات الإجازة',
  'Who': 'من',
  'Type': 'النوع',
  'Days': 'الأيام',
  'When': 'متى',
  'Approve': 'اعتماد',
  'Reject': 'رفض',
  'No leave requests.': 'لا طلبات إجازة.',
  'a sealed document is attached': 'وثيقة مختومة مرفقة',
  'There is no reason column in this table, by design. A sick request carries a category and, at most, a sealed document.':
    'لا عمود «سبب» في هذا الجدول، عن قصد. طلب الإجازة المرضية يحمل تصنيفًا، وعلى الأكثر وثيقة مختومة.',
  'You do not have permission to see attendance.': 'لا تملك صلاحية الاطلاع على الدوام.',
  'annual': 'سنوية', 'sick': 'مرضية', 'unpaid': 'بلا راتب', 'unpaid-medical': 'مرضية بلا راتب',
  'parental': 'أمومة/أبوة', 'bereavement': 'حداد',
  'approved': 'معتمدة', 'rejected': 'مرفوضة', 'cancelled': 'ملغاة',

  // الاجتماعات — بشرٌ فقط في الغرفة
  'Meetings': 'الاجتماعات',
  'Planned': 'مجدولة',
  'Decisions': 'قرارات',
  'Open actions': 'مهام مفتوحة',
  'Sealed transcripts': 'محاضر مختومة',
  'on the calendar': 'على الرزنامة',
  'recorded with a meeting behind them': 'مسجّلة ولها اجتماع خلفها',
  'assigned to somebody employed': 'مسنَدة إلى موظف',
  'Only humans in the room': 'بشرٌ فقط في الغرفة',
  'Organizer': 'المنظّم',
  'People': 'أشخاص',
  'No meetings yet.': 'لا اجتماعات بعد.',
  'You do not have permission to see meetings.': 'لا تملك صلاحية الاطلاع على الاجتماعات.',
  'planned': 'مجدول', 'running': 'جارٍ', 'completed': 'منجز',

  // الوثائق وقاعدة المعرفة — الفهرس مفتوح والمحتوى محكوم
  'Documents': 'الوثائق',
  'Versions': 'الإصدارات',
  'About people': 'عن أشخاص',
  'Sealed versions': 'إصدارات مختومة',
  'active in the knowledge base': 'فاعلة في قاعدة المعرفة',
  'append-only — the next correction is the next version': 'إلحاق فقط — التصحيح التالي هو الإصدار التالي',
  'naming a subject who can erase them': 'تسمّي شخصًا يستطيع محوها',
  'unreadable on the disk, by design': 'غير مقروءة على القرص، عن قصد',
  'Classification is an access decision': 'التصنيف قرارُ وصولٍ لا مجرد وسم',
  'The knowledge base': 'قاعدة المعرفة',
  'Search titles and internal content': 'ابحث في العناوين والمحتوى الداخلي',
  'Title': 'العنوان',
  'Classification': 'التصنيف',
  'About': 'عن',
  'Version': 'الإصدار',
  'Content': 'المحتوى',
  'Create': 'أنشئ',
  'New document': 'وثيقة جديدة',
  'Nothing written down yet.': 'لا شيء مدوّن بعد.',
  'Nothing matched. Guarded contents are never searched — that is the design, not a gap.':
    'لا نتائج. المحتوى المحروس لا يُبحث فيه أبدًا — هذا هو التصميم، لا ثغرة.',
  'Restricted documents are created from a person\'s record, because they must name who they are about.':
    'الوثائق المقيّدة تُنشأ من سجل الشخص نفسه، لأنها يجب أن تسمّي من هي عنه.',
  'You do not have permission to see the documents.': 'لا تملك صلاحية الاطلاع على الوثائق.',
  'public': 'عامة', 'internal': 'داخلية', 'confidential': 'سرّية', 'restricted': 'مقيّدة',

  // الأبواب الثمانية — ١٤٠ قسمًا عدد صحيح لشركة وخاطئ لقائمة
  'Ask AlphaCore': 'اسأل ألفاكور',
  'Work': 'العمل',
  'Approvals': 'الموافقات',
  'Company': 'الشركة',
  'Intelligence': 'الاستخبارات',
  'Money': 'المال',
  'People': 'الناس',
  'World': 'العالم',
  'All departments': 'كل الأقسام',
  'Every department': 'كل قسم',
  'Door': 'الباب',
  'Division': 'الشعبة',
  'Records': 'السجلات',
  'unfiled': 'غير مصنّف',
  'Filter departments': 'تصفية الأقسام',
  'The map': 'الخريطة',
  'No such surface.': 'لا يوجد سطح بهذا الاسم.',
  'Nothing here you have permission to see.': 'لا شيء هنا لديك صلاحية لرؤيته.',
  'waiting on you': 'بانتظارك',
  'Say what you need. The company works out which departments are involved.':
    'قل ما تحتاجه، والشركة تستنتج أي الأقسام معنية.',
  'Make something: the workforce, the queue, and everything being built.':
    'اصنع شيئًا: القوى العاملة، والطابور، وكل ما يُبنى.',
  'Everything stopped, waiting for a person to decide.': 'كل ما توقّف بانتظار قرار إنسان.',
  'The company\'s own record: how it governs itself, and what it owes.':
    'سجل الشركة عن نفسها: كيف تحكم ذاتها، وما الذي تدين به.',
  'Find something out — about a market, a company, or your own records.':
    'اعرف شيئًا — عن سوق، أو شركة، أو عن سجلاتك أنت.',
  'Money in, money out, and what everything cost.': 'المال داخلًا وخارجًا، وكم كلّف كل شيء.',
  'The workforce, human and synthetic — and how it gets better.':
    'القوى العاملة، بشرية واصطناعية — وكيف تتحسّن.',
  'Anything that reaches a person outside this company.': 'كل ما يصل إلى شخص خارج هذه الشركة.',
  'Every department still has its own page and its own address — nothing was removed. This is a door, not a replacement.':
    'كل قسم ما زال له صفحته وعنوانه — لم يُحذف شيء. هذا باب، وليس بديلًا.',
  'The eight doors are a way in, not a shorter list. All of it is still here, still grouped by division the way the org chart groups it, and every route that ever worked still works.':
    'الأبواب الثمانية مدخل، لا قائمة أقصر. كل شيء ما زال هنا، مجموعًا بالشُعب كما يجمعه الهيكل التنظيمي، وكل مسار عمل يومًا ما زال يعمل.',

  // اسأل ألفاكور — توجيه فقط، بلا أي نموذج
  'Say what you need. The records are searched straight away and cost nothing; anything that spends money or opens work comes back as a button, not as a surprise.':
    'قل ما تحتاجه. تُبحث السجلات فورًا بلا تكلفة؛ وأي شيء ينفق مالًا أو يفتح عملًا يعود إليك كزر، لا كمفاجأة.',
  'e.g. who are the top logistics companies in Baghdad': 'مثلًا: من أبرز شركات النقل في بغداد',
  'Ask': 'اسأل',
  'How it decides': 'كيف يقرّر',
  'Rule': 'القاعدة',
  'Goes to': 'يذهب إلى',
  'Why': 'لماذا',
  'Looking…': 'يبحث…',
  'Working…': 'ينفّذ…',
  'Done': 'تم',
  'Answered by': 'أجاب عنه',
  'No department has anything on this yet.': 'لا قسم لديه شيء عن هذا بعد.',
  'Routed by the': 'وُجِّه بقاعدة',
  'rule': '',
  'From the records': 'من السجلات',
  'What': 'ماذا',
  'Where': 'أين',
  'Matched': 'تطابق في',
  'Nothing in the records matched. That is an answer too.': 'لا شيء في السجلات تطابق. وهذه إجابة أيضًا.',
  'Searched': 'بُحث في',
  'tables. This cost nothing.': 'جدولًا. ولم يكلّف هذا شيئًا.',
  'What happens next, if you say so': 'ما سيحدث تاليًا، إن أذنت',
  'The search above already ran and cost nothing. Anything that spends money or opens work is a proposal until you press the button — routing is done by reading the words you typed, not by asking a model, so it is occasionally wrong and never expensively wrong.':
    'البحث أعلاه جرى فعلًا ولم يكلّف شيئًا. وأي شيء ينفق مالًا أو يفتح عملًا يبقى اقتراحًا حتى تضغط الزر — والتوجيه يقرأ كلماتك ولا يسأل نموذجًا، فهو يخطئ أحيانًا ولا يخطئ بثمن أبدًا.',
  'First match wins, and the last rule matches everything. Routing is regex over the words typed — no model call, so it is fast, free and legible. The default is the read-only one on purpose.':
    'أول قاعدة تطابق تفوز، وآخر قاعدة تطابق كل شيء. التوجيه تعبير نمطي على الكلمات المكتوبة — بلا نداء نموذج، فهو سريع ومجاني ومقروء. والافتراضي هو الخيار القارئ فقط، عن قصد.',
  'it names an employee or a department, so it is a question for them rather than a search':
    'يسمّي موظفًا أو قسمًا، فهو سؤال لهم لا بحث',
  'it asks for something to be done, which is what the request desk routes department to department':
    'يطلب إنجاز شيء، وهذا ما يوجّهه مكتب الطلبات من قسم إلى قسم',
  'it needs more than one pass and may need the open web, which is what a hunt is for':
    'يحتاج أكثر من جولة وقد يحتاج الويب المفتوح، وهذا ما تُصنع له المطاردة',
  'anything else is answered from the records first — it is instant, it costs nothing, and it is usually enough':
    'ما عدا ذلك يُجاب من السجلات أولًا — فوري، بلا تكلفة، وغالبًا يكفي',

  // اعتماد الموصلات — جدول لم يكتبه أحد بيده. الحالات تُترك بالإنجليزية عمدًا
  // حيث تُقرأ كمصطلح تقني، ويُشرح معناها في العمود المجاور.
  'Connector certification — measured, not claimed': 'اعتماد الموصلات — مقيس لا مُدّعى',
  'Connector': 'الموصل',
  'observations': 'ملاحظة مسجّلة',
  'last failure': 'آخر إخفاق',
  'Evidence rows behind this table': 'صفوف الأدلة خلف هذا الجدول',
  'Live-verified': 'مُتحقَّق حيًّا',
  'Paper-verified': 'مُتحقَّق على الورق',
  'Untested': 'غير مُختبَر',
  'With a recent failure': 'فيه إخفاق حديث',
  'a real call really left this machine': 'نداء حقيقي غادر هذه الآلة فعلًا',
  'read the real world, changed nothing': 'قرأ العالم الحقيقي ولم يغيّر شيئًا',
  'no evidence either way': 'لا دليل بأي اتجاه',
  'shown beside the state, not hidden': 'يُعرض بجانب الحالة لا يُخفى',
  'live-verified': 'مُتحقَّق حيًّا',
  'sandbox-verified': 'مُتحقَّق في بيئة اختبار',
  'paper-verified': 'مُتحقَّق على الورق',
  'mock-only': 'محاكاة فقط',
  'untested': 'غير مُختبَر',
  'not yet observable': 'غير قابل للرصد بعد',
  // حالات الموصل نفسه، كما تظهر تحت اسمه في الجدول
  'disconnected': 'غير موصول',
  'dry': 'تشغيل جاف',
  'live': 'حيّ',
  'paused': 'موقوف مؤقتًا',
  'Read': 'قراءة',
  'Write': 'كتابة',
  'OAuth flow': 'مصافحة OAuth',
  'Failure handling': 'معالجة الإخفاق',
  'Rate limit': 'حدّ المعدّل',
  'Token refresh': 'تجديد الرمز',
  'fetching something without changing it': 'جلب شيء دون تغييره',
  'changing something on the other side': 'تغيير شيء في الطرف الآخر',
  'a code exchanged for a token': 'رمز تفويض بُودل برمز وصول',
  'the call failed and was handled rather than crashing': 'أخفق النداء فعُولج بدل أن ينهار',
  'a limit was hit — theirs or ours — and respected': 'بُلغ حدّ — حدّهم أو حدّنا — واحتُرم',

  // بقية المؤسسة — قواعد الوقت، التعويضات، الدفاتر الفرعية، المصرف، التشغيل، الإدارة
  'Done.': 'تمّ.',
  'Approve': 'موافقة', 'Reject': 'رفض', 'Review': 'مراجعة', 'Resolve': 'حلّ', 'Dismiss': 'صرف النظر',
  'Adopt': 'اعتماد', 'Close': 'إغلاق', 'Void': 'إلغاء', 'Pay': 'دفع', 'Issue': 'إصدار', 'Receipt': 'قبض',
  'Dispose': 'شطب', 'Register': 'تسجيل', 'Record': 'تسجيل', 'Draft': 'مسودّة', 'Open': 'فتح', 'Add': 'إضافة',
  'Create': 'إنشاء', 'Assign': 'تعيين', 'File': 'تقديم', 'Claim': 'مطالبة', 'Grant': 'منح', 'Enroll': 'تسجيل',
  'Execute': 'تنفيذ', 'Release': 'إطلاق', 'Reconcile': 'مطابقة', 'Auto-match': 'مطابقة آلية', 'Match': 'مطابقة',
  'Exclude': 'استبعاد', 'Import': 'استيراد', 'Book': 'حجز', 'Raise': 'رفع', 'Start': 'بدء', 'Done': 'تمّ',
  'Cancel': 'إلغاء', 'Report': 'إبلاغ', 'Investigate': 'تحقيق', 'Discharge': 'أداء', 'Renew': 'تجديد',
  'Propose': 'اقتراح', 'Form': 'تشكيل', 'Variance': 'الانحراف', 'Check in': 'تسجيل حضور', 'Check out': 'تسجيل انصراف',
  'I have read it': 'قرأتها', 'Issue letter': 'إصدار كتاب', 'Change salary': 'تغيير الراتب',
  'Compute end of service': 'احتساب نهاية الخدمة', 'Pay end of service': 'صرف نهاية الخدمة',
  'Post depreciation': 'ترحيل الإهلاك', 'Record rate': 'تسجيل السعر', 'Payroll batch': 'دفعة رواتب', 'Bills batch': 'دفعة فواتير',
  'Employee': 'الموظف', 'Day': 'اليوم', 'Minutes': 'الدقائق', 'Rate': 'المعدّل', 'State': 'الحالة', 'In': 'دخول', 'Out': 'خروج',
  'Name': 'الاسم', 'Hours': 'الساعات', 'Days': 'الأيام', 'Kind': 'النوع', 'Amount': 'المبلغ', 'Tax': 'الضريبة', 'Due': 'الاستحقاق',
  'Ref': 'المرجع', 'Vendor': 'المورّد', 'Customer': 'العميل', 'Description': 'الوصف', 'Total': 'الإجمالي', 'Paid': 'المدفوع',
  'Account': 'الحساب', 'Period': 'الفترة', 'Budget': 'الموازنة', 'Actual': 'الفعلي', 'Cost center': 'مركز الكلفة',
  'Asset': 'الأصل', 'Category': 'الفئة', 'Acquired': 'تاريخ الاقتناء', 'Cost': 'الكلفة', 'Accumulated': 'المتراكم', 'Book': 'الدفترية', 'Life': 'العمر',
  'From': 'من', 'To': 'إلى', 'Fee': 'الرسوم', 'Approved by': 'وافق عليه', 'Direction': 'الاتجاه', 'Payee': 'المستفيد', 'No.': 'الرقم',
  'Lines': 'الأسطر', 'Ledger': 'الدفتر', 'Statement': 'الكشف', 'Difference': 'الفرق', 'Unmatched': 'غير مطابَق', 'GL': 'الحساب الدفتري',
  'SKU': 'الرمز', 'Item': 'الصنف', 'Level': 'الرصيد', 'Min': 'الحدّ الأدنى', 'By warehouse': 'حسب المستودع', 'Value': 'القيمة', 'Warehouse': 'المستودع', 'Quantity': 'الكمية',
  'Title': 'العنوان', 'Target': 'الهدف', 'Priority': 'الأولوية', 'Assignee': 'المكلَّف', 'Plate': 'اللوحة', 'Vehicle': 'المركبة', 'Odometer': 'العدّاد',
  'Held by': 'بحوزة', 'Next service': 'الصيانة القادمة', 'Room': 'القاعة', 'Capacity': 'السعة', 'Bookings': 'الحجوزات',
  'Requester': 'مقدّم الطلب', 'SLA due': 'موعد اتفاقية الخدمة', 'Sev': 'الخطورة', 'Occurred': 'وقع في', 'Corrective action': 'الإجراء التصحيحي',
  'Subject': 'الموضوع', 'Counterparty': 'الطرف الآخر', 'Unit': 'الوحدة', 'Decided': 'قُرّر في', 'By': 'بواسطة', 'Court': 'المحكمة', 'Contract': 'العقد',
  'Next hearing': 'الجلسة القادمة', 'Exposure': 'التعرّض', 'Authority': 'الجهة', 'Recurs': 'يتكرّر', 'Done by': 'أدّاه', 'Number': 'الرقم', 'Issued': 'صدر في', 'Expires': 'ينتهي في',
  'Policy': 'السياسة', 'Type': 'النوع', 'Entitled': 'المستحق', 'Used': 'المستخدَم', 'Left': 'المتبقي', 'Run state': 'حالة الدورة', 'Since': 'منذ', 'What': 'ماذا', 'Objective': 'الهدف', 'Course': 'الدورة', 'Plan': 'الخطة',
  'Employer': 'صاحب العمل', 'Enrolled': 'المسجَّلون', 'Effective': 'يسري من', 'Opened': 'فُتح في', 'Decided by': 'قرّره',
  'Overtime waiting': 'عمل إضافي بانتظار القرار', 'Corrections waiting': 'تصحيحات بانتظار القرار', 'Shifts': 'الورديات', 'Holidays this year': 'العطل هذا العام',
  'Measured, never explained': 'يُقاس ولا يُشرح', 'Overtime claims': 'مطالبات العمل الإضافي', 'Attendance corrections': 'تصحيحات الحضور', 'Holidays': 'العطل',
  'File an overtime claim': 'تقديم مطالبة عمل إضافي', 'Claim a correction': 'المطالبة بتصحيح', 'Define a shift': 'تعريف وردية', 'Add a holiday': 'إضافة عطلة',
  'Salary changes': 'تغييرات الرواتب', 'Benefit plans': 'خطط المزايا', 'Grievances open': 'تظلّمات مفتوحة', 'Assets held': 'أصول بحوزة الموظفين',
  'What is sealed here': 'ما هو مختوم هنا', 'Movements': 'الحركات الوظيفية', 'Grievances': 'التظلّمات', 'Grant an allowance': 'منح بدل', 'Benefits': 'المزايا',
  'Move somebody': 'نقل أو ترقية', 'Raise a grievance': 'رفع تظلّم', 'Hand over an asset': 'تسليم أصل', 'Employment certificate': 'شهادة عمل',
  'Budgets': 'الموازنات', 'Adopted': 'المعتمَدة', 'Draft a budget': 'إعداد موازنة', 'Bills': 'الفواتير الواردة', 'Record a bill': 'تسجيل فاتورة',
  'Owed to vendors': 'مستحق للمورّدين', 'Overdue': 'متأخر', 'Drafts': 'مسودّات', 'Over 90 days': 'أكثر من ٩٠ يومًا', 'Owed to us': 'مستحق لنا',
  'Invoices': 'الفواتير', 'Draft an invoice': 'إعداد فاتورة', 'On the register': 'في السجل', 'Book value': 'القيمة الدفترية', 'Method': 'الطريقة', 'FX rates': 'أسعار الصرف',
  'The register': 'السجل', 'Register an asset': 'تسجيل أصل', 'Run a month': 'ترحيل شهر',
  'Cash on the ledger': 'النقد في الدفتر', 'Unmatched lines': 'أسطر غير مطابَقة', 'Transfers waiting': 'تحويلات بالانتظار', 'Batches waiting': 'دفعات بالانتظار',
  'One chart, one balance': 'دليل واحد، رصيد واحد', 'Cash position': 'المركز النقدي', 'Transfers': 'التحويلات', 'Cheques': 'الصكوك', 'Payment batches': 'دفعات السداد',
  'Open an account': 'فتح حساب', 'Draft a transfer': 'إعداد تحويل', 'Write a cheque': 'تحرير صك', 'Build a batch': 'إعداد دفعة', 'Import a statement': 'استيراد كشف حساب',
  'Reconciliation': 'المطابقة', 'Unmatched statement lines': 'أسطر الكشف غير المطابَقة', 'Open journal lines': 'قيود اليومية المفتوحة',
  'Items': 'الأصناف', 'Below minimum': 'دون الحدّ الأدنى', 'Stock value': 'قيمة المخزون', 'Warehouses': 'المستودعات', 'A level is a sum': 'الرصيد مجموع', 'Levels': 'الأرصدة',
  'Move stock': 'حركة مخزون', 'Catalogue': 'الفهرس', 'Work orders open': 'أوامر عمل مفتوحة', 'Vehicles': 'المركبات', 'Rooms': 'القاعات', 'Incidents open': 'حوادث مفتوحة',
  'Work orders': 'أوامر العمل', 'Fleet': 'الأسطول', 'Rooms today': 'القاعات اليوم', 'Raise a work order': 'رفع أمر عمل', 'Book a room': 'حجز قاعة', 'Add a vehicle': 'إضافة مركبة',
  'Open tickets': 'تذاكر مفتوحة', 'Past SLA': 'تجاوزت اتفاقية الخدمة', 'Customer desk': 'مكتب العملاء', 'Tickets': 'التذاكر', 'Workplace incidents': 'حوادث مكان العمل',
  'Open a ticket': 'فتح تذكرة', 'Report an incident': 'الإبلاغ عن حادث',
  'Letters open': 'كتب مفتوحة', 'Committees': 'اللجان', 'Resolutions adopted': 'قرارات معتمدة', 'Correspondence register': 'سجل المراسلات',
  'Committees and resolutions': 'اللجان وقراراتها', 'Register a letter': 'تسجيل كتاب', 'Open cases': 'قضايا مفتوحة', 'Cases': 'القضايا', 'Open a case': 'فتح قضية',
  'Obligations pending': 'التزامات معلّقة', 'Licences': 'التراخيص', 'Expiring in 60 days': 'تنتهي خلال ٦٠ يومًا', 'Two clocks': 'ساعتان', 'Obligations': 'الالتزامات',
  'Licences and registrations': 'التراخيص والتسجيلات', 'Add an obligation': 'إضافة التزام', 'Add a licence': 'إضافة ترخيص',
  'Today': 'اليوم', 'Leave requests': 'طلبات الإجازة', 'Payslips': 'قسائم الراتب', 'Leave balances': 'أرصدة الإجازات', 'My requests': 'طلباتي', 'Overtime': 'العمل الإضافي',
  'Things I hold': 'ما بحوزتي', 'My tasks': 'مهامي', 'My tickets': 'تذاكري', 'Rooms I booked': 'قاعات حجزتها', 'Objectives': 'الأهداف', 'Certificates': 'الشهادات',
  'Policies to acknowledge': 'سياسات بانتظار إقراري', 'checked in': 'مسجَّل الحضور', 'not checked in': 'لم يسجَّل الحضور', 'since': 'منذ',
  'This login is not yet a person on the record': 'هذا الحساب ليس شخصًا في السجل بعد',
  'You do not have permission to see time rules.': 'ليست لديك صلاحية رؤية قواعد الوقت.',
  'You do not have permission to see compensation.': 'ليست لديك صلاحية رؤية التعويضات.',
  'You do not have permission to see the bank.': 'ليست لديك صلاحية رؤية المصرف.',
  'You do not have permission to see inventory.': 'ليست لديك صلاحية رؤية المخزون.',
  'You do not have permission to see the help desk.': 'ليست لديك صلاحية رؤية مكتب المساعدة.',
  'Nothing yet.': 'لا شيء بعد.', 'No active employees.': 'لا موظفين نشطين.', 'external': 'خارجي', 'low': 'منخفض', 'mo': 'شهر', 'years': 'سنة', 'days': 'يوم',
  'pending': 'معلّق', 'approved': 'موافَق عليه', 'rejected': 'مرفوض', 'draft': 'مسودّة', 'issued': 'صادر', 'paid': 'مدفوع', 'void': 'ملغى', 'open': 'مفتوح', 'closed': 'مغلق',
  'resolved': 'محلول', 'in progress': 'قيد التنفيذ', 'waiting': 'بالانتظار', 'done': 'منجز', 'cancelled': 'ملغى', 'executed': 'منفَّذ', 'released': 'مُطلَق',
  'matched': 'مطابَق', 'unmatched': 'غير مطابَق', 'overdue': 'متأخر', 'breached': 'متجاوَز', 'received': 'وارد', 'routed': 'محوَّل', 'answered': 'مجاب', 'drafted': 'مسودّة', 'sent': 'مرسَل',
  'proposed': 'مقترَح', 'adopted': 'معتمَد', 'settled': 'مسوّى', 'won': 'رابح', 'lost': 'خاسر', 'hearing': 'جلسة', 'active': 'نشط', 'disposed': 'مشطوب', 'renewed': 'مجدَّد', 'expired': 'منتهٍ',
  'promotion': 'ترقية', 'transfer': 'نقل', 'regrade': 'إعادة تدريج', 'demotion': 'تنزيل', 'acting': 'تكليف', 'under review': 'قيد المراجعة', 'dismissed': 'مصروف النظر عنه',
  'bank': 'مصرف', 'cashbox': 'صندوق', 'cash box': 'صندوق', 'safety': 'سلامة', 'quality': 'جودة', 'security': 'أمن', 'environment': 'بيئة', 'urgent': 'عاجل', 'high': 'مرتفع', 'normal': 'عادي',
  'it': 'تقنية', 'facilities': 'مرافق', 'hr': 'موارد بشرية', 'finance': 'مالية', 'other': 'أخرى', 'in': 'وارد', 'out': 'صادر', 'cleared': 'مصفّى', 'bounced': 'مرتجَع', 'presented': 'مقدَّم',
  'litigation': 'دعوى', 'arbitration': 'تحكيم', 'claim': 'مطالبة', 'regulatory': 'تنظيمي', 'labour': 'عمّالي', 'payroll': 'رواتب', 'ap': 'فواتير', 'health': 'صحة', 'life': 'حياة', 'pension': 'تقاعد', 'social': 'ضمان',
  'an expiring token renewed, or a revoked one noticed': 'رمز على وشك الانتهاء جُدِّد، أو ملغى لوحظ',
  'Nothing on this page is typed by anybody. It is a view over evidence the gate writes on every call, so a certification with no call behind it cannot exist — there is no table to put one in. "sandbox-verified" is a rung nothing can currently reach: this platform has no sandbox, and a tick there would be a claim rather than a reading.':
    'لا شيء في هذا الجدول يكتبه أحد. إنه عرض (view) فوق أدلة تكتبها البوابة عند كل نداء، فاعتمادٌ لا نداء خلفه لا يمكن أن يوجد — إذ لا يوجد جدول يُوضع فيه أصلًا. و"مُتحقَّق في بيئة اختبار" درجة لا يبلغها شيء حاليًا: لا بيئة اختبار في هذه المنصّة، وعلامةٌ هناك ستكون ادّعاءً لا قراءة.',
};

export function t(s) {
  if (lang !== 'ar' || s == null) return s;
  return AR[String(s).trim()] ?? s;
}

export const sectionName = (id, fallback) => (lang === 'ar' && SECTION_AR[id]) || fallback || id;
export const divisionName = (id, fallback) => (lang === 'ar' && DIV_AR[id]) || fallback || id;

/**
 * Translate a freshly rendered subtree. Exact, whole-string matches only, and
 * never inside code-like elements — a wrong swap in an ID or a hash is worse
 * than leaving a word in English.
 */
const SKIP = new Set(['CODE', 'PRE', 'KBD', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'TEXT']);
export function translateDom(root) {
  if (lang !== 'ar' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
        if (SKIP.has(el.tagName) || el.classList?.contains('mono') || el.dataset?.noI18n !== undefined) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const jobs = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const key = node.nodeValue.trim();
    const hit = AR[key];
    if (hit) jobs.push([node, node.nodeValue.replace(key, hit)]);
  }
  for (const [node, value] of jobs) node.nodeValue = value;
}

/** Apply the language to the document: direction, lang attribute, static text. */
export function applyLang() {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  const pal = document.getElementById('pal-input');
  if (pal) pal.placeholder = t('Jump to a department…');
}

export function setLang(next) {
  lang = next === 'ar' ? 'ar' : 'en';
  localStorage.setItem(KEY, lang);
  applyLang();
}
