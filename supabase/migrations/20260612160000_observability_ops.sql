-- =============================================================================
-- PRISM (staging) — PHASE 5: OBSERVABILITY & OPS
--   alert_rules, notifications, audit_log, enforce_checkins, export_destinations,
--   pii_incidents, request_logs (gateway prompt/completion store), ingest_log,
--   sdk_bypass_events, provider_usage_snapshots, user_feedback.
--   Columns verified against database.types.ts. Telemetry tables are written by
--   the service role (RLS grants members SELECT only). org_id FK cascades added
--   for clean teardown (dev omitted some FKs).
-- =============================================================================

-- 1. alert_rules -------------------------------------------------------------
CREATE TABLE public.alert_rules (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid          REFERENCES public.projects(id)               ON DELETE CASCADE,
  name            text          NOT NULL,
  trigger_type    text          NOT NULL CHECK (trigger_type IN (
                    'budget_threshold','spend_spike','error_rate','single_call_cost','daily_limit',
                    'tool_call_loop','session_budget_threshold','velocity_spike','pii_detection')),
  threshold_value numeric(12,4) NOT NULL,
  channels        text[]        NOT NULL DEFAULT '{}',
  slack_webhook   text,
  custom_webhook  text,
  is_active       boolean       NOT NULL DEFAULT true,
  last_fired_at   timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- 2. notifications (type is free text; URL/extra carried in metadata) ---------
CREATE TABLE public.notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid        REFERENCES auth.users(id)                    ON DELETE CASCADE,
  title      text        NOT NULL,
  body       text,
  type       text        NOT NULL,
  metadata   jsonb       NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. audit_log (immutable trail; service-role writes) ------------------------
CREATE TABLE public.audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid        REFERENCES auth.users(id)                    ON DELETE SET NULL,
  action        text        NOT NULL,
  resource_type text        NOT NULL,
  resource_id   text,
  resource_name text,
  metadata      jsonb       NOT NULL DEFAULT '{}',
  ip_address    text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 4. enforce_checkins (Shadow IT detection) ----------------------------------
CREATE TABLE public.enforce_checkins (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id    uuid        REFERENCES public.api_keys(id)               ON DELETE SET NULL,
  raw_module    text        NOT NULL,
  service_name  text,
  environment   text,
  language      text,
  git_branch    text,
  git_commit    text,
  app_name      text,
  checked_in_at timestamptz NOT NULL DEFAULT now()
);

-- 5. export_destinations (telemetry export endpoints) ------------------------
CREATE TABLE public.export_destinations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  type         text        NOT NULL CHECK (type IN ('webhook','langfuse','helicone')),
  url          text        NOT NULL,
  secret_token text,
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 6. pii_incidents (PII pre-flight incident log) -----------------------------
CREATE TABLE public.pii_incidents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id   uuid        REFERENCES public.api_keys(id)               ON DELETE SET NULL,
  user_id      text,
  provider     text        NOT NULL,
  model        text        NOT NULL,
  pii_types    text[]      NOT NULL,
  action_taken text        NOT NULL CHECK (action_taken IN ('warn','block')),
  field_paths  text[],
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 7. request_logs (gateway prompt/completion store) --------------------------
CREATE TABLE public.request_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id    uuid        REFERENCES public.api_keys(id)               ON DELETE SET NULL,
  project_id    uuid        REFERENCES public.projects(id)               ON DELETE SET NULL,
  model         text        NOT NULL,
  provider      text        NOT NULL DEFAULT 'openai',
  prompt        jsonb,
  completion    text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(14,8),
  latency_ms    integer,
  status_code   integer,
  session_id    text,
  git_branch    text,
  git_author    text,
  key_type      text        DEFAULT 'gateway',
  routed_from   text,
  trace_id      text,
  span_id       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 8. ingest_log (per-ingest summary) -----------------------------------------
CREATE TABLE public.ingest_log (
  id          bigserial   PRIMARY KEY,
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id  uuid,
  project_id  uuid,
  key_prefix  text,
  event_count integer     NOT NULL DEFAULT 0,
  total_cost  numeric(14,8) NOT NULL DEFAULT 0,
  status      text        NOT NULL,
  error_code  text,
  latency_ms  integer,
  source_ip   text,
  ts          timestamptz NOT NULL DEFAULT now()
);

-- 9. sdk_bypass_events (gateway-bypass detection) ----------------------------
CREATE TABLE public.sdk_bypass_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id              uuid,
  key_name            text,
  raw_module          text        NOT NULL,
  app_name            text,
  assigned_user_email text,
  environment         text,
  git_branch          text,
  git_commit          text,
  occurred_at         timestamptz DEFAULT now()
);

-- 10. provider_usage_snapshots (provider-side usage/cost reconciliation) -----
CREATE TABLE public.provider_usage_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_key_id uuid        NOT NULL REFERENCES public.provider_keys(id)  ON DELETE CASCADE,
  provider        text        NOT NULL,
  model           text        NOT NULL DEFAULT '',
  snapshot_date   date        NOT NULL,
  input_tokens    bigint,
  output_tokens   bigint,
  requests        bigint,
  raw_cost_usd    numeric(14,8),
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

-- 11. user_feedback (end-user feedback on traces) ----------------------------
CREATE TABLE public.user_feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trace_id    text,
  span_id     text,
  end_user_id text,
  rating      integer,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 12. INDEXES ----------------------------------------------------------------
CREATE INDEX idx_alert_rules_org      ON public.alert_rules(org_id);
CREATE INDEX idx_notifications_user   ON public.notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_audit_log_org        ON public.audit_log(org_id, created_at DESC);
CREATE INDEX idx_enforce_checkins_org ON public.enforce_checkins(org_id, checked_in_at DESC);
CREATE INDEX idx_export_dest_org      ON public.export_destinations(org_id);
CREATE INDEX idx_pii_incidents_org    ON public.pii_incidents(org_id, created_at DESC);
CREATE INDEX idx_rl_org_created       ON public.request_logs(org_id, created_at DESC);
CREATE INDEX idx_rl_key_created       ON public.request_logs(api_key_id, created_at DESC);
CREATE INDEX idx_rl_trace             ON public.request_logs(trace_id);
CREATE INDEX idx_rl_prompt_gin        ON public.request_logs USING gin(prompt);
CREATE INDEX idx_ingest_log_org       ON public.ingest_log(org_id, ts DESC);
CREATE INDEX idx_sdk_bypass_org       ON public.sdk_bypass_events(org_id, occurred_at DESC);
CREATE INDEX idx_provider_usage_org   ON public.provider_usage_snapshots(org_id, snapshot_date DESC);
CREATE INDEX idx_user_feedback_org    ON public.user_feedback(org_id, created_at DESC);

-- 13. ROW LEVEL SECURITY -----------------------------------------------------
ALTER TABLE public.alert_rules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enforce_checkins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_destinations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pii_incidents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sdk_bypass_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_feedback            ENABLE ROW LEVEL SECURITY;

-- alert_rules + export_destinations: members read, admins manage
CREATE POLICY ar_select ON public.alert_rules FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ar_write  ON public.alert_rules FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY ed_select ON public.export_destinations FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ed_write  ON public.export_destinations FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

-- notifications: a user sees broadcasts (user_id NULL) + their own; can mark own read
CREATE POLICY notif_select ON public.notifications FOR SELECT
  USING (public.is_org_member(org_id) AND (user_id IS NULL OR user_id = auth.uid()));
CREATE POLICY notif_update ON public.notifications FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- user_feedback: members read; members file feedback
CREATE POLICY uf_select ON public.user_feedback FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY uf_insert ON public.user_feedback FOR INSERT WITH CHECK (public.is_org_member(org_id));

-- service-role-written telemetry: members read only (writes bypass RLS via service role)
CREATE POLICY audit_select   ON public.audit_log                FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ec_select      ON public.enforce_checkins         FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY pii_select     ON public.pii_incidents            FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY rl_select      ON public.request_logs             FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY il_select      ON public.ingest_log               FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY sbe_select     ON public.sdk_bypass_events        FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY pus_select     ON public.provider_usage_snapshots FOR SELECT USING (public.is_org_member(org_id));
