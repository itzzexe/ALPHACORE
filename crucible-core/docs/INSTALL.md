# Running AlphaCore

Everything you need to go from a fresh machine to a company that runs itself,
and to keep it running afterwards. Read the first two sections before you start;
the rest is reference.

---

## 1. What you need

| | |
|---|---|
| **Node.js** | 22.5 or newer. Not negotiable — the database layer is `node:sqlite`, which does not exist below 22.5. Check with `node -v`. |
| **Disk** | About 200 MB for the code and dependencies. The database grows with your company; a busy month is measured in tens of megabytes, not gigabytes. |
| **A model provider key** | Optional to start. Without one the platform runs in mock mode and costs nothing. |
| **A browser** | Any current one. The console makes zero requests to anything but its own server — no fonts, no CDNs, no analytics. |

There is no Docker image, no database server, no message queue, no build step.
One process, one file.

---

## 2. First run

```bash
cd crucible-core
npm install
npm start
```

On Windows you can double-click `Start-AlphaCore.bat` instead; it checks the
Node version, installs on first run, and opens the browser for you.

The console is at **http://localhost:8484**.

### The password is printed once

The first time the server starts against an empty database, it creates one
account and prints it:

```
──────────────────────────────────────────────────────────
  First run. The owner account has been created.

    username   owner
    password   78jv-n9n7-azvr-68dx

  This is shown once and is not stored anywhere in readable form.
  You will be asked to change it the moment you sign in.
──────────────────────────────────────────────────────────
```

**Copy it now.** It is stored only as a hash; nobody — not you, not the
platform — can read it back. It is lowercase letters and digits in groups of
four, with the characters nobody can tell apart left out, because the screen it
is read from and the screen it is typed into are often not the same one.

If you miss it, you are not locked out. From the machine the company runs on:

```bash
npm run reset-password            # the owner account
npm run reset-password -- alice   # somebody else
```

That issues a new one, prints it once, ends every open session for that
account, and writes the reset to the audit chain. It asks for filesystem access
to `data/alphacore.db` — the same access needed to delete that file — so it
grants nobody anything they did not already have.

That account can do exactly two things until you change the password: look at
itself, and replace that password. This is enforced in the server, not merely
asked for on screen.

### Name your company

Settings → *This company*. The name you put here replaces "this company" in
every system prompt, investor update and generated document. An install that
skips this step still works; it just writes blander prose.

Set the **public address** in the same panel if this machine is reachable from
outside — OAuth callbacks and carrier webhooks have nowhere to return to
without it.

### Turn on a second factor

Settings → *This account* → **Set up a one-time code**. Scan or paste the secret
into any authenticator, type the code it shows, and it is on. Ten recovery
codes appear once at that moment — write them down. A lost phone without them
is a lost account, and the only alternative would be a back door, which is a
worse thing to own than the risk it removes.

Signing in is rate-limited whether or not you turn this on: eight failures
locks the account for fifteen minutes, and twenty-five failures from one
address stops that address regardless of which usernames it is trying. Every
attempt is recorded with its address, so "somebody tried you four hundred times
last night" is a sentence the system can actually say.

**Behind a reverse proxy**, set `TRUST_PROXY=true` — otherwise every request
appears to come from the proxy and the per-address limit lumps the whole
internet into one bucket. Do *not* set it when the server is directly reachable:
anybody could then send a fresh `X-Forwarded-For` on each attempt and the limit
becomes an ornament.

---

## 3. Going live

Out of the box the platform is in **mock mode**: every model call returns a
deterministic stub. Nothing is sent anywhere, nothing costs anything, and the
whole system is fully explorable. The header says `MOCK MODE` so you are never
in doubt.

To do real work:

1. **Settings → AI providers.** Paste a key for at least one provider. It is
   encrypted at rest with AES-256-GCM and never echoed back — the page shows
   you the last four characters and nothing more.
2. **Press *Test connectivity*.** It makes one small real call and shows you
   what came back. If that works, the router works.
3. **Set a budget.** Budgets → the company cap. Money is *reserved before a
   model is called*, so a runaway loop hits the cap instead of your card.
4. **Arm your connectors.** The World division → Connectors. Each one starts
   fenced by an allowlist; a live connector with an empty allowlist is a
   finding, not a convenience.

### Mail that arrives, and recordings that are lawful

Two things a company discovers late and expensively.

**Mail.** A message that is not signed, from a domain with no policy, goes to
spam — and spam is indistinguishable from "they ignored us" in every report the
company will produce. It is silent: nothing fails, the send is recorded as
successful, and the pipeline reports a healthy rate into a void.

```bash
MAIL_DOMAIN=yourcompany.com
GET /api/deliverability             # the key to publish
GET /api/deliverability/preflight   # what the world can actually see
```

Messages are signed with RSA-2048 DKIM, relaxed/relaxed canonicalisation — the
combination every receiver verifies. The private half lives in the vault; the
public half is a DNS record, which cannot be a secret because publishing it is
the point.

**The records themselves are yours to publish**, in your registrar, against your
domain. Nothing here can do that, and this is one of the two things in the whole
review that no amount of code can finish. What it *can* do is read the live DNS
and say what a receiver would conclude — deliberately reading DNS rather than a
setting, because a record somebody *meant* to publish is worth nothing and the
entire failure mode is believing a thing is in place when it is not. It reports
a missing SPF, an `+all` that authorises the whole internet, a DKIM key that is
published but is not the one being signed with (worse than not signing), a
missing DMARC, and no MX.

**Recording a call.** Whether it is lawful depends on where the other party is,
and getting it wrong is criminal in several places rather than a compliance
finding.

```bash
POST /api/deliverability/consent  {"country":"US","region":"WA"}
```

Two-party jurisdictions require an announcement first, and one gets written for
you. A single "US" answer is wrong often enough to be dangerous, so the thirteen
all-party states are listed separately — and **anywhere not in the table gets
the strict rule**, as does the US with no state given. The decision is recorded
whether or not anybody objects, because "we had consent" is a claim somebody
will need to prove. It is a starting position from where the other party is, and
it says on the page that it is not legal advice.

### Money after the sale

Taking money was the easy half. What decides whether a business is solvent is
what happens afterwards, and none of it existed: **refunds** (which move money
outward and therefore carry a value and hit the same gate a payout does —
nothing about "we are giving it back" makes it less of a payment),
**disputes** (which have a deadline, and missing it loses the money by default,
so the due date is surfaced), **contesting one** (a statement made to a bank on
the company's behalf, so it is a write and it is gated), and **tax**
(calculated rather than invented — an invoice with the wrong tax is a
correction to every downstream report as well).

These are wired and gated. They are **not verified against a live Stripe
account** here, which is the honest limit: the paper-trading mode above is the
way to exercise them for a fortnight before they touch a real card.

### Paper trading — real reads, nothing sent

There are two settings and the gap between them is a cliff. Mock mode proves the
plumbing and nothing about the economics: every answer is a stub, so a pipeline
can look like it works while being fed invented numbers. Live mode proves
everything, and can also email four hundred people.

```bash
PAPER_TRADING=true
```

Reads go out against the real APIs with real credentials, so the data is your
actual data. Anything that would *change* something out there runs the whole
path — scopes, allowlist, quota, constitution, the payload assembled — and then
is not sent, recorded with the verdict `paper` and what it would have done.

**Anything unrecognised counts as a write.** That default is the entire safety
of the mode: a capability added next month that nobody thought about is held
rather than sent, and the opposite default would let one new verb quietly undo
the whole thing.

This is the honest way to run one vertical for a fortnight before it touches
anybody.

### What the platform will never do on its own

Worth knowing before you leave it running overnight:

- Money never leaves without a signed-in human. Autonomy cannot reach payout
  resolution, and the platform holds no private key, seed phrase or mnemonic —
  wallets are watch-only and payouts are signed outside.
- Nobody outside the company is contacted in bulk unless they asked to hear
  from you. The request desk refuses that work and says so.
- Every outbound call passes the egress gate: scope, allowlist, quota,
  constitution, value ceiling, dry-run — and the intent is written to the audit
  chain *before* the call, so a blocked attempt leaves a record too.

---

## 4. On a phone

The console is built for a phone as well as a desktop. Below 860px the rail and
the department list become a drawer, a bar of four thumb-sized targets takes
over the bottom of the screen, tables scroll inside their own box instead of
pushing the page sideways, and the layout keeps clear of the notch and the home
indicator.

### Opening it from a phone

A phone cannot reach `localhost` — it needs this machine's address on the
network, which the server now prints when it starts:

```
AlphaCore running on http://localhost:8484
  on this network:  http://192.168.0.193:8484
```

Same network, same wifi, and the phone is in.

### Installing it to the home screen

It is a progressive web app: an icon, no address bar, its own entry in the app
switcher, and it opens without waiting for the network.

- **Android / Chrome** — the menu offers *Install app* or *Add to Home screen*.
- **iOS / Safari** — Share, then *Add to Home Screen*.

**This needs HTTPS.** Browsers only treat `localhost` as a secure origin over
plain `http`, so over a LAN address the install option will not appear and the
service worker will not register — the layout still works, but it stays a
browser tab. Put a TLS terminator in front of it (Caddy will do this in one
line, and a tunnel like Cloudflare or Tailscale will do it without touching
your router) and both come back.

### What works without a network

The shell only. Opening it offline paints the app's own screen and says, in
your language, that there is no connection to the company — rather than a
browser error page pretending the app is broken.

Nothing under `/api` is ever cached. A stale approval queue or a run count from
yesterday would look exactly like the truth, and that is worse than an error.
The company itself is always read live.

---

## 5. Anchoring the record

The hash chain catches anybody who edits the record through the application.
It does not catch the person who owns the disk.

They can open the database with any SQLite tool, drop the append-only triggers
— the factory reset does exactly that, legitimately — rewrite whatever they
like, and recompute every hash forward from the genesis string. `verifyChain()`
will then report that everything is consistent, because it *is*. Internal
consistency was never evidence of anything: it is precisely what a careful
forger produces.

The fix is to put a copy of the chain's head somewhere you cannot reach, at a
time you did not choose. Afterwards, rewriting history means producing a chain
whose hash at entry N disagrees with what a third party wrote down on Tuesday —
a contradiction against the world rather than against itself.

### Turning it on

Platform → **Anchors** → *Anchor now*, or:

```bash
npm run anchor
```

It runs itself every six hours after that. A company that has done nothing
since the last one is skipped rather than asking an authority to sign its own
footprints.

### The three witnesses, and what each is worth

| | |
|---|---|
| **`rfc3161`** (default) | A timestamping authority signs "this digest existed at this time". Cryptographic, third-party, and the strongest thing available without paying anybody. Defaults to DigiCert's free service; set `ANCHOR_TSA_URL` for another. |
| **`webhook`** | POSTs the digest to a URL you do not control. Worth exactly as much as that endpoint's independence and its logs. Set `ANCHOR_WEBHOOK_URL`. |
| **`file`** | Appends to a local file. Worth **nothing** against the owner of the disk, and labelled as such everywhere it appears. It exists so the mechanism can be exercised without a network. |

### Checking it

Platform → Anchors shows two answers that are deliberately kept apart:

- **Internally consistent** — the chain agrees with itself. `verifyChain()`.
- **Matches what was witnessed** — the chain agrees with the outside world.

The second is the one that cannot be forged locally. If history was rewritten
after an anchor, this is where it shows, naming the height where the two
accounts part company.

### Verifying without us

Every anchor keeps the authority's token whole, so somebody who does not trust
this platform can check it with tools that are not ours:

```bash
curl -H "x-auth-token: $TOKEN" localhost:8484/api/anchors/1/evidence   | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(Buffer.from(JSON.parse(s).evidence,'base64')))" > token.tsr

openssl ts -reply -in token.tsr -text      # the digest and the authority's time
openssl ts -verify -in token.tsr -CAfile /path/to/authority-ca.pem
```

The `Message data` in that output must equal the anchor's `digest`, which is
SHA-256 over `alphacore-anchor-v1|<height>|<chain hash>`. The height is inside
the digest on purpose: anchoring the hash alone would let somebody replay an
old anchor against a truncated chain and call it a match.

---

## 6. Erasing a person

An erasure request and an append-only record are flatly contradictory as
usually stated. The chain is hash-linked: deleting a row breaks every hash
after it, and that impossibility is the entire point of having one. Meanwhile
somebody sends a request naming an email address that sits inside forty of
those rows, and "our architecture does not allow it" is not one of the lawful
answers.

The way out is to never store the thing. Every person the company holds data
about gets their own key. Their details are sealed under it **before** the
audit payload is hashed, so the chain covers the ciphertext and never knew the
plaintext. Erasing them destroys the key: the rows stay exactly as they were,
every hash still verifies, and what was inside them is gone in the only sense
that matters — nobody can read it, including you, with the database and the
master key in hand.

### Doing it

```bash
# what is held about them — the same walk that answers a subject access request
curl -X POST localhost:8484/api/erasure/find -H "x-auth-token: $TOKEN"      -H 'content-type: application/json' -d '{"identifier":"someone@example.com"}'

# carry it out
curl -X POST localhost:8484/api/erasure/erase -H "x-auth-token: $TOKEN"      -H 'content-type: application/json'      -d '{"identifier":"someone@example.com","reason":"they asked"}'

# prove it, rather than believe it
curl -X POST localhost:8484/api/erasure/verify -H "x-auth-token: $TOKEN"      -H 'content-type: application/json' -d '{"identifier":"someone@example.com"}'
```

Erasing needs `compliance.manage`; looking somebody up needs
`compliance.view`. Both lookups are POSTs on purpose: naming a person in a URL
puts them in an access log and a browser history, which is the opposite of what
is being asked for.

### What survives, and why

- **That a person existed under some reference, that they asked, and when it
  was done.** Erasing the erasure would leave no way to prove the request was
  honoured, which serves nobody — least of all them.
- **Never the identifier itself.** Writing "we erased alice@example.com" into
  an append-only log is a way of not erasing alice@example.com. The record
  holds a salted one-way reference and nothing else.
- **Everything that was not about them.** The rest of each entry is untouched.

### Two things that catch people out

**Order matters.** Anything still sitting in plaintext is sealed *first*, then
the key is destroyed. Done the other way round, plaintext columns stay readable
forever with no key left to shred them with — which is why people conclude that
crypto-shredding does not work.

**Re-import does not resurrect.** If the same list is loaded again next week,
values for an erased person seal to a dead marker rather than a new key. Without
that, the erasure was theatre.

### The honest limit

Coverage is a list, not a guess — `GET /api/erasure` prints exactly which
columns are walked. A regex that decides at runtime what counts as personal
data is a regex that will one day decide wrongly and silently. If you add a
column that holds something about somebody outside the company, add it to
`PII_COLUMNS` in `src/erasure.js`, and to the list of things your privacy
notice claims to cover.

---

## 7. Checking it without trusting it

Two tools that owe the platform nothing.

### The API description

```bash
npm run openapi          # regenerate public/openapi.json
npm run openapi:check    # fail if it has drifted
```

Generated from the server's own route table — 477 routes across 397 paths, each
carrying the permission it actually demands, because the generator runs the real
resolver rather than a second copy of its logic. Served at
**`GET /api/openapi.json`**, without a token: an API description is not a
secret, and needing a token to read the document that explains how to get a
token is a joke that costs somebody an afternoon.

Request and response bodies are marked as undescribed rather than guessed at.
A spec that invents a schema is worse than one that admits it has none, because
tooling generates clients from it. CI fails if the file is out of date.

### The chain verifier

```bash
node scripts/verify-chain.mjs data/alphacore.db
node scripts/verify-chain.mjs company-export.json
```

**Copy this file out of the repository and it still works.** It imports nothing
from `src/`, opens no settings, and needs no keys — because a verifier that
has to be run by the system it is checking is a system marking its own homework.
Hand it to an auditor with an export and they can check the record on their own
machine.

It answers in descending order of worth:

1. **Does every hash follow from the one before it?** Necessary — and passed
   just as happily by a rewritten history, so not evidence on its own.
2. **Does the chain still hash to what a witness wrote down?** This is the one
   that cannot be forged on the machine holding the file.
3. **Do the timestamping tokens actually contain those hashes?**

Exit code 0 when both hold, 1 when either fails, so it drops into a cron line
without ceremony. With no anchors at all it says so plainly rather than
reporting a clean bill of health.

---

## 8. The master key

Everything the company keeps secret is sealed under one key: provider keys,
OAuth tokens, webhook signing secrets, and every person's crypto-shredding key.
Two questions follow from that, and both now have answers.

### Where it lives

By default, `data/master.key` — beside the database, which is honest for one
machine and wrong for anything else: theft of the disk is theft of both. Two
ways out, neither of which needs the source patched:

```bash
# From a secret manager, fetched on every use, never written to disk
ALPHACORE_MASTER_KEY_COMMAND="vault read -field=key secret/alphacore"
ALPHACORE_MASTER_KEY_COMMAND="op read op://vault/alphacore/master-key"
ALPHACORE_MASTER_KEY_COMMAND="aws kms decrypt --ciphertext-blob fileb://key.enc --output text --query Plaintext"

# Or straight from the environment, for a container secret
ALPHACORE_MASTER_KEY="<base64 of 48 random bytes>"
```

Any command that prints the material on standard output works. The platform
never sees the credential that fetched it, only the answer. `GET /api/vault/key`
says which source is in use and states plainly what that source is worth.

### Changing it

```bash
npm run rotate-key -- --dry-run   # what would move
npm run rotate-key                # move it
```

A key that cannot be rotated is a key you keep after the laptop it was copied
to went missing, because the alternative is losing every credential you have.

The order is the whole safety argument:

1. read and decrypt everything under the **current** key, in memory
2. re-seal it all under the **new** key, in one transaction
3. read every re-sealed value back and compare it with what was there
4. only then install the new key file

Any failure before step 4 rolls back and leaves the old key exactly where it
was. If anything is unreadable *before* it starts, it refuses outright —
re-sealing what you cannot read turns a recoverable problem into a permanent
one. And a rotation that installs the key first and fails halfway is
indistinguishable from destroying the vault, which is the usual way this goes
wrong.

It is a terminal command, not a button. The authority it needs is the key file
itself, which is what somebody at a console already has and a browser session
does not.

### The retired key is kept

Renamed with the time it was retired, not deleted. **A backup taken an hour ago
is still sealed under it**, and deleting it makes that backup unreadable — a
restore that quietly produces a company with no credentials. Move retired keys
to wherever you keep the backups they belong to, together.

Sealed values carry the fingerprint of the key that sealed them, so "sealed
under a key you no longer have" is its own error naming the fingerprint,
instead of a generic decryption failure. Those are two problems whose answers
have nothing in common.

---

## 9. Backups

The whole company is `crucible-core/data/`. Two things live there:

- `alphacore.db` — every record, including the audit chain.
- `master.key` — the AES key that decrypts the vault. **It is not in the
  database on purpose.** A backup of the database without this file cannot
  decrypt a single stored credential.

Back up both, together, somewhere else.

### From the console

Platform → Backups → *Take a backup*. It checkpoints the write-ahead log,
copies the file, and records the result. The Backups page shows the age of the
newest one; the launch audit complains when it is over a day old.

### By hand

Stop the server first, or the write-ahead log will be mid-flight:

```bash
# with the server stopped
cp -r data/ /somewhere/safe/alphacore-$(date +%F)/
```

### Verify the copy, not the original

A backup you have never restored is a hope, not a backup. Once a quarter:

```bash
ALPHACORE_DB=/somewhere/safe/alphacore-2026-08-08/alphacore.db npm start
```

Sign in, open the audit page, press *Verify chain*. If it verifies, that copy
is genuinely a company you could go back to. Time the exercise and write the
number down — that number is your recovery time, and guessing it is how people
find out it was four hours.

There is a quarterly ritual for exactly this drill already registered under
Rituals.

---

## 10. Upgrading

```bash
git pull
npm install          # only if package.json changed
npm start
```

Migrations run automatically at boot, forward-only, and are recorded. The
database schema is versioned in `src/db.js`; a newer build opening an older
database will bring it forward, and it says so in the console.

**Take a backup before a major upgrade.** There is no downgrade path — an older
build opening a newer database will fail rather than corrupt it, which is the
right failure but still a failure.

Nothing in `data/` is ever touched by `git pull`; the whole directory is
ignored.

---

## 11. Running it as a service

Ready-made units are in `deploy/`.

```bash
sudo cp deploy/alphacore.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now alphacore
```

```powershell
powershell -ExecutionPolicy Bypass -File deployinstall-service.ps1
powershell -File deploystop-service.ps1     # stops it the way it expects
```

### Stopping is not the same as being killed

A process that exits the instant it is asked leaves runs marked as running that
nothing owns. They are reclaimed at the next boot — but only if there is one,
and only after however long the restart takes.

SIGTERM now drains: it stops taking work, waits up to `DRAIN_SECONDS` (20 by
default) for what is in flight, requeues anything still going at the deadline,
records what it abandoned, checkpoints the log, and exits. A second signal
skips the wait, because impatience beats tidiness and nobody should have to
reach for SIGKILL to be heard.

The systemd unit sets `TimeoutStopSec=60` for this reason: it must be
comfortably larger than `DRAIN_SECONDS`, or systemd kills the thing mid-drain.

On Windows, `Stop-ScheduledTask` calls TerminateProcess — SIGKILL by another
name. `deploystop-service.ps1` sends a real Ctrl+C to the process's console
instead, so the drain runs, and only kills it if that fails.

### Watching it from outside

```
GET /metrics        Prometheus text
```

Answers only to localhost until `METRICS_TOKEN` is set, then to anyone holding
it. Conventionally this endpoint is open; that convention is wrong here,
because it carries model spend, queue depth, incident counts and how long the
chain has gone unwitnessed.

Three of the series are worth an alert rule:

| | |
|---|---|
| `alphacore_awaiting_human` | work stopped for a person. The number the whole design turns on. |
| `alphacore_anchor_age_seconds` | since the chain was last witnessed outside this machine. `-1` means never. |
| `alphacore_event_loop_lag_ms` | see below. |

**`node:sqlite` is synchronous.** One heavy query blocks HTTP, the WebSocket
and the workers together. This is a property to respect rather than a bug to
fix, so it is measured and stated instead of hidden: sustained lag above ~200ms
is when the browser starts reporting the server as down, which sends people
looking in entirely the wrong place. `GET /api/observability` lists the
slowest operations seen since boot.

Every finished run now records **which model actually answered** — provider,
model and family, as columns rather than inferred later. Providers move what a
name points at without announcing it, and a run that cannot name its model is a
run nobody can reproduce or account for.

### Usable without a mouse or a screen

Checked rather than intended, and checked on every page: the browser sweep
**fails** if any control on any of the 114 departments has no accessible name,
if a form field is unlabelled, or if a decorative icon would be announced as a
graphic. A page that renders beautifully and announces nothing is not finished.

What that turned up, and what was done about it:

- **Labels sat beside inputs without being linked to them.** A sighted person
  read "Name"; a screen reader said "edit text, blank" and the form was
  unusable. Linked at render time in one place, because asking ninety renderers
  to remember a `for` attribute does not work — and the sweep now fails when
  one is missed.
- **Eighty-three selects had no name at all.** Named from the id suffix, which
  in this codebase is consistently the field's own word — the same word the
  handler uses two lines later, so reading it is not guessing.
- **`--ink-faint` measured 2.57:1 against paper**, below even the large-text
  bar, and it carried most of the secondary text in the interface. Along with
  the accent, ok and warn colours it is now darkened by exactly as much as
  4.5:1 requires and no more, so the palette keeps its character. Every token
  in both themes clears AA for normal text.
- **A skip link**, first in the DOM and visible only when focused. Without it,
  reaching page content by keyboard meant tabbing through thirteen division
  buttons on every load.
- **Toasts announce.** They are a status region now; before, a save confirmed
  itself only to people who could see it.
- **Navigating moves the reading position** to the content that replaced
  everything, instead of leaving focus on a nav item — which reads as "the link
  did not work".
- Thirty-two decorative icons hidden from the reader, `aria-current` on the
  open department, `aria-expanded` on the phone drawer, and both dialogs given
  names.

### The approval desk

The design says humans hold the gates. That is a promise on one side and a
bottleneck on the other, and the bottleneck is structural: 114 departments
feeding one person is a queue that only grows. Past the point where somebody
will read it, both outcomes are bad — everything waits, or somebody starts
approving in bulk without looking, which is worse than having no gate at all
because it produces a signature that means nothing.

`GET /api/approvals` is everything waiting on *you*, gathered from the places
that actually stop — runs at the gate, undecided decisions, prepared payouts,
calls the egress gate held — rather than from a queue table, which would be a
second source of truth that drifts the first time somebody resolves something
directly.

**Ordering is by what it blocks, not by who asked.** Self-declared priority is
always high. This reads the consequence: money that cannot move, an open
incident, somebody outside waiting. Urgency strictly dominates age, and age only
breaks ties inside a band — a queue whose ordering can be gamed by waiting is a
queue that teaches people to wait.

**Groups of three or more alike items can be decided at once**, and the chain
records that as *one act naming every id*, flagged `decidedTogether`. Never as
twelve entries that read like twelve separate judgements. Somebody looking back
should be able to tell considered from batched, because those are different
facts about how much thought was applied. Batches never mix kinds: a payout and
a draft reply in one click is a "select all" in the costume of a decision.

**`APPROVAL_SLA_HOURS`** (24 by default) is the promise, and overdue items are
counted. Unmeasured latency is the bottleneck hiding.

**Delegation** is bounded in time and never open-ended — an unbounded delegation
is a permission grant with extra paperwork. Both names go on the chain, because
"who acted" and "whose authority" are two different questions afterwards.

### Roles, instead of 204 checkboxes

A fresh install used to ask somebody to assemble a job out of 204 individual
permissions before anybody could do anything, and nobody does that carefully at
nine in the morning.

```bash
GET  /api/roles              # the templates, what each is for, what it costs
POST /api/roles/:userId      {"template":"approver"}
```

| | |
|---|---|
| **Observer** | reads everything, changes nothing — verified: not one permission outside `.view` |
| **Approver** | sits at the gates; cannot move money or open a door outward |
| **Operator** | runs the day; deliberately without a single irreversible power |
| **Finance** | the books — and `treasury.pay`, which is here and nowhere else |
| **Security** | the SOC, the constitution, the red team, and `egress.release` |
| **Marketing** | the twenty desks; can publish, cannot approve a press statement |
| **Platform** | keys, backups, tenants — holds the vault, spends nothing |

Each irreversible power — releasing money, letting something out, reading every
credential, restoring a backup, amending the constitution — appears in **exactly
one** template. Spreading them across convenient bundles is how they end up held
by people nobody meant to give them to. The list of what a template carries is
shown before it is granted.

Templates use patterns like `*.view` rather than fixed lists, so one does not
silently stop covering a department added next month — the failure mode of every
hand-written permission list ever committed.

### Changing which model does the work

A tier is a chain of provider/model candidates, and changing one changes the
behaviour of every employee on that tier at once — invisibly, until output
quality drops in a way nobody attributes to it.

```bash
POST /api/tiers/propose        {"tier":"T1","chain":[{"provider":"groq","model":"..."}]}
POST /api/tiers/:id/canary     # run the same tasks against both chains, today
POST /api/tiers/:id/promote    # a person, having been told what regressed
POST /api/tiers/revert         {"tier":"T1"}
```

Five deliberately boring tasks: emit clean JSON, obey an explicit constraint,
say "I do not know" rather than invent, add two numbers, and answer in Arabic
when asked in Arabic. Not a benchmark — a regression check on the three ways a
model swap breaks a pipeline quietly, plus the one that makes it unusable in
half the company.

Both chains run **in the same pass, on the same day**. Comparing a candidate
today against the incumbent's score from last month measures the weather as
much as the model.

Three rules worth knowing before you need them:

- **Promoting an untested chain is refused.** That is the thing this exists to
  prevent.
- **A canary that proved nothing does not count as evidence.** In mock mode both
  sides compare a stub with itself, score zero, show no regression, and would
  otherwise sail through — which is exactly the "it looked fine" failure. The
  run records that it was inconclusive and promotion refuses it.
- **Promoting over a regression is allowed, and has to be said out loud.**
  Sometimes it is the right call, and the reason belongs on the record.

The promoted chain lives in settings, not in `providers.json`. A change made by
editing a file that ships with the repository is a change the next `git pull`
silently reverts.

### Recall that understands a question phrased differently

The knowledge graph and the memory playbooks retrieve by trigram overlap. That
finds "invoice OCR platform" from "invoice ocr" and does **not** find "the tool
that reads receipts" — measured at 0.000 similarity between those two phrases,
which is a ceiling on the quality of every answer the workforce gives, not a
rough edge on a search box.

```bash
# Any local ollama embedding model. Nothing leaves the machine.
EMBEDDING_MODEL=nomic-embed-text
OLLAMA_URL=http://127.0.0.1:11434     # if it is not the default
```

Then `POST /api/embeddings/reindex` until it reports done — in bounded batches,
for the same reason retention is.

Without a model configured this stays on trigrams and `GET /api/embeddings`
says so in those words rather than implying it understands anything.

**Vectors from two models are never compared.** Each row records the space it
belongs to, and a comparison across spaces returns nothing rather than a number
— a 768-dimension model vector against a 256-bucket trigram sketch produces a
confident score for a ranked list of nonsense, which looks exactly like a ranked
list. Rows in the old space are dropped from results until the reindex reaches
them.

If the local model is unreachable, recall degrades to trigrams and says so on
the chain — once an hour, not once a call.

### Which prompt produced this

Every run already recorded the model that answered it; it now records the system
prompt too, content-addressed. A system prompt is the largest single input to
what an employee produces and it gets edited casually — and without a version,
"why did this get worse last Tuesday" has no answer, because nothing recorded
that anything changed.

Hashed rather than numbered, so an edit and a revert give the same version
rather than a third one. A *change* goes on the chain; first sight does not,
or fifty entries would appear at every boot and teach everybody to scroll past
them. `GET /api/prompts/:agentId` lists the history.

### Keeping the database from growing forever

A chain that is never deleted, plus a run history that only grows, is a
disk-full outage with a long fuse — and a full disk stops SQLite dead.

A sweep runs every six hours over a short list with a reason attached to each
line: metrics 30 days, sign-in attempts 90, fetched pages 60, the egress log a
year, finished jobs 30, read notifications 90, presence 2. Deletion happens in
bounded batches, because a single DELETE of two million rows would hold the
event loop for as long as it takes — housekeeping causing the outage it exists
to prevent.

**`audit_log`, `anchors` and `pii_subjects` are never on that list**, and
the overview says so on the page rather than only in the source. Deleting a
chain entry breaks every hash after it.

`RETENTION_ENABLED=false` switches it off; `POST /api/observability/retention`
runs it, defaulting to a dry run.

### Being told when something breaks

A push reaches a browser that has the app installed. An incident at 3am on a
machine nobody installed it on reaches nobody, and the first anybody knows is
the morning.

```bash
ALERT_CHANNEL=telegram        # + ALERT_TELEGRAM_TOKEN and ALERT_TELEGRAM_CHAT
ALERT_CHANNEL=webhook         # + ALERT_WEBHOOK_URL — Slack, Discord, Mattermost
ALERT_CHANNEL=command         # + ALERT_COMMAND — mail(1), ntfy, an SMS gateway, a pager
```

Test it with `POST /api/lifecycle/alert-test`. Only errors and the things that
genuinely stop the company go out this way: a channel people cannot mute
per-message is a channel they mute entirely.

### Getting a backup off the machine

A copy on the same disk survives a mistake, not the disk.

```bash
BACKUP_SHIP_COMMAND="rclone copy --config /etc/rclone.conf"
BACKUP_SHIP_COMMAND="aws s3 cp --storage-class STANDARD_IA"
BACKUP_SHIP_COMMAND="restic backup"
BACKUP_SHIP_COMMAND="scp -q -i /etc/alphacore/id_ed25519 backup@offsite:/srv/alphacore/"
```

The file path is appended as the last argument. Whatever you already trust is
better than a second-rate uploader built here, and it keeps its own credentials
where they belong. **A failure alerts** — a backup that silently stops leaving
the machine is indistinguishable from one that never did.

Between backups, the write-ahead log is archived every fifteen minutes to
`data/wal-archive/` (48 segments kept, then rotated). A nightly copy alone
means losing up to a day; these turn that into minutes. The bound is deliberate:
an unbounded archive fills the disk, and a full disk stops the database — a
backup feature that causes an outage.

The launch audit asks about both. "No backup has ever left this machine" is a
HIGH finding, not a note.



The server is a plain Node process. Any supervisor works.

**systemd** (`/etc/systemd/system/alphacore.service`):

```ini
[Unit]
Description=AlphaCore
After=network.target

[Service]
Type=simple
User=alphacore
WorkingDirectory=/opt/alphacore/crucible-core
ExecStart=/usr/bin/node --experimental-sqlite src/server.js
Restart=always
RestartSec=5
Environment=PORT=8484

[Install]
WantedBy=multi-user.target
```

**Health checks.** `GET /api/ping` needs no credential and answers with the
version and uptime. Everything else does need one — a probe that can read your
company is not a health check.

**In front of it, put TLS.** The server speaks plain HTTP. Terminate TLS at
nginx, Caddy or a load balancer, and do not expose port 8484 to a network
directly.

**Restarts are safe.** Runs that were in flight when the process died are
reclaimed to the queue at boot and recorded in the audit chain — they do not
sit as permanently "running".

---

## 12. When something is wrong

Start here, in this order:

| Symptom | Look at |
|---|---|
| Nothing happens when work is queued | Queue page — are workers running? Is a job dead? |
| Every answer looks fake | Header says `MOCK MODE` — no provider key is configured |
| A run failed with "Router exhausted" | The agent's tier has no provider that can serve it |
| Model spend stopped | A budget reservation hit the cap. Budgets page |
| An outbound call did not go out | Egress page — the gate logs *why*, including the rule that stopped it |
| The chain badge is red | Audit page → *Verify chain*. It names the exact entry that broke |
| A department opens an empty page | Run `node scripts/launch-audit.mjs` — it reports unwired sections by name |
| "invalid credentials" and you never saw the password | `npm run reset-password` — it prints a new one |

### The audit, in one command

```bash
node scripts/launch-audit.mjs
```

It asks the questions somebody should have to answer before handing this to
anyone — of the running system, not of the code — and exits non-zero if it
finds a blocker. Run it after any upgrade.

### The proofs

```bash
npm test              # unit tests, on their own database file
npm run prove         # the core promises, end to end
npm run prove:platform
```

All three run in mock mode: no key, no network, no cost.

---

## 13. Multiple companies on one machine

Tenancy is by file and process, not by a `WHERE` clause — two companies never
share a table:

```bash
ALPHACORE_DB=data/northwind.db PORT=8485 npm start
```

The Platform → Companies page does this for you, spawning and supervising a
process per tenant. Because the boundary is the operating system's rather than
a query's, a bug in one company's page cannot read another's rows.

Do not, however, put two parties who actively distrust each other behind one
machine. The isolation is real, the blast radius of a compromised host is not.

---

## 14. Environment variables

Everything below can also be set in Settings, which takes precedence. Use the
environment when a machine should be configured before it first starts.

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `8484`. |
| `ALPHACORE_DB` | Path to the database file, relative to `crucible-core/`. Default `data/alphacore.db`. |
| `ALPHACORE_MOCK` | `true` forces mock mode even when a key is present. |
| `ALPHACORE_MASTER_KEY_COMMAND` | A command printing the master key material. The KMS door. |
| `ALPHACORE_MASTER_KEY` | The material directly, base64. For container secrets. |
| `DRAIN_SECONDS` | How long to let in-flight work finish on SIGTERM. Default 20. |
| `PAPER_TRADING` | `true` reads the real world and changes nothing. |
| `EMBEDDING_MODEL` | A local ollama model for semantic recall. |
| `ALERT_CHANNEL` | `telegram`, `webhook` or `command`. |
| `BACKUP_SHIP_COMMAND` | Gets a backup off this machine. The path is appended. |
| `TRUST_PROXY` | `true` only when a reverse proxy sits in front, so `X-Forwarded-For` can be believed for rate limiting. |
| `ANCHOR_WITNESS` | `rfc3161` (default), `webhook` or `file`. |
| `ANCHOR_TSA_URL` | The timestamping authority. Defaults to DigiCert's free service. |
| `ANCHOR_EVERY_HOURS` | How often to anchor. Default 6. |
| `ALPHACORE_TENANT` | Set by the platform when it spawns a tenant process. You do not set this. |
| `ANTHROPIC_API_KEY` | And the equivalents for other providers. Prefer Settings — keys in Settings are encrypted; keys in the environment are not. |

Keys in `.env` are read at boot. That file is ignored by git, and so is
everything else that could leak: `data/`, `*.key`, `*.pem`, any `.env.*`.
