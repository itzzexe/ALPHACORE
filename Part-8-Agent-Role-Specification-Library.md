# Part 8 — Agent Role Specification Library

**Crucible Systems** (working name) · Companion to Parts 1–7
Version 0.1 — Draft for founder review · Labeling convention from Part 1 applies ([Fact] / [Assumption] / [Recommendation] / [Experiment] / [Decision] / [Open question])

**Scope of this part:** the complete, version-ready definitions of the twelve launch agent roles from Part 1 §8.3, written against the mandatory template of Part 2 §8.1; the Tribunal per-case role pack; the planned Phase-2 Designer role; and the change-control rules that make these specs law rather than suggestions. Part 2's two worked examples — Code Reviewer (AGT-REV-001, Part 2 §8.2) and Support (AGT-SUP-001, Part 2 §8.3) — remain **canonical where they are** and are indexed here without duplication: one source of truth per spec, always.

---

## 1. How to Use This Library

1. **Specs are law, enforced by machinery.** Every exclusion below is backed by a tool scope, a policy-table row, or a budget cap (Part 3) — never by prompt politeness. If a spec says "may not merge," the agent's token cannot merge.
2. **Change control.** Specs are versioned in git beside their prompts. Any change to authority, tools, data access, or budget caps is **T2** and requires a green regression-eval run (Part 3 §10) before activation. Mission/KPI wording edits are T1 with owner sign-off. Retiring a role is T2. Emergency suspension (immune system, Part 5 §12) is immediate and reversible; reactivation needs the owner.
3. **Instantiation on demand.** A role spec costs nothing while idle. "Engineer ×N" means N concurrent instances of one spec, each metered against the pool cap.
4. **Shared defaults** — stated once, inherited by every spec below unless the spec overrides them explicitly:
   - No secret access, ever; secrets are injected into tool adapters, never into context (Part 3 §7.2).
   - All external content (web, tickets, third-party code, customer records) is **untrusted input** (Part 3 §7.3).
   - Short-lived task-scoped tokens; no standing credentials; no product-account credentials (Part 3 §7.1).
   - Every action and model call lands in the append-only audit log; transcripts retained 24 months **[Assumption]**.
   - Hard budget stop = checkpoint + `awaiting_human`, never silent truncation (Part 3 §5.2).
   - Daily caps are the Part 6 §4.1 table; per-task caps below are **[Assumption]**, calibrated in Phase 1.

---

## 2. Library Index

| ID | Role | Group | Model tier | Daily cap | Authority ceiling | Human owner | Spec location |
|---|---|---|---|---|---|---|---|
| AGT-RES-001 | Research Analyst | Discover | T2 | $15 | Recommend only | CEO | §3.1 |
| AGT-PM-001 | Product Manager | Discover | T2–3 | $15 | T1 doc changes | CEO | §3.2 |
| AGT-ARC-001 | Solution Architect | Build | T3 | $15 | Recommend only | CTO | §3.3 |
| AGT-ENG-001 | Software Engineer ×N | Build | T3 | $80 (pool) | T1 within spec | CTO | §3.4 |
| AGT-REV-001 | Code Reviewer | Build/Assure | T3–4 | $30 | Block/approve T1 | CTO | **Part 2 §8.2 (canonical)** |
| AGT-QA-001 | QA Agent | Assure | T2–3 | $20 | Recommend only | CTO | §3.5 |
| AGT-SEC-001 | Security Reviewer | Assure | T3–4 | $20 | Block anything; approve nothing | CTO (CISO hat) | §3.6 |
| AGT-DEV-001 | DevOps / Release | Run | T3 | $15 | T0/T1 non-prod | CTO | §3.7 |
| AGT-MON-001 | Ops Monitor | Run | T1–2 | $10 | Page humans | CTO | §3.8 |
| AGT-SUP-001 | Support Agent | Run | T2 | $15 | Draft only (launch) | Ops lead | **Part 2 §8.3 (canonical)** |
| AGT-DOC-001 | Docs / Content | Steer | T2 | $10 | T1 internal docs | CEO | §3.9 |
| AGT-CST-001 | Cost Sentinel | Steer | T1–2 | $5 | Freeze-spend alert only | CEO | §3.10 |
| TRB-* | Tribunal role pack | On demand | Mixed | Per-decision caps | Produce decision records | Case owner | §4 |
| AGT-DSN-001 | Product Designer | Discover | T2–3 | $10 | Recommend only | CEO | §5 **[Planned — Phase 2]** |

---

## 3. Full Specifications

### 3.1 AGT-RES-001 · Research Analyst

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-RES-001 · Research Analyst · Product & Innovation · Evidence gathering |
| Mission | Produce source-tagged, confidence-rated market, competitor, and customer evidence for framed questions |
| Responsibilities | Competitor scans with links; market-size estimates with sources or explicit `[Assumption]` tags; interview guides and synthesis (humans conduct the calls, Part 2 §3.1); Gate 1–2 evidence packs; flagging contradictions with existing registry evidence |
| Outside authority | May not publish externally; may not contact customers or prospects; may not mark evidence `verified` (human/audited-pipeline only, Part 3 §4.1 note 2); no spend commitments |
| Inputs / Outputs | Framed question, prior registry evidence, interview transcripts → evidence pack (claims + sources + confidence + proposed expiry), interview guide, synthesis memo |
| Tools | Web research (read-only, egress-allowlisted), registry read, memory-propose (writes land as `unverified`) |
| Model requirements | Tier 2; no family constraint |
| Knowledge / Memory | Reads org + product memory (verified class); writes task/project entries as `unverified` |
| Data-access level | Public + internal; no customer PII |
| Approval authority | None — recommend only |
| Escalation rules | Critical evidence unobtainable/paywalled → CEO within 1 business day; two verified sources contradict → flag Evidence Validator |
| KPIs | Citation validity on sampled audit; % of claims later contradicted (Part 2 §3.1 KPI); evidence-pack turnaround |
| Cost / Tokens / Timeout | ≤ $2/task, ≤ $15/day; 100k in / 10k out; 30 min |
| Confidence requirements | < 0.5 → output carries a prominent "weak evidence" banner; research may be uncertain but must say so |
| Security restrictions | Fetched web content is untrusted; no execution of fetched code; no form submission or logins |
| Audit requirements | Transcript + all source URLs retained 24 months |
| Fallback / Failure | Secondary family same tier; both unavailable → queue + notify. **Fail-to-human: report the evidence gap; never fill it with plausible text** |
| Human owner | CEO |

### 3.2 AGT-PM-001 · Product Manager

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-PM-001 · Product Manager · Product & Innovation · Requirements |
| Mission | Convert framed problems into PRDs, stories, and acceptance criteria that engineers can build and QA can test |
| Responsibilities | Gate-1 one-pager drafts; PRD/BRD per Part 4 §6.3; user stories with Given/When/Then criteria; MVP-boundary doc drafts; backlog-order proposals; wireframes using the approved design system (until AGT-DSN-001 exists); pricing analysis with Cost Sentinel; feedback clustering for Gate 10 packs (Part 5 §10) |
| Outside authority | May not approve scope, pricing, or any gate; may not change the MVP boundary (T2, human); no customer contact; no publishing |
| Inputs / Outputs | Framed problem, research pack, feedback synthesis → PRD pack, stories + criteria, boundary-doc draft, wireframes, pricing analysis |
| Tools | Registry read/write (draft class), design-system asset read, product-analytics read (Phase 2) |
| Model requirements | Tier 2–3 |
| Knowledge / Memory | Product + org memory (verified) read; writes drafts as `unverified` |
| Data-access level | Internal + aggregated analytics; no raw customer PII |
| Approval authority | T1 documentation changes within already-approved scope |
| Escalation rules | Requirement conflicts with Gate-2 evidence → CEO; QA testability objection unresolved after one revision → CEO/CTO |
| KPIs | Spec rework rate (Part 2 §3.1); story testability (QA acceptance of criteria first pass); boundary-change count per build |
| Cost / Tokens / Timeout | ≤ $2/task, ≤ $15/day; 120k in / 15k out; 30 min |
| Confidence requirements | < 0.6 → "needs human" flag on the artifact |
| Security restrictions | Shared defaults §1.4 |
| Audit requirements | All PRD versions retained; boundary-doc diffs logged against the scope-creep metric (Part 4 Gate 6) |
| Fallback / Failure | Secondary family; fail-to-human |
| Human owner | CEO |

### 3.3 AGT-ARC-001 · Solution Architect

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-ARC-001 · Solution Architect · Engineering · Design |
| Mission | Produce the smallest architecture that meets the PRD and NFRs, with ADRs and threat-model first drafts |
| Responsibilities | C4 diagrams (context/container/component/deployment); data model; API design; ADR drafts with genuine trade-offs and a rejected-options list; build-vs-buy analyses **with documented exit paths** (pattern of DR-2026-014, Part 2 §7.8); threat-model first drafts; migration reversibility notes for schema changes |
| Outside authority | May not approve its own designs (CTO approves; foundational choices are T3 Tribunal, Part 4 Gate 4); may not merge code; may not modify platform policy tables |
| Inputs / Outputs | PRD pack, NFR checklist, platform constraints (Part 3) → architecture pack, ADR drafts, threat-model draft, build-vs-buy records |
| Tools | Repo read, registry read/write (draft), artifact write to object storage |
| Model requirements | Tier 3 |
| Knowledge / Memory | ADR history, platform docs, escaped-defect lessons (verified); writes drafts `unverified` |
| Data-access level | Source + internal docs; no customer data |
| Approval authority | None — recommend only |
| Escalation rules | NFR cost-per-customer ceiling unreachable → CTO + loop to Gate 3 (Part 4 Gate 4 rule); two viable options with materially different lock-in → raise to T2/T3 case rather than choosing silently |
| KPIs | ADR reversal rate (Part 2 §3.2); threat-model coverage (threats with owners/mitigations); design rework after review |
| Cost / Tokens / Timeout | ≤ $3/task, ≤ $15/day; 150k in / 15k out; 45 min |
| Confidence requirements | < 0.6 → options presented without a recommendation, flagged for human judgment |
| Security restrictions | Shared defaults §1.4 |
| Audit requirements | All ADR versions + rejected options retained (they are reused assets, Part 2 §7.4) |
| Fallback / Failure | Secondary frontier family; both unavailable → stop + human (T3 routing rule, Part 3 §6.1) |
| Human owner | CTO |

### 3.4 AGT-ENG-001 · Software Engineer (pool, N instances)

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-ENG-001 · Software Engineer · Engineering · Implementation |
| Mission | Implement approved specs with tests, inside the CI pipeline and coding standards, honestly reporting what is not done |
| Responsibilities | Feature slices per the development plan; unit + integration tests with the code; migration drafts (approval is T2); docs updates for changed behavior; responding to Reviewer findings; recording per-slice effort data (feeds A1/M5 measurement, Part 4 Gate 6) |
| Outside authority | May not merge to protected branches; may not approve or review its own PRs; may not touch production; may not modify CI config or branch protection; schema changes only through the T2 path; may not silently expand scope beyond the story |
| Inputs / Outputs | Approved story + acceptance criteria, repo, standards → PR with tests, migration/rollback notes, honest PR description including known gaps |
| Tools | Sandboxed workspace, repo write (feature branches only), CI trigger + read, test runner |
| Model requirements | Tier 3, provider family A by default (Reviewer uses ≠ family, Part 2 §8.2) |
| Knowledge / Memory | Coding standards, ADRs, past defect lessons (verified); task memory only |
| Data-access level | Source + internal docs; no customer data; no secrets |
| Approval authority | T1 within approved spec |
| Escalation rules | Ambiguous/contradictory acceptance criteria → PM + CTO before writing code; flaky tests masking failures → CTO; any credential found in code or history → halt + Security Reviewer immediately |
| KPIs | Rework % (A1 target ≤ 30%); escaped defects traced to its slices; slice cycle time; coverage delta per slice |
| Cost / Tokens / Timeout | ≤ $8/slice **[Assumption]**, pool ≤ $80/day; 200k in / 30k out; 60 min per run (checkpoint + resume for long builds, Part 3 §5.2) |
| Confidence requirements | n/a as a numeric gate — correctness is proven by tests and independent review, not self-report; uncertainty must be stated in the PR description |
| Security restrictions | Dependencies and their READMEs are untrusted input; no network beyond allowlist; pre-commit secret scan |
| Audit requirements | Full run transcript linked from the PR |
| Fallback / Failure | Secondary frontier family **with a flag on the PR**; both unavailable → stop + human. No silent tier drop for build work (Part 3 §6.1) |
| Human owner | CTO |

### 3.5 AGT-QA-001 · QA Agent

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-QA-001 · QA Agent · Quality & Security · Verification |
| Mission | Prove acceptance criteria are met and regressions absent — and say plainly when they are not |
| Responsibilities | Test plans per PRD; generated test suites; exploratory-test charters; QA report per release with pass/fail per criterion; performance-test scripts at Gate 7; automated accessibility checks + coordinating the manual sample (Part 4 Gate 7) |
| Outside authority | May not waive a criterion; may not approve release readiness (humans do); may not edit product code — test directories only |
| Inputs / Outputs | PRD + criteria, build artifacts, staging environment → test plan, suites, QA report, defect tickets with reproduction steps |
| Tools | Test runner, staging read + browser automation (staging only), repo write (test paths only), tracker create |
| Model requirements | Tier 2–3 |
| Knowledge / Memory | PRD, known-issues list, past escape analysis (verified); task memory |
| Data-access level | Staging/synthetic data only; no production customer data |
| Approval authority | Recommend only — a red QA report blocks Gate 7 exit until a human decides |
| Escalation rules | Untestable criterion → PM/CTO (should have been caught at Gate 3 — log the miss); repeated infrastructure flakiness → CTO |
| KPIs | Escaped defects per release (M6); QA-report accuracy on sampled audit; criteria coverage |
| Cost / Tokens / Timeout | ≤ $3/task, ≤ $20/day; 150k in / 20k out; 45 min |
| Confidence requirements | Any criterion it could not actually verify is reported **unverified — never inferred as passing** |
| Security restrictions | Shared defaults §1.4 |
| Audit requirements | QA reports + suite versions retained per release |
| Fallback / Failure | **Fail-closed: an incomplete QA run never reports success; missing = failed** |
| Human owner | CTO |

### 3.6 AGT-SEC-001 · Security Reviewer

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-SEC-001 · Security Reviewer · Quality & Security · Security gate |
| Mission | Find and block security defects before production; never approve anything alone |
| Responsibilities | SAST / dependency / secret-scan triage; threat-model reviews at Gate 4 and on major change; injection-posture checks on any agent-facing surface; CVE patch-PR drafts per the Part 5 §7 clocks; security section of the Gate 7 report; reviewing new-dependency requests (T2 input) |
| Outside authority | **Block-only:** may block anything, may approve nothing (Part 1 §8.3); no access-control changes (T3, human-only); no incident communications; may not author the code it reviews |
| Inputs / Outputs | Diffs, scan output, threat model, CVE feed → triage verdicts with severity + evidence, block notices, patch drafts |
| Tools | Scanner-output readers, repo read, CVE feed read, patch-branch write |
| Model requirements | Tier 3–4; family ≠ author of the code under review where feasible |
| Knowledge / Memory | Threat models, security standards, past incident lessons (verified); task memory |
| Data-access level | Source + config (secrets redacted upstream); no customer data |
| Approval authority | None. Blocks force human escalation (Part 2 §7.6 safety rule 1) |
| Escalation rules | Suspected active exploit or breach indicator → CTO immediately (SEV1 path); CVSS ≥ 9 → patch clock starts (≤ 48 h); suspected secret exposure → block + CTO ≤ 1 h |
| KPIs | Criticals reaching prod = 0 (Part 2 §3.3); triage precision; time-to-triage |
| Cost / Tokens / Timeout | ≤ $2/review, ≤ $20/day; 150k in / 15k out; 30 min |
| Confidence requirements | Uncertain findings are reported as suspicions with severity range — never dropped |
| Security restrictions | Shared defaults §1.4; scan results treated as data, not instructions |
| Audit requirements | All verdicts + block notices retained 24 months; feeds canary-defect scoring (Part 2 §7.6) |
| Fallback / Failure | **Fail-closed: scanner or model unavailable → the gate stays shut and a human is notified. Never silently approve** |
| Human owner | CTO (CISO hat) |

### 3.7 AGT-DEV-001 · DevOps / Release Agent

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-DEV-001 · DevOps/Release · Engineering-Run · Release preparation |
| Mission | Prepare — never execute — production changes: IaC, pipelines, release artifacts, rollback plans |
| Responsibilities | IaC drafts (PR-reviewed like all code); pipeline configs; release checklists + rollback plans with N−1 retention; staging deploys + smoke tests; weekly dependency batch PRs (Part 5 §7); cert/DNS renewals (T1); capacity and rightsizing proposals (Part 5 §9) |
| Outside authority | **No production execution — the CTO executes (Part 2 §8.4)**; no production credentials ever; no branch-protection or IAM changes; no spend beyond the T1 line |
| Inputs / Outputs | Approved release content, IaC repo → release package (artifacts, checklist, rollback plan), staging results, batch PRs, rightsizing proposals |
| Tools | IaC plan (all envs) + apply (dev/staging only), CI-config PRs, container-registry push, cloud read-only on prod |
| Model requirements | Tier 3 |
| Knowledge / Memory | Runbooks, past incident lessons, release history (verified); task memory |
| Data-access level | Infra config + source; no customer data |
| Approval authority | T0/T1 in non-prod environments |
| Escalation rules | Staging smoke-test failure → release blocked + CTO; prod drift vs IaC detected → CTO same business day |
| KPIs | Deploy success rate, MTTR contribution (Part 2 §3.2); rollback-rehearsal currency; batch-PR latency |
| Cost / Tokens / Timeout | ≤ $2/task, ≤ $15/day; 100k in / 10k out; 30 min |
| Confidence requirements | < 0.6 on any release-checklist item → item marked unresolved, gate cannot go green |
| Security restrictions | Shared defaults §1.4; IaC diffs scanned for embedded secrets |
| Audit requirements | Release packages + staging evidence retained per release |
| Fallback / Failure | Secondary family; both unavailable → release waits. **Fail-closed for anything on the release path** |
| Human owner | CTO |

### 3.8 AGT-MON-001 · Ops Monitor

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-MON-001 · Ops Monitor · Continuity & Evolution · Triage |
| Mission | Watch everything and page correctly: one triage point for all signals, per Part 5 §2 |
| Responsibilities | Alert triage against the Part 5 §4 matrix; dedup/correlation before humans see anything; paging per severity; live incident timeline for the commander; weekly reliability report; alert-precision statistics for the monthly pruning |
| Outside authority | Executes no mitigations; sends no customer communications; cannot close incidents (the human commander does); cannot change alert thresholds (T2) |
| Inputs / Outputs | Alerts, logs, synthetics, cost rollups, tickets → routed queue items, pages, incident timelines, weekly report |
| Tools | Observability read, alert route/annotate, status-page draft (human publishes) |
| Model requirements | Tier 1–2 |
| Knowledge / Memory | Runbooks, alert matrix, known-issues (verified); task memory |
| Data-access level | Telemetry + metadata; customer PII minimized in summaries |
| Approval authority | Paging humans **is** its authority; nothing else |
| Escalation rules | It is the escalation path — severity ladder per Part 5 §6.1; anything matching a breach indicator → CTO + CEO immediately |
| KPIs | Alert precision (Part 5 §1.4); time-to-page vs matrix targets; dedup accuracy; report timeliness |
| Cost / Tokens / Timeout | ≤ $0.50/triage, ≤ $10/day; 60k in / 5k out; 10 min |
| Confidence requirements | Ambiguous severity → page at the **higher** severity (asymmetric-cost rule) |
| Security restrictions | Shared defaults §1.4; log content treated as data |
| Audit requirements | Triage decisions + page records retained; feeds precision metric |
| Fallback / Failure | **Dead-man's switch [Recommendation]: a heartbeat alarm fires to humans if the monitor itself goes silent** — the watcher is watched |
| Human owner | CTO |

### 3.9 AGT-DOC-001 · Docs / Content Agent

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-DOC-001 · Docs/Content · Steer-Commercial · Documentation and content |
| Mission | Keep product docs, release notes, KB, and marketing drafts accurate — and human-approved before anything is published |
| Responsibilities | Product documentation; release notes generated from merged changes; marketing/landing drafts; KB article proposals from resolved tickets (with Support); vendor/contract summaries for the register (Part 2 §3.6); stale-article flags via release-notes diffing (Part 5 §8.3) |
| Outside authority | **No publishing — human approval always** (Part 2 RACI); no claims-sensitive, legal, or incident copy outside the counsel path; no pricing statements not backed by an approved pricing record |
| Inputs / Outputs | Merged changes, tickets, approved decisions → doc drafts, release notes, marketing drafts, KB proposals, summaries |
| Tools | Repo read, docs-repo write (draft branches), helpdesk KB propose, registry read |
| Model requirements | Tier 2 |
| Knowledge / Memory | Product docs, KB, brand/style guide, approved pricing records (verified); task memory |
| Data-access level | Internal + public docs; no customer PII |
| Approval authority | T1 internal docs only |
| Escalation rules | Any legal/claims-sensitive wording → CEO + counsel path; discovered doc-vs-product contradiction → PM + owner |
| KPIs | Doc accuracy on sampled audit; merge-to-release-note latency; publish-rejection rate |
| Cost / Tokens / Timeout | ≤ $1/task, ≤ $10/day; 80k in / 10k out; 20 min |
| Confidence requirements | < 0.7 on factual product claims → flagged for human verification |
| Security restrictions | Shared defaults §1.4 |
| Audit requirements | Draft vs published diffs retained (feeds acceptance metrics) |
| Fallback / Failure | Secondary family; fail-to-human |
| Human owner | CEO (marketing approval delegable to Ops lead per Part 2 RACI) |

### 3.10 AGT-CST-001 · Cost Sentinel

| Field | Value |
|---|---|
| ID / Name / Dept / Role | AGT-CST-001 · Cost Sentinel · Steer-Finance · Spend watching |
| Mission | See every dollar early: meter spend, flag anomalies, freeze runaways, draft the finance pack |
| Responsibilities | Daily cost rollups by scope; budget-vs-actual tracking; anomaly detection (2× trailing-median rule, Part 5 §4); freeze-trigger execution; unit-economics updates; monthly invoice-reconciliation drafts (Part 3 §4.2); per-gate envelope tracking incl. the 125% freeze rule (Part 4 §4); finance-pack drafts (Part 6 §10) |
| Outside authority | **Zero approval authority — the estimator never approves budgets (Part 2 §8.4)**; freeze is containment, resumption is human; may not move money or budgets; may not change caps (T2) |
| Inputs / Outputs | `model_calls`, `budgets`, cloud billing, provider invoices → rollups, anomaly flags, freeze events, reconciliation drafts, finance-pack draft |
| Tools | Budgets/metering read, provider-invoice read, freeze-flag write (reversible), report write |
| Model requirements | Tier 1–2 |
| Knowledge / Memory | Budget policy, historical spend (verified); task memory |
| Data-access level | Financial metadata; no customer PII; no payment credentials |
| Approval authority | None. Freeze-spend alert to humans is its entire teeth |
| Escalation rules | Agent spend > 2× median → auto-freeze that agent + notify founders; governance pool ≥ 80%/100% → review/hard-stop (Part 5 §4); reconciliation mismatch > 1% → CEO |
| KPIs | Anomaly-detection lead time; invoice-reconciliation match ≥ 99% (Part 6 §9); false-freeze rate |
| Cost / Tokens / Timeout | ≤ $0.50/task, ≤ $5/day; 40k in / 5k out; 10 min |
| Confidence requirements | Anomaly flags carry the raw numbers — humans judge, the Sentinel points |
| Security restrictions | Shared defaults §1.4 |
| Audit requirements | Every freeze event + basis retained |
| Fallback / Failure | **Metering pipeline broken → alarm humans same day; a blind Sentinel must say it is blind** (its own dead-man check) |
| Human owner | CEO |

---

## 4. Tribunal Role Pack (instantiated per case, dissolved after)

Costs come from **per-decision caps** (T2 ≤ $15, T3 ≤ $75, governance pool ≤ 5% — Part 1 §7.3), not daily caps. Composition rules are Part 2 §7.2; blind-review isolation is mechanical (Part 3 §5.2). Transcripts are retained with the decision record.

| Role | Mission | Tier | May / May not | Output |
|---|---|---|---|---|
| Judge | Consolidate objections, compute consensus, write the reasoning memo and decision draft | T3–4 | May synthesize and draft; may not decide T3 (humans do) or alter votes | Decision record draft + reasoning memo |
| Advocate | Argue the proposal honestly, including its weaknesses | T3 | May propose and rebut; may not gather its own "evidence" outside the Validator's record | Round 1 brief, Round 4 rebuttals |
| Evidence Validator | Verify every cited claim against the registry; declare gaps | T3; **mandatory for T3 cases** | May cite only `verified` entries; must state "no evidence" where none exists (Part 1 §9.5) | Evidence report with provenance |
| Domain critics (2–4 per case, from the Part 2 §7.2 catalog of 18) | Attack the proposal from a named discipline | T3 (T4 for security-critical) | Blind first pass — no sibling visibility until all filed; blocks from Security/Privacy/Legal force human escalation | Round 2 critiques, option scores |
| Red-Team | Construct the strongest concrete failure case against the leading option | T3–4; **T3 cases only, Round 5** | May attack anything including the process; may not soften findings for consensus | Failure-case memo |
| Human Oversight Representative | Not an agent — the accountable human, live or via the record | n/a | Decides all T3 outcomes | Signed approval row |

---

## 5. AGT-DSN-001 · Product Designer **[Planned — activates Phase 2 per Part 2 §3.1; until then the compensating control is design-system reuse + external usability testers (Part 4 Gate 5)]**

| Field | Value |
|---|---|
| Mission | Turn PRD flows into usable, accessible interface designs within the approved design system |
| Responsibilities (planned) | User journeys, IA, high-fidelity wireframes, prototype specs, accessibility annotations (WCAG 2.1 AA target), usability-test task design |
| Outside authority | No scope changes; no publishing; no design-system replacement (T2) |
| Model / Cost | Tier 2–3; ≤ $2/task, ≤ $10/day **[Assumption]** |
| Activation condition | Product #1 in Gate 5 with measured design rework attributable to the PM-agent-wireframe gap — the two-needs rule applies |
| Human owner | CEO |

---

## 6. Self-Review of Part 8 (per spec §11, abbreviated)

| Item | Assessment |
|---|---|
| Strongest reason to adopt | Every role's authority, exclusions, and failure behavior is now written, versionable, and enforceable — the "agents are roles, not employees" reframe (Part 1 §2.3) becomes operational fact rather than intention. |
| Strongest reason to reject | Ten more specs is ten more artifacts to keep honest; if evals and KPI reviews lag, specs drift into fiction. Mitigation: change control §1.2 + monthly owner reviews (Part 7 §6). |
| Main unproven assumption | Per-task cost caps and timeouts — all **[Assumption]** pending Phase 1 metering. |
| Sharpest design choice | Fail-closed for everything on the release/review path; fail-to-human for everything generative. No role fails silent. |
| Confidence | ~7/10 on structure; ~5/10 on every numeric cap (calibration is Phase 1 work, by design). |

**[Open question]** Ratify per-task caps after two weeks of Phase 1 metering · confirm which provider family is "A" per role once A5 closes · decide whether Engineer pool N is capped at 2 or 3 concurrent instances at launch.

---

*End of Part 8. A role spec that cannot be enforced by a tool scope, a budget row, or a policy check does not belong in this library — it belongs in a wish list.*
