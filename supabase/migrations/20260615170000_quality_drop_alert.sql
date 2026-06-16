-- =============================================================================
-- PRISM (staging) — PRD-1: allow the `quality_drop` alert trigger type (P1.7)
--   Now that lib/alerts/evaluator.ts has a checkQualityDrop() handler (fires when
--   the most-recent day's online-eval pass-rate drops vs the trailing baseline,
--   read from the quality_timeseries pipe), extend the alert_rules CHECK to allow
--   creating such rules. Rebuilds the constraint added in 20260615160000.
-- =============================================================================

ALTER TABLE public.alert_rules DROP CONSTRAINT IF EXISTS alert_rules_trigger_type_check;
ALTER TABLE public.alert_rules ADD CONSTRAINT alert_rules_trigger_type_check
  CHECK (trigger_type IN (
    'budget_threshold','spend_spike','error_rate','single_call_cost','daily_limit',
    'tool_call_loop','session_budget_threshold','velocity_spike','pii_detection',
    'statistical_anomaly','drift','quality_drop'));
