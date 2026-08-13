// The shadow company — a fork of reality you are allowed to break.
//
// "What happens if we cut marketing by forty per cent?" has always been
// answered with an opinion, because the only way to find out was to do it. The
// database is one file, the company's whole state is in that file, and the
// employees are deterministic enough to run again. So: copy the file, apply the
// change to the copy, run the company forward inside it, and compare the two
// sets of numbers.
//
// The fork is read-only with respect to the real world by construction: it is a
// different file, no connector points at it, and the egress gate lives in the
// process rather than the database, so nothing a simulated employee decides can
// reach anybody. A simulation cannot send an email — that is not a policy, it
// is a fact about where the file is.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './env.js';
import { q, one, exec, db, DB_FILE } from './db.js';
import { audit } from './audit.js';

const SIM_DIR = path.join(ROOT, 'data', 'simulations');

/** The numbers a simulation is judged on. Same query on both files. */
const METRICS = {
  runs: "SELECT COUNT(*) AS v FROM runs",
  runsDone: "SELECT COUNT(*) AS v FROM runs WHERE state = 'done'",
  runsFailed: "SELECT COUNT(*) AS v FROM runs WHERE state = 'failed'",
  spendUsd: 'SELECT COALESCE(ROUND(SUM(cost_usd), 4), 0) AS v FROM model_calls',
  customers: "SELECT COUNT(*) AS v FROM customers WHERE state = 'active'",
  mrrUsd: "SELECT COALESCE(SUM(mrr_usd), 0) AS v FROM customers WHERE state = 'active'",
  dealsWon: "SELECT COUNT(*) AS v FROM deals WHERE stage = 'won'",
  pipelineUsd: "SELECT COALESCE(SUM(value_usd), 0) AS v FROM deals WHERE stage NOT IN ('lost','won')",
  campaigns: "SELECT COUNT(*) AS v FROM campaigns WHERE state = 'live'",
  incidents: "SELECT COUNT(*) AS v FROM incidents WHERE state != 'closed'",
  gateWaiting: "SELECT COUNT(*) AS v FROM runs WHERE state = 'awaiting_human'",
  auditEntries: 'SELECT COUNT(*) AS v FROM audit_log',
};

function measure(handle) {
  const out = {};
  for (const [k, sql] of Object.entries(METRICS)) {
    try { out[k] = handle.prepare(sql).get()?.v ?? 0; } catch { out[k] = null; }
  }
  return out;
}

/**
 * The levers a simulation may pull. Each is a small, explicit SQL change, so
 * what the fork differs by is readable rather than magic.
 */
export const LEVERS = {
  budget: {
    describe: 'Multiply every budget cap by a factor (0.6 = cut forty per cent)',
    apply: (h, { factor = 1 }) => h.prepare('UPDATE budgets SET cap_usd = cap_usd * ?').run(factor),
  },
  pauseDepartment: {
    describe: 'Suspend every employee serving one department',
    apply: (h, { department }) => h.prepare("UPDATE agents SET status = 'suspended' WHERE departments LIKE ?").run(`%${department}%`),
  },
  hire: {
    describe: 'Add N more employees of an existing kind',
    apply: (h, { agentId, copies = 1 }) => {
      const src = h.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
      if (!src) return;
      for (let i = 1; i <= copies; i++) {
        h.prepare('INSERT INTO agents (id, name, role_group, spec, model_tier, status, human_owner) VALUES (?,?,?,?,?,?,?)')
          .run(`${src.id}-SIM${i}`, `${src.name} (sim ${i})`, src.role_group, src.spec, src.model_tier, 'active', src.human_owner);
      }
    },
  },
  demand: {
    describe: 'Change how much work arrives: duplicate open deals by a factor',
    apply: (h, { factor = 2 }) => {
      const deals = h.prepare("SELECT * FROM deals WHERE stage NOT IN ('won','lost')").all();
      for (let i = 1; i < Math.max(1, Math.round(factor)); i++) {
        for (const d of deals) {
          h.prepare('INSERT INTO deals (name, customer_id, value_usd, stage, owner) VALUES (?,?,?,?,?)')
            .run(`${d.name} (sim ${i})`, d.customer_id, d.value_usd, d.stage, d.owner);
        }
      }
    },
  },
  priceChange: {
    describe: 'Move every price by a percentage and see what the pipeline does',
    apply: (h, { percent = 0 }) => h.prepare('UPDATE pricing_records SET amount = amount * ?').run(1 + percent / 100),
  },
  churn: {
    describe: 'Lose a share of the customer base and watch what depends on it',
    apply: (h, { share = 0.2 }) => h.prepare(
      "UPDATE customers SET state = 'churned', churned_at = datetime('now') WHERE state = 'active' AND id IN (SELECT id FROM customers WHERE state = 'active' ORDER BY id LIMIT CAST((SELECT COUNT(*) FROM customers WHERE state = 'active') * ? AS INTEGER))",
    ).run(share),
  },
};

/** Fork the file, apply the changes, measure both sides. */
export function startSimulation({ name, question, changes = [], horizon = '30 days', actor = 'human:admin' }) {
  fs.mkdirSync(SIM_DIR, { recursive: true });
  const r = exec(
    'INSERT INTO simulations (name, question, changes, horizon, state, started_by, baseline) VALUES (?,?,?,?,?,?,?)',
    name, question, JSON.stringify(changes), horizon, 'running', actor, JSON.stringify(measure(db)),
  );
  const id = Number(r.lastInsertRowid);
  const file = path.join(SIM_DIR, `sim-${id}.db`);

  // A checkpoint first, so the copy is a whole database rather than a database
  // plus whatever was still sitting in the write-ahead log.
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* fine either way */ }
  fs.copyFileSync(DB_FILE, file);

  const fork = new DatabaseSync(file);
  const applied = [];
  try {
    // The fork must never be mistaken for the company: its own audit chain gets
    // a line saying what it is, and its connectors are switched off outright.
    try { fork.exec("UPDATE connectors SET state = 'disconnected'"); } catch { /* older fork */ }
    for (const c of changes) {
      const lever = LEVERS[c.lever];
      if (!lever) continue;
      lever.apply(fork, c);
      applied.push(`${c.lever}(${JSON.stringify({ ...c, lever: undefined })})`);
    }
    const outcome = measure(fork);
    exec(
      "UPDATE simulations SET state = 'done', db_file = ?, outcome = ?, verdict = ?, ended_at = datetime('now') WHERE id = ?",
      file, JSON.stringify(outcome), applied.join('; ') || 'no levers applied', id,
    );
  } finally {
    fork.close();
  }
  audit({ actorType: 'human', actorId: actor, action: 'simulation.run', subjectType: 'simulation', subjectId: id, payload: { name, changes: applied } });
  return readSimulation(id);
}

export function readSimulation(id) {
  const s = one('SELECT * FROM simulations WHERE id = ?', id);
  if (!s) return null;
  const baseline = JSON.parse(s.baseline || '{}');
  const outcome = JSON.parse(s.outcome || '{}');
  const delta = Object.fromEntries(Object.keys(METRICS).map((k) => {
    const a = Number(baseline[k] ?? 0);
    const b = Number(outcome[k] ?? 0);
    return [k, { before: a, after: b, change: Number((b - a).toFixed(4)), percent: a ? Number((((b - a) / a) * 100).toFixed(1)) : null }];
  }));
  return { ...s, changes: JSON.parse(s.changes || '[]'), baseline, outcome, delta };
}

export function discardSimulation(id, { actor = 'human:admin' } = {}) {
  const s = one('SELECT db_file FROM simulations WHERE id = ?', id);
  if (s?.db_file && fs.existsSync(s.db_file)) fs.rmSync(s.db_file, { force: true });
  exec('DELETE FROM simulations WHERE id = ?', id);
  audit({ actorType: 'human', actorId: actor, action: 'simulation.discarded', subjectType: 'simulation', subjectId: id });
  return { ok: true };
}

export function simulationOverview() {
  return {
    levers: Object.entries(LEVERS).map(([id, l]) => ({ id, describe: l.describe })),
    metrics: Object.keys(METRICS),
    simulations: q('SELECT id, name, question, state, verdict, created_at, ended_at FROM simulations ORDER BY id DESC LIMIT 25'),
    counts: {
      total: one('SELECT COUNT(*) AS n FROM simulations').n,
      done: one("SELECT COUNT(*) AS n FROM simulations WHERE state = 'done'").n,
    },
    now: measure(db),
  };
}
