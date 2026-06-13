-- =============================================================================
-- PRISM (staging) — upsert_trace_rollup (missing service-role RPC)
--   The 7-phase rebuild achieved table parity but did not recreate the callable
--   DB functions the app invokes via supabase.rpc(). This one is on the gateway
--   hot path (lib/gateway/trace-writer.ts) and is fully compatible with the
--   staging `traces` table, so it is restored here.
--
--   NOTE: the app also calls increment_checkin_bypass(org_id, service_name),
--   but staging's `enforce_checkins` was built with the wrong column set
--   (bypass-event columns instead of the heartbeat columns the app upserts:
--   service_name/app_version/enforce_mode/last_seen_at/bypass_count +
--   UNIQUE(org_id,service_name)). That RPC + the enforce_checkins reshape are
--   deferred to WS5-E (observability/ops). The app guards that rpc() in
--   try/catch, so its temporary absence is non-fatal.
--
--   Depends on: public.traces (20260612180000).
-- =============================================================================

-- upsert_trace_rollup — atomic per-trace rollup accumulator.
--   ONE row per (trace_id, org_id); folds concurrent spans' cost/window/status
--   into a single INSERT ... ON CONFLICT so concurrent spans serialise on the
--   row without app-side locking. Conflict arbiter = UNIQUE (org_id, trace_id).
--   SECURITY DEFINER + pinned search_path; EXECUTE locked to service_role (only
--   the gateway's service-role client ever calls it).
CREATE OR REPLACE FUNCTION public.upsert_trace_rollup(
  p_org_id          uuid,
  p_trace_id        text,
  p_cost_usd        numeric,
  p_started_at      timestamptz,
  p_ended_at        timestamptz,
  p_status          text,
  p_root_span_id    text DEFAULT NULL,
  p_root_session_id text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.traces AS t (
    trace_id, org_id, total_cost_usd, started_at, ended_at, status,
    root_span_id, root_session_id
  )
  VALUES (
    p_trace_id, p_org_id, COALESCE(p_cost_usd, 0), p_started_at, p_ended_at,
    CASE WHEN p_status = 'error' THEN 'error' ELSE 'completed' END,
    p_root_span_id, p_root_session_id
  )
  ON CONFLICT (org_id, trace_id) DO UPDATE SET
    total_cost_usd  = COALESCE(t.total_cost_usd, 0) + COALESCE(EXCLUDED.total_cost_usd, 0),
    started_at      = LEAST(t.started_at, EXCLUDED.started_at),
    ended_at        = GREATEST(t.ended_at, EXCLUDED.ended_at),
    status          = CASE WHEN EXCLUDED.status = 'error' THEN 'error' ELSE t.status END,
    root_span_id    = COALESCE(t.root_span_id, EXCLUDED.root_span_id),
    root_session_id = COALESCE(t.root_session_id, EXCLUDED.root_session_id);
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_trace_rollup(uuid, text, numeric, timestamptz, timestamptz, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.upsert_trace_rollup(uuid, text, numeric, timestamptz, timestamptz, text, text, text) TO service_role;
