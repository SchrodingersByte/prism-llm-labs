-- Command Center customization: per-user widget layouts.
-- Keyed by view, e.g. { "org": ["kpi-spend", ...], "project": [...] }.
-- The /api/preferences/layout route and useDashboardLayout hook soft-fall-back
-- to localStorage until this column exists, so applying it is non-breaking.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS dashboard_layouts jsonb NOT NULL DEFAULT '{}'::jsonb;
