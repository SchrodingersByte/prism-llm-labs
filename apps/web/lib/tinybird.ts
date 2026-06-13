/**
 * Tinybird Forward — Prism schema definitions
 *
 * Defines the llm_events datasource and all query pipes.
 * Used by:
 *  - `tinybird build`  — validates schema and generates tinybird.json
 *  - `tinybird deploy` — pushes to the Tinybird workspace
 *  - Runtime          — `tinybird.*` for typed ingest and queries
 */

import {
  defineDatasource,
  definePipe,
  Tinybird,
  node,
  t,
  p,
  engine,
  type InferRow,
  type InferParams,
  type InferOutputRow,
} from "@tinybirdco/sdk";

// ── Datasource ────────────────────────────────────────────────────────────────

export const llmEvents = defineDatasource("llm_events", {
  description: "Every LLM call tracked by the Prism SDK",
  schema: {
    event_id:      t.string(),
    timestamp:     t.dateTime64(3),
    org_id:        t.string(),
    project_id:    t.string(),
    project_name:  t.string(),
    team_id:       t.string(),
    user_id:       t.string(),
    environment:   t.string().lowCardinality(),
    provider:      t.string().lowCardinality(),
    model:         t.string().lowCardinality(),
    input_tokens:  t.uint32(),
    output_tokens: t.uint32(),
    cached_tokens: t.uint32(),
    cost_usd:      t.float64(),
    latency_ms:    t.uint32(),
    status_code:   t.uint16(),
    request_id:    t.string(),
    tags:          t.string(),
  },
  engine: engine.mergeTree({
    partitionKey: "toYYYYMM(timestamp)",
    sortingKey:   ["org_id", "project_id", "timestamp"],
    ttl:          "toDateTime(timestamp) + INTERVAL 90 DAY",
  }),
});

export type LlmEventsRow = InferRow<typeof llmEvents>;

// ── Pipes ─────────────────────────────────────────────────────────────────────

export const overviewMetrics = definePipe("overview_metrics", {
  description: "Aggregate cost, token, and error metrics for an org",
  params: {
    org_id:    p.string().optional(""),
    from_date: p.string().optional("2024-01-01 00:00:00"),
    to_date:   p.string().optional("2099-01-01 00:00:00"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
            count()                               AS total_requests,
            sum(cost_usd)                         AS total_cost_usd,
            sum(input_tokens)                     AS total_input_tokens,
            sum(output_tokens)                    AS total_output_tokens,
            sum(cached_tokens)                    AS total_cached_tokens,
            avg(latency_ms)                       AS avg_latency_ms,
            countIf(status_code >= 400)           AS error_count,
            countIf(status_code >= 400) / count() AS error_rate
        FROM llm_events
        WHERE org_id    = {{String(org_id, '', required=False)}}
          AND timestamp >= parseDateTimeBestEffort({{String(from_date, '2024-01-01 00:00:00', required=False)}})
          AND timestamp <= parseDateTimeBestEffort({{String(to_date, '2099-01-01 00:00:00', required=False)}})
      `,
    }),
  ],
  output: {
    total_requests:     t.uint64(),
    total_cost_usd:     t.float64(),
    total_input_tokens: t.uint64(),
    total_output_tokens:t.uint64(),
    total_cached_tokens:t.uint64(),
    avg_latency_ms:     t.float64(),
    error_count:        t.uint64(),
    error_rate:         t.float64(),
  },
  endpoint: true,
});

export type OverviewMetricsParams = InferParams<typeof overviewMetrics>;
export type OverviewMetricsRow    = InferOutputRow<typeof overviewMetrics>;

// ─────────────────────────────────────────────────────────────────────────────

export const timeseriesDaily = definePipe("timeseries_daily", {
  description: "Daily cost, request, and token totals for an org+project",
  params: {
    org_id:     p.string().optional(""),
    project_id: p.string().optional(""),
    from_date:  p.string().optional("2024-01-01 00:00:00"),
    to_date:    p.string().optional("2099-01-01 00:00:00"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
            toDate(timestamp)                 AS date,
            sum(cost_usd)                     AS cost_usd,
            count()                           AS requests,
            sum(input_tokens + output_tokens) AS total_tokens
        FROM llm_events
        WHERE org_id     = {{String(org_id, '', required=False)}}
          AND project_id = {{String(project_id, '', required=False)}}
          AND timestamp >= parseDateTimeBestEffort({{String(from_date, '2024-01-01 00:00:00', required=False)}})
          AND timestamp <= parseDateTimeBestEffort({{String(to_date, '2099-01-01 00:00:00', required=False)}})
        GROUP BY date
        ORDER BY date ASC
      `,
    }),
  ],
  output: {
    date:         t.string(),
    cost_usd:     t.float64(),
    requests:     t.uint64(),
    total_tokens: t.uint64(),
  },
  endpoint: true,
});

export type TimeseriesDailyParams = InferParams<typeof timeseriesDaily>;
export type TimeseriesDailyRow    = InferOutputRow<typeof timeseriesDaily>;

// ─────────────────────────────────────────────────────────────────────────────

export const timeseriesHourly = definePipe("timeseries_hourly", {
  description: "Hourly cost and request totals for an org+project",
  params: {
    org_id:     p.string().optional(""),
    project_id: p.string().optional(""),
    from_date:  p.string().optional("2024-01-01 00:00:00"),
    to_date:    p.string().optional("2099-01-01 00:00:00"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
            toStartOfHour(timestamp)          AS hour,
            sum(cost_usd)                     AS cost_usd,
            count()                           AS requests,
            sum(input_tokens + output_tokens) AS total_tokens
        FROM llm_events
        WHERE org_id     = {{String(org_id, '', required=False)}}
          AND project_id = {{String(project_id, '', required=False)}}
          AND timestamp >= parseDateTimeBestEffort({{String(from_date, '2024-01-01 00:00:00', required=False)}})
          AND timestamp <= parseDateTimeBestEffort({{String(to_date, '2099-01-01 00:00:00', required=False)}})
        GROUP BY hour
        ORDER BY hour ASC
      `,
    }),
  ],
  output: {
    hour:         t.string(),
    cost_usd:     t.float64(),
    requests:     t.uint64(),
    total_tokens: t.uint64(),
  },
  endpoint: true,
});

export type TimeseriesHourlyParams = InferParams<typeof timeseriesHourly>;
export type TimeseriesHourlyRow    = InferOutputRow<typeof timeseriesHourly>;

// ─────────────────────────────────────────────────────────────────────────────

export const spendByProject = definePipe("spend_by_project", {
  description: "Cost and usage totals grouped by project",
  params: {
    org_id:    p.string().optional(""),
    from_date: p.string().optional("2024-01-01 00:00:00"),
    to_date:   p.string().optional("2099-01-01 00:00:00"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
            project_id,
            project_name,
            sum(cost_usd)      AS cost_usd,
            count()            AS requests,
            sum(input_tokens)  AS input_tokens,
            sum(output_tokens) AS output_tokens,
            avg(latency_ms)    AS avg_latency_ms
        FROM llm_events
        WHERE org_id    = {{String(org_id, '', required=False)}}
          AND timestamp >= parseDateTimeBestEffort({{String(from_date, '2024-01-01 00:00:00', required=False)}})
          AND timestamp <= parseDateTimeBestEffort({{String(to_date, '2099-01-01 00:00:00', required=False)}})
        GROUP BY project_id, project_name
        ORDER BY cost_usd DESC
      `,
    }),
  ],
  output: {
    project_id:    t.string(),
    project_name:  t.string(),
    cost_usd:      t.float64(),
    requests:      t.uint64(),
    input_tokens:  t.uint64(),
    output_tokens: t.uint64(),
    avg_latency_ms:t.float64(),
  },
  endpoint: true,
});

export type SpendByProjectParams = InferParams<typeof spendByProject>;
export type SpendByProjectRow    = InferOutputRow<typeof spendByProject>;

// ─────────────────────────────────────────────────────────────────────────────

export const spendByModel = definePipe("spend_by_model", {
  description: "Cost and usage totals grouped by model and provider",
  params: {
    org_id:    p.string().optional(""),
    from_date: p.string().optional("2024-01-01 00:00:00"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
            model,
            provider,
            total_cost_usd,
            requests,
            input_tokens,
            output_tokens,
            avg_cost_per_request,
            output_tokens / nullIf(input_tokens, 0) AS output_input_ratio
        FROM (
          SELECT
              model,
              provider,
              sum(cost_usd)      AS total_cost_usd,
              count()            AS requests,
              sum(input_tokens)  AS input_tokens,
              sum(output_tokens) AS output_tokens,
              avg(cost_usd)      AS avg_cost_per_request
          FROM llm_events
          WHERE org_id    = {{String(org_id, '', required=False)}}
            AND timestamp >= parseDateTimeBestEffort({{String(from_date, '2024-01-01 00:00:00', required=False)}})
          GROUP BY model, provider
        )
        ORDER BY total_cost_usd DESC
      `,
    }),
  ],
  output: {
    model:               t.string(),
    provider:            t.string(),
    total_cost_usd:      t.float64(),
    requests:            t.uint64(),
    input_tokens:        t.uint64(),
    output_tokens:       t.uint64(),
    avg_cost_per_request:t.float64(),
    output_input_ratio:  t.float64(),
  },
  endpoint: true,
});

export type SpendByModelParams = InferParams<typeof spendByModel>;
export type SpendByModelRow    = InferOutputRow<typeof spendByModel>;

// ─────────────────────────────────────────────────────────────────────────────

export const spendByTeam = definePipe("spend_by_team", {
  description: "Cost and usage totals grouped by user and team",
  params: {
    org_id:    p.string().optional(""),
    from_date: p.string().optional("2024-01-01 00:00:00"),
    to_date:   p.string().optional("2099-01-01 00:00:00"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
            user_id,
            team_id,
            sum(cost_usd)   AS cost_usd,
            count()         AS requests,
            avg(latency_ms) AS avg_latency_ms
        FROM llm_events
        WHERE org_id    = {{String(org_id, '', required=False)}}
          AND timestamp >= parseDateTimeBestEffort({{String(from_date, '2024-01-01 00:00:00', required=False)}})
          AND timestamp <= parseDateTimeBestEffort({{String(to_date, '2099-01-01 00:00:00', required=False)}})
        GROUP BY user_id, team_id
        ORDER BY cost_usd DESC
      `,
    }),
  ],
  output: {
    user_id:       t.string(),
    team_id:       t.string(),
    cost_usd:      t.float64(),
    requests:      t.uint64(),
    avg_latency_ms:t.float64(),
  },
  endpoint: true,
});

export type SpendByTeamParams = InferParams<typeof spendByTeam>;
export type SpendByTeamRow    = InferOutputRow<typeof spendByTeam>;

// ─────────────────────────────────────────────────────────────────────────────

export const maxCostPerCall = definePipe("max_cost_per_call", {
  description: "Maximum, average, and count of costs per call in a window — used by alert evaluator",
  params: {
    org_id:    p.string().optional(""),
    from_date: p.string().optional("2024-01-01 00:00:00"),
    to_date:   p.string().optional("2099-01-01 00:00:00"),
  },
  nodes: [
    node({
      name: "endpoint",
      sql: `
        SELECT
            max(cost_usd) AS max_cost_usd,
            count()       AS requests,
            avg(cost_usd) AS avg_cost_usd
        FROM llm_events
        WHERE org_id    = {{String(org_id, '', required=False)}}
          AND timestamp >= parseDateTimeBestEffort({{String(from_date, '2024-01-01 00:00:00', required=False)}})
          AND timestamp <= parseDateTimeBestEffort({{String(to_date, '2099-01-01 00:00:00', required=False)}})
      `,
    }),
  ],
  output: {
    max_cost_usd: t.float64(),
    requests:     t.uint64(),
    avg_cost_usd: t.float64(),
  },
  endpoint: true,
});

export type MaxCostPerCallParams = InferParams<typeof maxCostPerCall>;
export type MaxCostPerCallRow    = InferOutputRow<typeof maxCostPerCall>;

// ─────────────────────────────────────────────────────────────────────────────

export const anomalyDetection = definePipe("anomaly_detection", {
  description: "Days where daily spend is more than 2× the 7-day rolling average",
  params: {
    org_id: p.string().optional(""),
  },
  nodes: [
    node({
      name: "daily_spend",
      sql: `
        SELECT
            toDate(timestamp) AS date,
            sum(cost_usd)     AS daily_cost
        FROM llm_events
        WHERE org_id    = {{String(org_id, '', required=False)}}
          AND timestamp >= now() - INTERVAL 30 DAY
        GROUP BY date
        ORDER BY date ASC
      `,
    }),
    node({
      name: "endpoint",
      sql: `
        SELECT date, daily_cost, rolling_7d_avg, spike_ratio
        FROM (
          SELECT
              date,
              daily_cost,
              avg(daily_cost) OVER (
                ORDER BY date
                ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
              ) AS rolling_7d_avg,
              daily_cost / nullIf(avg(daily_cost) OVER (
                ORDER BY date
                ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
              ), 0) AS spike_ratio
          FROM daily_spend
        )
        WHERE spike_ratio > 2
        ORDER BY date DESC
      `,
    }),
  ],
  output: {
    date:          t.string(),
    daily_cost:    t.float64(),
    rolling_7d_avg:t.float64(),
    spike_ratio:   t.float64(),
  },
  endpoint: true,
});

export type AnomalyDetectionParams = InferParams<typeof anomalyDetection>;
export type AnomalyDetectionRow    = InferOutputRow<typeof anomalyDetection>;

// ── Runtime client ────────────────────────────────────────────────────────────
// Token and baseUrl default to TINYBIRD_TOKEN / TINYBIRD_URL env vars.
// The legacy TINYBIRD_ADMIN_TOKEN / TINYBIRD_API_URL names are accepted as
// fallbacks so existing .env.local files keep working without changes.

export const tinybird = new Tinybird({
  token:   process.env.TINYBIRD_TOKEN   ?? process.env.TINYBIRD_ADMIN_TOKEN   ?? "",
  baseUrl: process.env.TINYBIRD_URL     ?? process.env.TINYBIRD_API_URL       ?? "https://api.tinybird.co",
  datasources: { llmEvents },
  pipes: {
    overviewMetrics,
    timeseriesDaily,
    timeseriesHourly,
    spendByProject,
    spendByModel,
    spendByTeam,
    maxCostPerCall,
    anomalyDetection,
  },
});
