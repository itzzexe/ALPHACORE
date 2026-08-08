# Financial Health Assessment — Crucible Systems — 2026-08

# Financial Health Assessment — Crucible Systems
**Period:** 2026-08 · **Basis:** company ledgers (figures used exactly as supplied) · **Prepared by:** Financial Analyst (AGT-FIN-001)

> Scope note: this assessment uses only the supplied ledger figures. Cash-on-hand, current liabilities, and labour/founder compensation were **not** supplied and are marked **[Unknown]**. Where a dimension cannot be computed without them, I say so rather than estimate.

## 1. As-reported figures

| Item | Value | Source |
|---|---|---|
| MRR | $49 | revenue.mrrUsd |
| ARR | $588 | revenue.arrUsd |
| Active customers | 1 | byState (active) |
| Leads (non-paying) | 3 | byState (lead) |
| Deals won | $0 | dealsWonUsd |
| Pipeline | $0 | pipelineUsd |
| Model spend | $0 | modelSpendUsd |
| Model calls | 131 | modelCalls |
| Tokens (in / out) | 346,583 / 304,428 | tokensIn / tokensOut |
| Vendor burn | $0 | vendorBurnUsd |
| Marketing spent / budget | $0 / $500 | marketingSpentUsd / marketingBudgetUsd |
| Total monthly cost | $0 | totalMonthlyUsd |
| Company monthly cap | $3,000 | caps.companyMonthlyCapUsd |
| Governance cap (per action) | $150 | caps.governanceCapUsd |
| Gross | $49 | net.grossUsd |
| Cash on hand | **[Unknown]** | not supplied |
| Labour / founder comp | **[Unknown]** | not supplied |

## 2. Reconciliation checks (do the numbers tie?)

| Check | Arithmetic | Result |
|---|---|---|
| ARR vs MRR | 49 × 12 = 588 | ✓ ties to arrUsd 588 |
| Model calls | 12 + 11 + 99 + 9 = 131 | ✓ ties to modelCalls 131 |
| Total tokens | 346,583 + 304,428 = 651,011 | ✓ |
| Total recorded cost | 0 (model) + 0 (vendor) + 0 (marketing) = 0 | ✓ ties to totalMonthlyUsd 0 |
| Net (gross) | 49 (revenue) − 0 (cost) = 49 | ✓ ties to grossUsd 49 |

All supplied figures reconcile internally.

## 3. Dimension assessment

### Summary

| Dimension | Score | One-line basis |
|---|---|---|
| Liquidity | 3 / 5 *(provisional)* | No operating drain, but cash balance [Unknown] |
| Burn & runway | 4 / 5 | Recorded net cash flow +$49/mo; no burn |
| Revenue concentration | 1 / 5 | 100% from a single $49 customer |
| Unit economics | 3 / 5 | ~100% recorded contribution margin, but CAC/LTV unproven |
| Cost structure | 4 / 5 | Near-zero cash cost; 0% of caps used |
| Margin trend | **[Unknown]** | Only one period of history |
| **Overall** | **≈ 3 / 5 (conditional)** | (3+4+1+3+4) ÷ 5 = 3.0; margin trend excluded as unscorable |

### 3.1 Liquidity — 3 / 5 (provisional)
| Figure | Arithmetic | Value |
|---|---|---|
| Recorded operating cash flow | 49 − 0 | +$49 / mo |
| Current ratio | current assets ÷ current liabilities | **[Unknown]** |

Reasoning: operations produce cash rather than consume it, so there is no liquidity drain from activity. A true liquidity ratio needs cash-on-hand and current liabilities, both [Unknown]. The score is provisional and assumes cash ≥ $0; it is not a verified liquidity position.

### 3.2 Burn & runway — 4 / 5
| Figure | Arithmetic | Value |
|---|---|---|
| Net monthly cash flow (recorded) | 49 − 0 | +$49 |
| Monthly burn (recorded) | max(0, −49) | $0 |
| Runway on recorded burn | positive cash flow ⇒ not depleting | Not constrained |
| Runway (true) | [Unknown] cash ÷ [Unknown] true burn | **[Unknown]** |

Reasoning: on recorded figures the company adds cash each month, so it is not on a countdown. Caveat: recorded cost excludes founder time and any flat subscription fees, and the $49 magnitude is negligible — this reads as survival, not traction.

### 3.3 Revenue concentration — 1 / 5
| Figure | Arithmetic | Value |
|---|---|---|
| Top-customer share of MRR | 49 ÷ 49 | 100% |
| Paying customers | active count | 1 |
| Non-paying leads | lead count | 3 |

Reasoning: a single customer is 100% of revenue, so losing them is a 100% revenue loss. This is the largest single financial risk in the file. The three leads contribute $0 and do not yet mitigate it.

### 3.4 Unit economics — 3 / 5
| Figure | Arithmetic | Value |
|---|---|---|
| ARPU | 49 ÷ 1 | $49 / mo |
| Recorded marginal cost to serve | model + vendor attributable | ~$0 |
| Recorded contribution margin | (49 − 0) ÷ 49 | 100% |
| CAC | marketing $0; labour [Unknown] | **[Unknown]** |
| LTV | needs churn / retention | **[Unknown]** |

Reasoning: per-customer contribution looks strongly positive on recorded costs, but with n = 1, one month, no known CAC and no proven retention, the economics are favourable-but-unvalidated rather than confirmed.

### 3.5 Cost structure — 4 / 5
| Figure | Arithmetic | Value |
|---|---|---|
| Total recorded cost | 0 + 0 + 0 | $0 |
| Company cap utilisation | 0 ÷ 3,000 | 0% |
| Marketing budget utilisation | 0 ÷ 500 | 0% |
| Model cost per call | 0 ÷ 131 | $0 |

Reasoning: extremely capital-efficient — 131 model calls and 651,011 tokens at $0 recorded cost, largely absorbed by the claude-subscription tier (99 of 131 calls). Caveats: (a) excludes labour/founder comp; (b) $0 of the $500 marketing budget means acquisition is unfunded — lean here also means no growth engine; (c) if usage migrates to metered providers (openai/anthropic, currently 21 of 131 calls), cost per call will stop being $0.

### 3.6 Margin trend — [Unknown]
| Figure | Arithmetic | Value |
|---|---|---|
| Gross margin, 2026-08 | (49 − 0) ÷ 49 | 100% |
| Prior-period margin | — | **[Unknown]** |
| Trend | needs ≥ 2 periods; have 1 | **[Unknown]** |

Reasoning: spendHistory contains a single month (2026-08). A trend cannot be drawn from one data point, so I decline to state one rather than fabricate a direction.

## 4. Overall verdict
**≈ 3 / 5 — solvent and lean, but sub-scale, and conditional on unverified figures.**

Crucible Systems is **not distressed**: on recorded figures it is cash-flow positive (+$49/mo) with essentially zero cash cost. It is also **barely a business yet**: $49 MRR from one customer, no pipeline, no proven acquisition. The two dimensions that matter most for survival — cash-on-hand and true (labour-inclusive) burn — are [Unknown], so this verdict is explicitly conditional. The dominant, certain risk is 100% customer concentration.

## 5. Actions that would most improve the position (highest leverage first)
1. **Record cash-on-hand and the full cost base** (founder time, any subscription fees). Runway is currently [Unknown]; it cannot be managed until it is measured.
2. **Break the single-customer dependency.** Convert the 3 leads and add accounts; even 2–3 more paying customers cuts concentration from 100% toward ~25–33%.
3. **Run one small, measured acquisition test** against the untouched $500 marketing budget to establish a real CAC and a repeatable channel.
4. **Test willingness-to-pay / annual terms** with the active customer to lift ARPU above the $49 floor.
5. **Log a second month** so margin trend and burn become computable instead of [Unknown].

## 6. What this means — for the founder
You are not about to run out of money from operations. Right now the business takes in a little ($49) and spends nothing that we record, so on paper it drifts upward rather than downward. That is the good news — and it is roughly the only news, because $49 from one customer is not yet a business; it is proof that the product can be sold to exactly one person.

Two things should bother you. First, if that one customer leaves, revenue goes to zero — there is no second leg to stand on. Second, I genuinely cannot tell you your runway, because your bank balance and your real costs (your own time, any flat subscriptions) are not in these numbers. 'Zero cost' on paper almost always means the costs are real but unrecorded.

So the job this month is not cost-cutting — there is nothing to cut. It is proving you can win a second, third, and fourth customer, and writing down your cash and true costs so next month we can measure survival honestly instead of guessing.