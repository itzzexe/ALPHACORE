# Getting help

## Read this first

Most questions are answered in one of three places, and looking takes less time
than waiting for a reply.

| Your question | Where |
|---|---|
| How do I install it, back it up, upgrade it, fix it at 3am? | [docs/INSTALL.md](docs/INSTALL.md) |
| How does it work, and why is it built like that? | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| What does this setting do? | [Configuration](README.md#configuration) |
| What is this endpoint? | [`app/public/openapi.json`](app/public/openapi.json), or `/api/openapi.json` on a running instance |
| Is this a known gap? | [docs/NEXT.md](docs/NEXT.md) |
| What changed recently? | [CHANGELOG.md](CHANGELOG.md) |

## Then

**Something is broken** → open a
[bug report](https://github.com/itzzexe/crucible-core/issues/new?template=bug_report.yml). Include what you did,
what happened, what you expected, and the output of:

```bash
cd app
npm test                        # does the suite pass on your machine?
node scripts/launch-audit.mjs   # what does the pre-flight say?
```

A report with those two outputs in it is usually diagnosed on the first reply. A
report saying "it does not work" is not, and will get questions instead of an
answer.

**Something is missing** → open a
[feature request](https://github.com/itzzexe/crucible-core/issues/new?template=feature_request.yml). Say what you
are trying to do, not only what you want built — the problem is often solvable
with something that already exists.

**You have a question that is not either** → open a discussion or an issue
titled as a question. Nobody minds.

**You want to pay for it to be handled properly** →
[COMMERCIAL-LICENCE.md](COMMERCIAL-LICENCE.md).

## Do not open an issue for

**A security hole.** Follow [SECURITY.md](SECURITY.md) — a public issue tells
everybody running this how to attack it before there is a fix.

**Somebody's behaviour.** Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## What to expect

This is maintained by one person. You will get a reply, and sometimes the reply
is "not soon" or "not at all, and here is why" — which is better than silence and
is the reason nobody here promises a response time they cannot keep.

A clear bug report with a reproduction is the most likely thing to be fixed
quickly. A pull request is more likely still: see
[CONTRIBUTING.md](CONTRIBUTING.md).
