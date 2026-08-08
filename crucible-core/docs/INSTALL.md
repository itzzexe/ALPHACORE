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
    password   7Kd2xQm4Vt9

  This is shown once and is not stored anywhere in readable form.
  You will be asked to change it the moment you sign in.
──────────────────────────────────────────────────────────
```

**Copy it now.** It is stored only as a hash; nobody — not you, not the
platform — can read it back. If you lose it before signing in, stop the server,
delete `data/alphacore.db`, and start again.

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

## 4. Backups

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

## 5. Upgrading

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

## 6. Running it as a service

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

## 7. When something is wrong

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

## 8. Multiple companies on one machine

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

## 9. Environment variables

Everything below can also be set in Settings, which takes precedence. Use the
environment when a machine should be configured before it first starts.

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `8484`. |
| `ALPHACORE_DB` | Path to the database file, relative to `crucible-core/`. Default `data/alphacore.db`. |
| `ALPHACORE_MOCK` | `true` forces mock mode even when a key is present. |
| `ALPHACORE_TENANT` | Set by the platform when it spawns a tenant process. You do not set this. |
| `ANTHROPIC_API_KEY` | And the equivalents for other providers. Prefer Settings — keys in Settings are encrypted; keys in the environment are not. |

Keys in `.env` are read at boot. That file is ignored by git, and so is
everything else that could leak: `data/`, `*.key`, `*.pem`, any `.env.*`.
