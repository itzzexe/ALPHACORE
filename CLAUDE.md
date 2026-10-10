# CLAUDE.md — working on AlphaCore

AlphaCore is the operating platform for an AI-native company: one Node process,
one SQLite file, a vanilla-JS console, and ~170 "departments" staffed by AI
agents and people. The README says what it does; `docs/ARCHITECTURE.md` says
how. Read ARCHITECTURE before any structural change — this file is the short
version plus the traps.

## Commands (run from `app/`)

```bash
npm ci                 # one dependency: @anthropic-ai/sdk. Without it ~24 test files fail on import.
npm start              # http://localhost:8484  (node --experimental-sqlite src/server.js)
npm run dev            # same, with --watch
npm test               # ~450 tests, ~15s, writes data/test.db — never the real database
npm run prove          # end-to-end proof of the core promises (mock mode)
npm run prove:platform
npm run openapi        # regenerate public/openapi.json after adding routes   (CI: openapi:check)
npm run readme         # regenerate README numbers after adding departments  (CI: readme:check)
node --experimental-sqlite scripts/launch-audit.mjs   # needs the server running
npm run sweep          # browser sweep of every page; needs Chrome on :9222
```

Run one test file: `node --experimental-sqlite --test test/build-run.test.js`.
A new test file must also be **added to the `test` script in package.json** —
the list is explicit, not a glob.

Node ≥ 22.5 is required (`node:sqlite`). No API key is needed: with no provider
configured, or `ALPHACORE_MOCK=true`, every model call returns a shaped stub.
The env var is `ALPHACORE_MOCK` (not `CRUCIBLE_MOCK`, an old name).

## Layout

```
app/src/server.js        one process: HTTP, console, workers, scheduler, WebSocket (/live)
app/src/api.js           the route table + path → permission resolver (permFor)
app/src/db.js            schema (append-only migrations) and q / one / exec
app/src/audit.js         the hash-chained audit log
app/src/auth.js          users, sessions, PERMS list, roles
app/src/workflow.js      agents, runs (enqueueRun), leases, retries
app/src/router.js        tier → provider chain; reviewers forced onto a different provider family
app/src/egress.js        the one gate for anything leaving the machine
app/src/links.js         the catalogue: departments (S(...)), divisions, edges, SURFACES
app/src/forge.js         software factory: real git repos under workspace/_apps/<slug>
app/src/deploy.js        releases to servers; app/src/servers.js the fleet
app/src/connectors/      github, slack, gmail, stripe… each op passes egress
app/src/engineering/     the engineering floor: scan.js (deterministic reviewer), reviews.js (review board +
                         quality gate), github.js (hub + webhook), builder.js (app builder), assist.js, metrics.js
app/src/core2/           the enterprise core (HR, finance, bank, ops) — held apart by rules in ARCHITECTURE
app/public/app.js        the route table for the console (key → { title, render, poll })
app/public/departments/  page renderers, grouped by area (build.js = forge, sites, deploys)
app/public/departments/studio.js       Dev Studio (the IDE); engineering.js: reviews, GitHub, app builder, metrics
app/public/components/editor.js        the code editor (textarea over a highlighted <pre>), diff, outline
app/public/i18n.js       Arabic dictionary (+ i18n-build.js, i18n-eng.js for the engineering floor)
app/config/agents.json   the AI workforce (id, role, tier, prompt)
app/test/                node:test files, one per area
```

## Adding a department (all seven steps or the audits fail)

1. Tables in `db.js` (or `CREATE TABLE IF NOT EXISTS` at the top of the module, as forge.js does) — append, never edit an existing migration.
2. A module in `src/` with an `overview()` and its actions; each consequential act calls `audit({...})`.
3. Permissions in `auth.js` `PERMS` — split view / manage / irreversible acts.
4. Routes in `api.js` **and** the line in the permission resolver. Handlers receive `(captures, body, url, user)`; the first capture is `p[0]` (`test/routes.test.js` fails on `p[1]`). Unknown `/api/*` paths answer 401 by design.
5. A page renderer in `public/departments/*.js`, registered in `public/app.js` `routes`.
6. A catalogue entry `S(...)` in `links.js`, a place in exactly one SURFACE, and `edge(...)`s only for relationships the code really performs.
7. Tests, then `npm run readme` and `npm run openapi`.

## Rules that get changes refused

- **The audit chain is append-only.** Never UPDATE/DELETE `audit_log`, never write a human actor where the system acted.
- **No irreversible outward act without a human gate** — money, merges, PR approvals, publishing, messages to people. Agents propose; people apply. GitHub `APPROVE` and `repo.merge` are human-only.
- **Anything leaving the machine goes through `egress.js`** (connectors do this via `wire()`); the intent is chained before the call.
- **The console makes zero external requests.** No CDN, fonts, analytics, Monaco from a CDN, etc. — the sweep checks it. Vendor nothing that phones home.
- **No framework, no build step, one dependency.** The browser runs the files as written.
- **Secrets** live in the vault (`vault.js`, `vaultSecret('GITHUB_TOKEN')`), never in code, logs, or `data/`.
- Commands in forge projects run through an allowlist (`allowedBins`) without a shell; keep it that way.

## The engineering floor

- Agents work through markers in their task prompt (`[FORGE-CHANGE]`, `[ENG-REVIEW:<dim>]`, `[ENG-ASSIST]`,
  `[APP-SPEC]`, `[APP-ARCH]`). Mock mode (`src/providers/mock.js`) answers by marker, read from the task part
  only — an agent's memory of earlier work contains other markers. A new agent task needs a mock branch.
- Long work is a run plus a server tick that folds the result back (`syncForge`, `syncReviews`, `syncBuilds`,
  `syncAssist` in `server.js`). Treat any run state other than queued/leased/running as finished;
  `awaiting_human` still carries output (low confidence), so use it and label it.
- Reviewers only find. Fixing is `fixFindings` → a forge change set a person applies. Dismissing a
  critical/high finding needs a person and a reason. Posting to GitHub (review, issue, push) is
  `github.post` and human-only. GitHub `APPROVE` and merge are never offered.
- Clone/pull/push go through `egress.attempt` by capability name; in dry-run they are recorded, not done.
- New scanner rules go in `src/engineering/scan.js` with a dimension, severity and fix; add a test for what
  it must catch and for the false positive it must not (see `test/engineering.test.js`).
- `node scripts/review-diff.mjs --base=origin/main` runs the scanner over a branch's diff (CI does this).

## House style

- Comments explain **why**, never what. The codebase has a dry, explanatory voice — match it.
- Two spaces, single quotes, semicolons. ES modules everywhere.
- Every UI string goes through `t()` / `esc(t('…'))` and gets an Arabic entry in `public/i18n.js`. Arabic is first-class: RTL-safe layout (`padding-inline-start`, not `padding-left`), never letter-spacing on Arabic.
- Colours are design tokens (`var(--sx-mute)`), valid in light and dark themes.
- Interactive elements need accessible names (the sweep fails otherwise).
- Errors meant for the user: `refuse('message', status)` inside modules.
- Commit messages are sentences, not `feat(x):` — e.g. "The factory gets a reviewer that reads before it signs".

## Traps

- `npm test` without `npm ci` fails with ERR_MODULE_NOT_FOUND on `@anthropic-ai/sdk` — install first.
- Tests set their own DB and `ALPHACORE_APPS_ROOT`; never import modules in a way that touches `data/alphacore.db`.
- Windows: package managers are `.cmd` and go through cmd.exe in forge; arguments with cmd metacharacters are refused on purpose.
- Two pages claiming the same hash throw at import (`registerRoutes`).
- The README carries measured numbers; edit counts with `npm run readme`, not by hand.
