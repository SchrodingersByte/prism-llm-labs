-- =============================================================================
-- PRISM (staging) — WS2 projects column corrections
--   Align projects with actual app usage (table parity != column-correct):
--     • status uses 'active' | 'inactive' (app PatchSchema + key-revocation on
--       deactivate; lib/supabase/projects.ts status type) — NOT 'archived'.
--     • app reads projects.daily_budget_usd alongside monthly_budget_usd
--       (api/projects/[id] GET) — column was missing.
-- =============================================================================

-- status: 'archived' -> 'inactive' to match the app vocabulary.
-- (No existing rows use 'archived'; default stays 'active'.)
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check CHECK (status IN ('active', 'inactive'));

-- daily spend budget (read by the project detail route alongside monthly_budget_usd).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS daily_budget_usd numeric(12,4);
