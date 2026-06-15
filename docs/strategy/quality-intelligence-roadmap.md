# Prism — Quality & Intelligence Roadmap

> **Status:** Roadmap / index · **Date:** 2026-06-14 ·
> **Companion to:** [Observability Portal Gap Analysis](observability-portal-gap-analysis.md)

## Thesis
The gap analysis showed Prism is best-in-class on **cost / control / economics** but behind on the
**quality + AI-intelligence layer** — the exact capabilities that turn it from "FinOps + telemetry"
into a true all-in-one AI observability portal. This roadmap sequences **8 PRDs** that close those
gaps, reusing Prism's existing eval primitive (`eval_scores` + `validator.ts`) and event spine rather
than rebuilding. Two structural insights drive the sequencing: (1) **content capture is the keystone**
(we store metadata only today), and (2) the eval PRDs **extend** an existing judge, not greenfield.

> **Note on scope:** these 8 PRDs are the **quality & intelligence** layer. The **Sales / AI-Product-
> P&L** wedge (per-customer margin, cost-to-serve, billing-platform sync) is a *separate* roadmap
> thread — now specced as **[PRD-08](../prd/08-ai-product-pnl-revenue-economics.md)** (see *Adjacent
> thread* below) — referenced by, but not built in, this 8-PRD suite. Prism Copilot (PRD-7) consumes
> its P&L data for margin Q&A.

## The 8 PRDs (index)
| # | PRD | One-line value | Phase |
|---|---|---|---|
| 0 | [Content & Embedding Capture](../prd/00-content-embedding-capture.md) | The keystone: capture prompts/completions/context/embeddings, privacy-first | 0 |
| 1 | [Online Evaluation & LLM-as-Judge](../prd/01-online-evaluation-llm-judge.md) | Continuous production quality scoring (+ RAG/safety scorers) | 1 |
| 2 | [Offline Evals, Datasets & Experiments](../prd/02-offline-evals-datasets-experiments.md) | Pre-release regression-proofing + CI gates | 2 |
| 3 | [Feedback & Annotation Queues](../prd/03-feedback-annotation-queues.md) | End-user feedback + human-in-the-loop ground truth | 1 |
| 4 | [Prompt Management & Playground](../prd/04-prompt-management-playground.md) | Prompt registry + playground; decouple prompts from deploys | 2 |
| 5 | [Drift & Embeddings Analysis](../prd/05-drift-embeddings-analysis.md) | Detect distribution shift before quality drops | 3 |
| 6 | [Deep Tracing & Debugging](../prd/06-deep-tracing-debugging.md) | Full span trees + payloads + replay for agent debugging | 3 |
| 7 | [Prism Copilot (NL + Agentic RCA)](../prd/07-prism-copilot-nl-agentic-rca.md) | Conversational, agentic analyst over the unified spine | 4 |

## Phasing (dependency-ordered)
- **Phase 0 — Foundation:** PRD-0 Content & Embedding Capture.
- **Phase 1 — Quality core:** PRD-1 Online Eval/Judge **+** PRD-3 Feedback/Annotation (parallel).
- **Phase 2 — Dev loop:** PRD-4 Prompt Mgmt **→** PRD-2 Offline Evals/Experiments.
- **Phase 3 — Advanced / DS:** PRD-5 Drift **+** PRD-6 Deep Tracing (parallel; both off PRD-0).
- **Phase 4 — Differentiator:** PRD-7 Prism Copilot (quick-win early on cost/anomaly data, then deepen
  as PRD-1/PRD-5 land).

```
Phase 0:  PRD-0 Content & Embedding Capture (keystone)
              │ enables ▼
Phase 1:  PRD-1 Online Eval/Judge ──── PRD-3 Feedback/Annotation     (parallel)
              │                               │ feeds ▼
Phase 2:  PRD-4 Prompt Mgmt ──────────► PRD-2 Offline Evals/Experiments
Phase 3:  PRD-5 Drift ──── PRD-6 Deep Tracing     (parallel, both off PRD-0)
Phase 4:  PRD-7 Prism Copilot   (starts early on cost/anomaly; deepens with PRD-1 + PRD-5)
```
**Critical path:** PRD-0 → PRD-1 → PRD-2 → (Copilot deepens). PRD-3 parallels PRD-1; PRD-4 unblocks
PRD-2; PRD-5/PRD-6 parallel in Phase 3; PRD-7 can start in Phase 1 on existing cost data.

## Division-value matrix
| PRD | Finance | Sales | Product | Engineering | Data Science |
|---|:--:|:--:|:--:|:--:|:--:|
| 0 Content Capture | ○ | | ● | ● | ● |
| 1 Online Eval | ● (cost-per-good-response) | | ● | ● | ● |
| 2 Offline Evals/Experiments | | | ● | ● | ● |
| 3 Feedback/Annotation | | | ● | | ● |
| 4 Prompt Mgmt | | | ● | ● | ● |
| 5 Drift | | | ● | ○ | ● |
| 6 Deep Tracing | | | ○ | ● | ● |
| 7 Prism Copilot | ● | ● | ● | ● | ● |
| 08 AI Product P&L *(adjacent)* | ● | ● | ○ | | |

● primary · ○ secondary · (blank = not a direct consumer)

## Competitor gap-closure tracker
| Phase | Reaches parity with | Where we exceed |
|---|---|---|
| 0 Capture | Langfuse/Arize (data substrate) | Privacy-first capture (opt-in/redacted/residency) |
| 1 Online eval + feedback | Langfuse/LangSmith/Braintrust/Arize (quality) | **cost-per-good-response** (cost×quality on one spine) |
| 2 Prompt + offline/experiments | Langfuse/LangSmith/Braintrust (dev loop) | Quality + cost shown together per experiment |
| 3 Drift + deep tracing | Arize (drift), Datadog/LangSmith (agent debug) | Agent/MCP/vector-DB economics tied to debug |
| 4 Prism Copilot | Datadog/Grafana/OpenSearch (agentic analytics) | **Unified cost + quality + economics** agentic analyst — no competitor has this data unified |

## Portfolio KPIs
- **Capture:** % traces with payloads (opted-in); zero raw-PII in audit.
- **Quality:** % traffic scored; judge↔human agreement; MTTD quality regression.
- **Dev loop:** prompts under management; regressions caught pre-release; % releases eval-gated.
- **DS:** drift lead time (detected before incident); topics surfaced.
- **Eng:** MTTR on agent bugs; % spans with full detail.
- **Differentiator:** questions answered without a dashboard; anomalies auto-explained; Copilot NPS.
- **Unit economics (cross-cut):** cost-per-good-response / cost-per-resolved-conversation live for ≥1
  feature.

## Cross-cutting principles (apply to every PRD)
- **Privacy/PII:** content capture is opt-in + inline-redacted (reuse the PII masker) + TTL +
  residency-aware (Settings → Compliance).
- **Judge cost control:** sampling + cheap judges (Haiku) + **self-metering via Prism's own gateway**
  (dogfood).
- **RBAC:** `read_only` cannot create configs/prompts/annotations — reuse the `canWriteOrg` pattern
  already in `/api/evaluations`.
- **SDK parity:** every SDK change lands in **both** TS + Python; keep `pricing/table.ts` ↔
  `_pricing.py` in sync.
- **Storage placement:** time-series quality/drift → **Tinybird**; configs/registry/queues →
  **Supabase**; payloads → object store / short-TTL DS; embeddings → vector store (pgvector to start).

## Adjacent thread — Revenue / AI Product P&L (PRD-08)
Separate from the 8-PRD quality suite, **[PRD-08 — AI Product P&L & Revenue Economics](../prd/08-ai-product-pnl-revenue-economics.md)**
completes the **Sales / RevOps lens** — the biggest remaining piece of the gap analysis's "remaining ~15%."
- **Why separate:** it's revenue/economics, not quality; it depends only on the *existing* customer
  cost attribution, so it can ship **in parallel** with any phase above.
- **The wedge:** the cost-to-serve half is already built (`spend_by_customer` + infra/MCP
  reconciliation); PRD-08 adds **revenue per customer → gross margin** + margin guardrails +
  billing-platform sync (Stripe/Metronome/Orb).
- **Differentiator:** fuses cost + revenue (+ PRD-1 quality) per AI customer — a story cost-only
  observability tools and revenue-only billing platforms structurally can't tell.
- **Sequencing:** independent; recommended after PRD-7 on the critical path, or parallelized earlier.
- **Coverage impact:** moves the **Sales** division from *partial → strong*, closing the last major
  division gap (~85% → ~90% overall platform coverage).

## Next step
These are **PRDs** (product/requirements + phased tasks). The **code-analysis / implementation-design
docs** (exact migrations, pipes, file diffs, tests per PRD) come next, once these are approved —
recommended order follows the critical path: PRD-0 → PRD-1 → PRD-3 → PRD-4 → PRD-2 → PRD-6 → PRD-5 →
PRD-7.
