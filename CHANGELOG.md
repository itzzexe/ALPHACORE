# Changelog

What changed and why. Newest first.

The rule for this file: an entry says what somebody can now do that they could
not before, or what was wrong that is now right. "Refactoring" and "improvements"
are not entries. Where something was broken, the entry says what the symptom
was, because that is what a reader is searching for.

The full reasoning for any change is in its commit message; this is the index.

---

## Unreleased

### Production hardening

- **The server refuses to start in an unsafe shape.** Turn on production mode
  and a master key that resolves to `data/master.key` — beside the database it
  decrypts — stops the boot, as does a `PUBLIC_BASE_URL` that is not https
  behind a trusted proxy. Before this, both were warnings on a page nobody had
  open. Either can be accepted with an explicit `I-UNDERSTAND` environment
  variable, and accepting it is written to the audit chain at startup, so the
  decision has a time and a name against it instead of being invisible.

- **You can see which integrations actually work.** Trust centre → Connector
  certification: every connector against read, write, OAuth, failure handling,
  rate limits and token refresh. Nothing on that page is typed by anybody — it
  is a view over evidence the egress gate writes on every call, so a
  certification with no call behind it cannot exist. On a fresh install it
  reads 50 untested cells out of 54. That is the point: the previous answer to
  "does the Slack connector handle a 429" was somebody's memory.

- **A cell can go down.** A column that was live-verified in March and failed
  yesterday still reads live-verified — that is what the evidence says — with
  the failure and its date on the same line. A matrix that only ever climbs is
  lying by omission.

- **Personal data is encrypted before it reaches the disk.** Call recordings and
  transcripts, support and contact-centre message bodies, and the contact
  details an enrichment run collects are sealed under the subject's own key as
  they are written. Previously they were plaintext until somebody exercised a
  right to erasure, which meant the protection covered the one attacker who
  politely waits to be asked. Read `docs/THREAT-MODEL-PII.md` before describing
  this to anybody: it does nothing against compromise of the live process, and
  says so.

- **Upgrading an existing install: Compliance → Erasure → seal existing
  records.** A queue job, not a script — safe to interrupt, safe to start twice,
  resumes where it stopped. **Take a fresh backup after it finishes.** Every
  backup taken before it still contains the readable originals.

- **What was wrong before, and is now right.** Sealing a row is an `UPDATE`, and
  SQLite does not zero the page the old value was on. A backfilled database
  still held every plaintext transcript in its free list — invisible to `SELECT`,
  one `strings` away, and copied verbatim into the next backup. Against the
  attacker the whole design is aimed at, the encryption would have been
  decorative. `secure_delete` is on at every connection now, and the backfill
  vacuums before it reports finished.

- **And another.** The drafting prompt for a support ticket was a verbatim copy
  of what the customer wrote, sitting in `runs.input` in plaintext. Sealing the
  ticket would have moved the leak one table to the left. Runs about a person
  now carry their reference and are sealed under the same key.

### Finding things

- **Eight doors instead of a hundred and forty.** The rail now carries what you
  are trying to do — Ask, Work, Approvals, Company, Intelligence, Money, People,
  World — rather than which division owns the answer. Nothing was removed:
  every department keeps its page, its address and its division, and *All
  departments* is one click away. The mapping is data checked by the launch
  audit, which blocks on a department filed under no door — a page that exists,
  works, and can only be reached by typing its URL.

- **Ask AlphaCore.** One box. It searches the records immediately and for
  nothing; anything that spends money or opens work comes back as a button with
  the cost written on it. Routing is regex over the words you typed, not a model
  call, so it is occasionally wrong and never expensively wrong.

- **The waiting-on-you count is on the bar at every width.** It existed only on
  the phone, which meant the one number the whole design is about was invisible
  on the screen most people use.

- **What was wrong before.** Navigating away from a page did not stop the render
  it had already started. Both finished and wrote into a page that had been
  replaced — a handler setting `.disabled` on a button that no longer existed,
  or an error box appearing on whichever department happened to be open when the
  previous one's fetch came back. It failed on a different page every time,
  which is why nobody had pinned it down. Found by running twelve hundred
  navigations in a row.

- **177 form labels were labels in appearance only.** No `for`, no wrapping —
  so a screen reader announced the field as "edit text, blank". Now connected.

### Checking

- **`npm run sweep`.** Opens every department and every surface in a real
  browser — both themes, both languages, desktop and phone, twelve hundred
  renders — and fails on a page that did not draw, a console error, an external
  request, or a control with no accessible name. Unit tests never open a page,
  and the launch audit checks that a department *has* a route, not that the
  route draws anything. Every bug in the two sections above was found here and
  nowhere else.

### The repository, as a repository

- **One description instead of two.** The root README called the project
  "Crucible Systems" and said 114 departments; the one a directory down called it
  AlphaCore and said 140. GitHub shows the root one, so everybody read the wrong
  description first. There is now one, and its counts are measured from the code
  on every build.
- **A layout you can navigate.** The platform is `app/` rather than a directory
  called `crucible-core` inside a repository called `crucible-core`. The eleven
  blueprint documents moved from the root into `docs/blueprint/`, renumbered so
  that ten sorts after nine, with an index saying what each is for.
- **Documentation, arranged by what you are trying to do** — [`docs/`](docs/),
  including a new [architecture](docs/ARCHITECTURE.md) document explaining how
  one process is a whole company and what would break if you changed it.
- **AGPL-3.0 instead of MIT**, with a [commercial licence](COMMERCIAL-LICENCE.md)
  for anybody who cannot accept it and a [contributor licence](CLA.md) that makes
  both possible. Under MIT anybody could have taken this, closed it, and sold it
  back; under the AGPL a modified copy offered as a service has to publish its
  source.
- Code of conduct, support policy, and this file.

### The offices

- **A new department**: the workforce in a building rather than a feed. Thirteen
  rooms, everybody at a desk on the floor their work is on, and people who drift
  between them — mostly to their own room, sometimes to the kitchen, sometimes
  after somebody they get on with, which is how cliques form without anybody
  modelling one.
- **A conversation leaves something behind.** What somebody takes away is written
  into their memory, which is recalled into their later prompts — so the employee
  who had the conversation is afterwards a slightly different employee. A
  disagreement that will not resolve becomes a real dispute, HR arbitrates, and
  the ruling belongs to the owner.
- **A floor plan you can watch**, drawn in SVG with a figure per employee derived
  from their own id, so the same person looks the same every time. Mood is the
  face; energy is the shadow they stand on. Click a room to read it, or watch a
  conversation play out a line at a time.
- Off until somebody starts it. Off means no movement, no model call, no cost.

### Reading the console

- **A page no longer rebuilds itself while you are reading it.** Ninety-six pages
  refresh on a timer and only typing used to hold one off; scrolling back through
  a conversation would throw you to the top mid-sentence, and on the offices page
  the refresh restarted the replay from line one. A refresh now waits while text
  is selected, while a feed is scrolled anywhere but its bottom, and while
  something is playing — and when one happens, every scroll position is restored.

### Nine departments a company discovers it needs

Tax, privacy and the DPO, data governance, the help centre, the trust centre,
status and SLA, intellectual property — and two that already had tables, an API
and no way in: partnerships and growth. Each is somewhere being absent costs
money or breaks a promise. Seven new sources report into the approvals desk.

- **Tax** produces entries in the same double-entry books as everything else, and
  never invents a rate: an unknown jurisdiction produces an unclassified line and
  a question for a person. Filing is a human act at any amount.
- **Data governance** exists for one cross-check: a column classified as personal
  that the erasure walk cannot reach means "a person can be forgotten" is untrue
  for whatever is in it, and neither module can see that alone.

### Erasure

- **A recording of somebody's voice was surviving their erasure.** The walk
  matched columns whose whole value equalled the identifier and covered four
  tables; the support ticket somebody wrote, the transcript of their call and the
  recording itself were all outside it. Columns are now either *matched* or
  *carried*: the matched one identifies whose row it is, and everything on that
  row goes with it.
- **Erasing somebody who was not already on file threw an exception and erased
  nobody** — which is exactly the person who arrives by phone or by writing to
  support. Sealing the first value creates the subject row, and the code then
  tried to insert it again.

### The web

- **robots.txt is read, parsed to RFC 9309, and obeyed** by the page fetch, the
  intelligence crawler and the browser alike. It was not read anywhere before,
  which is most of why the company kept being told it looked like a bot.
- **The user-agent identifies the platform and stays honest.** The previous one
  was truthful and shaped like nothing, so sites that reject anything not
  browser-shaped refused the honest agent while a dishonest one would have been
  served.
- **A search engine results page is refused.** Every engine forbids automated
  reading of one, detects it, and escalates; searching goes through the engine's
  own interface instead. There is no stealth mode and there will not be.

### The record

- **The subscription was being switched off by an API key.** The Claude Code CLI
  prefers a key over a claude.ai login whenever one is in the environment, so a
  key meant for the metered provider reached the subscription adapter and
  bypassed the plan entirely. With no credit on that key, every tier chain failed
  and the router reported itself exhausted.

### Build

- **The Windows CI jobs were failing on carriage returns, not on the API.** The
  OpenAPI check compared a generated file with the one on disk byte for byte;
  Git on Windows checks it out with CRLF, so the check found 31,029 differences
  in a file that was perfectly current. `.gitattributes` normalises the
  repository to LF everywhere, and the check compares content rather than line
  endings.
- **Seven routes read a capture group that does not exist.** Handlers are called
  as `handler(m.slice(1), …)`, so the first group is `p[0]`; `p[1]` is undefined,
  `Number(undefined)` is NaN, the query matches nothing, and the endpoint answers
  200 with null. Nothing throws and nothing is logged. `test/routes.test.js` now
  fails the build on it.
- **The README's numbers are measured.** Nineteen were wrong, including five
  nobody had spotted — among them the browser sweep's "488 renders", which is
  122 × 2 × 2: the old department count fossilised in arithmetic.

---

## Before this file existed

The first six weeks are in the git history, which is the honest record. Notable
milestones, in order: the audit chain and its triggers; reservation-first
budgets; the multi-provider router with reviewer separation; the egress gate;
the living map generated from the catalogue; crypto-shredding; external
anchoring; the double-entry ledger; deep search; the browser the employees drive;
and the approvals desk that collects everything waiting on a person.
