// Data layer — SQLite via node:sqlite, schema per Part 3 §4.1 (Postgres is the
// production target per ADR-002; SQLite is the dev-mode spine, recorded here as
// ADR-007: same tables, one file, zero setup. Migration is a schema copy).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';

const dataDir = path.join(ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'crucible.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role_group  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  spec        TEXT NOT NULL,             -- JSON: compact role spec
  model_tier  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',  -- active|suspended|retired
  human_owner TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decisions (
  id              TEXT PRIMARY KEY,      -- DR-2026-001
  title           TEXT NOT NULL,
  tier            TEXT NOT NULL CHECK (tier IN ('T0','T1','T2','T3')),
  status          TEXT NOT NULL DEFAULT 'open',
  owner_human     TEXT NOT NULL,
  context         TEXT,
  deadline        TEXT,
  outcome         TEXT,                  -- JSON
  consensus_score REAL,
  confidence      REAL,
  conditions      TEXT,                  -- JSON array
  dissent         TEXT,                  -- JSON array (preserved verbatim)
  expires_at      TEXT,
  reopen_triggers TEXT,
  decided_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decision_evidence (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id  TEXT NOT NULL REFERENCES decisions(id),
  claim        TEXT NOT NULL,
  source_ref   TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'unverified'
               CHECK (verification IN ('unverified','verified','expired')),
  expires_at   TEXT,
  added_by     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tribunal_rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  round       INTEGER NOT NULL,
  role        TEXT NOT NULL,             -- advocate|critic|judge
  label       TEXT NOT NULL,             -- e.g. critic:security
  output      TEXT NOT NULL,             -- JSON
  cost_usd    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,       -- uuid
  agent_id       TEXT NOT NULL REFERENCES agents(id),
  parent_run_id  TEXT,
  decision_id    TEXT,
  task_type      TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT 'queued',
                 -- queued|leased|running|awaiting_human|done|failed|escalated|cancelled
  input          TEXT,                   -- JSON
  output         TEXT,                   -- JSON
  flags          TEXT,                   -- JSON array: degraded-tier, subscription-served, ...
  tokens_in      INTEGER NOT NULL DEFAULT 0,
  tokens_out     INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  attempts       INTEGER NOT NULL DEFAULT 0,
  lease_until    TEXT,
  failure_reason TEXT,
  ended_at       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipelines (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  template     TEXT NOT NULL,
  goal         TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'running',
               -- running|awaiting_human|done|failed|cancelled
  current_step INTEGER NOT NULL DEFAULT 0,
  steps        TEXT NOT NULL,             -- JSON [{agentId,title,prompt,runId,state}]
  workspace    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT
);

CREATE TABLE IF NOT EXISTS dead_letter (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd   REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  ok         INTEGER NOT NULL DEFAULT 1,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope        TEXT NOT NULL CHECK (scope IN ('company','governance','agent','decision')),
  scope_id     TEXT NOT NULL,
  period_key   TEXT NOT NULL,            -- YYYY-MM-DD (daily) | YYYY-MM (monthly) | 'case'
  cap_usd      REAL NOT NULL,
  spent_usd    REAL NOT NULL DEFAULT 0,
  reserved_usd REAL NOT NULL DEFAULT 0,
  hard_stop    INTEGER NOT NULL DEFAULT 1,
  frozen       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scope, scope_id, period_key)
);

CREATE TABLE IF NOT EXISTS approvals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  gate           TEXT NOT NULL,
  approver_human TEXT NOT NULL,
  verdict        TEXT NOT NULL CHECK (verdict IN ('approved','rejected')),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  layer          TEXT NOT NULL CHECK (layer IN ('task','project','product','org','decision','policy','lesson')),
  classification TEXT NOT NULL DEFAULT 'internal',
  verification   TEXT NOT NULL DEFAULT 'unverified'
                 CHECK (verification IN ('unverified','verified','expired','retracted')),
  content        TEXT NOT NULL,
  source_ref     TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  superseded_by  INTEGER,
  expires_at     TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,            -- slug
  name        TEXT NOT NULL,
  description TEXT,
  stage       INTEGER NOT NULL DEFAULT 1,  -- current gate 1..10
  state       TEXT NOT NULL DEFAULT 'exploring',  -- exploring|building|live|retired
  gates       TEXT NOT NULL,               -- JSON [{gate,status,note,decisionId,date}]
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sev         TEXT NOT NULL CHECK (sev IN ('SEV1','SEV2','SEV3','SEV4')),
  title       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open',    -- open|mitigated|resolved|closed
  commander   TEXT NOT NULL,                   -- a human, always
  product_id  TEXT,
  timeline    TEXT NOT NULL DEFAULT '[]',      -- JSON [{t,who,note}]
  postmortem  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer     TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'drafting',  -- drafting|draft_ready|escalated|sent|closed
  draft        TEXT,
  draft_run_id TEXT,
  sent_body    TEXT,
  edited       INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,                 -- golden|canary
  score      REAL NOT NULL,
  passed     INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  details    TEXT NOT NULL,                 -- JSON per-case results
  cost_usd   REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        TEXT NOT NULL DEFAULT 'info',   -- info|warn|crit
  source       TEXT NOT NULL,
  message      TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  read         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rituals (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  cadence     TEXT NOT NULL,                 -- weekly|monthly|quarterly|annual
  description TEXT,
  next_due    TEXT NOT NULL,
  last_done   TEXT,
  last_note   TEXT
);

CREATE TABLE IF NOT EXISTS problems (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  signature  TEXT NOT NULL,
  agent_id   TEXT,
  count      INTEGER NOT NULL DEFAULT 1,
  state      TEXT NOT NULL DEFAULT 'open',    -- open|resolved
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  channel      TEXT NOT NULL,               -- landing|email|paid|content|social
  product_id   TEXT,
  budget_usd   REAL NOT NULL DEFAULT 0,
  spent_usd    REAL NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'drafting',  -- drafting|pending_approval|live|paused|done
  draft        TEXT,
  draft_run_id TEXT,
  metrics      TEXT NOT NULL DEFAULT '{"signups":0,"qualified":0}',
  approved_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  company    TEXT,
  plan       TEXT NOT NULL DEFAULT 'trial',      -- trial|starter|pro|scale
  mrr_usd    REAL NOT NULL DEFAULT 0,
  state      TEXT NOT NULL DEFAULT 'lead',       -- lead|trial|active|churned
  product_id TEXT,
  campaign_id INTEGER,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  churned_at TEXT
);

CREATE TABLE IF NOT EXISTS contracts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,                -- contract|tos|privacy|dpa|nda|provider-terms
  title        TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'draft',    -- draft|under_review|signed|expired
  risk         TEXT,
  review_due   TEXT,
  vendor_id    TEXT,
  product_id   TEXT,
  decision_id  TEXT,
  summary      TEXT,
  signed_by    TEXT,                         -- a human, always (Part 1 §6.1)
  signed_at    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendors (
  id           TEXT PRIMARY KEY,             -- slug
  name         TEXT NOT NULL,
  service      TEXT NOT NULL,
  monthly_usd  REAL NOT NULL DEFAULT 0,
  renewal_date TEXT,
  owner        TEXT NOT NULL DEFAULT 'CEO',
  state        TEXT NOT NULL DEFAULT 'active',   -- active|cancelled
  source       TEXT NOT NULL DEFAULT 'manual',   -- manual|model-provider
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id         TEXT PRIMARY KEY,               -- slug
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'founder',    -- founder|fractional|hire
  actor_id   TEXT,                           -- matches audit actor ids
  deputy_id  TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS objectives (
  id         TEXT PRIMARY KEY,               -- slug
  title      TEXT NOT NULL,
  quarter    TEXT NOT NULL,                  -- 2026-Q3
  owner      TEXT NOT NULL,
  product_id TEXT,
  krs        TEXT NOT NULL DEFAULT '[]',     -- JSON [{kr,target,current,unit}]
  state      TEXT NOT NULL DEFAULT 'active', -- active|done|dropped
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intel_queries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'collecting',  -- collecting|ready|failed
  run_id     TEXT,
  summary    TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intel_records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id     INTEGER,
  name         TEXT NOT NULL,
  name_ar      TEXT,
  kind         TEXT NOT NULL DEFAULT 'company',
  sector       TEXT,
  country      TEXT,
  city         TEXT,
  profile      TEXT,
  website      TEXT,
  email        TEXT,
  phone        TEXT,
  address      TEXT,
  source       TEXT,
  confidence   REAL,
  verification TEXT NOT NULL DEFAULT 'unverified',  -- unverified|verified (human)
  state        TEXT NOT NULL DEFAULT 'new',          -- new|targeted|archived
  customer_id  INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS segments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',   -- manual|ai
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS segment_members (
  segment_id INTEGER NOT NULL,
  record_id  INTEGER NOT NULL,
  UNIQUE (segment_id, record_id)
);

CREATE TABLE IF NOT EXISTS datasets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'raw',      -- raw|cleaned|summary|extracted
  raw        TEXT NOT NULL,
  result     TEXT,
  op         TEXT,                             -- clean|summarize|extract-entities
  run_id     TEXT,
  state      TEXT NOT NULL DEFAULT 'stored',   -- stored|processing|done|failed
  parent_id  INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS archive_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL,                  -- intel-export|dataset|contract|campaign|finance|manual
  subject_type TEXT,
  subject_id   TEXT,
  snapshot     TEXT,                           -- JSON frozen copy
  file_ref     TEXT,                           -- workspace-relative path if any
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  pass         TEXT NOT NULL,               -- scrypt salt:hash
  role         TEXT NOT NULL DEFAULT 'member',  -- superadmin|member
  perms        TEXT NOT NULL DEFAULT '[]',  -- JSON permission keys; superadmin = ["*"]
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  owner       TEXT NOT NULL,
  product_id  TEXT,
  state       TEXT NOT NULL DEFAULT 'active',  -- active|paused|done|cancelled
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  details       TEXT,
  project_id    TEXT,
  assignee_type TEXT NOT NULL DEFAULT 'human',  -- human|agent
  assignee_id   TEXT,
  priority      TEXT NOT NULL DEFAULT 'normal', -- low|normal|high|critical
  due_date      TEXT,
  state         TEXT NOT NULL DEFAULT 'todo',   -- todo|doing|blocked|done|cancelled
  run_id        TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  done_at       TEXT
);

CREATE TABLE IF NOT EXISTS risks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  likelihood   INTEGER NOT NULL,              -- 1..5
  impact       INTEGER NOT NULL,              -- 1..5
  mitigation   TEXT,
  owner        TEXT NOT NULL,
  subject_type TEXT, subject_id TEXT,
  state        TEXT NOT NULL DEFAULT 'open',  -- open|mitigated|accepted|closed
  review_date  TEXT,
  source       TEXT NOT NULL DEFAULT 'manual',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quality_reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  area       TEXT NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('pass','fail')),
  notes      TEXT,
  reviewer   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now')),
  actor_type   TEXT NOT NULL,            -- human|agent|system
  actor_id     TEXT NOT NULL,
  action       TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  payload      TEXT,                     -- JSON
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL
);

-- Append-only enforcement: any UPDATE or DELETE on audit_log raises.
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`);

// Migrations for databases created before later features existed.
try { db.exec('ALTER TABLE runs ADD COLUMN pipeline_id TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE pipelines ADD COLUMN product_id TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE tickets ADD COLUMN product_id TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE tickets ADD COLUMN incident_id INTEGER'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE incidents ADD COLUMN postmortem_pipeline_id TEXT'); } catch { /* column exists */ }

export function q(sql, ...params) { return db.prepare(sql).all(...params); }
export function one(sql, ...params) { return db.prepare(sql).get(...params); }
export function exec(sql, ...params) { return db.prepare(sql).run(...params); }

export function uuid() {
  return crypto.randomUUID();
}
