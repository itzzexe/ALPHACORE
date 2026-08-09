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
};

// ---------- interface strings ----------
const AR = {
  // shell
  'Overview': 'الرئيسية',
  'Search departments, actions…': 'ابحث في الأقسام والإجراءات…',
  'Search  Ctrl+K': 'بحث · Ctrl+K',
  'Jump to a department…': 'انتقل إلى قسم…',
  navigate: 'تنقّل', open: 'فتح', close: 'إغلاق',
  'Sign in': 'تسجيل الدخول', Username: 'اسم المستخدم', Password: 'كلمة المرور',
  'Sign out': 'تسجيل الخروج', 'Signed in': 'مسجّل الدخول',
  'chain —': 'السلسلة —',
  '✎ auto-refresh paused': '✎ التحديث التلقائي متوقف',
  'Nothing found': 'لا نتائج',
  'After dark': 'الوضع الليلي', 'Back to daylight': 'العودة إلى النهار',
  // the way in
  'The company that runs itself': 'الشركة التي تدير نفسها',
  // the bar at the bottom of a phone
  'Departments': 'الأقسام', 'Search': 'بحث', 'Account': 'الحساب',
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
