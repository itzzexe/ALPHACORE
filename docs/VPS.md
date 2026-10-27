# AlphaCore على خادم VPS مع نموذج ذكاء اصطناعي محلي

<div dir="rtl">

هذا الدليل لخادم بمواصفات **2 vCPU · 8 GB RAM · 100 GB NVMe**. الهدف: الشركة كلها
ونموذجها اللغوي على خادم واحد، مجانًا، بلا مفاتيح API، ولا يغادر الخادمَ شيءٌ من بيانات الشركة.

## ما الذي يمكن توقّعه بصراحة

| النموذج | الحجم | السرعة على نواتين | الاستخدام |
|---|---|---|---|
| `qwen2.5:3b` | 1.9 GB | 8–12 رمز/ثانية | الفرز، الوسم، المحادثة، الإجابات القصيرة — عربية جيدة |
| `qwen2.5:7b` | 4.7 GB | 3–5 رموز/ثانية | الموجزات اليومية، التحليل، الكتابة العربية |
| `nomic-embed-text` | 0.3 GB | سريع | البحث بالمعنى |
| `qwen2.5:14b` | 9 GB | — | **لا يتّسع** في 8 GB بجانب المنصة |

- إجابة من 300 كلمة بنموذج 7B تأخذ قرابة دقيقة إلى دقيقتين. بنموذج 3B: 15–30 ثانية.
- نموذج 7B على معالج بلا GPU **ليس** بمستوى Claude أو GPT؛ هو جيد للمهام اليومية والتلخيص والتصنيف،
  وأضعف في البرمجة المعقّدة والاستدلال الطويل. لذلك تبقى المزوّدات المستضافة (إن أضفت مفاتيحها)
  **خلف** النموذج المحلي كاحتياط، ويُسجَّل في كل تشغيل أي نموذج أنجز العمل.
- سؤالان في الوقت نفسه أبطأ من سؤال ثم سؤال؛ لذلك يعمل النموذج على طلب واحد في كل مرة بطابور.

## التثبيت (أمر واحد)

```bash
# بدون نطاق: الوصول عبر نفق SSH فقط (الأكثر أمانًا)
curl -fsSL https://raw.githubusercontent.com/itzzexe/ALPHACORE/main/app/deploy/vps/install.sh -o install.sh
sudo bash install.sh

# مع نطاق يشير إلى الخادم: HTTPS تلقائي عبر Caddy
sudo DOMAIN=ops.example.com bash install.sh
```

السكربت يضيف ذاكرة تبديل 4 GB، ويثبّت Node 22 فقط. **لا يُثبَّت أي برنامج آخر**: AlphaCore نفسه
ينزّل محرّك llama.cpp المناسب للخادم ونموذج `qwen2.5-3b` ونموذج البحث، ويشغّلها ويراقبها بنفسه
على 127.0.0.1. ثم يشغّل AlphaCore كخدمة مع تفعيل «المحلي أولًا»، ويفعّل جدار حماية لا يفتح إلا SSH
(و80/443 مع النطاق). منافذ النموذج لا تُفتح أبدًا.

إن أردت Ollama بدلًا من المحرّك المدمج: `sudo RUNTIME=ollama bash install.sh`.

## كيف يتعلّم (صفحة «العمل ← التعلّم»)

- **لا يُعاد تدريب النموذج** — على نواتين يستغرق ذلك أيامًا ولا يمكن التراجع عنه.
- **الدروس:** كل أمر شراء رفضته، وكل توقّع يتكرّر خطؤه، وكل إجابة خرجت عن صيغتها، تصبح درسًا
  يقرؤه الموظف قبل كل عمل مشابه.
- **التصحيح:** زر «صحّح هذا» تحت الموجزات وإجابات المشغّل: تصحيحك يدخل دليل عمل الموظف مباشرة،
  ويمكن أن يصبح «حارسًا» يوقف الخطأ نفسه قبل أن يصلك.
- **التعلّم من الويب:** يقرأ ليلًا عن مواضيع الشركة (ويكيبيديا بلا مفتاح)، ويكتب ملاحظات بمصادرها
  ودرجة ثقة؛ الموثوقة تصبح معرفة، والباقي ينتظر موافقتك.
- **الترقية الذاتية:** إن فعّلتها، يُخضع النماذج المثبّتة لاختبار ثابت من عشرة أسئلة أسبوعيًا، ولا
  يبدّل النموذج إلا إذا تفوّق البديل، مع زر للتراجع.

في النهاية يطبع كلمة مرور الدخول الأولى (`owner`) — تظهر مرة واحدة.

## بعد التثبيت

1. **العمل ← الذكاء المحلي**: اضغط «اختبار الأداء» على كل نموذج لترى السرعة الحقيقية على خادمك.
2. **الأسواق ← مكتب الأسواق**: «انتقل إلى الأسعار الحيّة» (Yahoo Finance بلا مفتاح، أو مفتاح مجاني
   من Twelve Data / Finnhub).
3. **الأسواق ← غرفة الأخبار**: «شغّل خلاصات الأخبار».
4. **الأسواق ← المحفظة**: المحفظة ورقية افتراضيًا بـ 100,000$. لربط وسيط حقيقي: حساب Alpaca
   (بيئته الورقية افتراضيًا). الأموال الحقيقية تحتاج كتابة `REAL MONEY` وكلمة المرور، وكل أمر
   يحتاج موافقة إنسان.

## ما الذي «يتحكم» فيه النموذج المحلي، وما الذي لا يتحكم فيه

- مع «المحلي أولًا» يمرّ **كل** عمل الموظفين الآليين (التحليل، الموجزات، المراجعات، الطلبات)
  على النموذج المحلي أولًا.
- «المشغّل المحلي» يقرأ حال الشركة ويجيب ويقترح طلبات — **أنت** من يقدّمها.
- لا شيء يُرسَل للعالم، ولا مال يُنفَق، ولا أمر شراء يُنفَّذ دون موافقة إنسان. هذه قاعدة المنصة،
  وليست إعدادًا يمكن للنموذج تغييره.
- توقّعات الأسعار إحصائية مع نطاقات وسجلّ دقة حقيقي على بياناتك؛ ليست نصيحة مالية مرخّصة.

</div>

---

## In English

For a **2 vCPU / 8 GB / 100 GB NVMe** server: the whole company and its own language
model on one machine, free to run, no API keys, and no company data leaving it.

**One command:** `sudo bash app/deploy/vps/install.sh` (add `DOMAIN=ops.example.com` for
HTTPS through Caddy). It adds 4 GB of swap and installs Node 22 — nothing else. AlphaCore
then downloads llama.cpp for the machine plus `qwen2.5-3b-instruct` and an embedding model
(`scripts/engine-setup.mjs`), and runs them itself on 127.0.0.1: one model in memory,
restarted if it crashes, stopped with AlphaCore. Local-first is on and the firewall admits
only SSH (and 80/443 with a domain). `RUNTIME=ollama` installs Ollama instead.

**Learning** (Work → Learning) does not retrain the model. Mistakes become lessons every
employee recalls; a person's correction goes into the playbook and can become a guard that
stops the same mistake at a person; a nightly loop reads Wikipedia (and a search engine if
configured) about the company's topics; and, when a person allows it, a newer installed model
replaces the current one only after scoring better on a fixed ten-question exam.

**What to expect:** a 3B model answers in seconds, a 7B one in tens of seconds; neither
is a frontier model. Hosted providers, if you add keys, stay behind the local one as a
fallback, and every run records which model actually served it.

**Tuning knobs** (Local AI page, or `.env`): `LOCAL_NUM_CTX` (4096), `LOCAL_NUM_THREAD`
(2), `LOCAL_KEEP_ALIVE` (30m), `LOCAL_CONCURRENCY` (1), `LOCAL_MODEL_T1/T2/T3/TL`.

**If AlphaCore runs elsewhere** and only the model is on the VPS, do not open port
11434 to the internet: reach it through `ssh -L 11434:127.0.0.1:11434` or WireGuard and
set `OLLAMA_BASE_URL` to the tunnel. The Local AI page flags a public address in red.
