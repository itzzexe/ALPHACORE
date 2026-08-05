# Part 10 — Innovation Addendum

**Crucible Systems** (working name) · Companion to Parts 1–9
Version 0.1 — Draft for founder review · Labeling convention from Part 1 applies ([Fact] / [Assumption] / [Recommendation] / [Experiment] / [Decision] / [Open question])

**Scope of this part:** the fully elaborated sheets for the twelve innovations inventoried in Part 7 §7 — the addendum that part offered ("say the word"). Each sheet: the problem, the mechanism, MVP form and cost, operating cost, risks and failure modes, human control points, success metric and cadence, the gated advanced version, and kill criteria. Rule: **an innovation that fails its metric is retired, not defended** (Part 1 Phase 5 rule, applied to all of these from day one).

---

## Sheet 1 — Risk-Tiered FORGE (T0–T3)

| Field | Content |
|---|---|
| Problem solved | Governance cost scaling with ambition instead of consequence; every decision either over-processed or rubber-stamped |
| Mechanism | Every decision classified T0–T3 at registration (criteria Part 1 §7.3); process weight, cost cap, and human involvement follow the tier automatically; policy engine routes, budgets enforce |
| MVP form & setup cost | One policy table + the routing check in the workflow module; ~days of build inside Phase 1 |
| Operating cost | Near zero marginal; the caps themselves: T1 ≤ $2 · T2 ≤ $15 · T3 ≤ $75 · governance ≤ 5% of AI budget |
| Risks & failure modes | Mis-tiering (dangerous work classified T1); tier inflation (everything "feels" T2+, humans drown); tier gaming by prompt phrasing |
| Human control points | Humans set tier criteria; T3 always human-decided; escalation triggers hard-coded (Part 2 §7.4); tiering rules changes are themselves T2 |
| Success metric & cadence | Escalation rate inside the 5–15% band; governance ≤ 5% of AI spend — reviewed at the monthly council |
| Advanced version (gated) | Learned tier suggestion from decision history — **[Experiment]**, only after ≥ 6 months of audited outcomes, suggestion-only forever |
| Kill criteria | If re-tiering twice fails to bring the band or the human-hours target (A3) into range, collapse to two tiers (routine / human) and admit the instrument was too fine |

## Sheet 2 — Agents-as-Roles Reframe

| Field | Content |
|---|---|
| Problem solved | Fantasy "agent headcount": standing agents that cost money while idle and accrete unauditable authority |
| Mechanism | An agent = a versioned role spec (Part 2 §8.1, library in Part 8) instantiated per task and metered like a cloud resource; authority lives in the spec, revocable in one commit |
| MVP form & setup cost | Git-versioned specs + the `agents` table (Part 3 §4.1); effectively free — it is a discipline, not a system |
| Operating cost | Zero when idle — that is the point |
| Risks & failure modes | Spec drift (prompt edited, spec not); spec fiction (spec says one thing, tool scopes allow another) |
| Human control points | Spec changes are T2 with regression evals (Part 8 §1.2); one named human owner per spec; monthly owner review |
| Success metric & cadence | Idle cost ≈ 0; spec-vs-scope audit clean in the monthly cross-audit |
| Advanced version (gated) | Role marketplace / apprenticeship ladder — Phase 4–5 **[Experiment]**, needs months of audited accuracy history |
| Kill criteria | None — this is a framing, and its alternative (standing agents) is a Rejected Concept. If specs go stale twice in audits, the fix is process, not abandonment |

## Sheet 3 — Evidence Provenance + Expiry

| Field | Content |
|---|---|
| Problem solved | Stale or hallucinated claims steering decisions long after the world changed (R10, RK-10) |
| Mechanism | Every memory/evidence row carries source ref, verification state, and expiry (Part 3 §4.1); decision contexts filter `verified` + unexpired only; expiry triggers auto-reopen decisions (Part 2 §7.7) |
| MVP form & setup cost | Schema columns + a retrieval filter + a weekly expiry sweep query; days of build |
| Operating cost | Minutes of human time per verification; the quarterly evidence-expiry sweep (Part 2 calendar) |
| Risks & failure modes | Verification bottleneck (everything stuck `unverified`); rubber-stamp verification; expiry dates set generously to avoid rework |
| Human control points | Only humans or audited pipelines flip `unverified → verified` (Part 3 §4.1 note 2); Evidence Validator refuses unverified citations |
| Success metric & cadence | Expired-decision hit rate (re-opened decisions that actually changed) — quarterly; unverified citations in decision contexts = 0 |
| Advanced version (gated) | Automatic contradiction detection between new measurements and standing evidence — Growth, after FTS proves insufficient twice |
| Kill criteria | If > 50% of re-opened decisions are re-approved unchanged for two consecutive quarters, expiry defaults are too aggressive — lengthen them; the mechanism itself stays |

## Sheet 4 — Canary Defects + Canary Secrets

| Field | Content |
|---|---|
| Problem solved | Review theater (R3): reviewers that approve everything look identical to reviewers that catch everything — until production. Same for silent secret exfiltration |
| Mechanism | Monthly, a founder seeds known defects into review pipelines and fake credentials into agent contexts; catch/no-catch and any exfil attempt are measured (Parts 1 R1, 3 §6.3, 5 §14) |
| MVP form & setup cost | A private list of seeded cases + calendar entry + scoring sheet; hours per month, no build |
| Operating cost | ~1–2 founder-hours/month + trivial tokens |
| Risks & failure modes | Canaries too easy (false confidence); agents "learning" the canary style; seeding leaked into training-visible artifacts |
| Human control points | Founders author and rotate canaries under cross-audit (Part 2 §2.2); results feed reviewer accuracy factors, hard-capped 0.85–1.15 |
| Success metric & cadence | Canary catch ≥ 90% (Part 6 §9); canary-secret exfil = 0 — monthly |
| Advanced version (gated) | Automated canary generation from past escaped defects — Phase 3, once the escape log is rich enough to sample honestly |
| Kill criteria | If catch rates saturate at 100% for 6 months on rotated canaries, raise difficulty before concluding reviewers are perfect; the program retires only if a better independent measure of reviewer quality replaces it |

## Sheet 5 — Cross-Audit Rule

| Field | Content |
|---|---|
| Problem solved | A 2–3 person company has no independent audit function at all |
| Mechanism | Each founder samples work owned by the other, monthly, with a written note (Part 2 §2.2); deputy runs restore drills (Part 5 §11) |
| MVP form & setup cost | A calendar entry and the §13.3 form (Part 9); zero build |
| Operating cost | 1–2 hours per founder per month |
| Risks & failure modes | Reciprocal politeness ("you pass mine, I pass yours"); audits skipped under load — the note requirement makes skipping visible |
| Human control points | Inherently human; external annual review added at Phase 3 (Part 2 §2.2) |
| Success metric & cadence | Monthly audit note exists; findings per audit trend (zero findings forever = suspicious, not reassuring) |
| Advanced version (gated) | Internal Audit as a distinct function — Phase 3–4 with headcount or external contract |
| Kill criteria | Replaced (not killed) when a real audit function exists; if notes go missing two months running, that is an RK-08 early warning, escalate at the council |

## Sheet 6 — Blind-Review Mechanical Isolation

| Field | Content |
|---|---|
| Problem solved | Groupthink in multi-agent critique: critics anchoring on the first opinion they see, producing correlated "independent" reviews |
| Mechanism | Tribunal Round-2 critics run as sibling runs; the context assembler refuses to load sibling outputs until all are filed; isolation asserted into the audit log (Part 3 §5.2) |
| MVP form & setup cost | One conditional in the context assembler + an audit assertion; hours of build |
| Operating cost | Zero marginal |
| Risks & failure modes | Leakage via shared memory entries written mid-case; isolation bug silently broken — hence the audit assertion, which makes violations detectable after the fact |
| Human control points | Isolation violations are a named audit query in the monthly cross-audit |
| Success metric & cadence | Isolation violations = 0 (audited monthly); critic-verdict correlation tracked as a health signal |
| Advanced version (gated) | Diversity-forcing critic prompts (assigned disjoint lenses) — cheap, adopt when critic correlation measurably rises |
| Kill criteria | None while Tribunals exist; if Tribunals are simplified away (Part 2 §10.1 fallback), this retires with them |

## Sheet 7 — Pre-Registered Experiments

| Field | Content |
|---|---|
| Problem solved | Post-hoc rationalization: moving the goalposts after seeing weak validation results (the classic founder self-deception) |
| Mechanism | Metric, threshold, sample, duration, and decision rule filed **before** the experiment runs (Part 4 §6.2); the go/no-go must cite the form and may not reinterpret a miss |
| MVP form & setup cost | The Part 9 §4 form; zero build |
| Operating cost | Minutes per experiment |
| Risks & failure modes | Threshold sandbagging (bars set trivially low); "exploratory" experiments run unregistered then cited as evidence |
| Human control points | CEO signs go/no-go citing the forms; Tribunal-reviewed exception path exists and is on the record (Part 4 Gate 2) |
| Success metric & cadence | Zero reinterpreted misses; Gate-2 predictive validity curve (signal vs actual 90-day revenue) built over the portfolio |
| Advanced version (gated) | A registered-experiment index with automatic threshold-vs-outcome scoring — Phase 3 |
| Kill criteria | None — the practice costs minutes. If the predictive-validity curve shows Gate-2 signals are uninformative, the fix is better experiments, not unregistered ones |

## Sheet 8 — Payment-Intent Gate 2

| Field | Content |
|---|---|
| Problem solved | Applause mistaken for demand (R8/RK-01, the top company risk): interviews and signups predicting revenue that never arrives |
| Mechanism | Evidence hierarchy (Part 4 §1.4): pre-orders / signed paid-pilot LOIs ≻ activated trials ≻ landing conversion vs pre-registered bar ≻ enthusiasm; a Gate-2 "go" requires at least one payment-intent signal |
| MVP form & setup cost | A rule in the Gate-2 exit criteria; zero build |
| Operating cost | Founder selling time in Gate 2 — real but already budgeted (15–30 h, Part 4 §4) |
| Risks & failure modes | Exception-creep ("this niche doesn't do LOIs"); LOIs from friends; deposits refunded quietly later |
| Human control points | Exceptions require an explicitly recorded, Tribunal-reviewed decision (Part 4 Gate 2); CEO owns them on the record |
| Success metric & cadence | LOI-to-paying conversion tracked per product; exception count (target: ~0) |
| Advanced version (gated) | Calibrated demand scoring from portfolio history — Phase 4, needs multiple products' worth of data |
| Kill criteria | If two products show strong LOI signals then fail retention, the hierarchy is re-weighted toward activated usage — adjust the instrument, keep the principle |

## Sheet 9 — Decision-Delta Metric

| Field | Content |
|---|---|
| Problem solved | "Was the debate worth the tokens?" — governance value is otherwise unmeasurable, inviting both theater and cargo-cult cuts |
| Mechanism | Per Tribunal case, diff the final outcome against the advocate's initial proposal: materially different = delta. Add condition-fire rate and reversal rate (Part 6 §9) |
| MVP form & setup cost | Three fields on the decision record + a monthly query; hours |
| Operating cost | Near zero |
| Risks & failure modes | Gaming (advocates sandbag proposals to manufacture delta); "materially different" judged inconsistently — needs a written rubric |
| Human control points | Judge marks the delta with reasoning; council reviews the band monthly |
| Success metric & cadence | Delta 20–50% (lower = theater, higher = weak proposals); reversals < 10% — monthly council |
| Advanced version (gated) | Per-role contribution analysis (which critics change outcomes) feeding Tribunal composition — Phase 3–4 |
| Kill criteria | If two quarters of data show T2 mini-tribunals deliver < 20% delta at full cost, T2 collapses to single-reviewer + judge memo (Part 2 §10.1 pre-approved fallback) — this metric is the kill switch for the Tribunal itself, by design |

## Sheet 10 — Automation Ladder + Auto-Recall

| Field | Content |
|---|---|
| Problem solved | One-way autonomy creep: agent authority expands on optimism and never contracts on evidence |
| Mechanism | Per task category: observe → draft → act-with-approval → act-with-sampling; each rung granted on evidence (e.g., support: ≥ 100 tickets at ≥ 95% acceptance), sampling continues forever, and falling below the floor auto-recalls the category down a rung (Part 5 §1.3, §8.2) |
| MVP form & setup cost | Threshold rules per category + acceptance metering; days |
| Operating cost | The permanent sampling (10%) — deliberately never free |
| Risks & failure modes | Metric gaming (acceptance inflated by trivial tickets); category boundaries drawn too broadly ("all support" instead of "password resets") |
| Human control points | Humans set thresholds and category boundaries; never-AI categories are hard-coded (security reports, legal threats, billing disputes, cancellation saves) |
| Success metric & cadence | Acceptance ≥ 95% sustained per graduated category; recalls fire correctly when tested — monthly |
| Advanced version (gated) | Ladder applied to ops actions (auto-remediation) — Phase 3+, same evidence discipline, reversible actions only |
| Kill criteria | A graduated category causing a customer-harm incident recalls it immediately and freezes all graduations pending a council review |

## Sheet 11 — Milestone-Gated Spending + Reserve Rule

| Field | Content |
|---|---|
| Problem solved | Calendar-driven burn: spending because the plan said month 4, not because evidence arrived; and runway discovered too late to act |
| Mechanism | Budget lines unlock on milestone artifacts (M0–M8 map, Part 6 §8); reserve rule: runway < 6 months at current net burn → automatic discretionary freeze + forced T3 raise/cut/pivot decision |
| MVP form & setup cost | The unlock table + a runway line in the monthly finance pack; zero build |
| Operating cost | Zero marginal |
| Risks & failure modes | Milestone inflation (declaring M3 on weak evidence to unlock the build envelope); freeze fatigue (repeated near-breaches normalizing overrides) |
| Human control points | Each unlock is a registered decision citing the milestone's artifacts; unfreeze is T3 with the finance pack on the table |
| Success metric & cadence | Trough depth vs plan (Part 6 §7); freeze fired on time in backtests — monthly reforecast |
| Advanced version (gated) | Scenario-triggered budget automation — never fully automatic; money stays human (Part 1 §6.1) |
| Kill criteria | None — this is the company's financial immune system. Parameters (6-month reserve) are tunable T3 decisions |

## Sheet 12 — Organizational Immune System, Boring MVP

| Field | Content |
|---|---|
| Problem solved | Slow-burn failure patterns (quality decay, cost drift, policy probing) that no single alert catches — without pretending we have behavioral ML |
| Mechanism | Scheduled queries + threshold rules over data already collected (Part 5 §12): repeated signatures → problem records; spend spikes → freezes; policy denials → role suspension; eval drops → draft-only quarantine. All containment reversible, all paired with human review |
| MVP form & setup cost | ~7 scheduled queries + rule actions; days |
| Operating cost | Near zero; the review minutes it triggers |
| Risks & failure modes | False positives eroding trust in containment; rules stale as the system evolves; the containment-is-reversible guarantee accidentally violated by a badly written action |
| Human control points | May pause and quarantine; **may never fire, delete, or expand authority** (Part 5 §12); rule changes are T2; monthly rule review |
| Success metric & cadence | Contained events that post-review proved real vs false-positive rate — monthly |
| Advanced version (gated) | Anomaly detection over behavioral baselines — **[Experiment]**, Phase 5, own budget and metric per Part 1 roadmap |
| Kill criteria | Any containment action found irreversible in practice suspends the whole rule set pending redesign — the immune system must be safer than the diseases it watches |

---

## Self-Review of Part 10 (abbreviated)

| Item | Assessment |
|---|---|
| Strongest reason to adopt | The twelve mechanisms are the blueprint's actual novelty — each attacks a named failure mode with a cheap MVP, an explicit metric, and a kill/adjust rule; none requires technology that doesn't exist. |
| Strongest reason to reject | Twelve instruments for three people is a lot of dials. The defense: ten of twelve cost near-zero to operate; the two with real cost (canaries, sampling) are the ones guarding the top risks. |
| Main unproven assumption | That the metrics chosen (delta band, catch rate, escalation band) actually discriminate healthy from sick — Phase 2–3 data decides, and Sheet 9 can kill the most expensive machinery honestly. |
| Confidence | ~7/10 that this set is worth operating as specified; each sheet carries its own exit. |

---

*End of Part 10. Every innovation here is a claim with a meter attached; the meters, not the claims, decide what survives.*
