# Part 11 — Phase 0 Starter Kit

**Crucible Systems** (working name) · Companion to Parts 1–10 · The executable edge of the blueprint
Version 0.1 — Draft for founder review · Labeling convention from Part 1 applies ([Fact] / [Assumption] / [Recommendation] / [Experiment] / [Decision] / [Open question])

**Scope of this part:** everything needed to *start tomorrow with no platform*: the first ten actions as a tracked worklist, the seed Decision Record DR-0001, the founder-agreement term checklist, the provider-selection scorecard, the jurisdiction/payment-rail decision matrix, three blank candidate product-space one-pagers, the tripwire signature sheet, and the week-by-week Phase 0 plan ending at the M0 go/no-go. Per Part 7 §9.6 action 9: **the Decision Registry exists before the platform does** — a shared doc holding these filled forms *is* the registry until Phase 1 builds the tables.

---

## 1. The First Ten Actions (Part 7 §9.6, as a worklist)

| # | Action | Owner | Deadline **[fill]** | Required artifact | Done |
|---|---|---|---|---|---|
| 1 | Engage counsel on A6 (entity + payment rails) and A5 (provider terms) | CEO | wk 1 | Engagement letter; counsel memo scoping both | ☐ |
| 2 | Draft founder agreement (vesting, IP assignment, deadlock, departure) | CEO + counsel | wk 2–4 | Signed agreement (§3 checklist) | ☐ |
| 3 | Select and contract two model providers | CTO | wk 3–5 | §4 scorecards + signed terms + DPA/no-training verification | ☐ |
| 4 | Validate banking/PSP path end-to-end against the chosen entity plan | CEO | wk 3–6 | §5 matrix completed; counsel confirmation | ☐ |
| 5 | Write 3–5 Gate-1 one-pagers from candidate spaces | CEO (Research agent drafts once providers live) | wk 2–5 | §6 forms filled, A8 checks passed | ☐ |
| 6 | Ratify budget, authority limits, and the five load-bearing rules | Both/all founders | wk 4–6 | DR-0002 (budget) + DR-0003 (authority matrix, Part 2 §7.1 limits) | ☐ |
| 7 | Stand up accounts + password manager + 2FA baseline | CTO | wk 1–2 | Access inventory; 2FA verified on every account | ☐ |
| 8 | Name/trademark search (retire "Crucible Systems" if taken) | CEO | wk 2–4 | Search results; name decision DR-0004 | ☐ |
| 9 | Open DR-0001 in a plain shared doc | CEO | **day 1** | §2 below, filled and signed | ☐ |
| 10 | Put the weekly gate sync on the calendar | CEO | day 1 | Recurring invite + Part 9 §13.1 note template linked | ☐ |

---

## 2. DR-0001 — The Seed Decision (pre-filled; sign to begin)

```
ID: DR-0001   Title: Adopt the Crucible blueprint and run Phase 0 as a bounded experiment   Tier: T3
Owner (human): CEO (named): ____________   Deadline: end of Phase 0 (____________)
Context: Parts 1–10 propose an AI-native SaaS company. This decision commits founder time and
Phase-0 spend ONLY (≈ $0.7–1.5k/mo + incorporation costs, Part 6 §3) to close A5/A6, ratify
the operating rules, and reach the M0 go/no-go. It does NOT commit Phase-1 funds — M0 does.

Options considered:
  A) Proceed per blueprint (bounded experiment, kill criteria armed)   ← selected
  B) Solo-builder alternative (Part 1 §12 / Part 7 §8.2) — preserved as the pre-approved fallback
  C) Do nothing — rejected with reasons on record: ____________

Evidence: the seven-part blueprint + Parts 8–10; all market claims remain [Assumption] by design.
Assumptions carried: A1–A9 (Part 1 §4), each with its stated validation method.
Conditions (from Part 7 §9.2):
  1. A5/A6 closed by counsel before material spend — owner CEO
  2. Capital decision made: $75–90k committed OR $60k thin-trough accepted in writing — owners: all founders
  3. Scenario-A pay accepted ≥ 12 months, in writing — all founders
  4. Tripwire responses signed (§7 below) — all founders
  5. Five load-bearing rules ratified (Part 7 §9.2.5) — all founders
Dissent (preserved verbatim): ____________________________________________
Human approvals: ____________ (CEO)  ____________ (CTO)  ____________ (3rd founder, if any)
Review date: M0 go/no-go   Expiry triggers: any Phase-0 kill trigger (Part 1 §11 row 0)
```

---

## 3. Founder Agreement — Term Checklist (for counsel; F6 mitigation, Part 7 §2)

☐ Equity split + rationale recorded · ☐ Vesting: 4 years / 1-year cliff **[Recommendation — market standard; counsel confirms fit]** · ☐ IP assignment: all pre-existing and created IP assigned to the entity · ☐ Deadlock-breaking mechanism for a 2-founder company (named mediator, buy-sell, or casting-vote rotation — pick one) · ☐ Departure terms: good/bad leaver, buyback price formula · ☐ Time commitment stated (hours/week per founder) · ☐ Capital commitment per founder + the $60k-vs-$75–90k decision (Part 6 §13) · ☐ Scenario-A compensation term (≥ 12 months) · ☐ Decision authority: the Part 2 §7.1 matrix incorporated by reference · ☐ Confidentiality + non-solicit (jurisdiction-appropriate; counsel drafts) · ☐ Dispute resolution venue

## 4. Provider-Selection Scorecard (one per candidate; two winners required — A9)

```
Provider: ____________   Evaluated by: CTO   Date: ______
| Criterion | Weight | Score 1–5 | Notes |
| Frontier-tier capability (T3/T4 tasks: code, review, reasoning) | 0.25 | | eval on our golden tasks, not benchmarks |
| Commercial terms: output ownership, usage rights (A5) | 0.20 | | counsel-reviewed, not remembered |
| DPA + no-training configuration available & verifiable | 0.15 | | account-setting evidence required (Part 7 §5) |
| Price per token at our projected mix (Part 6 §4) | 0.15 | | |
| Rate limits & reliability history | 0.10 | | |
| Model-version pinning support | 0.10 | | hard requirement for ADR-005 |
| Regional/legal accessibility from our entity | 0.05 | | ties to A6 |
Weighted total: ____   Verdict: primary / secondary / rejected
Family independence check: candidate pair are different model families (separation of duties): ☐
```

## 5. Jurisdiction / Payment-Rail Decision Matrix (A6 — counsel completes; no option is pre-decided)

| Criterion | Option A: US entity (e.g., Delaware) | Option B: UK Ltd | Option C: UAE entity | Notes |
|---|---|---|---|---|
| Major PSP access (Stripe-class) | fill with counsel | fill | fill | The binding constraint per A6 |
| Business banking access for MENA-resident founders | fill | fill | fill | Test end-to-end, not by reputation |
| Formation + annual cost | fill | fill | fill | Feeds Part 6 §2 range |
| Tax posture + treaty relevant to founders | fill | fill | fill | Counsel only — no forum lore |
| Admin burden (filings, registered agent) | fill | fill | fill | |
| Data-protection regime fit for target market | fill | fill | fill | Ties to A8/Gate 1 |
| **Verdict** | | | | → DR-0005, T3, CEO + counsel |

## 6. Candidate Product-Space One-Pagers (three blank Gate-1 forms — copy Part 9 §3 per candidate)

```
Candidate 1: ____________________  → Part 9 §3 form attached  → A8 checks: ☐☐☐☐☐
Candidate 2: ____________________  → Part 9 §3 form attached  → A8 checks: ☐☐☐☐☐
Candidate 3: ____________________  → Part 9 §3 form attached  → A8 checks: ☐☐☐☐☐
Selection into the two Gate-1/2 exploration slots (Part 4 §8): DR-____, CEO, with reasons + dissent.
[Reality-first: these one-pagers carry sourced claims or explicit [Assumption] tags — the blueprint
never supplies market evidence, founders and Gate 2 do.]
```

## 7. Tripwire & Kill-Trigger Signature Sheet (Part 7 §2 — the signatures make them real)

| # | Tripwire | Pre-committed response | Signed CEO | Signed CTO | Signed 3rd |
|---|---|---|---|---|---|
| F1 | Rework > 40% for 3 slices, or canary catch < 90% | Pause train; draft-only in failing area; > 50% sustained → services pivot or stop | ☐ | ☐ | ☐ |
| F2 | Runway < 6 months at current net burn | Automatic discretionary freeze; T3 raise/cut/pivot with finance pack | ☐ | ☐ | ☐ |
| F3 | Governance > 10 h/wk/founder for a month; escalation > 15%; awaiting_human p95 > 2 bus. days | Re-tier at the monthly council — never quietly skip gates | ☐ | ☐ | ☐ |
| F4 | Activation < target at 30 days; cohort churn > 2× plan | Out-of-cycle Gate-10 hard review; second miss → retire per runbook | ☐ | ☐ | ☐ |
| F5 | Injection attempts trending; egress denial on write-scoped run; pentest high | Kill-and-rotate; human incident command; disclosure CEO + counsel (T3) | ☐ | ☐ | ☐ |
| F6 | Founder event | Founder agreement clauses + deputies + deputy-run break-glass drills | ☐ | ☐ | ☐ |
| — | Phase-1 week 12 incomplete | Cut to queue + budgets + audit + GitHub gates; proceed to product | ☐ | ☐ | ☐ |
| — | Gate 2 fails twice | New product space — no third attempt on the same space | ☐ | ☐ | ☐ |

## 8. Week-by-Week Phase 0 Plan (4–6 weeks, ending at M0)

| Week | Focus | Exit check |
|---|---|---|
| 1 | Actions 1, 7, 9, 10: counsel engaged, security baseline, DR-0001 signed, calendar live | DR-0001 signed by all founders |
| 2 | Actions 2 (draft), 5 (start), 8: founder-agreement draft circulating; candidate spaces listed | ≥ 3 candidates named |
| 3 | Actions 3, 4 (start): provider scorecards; banking/PSP validation begins | Two provider finalists identified |
| 4 | Actions 2 (sign), 6 (draft), 8 (decide): agreement signed; budget + authority drafts; name decision | Founder agreement signed (F6 armed) |
| 5 | Actions 3 (contract), 4 (confirm), 5 (finish): providers contracted; A6 path confirmed; one-pagers done | A5 + A6 closed by counsel |
| 6 | Action 6 (ratify) + M0 assembly: all checklist items to the go/no-go | **M0 checklist (below) — all boxes or "not yet"** |

**M0 go/no-go (Part 7 §9.3, operational copy):**
☐ A6 entity + payment-rails confirmed by counsel ☐ A5 provider terms reviewed ☐ Two providers contracted ☐ Capital committed per Part 7 §9.2.2 ☐ Founder time commitments in writing ☐ Scenario-A pay accepted ≥ 12 months ☐ Founder agreement signed (vesting + deadlock) ☐ Authority limits + thresholds ratified ☐ Tripwire sheet signed (§7) ☐ 3–5 Gate-1 one-pagers exist
**All boxes → M0 → fund Phase 1 (Part 3 §11 build sequence). Any box open → not yet — and "not yet" is the system working, not failing.**

---

## 9. Self-Review of Part 11 (abbreviated)

| Item | Assessment |
|---|---|
| Strongest reason to adopt | The gap between "blueprint approved" and "work started" is where plans die; this part reduces day one to signing DR-0001 and sending one email to counsel. |
| Strongest reason to reject | Some scaffolding (scorecards, matrices) may be heavier than 2–3 people need for choices they could make in a conversation. Counter: these are exactly the choices (A5/A6, providers) whose undocumented failure is fatal, and each form is one page. |
| Confidence | ~8/10 — this part contains no new claims, only the existing blueprint's first steps made walkable. |

**[Open question]** Names into the owner columns · actual dates into the deadline column · the capital decision ($60k vs $75–90k) — the three blanks only founders can fill.

---

*End of Part 11 — and of the blueprint package. Everything before this part argued; this part starts.*
