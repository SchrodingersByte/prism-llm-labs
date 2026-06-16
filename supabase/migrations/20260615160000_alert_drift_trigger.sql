-- =============================================================================
-- PRISM (staging) — PRD-5: allow the `drift` alert trigger type (P5.5)
--   lib/alerts/evaluator.ts has a checkDrift() handler (fires when the latest
--   overall embedding-drift PSI crosses the rule threshold), but the original
--   alert_rules CHECK (20260612160000_observability_ops.sql) predates it, so a
--   `drift` rule could not be inserted. Rebuild the CHECK to include it.
--
--   Also adds `statistical_anomaly`: checkStatisticalAnomaly() has shipped in the
--   evaluator for a while but was likewise missing from the CHECK (pre-existing
--   gap) — folding it in here so anomaly rules become insertable too.
--   `quality_drop` (PRD-1 P1.7) is intentionally NOT added yet — no evaluator
--   handler exists, so allowing it would let users create rules that never fire.
-- =============================================================================

ALTER TABLE public.alert_rules DROP CONSTRAINT IF EXISTS alert_rules_trigger_type_check;
ALTER TABLE public.alert_rules ADD CONSTRAINT alert_rules_trigger_type_check
  CHECK (trigger_type IN (
    'budget_threshold','spend_spike','error_rate','single_call_cost','daily_limit',
    'tool_call_loop','session_budget_threshold','velocity_spike','pii_detection',
    'statistical_anomaly','drift'));
