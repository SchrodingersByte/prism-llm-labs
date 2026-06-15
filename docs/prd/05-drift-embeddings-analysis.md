# PRD-5 — Drift & Embeddings Analysis

> **Phase:** 3 (Advanced / Data Science) · **Status:** Draft for review · **Depends on:** PRD-0
> (embeddings/content) · **Feeds:** Product topic analytics, PRD-7 (Copilot explains drift) ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Prism captures **no embeddings** today, so there is **no drift detection**. Drift (input / embedding /
prompt distribution shift) is the core Data-Science value of Arize, Fiddler, and Evidently: catch when
production traffic shifts — new topics, degraded inputs, prompt changes — **before** quality drops. The
same embeddings power **topic/intent clustering** for Product analytics. This is the heaviest PRD and
sits late, gated on PRD-0.

## 2. Current state (code anchors)
- **None** for embeddings/drift.
- Reusable patterns: `tinybird/pipes/anomaly_detection.pipe` (spike detection), cron infra
  (`app/api/cron/*`), `queryTinybird()`. PRD-0 will provide the embeddings/content substrate.

## 3. Competitive context
Arize — drift across inputs + embeddings (best-in-class); Fiddler — NLP/LLM embedding drift;
Evidently — multiple embedding-drift methods; W&B Weave — clustering for drift. Methods: **PSI,
Jensen-Shannon divergence, KS test, MMD, cluster-centroid cosine**, with t-SNE/UMAP projections.
*Sources: [Evidently embedding drift](https://www.evidentlyai.com/blog/embedding-drift-detection), [Fiddler embedding drift](https://www.fiddler.ai/resources/monitor-nlp-and-llm-based-embeddings-for-data-drift), [LLM drift detection](https://apxml.com/courses/mlops-for-large-models-llmops/chapter-5-llm-monitoring-observability-maintenance/detecting-llm-drift).*

## 4. Goals / Non-goals
**Goals:** embedding capture/compute (via PRD-0); scheduled drift jobs (PSI / JS / cluster-centroid /
MMD) over rolling windows vs baseline; topic/intent clustering; drift alerts; projection viz.
**Non-goals:** model retraining (out of scope), the eval scorers (PRD-1).

## 5. Division value
- **Data Science** — data/model drift → retrain triggers.
- **Product** — emerging topics/intents from clusters.
- **Engineering** — early warning before quality regressions.

## 6. Functional requirements
- Baseline window + current window; compute **drift metrics per segment** (model/feature/project).
- **Cluster** embeddings → topics (labels, sizes, trend).
- **Alert** on drift threshold (reuse alerts).
- **Viz**: projection (t-SNE/UMAP) + cluster explorer + drift trend.

## 7. Data model
- **Embeddings:** `pgvector content_embeddings` from PRD-0.
- **`drift_metrics`** (Supabase or Tinybird): `window_start, window_end, metric, value, segment jsonb,
  baseline_ref`.
- **`clusters`/topics**: `cluster_id, centroid, label, size, window`.
- Tinybird pipe `drift_timeseries` for trends.

## 8. API & SDK surface
- Cron drift jobs: `POST /api/cron/compute-drift`.
- `GET /api/metrics/drift`.
- Embeddings ingested/computed via PRD-0 (no new SDK surface required).

## 9. UX / dashboard pages
- **Drift dashboard** (trend + alerts) — `/dashboard/quality/drift` or a DS section.
- **Embedding projection** (t-SNE/UMAP scatter).
- **Cluster/topic explorer** (also surfaced to Product).

## 10. Phased task breakdown + acceptance criteria
- **P5.1 Embedding capture/compute** (with PRD-0). *AC:* embeddings stored for sampled events.
- **P5.2 Drift job** (PSI/JS first). *AC:* drift value computed vs baseline per segment.
- **P5.3 Drift pipe/table.** *AC:* drift trend queryable.
- **P5.4 Dashboard + viz.** *AC:* projection + trend render.
- **P5.5 Alerts.** *AC:* a seeded distribution shift fires an alert.
- **P5.6 Topic clustering.** *AC:* clusters labeled + surfaced.

## 11. Dependencies
**PRD-0** (embeddings/content). Later phase (heaviest). Feeds Product analytics + **PRD-7** (Copilot
can explain drift).

## 12. Success metrics / KPIs
Drift detected before incident (lead time); topics surfaced; alert precision.

## 13. Risks & open questions
- **Embedding cost/volume** → sampling + batching.
- **High-dim stat reliability** → use multiple methods (PSI + JS + cluster).
- **Baseline choice** (rolling vs fixed) → configurable.
- **Compute heavy** → cron + batch, never inline.

## 14. Out of scope (code-analysis doc to follow)
Exact drift math, viz library choice, pgvector queries — in the PRD-5 code-analysis doc.
