# PRD-4 — Prompt Management & Playground

> **Phase:** 2 (Dev loop) · **Status:** Draft for review · **Depends on:** standalone ·
> **Integrates with:** PRD-2 (prompt as experiment subject), PRD-1 (quality per version) ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Prism only **attributes** prompt versions after the fact — there is no **registry** (named prompts,
immutable versions, labels), no **playground**, and no **fetch-by-label SDK**. Prompt management is
core to Langfuse/LangSmith: it decouples prompt iteration from code deploys and connects prompts to
traces, evals, and experiments. We already have the attribution plumbing to make this light.

## 2. Current state (code anchors)
- `GET /api/metrics/prompt-versions`; `tinybird/pipes/spend_by_prompt_version.pipe`; the
  `prompt_version` tag on `llm_events`.
- `dashboard/workbench/arena` + `/api/arena/chat` — a base for the playground.
- **Missing:** prompt/version/label registry tables; SDK fetch-by-label; playground publish.

## 3. Competitive context
Langfuse: a prompt is *instructions + config*; **immutable versions**; **labels** (e.g. `production`)
as movable pointers; fetch by name+label with caching; A/B. LangSmith: Prompt Hub with commit-style
versioning + a live playground.
*Sources: [Langfuse prompt data model](https://langfuse.com/docs/prompt-management/data-model), [Langfuse prompt mgmt](https://langfuse.com/docs/prompt-management/overview).*

## 4. Goals / Non-goals
**Goals:** prompt registry (name → immutable versions → labels), playground (run vs models, compare),
fetch-by-label SDK with caching, link versions to traces/experiments/evals. **Non-goals:** the
experiment runner (PRD-2), online eval (PRD-1).

## 5. Division value
- **Product / Data Science** — iterate and A/B prompts safely with full history.
- **Engineering** — ship prompt changes **without a redeploy** (decouple prompts from code).

## 6. Functional requirements
- Create a prompt (name); add **immutable** versions (messages + config); **labels**
  (`production`/`staging`) pointing to a version.
- **Playground**: run a version against models with variables; compare outputs + cost + score.
- **SDK** `getPrompt(name, label)` with server + client cache.
- **Linkage**: set the existing `prompt_version` tag from the registry so spend/quality attribution
  flows automatically.

## 7. Data model
- **Supabase `prompts`**: `id, org_id, project_id, name (unique per project), description, created_by`.
- **Supabase `prompt_versions`**: `id, prompt_id, version int, content jsonb (messages), config jsonb,
  created_by, created_at` (immutable).
- **Supabase `prompt_labels`**: `prompt_id, label, version_id` (movable pointer).
- **Link key:** `prompt_version` tag on `llm_events` = resolved `name@version` → existing
  `spend_by_prompt_version` + attribution keep working unchanged.

## 8. API & SDK surface (TS + Python parity)
- `GET/POST/PUT/DELETE /api/prompts` + `/versions` + `/labels` (gated by `canWriteOrg`).
- SDK `getPrompt(name, { label })` with server + client cache (Langfuse-style; label-based
  invalidation).
- Playground runs via the existing `arena/chat`.

## 9. UX / dashboard pages
- **Prompts** page: list, version history, **diff**, label promote.
- **Playground**: extend `workbench/arena` — run a prompt vs models; compare outputs + cost + (PRD-1)
  score.

## 10. Phased task breakdown + acceptance criteria
- **P4.1 Registry model.** *AC:* prompt + immutable versions + labels persist.
- **P4.2 CRUD API.** *AC:* create/version/label via API (read_only blocked).
- **P4.3 SDK fetch + cache.** *AC:* `getPrompt(name,'production')` returns the labeled version, cached.
- **P4.4 Playground.** *AC:* run a version against 2 models, compare.
- **P4.5 Diff/version UI.** *AC:* visual diff between versions; promote a label.
- **P4.6 Link to experiments (PRD-2).** *AC:* a prompt version is selectable as an experiment subject.

## 11. Dependencies
Standalone. Integrates with **PRD-2** (prompt as experiment subject), **PRD-1** (quality per version),
and the existing `prompt_version` attribution.

## 12. Success metrics / KPIs
Prompts under management; % of LLM calls using managed prompts; deploys decoupled from prompt changes;
prompt A/B run count.

## 13. Risks & open questions
- **Cache staleness vs freshness** → label-based fetch + TTL + invalidate-on-promote.
- **Prompt sprawl** → naming conventions + ownership.
- **Secrets/PII in prompts** → redact on display (reuse PRD-0 masker).

## 14. Out of scope (code-analysis doc to follow)
SDK cache implementation, diff-UI spec, migration SQL — in the PRD-4 code-analysis doc.
