# AlphaCore — where it stands, and what it takes to finish it

> **Read this part; the rest is history.** Sections 1 to 7 are the plan as it
> was written on 2026-08-08, kept because the reasoning is still worth reading.
> Every number in them is out of date. What is current is immediately below.

## Now — after the production-hardening pass (2026-08-14)

**Done, and each one has a test that bites rather than a claim that reassures:**

- **Production mode with two boot gates.** A master key that resolves to a file
  on the same disk as the database, or a console reachable over plain HTTP,
  refuses to start. Both are overridable with an explicit `I-UNDERSTAND`, and
  the override is written to the chain at startup so accepting the risk is a
  recorded act rather than a quiet one.
- **A browser sweep.** 1200 renders — every department and every surface, both
  themes, both languages, desktop and phone — asserting each page drew, has no
  console errors, makes no external request, and leaves no control without an
  accessible name. It did not exist before; three real bugs below were found
  by it and by nothing else.
- **A connector certification matrix that cannot be typed into.** A SQLite view
  over evidence the egress gate writes on every call. On a fresh install it
  reads 50 untested cells out of 54, which is the honest number.
- **Personal data sealed at write.** Sixteen Tier A columns under per-subject
  keys, wrapped by the master key. `docs/THREAT-MODEL-PII.md` states what this
  does not protect against, in the same breath as what it does.
- **Eight surfaces in front of 140 departments.** The mapping is data beside the
  catalogue, and the launch audit blocks on a department filed under none.
- **Ask AlphaCore.** One box, routed by regex over the words typed — no model
  call — defaulting to the read-only answer.

## Core 2 — the enterprise galaxy (started 2026-08-14)

**Done, each with tests that bite:**

- **The PII gate (§0.5)** — verified against the directive's acceptance criteria
  rather than rebuilt. It already existed.
- **The identity spine (§4)** — `hr_person` is the root; employment and a login
  are things a person may or may not have, in any combination. An AI agent is
  barred from every human slot twice over: STRICT typing refuses an agent's TEXT
  id in an INTEGER person column at the storage engine, and a trigger refuses a
  person row created as a proxy under an agent's name. Six routes tried, six
  refused, with a real person as a control.
- **The five bridges (§6)** — every call from Core 1 into Core 2 passes the
  egress gate. Being in the same process buys no trust. Six commands are gated
  categorically: a granted scope does not clear them, `force: true` does not
  clear them, and a zero-value change is held exactly as a million-dollar one
  is — so it is demonstrably not the value ceiling doing the work.
- **Phase 1, complete** — identity, org, documents & knowledge base, and
  notifications. Twenty routes, four screens in both languages, three new
  permissions (docs.view/manage/confidential). 144 departments, all filed, all
  connected. A restricted document about a person has every version sealed
  under that person's key; notifications reuse notify() and Web Push rather
  than adding a channel.

**Deferred from Core 2, with the reason:**

- **Document attachments are text bodies, not files.** A doctor's note today is
  a sealed text version; a scanned PDF has nowhere to live until the documents
  module learns file refs (Core 1's workspace storage is the obvious home).
  Deferred because a file path in a sealed column is a pointer to unsealed
  bytes — the storage side needs the same sealing thought first.

- **Phases 2 to 5.** Not started. Phase 2's leave flow is the first real test of
  Bridge 3 doing useful work rather than only refusing things, and it should be
  built first for that reason.
- **The `#/bridges` screen shows tools, not calls.** It counts what passed the
  gate but does not list them. A page that says "7 gated" without saying which
  seven is one nobody can act on.

**Open risk in what is already built — look at these before real employee data:**

- **`enterprise-core` is armed `live`, not `dry`.** Every other connector proves
  itself in dry-run first. A dry-run internal connector would execute nothing
  and make Core 2 unusable, so this one skips that convention — and it is the
  connector with access to salaries. The gate, the scopes and the human gates
  all still apply; the *convention* does not.
- **The agent-name trigger can refuse a real person.** It blocks a display name
  matching an agent's name, and agent names here are role titles. An employee
  genuinely called something an agent is called would be refused until one of
  them is renamed. Deliberate, and the right way round to be wrong, but it will
  surprise somebody.
- **STRICT tables are a deviation.** No other table in this codebase uses them.
  It is what makes §4's guarantee true by construction instead of by discipline,
  but it means Core 2's schema and Core 1's behave differently under a bad
  write, and somebody will eventually be confused by that.
- **`base_salary` is TEXT.** It has to be, because it is sealed. No aggregate
  can be computed in SQL over sealed salaries — payroll totals will have to be
  summed in the process after opening each one, which is slower and worth
  knowing before Phase 3 designs around it.

---

**Deferred, with the reason:**

- **`runs.output` opening is spread across 28 call sites.** Sealing it required
  adding `openPii(...)` at every place that reads a run's answer. That is
  mechanical and it is verified by both proof scripts, but a single
  `readRunOutput(run)` helper would be better than 28 chances to forget.
- **Tier B is documented, not enforced.** Names, references, amounts and the
  join keys the controller's reconciliation matches on stay in plaintext by
  design. Their protection is disk encryption and a master key from outside the
  disk — guidance, not code.
- **`sandbox-verified` is unreachable.** Nothing in the platform has a sandbox,
  so that rung of the certification ladder can never be climbed. It is shown as
  such rather than hidden, because hiding it would make the ladder look
  complete.
- **The offices simulation renders the whole company.** `renderOffices` refers to
  most other renderers, which is why the people surface was the hardest to
  extract. Worth a lookup table rather than direct references.

**Found by the sweep, fixed, and worth remembering:**

- A render already in flight kept writing into a page that had been replaced —
  `clearInterval` stops the next poll, not the one in the air. It failed on a
  different department each run, which is why it had survived. A generation
  counter closes it.
- 177 labels sat next to their control with nothing connecting them: announced
  as "edit text, blank". Fixed as a pattern.
- Sealing a row is an `UPDATE`, and SQLite does not zero the freed page. A
  backfilled database still held every plaintext transcript in its free list.
  `secure_delete` plus a vacuum the backfill must finish before it reports done.

---

> **Status: built.** This document was the plan, written 2026-08-08. Everything
> in sections 3, 4 and 5 below was implemented the same day and is running —
> the vault, the connector layer with ten drivers plus any-HTTP-API, the egress
> gate, agent scopes, the durable queue, the web capability, MCP in both
> directions, the constitution, provenance receipts, the time machine, the
> shadow company, the skill market, the red team, the knowledge graph, the
> closed revenue loop and live presence. The counts in section 1 are the *old*
> ones; the system now runs 95 departments across 13 divisions, 132 tables, 408
> endpoints and 188 permissions, with 17 unit tests and a live proof script
> (`npm run prove`). The one thing deliberately left undone is the multi-tenant
> split in §5.14 — it is a product decision, not an engineering one.

A review of the system as it actually is on 2026-08-08, followed by the work that
turns it from a complete company simulation into a company that touches the
world. Every number below was counted from the running system, not estimated.

---

## 1. What exists

| | |
|---|---|
| Server modules | 58 files · 15,542 lines |
| Frontend | 3 files · ~9,000 lines, zero frameworks |
| Database | 112 tables, hash-chained append-only audit log |
| REST surface | 345 routes |
| Permissions | 158 atomic `section.action` keys |
| Departments on the map | 81 sections · 12 districts · 211 relationships |
| Model providers | 5 (Anthropic, Claude CLI, Gemini, OpenAI-compatible, mock) |
| Background sweeps | ~30 `setInterval` loops in one process |
| Tests | 1 smoke test |

The internal machine is genuinely complete: intake → produce → peer review →
audit → human gate → archive, with revision loops, agent memory (4 layers,
BM25 + Arabic normalization), self-hiring, budgets reserved before spend,
autonomy that can run the whole cycle, and a chat floor where humans and
employees talk in one room.

## 2. The one thing that is missing

**The company is complete on the inside and sealed on the outside.**

Everything that looks like contact with the world is, today, a row in SQLite:

| Looks external | Actually |
|---|---|
| Social posts | `posts.state = 'published'` — nothing leaves the machine |
| Investor updates, bulletins, board packets | written to tables |
| Outreach emails | drafted, never sent |
| Contracts, proposals | text in a column |
| Marketing channels | plans and results, typed in |

Only four things really cross the network:

1. **Twilio** — voice + SMS (`src/comms.js`), signature-verified webhooks.
2. **One web fetcher** — `src/enrich.js`, and it is well built: SSRF guard,
   private-IP blocking, port allowlist, timeout, byte cap. Used by intel only.
3. **A read-only chain RPC** — `src/wallet.js`, watch-only wallets.
4. **Model provider APIs.**

So the company has organs, memory and judgement — and one phone line. Giving it
hands and senses is the whole of the next phase.

---

## 3. Foundation — must exist before any integration

Do not add a second `comms.js`. Five pieces make every future integration cheap
and safe; skipping them makes each one expensive and dangerous.

### 3.1 Credential vault (`src/vault.js`)
Today provider keys sit in plaintext in `settings` (`src/settings.js` says so
honestly). Needed: encryption at rest with a key derived from a master
passphrase (or Windows DPAPI), one row per credential with `connector`, `scope`,
`expires_at`, `last_used_at`, `rotated_at`, and a hard rule that no secret ever
enters an audit payload or an API response beyond its last four characters.

### 3.2 Connector layer (`src/connectors/`)
One driver contract, many services:

```js
export default {
  id: 'gmail',
  auth: { kind: 'oauth2', scopes: [...], authUrl, tokenUrl },
  capabilities: ['mail.read', 'mail.send', 'mail.draft'],
  async call(op, args, ctx) { ... },   // ctx carries the agent, run and reason
  async webhook(req) { ... },          // inbound events → internal work
};
```

`connectors` + `connector_accounts` tables, OAuth callback route, token refresh
on the job queue. After this, Gmail, GitHub, Slack, X, Stripe and Notion are
each a file — not a subsystem.

### 3.3 The egress gate (`src/egress.js`) — the load-bearing piece
Right now the 158 permissions govern **humans clicking in the UI**. Nothing
governs **an employee touching the outside world**. Every outbound effect must
pass one choke point:

```js
await egress.attempt({
  connector: 'gmail', op: 'mail.send',
  agent: 'AGT-REL-001', runId, reason: '...', payload,
});
```

which enforces, in order: the agent holds the scope → the target is on the
allowlist (domain, repo, channel, address) → quota and rate limit for this
connector/agent/day → value ceiling (money, recipients) → dry-run mode if the
connector is not yet armed → human gate if the rule demands one → then writes
**intent** and **result** as two linked entries on the audit chain.

This is what makes autonomy safe to point at real accounts. Without it,
autonomy + Gmail is an incident waiting for a date.

### 3.4 Scopes for agents
Extend the permission model from users to employees: each agent holds explicit
external scopes (`gmail.send:domain=client.com`, `github.pr:repo=org/app`),
never a wildcard. The chat action catalogue in `src/chat.js` already proves the
pattern — this generalizes it beyond internal actions.

### 3.5 Durable jobs
~30 `setInterval` sweeps in one process, no retry policy, no backoff, no leader
lock, and the `dead_letter` table is unused. Needed: a `jobs` table with
`attempts`, `run_after`, `idempotency_key`, exponential backoff, and the sweeps
rewritten as job producers. Network calls make this mandatory — the phone line
being down must not lose work.

### 3.6 Tests
One smoke test for 24,000 lines. The four things that must never silently break:
the audit chain stays verifiable, RBAC denies what it should, the budget
reservation blocks the call before it is made, and the egress gate refuses an
unscoped attempt.

---

## 4. Integrations, in the order they pay off

**1 — MCP, both directions. Highest leverage in the system.**
- *Client*: one adapter, and every MCP server on earth becomes tools the
  employees can call — browser, filesystem, Postgres, Figma, Sentry, Linear,
  Slack. One file buys an ecosystem.
- *Server*: expose AlphaCore itself over MCP, so Claude Code, Claude Desktop or
  any agent can drive the company from outside. This is what turns an app into a
  platform.

**2 — Web capability (`src/web.js`).** Generalize the intel fetcher into three
graded abilities: `fetch` (SSRF-guarded, cached, robots-aware), `search`
(Brave/Tavily/Google key), `browse` (headless Chromium over CDP — the same
mechanism already used to verify this UI, reused as an agent tool returning DOM
text + screenshot). Every fetch stores URL + content hash, so any claim an
employee makes traces back to a source.

**3 — Google Workspace.** Gmail read → inbox triage straight into the request
desk; Gmail send → the outreach drafts that already exist, gated. Calendar →
meetings from deals. Drive → artifact storage.

**4 — GitHub.** Issues ↔ tasks two-way, PRs opened from The Lab and System
Design, Actions status into Releases, the AI Auditor reviewing diffs, the repo
as the artifact archive. This is the integration that changes daily work most.

**5 — Chat bridges.** Slack / Telegram / Discord / WhatsApp mirrored into The
Floor. The chat module already has channels, mentions, threads, reactions and
read state — the bridge is a driver, not a rewrite.

**6 — Social publishing.** X, LinkedIn, Meta, YouTube, TikTok. The
draft → human-publishes path already exists; connect the last inch. Note the
platforms' automation rules — they are stricter than the API docs suggest.

**7 — Money.** Stripe for real invoices and subscriptions beside the crypto
treasury; e-signature (DocuSign/Dropbox Sign) for contracts; bank statements by
import. That closes the loop below.

**8 — Providers.** Add OpenRouter, Groq, Together, and local models (Ollama /
llama.cpp). The router already has tier chains, family separation and
sensitivity ceilings — it needs "bring your own endpoint" and per-agent model
preference.

---

## 5. Ideas that make it unlike anything else

Ordered by how much they change the product, not by difficulty.

**5.1 The closed revenue loop.** Every hop already exists in isolation:
intel → outreach → meeting → proposal → contract → invoice → delivery →
success. Wire them end to end through the egress gate and the company earns with
no human in the path except the load-bearing gates. That is the moment the
project stops being a simulation.

**5.2 The shadow company (simulation mode).** Fork the database, run a decision
— or a whole quarter — at accelerated tick speed with the real agents, then
compare outcomes before committing. `society.js`, `cycles.js` and `maestro.js`
are already the engine; a fork-and-replay harness turns them into a what-if
machine. "What happens if we cut marketing by 40%?" gets an answer instead of an
opinion.

**5.3 The time machine.** The audit chain is hash-linked and append-only, so any
past state is reconstructible. Add snapshot + replay: stand at any hour of the
company's life, see exactly what was known, and re-litigate a decision with new
evidence. Nobody else can do this, because nobody else recorded it.

**5.4 Provenance receipts.** Sign every artifact with its chain hash, model,
prompt, reviewers and cost — an exportable proof of how it was made. As AI
content disclosure becomes a legal requirement, this stops being a nicety.

**5.5 Constitution as code.** A versioned `constitution.md` compiled into
machine-checkable rules that both the egress gate and the AI Auditor enforce.
Changing it requires the owner's ruling and lands on the chain. The company's
values become executable, not decorative.

**5.6 Skill market + model tournaments.** Memory already distills lessons; the
next step is for an employee to propose a *skill* (a reusable prompt + tool
recipe), have it scored on a golden set, promoted only if it beats the
incumbent, versioned, and adopted by others. Pair it with cost-aware routing
that re-ranks models per task family from measured quality and cost. The company
gets cheaper and better as it ages.

**5.7 Adversarial immune system.** `immune.js` exists; extend it into a
scheduled red team that attacks the company — prompt injection hidden in a web
page an employee is reading, a forged invoice, poisoned memory — and files what
it finds. The day agents get Gmail and the open web, prompt injection stops
being theoretical, and this is the only honest defense.

**5.8 Voice-first operations.** Twilio and Polly are already wired. Add
streaming realtime voice so the owner can talk to Harmony or any department, and
inbound callers reach a conversation rather than a script.

**5.9 Signed human approvals.** Passkey/WebAuthn signature on every gate ruling,
stored on the chain. "Who approved this" becomes cryptographic instead of
claimed. Pair with a PWA + push so gates can be cleared from a phone.

**5.10 Sovereign mode.** Full operation with local models and no internet, sync
when the line returns. In Iraq, that is not a feature — it is the difference
between a company that works and one that waits.

**5.11 Department packages.** Formalize what a department is (tables, agents,
permissions, nexus rules, map node) into an installable manifest. Then the 81
sections become a catalogue, and other people can ship departments.

**5.12 Live presence.** The SPA polls; there is no WebSocket layer. Add one and
the map goes truly live — work streaming into the room, employees visibly
typing, cursors on the map — while polling cost drops.

**5.13 Knowledge graph.** BM25 today. Add embeddings from a local model plus a
real entity graph (people, companies, deals, artifacts) so "who knows what about
X" is answerable in one hop.

**5.14 Multi-tenant.** One instance, N companies, isolated data, shared
connectors, per-tenant budgets. The path from "my company's OS" to a product
other people pay for.

---

## 6. Order of work

| Phase | Contents | Gate to the next |
|---|---|---|
| 0 | Vault · connector contract · egress gate · agent scopes · jobs+retry · tests | Nothing external ships before this |
| 1 | MCP client · web capability (fetch/search/browse) | Red-team pass on prompt injection |
| 2 | Gmail + Calendar · GitHub | Dry-run week with zero unintended sends |
| 3 | Chat bridges · social publishing | Platform ToS reviewed per channel |
| 4 | Stripe · e-sign → closed revenue loop | First invoice paid end to end |
| 5 | MCP server · department packages · multi-tenant | — |
| ∞ | Simulation · time machine · provenance · tournaments · voice · PWA | — |

## 7. Risks worth stating plainly

- **Prompt injection is the real threat**, not model error. The moment an
  employee reads a web page or an email and can then send mail, open a PR or
  move money, a hostile page becomes a command channel. Mitigations: the egress
  gate, allowlists, dry-run defaults, treating fetched content as untrusted
  data (never as instructions), and the red team in §5.7.
- **Autonomy plus real accounts** multiplies both value and blast radius. Keep
  the existing rule: money leaves only by a signed-in human, and no bulk contact
  with people who never asked to hear from us.
- **Platform terms.** Social automation and bulk email are governed by rules
  stricter than their APIs. Each connector needs its limits encoded in the gate,
  not remembered by a person.
- **Secrets on one machine.** The vault fixes storage; a second machine or a
  cloud deployment needs a real secret manager. Say so rather than pretending.
