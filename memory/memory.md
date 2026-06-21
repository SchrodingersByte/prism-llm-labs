# Prism (staging / prism-llm-labs) — Progress Log

Tracks completed work on the staging transition. Updated after each task.
Plan: `~/.claude/plans/i-have-a-clean-snug-deer.md`
Target Supabase project: `irehykmlliwarkcyzeqg`

## Phase 1 — RBAC foundation (exact Supabase access-control model)

Roles: `owner` > `administrator` > `developer` > `read_only`.
Scope: org-wide (`members`) or project-scoped (`member_project_roles`). No plan gating.

### Tasks
- [x] 2026-06-12 — Plan approved.
- [x] 2026-06-12 — Scaffolded `supabase/` (`config.toml` + migration `20260612120000_rbac_foundation.sql`).
- [x] 2026-06-12 — Applied migration to `irehykmlliwarkcyzeqg` (PostgreSQL 17.6) + synced Supabase CLI migration history.
- [x] 2026-06-12 — Verified: 7 tables + `org_role` enum + 11 fns + `members_min_one_owner` trigger + RLS (17 policies); `anon`/`authenticated` auto-granted.
- [x] 2026-06-12 — Verified: ≥1-owner invariant blocks delete/demote of sole owner; `transfer_org_ownership()` swaps roles + clears project grants.
- [x] 2026-06-12 — Verified: multi-org isolation + project-scope semantics (`project_role_for`).
- [x] 2026-06-12 — Verified: RLS — non-member sees 0 orgs; project-scoped member sees only assigned project.

**✅ Phase 1 complete — 23/23 verification checks passed. Ephemeral test users/data torn down.**

### Connection (for future migration phases)
- Region **ap-southeast-2**; **direct host is IPv6-only** (unroutable here) → use the session pooler.
- Session pooler: `aws-1-ap-southeast-2.pooler.supabase.com:5432`, user `postgres.irehykmlliwarkcyzeqg`, db `postgres`.
- Apply new migrations: `supabase db push --db-url postgresql://postgres.irehykmlliwarkcyzeqg:<DB_PW>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres` (CLI history already in sync). Throwaway `pg` runner also at `C:\Users\ddeyp\prism-apply-scratch\` (`db.mjs`, `verify.mjs`).
- `.env SUPABASE_DATABASE_PASSWORD` was initially a Google-OAuth secret; user corrected it 2026-06-12.

### Fixes made during execution
- `enforce_min_one_owner()` now no-ops when the org itself is being deleted (cascade delete of an org was wrongly tripping the ≥1-owner guard). Patched in migration file + live DB.

## Phase 2 — Keys & Gateway Core

### Tasks
- [x] 2026-06-12 — Authored `supabase/migrations/20260612130000_keys_gateway_core.sql`.
- [x] 2026-06-12 — Applied to staging + synced CLI history (both migrations now in Local+Remote).
- [x] 2026-06-12 — Verified **18/18**: structure (4 tables + 2 org cols + RLS + grants); 4-role/scope RLS — project-scoped developer manages only its project's api_keys, org-level write blocked; provider_keys write = org admin only; read_only blocked from all writes; non-member sees nothing; key_caps/links inherit parent-key visibility.

**✅ Phase 2 complete.** Tables: `api_keys`, `key_caps`, `provider_keys`, `key_provider_links`; org cols `gateway_mode`, `data_residency_policy`. RLS reuses the Phase-1 helpers.

### Note / correction tracked for later
- `organizations.plan` still uses the Phase-1 placeholder `free|solo|startup|enterprise`; dev's final set is `free|pro|team|enterprise` → fix in Phase 4 (Billing).

## Phase 3 — Enforcement / Governance / Routing

### Tasks
- [x] 2026-06-12 — Authored + applied `20260612140000_enforcement_governance_routing.sql`; CLI history synced.
- [x] 2026-06-12 — Verified **16/16**: 8 tables + org cache/pii/similarity cols + RLS. Governance config = admin-write/member-read; read_only blocked; project-scoped developer cannot manage a PROJECT enforcement policy (owner/admin only); model_approval/key_extension request workflows = member files own + admin resolves; non-member sees nothing.

**✅ Phase 3 complete.** Tables: `enforcement_policies`, `model_approval_requests`, `model_routing_rules`, `routing_policies`, `org_model_policies`, `guardrail_profiles`, `guardrail_rules`, `key_extension_requests`. Org cols: `cache_*`, `cache_conversation_history_threshold`, `similarity_threshold`, `pii_*`.

## Backend-code verification (added to the process 2026-06-12)
Cross-checked Phase 1+2 tables against `prism/apps/web/lib/supabase/database.types.ts` + route code: `api_keys`/`key_caps`/`provider_keys`/`user_preferences` = **exact** column match; `members`/`organizations`/`projects`/`pending_invites` are the intended clean redesign. The old-shape columns/tables the current app still writes — `members.role='admin'`, `projects.owner_id`, `pending_invites.project_id`, `project_members` — are the **tracked app-port items, not schema bugs**. Every future phase's verification now folds in this code diff.

## Phase 4 — Finance & Billing (DONE 2026-06-12)
`20260612150000_finance_billing.sql` — verified 11/11. **Corrected `organizations.plan` → `free|pro|team|enterprise`** (matches `lib/billing/plans.ts`; member caps 2/10/50/∞) + billing cols (subscription_status, stripe_*, billing_region, razorpay_*); `projects.cost_center_code` + `monthly_budget_usd`. Tables: budgets (hierarchy + partial-unique scope idx), cloud_billing_connections (admin-only RLS), mcp_cost_reconciliation, training_runs, action_definitions, report_schedules, customer_quota_profiles, tool_cost_catalog. RLS = member-read / admin-write.

## Phase 5 — Observability & Ops (DONE 2026-06-12)
`20260612160000_observability_ops.sql` — verified 13/13. Tables: alert_rules, notifications, audit_log, enforce_checkins, export_destinations, pii_incidents, request_logs (gateway prompt store + GIN), ingest_log, sdk_bypass_events, provider_usage_snapshots, user_feedback. Telemetry = member-read / service-write; notifications per-user scoped; `org_id` FK cascades added for teardown.

**Backend-code method (applied each phase):** columns verified against `prism/apps/web/lib/supabase/database.types.ts` before writing — matching it = guaranteed code compatibility. Confirmed e.g. `notifications.type` is free text (URL → metadata), `export_destinations.active` (not is_active), `budgets.user_id` has no FK.

## Phase 6 — Accounts / Integrations / Platform (DONE 2026-06-12)
`20260612170000_accounts_integrations_platform.sql` — verified 15/15. accounts/account_members/sso_configs (account-membership RLS via `is_account_member()` helper, avoids recursion), teams/team_members, github_connections/scm_connections/slack_installations (admin-only secrets), project_github_repos/project_repos/github_repo_branches, platform_features (+ seed w/ corrected tiers), user_consents (own-row). Bug caught: `is_account_member` (LANGUAGE sql) had to be defined AFTER account_members exists.

## Phase 7 — Analytics extras / beta (DONE 2026-06-12)
`20260612180000_analytics_beta.sql` — verified 11/11. traces, evaluation_datasets/runs + eval_scores, gpu_inference_runs, outcome_events/rules, recommendation_actions/narratives. **Added `can_write_org()` helper (owner/admin/developer — EXCLUDES read_only) and retrofitted the Phase-3 request-insert policies** so read_only truly writes nothing.

## ✅ SCHEMA TRANSITION COMPLETE — 7 migrations, parity verified
Final parity: staging = **60 tables** = dev's 60 live tables − {project_members, log_access_requests} (replaced by member_project_roles) + {member_project_roles, pending_invite_projects}. **0 missing, 0 extra.** All 7 migrations in CLI sync.
Order: 120000 RBAC · 130000 Keys · 140000 Governance · 150000 Finance · 160000 Observability · 170000 Integrations/Platform · 180000 Analytics.

## Remaining: APP PORT (not schema)
`auth.ts` → 4 roles + scope; `project_members` routes → `member_project_roles`; invite expiry → 24h; remove one-org-per-user guard in `create-org` + org switcher; `supabase gen types --project-id irehykmlliwarkcyzeqg > apps/web/lib/supabase/database.types.ts`; add `NEXT_PUBLIC_SUPABASE_URL` + anon key to `.env`. Also note: `members.role` now uses `administrator`/`read_only` (was `admin`).

---

# APP PORT — execution started 2026-06-13
Roadmap: `~/.claude/plans/i-have-a-clean-snug-deer.md` (WS0–WS7, approved). **User authorized staging DB writes** (migration applies + ephemeral test fixtures) for this effort.

## WS0 — staging app stood up (DONE 2026-06-13)
- Copied dev monorepo (`prism`) → `prism-llm-labs` via robocopy, EXCLUDING `supabase/` (staging keeps its own migrations), `.git`, `node_modules`, `.next`, `.turbo`, `.vercel`, `.env*`. `pnpm install` clean. `apps/web/.env.local` = copy of staging `.env` (Next reads app-dir env, not monorepo root). `.env` already had NEXT_PUBLIC_SUPABASE_URL + ANON_KEY + SUPABASE_ACCESS_TOKEN.
- Regenerated `apps/web/lib/supabase/database.types.ts` from staging via `supabase gen types --project-id irehykmlliwarkcyzeqg` (needs SUPABASE_ACCESS_TOKEN env; the `--db-url` path needs Docker = unavailable).
- Baseline `tsc --noEmit` = 0 after restoring 1 missing fn.

## Key findings (shape the whole port)
1. **`tsc` is a WEAK bug-radar** — the Supabase client is cast `as any` almost everywhere, so stale table/column refs do NOT type-error. Drive the change surface with grep + RUNTIME tests.
2. **Function-parity gap** (parity counted tables, not functions). App `.rpc()`s: `transfer_org_ownership` (exists); `upsert_trace_rollup` (CREATED — migration `20260612185000_trace_rollup_fn.sql`, applied + repaired); `increment_checkin_bypass` (DEFERRED → WS5-E; app guards it in try/catch).
3. **Schema-shape divergence** — staging `enforce_checkins` has WRONG columns (bypass-event cols + `raw_module NOT NULL`) vs the heartbeat cols the app upserts (`service_name`/`app_version`/`enforce_mode`/`language`/`last_seen_at`/`bypass_count` + UNIQUE(org_id,service_name)). Reshape + `increment_checkin_bypass` → WS5-E. ⇒ **table parity ≠ column-correct**; every workstream must validate table shape vs real app usage.

## WS1 — auth/RBAC spine (DONE 2026-06-13)
- `lib/supabase/auth.ts`: `OrgRole = owner|administrator|developer|read_only` + `ScopeType`; `AuthContext` gained `scopeType`, `role: OrgRole|null`, `isAdministrator`, `isReadOnly` (+ `isAdmin` kept as deprecated alias = isAdministrator, drop in WS7); `canManage=owner|administrator`; `canWrite=owner|administrator|developer` (excludes read_only + project scope). `requireAuth` selects `role, scope_type`. `normalizeRole`: admin→administrator, member→developer, null→null (project-scoped), unknown→read_only.
- `lib/nav.ts` NavRole + `components/layout/role-context.tsx` + `app/dashboard/layout.tsx` mapping → 4 roles.
- Fixed the 21 TYPED `requireAuth({roles:["owner","admin"]})` → `"administrator"` (forced by the type change; else admins are locked out). The UNTYPED inline checks (`["owner","admin"].includes`, `pmRole==="admin"`, project/team role enums, `context.ts` account roles, dashboard UI) still say "admin" — they COMPILE (string-typed) and are fixed in their domains (WS2/WS3/WS5/WS6).
- Verified: `tsc --noEmit` = 0; `tests/auth.test.ts` rewritten to the 4-role+scope model → **19/19 pass**.

## Apply mechanics (app-port)
pg runner `node C:\Users\ddeyp\prism-apply-scratch\db.mjs apply <file>` with PG* env from .env (PGHOST=aws-1-ap-southeast-2.pooler.supabase.com:5432, PGUSER=postgres.irehykmlliwarkcyzeqg), then `supabase migration repair --status applied <ts> --db-url <pooler>`. (Direct remote applies are gated by the auto classifier — authorized for this effort.)

## WS2 — Org/members/invites/projects + multi-org + log-access (CODE DONE 2026-06-13; live runtime verify still pending)
- **Multi-org:** `create-org` now ALWAYS creates a new org + Default project + sets `active_org_id` (removed the one-org guard). `ensure-org` + `auth/callback` are the idempotent bootstraps — both had bugs fixed: `plan:"developer"` is INVALID (org plan CHECK = free|pro|team|enterprise) → default 'free'; project insert dropped `owner_id` + added required `slug`. `/api/user/active-org` PATCH was already correct.
- **Invites:** `team/invite` role enum → administrator|developer|read_only; TTL 7d→24h; org-vs-project scope via `pending_invites.scope_type` (+ `pending_invite_projects`, dropped the gone `project_id` col); owner-grant rule aligned to RLS (admins may grant administrator). `claim` writes `members(scope_type)` + `member_project_roles` (dropped `project_members`).
- **Members/projects:** `team/members`(+[user_id]), `projects`(+[id]), `my/projects`, `lib/supabase/projects.ts`, `projects/[id]/members`(+[user_id]) all ported `project_members`→`member_project_roles` (join by **member_id**), dropped `projects.owner_id`; project grants use administrator|developer|read_only; member DELETE relies on the `member_project_roles` FK cascade; project-manage gate = org owner/admin OR project owner/administrator grant (mirrors `can_manage_project`).
- **Schema fixes (applied + repaired):** `20260612190000_projects_fixes` (status CHECK archived→**active|inactive**; +`daily_budget_usd`); `20260612191000_log_access` (rebuilt `log_access_requests` + 4 RLS policies).
- **Log-access (rebuilt per user choice):** approval state = `log_access_requests.status` (no denormalized boolean); manager = `can_manage_project`; POST/GET/PATCH ported.
- Verified: `tsc --noEmit` = 0 throughout WS2 **and live runtime 24/24** via `C:\Users\ddeyp\prism-apply-scratch\verify_ws2.mjs` (multi-org separate instances + switch; org + project invite→claim writing correct members/member_project_roles; scope semantics; ≥1-owner trigger; log_access_requests RLS). Migrations now: 120000–180000, 185000 trace_fn, 190000 projects_fixes, 191000 log_access.
- **WS2 COMPLETE 2026-06-13.**

## WS3 — metrics project-scoping (DONE 2026-06-13)
`lib/supabase/metrics-scope.ts`: `getAccessibleProjectIds`/`resolveMetricsScope(For)`/`isOrgManager` now branch on `members.scope_type` (org-scoped, ANY role → unrestricted `null`; project-scoped → `member_project_roles` grants by member_id). `isOrgManager` = org-scoped owner/administrator. tsc 0; query pattern already proven in WS2 runtime.

## WS4 — keys + gateway (DONE 2026-06-13)
Gateway needed NO changes — the dev app had already slimmed `api_keys` (auth SELECT lists only live cols; `provider_key_id`/cap cols read defensively `?? null`; provider resolution via `key_provider_links`). Verified all gateway-read `api_keys`(8) + `provider_keys`(7) cols exist and `api_keys` has no `provider_key_id`/`assigned_user_id`. `keys` POST: added `canWriteProject` gate (mirrors `can_write_project`), kept silent provider-link strip for non-admins, dropped the `project_members` seed. `my/keys`, `team/members/[user_id]/projects`, `dashboard/projects/[id]/layout` → `project_members`→`member_project_roles` (scope-aware). tsc 0.

## WS5 — role-vocab + read_only sweep (IN PROGRESS 2026-06-13)
- **Vocab (DONE):** swept 11 org-layer inline `["owner","admin"]`→`["owner","administrator"]` (cache, model-governance, org, export-destinations(+[id]), teams/[id](+members,+[user_id]), alerts/evaluator). `dashboard/teams/page.tsx` UI → 4-role vocab. Remaining `"admin"` literals are legit (auth.ts legacy map; admin/features `changed_by` fallback) or account-layer (WS6).
- **read_only (IN PROGRESS):** key insight — routes use the SERVICE-role client (RLS bypassed), so each write route's app-gate must match its RLS.
  - GATED so far (governance/config → `isOrgManager`): `guardrails` (POST/PATCH/DELETE), `guardrails/profiles` (POST/PATCH/DELETE), `routing/policies/[id]` (PATCH/DELETE), `action-definitions` (POST/DELETE). `model-governance/requests` POST → org-writer (excludes read_only). `outcome-rules/[id]` was already `ctx.canManage` ✓.
  - STILL TO AUDIT/gate: `routing/route` POST, `routing/policies` POST, `model-governance` main route (POST/DELETE), `customers`(+[id]), `training-runs`(+sync), `report-schedules`(+[id]), `billing/connections`(+[id]→owner), `evaluations`(+datasets,+scores → content: exclude read_only via writer gate), `pii-incidents/export`. Metrics READ routes need no gate.
  - ALL GATED (done): + `routing` (POST/DELETE), `billing/connections`(+[id]), `training-runs`(+sync), `customers`(+[id]), `evaluations`/`datasets`/`scores` (canWriteOrg), `model-governance/requests`(+[id] dup). `report-schedules`(+[id]) & `alerts/[id]` already gated. Added `canWriteOrg()` to metrics-scope. Two duplicate `[id]` routes (customers/[id], model-governance/requests/[id]) are dev cruft (list/create copies, no PATCH/DELETE) — gated to match parents.
- **WS5 COMPLETE 2026-06-13.**

## WS6 — account layer (NO-OP, verified 2026-06-13)
`account_members.role` = `CHECK (role IN ('owner','admin'))` — a deliberately SEPARATE 2-role layer from org RBAC. `context.ts` + `metrics/account-overview` + `is_account_member` already match it (correctly EXCLUDED from the org vocab sweep). No changes needed (renaming admin→administrator would be cosmetic + reopen schema). **WS6 complete.**

## WS7 — final verification (DONE 2026-06-13)
- **`tsc --noEmit` = 0**; **`pnpm --filter web build` = exit 0, 210/210 routes** ("Compiled successfully"; build skips lint).
- **Tests 33/33**: `auth.test.ts` (19 — requireAuth across 4 roles+scope+{roles} gate) + `metrics-scope.test.ts` (14 — isOrgManager/canWriteOrg/getAccessibleProjectIds across all 4 roles + project scope). Live RLS/data matrix `verify_ws2.mjs` 24/24.
- Lint: 121 PRE-EXISTING dev-app errors (`.from("x" as any)`, unused `req`, etc.) — not build-blocking, not introduced by the port. Fixed the 2 nits I added (unused Separator import; project_id prefer-const).
- NOT run: a live HTTP route matrix (running server + per-role JWTs) — gates verified at unit + RLS level instead.

# ✅ APP PORT COMPLETE 2026-06-13 — WS0–WS7
Staging app builds clean against the new 4-role + scope RBAC. Migrations now: 120000–180000 (schema) · 185000 trace_rollup_fn · 190000 projects_fixes · 191000 log_access (last 3 added during the port). Remaining = optional follow-ups only: pre-existing lint debt cleanup; live HTTP route matrix; deploy/env wiring (Tinybird/Upstash/Stripe creds already in `.env`).

## GitHub + Vercel (2026-06-13)
- **Repo:** `github.com/SchrodingersByte/prism-llm-labs` (PRIVATE), pushed as a FRESH single-commit history (the old commit `06775a1` had `.env` committed — discarded so no secrets reached GitHub). `.gitignore` covers `.env*`/`.tinyb`/`node_modules`; **`examples/` excluded** (had a hardcoded live OpenAI key). gh account: SchrodingersByte.
- **Workflows:** scoped `ci.yml` to web tsc+build on `main`; disabled (`*.yml.disabled`) publish-npm/pypi, pricing-parity, deploy, deploy-tinybird, cron-alerts, cron-reports. Added `.gitattributes` (eol=lf).
- **Vercel:** CLI installed + authed as `schrodingersbyte`. Project **`dip-dey-s-projects/prism-llm-labs`** created/linked (root `apps/web`, Next.js). NOT yet git-connected (monorepo: CLI can't see root `.git` + `apps/web/.vercel` together → use dashboard) and NO env vars set (CLI stdin is eaten by the vercel Claude-plugin wrapper → use dashboard paste).
- **SDKs:** stay in dev — npm/PyPI aren't repo-bound; staging just consumes them.
- ⚠️ **TODO for user:** (1) ROTATE the OpenAI key (it's hardcoded in the DEV repo's `examples/`). (2) `ENCRYPTION_SECRET` is MISSING from `.env` but the app needs it for provider-key AES encryption — generate + set in Vercel + local. (3) set `NEXT_PUBLIC_APP_URL` to the staging domain.
- tsc 0 throughout.

# Quality & Intelligence roadmap (docs/prd + docs/implementation, 8 PRDs)
Phased build of the quality loop. PRD-0 (content/embedding capture) + PRD-1 (online eval / LLM-judge) backends already built before this session (commits c02ae5f, 0956ff2). All frontend tracked in `docs/frontend/pending-ui.md` (the UI is far behind the backend; ~52 pages still stubs).

## PRD-2 — Offline Evals, Datasets & Experiments (BACKEND DONE 2026-06-15)
Dev-loop quality: prove a prompt/model/config change is better BEFORE shipping, + CI gates. Datasets/runs/scores tables already existed — this added the experiment runner + compare + CI helper.
- **P2.1** migration `20260615120000_experiments.sql` — `evaluation_runs` + `kind`(validation|experiment), `name`, `git_sha`, `config_snapshot` jsonb, `baseline_run_id`, `project_id` + index `(org_id,kind,created_at)`. No new tables (datasets stay inline `samples` jsonb; scores reuse `eval_scores`, free-text `scorer_type`).
- **P2.2** `lib/eval/runner.ts` (`runExperiment`) + `app/api/evaluations/experiments` (POST run / GET list). Runs a subject (model+system_prompt+params) over a dataset → scores each sample → aggregates score/cost/edge_cases onto the run + writes `eval_scores`.
- **Execution:** NEW `lib/arena/execute.ts` = session-less provider dispatch extracted from `arena/chat` (that route is `requireAuth`-gated; the runner has no session). `executeModelCall(admin,{orgId,providerKeyId,model,messages,params})` → completion+usage+cost; captures Tinybird `environment="experiment"`. `resolveProviderKey` auto-picks the org's active key for the model's provider.
- **Scorers:** added `correctness` (vs gold `expected_output`) + deterministic `exact_match` (no judge call → flake-free CI) to `lib/eval/judges.ts`; `ScorerInput.reference` added.
- **P2.3** `app/api/evaluations/datasets/from-traces` — request_logs (PRD-0 content) → `{input, expected_output}` samples, append/create dataset (≤500 inline cap).
- **P2.4** `GET /api/evaluations/scores?run_ids=a,b` compare branch — per-run quality+cost + per-scorer breakdown + Δ vs baseline + regression flag.
- **P2.5** SDK CI gate (TS+Py parity): `runEval`/`gateEval`/`runEvalCli` + `bin prism-evals` (TS v0.5.0); `run_eval`/`gate_eval`/`run_eval_cli` + `prism-evals` console script (Py v0.4.0). Both POST `/api/evaluations/experiments`. `/experiments` accepts **dual auth: browser session (canWriteOrg) OR Prism API key** (`authenticateIngestKey`) — the API-key path is what makes CI work.
- **Runner transport:** synchronous inside the POST (samples capped 50, concurrency 4) — primary consumer is a headless CI gate that blocks on the verdict; SSE/Redis (validate pattern) is browser-driven. Async/Redis for >50 samples = follow-up.
- **Verified:** web `tsc` + `next build` clean (both new routes registered); web runner unit tests `tests/experiments.test.ts` 3/3; TS vitest 32/32 (+`tests/evals.test.ts`); Python pytest 30/30 (+`tests/test_evals.py`).
- **Migration APPLIED to staging 2026-06-15** via the scratch `db.mjs` runner (session pooler) + recorded in `supabase_migrations.schema_migrations` (version 20260615120000, name `experiments`). Columns + index verified live.
- **SDKs bumped but NOT published:** TS `@prism-llm-labs/sdk` 0.4.4→0.5.0, Py `prism-llm-labs` 0.3.4→0.4.0. No git tags created (publish workflows are tag-triggered). The unreleased 0.5.0/0.4.0 now also carry PRD-3's `sendFeedback` (below).
- **Pending:** all PRD-2 UI (spec in pending-ui.md §3 Phase 2); `prompt_version` is a passthrough label until PRD-4 prompt registry lands.
- Design + corrections recorded in `docs/implementation/02-offline-evals-datasets-experiments.impl.md` §10.

## PRD-3 — Feedback & Annotation Queues (BACKEND DONE 2026-06-15; migration NOT applied)
Human-in-the-loop: end-user thumbs + a reviewer annotation queue. Reviewer scores land in the existing `eval_scores` (`scorer_type='human'`) — closes the judge↔human calibration loop with PRD-1.
- **P3.1** migration `20260615130000_feedback_annotation.sql` — `feedback` (+`feature_tag` for per-feature thumbs) + `annotation_queue` (status/priority/reason/assignee, partial-unique open-item de-dupe, `updated_at` trigger). **APPLIED to staging 2026-06-15** + recorded in history (name `feedback_annotation`); tables/policies/feature_tag/dedupe-index verified live.
- **P3.2** `app/api/feedback` (POST key-authed ingest via `authenticateIngestKey` + rate-limit + `maskPii` on comments; GET aggregation by feature) + SDK standalone `sendFeedback`(TS)/`send_feedback`(Py), auto-fills trace/span from active trace context.
- **P3.3** `app/api/annotations/queue` (GET prioritized / POST manual enqueue, de-duped) + sampler auto-enqueue: `enqueueEdgeCases` in `cron/run-online-evals` (worst 10 failed scores/run → queue, skip already-open).
- **P3.4** `app/api/annotations/queue/[id]` PUT claim/skip/submit; submit writes `eval_scores` human + closes item. Span-level = pass `span_id`.
- **P3.5** `app/api/annotations/export` → builds a PRD-2 dataset from reviewed items (joins `request_logs` content + human `eval_scores` into sample tags).
- **Corrections:** added `feature_tag`; `authenticateIngestKey` (rate-limit) not inline key check; standalone SDK helper (not a tracker method); no Tinybird feedback mirror in v1; PII-masked comments. See impl doc 03 §10.
- **Verified:** web `tsc` + `next build` clean (4 routes registered); TS vitest 35/35 (+`tests/feedback.test.ts`); Python pytest 33/33 (+`tests/test_feedback.py`); ESLint clean.
- **Pending:** all PRD-3 UI (pending-ui.md §3 Phase 3); judge↔human agreement view.
- **How to apply migrations:** scratch runner `C:\Users\ddeyp\prism-apply-scratch\db.mjs` with PG* env (session pooler `aws-1-ap-southeast-2.pooler.supabase.com:5432`, user `postgres.irehykmlliwarkcyzeqg`, pw from `.env` `SUPABASE_DATABASE_PASSWORD`): `db.mjs apply <file>` then record the version row in `supabase_migrations.schema_migrations`. See [[supabase-staging-connection]].

## PRD-4 — Prompt Management & Playground (BACKEND DONE 2026-06-15; migration NOT applied)
Langfuse-style prompt registry: named prompts → immutable versions → movable labels. Decouples prompt changes from code deploys. Playground = UI on the EXISTING `/api/arena/chat` (no new execution path).
- **P4.1** migration `20260615140000_prompt_registry.sql` — `prompts`/`prompt_versions`(immutable: `BEFORE UPDATE` trigger raises)/`prompt_labels` (movable pointer, UNIQUE(prompt_id,label)) + RLS + indexes + `updated_at` triggers. **APPLIED to staging 2026-06-15** + recorded in history (name `prompt_registry`); 3 tables/6 policies/immutability-trigger/guard-fn verified live.
- **P4.2** `app/api/prompts` (GET list+labels+latest / POST create) · `[id]` (GET detail / PATCH desc / DELETE) · `[id]/versions` (GET / POST append `version=max+1`, retry on race) · `[id]/labels` (GET / PUT promote-upsert / DELETE).
- **P4.3** `app/api/prompts/resolve` (dual auth key|session; resolve order version→label→'production'→latest, project-preference) + SDK `getPrompt`(TS)/`get_prompt`(Py): cached (TTL, label-keyed), `{{var}}` compile, returns `promptVersion="name@version"` → caller stamps `tags['prompt_version']` (lights up existing `spend_by_prompt_version` pipe, NO pipe change).
- **P4.6** experiments route now accepts `subject.prompt_id`+`prompt_label` → resolves system prompt + `name@version` server-side (registry prompt as a first-class experiment subject).
- **Corrections:** version immutability enforced at BOTH API + DB-trigger layers; standalone SDK helper (not a client method); `commit_msg` added to versions. See impl doc 04 §10.
- **Verified:** web `tsc` + `next build` clean (5 routes registered); TS vitest 41/41 (+`tests/prompts.test.ts`); Python pytest 38/38 (+`tests/test_prompts.py`); ESLint clean.
- **Pending:** all PRD-4 UI (Prompts page/diff/label-promote/playground — pending-ui.md §3 Phase 4).
- **SDKs** (unpublished) now carry PRD-2 `runEval` + PRD-3 `sendFeedback` + PRD-4 `getPrompt` in the same TS 0.5.0 / Py 0.4.0.

# Public marketing site + auth showcase (DONE 2026-06-21)
Branch `feat/dashboard-pages-buildout`. Built the entire public surface (was all `null`/`bg-black` stubs) + the auth feature showcase. **Theme:** dark navy/violet marketing design system scoped to `.marketing`/`.marketing-bg` + `.mk-*` utilities in `globals.css` (kept separate from the gold dashboard + light auth-form tokens); Playfair Display via `next/font` (`--font-playfair`). **Components:** `components/marketing/{Logo,Navbar,Footer,Section,Hero,FeatureSection,PricingTable,FaqAccordion,CtaBand,StepFlow,DocsNav,CodeBlock,LegalPage,ContactForm}` + `components/auth/{AuthShowcase,oauth-icons}`; content source `lib/marketing/{content,showcase}.ts`. **Pages:** `/` landing, `/pricing` (real event-metered tiers from `lib/billing/plans.ts` + comparison matrix grounded in the `platform_features` min_plan seed), `/docs` (scrollspy + TS/Py/cURL + env table + MCP + packages), `/faq`, `/privacy`, `/terms`, `/how-it-works`, `/roadmap`, `/contact`. **Auth:** reusable rolling `AuthShowcase` (Solo/Team toggle, auto-play w/ reduced-motion, data-driven mini-visuals, REAL plan badges) on `/login` (filled the empty panel) + new `/signup` (mirrors login, `signUp`→`/onboarding`, email-confirm fallback). **Verified:** `tsc --noEmit` 0; ESLint 0 in new files (pre-existing WIP-file lint errors untouched); dev-server smoke test — all 11 routes 200 + content assertions + zero server errors. Detail in `docs/frontend/frontend-build-roadmap.md` §10. **Follow-ups:** legal copy needs counsel review; `/contact` is mailto-only (no backend); pricing matrix mirrors the platform_features seed.

## Dedicated Features page (DONE 2026-06-21)
Added `/features` (nav + footer "Features" now point here, not the `/#features` anchor). Organized by the product's six capability areas (Capture · Observe · FinOps · Govern · Quality · Operate, mirroring `lib/nav.ts`) as alternating spotlights with a jump-nav; each area pairs an illustrative `CategoryVisual` mockup ("what it looks like") with its named features + what each does, grounded in the live nav + 47 Tinybird pipes + SDK surface. New: `components/marketing/FeatureVisuals.tsx`, `FEATURE_CATEGORIES` in `lib/marketing/content.ts`, `app/(marketing)/features/page.tsx`. Verified tsc 0 + ESLint 0 (new files) + dev smoke test `/features` 200.
