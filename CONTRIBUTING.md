# Contributing

Thanks for looking. This project has an unusual shape, so a few minutes here
will save you an afternoon.

## What this is

`app/` is the running platform: one Node process, no frameworks, no
build step. The eleven `Part-*.md` files at the root are the blueprint it was
built from — they are documents, not code, and they change rarely.

## Getting it running

```bash
cd app
npm install          # only @anthropic-ai/sdk and its deps
npm start            # http://localhost:8484
```

Node **22.5 or newer** is required — the database layer uses `node:sqlite`,
which does not exist before 22.5. First run generates an owner account and
prints its password to the console once; it is not stored anywhere else and the
account cannot do anything until you change it.

No API key is needed to develop. Without one the platform runs in mock mode:
every model call returns a shaped stub, so the whole system is exercisable for
free.

## Before you open a pull request

```bash
npm test             # unit tests — they use their own database file
npm run prove        # end-to-end proof of the core promises
npm run prove:platform
node scripts/launch-audit.mjs    # needs the server running
```

All four must pass. `npm test` writes to `data/test.db`, never to your real
database — if you see it touch `data/alphacore.db`, that is a bug worth
reporting on its own.

## House style

The code has a voice. Match it rather than your own:

- **Comments explain why, never what.** `// increment the counter` is noise.
  `// The tests used to delete the live database before importing this module`
  is the kind of comment that belongs here.
- **No frameworks, no build step, no bundler.** The browser loads the same
  JavaScript that is in the repository. Keep it that way.
- **Two spaces, single quotes, semicolons.** Match the file you are in.
- **Names say what a thing is.** `reclaimOrphanedRuns` over `fixRuns`.
- **Arabic is a first-class language, not a translation layer.** New interface
  strings go in `public/i18n.js` in both languages. Arabic is a connected
  script: never give it letter-spacing.
- **Design tokens, not hex codes.** `var(--ink-mute)`, not `#8d8477`. Every
  colour must resolve in both the light and dark themes.

## Things that will get a pull request refused

Not out of pedantry — each of these breaks a promise the platform makes:

- Weakening the audit chain: making `audit_log` mutable, removing the hash
  link, or writing a fabricated human approver where the actor was the system.
- Letting autonomy reach an irreversible outbound action — money, a signature,
  a message to someone who never asked to hear from us — without a human gate.
- Storing a private key, seed phrase or mnemonic anywhere, for any reason.
- Adding a hard-coded credential, or printing one anywhere but the first-run
  console.
- Adding an external network request to the front end. The console loads no
  fonts, no CDNs, no analytics, and makes zero requests to anything but its own
  server. This is checked.
- Committing anything under `data/`, any `.env`, or any `*.key` / `*.pem`.

## Commit messages

Write the sentence you would say to a colleague. The history reads as prose on
purpose:

```
Marketing becomes a district: twenty desks, wired in and wired out
```

not `feat(marketing): add sections`. One commit per idea.

## Reporting a security issue

Do not open an issue. See [SECURITY.md](SECURITY.md).

## Licence

Contributions are accepted under the MIT licence, the same terms as the rest of
the project. By opening a pull request you agree that your work ships under it.
