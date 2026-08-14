# Threat model — personal data at rest

This document exists so that nobody, including us, can describe AlphaCore's
personal-data encryption as more than it is. It was written **before** the
encryption-at-write code, and every design choice in that code is checked
against it. If the two ever disagree, this document is right and the code is a
bug.

The one-sentence version:

> Sealing personal data at write protects you from **somebody who ends up with
> the bytes**. It does not protect you from **somebody who ends up with the
> running process**.

---

## 1 · What it protects against

**Disk theft.** A laptop, a decommissioned server, a drive pulled from a rack.
The database file is on it. The attacker has `alphacore.db` and all the time in
the world. Tier A columns are AES-256-GCM ciphertext under per-subject keys,
each of which is itself sealed under the master key. If the master key is
supplied from outside the disk — a KMS command or the environment, which is what
production mode requires — the disk alone yields nothing.

**Backup theft.** The same argument, and in practice the more likely one:
backups travel, get emailed, land in object storage with a permissive policy,
and outlive the people who made them. Sealing happens *at write*, so the
ciphertext is what gets copied. There is no window in which a backup contains
plaintext that the live database does not.

**Casual database reads.** The largest category by volume and the one nobody
puts in a threat model. An engineer opening the database to debug something
unrelated. A support query pasted into a chat. A `SELECT *` in a screenshot. A
log line that swept up a row. In every one of those the reader has legitimate
access to *the database* and no legitimate need for *the contents of a
stranger's call transcript*, and until now the difference was policy. Now it is
arithmetic.

**A subject exercising erasure.** Not an attack, but the same mechanism:
destroying one person's key makes their data unreadable everywhere it landed at
once, including inside the append-only chain, including in backups already
taken. This is why the encryption is per-subject rather than per-database.

---

## 2 · What it does NOT protect against — stated plainly

**Compromise of the live process.** This is the important one and it is not a
caveat, it is a boundary. A running AlphaCore holds the master key in memory and
can unwrap any subject key on demand, because it has to: the support page has to
show the ticket. Anybody who achieves code execution in that process, or who can
read its memory, or who can call its API with sufficient permission, can read
personal data. Field-level encryption cannot fix this and no product that claims
otherwise is telling you the truth.

Concretely, all of the following defeat it entirely:

- remote code execution in the Node process
- a core dump, a debugger, or `/proc/<pid>/mem`
- a stolen session token or API key belonging to a permission that can read the surface
- a malicious or compromised package in the dependency tree
- an administrator on the host

**A stolen master key alongside the database.** If the master key lives in
`data/master.key` on the same disk as `data/alphacore.db`, then disk theft is
key theft and this whole document collapses to "we made grep harder". That is
exactly why production mode refuses to boot in that configuration
(`ALPHACORE_MASTER_KEY_COMMAND` or `ALPHACORE_MASTER_KEY`, and the override is
recorded on the chain). **Encryption at write is only as good as where the
master key comes from.**

**Traffic analysis and metadata.** Sealing hides *what was said*, not *that a
call happened*, when, how long it was, or which agent made it. Row counts,
timestamps, states and foreign keys stay plaintext by design — see Tier B — and
they are frequently enough to harm someone. A pattern of calls to a clinic is
disclosive whether or not the transcript is readable.

**Tier B data.** Names, company names, references, amounts, aggregates. Not
sealed, deliberately (§4). Their protection is full-disk encryption and a
KMS-held master key, and that is documented guidance rather than something the
code enforces.

**The database structure itself.** Table names, column names and the schema are
plaintext. An attacker with the file learns exactly what kinds of personal data
this company holds, and about how many people, even where they cannot read any
of it.

**Free pages, unless they are reclaimed.** This one was found by the test rather
than by reasoning, and it is worth stating in full because it is the kind of
thing a threat model usually gets wrong.

Sealing an existing row is an `UPDATE`. SQLite does not zero the page the old
value was on — it marks it free and moves on. So a database that has been
backfilled still contains every plaintext transcript it ever held, invisible to
every `SELECT` and perfectly legible to `strings`. A backup taken afterwards
copies them. The encryption would have been, precisely and only, cosmetic.

Two things close it, and both are in the code rather than in this paragraph:
`PRAGMA secure_delete = ON` at every connection, so overwritten content is
zeroed from now on, and a `VACUUM` at the end of the backfill, which is the
only way to reclaim pages that were already freed. The backfill job is not
finished until the vacuum has run, and the result is recorded on the chain
beside the count. `test/sealing.test.js` asserts the planted value is absent
from the raw file *after* a resumed backfill, which is the assertion that
caught this.

---

## 3 · What remains required, and is not optional

Encryption at write is a layer. It replaces nothing below it.

1. **Full-disk encryption on the host.** Still required. It is what covers Tier
   B, swap, temporary files and everything this design deliberately leaves in
   plaintext.
2. **A master key from outside the disk.** Still required, and now enforced:
   production mode refuses to boot without it.
3. **Backup encryption in transit and at rest.** Still required. Sealed Tier A
   travels safely; the rest of the backup does not.
4. **Least privilege on the API.** Still required, and now the *primary*
   control for the live process, because §2 says field crypto is not one.

---

## 4 · Why two tiers rather than sealing everything

Sealing a column costs three things: it cannot be searched with `LIKE`, it
cannot be joined on, and it cannot be aggregated. Those are not implementation
gaps — they are what encryption *is*.

Sealing everything would therefore mean either breaking deep search,
reconciliation and the economics reports outright, or building a searchable-
encryption scheme to get them back. The second is a research project, and the
usual outcome is an index that leaks the plaintext it was built to hide, which
would be a worse position than today dressed as a better one.

So the split is drawn where the harm is:

- **Tier A — sealed at write.** The content of what somebody said, wrote or
  typed, and the identifiers that reach them. A call recording, a transcript, a
  support message body, a contact's email address or phone number. Reading any
  one of these tells you something about a specific person that they did not
  intend for you. Nothing in the company's own operation needs to search or
  aggregate them.
- **Tier B — plaintext by design.** Names, references, states, amounts, dates,
  foreign keys. The company cannot run without matching on them. Their
  protection is §3.1 and §3.2, documented rather than enforced in the field.

**The invariant that keeps this honest:** every Tier A column must also be
reachable by the erasure walk. A column sealed at write but invisible to erasure
is data nobody can delete, which is worse than plaintext data everybody can.
That cross-check is a test, not a promise — see `test/erasure.test.js`.

---

## 5 · The residual risk, named

After all of the above, the honest statement of what an attacker gets:

| The attacker has | They can read |
| --- | --- |
| The database file only | Tier B. Structure. Row counts and timestamps. Not Tier A. |
| The database file **and** `data/master.key` | Everything. This is why production mode refuses to run that way. |
| A backup, or the WAL archive | The same as the database file — sealing is at write, so it is sealed in the copy. |
| Code execution in the live process | Everything, including Tier A. Field crypto is not a control here. |
| A valid session or API key | Whatever that permission may read, decrypted. As designed. |
| A subject's erased key | Nothing. There is no key. Not for them, not for us, not with a court order. |

The last row is the only one in this table where the answer is *nothing*, and it
is the reason the whole design is per-subject.

---

## 6 · Checking this document against the code

- Tier A column list: `PII_COLUMNS` in `src/erasure.js` (the `also` lists) plus
  the tiering recorded in the data-governance inventory. If they disagree, the
  cross-check test fails.
- Sealing primitives: `sealPii` / `openPii` in `src/erasure.js`. No new
  cryptographic code was written for encryption-at-write; it reuses the vault's
  AES-256-GCM and the master key's existing wrapping.
- Master key sources and the production gate: `src/masterkey.js`,
  `src/production.js`.
- The claim that a planted value is absent from the raw file: asserted against
  the bytes of `data/*.db`, the backup file and the WAL, in `test/erasure.test.js`.
