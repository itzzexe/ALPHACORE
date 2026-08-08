# Security

AlphaCore runs a company. It holds customer records, provider API keys, wallet
addresses and an audit chain that is supposed to be trustworthy. So this page
says two things: how to report a hole, and what the system already promises.

## Reporting a vulnerability

Email **zaid.alaloosy1992@gmail.com** with `SECURITY` in the subject. Please do
not open a public issue for anything exploitable.

Include what you need to make it reproducible: the version or commit, the
request, and what you got back. If you have a proof of concept, a curl command
is worth more than a paragraph.

What to expect:

| | |
|---|---|
| Acknowledgement | within 3 working days |
| First assessment | within 10 working days |
| Fix or documented mitigation | depends on severity; you will be told which |
| Credit | yours if you want it, silence if you prefer |

There is no bug bounty. This is a solo-maintained project and pretending
otherwise would be dishonest.

## Supported versions

`main` only. There is no long-term support branch yet; when the first tagged
release ships, this table gets one.

## What the system guarantees

These are load-bearing properties. A bug that breaks one of them is a security
bug, not a feature request:

- **The audit log is append-only.** SQL triggers abort `UPDATE` and `DELETE` on
  `audit_log`, and every row carries a SHA-256 hash of the row before it. A
  tampered history fails `verifyChain()` at the exact entry that was touched.
- **Money leaves only by a signed-in human.** Autonomy cannot reach payout
  resolution. Wallets are watch-only; the platform never holds a private key, a
  seed phrase or a mnemonic, and payouts are signed outside it.
- **The egress gate is failure-closed.** Scope, allowlist, quota, constitution,
  value ceiling, dry-run — in that order, and the intent is written to the audit
  chain *before* the call goes out. If the gate cannot evaluate a rule, the call
  does not happen.
- **Actor identity comes from the server.** A client can ask for an action; it
  cannot claim to be someone. The session's user is injected server-side and
  overrides anything in the request body.
- **Secrets are encrypted at rest.** AES-256-GCM, with the master key stored
  outside the database in `data/master.key`. The settings API masks stored
  secrets to their last four characters and never echoes one back.
- **First run generates its own password.** No account ships with a known
  password, and an account still holding a generated one can do exactly two
  things: look at itself, and replace that password.

## What it does not guarantee

Stated plainly, because a security page that only lists strengths is marketing:

- **It is built to run on a machine you control.** There is no hardened
  multi-tenant boundary inside one process — tenants are separated by *file and
  process*, not by a `WHERE` clause. Do not put two parties who distrust each
  other behind one instance.
- **`data/master.key` is a file on disk.** If someone can read your filesystem,
  they can read your vault. A real deployment moves that key to a secret
  manager or an HSM.
- **The bundled prompt-injection scanner is a filter, not a proof.** It catches
  known shapes in English and Arabic. Treat anything an agent fetched from the
  open web as untrusted input, because it is.
- **HTTP by default.** The server speaks plain HTTP on `localhost`. Exposing it
  to a network without a TLS terminator in front is on you.

## Handling a leaked key

If a provider key reaches a log, a screenshot, a chat window or a commit:
rotate it at the provider first, then replace it in Settings. Rotating is
cheap; assuming it was never seen is not.
