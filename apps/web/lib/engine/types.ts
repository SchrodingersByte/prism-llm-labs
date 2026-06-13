/** Shared types for the Model Intelligence Engine. */

export type RecommendationType =
  | "cheaper_model"
  | "caching_opportunity"
  | "high_cost_model"
  | "mcp_high_error_rate"
  | "mcp_unreconciled_costs"
  | "mcp_agent_loops"
  | "cache_adoption_gap"
  | "low_efficiency_model"
  | "feature_cost_concentration"
  | "high_error_cost"
  // Phase 1 — new pattern-aware types
  | "task_type_mismatch"
  | "per_feature_downgrade"
  | "context_window_waste"
  | "batch_opportunity";

export type RecommendationStatus =
  | "new"
  | "testing"
  | "validated"
  | "staged"     // validation cleared the confidence bar — ready for one-click activation
  | "applied"
  | "rejected";

/** Persisted lifecycle row for a recommendation (recommendation_actions table). */
export interface RecommendationAction {
  rec_id:            string;
  rec_type:          string;
  status:            RecommendationStatus;
  current_model:     string | null;
  suggested_model:   string | null;
  feature:           string | null;
  validation_score:  number | null;
  validation_result: ValidationResult | null;
  staged_at:         string | null;
  applied_at:        string | null;
  applied_by:        string | null;
  rejected_at:       string | null;
  updated_at:        string;
}

export interface Recommendation {
  id:                   string;    // deterministic: hash of type+model+feature
  type:                 RecommendationType;
  title:                string;
  description:          string;
  potential_savings_usd: number;
  confidence:           number;    // 0–1
  status:               RecommendationStatus;
  current_model?:       string;
  suggested_model?:     string;
  feature?:             string;
  tool_name?:           string;
  mcp_server?:          string;
  // Phase 1 extended stats
  stats?: {
    requests?:            number;
    current_cost?:        number;
    avg_input_tokens?:    number;
    p95_input_tokens?:    number;
    output_input_ratio?:  number;
    cache_hit_rate?:      number;
    error_rate?:          number;
    tokens_per_dollar?:   number;
  };
}

export interface EfficiencyScore {
  score:              number;   // 0–100
  delta_week?:        number;   // change vs 7 days ago
  cost_efficiency:    number;   // 0–1 component
  model_alignment:    number;   // 0–1 component
  cache_utilisation:  number;   // 0–1 component
  adoption_rate:      number;   // 0–1 component
}

// Tinybird feature × model cross-tab row
export interface ModelFeatureRow {
  feature:            string;
  model:              string;
  provider:           string;
  cost_usd:           number;
  requests:           number;
  avg_input_tokens:   number;
  avg_output_tokens:  number;
  output_input_ratio: number;
  cache_hit_rate:     number;
  error_rate:         number;
  p95_input_tokens:   number;
}

// Validation types
export type ValidationMode = "synthetic" | "real";
export type ValidationStatus = "idle" | "pending" | "running" | "done" | "error";

export interface SampleScore {
  index:      number;
  question:   string;   // truncated prompt
  score:      number;   // 0–1 semantic agreement
  reason:     string;
  is_edge:    boolean;  // score < 0.7
}

export interface ValidationResult {
  mode:          ValidationMode;
  overall_score: number;         // 0–1
  n_samples:     number;
  edge_cases:    number;
  samples:       SampleScore[];
  current_model: string;
  target_model:  string;
  ran_at:        string;
}

export interface ValidationStreamState {
  status:       ValidationStatus;
  jobId?:       string;
  progress:     number;
  total:        number;
  score_so_far: number;
  result?:      ValidationResult;
  error?:       string;
}
