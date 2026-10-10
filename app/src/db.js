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
// Overwritten and deleted content is zeroed rather than just marked free.
//
// Without this, sealing a personal-data column leaves the plaintext sitting on
// the freed page: invisible to every SELECT, and perfectly readable to anybody
// who runs `strings` over the file. Since the whole point of sealing is to
// protect a stolen disk, a design that leaves the cleartext on that disk is not
// a small gap — it is the gap. Costs a little write throughput; buys the thing
// the encryption was for.
try { db.exec('PRAGMA secure_delete = ON;'); } catch { /* older SQLite: the backfill vacuums instead */ }

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

// Web Push: one row per browser that asked to be told. The endpoint is unique
// because a browser reissues the same one until the subscription dies.
db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  failures   INTEGER NOT NULL DEFAULT 0,
  last_ok    TEXT,
  last_error TEXT,
  retired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS push_by_user ON push_subscriptions(user_id);

-- External anchoring. One row per attempt to have a third party write down
-- where the chain had got to — including the attempts that failed, because a
-- gap with no explanation looks exactly like a period nobody was watching.
CREATE TABLE IF NOT EXISTS anchors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  witness      TEXT NOT NULL,          -- rfc3161 | webhook | file
  chain_seq    INTEGER NOT NULL,       -- the height that was witnessed
  chain_hash   TEXT NOT NULL,
  digest       TEXT NOT NULL,          -- sha256 over height+hash, what the witness signed
  external_ref TEXT,                   -- the authority, the URL, the file
  external_at  TEXT,                   -- the time the WITNESS claims, not ours
  evidence     TEXT,                   -- the token itself, for a verifier that is not us
  note         TEXT,
  ok           INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS anchors_by_height ON anchors(chain_seq);

-- Second factor. The secret is stored beside the account rather than in the
-- vault on purpose: the vault's master key is a file on the same disk, so
-- putting it there would buy the appearance of protection and not the fact.
CREATE TABLE IF NOT EXISTS user_totp (
  user_id     INTEGER PRIMARY KEY,
  secret      TEXT NOT NULL,
  confirmed_at TEXT,                   -- NULL until a code has been proved once
  last_counter INTEGER,                -- refuses the same code twice
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recovery codes: a lost phone must not mean a lost company. One row per code,
-- hashed, deleted as it is used.
CREATE TABLE IF NOT EXISTS user_recovery (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL,
  code     TEXT NOT NULL,              -- scrypt salt:hash
  used_at  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS recovery_by_user ON user_recovery(user_id);

-- Every attempt to sign in, successful or not. This is what rate limiting and
-- lockout are computed from, and what says "somebody tried you 400 times last
-- night" afterwards.
CREATE TABLE IF NOT EXISTS login_attempts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT,
  ip        TEXT,
  ok        INTEGER NOT NULL DEFAULT 0,
  reason    TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS attempts_by_user ON login_attempts(username, at);
CREATE INDEX IF NOT EXISTS attempts_by_ip ON login_attempts(ip, at);
`);

// Sessions gain an absolute ceiling and a last-seen, so a token cannot be
// renewed forever and an idle one can be expired without waiting a week.
try { db.exec('ALTER TABLE sessions ADD COLUMN last_seen TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE sessions ADD COLUMN absolute_expires_at TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE sessions ADD COLUMN ip TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT'); } catch { /* column exists */ }

// Which model actually answered, not which tier was asked for. Providers move
// what a name points at without announcing it, so a run that cannot name its
// model is a run nobody can reproduce or account for.
try { db.exec('ALTER TABLE runs ADD COLUMN provider TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE runs ADD COLUMN model TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE runs ADD COLUMN model_family TEXT'); } catch { /* column exists */ }
// Which system prompt produced this answer. The model was already recorded;
// the prompt is the other half of being able to reproduce anything.
try { db.exec('ALTER TABLE runs ADD COLUMN prompt_version TEXT'); } catch { /* column exists */ }
// Which space a vector belongs to. Two models produce incomparable vectors even
// at the same dimension, and a search that mixes them returns a ranked list of
// nonsense — which looks exactly like a ranked list.
try { db.exec('ALTER TABLE graph_nodes ADD COLUMN embedding_space TEXT'); } catch { /* column exists */ }

// Double-entry bookkeeping. The finance pages computed summaries from
// operational tables, which answers "roughly how are we doing" and cannot
// answer "what do we owe", "does this balance", or "show me the entry behind
// this number" — the three questions an accountant, a bank and a tax authority
// ask first.
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  code        TEXT PRIMARY KEY,          -- 1000, 4000, 5000 — the convention everybody knows
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,             -- asset|liability|equity|revenue|expense
  parent_code TEXT,
  normal_side TEXT NOT NULL,             -- which side increases it
  note        TEXT,
  retired_at  TEXT,                      -- retired, never deleted: entries still point here
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A period that has closed cannot be posted into. Without this, last quarter's
-- numbers change quietly whenever somebody backdates an entry.
CREATE TABLE IF NOT EXISTS fiscal_periods (
  period        TEXT PRIMARY KEY,        -- YYYY-MM
  state         TEXT NOT NULL DEFAULT 'open',
  closed_by     TEXT,
  closed_at     TEXT,
  reopened_by   TEXT,
  reopened_at   TEXT,
  reopen_reason TEXT
);

CREATE TABLE IF NOT EXISTS journal (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,  -- JE-202608-0001
  entry_date      TEXT NOT NULL,
  period          TEXT NOT NULL,
  memo            TEXT NOT NULL,         -- a number nobody can explain is a number nobody can defend
  source          TEXT,                  -- invoice | payout | model-spend | reversal | manual
  source_id       TEXT,
  currency        TEXT NOT NULL DEFAULT 'USD',
  total           REAL NOT NULL,
  state           TEXT NOT NULL DEFAULT 'draft',  -- draft|posted|reversed
  created_by      TEXT NOT NULL,
  posted_by       TEXT,
  posted_at       TEXT,
  reversed_by_id  INTEGER,               -- corrections are reversals, never edits
  reversal_reason TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS journal_by_period ON journal(period, state);
CREATE INDEX IF NOT EXISTS journal_by_source ON journal(source, source_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id  INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  side        TEXT NOT NULL,             -- debit|credit, never both
  amount      REAL NOT NULL,
  memo        TEXT
);
CREATE INDEX IF NOT EXISTS lines_by_journal ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS lines_by_account ON journal_lines(account_code);

-- A posted entry is evidence. Editing one is how books stop being evidence, so
-- the database refuses it for the same reason it refuses to edit the chain.
CREATE TRIGGER IF NOT EXISTS journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'a posted entry is corrected by a reversal, never by an edit'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_delete BEFORE DELETE ON journal_lines
WHEN (SELECT state FROM journal WHERE id = OLD.journal_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'a posted entry cannot lose a line'); END;

-- What the bookkeeper has already turned into entries, so a restart does not
-- post everything a second time.
-- A standing order: something the company keeps doing without being asked
-- again. The reason is required and kept, because an order nobody can explain
-- in six months is an order nobody dares to delete.
CREATE TABLE IF NOT EXISTS standing_orders (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  goal                 TEXT NOT NULL,
  kind                 TEXT NOT NULL,      -- hunt|browse|bookkeep|request
  schedule             TEXT NOT NULL,      -- hourly|daily|weekly|monthly
  target               TEXT,
  reason               TEXT NOT NULL,
  owner                TEXT NOT NULL,
  state                TEXT NOT NULL DEFAULT 'active',  -- active|paused|expired|deleted
  paused_reason        TEXT,
  max_usd_per_run      REAL DEFAULT 1,
  lifetime_usd         REAL DEFAULT 25,
  spent_usd            REAL DEFAULT 0,
  firings              INTEGER DEFAULT 0,
  consecutive_failures INTEGER DEFAULT 0,
  last_fired           TEXT,
  last_note            TEXT,
  next_due             TEXT,
  expires_at           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS standing_due ON standing_orders(state, next_due);

-- Every firing, kept. An order that has run four hundred times and never
-- succeeded should be obvious from one glance rather than from a log dive.
CREATE TABLE IF NOT EXISTS standing_firings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  INTEGER NOT NULL,
  ok        INTEGER NOT NULL DEFAULT 1,
  note      TEXT,
  cost_usd  REAL DEFAULT 0,
  ms        INTEGER,
  fired_by  TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS standing_firings_by_order ON standing_firings(order_id, id DESC);

-- A browser session an employee drove: the goal, and every step it took.
-- Kept in full, with the picture, because "an agent did something on the web"
-- is not an acceptable answer to a question about your own company.
CREATE TABLE IF NOT EXISTS browser_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  goal        TEXT NOT NULL,
  agent_id    TEXT,
  opened_by   TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'running',  -- running|waiting|done|stopped|out-of-steps
  start_url   TEXT,
  steps       INTEGER DEFAULT 0,
  max_steps   INTEGER,
  max_usd     REAL,
  cost_usd    REAL DEFAULT 0,
  outcome     TEXT,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS browser_steps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL,
  step         INTEGER NOT NULL,
  url          TEXT,
  title        TEXT,
  action       TEXT,        -- what it did, with the secret's NAME never its value
  thought      TEXT,        -- why, in its own words, at the time
  result       TEXT,
  screenshot   TEXT,        -- what it was actually looking at
  elements     TEXT,        -- the numbered list it chose from
  gated        INTEGER NOT NULL DEFAULT 0,
  gate_reason  TEXT,
  egress_id    INTEGER,
  resolved     TEXT,        -- approved|refused
  resolved_by  TEXT,
  resolve_note TEXT,
  at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS browser_steps_by_session ON browser_steps(session_id, step);

-- A hunt: a question, and every round it took to answer it or fail to.
-- Kept because "we looked and could not find it" is a finding, and the next
-- person to ask deserves to see what was already tried rather than repeating it.
CREATE TABLE IF NOT EXISTS hunts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question    TEXT NOT NULL,
  asked_by    TEXT NOT NULL,
  agent_id    TEXT,
  state       TEXT NOT NULL DEFAULT 'running',   -- running|found|not-found
  answer      TEXT,
  confidence  REAL,
  rounds      INTEGER DEFAULT 0,
  max_rounds  INTEGER,
  max_usd     REAL,
  cost_usd    REAL DEFAULT 0,
  stopped     TEXT,                              -- why it stopped, in words
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS hunt_rounds (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  hunt_id  INTEGER NOT NULL,
  round    INTEGER NOT NULL,
  queries  TEXT NOT NULL,
  hits     INTEGER DEFAULT 0,
  verdict  TEXT,
  note     TEXT,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hunt_rounds_by_hunt ON hunt_rounds(hunt_id, round);

CREATE TABLE IF NOT EXISTS ledger_marks (
  source     TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  journal_id INTEGER,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, source_id)
);
`);

db.exec(`
-- Somebody is always on holiday. Bounded in time on purpose: a delegation with
-- no end is a permission grant with extra paperwork.
CREATE TABLE IF NOT EXISTS delegations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user  INTEGER NOT NULL,
  to_user    INTEGER NOT NULL,
  reason     TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS delegations_to ON delegations(to_user);
`);

db.exec(`
-- Content-addressed, so an edit and a revert give the same version rather than
-- a third one, and two installs running the same prompt agree without talking.
CREATE TABLE IF NOT EXISTS prompt_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT NOT NULL,
  hash       TEXT NOT NULL,
  text       TEXT NOT NULL,
  chars      INTEGER NOT NULL DEFAULT 0,
  uses       INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (agent_id, hash)
);

-- A proposed change to a tier's model chain, and what the canary made of it.
-- Proposing is not applying: something that takes effect the moment it is typed
-- cannot be looked at first.
CREATE TABLE IF NOT EXISTS tier_proposals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tier            TEXT NOT NULL,
  current_chain   TEXT NOT NULL,
  candidate_chain TEXT NOT NULL,
  note            TEXT,
  state           TEXT NOT NULL DEFAULT 'proposed',   -- proposed|tested|promoted
  results         TEXT,
  summary         TEXT,
  proposed_by     TEXT,
  promoted_by     TEXT,
  tested_at       TEXT,
  promoted_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Crypto-shredding. One row per person the company holds data about, holding
// their key wrapped under the vault's master key. Erasing them sets
// wrapped_key to NULL — the row survives so the erasure can be proved, and a
// missing row would be indistinguishable from a person nobody heard of.
db.exec(`
CREATE TABLE IF NOT EXISTS pii_subjects (
  ref         TEXT PRIMARY KEY,     -- salted one-way reference, never the identifier
  wrapped_key TEXT,                 -- NULL once shredded
  erased_at   TEXT,
  erased_by   TEXT,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
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

// ---------------------------------------------------------------------------
// The functions a company discovers it needed after somebody sued it, audited
// it, or asked it a question it could not answer. Tax, the person answerable
// for privacy, what the company owns, what it tells its customers, and what it
// admits about itself in public.
// ---------------------------------------------------------------------------
db.exec(`
-- Tax. Kept as its own thing rather than a report over the ledger, because a
-- rate belongs to a jurisdiction and a jurisdiction has a registration, a
-- threshold and a filing date — none of which are facts about an invoice.
CREATE TABLE IF NOT EXISTS tax_jurisdictions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,              -- IQ, GB, DE-BY, US-CA
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'vat',       -- vat|sales|gst|withholding|none
  rate          REAL NOT NULL DEFAULT 0,           -- per cent
  registered    INTEGER NOT NULL DEFAULT 0,        -- are we registered to collect here
  registration  TEXT,
  threshold_usd REAL NOT NULL DEFAULT 0,           -- register above this turnover
  filing        TEXT NOT NULL DEFAULT 'quarterly', -- monthly|quarterly|annual
  note          TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One tax consequence of one real event. Every line names the thing it came
-- from: a number nobody can trace to an invoice is a number nobody can defend
-- to a tax authority, which is the only audience this table has.
CREATE TABLE IF NOT EXISTS tax_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind   TEXT NOT NULL,                     -- invoice|payout|model_call|manual
  source_id     TEXT NOT NULL,
  jurisdiction  TEXT NOT NULL,
  treatment     TEXT NOT NULL,                     -- collected|paid|reverse_charge|exempt|out_of_scope
  basis         REAL NOT NULL DEFAULT 0,
  rate          REAL NOT NULL DEFAULT 0,
  amount        REAL NOT NULL DEFAULT 0,
  reason        TEXT NOT NULL,                     -- why this treatment, in words
  state         TEXT NOT NULL DEFAULT 'draft',     -- draft|posted|filed
  entry_id      INTEGER,                           -- the journal entry in the real books
  return_id     INTEGER,
  classified_by TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tax_lines_src ON tax_lines (source_kind, source_id);

CREATE TABLE IF NOT EXISTS tax_returns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  jurisdiction TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  collected    REAL NOT NULL DEFAULT 0,
  paid         REAL NOT NULL DEFAULT 0,
  net          REAL NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'open',       -- open|prepared|filed
  prepared_by  TEXT,
  filed_by     TEXT,
  filed_at     TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Privacy. A different question from security: not "is this safe" but "may we
-- hold it at all". Kept apart from the SOC on purpose — one asks about attacks,
-- the other about permission, and an install that merges them answers only the
-- first.
CREATE TABLE IF NOT EXISTS privacy_flows (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  lawful_basis  TEXT NOT NULL,                     -- consent|contract|legal_obligation|vital|public_task|legitimate_interest
  categories    TEXT NOT NULL,                     -- what kinds of data
  subjects      TEXT NOT NULL,                     -- whose
  destination   TEXT,                              -- where it ends up; a connector, a country
  connector     TEXT,
  retention_days INTEGER NOT NULL DEFAULT 0,
  crosses_border INTEGER NOT NULL DEFAULT 0,
  risk          TEXT NOT NULL DEFAULT 'medium',    -- low|medium|high
  state         TEXT NOT NULL DEFAULT 'proposed',  -- proposed|assessed|approved|refused|retired
  assessment    TEXT,
  run_id        TEXT,
  decided_by    TEXT,
  decided_at    TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A request from a person about their own data. The identifier is never stored
-- here: only the one-way reference, the same one erasure uses. Writing
-- "alice@example.com asked to be forgotten" into a table is a way of not
-- forgetting her.
CREATE TABLE IF NOT EXISTS dsr_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,                       -- access|erasure|portability|rectification|objection
  subject_ref TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'console',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'received',    -- received|working|answered|refused
  outcome     TEXT,
  export_id   INTEGER,
  handled_by  TEXT,
  answered_at TEXT,
  note        TEXT
);

-- Portability: the half of the law people build second. A copy, not a deletion.
CREATE TABLE IF NOT EXISTS data_exports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_ref  TEXT NOT NULL,
  format       TEXT NOT NULL DEFAULT 'json',
  state        TEXT NOT NULL DEFAULT 'requested',  -- requested|built|delivered|expired
  file_ref     TEXT,
  bytes        INTEGER NOT NULL DEFAULT 0,
  records      INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL,
  built_at     TEXT,
  delivered_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What the company owns that is not a thing: a name, a mark, an invention, a
-- secret. It has renewal dates, and a renewal date nobody watches is how a
-- trademark is lost.
CREATE TABLE IF NOT EXISTS ip_assets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,                      -- trademark|patent|copyright|domain|trade_secret|design
  jurisdiction TEXT,
  reference    TEXT,
  state        TEXT NOT NULL DEFAULT 'idea',       -- idea|filed|granted|registered|lapsed|abandoned|refused
  owner        TEXT NOT NULL,
  source_kind  TEXT,                               -- product|release|design|content
  source_id    TEXT,
  filed_at     TEXT,
  granted_at   TEXT,
  renewal_at   TEXT,
  cost_usd     REAL NOT NULL DEFAULT 0,
  evidence     TEXT,
  note         TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Documentation for the people who bought the product, which is not the same
-- audience as the academy and not the same job as answering a ticket.
CREATE TABLE IF NOT EXISTS help_articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  audience     TEXT NOT NULL DEFAULT 'customer',   -- customer|internal
  state        TEXT NOT NULL DEFAULT 'draft',      -- draft|review|published|retired
  locale       TEXT NOT NULL DEFAULT 'en',
  product_id   TEXT,
  source_gap   INTEGER,
  run_id       TEXT,
  views        INTEGER NOT NULL DEFAULT 0,
  deflections  INTEGER NOT NULL DEFAULT 0,         -- tickets that stopped happening
  author       TEXT NOT NULL,
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A question that keeps arriving and has no article. This is the link that
-- makes documentation pay for itself instead of being a wish.
CREATE TABLE IF NOT EXISTS help_gaps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT NOT NULL,
  category   TEXT,
  seen       INTEGER NOT NULL DEFAULT 1,
  last_ticket INTEGER,
  state      TEXT NOT NULL DEFAULT 'open',         -- open|drafted|answered|dismissed
  article_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Data governance: what a column *is*, as a governance fact rather than an
-- intelligence one. Separate from DATA, which is about finding things out.
CREATE TABLE IF NOT EXISTS data_classes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  sensitivity TEXT NOT NULL,                       -- public|internal|confidential|personal|restricted
  definition  TEXT NOT NULL,
  retain_days INTEGER NOT NULL DEFAULT 0,          -- 0 = keep
  basis       TEXT,
  owner       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_inventory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL,
  class_name  TEXT,
  personal    INTEGER NOT NULL DEFAULT 0,
  erasable    INTEGER NOT NULL DEFAULT 0,          -- does the erasure walk actually reach it
  reviewed_by TEXT,
  reviewed_at TEXT,
  note        TEXT,
  UNIQUE (table_name, column_name)
);

-- What the company says about itself to people who have not bought yet, and to
-- people who have and want to know whether it is down.
CREATE TABLE IF NOT EXISTS trust_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL,                      -- policy|report|certificate|faq|architecture
  body         TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'draft',      -- draft|review|published|retired
  evidence     TEXT,                               -- what in this system backs the claim
  owner        TEXT NOT NULL,
  run_id       TEXT,
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subprocessors (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  purpose   TEXT NOT NULL,
  location  TEXT,
  personal  INTEGER NOT NULL DEFAULT 0,
  dpa_ref   TEXT,
  state     TEXT NOT NULL DEFAULT 'active',        -- active|retired
  added_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_components (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  descr      TEXT,
  state      TEXT NOT NULL DEFAULT 'operational',  -- operational|degraded|partial|major|maintenance
  objective  TEXT,                                 -- the watchtower objective that decides it
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_notices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  impact      TEXT NOT NULL DEFAULT 'minor',       -- none|minor|major|critical
  state       TEXT NOT NULL DEFAULT 'investigating', -- investigating|identified|monitoring|resolved
  body        TEXT NOT NULL,
  component   TEXT,
  incident_id INTEGER,                             -- the internal incident it corresponds to
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  created_by  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sla_terms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  target_pct REAL NOT NULL DEFAULT 99.9,
  window_days INTEGER NOT NULL DEFAULT 30,
  credit_pct REAL NOT NULL DEFAULT 0,
  applies_to TEXT,
  objective  TEXT,
  note       TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------------------------------------------------------------------------
// The simulation — a building the workforce is actually in.
//
// The society layer already had them talking. What it had no notion of was
// *where*, and a conversation with no room in it is a feed. Put people in rooms
// and the interesting things follow on their own: who is standing next to whom,
// who never leaves their desk, which two are always in the kitchen at the same
// time, and what somebody walked away having learned.
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS sim_rooms (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'office',   -- office|meeting|social|lab|corridor
  division  TEXT,                             -- whose floor this is, if anyone's
  capacity  INTEGER NOT NULL DEFAULT 8,
  about     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Where each employee is, and how they are. Mood is not decoration: a tired
-- agent argues differently from a fresh one, and the difference is most of what
-- makes a simulated workplace read as a workplace.
CREATE TABLE IF NOT EXISTS sim_presence (
  agent_id  TEXT PRIMARY KEY,
  room_id   TEXT NOT NULL,
  mood      TEXT NOT NULL DEFAULT 'steady',   -- steady|pleased|frustrated|tired|curious|tense
  energy    INTEGER NOT NULL DEFAULT 70,      -- 0..100
  note      TEXT,                             -- what they are doing right now
  since     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sim_encounters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,                   -- work|teaching|disagreement|small_talk|review|crisis
  cast       TEXT NOT NULL,                   -- JSON agent ids
  premise    TEXT,
  tension    REAL NOT NULL DEFAULT 0,         -- 0..1, decided by the scene not by us
  state      TEXT NOT NULL DEFAULT 'writing', -- writing|played|failed
  outcome    TEXT,
  dispute_id INTEGER,                         -- if it escalated to HR
  run_id     TEXT,
  cost_usd   REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The point of the whole department. A learning is not a counter going up: it
-- is written into the agent's memory, which is recalled into its later prompts,
-- so the employee that had the conversation is afterwards a slightly different
-- employee. Without this the simulation is a soap opera.
CREATE TABLE IF NOT EXISTS sim_learnings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT NOT NULL,
  from_agent   TEXT,
  encounter_id INTEGER NOT NULL,
  learned      TEXT NOT NULL,
  mem_id       INTEGER,                       -- the row in mem_docs it became
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sim_learn_agent ON sim_learnings (agent_id, id);
`);

// ---------------------------------------------------------------------------
// Connector certification.
//
// "Which of these integrations actually works, and how do you know" is normally
// answered by a table somebody maintains, and a table somebody maintains is a
// table that says ✓ next to a connector nobody has run since March.
//
// So there is no certification table. There is an evidence table that the
// egress layer writes to automatically, and the certification is a VIEW over
// it. A fabricated certification is not refused — it is impossible: SQLite has
// nowhere to put it. That is a stronger guarantee than a trigger, which can be
// dropped by anything holding the connection that wants to insert.
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS connector_evidence (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  connector   TEXT NOT NULL,
  capability  TEXT NOT NULL,   -- read|write|oauth|failure|rate_limit|token_lifecycle
  operation   TEXT,            -- the capability id the caller asked for
  mode        TEXT NOT NULL CHECK (mode IN ('mock','paper','sandbox','live')),
  outcome     TEXT NOT NULL CHECK (outcome IN ('ok','failed','blocked')),
  detail      TEXT,
  egress_id   INTEGER,         -- the egress_log row this came from, when there is one
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS connector_evidence_lookup ON connector_evidence (connector, capability, id);

CREATE VIEW IF NOT EXISTS connector_certification AS
SELECT
  connector,
  capability,
  -- The ladder: the highest mode at which this dimension was exercised and
  -- worked. A failure never promotes anything.
  CASE MAX(CASE WHEN outcome = 'ok' THEN
      CASE mode WHEN 'live' THEN 4 WHEN 'sandbox' THEN 3 WHEN 'paper' THEN 2 WHEN 'mock' THEN 1 ELSE 0 END
    ELSE 0 END)
    WHEN 4 THEN 'live-verified'
    WHEN 3 THEN 'sandbox-verified'
    WHEN 2 THEN 'paper-verified'
    WHEN 1 THEN 'mock-only'
    ELSE 'untested'
  END AS state,
  COUNT(*)                                                        AS observations,
  SUM(CASE WHEN outcome = 'ok'      THEN 1 ELSE 0 END)             AS successes,
  SUM(CASE WHEN outcome = 'failed'  THEN 1 ELSE 0 END)             AS failures,
  SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END)             AS blocked,
  MAX(CASE WHEN outcome = 'failed' THEN occurred_at END)           AS last_failure_at,
  MAX(CASE WHEN outcome = 'failed' THEN detail END)                AS last_failure,
  MAX(occurred_at)                                                 AS last_seen_at
FROM connector_evidence
GROUP BY connector, capability;
`);

// ===========================================================================
// CORE 2 — ENTERPRISE OPERATIONS
//
// Core 1 thinks and acts. Core 2 records what is true and undisputed about the
// company: who is employed and on what terms, who owns what, who is owed what.
// One database file, two schemas, told apart by a prefix — the same modular
// monolith argument Core 1 already makes for itself.
//
// Everything below is STRICT. That is not tidiness: it is the whole enforcement
// of the rule that an AI agent may never occupy a slot meant for a human being.
// Agents have TEXT ids ('AGT-ARC-001'); people have INTEGER ones. In an ordinary
// SQLite table those are interchangeable, because SQLite will cheerfully store a
// string in an INTEGER column. Under STRICT it refuses, at the storage engine,
// in every code path, including one written next year by somebody who never read
// this comment. A trigger can be dropped; a column type cannot.
// ===========================================================================
db.exec(`
-- The root identifier for a human being. Everything else about a person hangs
-- off this: an employee record, a login, a candidate application. A person may
-- have any combination of those, or none — a former employee kept for record is
-- a person with no user and no current employment, and that has to be
-- representable or the model is lying about the world.
--
-- Note what is NOT here: names are Tier B and stay readable, because every
-- screen and every report groups by them. The identifying details that would
-- let somebody impersonate or locate this person are Tier A and sealed at
-- write, under this person's own key.
CREATE TABLE IF NOT EXISTS hr_person (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name  TEXT NOT NULL,                    -- Tier B: every report groups by it
  subject_ref   TEXT,                             -- one-way, the erasure join key
  personal_email TEXT,                            -- Tier A
  personal_phone TEXT,                            -- Tier A
  national_id   TEXT,                             -- Tier A
  emergency_contact TEXT,                         -- Tier A
  -- 'person' is the only kind. The column exists so a future non-human party
  -- cannot be smuggled in by widening the meaning of this table quietly.
  kind          TEXT NOT NULL DEFAULT 'person' CHECK (kind = 'person'),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','erased')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX IF NOT EXISTS hr_person_subject ON hr_person (subject_ref);

-- Employment: the terms, not the human. A person can be employed twice over a
-- career, so this is a record of a relationship with an end date, not a flag on
-- the person.
CREATE TABLE IF NOT EXISTS hr_employee (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id     INTEGER NOT NULL REFERENCES hr_person(id),
  employee_no   TEXT NOT NULL UNIQUE,
  org_unit_id   INTEGER REFERENCES hr_org_unit(id),
  position_id   INTEGER REFERENCES hr_position(id),
  grade_id      INTEGER REFERENCES hr_grade(id),
  -- A reporting line points at another *employment*, never at a name and never
  -- at an agent. An org chart with an AI on it is the failure this whole
  -- identity model exists to make impossible.
  manager_id    INTEGER REFERENCES hr_employee(id),
  employment    TEXT NOT NULL DEFAULT 'full-time'
                CHECK (employment IN ('full-time','part-time','contract','intern','fractional')),
  state         TEXT NOT NULL DEFAULT 'active'
                CHECK (state IN ('pending','active','suspended','notice','ended')),
  bank_account  TEXT,                             -- Tier A
  base_salary   TEXT,                             -- Tier A, sealed: a number nobody may read from the disk
  currency      TEXT NOT NULL DEFAULT 'USD',
  hired_at      TEXT,
  ended_at      TEXT,
  -- Employment holds Tier A values but carries no identifier of its own, so the
  -- erasure walk reaches these rows by reference rather than by comparison —
  -- the same mechanism the intelligence provenance rows use.
  subject_ref   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX IF NOT EXISTS hr_employee_person ON hr_employee (person_id);
CREATE INDEX IF NOT EXISTS hr_employee_manager ON hr_employee (manager_id);
CREATE INDEX IF NOT EXISTS hr_employee_unit ON hr_employee (org_unit_id);

-- The org chart: units, positions, grades. Separate tables because they change
-- on different clocks — a company reorganises its units far more often than it
-- redefines what a grade means.
CREATE TABLE IF NOT EXISTS hr_org_unit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT UNIQUE,
  parent_id   INTEGER REFERENCES hr_org_unit(id),
  -- Which Core 1 department this unit answers to, when there is one. The map
  -- reads this, so a unit is joined to the company rather than floating.
  core1_section TEXT,
  head_employee_id INTEGER REFERENCES hr_employee(id),
  state       TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS hr_position (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  org_unit_id INTEGER REFERENCES hr_org_unit(id),
  grade_id    INTEGER REFERENCES hr_grade(id),
  headcount   INTEGER NOT NULL DEFAULT 1,
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','filled','frozen','closed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS hr_grade (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  rank        INTEGER NOT NULL,
  band_min    REAL,
  band_max    REAL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Documents and the knowledge base.
--
-- The design question this table answers — the one that kept it out of the
-- first Phase 1 commit — is: who may read version 3 of a document attached to
-- a disciplinary record? The answer has two halves and both live here:
--
--   The permission half. Classification maps to a permission at the route, so
--   a confidential document is unreadable to somebody who could not open the
--   screen. That guards the app.
--
--   The sealing half. A document *about a person* with classification
--   'restricted' has the body of every version sealed under that person's own
--   key — the doctor's-note case from the directive's data-minimization rule.
--   That guards the disk, and it means erasing the person takes the document's
--   contents with them while the fact of its existence survives.
--
-- Versions are append-only. A shipped version is never edited, for the same
-- reason a shipped migration never is: a version history you can rewrite is a
-- history, not a record.
CREATE TABLE IF NOT EXISTS doc_document (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'internal'
                 CHECK (classification IN ('public','internal','confidential','restricted')),
  -- Who this document is ABOUT, when it is about somebody. Integer, STRICT:
  -- an agent cannot be the subject of a personnel document either.
  subject_person_id INTEGER REFERENCES hr_person(id),
  subject_ref    TEXT,                              -- the erasure join key, carried from the person
  current_version INTEGER NOT NULL DEFAULT 0,
  state          TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX IF NOT EXISTS doc_document_subject ON doc_document (subject_ref);

CREATE TABLE IF NOT EXISTS doc_version (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL REFERENCES doc_document(id),
  version      INTEGER NOT NULL,
  body         TEXT,                                -- sealed when the document is restricted-about-a-person
  note         TEXT,                                -- why this version exists; never sealed, never personal
  subject_ref  TEXT,                                -- carried so erasure reaches old versions too
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, version)
) STRICT;

CREATE INDEX IF NOT EXISTS doc_version_doc ON doc_version (document_id, version);
CREATE INDEX IF NOT EXISTS doc_version_subject ON doc_version (subject_ref);

-- TIME: attendance, shifts, and leave.
--
-- Two design rules carried through every table here:
--
--   References to humans are INTEGER employee ids in STRICT tables, so the
--   attendance sheet and the leave calendar cannot contain an agent any more
--   than the org chart can.
--
--   There is no free-text reason column anywhere in leave. A sick request is a
--   category plus, optionally, a reference to a doctor's note held as a sealed
--   restricted document. That is the directive's data-minimization rule made
--   structural: the platform cannot summarize, report on, or reason about
--   anyone's health, because there is no field in which health details exist.
CREATE TABLE IF NOT EXISTS time_shift (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  starts     TEXT NOT NULL,                       -- 'HH:MM'
  ends       TEXT NOT NULL,
  days       TEXT NOT NULL DEFAULT '[1,2,3,4,5]', -- JSON, 0=Sunday
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS time_attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  day         TEXT NOT NULL,                      -- 'YYYY-MM-DD'
  in_at       TEXT,
  out_at      TEXT,
  minutes     INTEGER,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  UNIQUE (employee_id, day)
) STRICT;

CREATE TABLE IF NOT EXISTS time_leave_policy (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  leave_type     TEXT NOT NULL CHECK (leave_type IN ('annual','sick','unpaid','unpaid-medical','parental','bereavement')),
  days_per_year  REAL NOT NULL DEFAULT 0,
  carry_forward_max REAL NOT NULL DEFAULT 0,
  needs_document INTEGER NOT NULL DEFAULT 0,      -- a doctor's note, as a sealed doc reference
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS time_leave_balance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  policy_id   INTEGER NOT NULL REFERENCES time_leave_policy(id),
  year        INTEGER NOT NULL,
  entitled    REAL NOT NULL DEFAULT 0,
  used        REAL NOT NULL DEFAULT 0,
  UNIQUE (employee_id, policy_id, year)
) STRICT;

CREATE TABLE IF NOT EXISTS time_leave_request (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  policy_id   INTEGER NOT NULL REFERENCES time_leave_policy(id),
  starts      TEXT NOT NULL,
  ends        TEXT NOT NULL,
  days        REAL NOT NULL,
  -- The only narrative allowed is a pointer to a sealed document. No note, no
  -- reason, no diagnosis — deliberately unrepresentable.
  doc_id      INTEGER REFERENCES doc_document(id),
  state       TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','cancelled')),
  decided_by  TEXT,                               -- always a human actor; asserted in code
  decided_at  TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX IF NOT EXISTS time_leave_request_emp ON time_leave_request (employee_id, state);
CREATE INDEX IF NOT EXISTS time_attendance_day ON time_attendance (day);

-- MEETINGS. Participants are employments, by integer id, so an agent cannot be
-- a participant of record — the same bar as the org chart, enforced the same
-- way. The transcript is Tier A, sealed under the organizer's key; the
-- multi-subject limitation that creates is recorded in NEXT.md rather than
-- hidden.
-- Who is on which shift, and since when. Dated rather than replaced, so
-- last month's attendance is still judged against the roster that was actually
-- in force then — overwriting would rewrite whether somebody was late in March.
CREATE TABLE IF NOT EXISTS time_shift_assignment (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  shift_id    INTEGER NOT NULL REFERENCES time_shift(id),
  since       TEXT NOT NULL,
  until       TEXT,
  assigned_by TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS shift_assignment_live ON time_shift_assignment(employee_id, since, until);

-- Extra minutes are not overtime until somebody approves them. Paying every
-- late departure teaches everybody to leave late.
CREATE TABLE IF NOT EXISTS time_overtime (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  day         TEXT NOT NULL,
  minutes     INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'claimed',    -- claimed|approved|refused
  claimed_by  TEXT NOT NULL,
  decided_by  TEXT,
  decided_at  TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, day)
);

-- What a company deducts, and on whose authority. Either a flat percentage or
-- a set of bands; the basis is required because a deduction nobody can cite is
-- one the employee may dispute and the company cannot defend.
CREATE TABLE IF NOT EXISTS pay_rule (
  code         TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'tax',        -- tax|contribution
  base         TEXT NOT NULL DEFAULT 'gross',      -- gross|basic|taxable
  paid_by      TEXT NOT NULL DEFAULT 'employee',   -- employee|employer
  percent      REAL,                               -- flat rules
  bands        TEXT,                               -- JSON, progressive rules
  cap_amount   REAL,
  floor_amount REAL,
  basis        TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Custody: who is holding what. The asset itself stays in Core 1's register —
-- one master — and this is the handover.
CREATE TABLE IF NOT EXISTS cust_item (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES hr_employee(id),
  asset_id      INTEGER,                           -- Core 1 assets.id, when listed
  description   TEXT,                              -- when it is not: keys, a card
  serial        TEXT,
  condition_out TEXT NOT NULL DEFAULT 'good',
  condition_in  TEXT,
  note          TEXT,
  return_note   TEXT,
  issued_by     TEXT NOT NULL,
  issued_at     TEXT NOT NULL DEFAULT (datetime('now')),
  returned_to   TEXT,
  returned_at   TEXT
);
CREATE INDEX IF NOT EXISTS cust_out ON cust_item(employee_id, returned_at);
CREATE INDEX IF NOT EXISTS cust_asset ON cust_item(asset_id, returned_at);

-- A first day and a last day, as a checklist rather than as somebody's memory.
CREATE TABLE IF NOT EXISTS join_list (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  kind        TEXT NOT NULL,                       -- joining|leaving
  on_day      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open',        -- open|closed
  started_by  TEXT NOT NULL,
  closed_by   TEXT,
  closed_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS join_step (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id    INTEGER NOT NULL REFERENCES join_list(id),
  code       TEXT NOT NULL,
  label      TEXT NOT NULL,
  owner_role TEXT,
  due_on     TEXT,
  -- A step that costs money or opens a door. Skippable, but never silently.
  critical   INTEGER NOT NULL DEFAULT 0,
  done_at    TEXT,
  done_by    TEXT,
  skipped    INTEGER NOT NULL DEFAULT 0,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS join_step_by_list ON join_step(list_id, due_on);

-- A file, sealed. The row is a manifest; the bytes live under data/files/
-- encrypted with the subject's own key, so erasing the person destroys the
-- file rather than orphaning it. Deleting is a tombstone, never a vanishing:
-- a gap somebody can see beats a gap nobody can.
CREATE TABLE IF NOT EXISTS doc_file (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL,
  mime          TEXT,
  bytes         INTEGER NOT NULL,
  sha256        TEXT NOT NULL,          -- of the plaintext, so duplicates are visible
  subject_ref   TEXT NOT NULL,          -- whose key seals it
  stored_as     TEXT NOT NULL UNIQUE,   -- a uuid; never anything a caller chose
  attach_type   TEXT,
  attach_id     INTEGER,
  note          TEXT,
  uploaded_by   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  deleted_by    TEXT,
  delete_reason TEXT
);
CREATE INDEX IF NOT EXISTS doc_file_attached ON doc_file(attach_type, attach_id);
CREATE INDEX IF NOT EXISTS doc_file_subject ON doc_file(subject_ref);

-- How long each kind of record is kept, and on whose authority. A retention
-- period nobody can cite is a guess with a number on it.
CREATE TABLE IF NOT EXISTS rec_class (
  code         TEXT PRIMARY KEY,        -- payroll, contract, medical, tax…
  label        TEXT NOT NULL,
  keep_months  INTEGER NOT NULL,
  disposition  TEXT NOT NULL DEFAULT 'destroy',   -- destroy|anonymise|keep-forever
  basis        TEXT NOT NULL,           -- the law, contract or policy that says so
  applies_to   TEXT,                    -- JSON: which tables/attach kinds it covers
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A legal hold freezes disposal. It is deliberately coarse: a hold that is hard
-- to place is a hold nobody places in time.
CREATE TABLE IF NOT EXISTS rec_hold (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_kind   TEXT NOT NULL,           -- person|employee|class|everything
  scope_id     TEXT,
  reason       TEXT NOT NULL,           -- required: a hold nobody can explain never lifts
  matter       TEXT,                    -- the case or investigation it belongs to
  placed_by    TEXT NOT NULL,
  placed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  released_by  TEXT,
  released_at  TEXT,
  release_note TEXT
);
CREATE INDEX IF NOT EXISTS rec_hold_live ON rec_hold(scope_kind, scope_id, released_at);

-- What was actually disposed of, and under which rule. The disposal log is the
-- only evidence that a retention policy is a policy rather than a document.
CREATE TABLE IF NOT EXISTS rec_disposal (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  class_code  TEXT NOT NULL,
  what        TEXT NOT NULL,
  ref         TEXT,
  action      TEXT NOT NULL,            -- destroyed|anonymised
  count       INTEGER NOT NULL DEFAULT 1,
  decided_by  TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mtg_meeting (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  agenda       TEXT,
  scheduled_at TEXT NOT NULL,
  organizer_employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  state        TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','running','completed','cancelled')),
  transcript   TEXT,                              -- Tier A when present
  subject_ref  TEXT,                              -- the organizer's, for erasure
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS mtg_participant (
  meeting_id  INTEGER NOT NULL REFERENCES mtg_meeting(id),
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  UNIQUE (meeting_id, employee_id)
) STRICT;

CREATE TABLE IF NOT EXISTS mtg_action (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES mtg_meeting(id),
  kind        TEXT NOT NULL DEFAULT 'action' CHECK (kind IN ('action','decision')),
  what        TEXT NOT NULL,
  owner_employee_id INTEGER REFERENCES hr_employee(id),
  due         TEXT,
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','dropped')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX IF NOT EXISTS mtg_meeting_sched ON mtg_meeting (scheduled_at);
CREATE INDEX IF NOT EXISTS mtg_meeting_subject ON mtg_meeting (subject_ref);

-- FINANCE OPS: cost centers, expenses, loans, payroll.
--
-- What is deliberately NOT here: a journal entry. Core 2 never posts to the
-- ledger — it emits an event, and the bridge hands it to Core 1's ledger with
-- the same journalEntry() call an accountant uses. One ledger, one master.
--
-- Money classifications, decided and recorded rather than felt:
--   Expense amounts are Tier B — company transactions the ledger will carry in
--   plaintext anyway, and cost-center reports must sum them in SQL.
--   Payroll SLIPS are Tier A — an individual's pay is theirs, sealed under
--   their key. Run TOTALS are Tier B, because the ledger entry that the close
--   posts shows the aggregate regardless; sealing a number the ledger prints
--   would be theatre.
CREATE TABLE IF NOT EXISTS fin_cost_center (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  budget_usd REAL NOT NULL DEFAULT 0,
  state      TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS fin_expense (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    INTEGER NOT NULL REFERENCES hr_employee(id),
  cost_center_id INTEGER REFERENCES fin_cost_center(id),
  kind           TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','advance')),
  category       TEXT NOT NULL DEFAULT 'other',
  amount         REAL NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'USD',
  state          TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted','approved','rejected','paid')),
  submitted_by   TEXT NOT NULL,
  decided_by     TEXT,
  decided_at     TEXT,
  paid_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS pay_loan (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  principal   REAL NOT NULL,
  monthly     REAL NOT NULL,
  balance     REAL NOT NULL,
  state       TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','settled')),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS pay_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL UNIQUE,             -- 'YYYY-MM'
  state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','closed')),
  total_gross REAL NOT NULL DEFAULT 0,
  total_net   REAL NOT NULL DEFAULT 0,
  approved_by TEXT,                             -- a human, always; asserted in code
  closed_at   TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS pay_slip (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES pay_run(id),
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  detail      TEXT NOT NULL,                    -- Tier A: sealed JSON of the whole computation
  subject_ref TEXT,
  UNIQUE (run_id, employee_id)
) STRICT;

CREATE INDEX IF NOT EXISTS pay_slip_subject ON pay_slip (subject_ref);

-- PROCUREMENT: request → approval → PO → delivery → invoice → payment.
-- Vendors stay in Core 1's existing table — one vendor record, one master.
CREATE TABLE IF NOT EXISTS proc_request (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  vendor_id      TEXT,                          -- Core 1 vendors.id (slug), when chosen
  cost_center_id INTEGER REFERENCES fin_cost_center(id),
  amount         REAL NOT NULL DEFAULT 0,
  state          TEXT NOT NULL DEFAULT 'requested'
                 CHECK (state IN ('requested','approved','po','delivered','invoiced','paid','rejected')),
  po_no          TEXT,
  requested_by   TEXT NOT NULL,
  decided_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- PEOPLE LIFECYCLE: recruitment, onboarding, performance, training.
--
-- An applicant is an hr_person — the candidate-only combination the identity
-- model was built to hold — never a row in Core 1's candidates table, which
-- hires AI agents. Two pipelines, two species, one department page. Sharing
-- the table would have put humans and agents in one identity pool, which is
-- the exact thing §4 exists to prevent.
--
-- There is no evaluation free-text anywhere here. Interview notes and CVs are
-- sealed restricted documents referenced by id; a rejection is a state with a
-- name behind it, not a paragraph that outlives the person it judges.
CREATE TABLE IF NOT EXISTS rec_vacancy (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  position_id INTEGER REFERENCES hr_position(id),
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','frozen','filled','closed')),
  opened_by   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS rec_application (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vacancy_id  INTEGER NOT NULL REFERENCES rec_vacancy(id),
  person_id   INTEGER NOT NULL REFERENCES hr_person(id),
  state       TEXT NOT NULL DEFAULT 'applied'
              CHECK (state IN ('applied','screening','interview','offer','hired','rejected')),
  doc_id      INTEGER REFERENCES doc_document(id),   -- CV / notes, sealed
  decided_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (vacancy_id, person_id)
) STRICT;

CREATE TABLE IF NOT EXISTS rec_task (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  kind        TEXT NOT NULL DEFAULT 'onboard' CHECK (kind IN ('onboard','offboard')),
  what        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','done')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Performance. The evidence is a summary an AI may draft from tasks, meetings
-- and goals; the RATING is a human judgment, always, and the two live in
-- different columns so the bar is a column away from the text rather than a
-- sentence in a policy. Evidence is Tier A — it is a paragraph about a person.
CREATE TABLE IF NOT EXISTS perf_objective (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  title       TEXT NOT NULL,
  due         TEXT,
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','met','missed','dropped')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS perf_review (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  period      TEXT NOT NULL,
  evidence    TEXT,                                  -- Tier A, sealed; AI may draft it
  rating      INTEGER,                               -- a human wrote this or nobody did
  rated_by    TEXT,
  subject_ref TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, period)
) STRICT;

CREATE INDEX IF NOT EXISTS perf_review_subject ON perf_review (subject_ref);

CREATE TABLE IF NOT EXISTS lrn_course (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  expires_months INTEGER NOT NULL DEFAULT 0,         -- 0: never expires
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS lrn_certificate (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  course_id   INTEGER NOT NULL REFERENCES lrn_course(id),
  earned_at   TEXT NOT NULL,
  expires_at  TEXT,
  UNIQUE (employee_id, course_id, earned_at)
) STRICT;

-- Core 2's own operational log: every field change, every read of something
-- sensitive. Deliberately NOT the audit chain — chaining an attendance ping is
-- noise that makes the real signal harder to audit. The consequential subset is
-- mirrored onto Core 1's chain by the audit bridge, and only that subset.
CREATE TABLE IF NOT EXISTS core2_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  action      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  detail      TEXT,
  chained     INTEGER NOT NULL DEFAULT 0,        -- did this also go on Core 1's chain
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX IF NOT EXISTS core2_log_entity ON core2_log (entity, entity_id, id);
`);

// The second half of the agent bar.
//
// STRICT stops an agent id reaching an INTEGER person column, which covers every
// structural reference. It cannot cover the TEXT columns that legitimately hold
// an actor string — Core 1 writes 'human:zaid' and 'AGT-SUP-001' into the same
// shaped field all over the platform. So where a Core 2 column means *a human
// did this*, a trigger refuses anything that looks like an employee of the other
// kind. Belt and braces, because the two failure modes are different: one is a
// type error, the other is a lie.
//
// The name is checked as well as the id, and that is a deliberate choice with a
// cost. An agent's name in this platform is a role title — "Solution Architect",
// "Backend Engineer" — so a *person* by that name is not a person, it is
// somebody creating a proxy row to put an AI on the org chart. Blocking it can
// in principle refuse a real employee whose name collides with an agent's; that
// is a rename away, and it is the right way round to be wrong.
for (const sql of [
  'DROP TRIGGER IF EXISTS hr_person_never_an_agent',
  'DROP TRIGGER IF EXISTS hr_person_never_an_agent_upd',
  `CREATE TRIGGER hr_person_never_an_agent
   BEFORE INSERT ON hr_person
   WHEN NEW.display_name GLOB 'AGT-*'
     OR EXISTS (SELECT 1 FROM agents WHERE id = NEW.display_name OR name = NEW.display_name)
   BEGIN SELECT RAISE(ABORT, 'an AI agent cannot be recorded as a person'); END`,
  `CREATE TRIGGER hr_person_never_an_agent_upd
   BEFORE UPDATE ON hr_person
   WHEN NEW.display_name GLOB 'AGT-*'
     OR EXISTS (SELECT 1 FROM agents WHERE id = NEW.display_name OR name = NEW.display_name)
   BEGIN SELECT RAISE(ABORT, 'an AI agent cannot be recorded as a person'); END`,
]) { try { db.exec(sql); } catch { /* older SQLite, or nothing to drop */ } }

// Core 1's own roster and login table gain a pointer to the person they are
// about. Additive on purpose: nothing in Core 1 has to change, and the same
// human stops being two unrelated rows in two galaxies.
for (const sql of [
  'ALTER TABLE users ADD COLUMN person_id INTEGER',
  'ALTER TABLE people ADD COLUMN person_id INTEGER',
  'CREATE INDEX IF NOT EXISTS users_person ON users (person_id)',
  'CREATE INDEX IF NOT EXISTS people_person ON people (person_id)',
]) { try { db.exec(sql); } catch { /* already applied */ } }

// Where each room sits on the floor. Kept in the database rather than in the
// page, because a floor plan drawn by the view is a picture that drifts from the
// building — the same reason the map is generated from the catalogue.
for (const sql of [
  'ALTER TABLE sim_rooms ADD COLUMN gx INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE sim_rooms ADD COLUMN gy INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE sim_rooms ADD COLUMN gw INTEGER NOT NULL DEFAULT 3',
  'ALTER TABLE sim_rooms ADD COLUMN gh INTEGER NOT NULL DEFAULT 2',
]) { try { db.exec(sql); } catch { /* column exists */ } }

// Growth needs a few facts an A/B row did not carry: what was being moved, for
// whom, and what was decided afterwards. A winner nobody acted on is a result,
// not an experiment.
for (const sql of [
  // The Lab and Growth run different experiments over the same shape: one
  // compares two prompts, the other compares two things a customer sees. Same
  // table, named apart, because "which variant won" means something different
  // in each and a mixed list answers neither question.
  "ALTER TABLE experiments ADD COLUMN kind TEXT NOT NULL DEFAULT 'lab'",
  'ALTER TABLE experiments ADD COLUMN metric TEXT',
  'ALTER TABLE experiments ADD COLUMN audience TEXT',
  'ALTER TABLE experiments ADD COLUMN baseline REAL',
  'ALTER TABLE experiments ADD COLUMN uplift REAL',
  'ALTER TABLE experiments ADD COLUMN decision TEXT',
  'ALTER TABLE experiments ADD COLUMN product_id TEXT',
  'ALTER TABLE experiments ADD COLUMN concluded_at TEXT',
  // Partnerships: a relationship is worth having only if something flows
  // through it, so the deal it produced is named on the partner.
  'ALTER TABLE partners ADD COLUMN integration TEXT',
  'ALTER TABLE partners ADD COLUMN agreement_ref TEXT',
  'ALTER TABLE partners ADD COLUMN reviewed_at TEXT',

  // Personal data at rest. Two tiers, and the inventory is where the judgement
  // is recorded with a name against it: 'A' is sealed at write under the
  // person's own key, 'B' is plaintext by design because the company has to
  // match on it. NULL means nobody has ruled on this column yet, which is the
  // correct state for one that arrived last week.
  'ALTER TABLE data_inventory ADD COLUMN tier TEXT',
  'ALTER TABLE data_inventory ADD COLUMN sealed_at_write INTEGER NOT NULL DEFAULT 0',

  // A person on file needs a reference that is not their name. The customers
  // table stores no identifier by design, which is the right instinct and
  // leaves nothing to seal *under* — so the one-way reference erasure already
  // derives is stored here at write, and only that.
  'ALTER TABLE customers ADD COLUMN subject_ref TEXT',
  // Same for an intelligence contact, where it does a second job: two sightings
  // of the same person can no longer be matched on a sealed email, so they are
  // matched on the reference derived from it instead.
  'ALTER TABLE intel_contacts ADD COLUMN subject_ref TEXT',
  'ALTER TABLE intel_records ADD COLUMN subject_ref TEXT',
  'ALTER TABLE tickets ADD COLUMN subject_ref TEXT',
  'ALTER TABLE calls ADD COLUMN subject_ref TEXT',
  'ALTER TABLE sms_messages ADD COLUMN subject_ref TEXT',
  // The provenance trail an enrichment run leaves: about a person, containing
  // their address, and never equal to it — so it is reached by reference.
  'ALTER TABLE intel_evidence ADD COLUMN subject_ref TEXT',
  // A run about a person carries their reference, so its prompt and its answer
  // are sealed under the same key as the row that caused it.
  'ALTER TABLE runs ADD COLUMN subject_ref TEXT',
  // Contracts gain a hard expiry so renewals can be watched the way the IP
  // department already watches its own renewal dates. The table stays Core 1s;
  // one contract record, one master.
  'ALTER TABLE contracts ADD COLUMN expires_at TEXT',
  'ALTER TABLE contracts ADD COLUMN obligations TEXT',
]) { try { db.exec(sql); } catch { /* column exists */ } }

// Finding everything held about one person is a scan today. These make it a
// lookup, and the backfill below leans on them heavily.
for (const sql of [
  'CREATE INDEX IF NOT EXISTS customers_subject ON customers (subject_ref)',
  'CREATE INDEX IF NOT EXISTS intel_contacts_subject ON intel_contacts (subject_ref)',
  'CREATE INDEX IF NOT EXISTS intel_records_subject ON intel_records (subject_ref)',
  'CREATE INDEX IF NOT EXISTS tickets_subject ON tickets (subject_ref)',
  'CREATE INDEX IF NOT EXISTS calls_subject ON calls (subject_ref)',
  'CREATE INDEX IF NOT EXISTS sms_messages_subject ON sms_messages (subject_ref)',
  'CREATE INDEX IF NOT EXISTS intel_evidence_subject ON intel_evidence (subject_ref)',
  'CREATE INDEX IF NOT EXISTS runs_subject ON runs (subject_ref)',
]) { try { db.exec(sql); } catch { /* index exists */ } }

// ---------------------------------------------------------------------------
// Core 2, the rest of the company: time rules, compensation, the finance
// sub-ledgers, the bank, operations, and administration.
//
// Same rules as the first block. STRICT throughout; every reference to a human
// is an INTEGER employment id; every amount that is about one person is TEXT
// because it is sealed; and there is no column anywhere for a reason, a note,
// a diagnosis, or a judgement about somebody. Where words are needed they are a
// pointer to a document that is sealed under the person it is about.
//
// The ledger is still Core 1's. Nothing here holds a debit; the tables that
// touch money hold facts (a bill, a receipt, a transfer) and the bridge turns
// the fact into an entry.
// ---------------------------------------------------------------------------
db.exec(`
-- TIME RULES: the calendar, shifts assigned to people, overtime and corrections
CREATE TABLE IF NOT EXISTS hr_holiday (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL UNIQUE,                -- 'YYYY-MM-DD'
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Shifts, their assignments and overtime claims are shifts.js's tables,
-- declared with the earlier Core 2 block; this block adds only what they lack.

-- A correction is a claimed in/out pair waiting on a manager. No reason column:
-- the manager sees the claim and the day, decides, and their name is recorded.
CREATE TABLE IF NOT EXISTS time_correction (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  day         TEXT NOT NULL,
  in_at       TEXT,
  out_at      TEXT,
  state       TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  decided_by  TEXT,
  decided_at  TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- COMPENSATION: allowances, benefits, salary history, movements, tax, end of service.
CREATE TABLE IF NOT EXISTS hr_allowance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  kind        TEXT NOT NULL CHECK (kind IN ('housing','transport','phone','meal','hardship','other')),
  amount      REAL NOT NULL,                      -- Tier B: a policy figure, not a salary
  currency    TEXT NOT NULL DEFAULT 'USD',
  starts      TEXT NOT NULL,
  ends        TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS hr_allowance_emp ON hr_allowance (employee_id);

CREATE TABLE IF NOT EXISTS hr_benefit_plan (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('health','life','pension','social','other')),
  employer_share REAL NOT NULL DEFAULT 0,         -- per month, per enrolled employee
  employee_share REAL NOT NULL DEFAULT 0,
  provider       TEXT,
  state          TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Enrollment is a fact about a plan and a person. It carries no health detail
-- and cannot: there is no column for it.
CREATE TABLE IF NOT EXISTS hr_benefit_enrollment (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  plan_id     INTEGER NOT NULL REFERENCES hr_benefit_plan(id),
  starts      TEXT NOT NULL,
  ends        TEXT,
  created_by  TEXT NOT NULL,
  UNIQUE (employee_id, plan_id, starts)
) STRICT;

-- Salary history. Both figures sealed under the person; what is readable is
-- that a change happened, when, and who made it. Chained as a fact.
CREATE TABLE IF NOT EXISTS hr_salary_change (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  old_salary  TEXT,                               -- Tier A
  new_salary  TEXT,                               -- Tier A
  effective   TEXT NOT NULL,
  changed_by  TEXT NOT NULL,                      -- a human, always; asserted in code
  subject_ref TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS hr_salary_change_subject ON hr_salary_change (subject_ref);

CREATE TABLE IF NOT EXISTS hr_movement (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES hr_employee(id),
  kind          TEXT NOT NULL CHECK (kind IN ('promotion','transfer','regrade','demotion','acting')),
  from_unit     INTEGER REFERENCES hr_org_unit(id),
  to_unit       INTEGER REFERENCES hr_org_unit(id),
  from_position INTEGER REFERENCES hr_position(id),
  to_position   INTEGER REFERENCES hr_position(id),
  from_grade    INTEGER REFERENCES hr_grade(id),
  to_grade      INTEGER REFERENCES hr_grade(id),
  effective     TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Tax and contribution rules are payrules.js's pay_rule table; the slip reads them.

-- End of service. The amount is about one person and is sealed under them;
-- the years of service are an org fact and stay readable.
CREATE TABLE IF NOT EXISTS hr_eos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL UNIQUE REFERENCES hr_employee(id),
  years       REAL NOT NULL,
  days_per_year REAL NOT NULL,
  amount      TEXT,                               -- Tier A
  subject_ref TEXT,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_by     TEXT,
  paid_at     TEXT
) STRICT;

-- A grievance is a sealed document plus a state machine with a name at each
-- step. The words live in the document, under the person's key, and nowhere else.
CREATE TABLE IF NOT EXISTS hr_grievance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  doc_id      INTEGER NOT NULL REFERENCES doc_document(id),
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','under_review','resolved','dismissed')),
  opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by  TEXT,
  decided_at  TEXT
) STRICT;

-- Who holds which of the company's things is custody.js's cust_item.

-- FINANCE SUB-LEDGERS. Budgets, payables, receivables, fixed assets, FX.
-- The statements are Core 1's ledger and are not duplicated here.
CREATE TABLE IF NOT EXISTS fin_budget (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  period      TEXT NOT NULL,                      -- 'YYYY' | 'YYYY-Qn' | 'YYYY-MM'
  state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','closed')),
  approved_by TEXT,                               -- a human, always
  approved_at TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS fin_budget_line (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id      INTEGER NOT NULL REFERENCES fin_budget(id),
  account_code   TEXT NOT NULL,                   -- Core 1 accounts.code
  cost_center_id INTEGER REFERENCES fin_cost_center(id),
  amount         REAL NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS fin_budget_line_budget ON fin_budget_line (budget_id);

CREATE TABLE IF NOT EXISTS fin_ap_bill (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id    TEXT NOT NULL,                     -- Core 1 vendors.id (slug)
  ref          TEXT NOT NULL,
  amount       REAL NOT NULL,
  tax          REAL NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'USD',
  account_code TEXT NOT NULL DEFAULT '5100',
  issued       TEXT NOT NULL,
  due          TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','paid','void')),
  approved_by  TEXT,
  paid_at      TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (vendor_id, ref)
) STRICT;

CREATE TABLE IF NOT EXISTS fin_ar_invoice (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ref         TEXT NOT NULL UNIQUE,               -- AR-2026-0001
  customer_id INTEGER,                            -- Core 1 customers.id
  description TEXT NOT NULL,
  amount      REAL NOT NULL,
  tax         REAL NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'USD',
  issued      TEXT,
  due         TEXT,
  state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','issued','paid','void')),
  paid_amount REAL NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS fin_ar_receipt (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id      INTEGER NOT NULL REFERENCES fin_ar_invoice(id),
  amount          REAL NOT NULL,
  bank_account_id INTEGER,
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS fin_fixed_asset (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'equipment',
  cost           REAL NOT NULL,
  salvage        REAL NOT NULL DEFAULT 0,
  life_months    INTEGER NOT NULL,
  acquired       TEXT NOT NULL,                   -- 'YYYY-MM-DD'
  method         TEXT NOT NULL DEFAULT 'straight' CHECK (method = 'straight'),
  accumulated    REAL NOT NULL DEFAULT 0,
  state          TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','disposed')),
  cost_center_id INTEGER REFERENCES fin_cost_center(id),
  core1_asset_id INTEGER,                         -- Core 1 assets.id, when it is also a device on that register
  disposed_at    TEXT,
  disposed_by    TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS fin_depreciation (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES fin_fixed_asset(id),
  period   TEXT NOT NULL,                         -- 'YYYY-MM'
  amount   REAL NOT NULL,
  UNIQUE (asset_id, period)
) STRICT;

CREATE TABLE IF NOT EXISTS fin_fx_rate (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  currency    TEXT NOT NULL,
  rate_to_usd REAL NOT NULL,                      -- 1 unit of currency = rate_to_usd USD
  day         TEXT NOT NULL,
  UNIQUE (currency, day)
) STRICT;

-- THE BANK. Accounts, statements, reconciliation, transfers, cheques, batches.
CREATE TABLE IF NOT EXISTS bank_account (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  bank            TEXT,
  kind            TEXT NOT NULL DEFAULT 'bank' CHECK (kind IN ('bank','cashbox')),
  currency        TEXT NOT NULL DEFAULT 'USD',
  iban            TEXT,                           -- the company's own; masked on screen
  gl_code         TEXT NOT NULL UNIQUE,           -- its own child of 1000 in Core 1's chart
  opening_balance REAL NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','closed')),
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS bank_statement (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES bank_account(id),
  label       TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS bank_statement_line (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_id    INTEGER NOT NULL REFERENCES bank_statement(id),
  account_id      INTEGER NOT NULL REFERENCES bank_account(id),
  day             TEXT NOT NULL,
  amount          REAL NOT NULL,                  -- signed: money in positive
  ref             TEXT,
  journal_line_id INTEGER,                        -- Core 1 journal_lines.id once matched
  state           TEXT NOT NULL DEFAULT 'unmatched' CHECK (state IN ('unmatched','matched','excluded'))
) STRICT;
CREATE INDEX IF NOT EXISTS bank_statement_line_acct ON bank_statement_line (account_id, state);

CREATE TABLE IF NOT EXISTS bank_transfer (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account_id INTEGER NOT NULL REFERENCES bank_account(id),
  to_account_id   INTEGER REFERENCES bank_account(id),
  beneficiary     TEXT,                           -- external, when to_account_id is NULL
  purpose_code    TEXT NOT NULL DEFAULT '5900',   -- the account an external payment hits
  amount          REAL NOT NULL,
  fee             REAL NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','executed','void')),
  approved_by     TEXT,
  executed_at     TEXT,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS bank_cheque (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES bank_account(id),
  number     TEXT NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('issued','received')),
  payee      TEXT NOT NULL,
  amount     REAL NOT NULL,
  day        TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'drafted'
             CHECK (state IN ('drafted','issued','presented','cleared','bounced','void')),
  bill_id    INTEGER REFERENCES fin_ap_bill(id),
  invoice_id INTEGER REFERENCES fin_ar_invoice(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, number)
) STRICT;

CREATE TABLE IF NOT EXISTS bank_payment_batch (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('payroll','ap','expenses','eos','other')),
  source_id   TEXT,                               -- pay_run.id for payroll, and so on
  account_id  INTEGER NOT NULL REFERENCES bank_account(id),
  total       REAL NOT NULL DEFAULT 0,
  count       INTEGER NOT NULL DEFAULT 0,
  state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','released','void')),
  approved_by TEXT,
  released_at TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- A payment item names a beneficiary. When that is an employee, the name and
-- the bank detail are sealed under them; the amount stays readable because the
-- batch total is an org fact the ledger shows anyway.
CREATE TABLE IF NOT EXISTS bank_payment_item (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    INTEGER NOT NULL REFERENCES bank_payment_batch(id),
  beneficiary TEXT NOT NULL,                      -- Tier A when it is a person
  amount      REAL NOT NULL,
  employee_id INTEGER REFERENCES hr_employee(id),
  bill_id     INTEGER REFERENCES fin_ap_bill(id),
  expense_id  INTEGER REFERENCES fin_expense(id),
  subject_ref TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS bank_payment_item_subject ON bank_payment_item (subject_ref);

-- OPERATIONS. Stock, work orders, fleet, rooms, the internal help desk, and
-- workplace incidents. Core 1's incidents table is the technical SEV ladder;
-- these are the ones with a wet floor in them.
CREATE TABLE IF NOT EXISTS ops_warehouse (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  state      TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS ops_item (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sku        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'each',
  min_qty    REAL NOT NULL DEFAULT 0,
  cost       REAL NOT NULL DEFAULT 0,
  state      TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS ops_stock_move (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES ops_item(id),
  warehouse_id    INTEGER NOT NULL REFERENCES ops_warehouse(id),
  qty             REAL NOT NULL,                  -- signed
  kind            TEXT NOT NULL CHECK (kind IN ('receipt','issue','transfer_in','transfer_out','adjust')),
  ref             TEXT,
  proc_request_id INTEGER REFERENCES proc_request(id),
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS ops_stock_move_item ON ops_stock_move (item_id, warehouse_id);

CREATE TABLE IF NOT EXISTS ops_workorder (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  target_kind TEXT NOT NULL DEFAULT 'other' CHECK (target_kind IN ('fixed_asset','vehicle','room','other')),
  target_id   INTEGER,
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','in_progress','done','cancelled')),
  assignee_employee_id INTEGER REFERENCES hr_employee(id),
  due         TEXT,
  cost        REAL NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL,
  closed_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS ops_vehicle (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plate        TEXT NOT NULL UNIQUE,
  make         TEXT NOT NULL,
  model        TEXT,
  year         INTEGER,
  odometer     INTEGER NOT NULL DEFAULT 0,
  assignee_employee_id INTEGER REFERENCES hr_employee(id),
  next_service TEXT,
  state        TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','in_service','retired')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS ops_room (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  building   TEXT,
  capacity   INTEGER NOT NULL DEFAULT 4,
  state      TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS ops_booking (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES ops_room(id),
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  starts      TEXT NOT NULL,
  ends        TEXT NOT NULL,
  meeting_id  INTEGER REFERENCES mtg_meeting(id),
  state       TEXT NOT NULL DEFAULT 'booked' CHECK (state IN ('booked','cancelled')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE INDEX IF NOT EXISTS ops_booking_room ON ops_booking (room_id, starts);

-- The internal help desk. Requester and assignee are employments; the
-- narrative, if any, is a document. SLA is a due time the sweep can compare.
CREATE TABLE IF NOT EXISTS ops_ticket (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ref         TEXT NOT NULL UNIQUE,               -- HD-2026-0001
  category    TEXT NOT NULL DEFAULT 'it' CHECK (category IN ('it','facilities','hr','finance','other')),
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  title       TEXT NOT NULL,
  requester_employee_id INTEGER REFERENCES hr_employee(id),
  assignee_employee_id  INTEGER REFERENCES hr_employee(id),
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','in_progress','waiting','resolved','closed')),
  sla_due     TEXT NOT NULL,
  breached    INTEGER NOT NULL DEFAULT 0,
  doc_id      INTEGER REFERENCES doc_document(id),
  opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  closed_at   TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS ops_incident (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('safety','quality','security','environment')),
  severity    INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4),
  title       TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','investigating','closed')),
  action      TEXT,                               -- the corrective action, about the workplace, never a person
  doc_id      INTEGER REFERENCES doc_document(id),
  reported_by TEXT NOT NULL,
  closed_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- ADMINISTRATION. The registry of letters, the committees, the cases, the
-- regulatory calendar, the licences, and who has read which policy.
CREATE TABLE IF NOT EXISTS adm_letter (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT NOT NULL UNIQUE,              -- IN-2026-0001 / OUT-2026-0001
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  subject      TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  org_unit_id  INTEGER REFERENCES hr_org_unit(id),
  doc_id       INTEGER REFERENCES doc_document(id),
  day          TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'received'
               CHECK (state IN ('received','routed','answered','closed','drafted','sent')),
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS adm_committee (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,
  chair_employee_id INTEGER REFERENCES hr_employee(id),
  state             TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','dissolved')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS adm_committee_member (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id INTEGER NOT NULL REFERENCES adm_committee(id),
  employee_id  INTEGER NOT NULL REFERENCES hr_employee(id),
  UNIQUE (committee_id, employee_id)
) STRICT;

CREATE TABLE IF NOT EXISTS adm_resolution (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id INTEGER NOT NULL REFERENCES adm_committee(id),
  ref          TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  doc_id       INTEGER REFERENCES doc_document(id),
  state        TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','adopted','rejected')),
  decided_on   TEXT,
  adopted_by   TEXT,                              -- a human, always
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS adm_case (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT NOT NULL UNIQUE,              -- CASE-2026-0001
  kind         TEXT NOT NULL CHECK (kind IN ('litigation','arbitration','claim','regulatory','labour')),
  counterparty TEXT NOT NULL,
  court        TEXT,
  contract_id  INTEGER,                           -- Core 1 contracts.id
  state        TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','hearing','settled','won','lost','closed')),
  next_hearing TEXT,
  exposure     REAL NOT NULL DEFAULT 0,
  doc_id       INTEGER REFERENCES doc_document(id),
  decided_by   TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS adm_obligation (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  authority   TEXT NOT NULL,
  due         TEXT NOT NULL,
  recurrence  TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','monthly','quarterly','yearly')),
  org_unit_id INTEGER REFERENCES hr_org_unit(id),
  state       TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','overdue')),
  done_by     TEXT,
  done_at     TEXT,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS adm_license (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  authority  TEXT NOT NULL,
  number     TEXT,
  issued     TEXT,
  expires    TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','expired','renewed')),
  doc_id     INTEGER REFERENCES doc_document(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS adm_policy_ack (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id      INTEGER NOT NULL REFERENCES doc_document(id),
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  acked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (doc_id, employee_id)
) STRICT;
`);

// The payroll run learns to carry what it withholds. Named totals rather than
// one "withheld" figure, so tax payable and contributions payable are two
// liabilities in the ledger and not one number nobody can reconcile.
for (const sql of [
  'ALTER TABLE pay_run ADD COLUMN total_tax REAL NOT NULL DEFAULT 0',
  'ALTER TABLE pay_run ADD COLUMN total_contrib REAL NOT NULL DEFAULT 0',
  'ALTER TABLE pay_run ADD COLUMN total_employer REAL NOT NULL DEFAULT 0',
  'ALTER TABLE hr_employee ADD COLUMN jurisdiction TEXT NOT NULL DEFAULT \'IQ\'',
  'ALTER TABLE hr_employee ADD COLUMN probation_ends TEXT',
  'ALTER TABLE hr_employee ADD COLUMN contract_ends TEXT',
]) { try { db.exec(sql); } catch { /* column exists */ } }
/**
 * Run a piece of work so that all of it happens, or none of it.
 *
 * The constitution says every consequential act is written to the chain
 * *before it happens*. That was not quite true: a handler mutated a table and
 * then wrote the record, so a failed chain write left the act done and
 * unrecorded — the one outcome the whole design exists to prevent. Nothing was
 * swallowing the error; there was simply nothing holding the two together.
 *
 * SAVEPOINT rather than BEGIN, because these nest: a route already inside a
 * transaction that calls something which opens another must not commit the
 * outer one early. Nested savepoints release into their parent and only the
 * outermost actually commits.
 *
 * Synchronous on purpose. `node:sqlite` is synchronous, and an `await` inside a
 * transaction would let another request interleave between the mutation and the
 * commit — which is how a "transaction" becomes a comment.
 */
let savepointDepth = 0;
export function atomically(fn) {
  const name = `sp${savepointDepth}`;
  savepointDepth += 1;
  db.exec(`SAVEPOINT ${name}`);
  let out;
  let async = false;
  try {
    out = fn();
    // A promise here means the caller passed an async function, and the
    // savepoint would release before the work finished. Noted rather than
    // thrown from inside this block — throwing here would land in the catch
    // below and roll back a savepoint the handler had already released, which
    // is how the first version of this reported "no such savepoint".
    async = Boolean(out && typeof out.then === 'function');
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    savepointDepth -= 1;
    throw err;
  }
  if (async) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    savepointDepth -= 1;
    throw new Error('atomically() takes a synchronous function — an await inside a transaction is not one');
  }
  db.exec(`RELEASE ${name}`);
  savepointDepth -= 1;
  return out;
}

/** Whether anything is currently holding a transaction open. */
export const inTransaction = () => savepointDepth > 0;

// Indexes for the questions the clocks ask every few seconds. Without them a
// production database with fourteen thousand runs and twenty thousand notices
// answered each one by reading the whole table, and the clocks between them
// kept the event loop busy for half of every minute — every page waited.
for (const sql of [
  // notify()'s duplicate check: unread, from this source, about this subject.
  'CREATE INDEX IF NOT EXISTS notifications_dedupe ON notifications (source, subject_type, subject_id) WHERE read = 0',
  'CREATE INDEX IF NOT EXISTS notifications_unread ON notifications (read, id)',
  // The queue by state: the workers, the chief, the inbox and the gate all ask it.
  'CREATE INDEX IF NOT EXISTS runs_state ON runs (state, created_at)',
  'CREATE INDEX IF NOT EXISTS runs_task ON runs (task_type)',
  'CREATE INDEX IF NOT EXISTS model_calls_created ON model_calls (created_at)',
]) { try { db.exec(sql); } catch { /* a table this install does not have */ } }

export function q(sql, ...params) { return db.prepare(sql).all(...params); }
export function one(sql, ...params) { return db.prepare(sql).get(...params); }
export function exec(sql, ...params) { return db.prepare(sql).run(...params); }

export function uuid() {
  return crypto.randomUUID();
}
