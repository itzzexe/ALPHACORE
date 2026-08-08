// Data layer — SQLite via node:sqlite, schema per Part 3 §4.1 (Postgres is the
// production target per ADR-002; SQLite is the dev-mode spine, recorded here as
// ADR-007: same tables, one file, zero setup. Migration is a schema copy).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';

const dataDir = path.join(ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });
// The tests used to delete data/alphacore.db before importing this module, which
// is a fine idea until the day somebody runs them on a machine that holds the
// real company. The file is now nameable, and the test suite names its own.
export const DB_FILE = process.env.ALPHACORE_DB
  ? path.resolve(ROOT, process.env.ALPHACORE_DB)
  : path.join(dataDir, 'alphacore.db');
export const db = new DatabaseSync(DB_FILE);

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
  -- Set on the account first run generates. While it is 1 the account can do
  -- exactly two things: read itself, and replace its password.
  must_change  INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS partners (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'partner',   -- partner|investor|government|media|community|strategic
  tier         TEXT NOT NULL DEFAULT 'standard',  -- strategic|key|standard
  owner        TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'prospect',  -- prospect|active|dormant|ended
  health       INTEGER NOT NULL DEFAULT 3,        -- 1..5 relationship health
  notes        TEXT,
  draft        TEXT,                              -- AI outreach draft (human sends)
  draft_run_id TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id  INTEGER,
  customer_id INTEGER,
  vendor_id   TEXT,
  kind        TEXT NOT NULL DEFAULT 'note',       -- meeting|call|email|event|note|ai-draft
  summary     TEXT NOT NULL,
  next_action TEXT,
  next_date   TEXT,
  logged_by   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journeys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  product_id  TEXT,
  state       TEXT NOT NULL DEFAULT 'running',    -- running|awaiting_human|done|cancelled
  current_seq INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT
);

CREATE TABLE IF NOT EXISTS journey_stages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  journey_id INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  dept       TEXT NOT NULL,                       -- strategy|research|product|finance|legal|architecture|engineering|review|qa|security|release|marketing|support|governance
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'agent',       -- agent|human
  agent_id   TEXT,
  run_id     TEXT,
  state      TEXT NOT NULL DEFAULT 'pending',     -- pending|active|awaiting_human|done|skipped
  summary    TEXT,
  note       TEXT,
  started_at TEXT,
  ended_at   TEXT,
  UNIQUE (journey_id, seq)
);

CREATE TABLE IF NOT EXISTS channels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  platform   TEXT NOT NULL,                     -- x|linkedin|instagram|facebook|tiktok|youtube|telegram
  handle     TEXT NOT NULL,
  followers  INTEGER NOT NULL DEFAULT 0,
  state      TEXT NOT NULL DEFAULT 'connected', -- connected|paused|disconnected
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id   INTEGER,
  campaign_id  INTEGER,
  product_id   TEXT,
  kind         TEXT NOT NULL DEFAULT 'post',      -- post|thread|reel-script|story
  brief        TEXT NOT NULL,
  draft        TEXT,
  hashtags     TEXT,                              -- JSON array
  best_time    TEXT,
  draft_run_id TEXT,
  state        TEXT NOT NULL DEFAULT 'drafting',  -- drafting|draft_ready|scheduled|published|cancelled
  schedule_at  TEXT,
  published_by TEXT,                              -- a human, always
  published_at TEXT,
  metrics      TEXT NOT NULL DEFAULT '{"likes":0,"comments":0,"shares":0,"reach":0}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL DEFAULT 'article',   -- article|blog|video-script|email|landing|doc
  title        TEXT NOT NULL,
  brief        TEXT NOT NULL,
  draft        TEXT,
  seo          TEXT,                              -- JSON keywords
  product_id   TEXT,
  campaign_id  INTEGER,
  draft_run_id TEXT,
  state        TEXT NOT NULL DEFAULT 'drafting',  -- drafting|draft_ready|approved|published|cancelled
  approved_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS designs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL DEFAULT 'social-visual',  -- logo|banner|ui|social-visual|brand|diagram
  title        TEXT NOT NULL,
  brief        TEXT NOT NULL,
  spec         TEXT,
  svg          TEXT,
  file_ref     TEXT,                              -- workspace-relative .svg path
  product_id   TEXT,
  campaign_id  INTEGER,
  draft_run_id TEXT,
  state        TEXT NOT NULL DEFAULT 'drafting',  -- drafting|draft_ready|approved|cancelled
  approved_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pricing_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  product_id  TEXT,
  plan        TEXT NOT NULL DEFAULT 'standard',
  currency    TEXT NOT NULL DEFAULT 'USD',
  amount      REAL NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'per month',
  state       TEXT NOT NULL DEFAULT 'draft',      -- draft|approved|retired
  rationale   TEXT,
  run_id      TEXT,
  approved_by TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_health (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  score       INTEGER NOT NULL DEFAULT 3,          -- 1..5
  stage       TEXT NOT NULL DEFAULT 'onboarding',  -- onboarding|adopting|healthy|at_risk|churn_risk
  notes       TEXT,
  next_step   TEXT,
  next_date   TEXT,
  owner       TEXT,
  run_id      TEXT,
  reviewed_by TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'license',    -- domain|license|credential|device|repo|account|certificate
  owner        TEXT NOT NULL,
  vendor_id    TEXT,
  cost_usd     REAL NOT NULL DEFAULT 0,
  renewal_date TEXT,
  sensitivity  TEXT NOT NULL DEFAULT 'internal',
  state        TEXT NOT NULL DEFAULT 'active',     -- active|expiring|retired
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS localizations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,                       -- content|design|post|doc|manual
  source_id   TEXT,
  title       TEXT NOT NULL,
  source_text TEXT NOT NULL,
  target_lang TEXT NOT NULL DEFAULT 'ar',
  state       TEXT NOT NULL DEFAULT 'translating', -- translating|ready|approved|failed
  output      TEXT,
  notes       TEXT,
  run_id      TEXT,
  approved_by TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  website      TEXT,
  segment      TEXT,
  brief        TEXT,
  strengths    TEXT,
  weaknesses   TEXT,
  pricing_note TEXT,
  threat       INTEGER NOT NULL DEFAULT 3,         -- 1..5
  state        TEXT NOT NULL DEFAULT 'watching',   -- watching|archived
  run_id       TEXT,
  last_checked TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enablement_plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT NOT NULL,
  trigger    TEXT NOT NULL DEFAULT 'manual',       -- manual|eval-fail|incident|dispute
  findings   TEXT,
  plan       TEXT,
  state      TEXT NOT NULL DEFAULT 'analysing',    -- analysing|ready|applied|dismissed
  run_id     TEXT,
  applied_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS disputes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  subject_type  TEXT,
  subject_id    TEXT,
  party_a       TEXT NOT NULL,
  position_a    TEXT NOT NULL,
  party_b       TEXT NOT NULL,
  position_b    TEXT NOT NULL,
  context       TEXT,
  state         TEXT NOT NULL DEFAULT 'arbitrating', -- arbitrating|recommended|ruled|withdrawn
  hr_run_id     TEXT,
  recommendation TEXT,
  reasoning     TEXT,
  ruling        TEXT,
  ruled_by      TEXT,
  ruled_at      TEXT,
  raised_by     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,                     -- exactly what the human wrote
  requester    TEXT NOT NULL,
  priority     TEXT NOT NULL DEFAULT 'normal',
  state        TEXT NOT NULL DEFAULT 'triaging',  -- triaging|running|awaiting_human|done|failed|cancelled
  plan_summary TEXT,
  deliverable  TEXT,
  file_ref     TEXT,
  current_seq  INTEGER NOT NULL DEFAULT 0,
  run_id       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT
);

CREATE TABLE IF NOT EXISTS request_steps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  dept       TEXT NOT NULL,
  title      TEXT NOT NULL,
  brief      TEXT,
  kind       TEXT NOT NULL DEFAULT 'agent',       -- agent|human|spawn
  spawn_kind TEXT,
  spawn_id   TEXT,
  agent_id   TEXT,
  run_id     TEXT,
  state      TEXT NOT NULL DEFAULT 'pending',     -- pending|active|awaiting_human|done|failed|skipped
  output     TEXT,
  note       TEXT,
  cost_usd   REAL NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at   TEXT,
  UNIQUE (request_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel      TEXT NOT NULL DEFAULT 'general',   -- general|standup|random|<department>|dm
  from_agent   TEXT NOT NULL,
  to_agent     TEXT,                              -- null = to the room
  kind         TEXT NOT NULL DEFAULT 'chat',      -- chat|handoff|kudos|debate|standup|question|celebration|banter
  body         TEXT NOT NULL,
  context_type TEXT,
  context_id   TEXT,
  scene_id     INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_relations (
  a_id         TEXT NOT NULL,
  b_id         TEXT NOT NULL,
  rapport      REAL NOT NULL DEFAULT 0,           -- -2..+2
  interactions INTEGER NOT NULL DEFAULT 0,
  last_kind    TEXT,
  last_at      TEXT,
  PRIMARY KEY (a_id, b_id)
);

CREATE TABLE IF NOT EXISTS society_scenes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                       -- standup|watercooler|handoff|debate|kudos|retro
  channel    TEXT NOT NULL DEFAULT 'general',
  cast       TEXT NOT NULL,                       -- JSON agent ids
  premise    TEXT,
  state      TEXT NOT NULL DEFAULT 'writing',     -- writing|posted|failed
  run_id     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS autonomy_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                      -- the inbox item type decided
  subject_id TEXT NOT NULL,
  title      TEXT NOT NULL,
  verdict    TEXT NOT NULL,                      -- approve|reject|hold
  reason     TEXT,
  outcome    TEXT,                               -- what actually happened
  ok         INTEGER NOT NULL DEFAULT 1,
  reverted   INTEGER NOT NULL DEFAULT 0,
  run_id     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maestro_cycles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  state      TEXT NOT NULL DEFAULT 'planning',   -- planning|executed|failed|empty
  snapshot   TEXT NOT NULL,                      -- JSON company state at plan time
  plan       TEXT,                               -- JSON [{action,params,why,priority}]
  assessment TEXT,
  flags      TEXT,                               -- JSON: things only a human may do
  executed   TEXT,                               -- JSON [{action,ok,detail}]
  run_id     TEXT,
  mode       TEXT NOT NULL DEFAULT 'live',       -- live|dry-run
  trigger    TEXT NOT NULL DEFAULT 'auto',       -- auto|manual
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maestro_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id   INTEGER NOT NULL,
  action     TEXT NOT NULL,
  dedup_key  TEXT NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 1,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blueprints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  goal        TEXT NOT NULL,
  product_id  TEXT,
  project_id  TEXT,
  context     TEXT,                              -- JSON: audience, scale, budget, stack hints, compliance
  state       TEXT NOT NULL DEFAULT 'drafting',  -- drafting|awaiting_human|ready|cancelled
  current_seq INTEGER NOT NULL DEFAULT 1,
  workspace   TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT
);

CREATE TABLE IF NOT EXISTS blueprint_docs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  blueprint_id INTEGER NOT NULL,
  doc_key      TEXT NOT NULL,
  title        TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  agent_id     TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'pending',  -- pending|writing|awaiting_human|done|skipped
  content      TEXT,
  open_questions TEXT,
  run_id       TEXT,
  file_ref     TEXT,
  approved_by  TEXT,
  cost_usd     REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  UNIQUE (blueprint_id, doc_key)
);

CREATE TABLE IF NOT EXISTS infra_plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  blueprint_id INTEGER,
  product_id   TEXT,
  spec         TEXT NOT NULL,                    -- JSON inputs: users, rps, data, budget, cloud, compliance
  section      TEXT NOT NULL DEFAULT 'full',     -- full|sizing|ratelimits|cicd|observability|dr|cost
  state        TEXT NOT NULL DEFAULT 'drafting', -- drafting|ready|failed
  content      TEXT,
  cost_table   TEXT,
  run_id       TEXT,
  file_ref     TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fin_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                      -- pnl|balance-sheet|cash-flow|budget|annual-report|company-research|health-check
  title      TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT 'own',        -- 'own' or an external company name
  period     TEXT,                               -- 2026-08 | 2026-Q3 | 2026
  inputs     TEXT,                               -- JSON figures fed to the analyst
  state      TEXT NOT NULL DEFAULT 'drafting',   -- drafting|ready|approved|failed
  content    TEXT,
  metrics    TEXT,
  flags      TEXT,
  run_id     TEXT,
  file_ref   TEXT,
  approved_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intel_contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id    INTEGER NOT NULL,
  name         TEXT,
  role         TEXT,
  email        TEXT,
  phone        TEXT,
  method       TEXT NOT NULL DEFAULT 'model-knowledge',  -- web-scrape|model-knowledge|human|dataset
  source_url   TEXT,
  confidence   REAL,
  verification TEXT NOT NULL DEFAULT 'unverified',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (record_id, email, phone, name)
);

CREATE TABLE IF NOT EXISTS intel_evidence (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id  INTEGER NOT NULL,
  field      TEXT NOT NULL,                    -- email|phone|address|website|profile|...
  value      TEXT NOT NULL,
  method     TEXT NOT NULL,                    -- web-scrape|model-knowledge|human|dataset
  source_url TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  customer_id  INTEGER,
  partner_id   INTEGER,
  product_id   TEXT,
  value_usd    REAL NOT NULL DEFAULT 0,
  stage        TEXT NOT NULL DEFAULT 'lead',   -- lead|qualified|proposal|won|lost
  owner        TEXT NOT NULL,
  proposal     TEXT,
  draft_run_id TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at    TEXT
);

CREATE TABLE IF NOT EXISTS automations (
  id       TEXT PRIMARY KEY,                 -- rule id
  enabled  INTEGER NOT NULL DEFAULT 1,
  runs     INTEGER NOT NULL DEFAULT 0,
  last_run TEXT
);

CREATE TABLE IF NOT EXISTS nexus_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id     TEXT NOT NULL,
  subject_key TEXT NOT NULL,                 -- dedup: a rule fires once per subject
  note        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (rule_id, subject_key)
);

-- Expansion wave: trust, capital, talent and executive divisions.
CREATE TABLE IF NOT EXISTS security_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,                 -- injection|secret-leak|vendor-dpa|anomaly
  severity     TEXT NOT NULL DEFAULT 'low',   -- low|medium|high
  summary      TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  state        TEXT NOT NULL DEFAULT 'open',  -- open|triaged|closed
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compliance_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  area       TEXT NOT NULL,                   -- dpa|data-retention|access-control|...
  status     TEXT NOT NULL DEFAULT 'gap',     -- ok|gap|na
  note       TEXT,
  checked_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  hypothesis TEXT,
  variant_a  TEXT NOT NULL,
  variant_b  TEXT NOT NULL,
  agent_id   TEXT,
  run_a      TEXT,
  run_b      TEXT,
  result_a   TEXT,
  result_b   TEXT,
  winner     TEXT,                            -- a|b|inconclusive
  state      TEXT NOT NULL DEFAULT 'running', -- running|concluded
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role_name   TEXT NOT NULL,
  brief       TEXT,
  spec        TEXT,                            -- JSON drafted by an agent
  state       TEXT NOT NULL DEFAULT 'drafting',-- drafting|screening|trial|hired|rejected
  trial_note  TEXT,
  spec_run    TEXT,
  trial_run   TEXT,
  agent_id    TEXT,                            -- set on hire
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stage_gates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  gate       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'pending', -- pending|passed|failed
  approver   TEXT,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item          TEXT NOT NULL,
  vendor_id     INTEGER,
  amount_usd    REAL NOT NULL DEFAULT 0,
  justification TEXT,
  state         TEXT NOT NULL DEFAULT 'requested', -- requested|approved|rejected|ordered
  approver      TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS brand_assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                  -- voice|palette|logo-spec|boilerplate|guideline
  name       TEXT NOT NULL,
  content    TEXT,
  state      TEXT NOT NULL DEFAULT 'draft',  -- draft|approved
  run_id     TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS releases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    TEXT NOT NULL,
  product_id TEXT,
  notes      TEXT,
  state      TEXT NOT NULL DEFAULT 'draft',  -- draft|published
  run_id     TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS curricula (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT NOT NULL,
  title        TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'manual', -- manual|eval-fail|enablement
  state        TEXT NOT NULL DEFAULT 'proposed', -- proposed|active|done
  score_before REAL,
  score_after  REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investor_updates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  period     TEXT NOT NULL,
  body       TEXT,
  state      TEXT NOT NULL DEFAULT 'draft',  -- draft|sent
  run_id     TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS board_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL,
  packet      TEXT,
  resolutions TEXT,
  state       TEXT NOT NULL DEFAULT 'draft', -- draft|held
  run_id      TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulletins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week       TEXT NOT NULL,
  body       TEXT,
  state      TEXT NOT NULL DEFAULT 'draft',  -- draft|published
  run_id     TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The iteration engine: work that goes around until it is genuinely good.
CREATE TABLE IF NOT EXISTS workstreams (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  goal           TEXT NOT NULL,
  method         TEXT NOT NULL DEFAULT 'kaizen',   -- waterfall|scrum|kaizen
  route          TEXT NOT NULL,                    -- JSON array of departments
  quality_target REAL NOT NULL DEFAULT 0.85,
  max_cycles     INTEGER NOT NULL DEFAULT 4,
  reviewers      INTEGER NOT NULL DEFAULT 2,
  current_cycle  INTEGER NOT NULL DEFAULT 0,
  current_dept   TEXT,
  best_score     REAL,
  state          TEXT NOT NULL DEFAULT 'running',  -- running|awaiting_human|done|cancelled
  note           TEXT,
  subject_type   TEXT,
  subject_id     TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cycles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workstream_id INTEGER NOT NULL REFERENCES workstreams(id),
  seq           INTEGER NOT NULL,
  dept          TEXT NOT NULL,
  phase         TEXT NOT NULL DEFAULT 'produce',   -- produce|review|audit|done
  produce_run   TEXT,
  output        TEXT,
  review_runs   TEXT,                              -- JSON array of run ids
  reviews       TEXT,                              -- JSON array of verdicts
  audit_id      INTEGER,
  audit_score   REAL,
  audit_verdict TEXT,
  state         TEXT NOT NULL DEFAULT 'running',   -- running|done|blocked
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workstream_notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workstream_id INTEGER NOT NULL REFERENCES workstreams(id),
  body          TEXT NOT NULL,
  author        TEXT NOT NULL,
  applied       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The universal AI auditor: any department, any artifact, one standard.
CREATE TABLE IF NOT EXISTS audits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  dept         TEXT,
  criteria     TEXT,
  score        REAL,
  verdict      TEXT,                               -- pass|revise|fail
  findings     TEXT,
  summary      TEXT,
  run_id       TEXT,
  state        TEXT NOT NULL DEFAULT 'running',    -- running|done|failed
  requested_by TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  goal       TEXT,
  state      TEXT NOT NULL DEFAULT 'planning',     -- planning|active|review|closed
  starts_on  TEXT,
  ends_on    TEXT,
  velocity   INTEGER,
  retro      TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Agent memory: episodes, lessons, playbooks and the retrieval index.
CREATE TABLE IF NOT EXISTS mem_docs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,                      -- episode|lesson|playbook|knowledge|artifact|note
  agent_id     TEXT,
  dept         TEXT,
  title        TEXT,
  body         TEXT NOT NULL,
  source_type  TEXT,
  source_id    TEXT,
  quality      REAL,                               -- audited score of the work it came from
  verification TEXT NOT NULL DEFAULT 'unverified', -- unverified|verified|retracted
  tokens       INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL DEFAULT 'system',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS mem_docs_kind ON mem_docs (kind, agent_id);

CREATE TABLE IF NOT EXISTS mem_index (
  term   TEXT NOT NULL,
  doc_id INTEGER NOT NULL REFERENCES mem_docs(id),
  tf     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS mem_index_term ON mem_index (term);
CREATE INDEX IF NOT EXISTS mem_index_doc ON mem_index (doc_id);

CREATE TABLE IF NOT EXISTS mem_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id     INTEGER NOT NULL,
  run_id     TEXT NOT NULL,
  agent_id   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS mem_usage_run ON mem_usage (run_id);

CREATE TABLE IF NOT EXISTS reflections (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id       TEXT NOT NULL,
  run_id         TEXT,
  episodes       INTEGER NOT NULL DEFAULT 0,
  lessons        TEXT,
  playbook_draft TEXT,
  state          TEXT NOT NULL DEFAULT 'running',  -- running|done|failed
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The company floor: humans and AI employees in the same rooms.
CREATE TABLE IF NOT EXISTS chat_channels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,           -- general, div-engine, dm-admin-AGT-..., ws-12
  name         TEXT NOT NULL,
  topic        TEXT,
  kind         TEXT NOT NULL DEFAULT 'public', -- public|division|subject|dm
  division     TEXT,
  subject_type TEXT,
  subject_id   TEXT,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL DEFAULT 'system',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL REFERENCES chat_channels(id),
  parent_id   INTEGER,                          -- threads
  author_id   TEXT NOT NULL,                    -- human:admin | AGT-DOC-001 | system
  author_kind TEXT NOT NULL DEFAULT 'human',    -- human|agent|system
  body        TEXT NOT NULL,
  mentions    TEXT,                             -- JSON array of ids
  refs        TEXT,                             -- JSON [{type,id,label}]
  action      TEXT,                             -- JSON: what this message made happen
  run_id      TEXT,                             -- the run an agent answered with
  state       TEXT NOT NULL DEFAULT 'sent',     -- sent|thinking|failed|deleted
  pinned      INTEGER NOT NULL DEFAULT 0,
  edited_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS chat_msg_channel ON chat_messages (channel_id, id);

CREATE TABLE IF NOT EXISTS chat_members (
  channel_id INTEGER NOT NULL,
  member_id  TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'human',
  PRIMARY KEY (channel_id, member_id)
);

CREATE TABLE IF NOT EXISTS chat_reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id),
  actor      TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (message_id, actor, emoji)
);

CREATE TABLE IF NOT EXISTS chat_reads (
  channel_id INTEGER NOT NULL,
  member_id  TEXT NOT NULL,
  last_seen  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, member_id)
);

-- Treasury: the company's own crypto wallets, what it invoices, what arrives.
CREATE TABLE IF NOT EXISTS wallets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  chain        TEXT NOT NULL,                    -- bitcoin|ethereum|tron|solana|mock
  asset        TEXT NOT NULL DEFAULT 'native',   -- native|USDT|USDC
  address      TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'receiving',-- receiving|treasury
  watch_only   INTEGER NOT NULL DEFAULT 1,       -- the platform never holds keys
  balance      REAL NOT NULL DEFAULT 0,
  balance_at   TEXT,
  state        TEXT NOT NULL DEFAULT 'active',   -- active|retired
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chain, address, asset)
);

CREATE TABLE IF NOT EXISTS invoices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT NOT NULL UNIQUE,             -- INV-2026-0001
  customer_id  INTEGER,
  deal_id      INTEGER,
  wallet_id    INTEGER NOT NULL REFERENCES wallets(id),
  description  TEXT NOT NULL,
  amount       REAL NOT NULL,
  asset        TEXT NOT NULL,
  chain        TEXT NOT NULL,
  memo         TEXT,                             -- the exact-amount tag used to match
  state        TEXT NOT NULL DEFAULT 'open',     -- open|paid|underpaid|expired|cancelled
  paid_amount  REAL NOT NULL DEFAULT 0,
  paid_at      TEXT,
  tx_hash      TEXT,
  expires_at   TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallet_tx (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id   INTEGER NOT NULL REFERENCES wallets(id),
  tx_hash     TEXT NOT NULL,
  direction   TEXT NOT NULL DEFAULT 'in',        -- in|out
  amount      REAL NOT NULL,
  asset       TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  invoice_id  INTEGER,
  seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wallet_id, tx_hash, direction, amount)
);

-- Outgoing money is prepared here and signed elsewhere. No key ever lands in
-- this database, so nothing in this table can move funds on its own.
CREATE TABLE IF NOT EXISTS payouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  to_address  TEXT NOT NULL,
  chain       TEXT NOT NULL,
  asset       TEXT NOT NULL,
  amount      REAL NOT NULL,
  reason      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'prepared',  -- prepared|approved|sent|rejected
  approved_by TEXT,
  tx_hash     TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contact centre: the company's phone numbers, its voices, and every call and
-- message in or out.
CREATE TABLE IF NOT EXISTS phone_numbers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  number      TEXT NOT NULL UNIQUE,             -- E.164, e.g. +9647xxxxxxxx
  label       TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT 'simulated',-- twilio|simulated
  voice_in    INTEGER NOT NULL DEFAULT 1,
  sms_in      INTEGER NOT NULL DEFAULT 1,
  country     TEXT,
  state       TEXT NOT NULL DEFAULT 'active',
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  direction    TEXT NOT NULL,                    -- out|in
  from_number  TEXT NOT NULL,
  to_number    TEXT NOT NULL,
  customer_id  INTEGER,
  agent_id     TEXT,                             -- the AI employee running it
  voice        TEXT NOT NULL DEFAULT 'ava',
  language     TEXT NOT NULL DEFAULT 'en',
  purpose      TEXT,
  script       TEXT,                             -- what will be said
  state        TEXT NOT NULL DEFAULT 'queued',   -- queued|drafting|ringing|live|completed|failed|missed
  outcome      TEXT,                             -- reached|voicemail|no-answer|busy|declined
  duration_s   INTEGER NOT NULL DEFAULT 0,
  transcript   TEXT,
  recording    TEXT,
  follow_up    TEXT,
  run_id       TEXT,
  provider_sid TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT
);

CREATE TABLE IF NOT EXISTS sms_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  direction    TEXT NOT NULL,                    -- out|in
  channel      TEXT NOT NULL DEFAULT 'sms',      -- sms|whatsapp
  from_number  TEXT NOT NULL,
  to_number    TEXT NOT NULL,
  customer_id  INTEGER,
  agent_id     TEXT,
  body         TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'queued',   -- queued|drafting|sent|delivered|received|failed
  thread_key   TEXT NOT NULL,
  run_id       TEXT,
  provider_sid TEXT,
  created_by   TEXT NOT NULL DEFAULT 'system',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sms_thread ON sms_messages (thread_key, id);

-- The money desk: how cash is allocated, and what the company promised itself.
CREATE TABLE IF NOT EXISTS money_policy (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reserve_pct   REAL NOT NULL DEFAULT 40,
  opex_pct      REAL NOT NULL DEFAULT 35,
  growth_pct    REAL NOT NULL DEFAULT 25,
  min_runway_mo REAL NOT NULL DEFAULT 6,
  note          TEXT,
  set_by        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS money_moves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,                     -- allocation|transfer|writeoff|note
  bucket      TEXT,                              -- reserve|opex|growth
  amount      REAL NOT NULL DEFAULT 0,
  asset       TEXT NOT NULL DEFAULT 'USD',
  reason      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'recorded',
  decided_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Marketing: the audience it is for, the promise it makes, the channels it
-- buys, the words it publishes, and what any of it returned.
CREATE TABLE IF NOT EXISTS personas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  segment     TEXT,
  job_title   TEXT,
  pains       TEXT,
  gains       TEXT,
  objections  TEXT,
  channels    TEXT,
  evidence    TEXT,                              -- where this came from
  state       TEXT NOT NULL DEFAULT 'draft',     -- draft|active|retired
  run_id      TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positioning (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   TEXT,
  audience     TEXT NOT NULL,
  category     TEXT,
  promise      TEXT NOT NULL,
  proof        TEXT,
  alternatives TEXT,
  tagline      TEXT,
  messages     TEXT,                             -- JSON pillars
  state        TEXT NOT NULL DEFAULT 'draft',    -- draft|approved
  run_id       TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_channels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER NOT NULL,
  channel      TEXT NOT NULL,                    -- search|social|email|content|events|partners|outbound
  budget_usd   REAL NOT NULL DEFAULT 0,
  spent_usd    REAL NOT NULL DEFAULT 0,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  leads        INTEGER NOT NULL DEFAULT 0,
  customers    INTEGER NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'planned',  -- planned|running|paused|ended
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_calendar (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'blog',
  persona_id   INTEGER,
  campaign_id  INTEGER,
  stage        TEXT NOT NULL DEFAULT 'awareness',-- awareness|consideration|decision|retention
  due_date     TEXT,
  owner_agent  TEXT,
  brief        TEXT,
  content_id   INTEGER,                          -- the studio piece it became
  state        TEXT NOT NULL DEFAULT 'idea',     -- idea|briefed|drafting|ready|published
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seo_keywords (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword     TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'en',
  intent      TEXT,                              -- informational|commercial|transactional
  volume      INTEGER,
  difficulty  INTEGER,
  priority    REAL NOT NULL DEFAULT 0,
  target_url  TEXT,
  calendar_id INTEGER,
  state       TEXT NOT NULL DEFAULT 'tracked',
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_sequences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  goal        TEXT,
  audience    TEXT,
  steps       TEXT,                              -- JSON [{day,subject,body}]
  state       TEXT NOT NULL DEFAULT 'draft',     -- draft|ready|live|retired
  sent        INTEGER NOT NULL DEFAULT 0,
  opened      INTEGER NOT NULL DEFAULT 0,
  replied     INTEGER NOT NULL DEFAULT 0,
  run_id      TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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

// ============================================================================
// The outside world. Everything above this line is the company talking to
// itself; everything below is the machinery that lets it touch anything real —
// credentials, connectors, the gate every outbound effect must pass, the job
// queue that survives a dropped connection, and the systems that keep all of
// it honest.
// ============================================================================
db.exec(`
-- Secrets, encrypted at rest. The ciphertext never leaves this table and the
-- plaintext never enters an audit payload or an API response.
CREATE TABLE IF NOT EXISTS vault_secrets (
  name        TEXT PRIMARY KEY,
  ciphertext  TEXT NOT NULL,           -- base64: iv | tag | data
  kind        TEXT NOT NULL DEFAULT 'api_key',  -- api_key|oauth|password|webhook
  connector   TEXT,
  note        TEXT,
  tail        TEXT,                    -- last 4 chars, safe to show
  expires_at  TEXT,
  last_used   TEXT,
  rotated_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per service the company can reach. A connector is inert until it is
-- armed: 'dry' means every call is recorded and nothing leaves.
CREATE TABLE IF NOT EXISTS connectors (
  id          TEXT PRIMARY KEY,        -- gmail, github, slack, http:acme
  driver      TEXT NOT NULL,           -- which driver file handles it
  label       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'disconnected',  -- disconnected|dry|live|paused
  config      TEXT,                    -- JSON, no secrets
  scopes      TEXT,                    -- JSON array of granted capability ids
  allowlist   TEXT,                    -- JSON array: domains, repos, channels
  quota_day   INTEGER NOT NULL DEFAULT 200,
  connected_by TEXT,
  connected_at TEXT,
  last_call   TEXT,
  health      TEXT NOT NULL DEFAULT 'unknown',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connector_accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_id TEXT NOT NULL REFERENCES connectors(id),
  account      TEXT NOT NULL,          -- the email / login / workspace
  secret_name  TEXT,                   -- points into vault_secrets
  refresh_name TEXT,
  expires_at   TEXT,
  meta         TEXT,
  state        TEXT NOT NULL DEFAULT 'active',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (connector_id, account)
);

-- Which employee may reach which capability, and how far. No wildcards.
CREATE TABLE IF NOT EXISTS agent_scopes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT NOT NULL,
  connector  TEXT NOT NULL,
  capability TEXT NOT NULL,            -- mail.send, repo.pr, post.publish
  constraint_json TEXT,                -- JSON: {domain, repo, channel, maxValueUsd}
  granted_by TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (agent_id, connector, capability)
);

-- Every attempt to affect anything outside this machine, allowed or not.
CREATE TABLE IF NOT EXISTS egress_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  connector   TEXT NOT NULL,
  capability  TEXT NOT NULL,
  agent_id    TEXT,
  run_id      TEXT,
  actor       TEXT,
  target      TEXT,                    -- who/what it would touch
  reason      TEXT,
  payload     TEXT,                    -- JSON, redacted
  verdict     TEXT NOT NULL,           -- allowed|blocked|dry|gated
  blocked_by  TEXT,                    -- which rule refused
  result      TEXT,                    -- JSON of what came back
  value_usd   REAL NOT NULL DEFAULT 0,
  intent_hash TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Work that must survive a dropped line: attempts, backoff, idempotency.
CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  payload     TEXT,
  state       TEXT NOT NULL DEFAULT 'queued',  -- queued|running|done|failed|dead
  attempts    INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after   TEXT NOT NULL DEFAULT (datetime('now')),
  idempotency TEXT UNIQUE,
  last_error  TEXT,
  leased_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_pick ON jobs (state, run_after);

-- The web, as a capability with a memory. Every fetch keeps its content hash so
-- any claim traces back to what was actually on the page.
CREATE TABLE IF NOT EXISTS web_fetches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'fetch',   -- fetch|search|browse
  agent_id    TEXT,
  run_id      TEXT,
  status      INTEGER,
  bytes       INTEGER,
  content_hash TEXT,
  title       TEXT,
  text        TEXT,
  screenshot  TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS web_url ON web_fetches (url, created_at);

-- MCP: servers the company can reach, and the tools they expose.
CREATE TABLE IF NOT EXISTS mcp_servers (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  transport  TEXT NOT NULL DEFAULT 'stdio',   -- stdio|http
  command    TEXT,
  args       TEXT,
  url        TEXT,
  env_names  TEXT,                     -- JSON array of vault secret names
  state      TEXT NOT NULL DEFAULT 'registered',  -- registered|connected|failed
  last_error TEXT,
  tools_json TEXT,
  last_sync  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id  TEXT NOT NULL,
  tool       TEXT NOT NULL,
  agent_id   TEXT,
  run_id     TEXT,
  args       TEXT,
  result     TEXT,
  ok         INTEGER NOT NULL DEFAULT 1,
  ms         INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The constitution: rules the company must obey, written once and enforced by
-- machine at the gate and by the auditor on the work.
CREATE TABLE IF NOT EXISTS constitution (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  article     TEXT NOT NULL,
  rule_id     TEXT NOT NULL UNIQUE,
  text        TEXT NOT NULL,
  machine     TEXT,                    -- JSON rule the gate can evaluate
  severity    TEXT NOT NULL DEFAULT 'block',   -- block|gate|warn
  version     INTEGER NOT NULL DEFAULT 1,
  state       TEXT NOT NULL DEFAULT 'active',  -- active|retired
  ruled_by    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anyone who asked to be left alone. Checked before every outbound message on
-- every channel, permanently, with no expiry and no way for an agent to clear
-- an entry — only a person can, and the removal is on the chain.
CREATE TABLE IF NOT EXISTS suppression_list (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact    TEXT NOT NULL UNIQUE,     -- email, phone, handle, lower-cased
  channel    TEXT NOT NULL DEFAULT 'all',
  reason     TEXT,
  added_by   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS constitution_hits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id    TEXT NOT NULL,
  subject    TEXT,
  verdict    TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Provenance: a signed receipt for anything the company produced.
CREATE TABLE IF NOT EXISTS provenance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chain_hash   TEXT,
  made_by      TEXT,
  model        TEXT,
  reviewers    TEXT,
  cost_usd     REAL NOT NULL DEFAULT 0,
  signature    TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subject_type, subject_id, content_hash)
);

-- The time machine: named marks on the chain you can stand at.
CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  chain_hash TEXT NOT NULL,
  counts     TEXT,
  taken_by   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The shadow company: a fork of reality, run fast, compared honestly.
CREATE TABLE IF NOT EXISTS simulations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  question    TEXT NOT NULL,
  changes     TEXT,                    -- JSON: what we changed in the fork
  horizon     TEXT,
  state       TEXT NOT NULL DEFAULT 'queued',  -- queued|running|done|failed
  db_file     TEXT,
  baseline    TEXT,                    -- JSON metrics before
  outcome     TEXT,                    -- JSON metrics after
  verdict     TEXT,
  started_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT
);

-- Skills: reusable recipes an employee proposes, proven before adoption.
CREATE TABLE IF NOT EXISTS skills (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  task_type   TEXT NOT NULL,
  body        TEXT NOT NULL,           -- the recipe: prompt + tools
  version     INTEGER NOT NULL DEFAULT 1,
  proposed_by TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'proposed',  -- proposed|testing|adopted|rejected|retired
  score       REAL,
  baseline    REAL,
  trials      INTEGER NOT NULL DEFAULT 0,
  adopted_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (slug, version)
);

-- Model tournaments: which model actually wins which kind of work.
CREATE TABLE IF NOT EXISTS tournaments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type  TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'running',
  entrants   TEXT,
  results    TEXT,
  winner     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at   TEXT
);

-- The red team: attacks we run on ourselves before someone else does.
CREATE TABLE IF NOT EXISTS redteam_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  attack     TEXT NOT NULL,
  target     TEXT NOT NULL,
  payload    TEXT,
  outcome    TEXT NOT NULL DEFAULT 'pending',  -- pending|defended|breached
  detail     TEXT,
  severity   TEXT NOT NULL DEFAULT 'medium',
  fixed_at   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Knowledge graph: entities and the edges between them, built from real rows.
CREATE TABLE IF NOT EXISTS graph_nodes (
  id         TEXT PRIMARY KEY,         -- customer:12, agent:AGT-..., artifact:88
  kind       TEXT NOT NULL,
  label      TEXT NOT NULL,
  props      TEXT,
  embedding  TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS graph_edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  src        TEXT NOT NULL,
  dst        TEXT NOT NULL,
  rel        TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1,
  props      TEXT,
  UNIQUE (src, dst, rel)
);
CREATE INDEX IF NOT EXISTS graph_src ON graph_edges (src);
CREATE INDEX IF NOT EXISTS graph_dst ON graph_edges (dst);
`);

// ============================================================================
// The platform. Everything above runs one company; everything below runs many,
// exposes them to other software, lets a department be shipped as a package,
// and keeps the whole thing operating without somebody standing over it.
// ============================================================================
db.exec(`
-- One row per company on this installation. Each gets its own database file:
-- isolation by file is stronger than isolation by WHERE clause, and it cannot
-- be forgotten in a query.
CREATE TABLE IF NOT EXISTS tenants (
  id           TEXT PRIMARY KEY,        -- slug: acme, basra-oil
  name         TEXT NOT NULL,
  db_file      TEXT NOT NULL,
  port         INTEGER,
  state        TEXT NOT NULL DEFAULT 'provisioning',  -- provisioning|running|paused|stopped|failed
  plan         TEXT NOT NULL DEFAULT 'standard',
  owner_email  TEXT,
  locale       TEXT NOT NULL DEFAULT 'en',
  monthly_cap_usd REAL NOT NULL DEFAULT 200,
  settings     TEXT,
  last_seen    TEXT,
  last_error   TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_at   TEXT
);

-- What each tenant actually consumed. The billing question and the capacity
-- question are the same question.
CREATE TABLE IF NOT EXISTS tenant_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  TEXT NOT NULL,
  day        TEXT NOT NULL,
  runs       INTEGER NOT NULL DEFAULT 0,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd   REAL NOT NULL DEFAULT 0,
  api_calls  INTEGER NOT NULL DEFAULT 0,
  egress     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, day)
);

-- Programmatic access. A session token belongs to a person at a keyboard; a key
-- belongs to another piece of software, and is scoped and rate-limited on its
-- own terms.
CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL UNIQUE,    -- shown in listings: ck_live_a1b2…
  hash        TEXT NOT NULL,           -- scrypt of the full key; the key itself is never stored
  scopes      TEXT NOT NULL,           -- JSON array of permission keys
  tenant_id   TEXT,
  rate_per_min INTEGER NOT NULL DEFAULT 120,
  expires_at  TEXT,
  last_used   TEXT,
  calls       INTEGER NOT NULL DEFAULT 0,
  state       TEXT NOT NULL DEFAULT 'active',   -- active|revoked
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id     INTEGER,
  method     TEXT NOT NULL,
  path       TEXT NOT NULL,
  status     INTEGER,
  ms         INTEGER,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS api_calls_key ON api_calls (key_id, created_at);

-- Webhooks out: the company telling other software what just happened, with a
-- signature so the receiver can prove it came from here.
CREATE TABLE IF NOT EXISTS webhooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT NOT NULL,
  events     TEXT NOT NULL,            -- JSON array of action patterns
  secret_name TEXT NOT NULL,           -- points into the vault
  state      TEXT NOT NULL DEFAULT 'active',
  last_fired TEXT,
  failures   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL,
  event      TEXT NOT NULL,
  payload    TEXT,
  status     INTEGER,
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A department as an installable unit: tables, employees, permissions, rules
-- and a place on the map, declared in one manifest.
CREATE TABLE IF NOT EXISTS packages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL,
  author      TEXT,
  description TEXT,
  manifest    TEXT NOT NULL,           -- the whole declaration, as JSON
  state       TEXT NOT NULL DEFAULT 'available',  -- available|installed|failed|removed
  installed_at TEXT,
  installed_by TEXT,
  last_error  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The operating rhythm: the company planning and correcting itself on a clock,
-- with every move written down as a period a person can read afterwards.
CREATE TABLE IF NOT EXISTS periods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,            -- day|week|quarter
  label      TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'open',   -- open|reviewed|closed
  plan       TEXT,                     -- JSON: what the company decided to do
  review     TEXT,                     -- JSON: what actually happened
  corrections TEXT,                    -- JSON: what it changed as a result
  opened_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at  TEXT,
  UNIQUE (kind, label)
);

-- What the company is watching about itself, and what it promised.
CREATE TABLE IF NOT EXISTS metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  value      REAL NOT NULL,
  unit       TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS metrics_name ON metrics (name, at);

CREATE TABLE IF NOT EXISTS slos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  describe   TEXT NOT NULL,
  metric     TEXT NOT NULL,
  target     REAL NOT NULL,
  comparison TEXT NOT NULL DEFAULT 'lte',   -- lte|gte
  window_h   INTEGER NOT NULL DEFAULT 24,
  state      TEXT NOT NULL DEFAULT 'ok',    -- ok|at_risk|breached
  breached_at TEXT,
  last_value REAL,
  remedy     TEXT,                     -- the fix the company applies to itself
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS remedies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slo        TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT,
  outcome    TEXT NOT NULL DEFAULT 'applied',  -- applied|failed|escalated
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Marketing, as a whole department rather than a posting tool.
--
-- Campaigns, content, design, brand, social and search already existed; what
-- was missing were the functions a marketing department has that none of those
-- cover — the room it books, the journalist it calls, the people who advocate
-- for it unpaid, where a customer actually came from, the page they land on,
-- and the plumbing that makes any of that measurable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mkt_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'webinar',   -- webinar|conference|meetup|roundtable
  format      TEXT NOT NULL DEFAULT 'online',
  starts_at   TEXT,
  city        TEXT,
  audience    TEXT,
  goal        TEXT,
  budget_usd  REAL NOT NULL DEFAULT 0,
  spent_usd   REAL NOT NULL DEFAULT 0,
  registered  INTEGER NOT NULL DEFAULT 0,
  attended    INTEGER NOT NULL DEFAULT 0,
  leads       INTEGER NOT NULL DEFAULT 0,
  campaign_id INTEGER,
  brief       TEXT,
  run_id      TEXT,
  state       TEXT NOT NULL DEFAULT 'planned',   -- planned|briefed|live|done|cancelled
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mkt_press (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'release',   -- release|pitch|coverage|briefing
  title       TEXT NOT NULL,
  outlet      TEXT,
  journalist  TEXT,
  angle       TEXT,
  body        TEXT,
  url         TEXT,
  sentiment   TEXT,
  state       TEXT NOT NULL DEFAULT 'draft',     -- draft|approved|sent|published|declined
  run_id      TEXT,
  approved_by TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mkt_community (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  handle      TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'other',
  role        TEXT NOT NULL DEFAULT 'member',    -- member|advocate|ambassador|critic
  reach       INTEGER NOT NULL DEFAULT 0,
  sentiment   TEXT,
  last_seen   TEXT,
  notes       TEXT,
  customer_id INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Where a customer actually came from, as a chain of touches rather than a
-- single field somebody typed. Last-touch is a lie told for convenience.
CREATE TABLE IF NOT EXISTS mkt_touchpoints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject     TEXT NOT NULL,                     -- customer:12, deal:8, lead email
  channel     TEXT NOT NULL,
  source      TEXT,
  campaign_id INTEGER,
  content_id  INTEGER,
  event_id    INTEGER,
  weight      REAL NOT NULL DEFAULT 1,
  value_usd   REAL NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS mkt_touch_subject ON mkt_touchpoints (subject, occurred_at);

CREATE TABLE IF NOT EXISTS mkt_pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  purpose     TEXT,
  persona_id  INTEGER,
  campaign_id INTEGER,
  headline    TEXT,
  body        TEXT,
  cta         TEXT,
  visits      INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  state       TEXT NOT NULL DEFAULT 'draft',     -- draft|review|live|retired
  run_id      TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The plumbing: what is connected, how a lead is scored, and what is tracked.
CREATE TABLE IF NOT EXISTS mkt_ops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,                     -- tool|rule|tracking|convention
  name        TEXT NOT NULL,
  detail      TEXT,
  value       TEXT,
  state       TEXT NOT NULL DEFAULT 'active',
  owner       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Backups: a platform that can lose the company is not a platform.
CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled|manual|pre-restore
  bytes      INTEGER,
  sha256     TEXT,
  chain_tip  INTEGER,
  chain_hash TEXT,
  verified   INTEGER NOT NULL DEFAULT 0,
  taken_by   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migrations for databases created before later features existed.
try { db.exec('ALTER TABLE runs ADD COLUMN pipeline_id TEXT'); } catch { /* column exists */ }
// Scrum: tasks belong to sprints and carry story points.
try { db.exec('ALTER TABLE tasks ADD COLUMN sprint_id INTEGER'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE tasks ADD COLUMN points INTEGER'); } catch { /* column exists */ }
// Cycles record when a round's runs were consumed while still at the gate.
try { db.exec('ALTER TABLE cycles ADD COLUMN gated INTEGER NOT NULL DEFAULT 0'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE pipelines ADD COLUMN product_id TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE tickets ADD COLUMN product_id TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE tickets ADD COLUMN incident_id INTEGER'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE incidents ADD COLUMN postmortem_pipeline_id TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE journeys ADD COLUMN autopilot INTEGER NOT NULL DEFAULT 0'); } catch { /* column exists */ }
// Accounts created before first-run passwords were generated have chosen their
// own by definition, so upgrading in place leaves everyone at 0.
try { db.exec('ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0'); } catch { /* column exists */ }
// Intelligence v2 — structured criteria, multi-round collection, web enrichment.
for (const sql of [
  'ALTER TABLE intel_queries ADD COLUMN criteria TEXT',
  'ALTER TABLE intel_queries ADD COLUMN target_count INTEGER NOT NULL DEFAULT 15',
  'ALTER TABLE intel_queries ADD COLUMN round INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE intel_queries ADD COLUMN dry_rounds INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE intel_queries ADD COLUMN stats TEXT',
  'ALTER TABLE intel_records ADD COLUMN domain TEXT',
  'ALTER TABLE intel_records ADD COLUMN email2 TEXT',
  'ALTER TABLE intel_records ADD COLUMN phone2 TEXT',
  'ALTER TABLE intel_records ADD COLUMN whatsapp TEXT',
  'ALTER TABLE intel_records ADD COLUMN linkedin TEXT',
  'ALTER TABLE intel_records ADD COLUMN social TEXT',
  'ALTER TABLE intel_records ADD COLUMN region TEXT',
  'ALTER TABLE intel_records ADD COLUMN size_hint TEXT',
  'ALTER TABLE intel_records ADD COLUMN completeness REAL NOT NULL DEFAULT 0',
  "ALTER TABLE intel_records ADD COLUMN enrichment TEXT NOT NULL DEFAULT 'pending'",
  'ALTER TABLE intel_records ADD COLUMN enriched_at TEXT',
  'ALTER TABLE intel_records ADD COLUMN gaps TEXT',
  'ALTER TABLE intel_records ADD COLUMN gapfill_tries INTEGER NOT NULL DEFAULT 0',
  // Data division cross-links: segments reach marketing, datasets carry lineage.
  // Intelligence v3 — conditional escalation rules and hard constraints.
  'ALTER TABLE intel_queries ADD COLUMN rules TEXT',
  'ALTER TABLE intel_queries ADD COLUMN constraints TEXT',
  "ALTER TABLE intel_records ADD COLUMN rules_state TEXT NOT NULL DEFAULT 'pending'",
  'ALTER TABLE intel_records ADD COLUMN rules_log TEXT',
  'ALTER TABLE intel_records ADD COLUMN rejected_reason TEXT',
  'ALTER TABLE intel_records ADD COLUMN email_pattern TEXT',
  'ALTER TABLE intel_contacts ADD COLUMN note TEXT',
  'ALTER TABLE segments ADD COLUMN campaign_id INTEGER',
  'ALTER TABLE segments ADD COLUMN criteria TEXT',
  'ALTER TABLE datasets ADD COLUMN source_kind TEXT',
  'ALTER TABLE datasets ADD COLUMN source_ref TEXT',
  // The workforce as people: an editable persona, and which departments they serve.
  'ALTER TABLE agents ADD COLUMN persona TEXT',
  'ALTER TABLE agents ADD COLUMN departments TEXT',
  'ALTER TABLE agents ADD COLUMN nickname TEXT',
]) { try { db.exec(sql); } catch { /* column exists */ } }

export function q(sql, ...params) { return db.prepare(sql).all(...params); }
export function one(sql, ...params) { return db.prepare(sql).get(...params); }
export function exec(sql, ...params) { return db.prepare(sql).run(...params); }

export function uuid() {
  return crypto.randomUUID();
}
