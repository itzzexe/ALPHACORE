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

## 6. Backups

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

## 7. Upgrading

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

## 8. Running it as a service

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

## 9. When something is wrong

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

## 10. Multiple companies on one machine

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

## 11. Environment variables

Everything below can also be set in Settings, which takes precedence. Use the
environment when a machine should be configured before it first starts.

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `8484`. |
| `ALPHACORE_DB` | Path to the database file, relative to `crucible-core/`. Default `data/alphacore.db`. |
| `ALPHACORE_MOCK` | `true` forces mock mode even when a key is present. |
| `ANCHOR_WITNESS` | `rfc3161` (default), `webhook` or `file`. |
| `ANCHOR_TSA_URL` | The timestamping authority. Defaults to DigiCert's free service. |
| `ANCHOR_EVERY_HOURS` | How often to anchor. Default 6. |
| `ALPHACORE_TENANT` | Set by the platform when it spawns a tenant process. You do not set this. |
| `ANTHROPIC_API_KEY` | And the equivalents for other providers. Prefer Settings — keys in Settings are encrypted; keys in the environment are not. |

Keys in `.env` are read at boot. That file is ignored by git, and so is
everything else that could leak: `data/`, `*.key`, `*.pem`, any `.env.*`.
