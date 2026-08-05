# Crucible Core — Operations Platform

The working implementation of **Part 3 — Technical Design** from the Crucible blueprint: a modular monolith that makes the operating rules physical — *budgets before calls, gates before production, provenance before memory, and a hash-chained record of all of it.*

## What it does

| Module | Blueprint ref | What it enforces |
|---|---|---|
| Decision Registry | Part 2 §7.7, Part 3 §4.1 | Decisions with tiers, evidence provenance (unverified → verified is **human-only**), expiry sweeps that reopen stale decisions |
| Mini-Tribunal | Part 2 §7.3–7.4 | Advocate → **blind parallel critics** (isolation asserted in the audit log) → judge synthesis. Judges recommend; **humans decide**. Any critic block forces escalation. Spend draws from the governance pool (≤5% rule) |
| Model Router | Part 3 §6, ADR-005 | Tier chains with pinned models, provider fallbacks, **family separation** (reviewer ≠ author family), sensitivity ceilings (no-DPA providers never see customer data), fail-closed for review roles |
| Policy Engine | Part 3 §4.2 | **Reservation-first budgets**: per-agent daily caps, per-decision caps (T1 $2 / T2 $15 / T3 $75), company monthly, governance pool. The hard stop fires *before* the call |
| Workflow Engine | Part 3 §5, ADR-003 | Run queue + small state machine. `awaiting_human` is a first-class state; logic failures never retry; transport failures requeue then dead-letter |
| Audit Log | ADR-006 | Append-only (SQL triggers) + SHA-256 hash chain, verifiable end-to-end from the dashboard |
| Pipelines | Part 1 §7 (FORGE) | Templated chains (PRD → Architecture → Implementation → Review → QA; research brief; support reply). Each step feeds the next; a step that lands `awaiting_human` pauses the whole pipeline at the gate; approval resumes, rejection fails it. When no independent model family is available, review degrades to same-family **with a flag and a forced human gate** (Part 1 §8.3 "where feasible") |
| Artifacts | — | Real production on disk: every completed step is archived to `workspace/<pipeline>/_forge/`, and an Engineer run's `files[]` are written as actual files by an explicit **human apply** action. All paths sandboxed to the workspace root; each workspace is an isolated project (own `package.json`) |
| Dashboard | — | Overview + live system map, human gate queue, pipelines, runs (with apply-to-workspace), artifacts browser, decisions + tribunal viewer, agents, budgets, audit chain, providers |

## Providers

Five backends behind one router — the tier chains are config, not code (`config/providers.json`):

- **Anthropic Claude API** (`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`) via the official SDK
- **Claude subscription** — your claude.ai Pro/Max plan via the Claude Code CLI (`claude -p`), zero marginal cost
- **OpenAI** (`gpt-5.1`, `gpt-5-mini`)
- **DeepSeek** (`deepseek-chat`, `deepseek-reasoner`) — flagged no-DPA, so the sensitivity router keeps customer data away from it
- **Google Gemini** (`gemini-3-pro-preview`, `gemini-2.5-flash`)

**No keys? No problem.** With zero keys configured the router serves every call from a deterministic mock at zero cost — the full platform (queue, tribunal, budgets, audit) is demoable immediately.

## Quick start

```powershell
cd crucible-core
npm install
npm run seed     # sample agents, runs, and one tribunal case (mock, $0)
npm start        # http://localhost:8484
```

To go live, copy `.env.example` → `.env`, add any keys you have, restart. Model prices in `config/providers.json` are entered as of 2026-08 — verify before production (the blueprint's own rule).

Requires **Node ≥ 22.5** (uses the built-in `node:sqlite`; the npm scripts pass the flag).

## Tests

```powershell
npm test
```

Covers: audit-chain integrity, budget hard-stop before spend, run lifecycle in mock mode, reviewer family separation, and a full mini-tribunal round-trip.

## Design decisions on top of the blueprint

- **ADR-007 (this repo): SQLite in dev.** Same schema as the Part 3 Postgres DDL, one file, zero setup. Postgres remains the production target per ADR-002.
- Human actions (approve/reject, verify evidence, freeze/unfreeze, suspend agent) require an `actor` name recorded in the audit chain; the dashboard's "Acting as" field supplies it.
- The Claude-subscription provider shares the `anthropic` family, so it can never be paired against the Claude API as an "independent" reviewer — family separation is enforced in the router, not by convention.
