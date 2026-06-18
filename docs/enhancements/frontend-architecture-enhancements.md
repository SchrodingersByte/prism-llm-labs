# Frontend Architecture Enhancements

> **Purpose.** Architectural clarifications and decisions that feed
> [`docs/frontend/frontend-build-roadmap.md`](../frontend/frontend-build-roadmap.md). This is **not** a
> build plan — each entry records the *current code-grounded state*, the *decision/change*, the *rationale*,
> any *open decision*, and the *frontend/roadmap impact*. New architecture decisions that affect the UI go
> here first, then the roadmap references them.
>
> **Status:** ✅ settled (already true in code) · 🟡 decision needed · 🔵 proposed addition.

---

## ENH-01 — Unified Prism API key (analytics ⇄ gateway are one key)  ✅ + 🔵

**Current state (code-grounded).** There is **no `key_type` discriminator** on `api_keys`
([keys_gateway_core.sql:16-33](../../supabase/migrations/20260612130000_keys_gateway_core.sql)) — one table,
one creation endpoint (`POST /api/keys`). A key's "kind" is **derived, not chosen at creation**:
- **No provider link → analytics key** (SDK-wrapper mode): the SDK wraps the client in-process using the
  developer's *own* provider credentials, captures the response, and ships telemetry to Tinybird. Prism
  never holds the provider secret.
- **Linked to a provider key via `key_provider_links` → gateway key**: calls route through
  `/api/gateway/[provider]/…`; Prism authenticates the Prism key, uses the org's *stored encrypted* provider
  key, and enforces control-plane policies.

Linking provider keys is **owner/administrator-only** — [keys/route.ts:123-126](../../apps/web/app/api/keys/route.ts)
strips provider links for non-admins, so they always get an analytics key. Runtime mode is *also* influenced
by the SDK's `PRISM_GATEWAY_URL` (auto-enables the gateway path) and the org's `gateway_mode`
(`sdk_optional` default vs `gateway_required`, [keys_gateway_core.sql:10-13](../../supabase/migrations/20260612130000_keys_gateway_core.sql);
enforced at [gateway route:356](../../apps/web/app/api/gateway/[provider]/[[...path]]/route.ts)). Separate e2e
suites exist (`test_analytics_mode.py`, `test_gateway_mode.py`). Note `request_logs.key_type` defaults to
`'gateway'` ([observability_ops.sql:116](../../supabase/migrations/20260612160000_observability_ops.sql)) —
that records *how a logged call arrived*, it is **not** a type on the key.

**Decision.** One key, two **modes**. The UI presents a **single key-creation flow**; "analytics vs gateway"
is a **derived badge** on a key (does it have `key_provider_links`?), never a creation-time radio.

**Rationale.** Matches the schema; the provider-key link is the real capability switch (it's what lets the
gateway proxy with org secrets and enforce caps/routing/governance).

**Open items.** 🔵 Optionally surface the org `gateway_mode` (`sdk_optional` / `gateway_required`) toggle in
org settings, and show each key's *effective mode* + which provider keys it's linked to.

**Frontend / roadmap impact.**
- Key-creation = one wizard; the "link provider key(s)" step is **admin-only** and is what flips a key to
  gateway mode (and unlocks per-key caps enforcement, routing, governance).
- Key list/detail shows a **derived mode badge** (Analytics / Gateway) + linked provider keys + caps.
- The **observability-only onboarding path** (ENH-03) creates an analytics key and skips provider keys.

---

## ENH-02 — GitHub / SCM connection scoping (org token + project repo binding)  🟡

**Current state (code-grounded).** ([accounts_integrations_platform.sql:73-133](../../supabase/migrations/20260612170000_accounts_integrations_platform.sql))
- `github_connections` (and the newer generic `scm_connections`) are **org-level** — `org_id` + the connecting
  `user_id` + the OAuth `access_token`. RLS is **`is_org_admin(org_id)`** (admin-managed).
- `project_github_repos` is a junction that binds **specific repos → a `project_id`** (RLS allows project
  writers, `pgr_write`). **So the repo↔project mapping already exists and is project-scoped.**
- `github_repo_branches` (per repo) feeds `spend_by_branch` / `spend_by_branch_developer` and
  `/api/metrics/branch-developers`.

**The question.** *Should the connection (token) itself be project-based, so each project admin connects their
own GitHub and attaches repos to that project?*

**Analysis.** A GitHub OAuth/App token authenticates a **GitHub account/org**, which does not map 1:1 to a
Prism project — one token can serve many projects, and one Prism org may span multiple GitHub orgs. Forcing
"one connection per project" duplicates installs/tokens for the same GitHub account.

**Recommendation (hybrid, minimal schema change).** Keep the **token as a reusable org resource**, but:
1. Allow **multiple connections per org** (already supported — no uniqueness blocks it).
2. Let **project admins initiate** a connect and **bind repos** from **project Settings** (the "connect repos
   to this project" the user wants — `project_github_repos` already supports it).
3. **Relax connection RLS** so a project owner/administrator (not just org admin) can create a connection.

**Open decision.** 🟡 **Project-scoped token isolation?** If project admins must *never* share a token, add
`project_id` to `github_connections` / `scm_connections` (+ RLS change). **Default recommendation: no** — keep
the org-level token, scope at the repo-binding level. Decide before building the integration screens.

**Frontend / roadmap impact.**
- GitHub/SCM appears in **two** places: **org Settings → Integrations** (manage connections/tokens) **and**
  **project Settings** (bind repos → project, branch attribution).
- Branch-attribution dashboards (`spend_by_branch*`, `/api/metrics/branch-developers`) depend on a project
  having bound repos — empty-state until repos are connected.

---

## ENH-03 — Observability-only mode: what it tracks, its capabilities, and onboarding  🔵

**Definition.** Observability-only = `gateway_mode='sdk_optional'` + **analytics keys** (no provider linking) —
the SDK-wrapper / OTEL ingest path. Prism *observes*; it does not intermediate the LLM call.

**What it tracks.**

| Source | Captured |
|---|---|
| `llm_events` (Tinybird) | cost, all token types, latency, **TTFT**, status, provider/model/env, **trace/span/session ids**, **tags** (feature, action, cost_center, customer, branch, developer, prompt_version, workload), cache hit |
| `mcp_tool_events` (Tinybird) | MCP tool/server cost, latency, errors, `primitive_type`, `downstream_resource` (vector DB) |
| OTEL `/api/otel/v1/traces` | LLM spans → `llm_events`; **non-LLM spans** (retrieval / tool / chain / custom) → `spans` (PRD-6 waterfall) |
| `outcome_events` | business success + `value_usd` → ROI / cost-per-outcome |
| `request_logs` (Supabase, **opt-in**) | prompt / completion / context / tool-IO, PII-redacted; `source ∈ gateway\|sdk\|otel` ([content_capture.sql:22-23](../../supabase/migrations/20260614120000_content_capture.sql)) → quality evals, drift, payload viewer |
| `content_embeddings`, `eval_scores` | embeddings (drift/clustering) + quality scoring — run on captured content, gateway-independent |
| `enforce_checkins` / `sdk_bypass_events` | shadow-IT / SDK-coverage detection |

**Capabilities you get (read + intelligence — the whole portal):** full FinOps / cost + attribution
(project/team/feature/action/cost-center/customer/branch/developer/key), sessions + deep traces (incl. OTEL
non-LLM spans), MCP/agent analytics + loop detection, unit economics / outcomes, anomaly detection + alerts,
and — with content-capture opt-in — **quality evals, drift, annotations/feedback, error clustering, and
Copilot**, plus recommendations.

**What it CANNOT do (requires the gateway / control plane — gateway keys + provider keys + `gateway_required`):**
*inline enforcement* — spend-cap **blocking**, model **governance/allowlist + approvals**, **data-residency**
enforcement, **guardrails block/redact** (observability mode only *detects/flags* PII → `pii_incidents`),
**model routing/fallback**, **caching**, **soft-cap model downgrade**, and **provider-key proxying**. In short:
**observability mode alerts; the gateway blocks/routes/redacts.**

**Frontend / roadmap impact.**
- Most analytics + quality pages **must render in observability-only mode** (no provider keys present) — design
  their empty/first-run states accordingly (many start empty until capture/crons run).
- **Control-plane pages** (provider keys, routing, governance *enforcement*, guardrail block/redact, soft-caps)
  need a clear **"requires gateway mode"** empty-state / gate.
- Onboarding offers an explicit **observability-only path** (create an analytics key + install the SDK, skip
  provider keys) alongside the full gateway path.
- 🔵 A small **mode/capability matrix** surface (what's on in observability vs gateway) helps users understand
  what enabling the gateway unlocks.

---

## Roadmap hooks (where these land in `frontend-build-roadmap.md`)
- **ENH-01** → key-creation flow (one wizard + derived mode badge) under Settings → Access / API Keys; org
  `gateway_mode` toggle under org settings.
- **ENH-02** → GitHub/SCM split: org Settings → Integrations (connections) + project Settings (repo binding);
  resolve the 🟡 token-scoping decision before building.
- **ENH-03** → observability-only onboarding path + "requires gateway mode" gating pattern + capability matrix;
  affects empty-states across analytics/quality pages.
