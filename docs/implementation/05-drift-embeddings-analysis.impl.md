# Code-Analysis / Implementation Design — PRD-5: Drift & Embeddings Analysis

> **Implements:** [PRD-5](../prd/05-drift-embeddings-analysis.md) · **Phase:** 3 (Advanced / DS) ·
> **Status:** Implementation design for review (no code yet) · **Critical-path position:** #7 ·
> **Depends on:** PRD-0 (embeddings substrate). Feeds Product topic analytics + PRD-7.

## 0. How to read this doc
Engineering design behind PRD-5 — the heaviest, latest PRD. It is **net-new** (no drift code exists),
but it stands entirely on PRD-0's embeddings + the established cron/anomaly/alert patterns.

---

## 1. Current-state analysis (corrected by code reading)
- **No drift/embedding-analysis code exists** (grep `drift` → only an unrelated budget *forecast* and a
  recommendation route). Net-new.
- **Substrate from PRD-0:** `content_embeddings` (pgvector `vector(1536)`, computed via the gateway).
- **Reusable patterns:** `tinybird/pipes/anomaly_detection.pipe` (scheduled spike detection — the model
  for drift detection); cron shape (`app/api/cron/build-recommendations/route.ts`: `CRON_SECRET`,
  iterate orgs, `maxDuration 300`); `queryTinybird`/`querySql`; the alerts evaluator
  (`lib/alerts/evaluator.ts`).

---

## 2. Design summary
1. **Drift cron** computes, per segment + rolling window, the standard metrics over `content_embeddings`
   vs a baseline window, writing a Tinybird **`drift_metrics`** time-series.
2. **Topic/intent clustering** over embeddings → `clusters` (Supabase) — also powers Product analytics.
3. **Drift alerts** via the existing alerts evaluator; **viz** (trend + projection + cluster explorer).

## 3. Drift methods (from research)
- **PSI** (Population Stability Index) + **Jensen–Shannon divergence** on binned distance/feature
  distributions; **cluster-centroid cosine** drift; **MMD** for distribution distance. Start with
  PSI + JS + centroid-cosine; add MMD later.
*Sources: [Evidently embedding drift](https://www.evidentlyai.com/blog/embedding-drift-detection),
[Fiddler](https://www.fiddler.ai/resources/monitor-nlp-and-llm-based-embeddings-for-data-drift).*

## 4. Data model & changes
- **Tinybird `tinybird/datasources/drift_metrics.datasource`**: `org_id, project_id, window_start,
  window_end, segment (model|feature|all), segment_value, metric (psi|js|centroid_cosine|mmd), value,
  baseline_ref, computed_at` + pipe `drift_timeseries.pipe`.
- **Supabase `clusters`** (cluster metadata; small): `id, org_id, project_id, window_start, label,
  size, centroid_ref, created_at` (RLS: `is_org_member` read, service write).
- **pgvector index** on `content_embeddings` (ivfflat/hnsw) added here (deferred from PRD-0) for
  nearest-neighbour/cluster queries.

## 5. Code changes (file-by-file)
### 5.1 Drift math — `apps/web/lib/drift/metrics.ts` (new)
- `psi(baseline[], current[])`, `jsDivergence(...)`, `centroidCosineDrift(...)`, (later) `mmd(...)`.
  Operate on sampled embeddings pulled from `content_embeddings`.

### 5.2 Clustering — `apps/web/lib/drift/cluster.ts` (new)
- k-means (or HDBSCAN-lite) over a sampled embedding window → clusters + centroids; optional LLM label
  (via gateway) per cluster (cheap, dogfood).

### 5.3 Drift cron — `app/api/cron/compute-drift/route.ts` (new)
- `CRON_SECRET` + iterate orgs (build-recommendations shape). Per org/project/segment: pull baseline +
  current embedding samples → compute metrics → `ingestToTinybird(rows, "drift_metrics")`; refresh
  clusters; raise a `drift` alert on threshold breach.

### 5.4 Metrics API — `app/api/metrics/drift/route.ts` (new)
- `GET` drift trend (`queryTinybird("drift_timeseries", …)`) + clusters (Supabase). `is_org_member`.

### 5.5 Alerts — extend `lib/alerts/evaluator.ts`
- Add a `drift` alert type (threshold on latest drift value vs config).

## 6. UX
- **Drift dashboard** (`app/dashboard/quality/drift` or a DS section): drift trend per segment + alerts.
- **Embedding projection** (t-SNE/UMAP scatter, precomputed server-side and cached).
- **Cluster/topic explorer** (also surfaced to Product as emerging topics/intents).

## 7. Phased task breakdown → files (each gated by `tsc`/`build`)
- **P5.1** pgvector index + drift math lib. *AC:* PSI/JS/centroid functions unit-tested on fixtures.
- **P5.2** Drift cron + `drift_metrics` DS + `drift_timeseries` pipe. *AC:* drift computed vs baseline per segment.
- **P5.3** Clustering + `clusters` table. *AC:* clusters with labels + sizes per window.
- **P5.4** Drift dashboard + projection + cluster explorer. *AC:* trend + projection render.
- **P5.5** `drift` alert. *AC:* a seeded distribution shift fires an alert.

## 8. Locked-decision alignment + small choices
- Inherits PRD-0 locks (embeddings via gateway, `vector(1536)`, pgvector). Drift **time-series →
  Tinybird** (consistent with the locked storage split); cluster metadata → Supabase.
- **Clustering algo — recommend:** k-means for v1 (simple, fast); revisit density-based later.
- **Baseline — recommend:** rolling 7/30-day baseline, configurable.

## 9. Risks
- **Embedding cost/volume** → sample + batch (embeddings already gated/optional in PRD-0).
- **High-dim stat reliability** → use multiple methods (PSI + JS + centroid) and corroborate.
- **Compute heavy** → cron + batching; never inline.
- **pgvector performance** → ivfflat/hnsw index + sampling.

## 10. Test plan
- **Unit:** drift math on synthetic distributions (no-drift ≈ 0; injected shift > threshold); clustering
  on separable fixtures.
- **Integration:** seed two embedding windows (baseline vs shifted) → cron writes drift rows → alert
  fires; clusters labeled.
- **E2E:** drift dashboard shows a rising trend + a new topic cluster after injecting off-distribution
  traffic.
- **Gates:** `tsc`/`lint`/`build`.
