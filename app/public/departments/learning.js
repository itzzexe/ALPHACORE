// What the company learned: lessons from its own mistakes, the corrections
// people made, the rules that stop a repeat, what it read on the web, and
// whether a newer model earned its place.
//
// Every row here can be undone from here. A lesson is retracted, a guard
// switched off, a note rejected, an upgrade rolled back — learning that
// cannot be reversed is not something a company should let a model do.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t } from '/i18n.js';
import { kpi, act, wireActs, ago } from '../components/ui.js';

const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A button that lets a person say "this answer was wrong". Wired by wireCorrections. */
export const correctButton = (subjectType, subjectId) => (hasPermC('learning.manage') && subjectId
  ? `<button type="button" class="btn btn-sm btn-ghost" data-correct="${esc(subjectType)}:${esc(subjectId)}">${esc(t('Correct this'))}</button>` : '');

export function wireCorrections(root, rerender) {
  root.querySelectorAll('[data-correct]').forEach((b) => b.addEventListener('click', async () => {
    const [subjectType, subjectId] = b.dataset.correct.split(':');
    const correction = window.prompt(t('What was wrong, and what is right? The employee reads this before every similar task from now on.'));
    if (!correction || !correction.trim()) return;
    const phrase = window.prompt(t('Optional: a word or phrase that must never appear in its answers again (leave empty to skip).'));
    try {
      await api('/api/learning/correct', { method: 'POST', body: { subjectType, subjectId, correction, guard: phrase && phrase.trim() ? { kind: 'must_not', pattern: reEscape(phrase.trim()) } : null } });
      toast(t('Learned — it goes into the playbook now'));
      rerender?.();
    } catch (e) { toast(e.message, true); }
  }));
}

const verChip = (v) => `<span class="chip ${v === 'verified' ? 'chip-ok' : 'chip-dim'}">${esc(t(v))}</span>`;
const SRC_LABEL = {
  'learn:order': 'rejected order', 'learn:forecast': 'missed forecast', 'learn:range': 'ranges too narrow',
  'learn:schema': 'broken format', 'learn:guard': 'stopped by a guard', 'learn:correction': 'a person corrected it', reflection: 'reflection',
};

export async function renderLearning() {
  const d = await api('/api/learning');
  const c = d.counts;
  const canManage = hasPermC('learning.manage');
  const canUpgrade = hasPermC('learning.upgrade');
  const canArm = hasPermC('connectors.manage');
  const up = d.upgrade;
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('The model is not retrained — on two CPU cores that would take days and could not be undone. Instead every mistake becomes a lesson every employee recalls before similar work, a person’s correction goes straight into the playbook, guards stop a known mistake before anyone uses the answer, the web is read about the company’s own topics, and a newer model replaces the current one only after it scores better on a fixed exam.'))}</p>
  </div>
  <div class="kpis">
    ${kpi('Lessons', c.lessons, `${c.fromMistakes} ${esc(t('from mistakes'))} · ${c.verified} ${esc(t('verified'))}`)}
    ${kpi('Recalled this week', c.recalled, esc(t('times a lesson or a note was put in front of an employee')), c.recalled ? 'ai' : '')}
    ${kpi('Guards', c.guards, `${c.caught} ${esc(t('repeats caught'))}`, c.caught ? 'ok' : '')}
    ${kpi('Learned from the web', c.knowledge, `${c.waiting} ${esc(t('waiting for a person'))}`, c.waiting ? 'human' : '')}
    ${kpi('Local model', esc(up.incumbent.model || '—'), esc(t(up.auto ? 'self-upgrade on' : 'self-upgrade off')))}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Lessons'))}</div>
    ${d.lessons.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Employee'))}</th><th>${esc(t('Lesson'))}</th><th>${esc(t('From'))}</th><th>${esc(t('Used'))}</th><th></th></tr></thead><tbody>
      ${d.lessons.map((l) => `<tr><td class="ltr">${esc(l.agent_id || t('everyone'))}</td><td>${esc(l.body)}<div class="sub">${ago(l.created_at)}</div></td>
        <td>${esc(t(SRC_LABEL[l.source_type] || l.source_type || '—'))} ${verChip(l.verification)}</td><td>${l.used}</td>
        <td class="inline">${canManage && l.verification !== 'verified' ? act(`/api/learning/lesson/${l.id}/verify`, 'Verify', { cls: 'btn-sm', done: 'Into the playbook' }) : ''}
          ${canManage ? act(`/api/learning/lesson/${l.id}/retract`, 'Retract', { cls: 'btn-sm btn-ghost', confirm: 'Forget this lesson?' }) : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${esc(t('No lessons yet. They appear when an order is turned down, a forecast keeps missing, an answer breaks its format, or you correct something.'))}</div>`}
  </div>

  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Guards'))}</div>
      <p class="hint">${esc(t('Checked on every answer before anyone uses it. When one trips, the work stops at a person with the reason, and the employee is told what it was stopped for.'))}</p>
      ${d.guards.length ? `<table class="tbl"><tbody>${d.guards.map((g) => `<tr class="${g.state === 'off' ? 'muted' : ''}">
        <td><b>${esc(t(g.kind === 'must' ? 'must contain' : 'must never contain'))}</b> <code class="ltr">${esc(g.pattern.length > 60 ? `${g.pattern.slice(0, 60)}…` : g.pattern)}</code>
          <div class="sub">${esc(g.why)} · ${esc(g.agent_id || t('everyone'))}</div></td>
        <td>${g.hits} ${esc(t('caught'))}${g.last_hit ? `<div class="sub">${ago(g.last_hit)}</div>` : ''}</td>
        <td>${canManage ? act(`/api/learning/guard/${g.id}/state`, g.state === 'active' ? 'Turn off' : 'Turn on', { body: { state: g.state === 'active' ? 'off' : 'active' }, cls: 'btn-sm btn-ghost' }) : ''}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('No guards.'))}</div>`}
      ${canManage ? `<form id="lg-guard" class="fields" style="margin-top:10px">
        <div><label class="fl" for="lg-g-agent">${esc(t('Employee'))}</label><select id="lg-g-agent"><option value="">${esc(t('everyone'))}</option>${d.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
        <div><label class="fl" for="lg-g-kind">${esc(t('Rule'))}</label><select id="lg-g-kind"><option value="must_not">${esc(t('must never contain'))}</option><option value="must">${esc(t('must contain'))}</option></select></div>
        <div class="wide"><label class="fl" for="lg-g-pat">${esc(t('Words or a regular expression'))}</label><input id="lg-g-pat" required maxlength="300" class="ltr"></div>
        <div class="wide"><label class="fl" for="lg-g-why">${esc(t('Why'))}</label><input id="lg-g-why" required maxlength="300"></div>
        <div class="wide"><button class="btn" type="submit">${esc(t('Add guard'))}</button></div>
      </form>` : ''}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(t('The model, and whether a newer one is better'))}</div>
      <div class="kv"><span>${esc(t('Serving now'))}</span><b class="ltr">${esc(up.incumbent.model || '—')} · ${esc(up.incumbent.runtime)}</b></div>
      <div class="kv"><span>${esc(t('Self-upgrade'))}</span><b>${esc(t(up.auto ? 'on' : 'off'))}${up.by ? ` · ${esc(up.by.replace('human:', ''))}` : ''}</b></div>
      <p class="hint">${esc(t('Once a week at night it sits the installed alternatives through the same ten-question exam as the current model, and switches only if one scores higher — or the same, a fifth faster. Downloading a new model stays a person’s act.'))}</p>
      ${canUpgrade ? `<form id="lg-auto" class="fields">
        <div class="wide"><label class="eng-chk"><input type="checkbox" id="lg-auto-on" ${up.auto ? 'checked' : ''}> ${esc(t('Let it upgrade itself'))}</label></div>
        <div class="wide"><label class="fl" for="lg-cands">${esc(t('Candidates on Ollama (comma separated)'))}</label><input id="lg-cands" class="ltr" value="${esc(up.candidates.join(', '))}" placeholder="qwen3:4b, gemma3:4b"></div>
        <div class="wide inline"><button class="btn" type="submit">${esc(t('Save'))}</button>
          ${act('/api/learning/exam', 'Examine the current model', { cls: 'btn-sm', done: 'Examined' })}
          ${act('/api/learning/upgrade/check', 'Try the candidates now', { cls: 'btn-sm', done: 'Done — see the history' })}</div>
      </form>` : ''}
      ${up.evals.length ? `<div class="fl" style="margin-top:12px">${esc(t('Exams'))}</div><table class="tbl"><tbody>${up.evals.map((e) => `<tr><td class="ltr">${esc(e.model)}</td><td>${e.passed}/${e.total}</td><td class="sub">${e.tok_per_sec ? `${e.tok_per_sec} tok/s` : ''}</td><td class="sub">${esc(t(e.purpose))} · ${ago(e.created_at)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${up.history.length ? `<div class="fl" style="margin-top:12px">${esc(t('Changes'))}</div><table class="tbl"><tbody>${up.history.map((h) => `<tr><td class="ltr">${esc(h.from_model || '—')} → ${esc(h.to_model)}</td>
        <td><span class="chip ${h.state === 'promoted' ? 'chip-ok' : ''}">${esc(t(h.state.replace('_', ' ')))}</span><div class="sub">${esc(h.why || '')}</div></td>
        <td>${canUpgrade && h.state === 'promoted' ? act(`/api/learning/upgrade/${h.id}/rollback`, 'Roll back', { cls: 'btn-sm btn-ghost', confirm: 'Go back to the previous model?' }) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Learning from the web'))} <span class="chip ${d.web.live ? 'chip-ok' : 'chip-warn'}">${esc(t(d.web.live ? 'reading' : 'not reading'))}</span>
      ${canArm ? act(d.web.live ? '/api/learning/web/off' : '/api/learning/web/on', d.web.live ? 'Stop reading the web' : 'Start reading the web', { cls: d.web.live ? 'btn-sm btn-ghost' : 'btn-sm btn-primary' }) : ''}</div>
    <p class="hint">${esc(t('One topic every few minutes: Wikipedia first, then a search engine if one is configured, robots.txt asked, at most three sources, anything carrying injected instructions left out. The researcher writes a note with its sources; a note from trusted sources the writer was sure of becomes knowledge, the rest waits for you.'))}</p>
    ${d.notes.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Topic'))}</th><th>${esc(t('Note'))}</th><th>${esc(t('Trust'))}</th><th>${esc(t('State'))}</th><th></th></tr></thead><tbody>
      ${d.notes.map((n) => `<tr><td>${esc(n.topic || '—')}<div class="sub">${ago(n.created_at)}</div></td>
        <td>${esc(n.summary || '')}${n.claims.length ? `<ul class="mk-ideas">${n.claims.slice(0, 4).map((cl) => `<li>${esc(cl.claim)} <span class="sub">[${esc(n.sources[Number(cl.source) - 1]?.domain || '?')}]</span></li>`).join('')}</ul>` : ''}
          <div class="sub">${n.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.domain)}</a>`).join(' · ')}${n.flagged ? ` · ${n.flagged} ${esc(t('left out for injected instructions'))}` : ''}</div></td>
        <td>${n.trust != null ? `${Math.round(n.trust * 100)}%` : '—'}</td><td><span class="chip">${esc(t(n.state))}</span></td>
        <td class="inline">${canManage && n.state === 'pending' ? act(`/api/learning/note/${n.id}/accept`, 'Accept', { cls: 'btn-sm' }) : ''}
          ${canManage && ['pending', 'accepted'].includes(n.state) ? act(`/api/learning/note/${n.id}/reject`, 'Reject', { cls: 'btn-sm btn-ghost' }) : ''}
          ${correctButton('learn_note', n.run_id ? n.id : null)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${esc(t('Nothing read yet.'))}</div>`}
    <div class="fl" style="margin-top:12px">${esc(t('Topics'))}</div>
    ${d.topics.length ? `<table class="tbl"><tbody>${d.topics.map((tp) => `<tr class="${tp.enabled ? '' : 'muted'}"><td>${esc(tp.topic)} <span class="sub">${esc(t(tp.source))} · ${esc(tp.lang)}</span></td>
      <td class="sub">${tp.notes} ${esc(t('notes'))} · ${tp.last_run ? ago(tp.last_run) : esc(t('never'))}</td>
      <td class="inline">${canManage ? `${act(`/api/learning/topic/${tp.id}/toggle`, tp.enabled ? 'Turn off' : 'Turn on', { body: { enabled: !tp.enabled }, cls: 'btn-sm btn-ghost' })}
        ${d.web.live ? act(`/api/learning/topic/${tp.id}/research`, 'Read now', { cls: 'btn-sm', done: 'Read — the note is being written' }) : ''}` : ''}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('No topics. The companies on the watchlist are added when web reading starts.'))}</div>`}
    ${canManage ? `<form id="lg-topic" class="form-inline" style="margin-top:10px"><label class="fl" for="lg-t">${esc(t('Add a topic'))}</label>
      <input id="lg-t" required maxlength="160"><button class="btn" type="submit">${esc(t('Add'))}</button></form>` : ''}
  </div>`;

  wireActs(view, api, toast, renderLearning);
  wireCorrections(view, renderLearning);
  $('#lg-guard')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/learning/guard', { method: 'POST', body: { agentId: $('#lg-g-agent').value || null, kind: $('#lg-g-kind').value, pattern: $('#lg-g-pat').value, why: $('#lg-g-why').value } }); renderLearning(); } catch (err) { toast(err.message, true); }
  });
  $('#lg-topic')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/learning/topic', { method: 'POST', body: { topic: $('#lg-t').value } }); renderLearning(); } catch (err) { toast(err.message, true); }
  });
  $('#lg-auto')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/learning/upgrade/auto', { method: 'POST', body: { enabled: $('#lg-auto-on').checked, candidates: $('#lg-cands').value.split(',').map((x) => x.trim()).filter(Boolean) } });
      toast(t('Saved')); renderLearning();
    } catch (err) { toast(err.message, true); }
  });
}
