// The local model's exam — ten short tasks, graded by code.
//
// A model upgrade is only an upgrade if it does this company's work better,
// and "it felt smarter in a chat" is how a worse model gets promoted. So the
// candidate and the incumbent sit the same exam: JSON that parses, numbers
// that add up, Arabic answered in Arabic, an extraction with every field
// right, and one question it must admit it cannot answer. Every check is a
// line of code, so the same answer always gets the same mark.
import { call as ollamaCall, ollamaBase } from './providers/ollama.js';
import { call as engineCall } from './providers/engine.js';
import { chatBase } from './engine.js';
import { parseAgentJson } from './router.js';
import { providersConfig } from './env.js';

const AR = /[؀-ۿ]/;

export const EXAM = [
  { id: 'json-sum', prompt: 'What is 17 + 25? Output JSON: {"sum": 0}', check: (j) => Number(j?.sum) === 42 },
  { id: 'arabic', prompt: 'أجب بالعربية فقط. ما عاصمة العراق؟ Output JSON: {"answer": ""}', check: (j) => AR.test(j?.answer || '') && /بغداد/.test(j?.answer || '') },
  {
    id: 'extract',
    prompt: 'Extract the fields from: "Invoice 4471 from Acme Ltd, total 1,250.50 USD, due 2026-11-30". Output JSON: {"invoice": "", "vendor": "", "total": 0, "due": ""}',
    check: (j) => String(j?.invoice).includes('4471') && /acme/i.test(j?.vendor || '') && Math.abs(Number(String(j?.total).replace(/,/g, '')) - 1250.5) < 0.01 && j?.due === '2026-11-30',
  },
  { id: 'tone', prompt: 'Is the tone of this headline positive, negative or neutral? "Shares plunged after the company missed estimates and cut its outlook." Output JSON: {"tone": ""}', check: (j) => /negative/i.test(j?.tone || '') },
  { id: 'portfolio', prompt: 'A portfolio holds 10 shares at 230 and 5 shares at 120. What is it worth in total? Output JSON: {"total": 0}', check: (j) => Number(j?.total) === 2900 },
  {
    id: 'no-invention',
    prompt: 'What was the closing price of AAPL yesterday? You have been given no market data. Output JSON: {"answer": "", "known": true}',
    check: (j) => j?.known === false || j?.known === 'false',
  },
  { id: 'count', prompt: 'List exactly three primary colours of light. Output JSON: {"items": []}', check: (j) => Array.isArray(j?.items) && j.items.length === 3 },
  {
    id: 'arabic-summary',
    prompt: 'لخّص في جملة عربية واحدة قصيرة: «ارتفعت أسهم الشركة بعد إعلان أرباح فاقت التوقعات، لكن المحللين حذّروا من تباطؤ المبيعات في الربع القادم.» Output JSON: {"summary": ""}',
    check: (j) => AR.test(j?.summary || '') && String(j?.summary || '').length < 220,
  },
  { id: 'translate', prompt: 'Translate the single English word "invoice" into Arabic. Output JSON: {"arabic": ""}', check: (j) => /فاتور/.test(j?.arabic || '') },
  { id: 'dates', prompt: 'If today is 2026-10-23, what is the date ten days later? Output JSON: {"date": "YYYY-MM-DD"}', check: (j) => j?.date === '2026-11-02' },
];

/**
 * Sit the exam on one runtime and model. For the engine, the model is
 * whatever it has loaded; the caller switches it first.
 */
export async function sitExam({ runtime, model }) {
  const results = [];
  const speeds = [];
  for (const task of EXAM) {
    const t0 = Date.now();
    try {
      const r = runtime === 'engine'
        ? await engineCall({ baseUrl: chatBase(), system: 'You are precise. Answer with the JSON asked for and nothing else.', prompt: task.prompt, maxTokens: 200 })
        : await ollamaCall({ baseUrl: ollamaBase(providersConfig.providers?.ollama?.baseUrl), model, system: 'You are precise. Answer with the JSON asked for and nothing else.', prompt: task.prompt, maxTokens: 200 });
      const j = parseAgentJson(r.text);
      let pass = false;
      try { pass = Boolean(task.check(j)); } catch { pass = false; }
      results.push({ id: task.id, pass, ms: Date.now() - t0, answer: String(r.text).slice(0, 200) });
      if (r.local?.tokensPerSec) speeds.push(r.local.tokensPerSec);
    } catch (e) {
      results.push({ id: task.id, pass: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 160) });
    }
  }
  const passed = results.filter((x) => x.pass).length;
  return {
    passed, total: EXAM.length, score: Math.round((passed / EXAM.length) * 1000) / 1000,
    tokPerSec: speeds.length ? Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10 : null,
    results,
  };
}
