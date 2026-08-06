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
try { db.exec('ALTER TABLE journeys ADD COLUMN autopilot INTEGER NOT NULL DEFAULT 0'); } catch { /* column exists */ }
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
