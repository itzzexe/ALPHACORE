## What this changes

<!-- One or two sentences. The commit-message voice: the thing you would say to
     a colleague, not a changelog entry. -->

## Why

<!-- The problem, not the patch. -->

## Checks

- [ ] `npm test` passes
- [ ] `npm run prove` passes
- [ ] `npm run prove:platform` passes
- [ ] `node scripts/launch-audit.mjs` reports no new findings
- [ ] Any new interface string exists in both English and Arabic
- [ ] Any new colour is a design token and resolves in both themes
- [ ] Nothing under `data/`, no `.env`, no `*.key` is in the diff

## Gates

<!-- Delete if it touches none of these. -->

- [ ] This change can cause money to leave — and a signed-in human still has to
      authorise it
- [ ] This change can contact someone outside the company — and it still passes
      the egress gate
- [ ] This change writes to the audit chain — and the actor it records is the
      actor that acted
