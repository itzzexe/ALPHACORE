# Part 9 — Templates and Artifact Pack

**Crucible Systems** (working name) · Companion to Parts 1–8
Version 0.1 — Draft for founder review · Labeling convention from Part 1 applies ([Fact] / [Assumption] / [Recommendation] / [Experiment] / [Decision] / [Open question])

**Scope of this part:** the fill-in forms behind every required artifact named in Parts 2–5, ready to copy into the registry (or, before the platform exists, into a plain shared doc — Part 7 §9.6 action 9). Rule inherited from Part 4 §1.2: **an artifact that doesn't change a decision is deleted from the required list, not padded.** Each template states the gate or ritual it serves and the tier of the decision it feeds.

---

## 1. Decision Record (all tiers; the registry's core row — Part 2 §7.7)

```
ID: DR-____-____          Title: ____________________          Tier: T0 / T1 / T2 / T3
Owner (human): __________          Deadline: __________          Status: open
Context (2–4 sentences — what question, why now):
____________________________________________________________________

Options considered (min. 2 for T2+; Conservative / Balanced / Innovative for Tribunal cases):
  A) ____________________  B) ____________________  C) ____________________

Evidence (each line: claim · source ref · verified/unverified · expires):
  1. ______________________________________________
  2. ______________________________________________
  (No evidence for a load-bearing claim? Write "EVIDENCE GAP" — never a plausible sentence.)

Assumptions (each with a validation path):
  1. ______________________________________________

Consensus score (Tribunal cases): ____   Judge confidence: ____
Outcome: approved / approved with conditions / needs evidence / escalated / rejected / deferred
Conditions (each: condition · owner · due date):
  1. ______________________________________________
Dissent (verbatim, preserved): _____________________________________
Remaining unknowns: _______________________________________________
Human approval(s): __________ (name, date)
Review date: __________   Expiry triggers (Part 2 §7.7 list): ______________________
```

## 2. Evidence Entry (feeds §1; schema Part 3 §4.1 `decision_evidence`)

```
Claim: _____________________________________________
Source ref (URL / doc / measurement / interview ID): ______________
Verification: unverified / verified (BY WHOM — human or audited pipeline only): ______
Expires: __________   Added by: __________
```

## 3. Gate 1 — Opportunity One-Pager (Part 4 §6.1; decision tier T2, CEO)

```
Product-space name: ____________________
Problem statement (one paragraph, in the customer's words where possible):
____________________________________________________________________
Who has it (segment · reachable how · roughly how many — source or [Assumption]):
____________________________________________________________________
How they cope today (competitors/workarounds, with links):
____________________________________________________________________
Why now: ___________________________________________________________
Initial revenue hypothesis:  $____/mo × ____ customers  → vs the 60–170 sanity band: PASS / FAIL
Strategic fit — A8 constraint check:
  ☐ Not a regulated domain   ☐ Low data sensitivity   ☐ Web + API only
  ☐ Business-hours support plausible   ☐ Niche reachable by founders' channels
Top 3 assumptions + proposed validation:
  1. ______________________  2. ______________________  3. ______________________
Requested Gate 2 experiment budget: $______
Confidence (0–1): ____   What would change it: _______________________
```

## 4. Gate 2 — Experiment Pre-Registration (Part 4 §6.2 — **filed BEFORE running anything**; one form per experiment)

```
Experiment ID: EXP-____   Linked one-pager: DR-____
Hypothesis: ________________________________________________________
Metric: ____________________
THRESHOLD (the bar, chosen now, not after): ____________________
Sample / audience + sourcing: _______________________________________
Duration: __________   Budget: $______
Decision rule: ≥ threshold → proceed;  below → kill or ONE reframe loop to Gate 1
What would make this result untrustworthy (confounds): ________________
Registered by: __________  Date: __________
[The go/no-go record must cite this form and MAY NOT reinterpret a miss — Part 4 §1.3]
Payment-intent evidence attached to go/no-go:  ☐ pre-order  ☐ signed paid-pilot LOI  ☐ paid deposit
```

## 5. Gate 3 — PRD (skeleton per Part 4 §6.3; tier T2, CEO with CTO consulted)

```
1. Vision & problem recap: ______________________
2. Users & jobs-to-be-done: ______________________
3. Success metrics (each mapped to a Gate 9 instrument):
   metric · target · instrument · owner
4. Scope — user stories:
   US-01  As a ______, I want ______, so that ______.
          Acceptance: Given ______ When ______ Then ______
5. OUT OF SCOPE — binding MVP boundary (changes are T2, logged against scope-creep):
   - ______________________
6. NFRs: see checklist §6 (attach completed)
7. Dependencies & integrations: ______________________
8. Risks & open questions: ______________________
9. Release definition ("MVP done", verbatim testable): ______________________
```

## 6. NFR Checklist (Gate 3, verified at Gate 7 — Part 4 §6.4)

```
☐ Availability target ____%  + maintenance-window policy
☐ Performance budgets: p95 ____ ms for ____________ (per key action)
☐ Capacity assumptions: ____ tenants · ____ data volume
☐ Security baseline: authN/Z model ____ · encryption transit+rest · admin-action audit
☐ Privacy: data map · retention ____ · deletion SLA ____ · DPA posture
☐ Accessibility: WCAG 2.1 AA target, gaps documented (Part 7 FLAG-5)
☐ Observability: SLIs instrumented from day one (list): ______________
☐ Supportability: admin tools · feature flags where risky
☐ COST CEILING per customer at target price: $____ (≤ $6 guardrail, Part 6 §5.1)
☐ Data export: customer data exportable self-serve (required for honest Gate 10)
```

## 7. ADR (Gate 4; foundational choices are T3 — Part 4 §3)

```
ADR-___: ____________________          Status: proposed / accepted / superseded by ___
Context (forces, constraints, NFR links): ______________________
Decision: ______________________
Options rejected (each with the honest reason): ______________________
Consequences (benefits AND costs/risks — both mandatory): ______________________
Exit path / reversibility note (mandatory for build-vs-buy with lock-in): ______________
Linked decision record: DR-____
```

## 8. Threat Model (Gate 4 artifact; rechecked at Gate 7 and on major change)

```
Product/component: ____________  Date: ______  Author: Architect agent  Reviewer: Security agent
Data-flow summary (or link to diagram): ______________________
Assets worth attacking: ______________________
Trust boundaries: ______________________

| # | Threat (STRIDE class) | Vector | Impact | Likelihood | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
|   |   |   |   |   |   |   | open/mitigated/accepted |

Every UNMITIGATED item has a named owner (Gate 4 exit rule, Part 4).
Injection posture checked for every agent-facing surface (Part 3 §7.3):  ☐
```

## 9. Gate 8 — Launch Readiness (Part 4 §6.5 — all boxes or no launch; T3, CEO + CTO jointly)

```
☐ Assurance sign-offs on record: QA · security · performance · privacy · accessibility · ops · legal
☐ Rollback rehearsed on staging (date: ____)
☐ Dashboards + alerts live, tested with a synthetic incident (date: ____)
☐ Backups + restore verified on prod infrastructure (date: ____)
☐ Support inbox, macros, escalation path staffed for business hours
☐ ToS/privacy published · billing tested end-to-end incl. refund path
☐ Release notes + customer comms approved
☐ Incident contacts + founder on-call schedule posted
☐ Status page / notification channel ready
☐ T3 go/no-go record signed: CEO ______ CTO ______ (DR-____)
Any box open at go/no-go → ABORT to Gate 7. Aborts are logged, not shamed.
```

## 10. Incident Record + Post-Incident Review (Part 5 §6; review due ≤ 5 business days, mandatory for SEV1/SEV2)

```
INC-____  Severity: SEV1/2/3/4   Detected: ______ via ______   Resolved: ______
Commander (human): ________   Duration: ____   Customer impact: __ accounts · __ min · data: ____
Timeline (agent-drafted, human-verified):
  hh:mm ______________________
Contributing causes (systems and conditions, NOT names):
  1. ______________________
What worked / what didn't: ______________________
DETECTION GAP — why didn't we see it sooner: ______________________
Action items (each becomes a registry record):
  | Action | Owner | Due | Expiry |
Lessons → memory_entries(layer='lesson'), human-verified:  ☐ filed
Status-comms log attached (customer-facing = human-approved; disclosure = CEO+counsel T3):  ☐
```

## 11. Gate 10 — Quarterly Product Review (Part 4 Gate 10 + Part 5 §10; T2, retire/sell/merge/reposition = T3)

```
Product: ________  Quarter: ____  Review DR-____
Metrics vs Gate-3 targets:  activation ____ vs ____ · WAU ____ vs ____ · churn ____ vs plan
Unit economics: ARPA $____ · infra/customer $____ (ceiling $6) · gross margin ____%
Churn analysis: count __ · cohorts __ · stated reasons __ · preventable? __
Feature adoption: features < 5% usage for 2 consecutive quarters (removal candidates):
  - ______________________
Feedback synthesis (every claim links a query/ticket/recording): ______________
Cost trajectory: ______________________
OUTCOME: Expand / Optimize / Reposition / Merge / Maintain / Sell / Retire
Conditions + expiry of this decision: ______________________
```

## 12. Monthly Finance Pack (Part 6 §10 — Cost Sentinel drafts; CEO owns; accountant closes)

```
Month: ______   Close completed in ____ business days (target ≤ 10)
Burn vs budget by category (AI / cloud / tools / legal+acct / marketing / insurance): table
Runway at current net burn: ____ months   → Reserve rule (≥ 6 mo): OK / BREACH → freeze + T3
MRR $____ · ARPA $____ · churn cohort table · concentration: any customer > 20% MRR? ____
Unit economics update: cash CAC $__ · loaded CAC $__ (Phase 3+) · LTV $__ · payback __ mo
AI spend: by agent table · cache-hit __% · invoice reconciliation match __% (target ≥ 99)
Cloud per active customer: $____ (ceiling $6)
Reforecast deltas + reasons: ______________________
```

## 13. Governance Ritual Artifacts (Part 2 §9 — no artifact = the meeting did not happen)

**13.1 Weekly gate & priority sync (45 min)**
```
Date: ____  Present: ____
Pending approvals cleared / deferred (with reason): ____
Escalations reviewed: ____   awaiting_human p95 this week: ____ (flag > 2 business days)
Top 3 priorities next week: ____
```

**13.2 Monthly AI Governance Council (60 min)**
```
Date: ____  Note DR-____
Agent authority changes (T2 records cited): ____
Model/provider policy updates: ____
Escalation rate: ____% vs 5–15% band → in band / RE-TIER
Agent accuracy review (canary results, eval trends): ____
Governance spend: $____ = ____% of AI budget (cap 5%)
```

**13.3 Monthly cross-audit note (Part 2 §2.2)**
```
Auditor: CEO/CTO  Domain audited: (the OTHER founder's)  Sample size: ____
Canary defects seeded: __  caught: __  (catch target ≥ 90%)
Findings + actions: ____   Reviewer-agent accuracy factors updated: ☐
```

## 14. Break-Glass Log (Part 2 §4.1 — human-only, dual-logged)

```
Date/time: ____  Invoked by: ____  Witness/second log: ____
Gate bypassed and why (outage/emergency): ______________________
Actions taken (execution only — never policy change): ______________________
Restored to normal path at: ____   Retro filed as DR-____:  ☐
```

---

## 15. Self-Review of Part 9 (abbreviated)

| Item | Assessment |
|---|---|
| Strongest reason to adopt | Every ritual and gate in Parts 2–5 now has a concrete form; "the registry exists before the platform does" (Part 7 §9.6) is actionable on day one with nothing but these and a shared doc. |
| Strongest reason to reject | Forms invite form-filling. The countermeasure is inherited: artifacts that stop changing decisions get deleted from the required list (Part 4 §1.2), and the decision-delta metric (Part 6 §9) detects theater. |
| Confidence | ~8/10 — templates are transcriptions of already-reviewed rules, the lowest-risk part of the package. |

**[Open question]** Which templates move into the platform as structured forms in Phase 1 vs stay as docs (candidates for structured-first: §1, §4, §12).

---

*End of Part 9. A form's job is to make the honest path the easy path — and to leave a record when it wasn't taken.*
