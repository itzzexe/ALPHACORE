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

- **The rest of the company (2026-08-26)** — fourteen departments beside the
  ten: time rules (shifts, holidays, overtime, corrections, lateness and
  absence measured against a shift), compensation (allowances, benefit plans
  and enrollment, salary history, movements, end of service, grievances,
  asset custody, employment certificates), budgets against the posted
  journal, payables, fiat receivables, fixed assets with monthly straight-line
  depreciation, FX rates, the bank (each account its own child of 1000,
  statements reconciled line by line, transfers, cheques, payment batches
  with four eyes), inventory as a sum of moves, work orders, fleet, rooms,
  an internal help desk with an SLA clock, workplace incidents, the
  correspondence register, committees and resolutions, legal cases, the
  regulatory calendar, licences, policy acknowledgements, and the page about
  you. 58 tools, 17 categorically human commands, 45 events, every money
  event one balanced entry with a source id. The payroll formula now has
  real allowances, overtime, tax from a bracket table and contributions from
  plans. 164 departments, 48 tunnels, 0 orphans; 366 tests; 1,400 renders
  swept green.
- **Two sessions, one company (2026-08-27)** — this work landed in parallel
  with another session's: sealed files, records and retention with legal
  holds, shifts and overtime, pay rules, custody, joining and leaving, atomic
  writes, and the two-core menus with the seam drawn on the one atlas. The
  merge kept one master per fact: shifts, overtime, tax and contribution
  rules, end-of-service days and custody are theirs (`shifts.js`,
  `payrules.js`, `custody.js`); this side's duplicates — its own shift and
  overtime tables, a tax-bracket table, an asset-assignment table — were
  removed rather than left as twins. The payroll formula now reads all three
  neighbours from one function (`payrollInputs`) and labels a slip
  `rulesConfigured: false` when no rule has been declared, so a zero never
  looks computed. End of service takes its days from the declared rule and
  seals the money under the person. The fourteen departments from this side
  are filed behind the enterprise doors, with a sixth door — Operations —
  for stock, facilities and the help desk, and the enterprise column of the
  atlas now lays itself out by what is in it. 170 departments, 22 districts,
  52 tunnels, 0 orphans; 416 tests.
- **The atlas redrawn as a wheel (2026-08-27)** — two rings around one
  core. The inner ring is the AI core, one sector per district sized by its
  share of departments; the outer ring is the enterprise core, each division
  placed at the circular mean of where its tunnels land, so the chords are
  short. Every department is a cell (filled with records, hollow without);
  every tunnel a chord between the rings. Pointing at a sector fills it,
  names its cells and lights its tunnels; clicking a cell opens the same
  window as before; clicking a sector opens the district as a wheel of its
  own — its departments round the rim with a glyph each, every declared
  relationship between them as a chord (trace and focus work on them), and
  the districts it reaches as a ring of doors placed by angle. Labels are
  horizontal and side-anchored, with the anchor flipped under RTL. The old
  builders' selectors are kept (`[data-node]`, `.at-hit`, `[data-dept]`,
  `.at-tunnel`, `[data-district]`), so the lens bar, badges, hover, dialog,
  trace and zoom all work unchanged.
- **Every department page opens with a band** — door, district, core, hint,
  and what it is joined to — read from the same catalogue and edge list the
  map is drawn from, so a page and the map cannot disagree about where a
  department sits.

**Deferred from Core 2, with the reason:**

- **Document attachments are text bodies, not files.** A doctor's note today is
  a sealed text version; a scanned PDF has nowhere to live until the documents
  module learns file refs (Core 1's workspace storage is the obvious home).
  Deferred because a file path in a sealed column is a pointer to unsealed
  bytes — the storage side needs the same sealing thought first.

- **Company Feed and channel-scoped agents.** Not built. Core 1s chat floor
  already holds humans and agents in one room; a per-department feed is a
  variation on it, deferred until somebody asks for it by name.
- **Document RAG.** Ask searches titles and internal bodies; retrieval-augmented
  answers over document content await an embedding pass over doc_version,
  which must respect the guarded-classification exclusion search already has.
- **The egress log redaction threshold is 48 characters.** Anything longer
  passed as a tool argument is logged as length + hash. A personal detail
  under 48 characters — a bare phone number as an argument — would still land
  in the log readable. Tool arguments should be ids, and mostly are.
- **Payroll tax is a bracket table, seeded with placeholders.** The formula
  now reads tax from `pay_tax_bracket` per jurisdiction and contributions from
  the plans an employee is enrolled in, and end of service is computed at
  termination from `EOS_DAYS_PER_YEAR`. The seeded IQ brackets are
  placeholders that say so on screen; somebody who knows the law replaces
  them. Bonuses, commissions, other deductions and penalties are still named
  zeros.
- **Bank statements are typed or pasted, not imported from a file.** The
  reconciliation matches lines to journal lines and shows the remainder, but
  the lines arrive as `day, amount, ref` text. A CSV/MT940 importer is the
  obvious next step and waits for a real bank format to test against.
- **Depreciation is straight-line only, and nobody runs it on a timer.** The
  method column admits nothing else, and `run_depreciation` is a tool and a
  button rather than a monthly job — deliberately, until the month-end close
  has an owner.
- **Multi-currency is a rate table, not a ledger feature.** `fin_fx_rate`
  converts for display; the journal stays in the functional currency. A
  bill in IQD is posted at its USD figure by whoever records it.
- **The help desk has no notifications to the requester.** A breached SLA
  reaches the oversight feed; the person who raised the ticket learns of a
  state change only by looking. Web Push per employee needs the login →
  person link to be the norm rather than the exception first.
- **Room bookings and meetings are joined by an optional id**, not by the
  meeting form. Creating a meeting does not book a room; booking a room can
  name a meeting.
- **Customers & Sales:** Core 1's customers/deals/invoices tables are declared
  the system of record — same one-master reasoning as tasks and vendors.
- **Phase 2's tasks & projects.** Core 1's existing projects/tasks tables are
  declared the system of record rather than duplicated into proj_ twins —
  building parallels would be the two-masters failure §2 exists to prevent.
- **Shifts and overtime are a hook, not a feature.** time_shift exists;
  nothing assigns shifts or computes overtime against them yet.
- **A meeting transcript has one sealing subject.** It is sealed under the
  organizer's key: erasing the organizer erases it, erasing a participant does
  not. Honest compromise for multi-subject data, and worth revisiting.
- **The `#/bridges` screen shows tools, not calls.** It counts what passed the
  gate but does not list them. A page that says "7 gated" without saying which
  seven is one nobody can act on.

**Open risk in what is already built — look at these before real employee data:**

- **A bank account's IBAN is stored in the clear.** It is the company's own
  account, not a person's, so it is Tier B by the same reasoning as a
  vendor's name — but a company IBAN in a leaked database is still a
  useful thing to a fraudster. It is masked on every screen; the row is not.
- **`payments.released` reclassifies cash for payroll and end-of-service
  batches only.** An AP batch posts nothing on release because each bill
  posted as it was paid; an `other` batch posts nothing at all. A batch of
  kind `other` is therefore a memo, not an accounting fact, and the screen
  does not say so loudly.
- **The reconciliation's auto-match is by exact amount alone.** Two open
  journal lines of the same amount leave the statement line unmatched for a
  person — correct, but a busy account with many identical charges will need
  a lot of hands. Matching by date window and reference is the next step.
- **New permissions default to nobody.** `bank.*`, `ops.*` and `admin.*`
  were added to the catalogue; only the superadmin holds them until somebody
  grants them, so every non-owner sees "you do not have permission" on
  fourteen new pages until roles are updated.
- **The overview draws 52 tunnels as dotted lines from the enterprise column
  to the AI core's rim.** At the far view they read as a faint haze until a
  department is pointed at; the enterprise column now holds ten districts
  and thirty departments at a row pitch that shrinks to fit. Worth a second
  look on a real monitor, and the lens bar ("Across the seam") is the
  intended way to read them.
- **A database created between 2026-08-26 and this merge carries the wrong
  shape for `time_shift_assignment`/`time_overtime`.** Only local sweep and
  test databases were ever created from that branch — the VPS predates it —
  but such a file will refuse to boot on the index `shift_assignment_live`.
  Delete and recreate it; there is no migration because nothing real used it.

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
