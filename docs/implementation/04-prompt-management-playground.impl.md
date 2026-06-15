# Code-Analysis / Implementation Design — PRD-4: Prompt Management & Playground

> **Implements:** [PRD-4](../prd/04-prompt-management-playground.md) · **Phase:** 2 (Dev loop) ·
> **Status:** Implementation design for review (no code yet) · **Critical-path position:** #4 ·
> **Depends on:** standalone; integrates with PRD-2 (experiments) + existing prompt attribution.

## 0. How to read this doc
Engineering design behind PRD-4. The **playground execution engine already exists** (`/api/arena/chat`),
so this is a registry (3 tables) + a thin SDK fetch + UI — not a new runtime.

---

## 1. Current-state analysis (corrected by code reading)
### 1.1 No registry — only hash-based attribution
- Grep `prompt_versions|prompts|prompt_labels` in migrations → **none**. The registry is net-new.
- The only "versioning" today is the **`system_prompt_hash`** tag auto-set by the SDK
  (`packages/typescript-sdk/src/tracker.ts:213`, via `hashSystemPrompt()` `:7`) and the
  **`prompt_version` tag** consumed by `app/api/metrics/prompt-versions/route.ts` +
  `tinybird/pipes/spend_by_prompt_version.pipe`.
- ⇒ The registry must **set `tags['prompt_version'] = <name>@<version>`** so existing spend/quality
  attribution keeps working with zero pipe changes.

### 1.2 The playground engine already exists
- `app/api/arena/chat/route.ts` — `requireAuth`, takes `{provider_key_id, model, messages, stream}`,
  decrypts the org's provider key, forwards to OpenAI/Anthropic/Azure/Google, streams SSE, and
  **captures usage → `llm_events`** (`environment:"arena"`, `tags:{source:"arena"}`) + trace rollup.
- ⇒ The playground is a **UI on top of `/api/arena/chat`**: resolve a registry prompt (+ variables) to
  `messages`, run it against one or more models, compare. **No new execution path.**

### 1.3 SDK has no prompt fetch
- `packages/typescript-sdk/src/types.ts` `PrismOptions` + `index.ts` client — no `getPrompt`. New
  surface (with caching), mirrored in Python.

---

## 2. Design summary
1. **Registry**: `prompts` → immutable `prompt_versions` → movable `prompt_labels` (Langfuse model).
2. **CRUD API** `/api/prompts` (+ versions/labels), `canWriteOrg` for writes.
3. **SDK `getPrompt(name, label)`** with server+client cache; resolves content and **stamps
   `tags['prompt_version'] = name@version`** so attribution flows.
4. **Playground** UI calls the existing `/api/arena/chat` (run vs models, compare + cost + PRD-1 score).
5. **Integrations**: a prompt version is selectable as a PRD-2 experiment subject; quality per version
   comes free via PRD-1 (scores carry `trace_id` and the `prompt_version` tag).

## 3. Data model & migrations
Migration `supabase/migrations/20260618090000_prompt_registry.sql`:
```sql
CREATE TABLE public.prompts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, name)
);
CREATE TABLE public.prompt_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id   uuid NOT NULL REFERENCES public.prompts(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version     int  NOT NULL,                      -- monotonic per prompt
  content     jsonb NOT NULL,                     -- messages array (role/content)
  config      jsonb NOT NULL DEFAULT '{}',        -- model defaults, temp, etc.
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, version)
);                                                -- rows are append-only (immutable)
CREATE TABLE public.prompt_labels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id   uuid NOT NULL REFERENCES public.prompts(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label       text NOT NULL,                      -- 'production' | 'staging' | ...
  version_id  uuid NOT NULL REFERENCES public.prompt_versions(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, label)                       -- a label points to exactly one version
);
ALTER TABLE public.prompts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_labels   ENABLE ROW LEVEL SECURITY;
-- read: any org member; write: can_write_org (read_only blocked)
CREATE POLICY pr_select  ON public.prompts         FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY pr_write   ON public.prompts         FOR ALL USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE POLICY pv_select  ON public.prompt_versions FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY pv_write   ON public.prompt_versions FOR ALL USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE POLICY pl_select  ON public.prompt_labels   FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY pl_write   ON public.prompt_labels   FOR ALL USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE INDEX idx_prompts_org    ON public.prompts(org_id);
CREATE INDEX idx_pv_prompt      ON public.prompt_versions(prompt_id, version DESC);
```
*Immutability of `prompt_versions` is enforced in the API layer (no UPDATE/DELETE route); optionally a
`BEFORE UPDATE` trigger that raises.*

## 4. Code changes (file-by-file)
### 4.1 Registry API — `app/api/prompts/route.ts` + `[id]/versions` + `[id]/labels` (new)
- `GET` list/detail (is_org_member); `POST` create prompt / append version / set label (`canWriteOrg`).
  "Append version" computes `version = max+1`. "Set label" upserts `prompt_labels`.

### 4.2 SDK — `getPrompt()` (TS + Python parity)
- TS `index.ts`/new `prompts.ts`: `getPrompt(name, { label = 'production' })` → `GET /api/prompts/
  resolve?name=&label=`; **cache** in-memory with TTL + label-based key (invalidate on label change).
  Returns `{ messages, config, version }`; caller spreads into the request and the wrapper stamps
  `tags['prompt_version'] = name@version`. Mirror in `_client.py`.

### 4.3 Playground — reuse `/api/arena/chat`
- New UI (extend `dashboard/workbench/arena`) that loads a prompt version, fills `{{variables}}`, and
  POSTs to `/api/arena/chat` for each selected model; shows outputs side by side + cost + (PRD-1) score.
- **No backend execution change** — arena/chat already proxies + captures.

### 4.4 Attribution linkage — no pipe change
- Because resolved calls carry `tags['prompt_version']`, `spend_by_prompt_version` +
  `/api/metrics/prompt-versions` light up automatically; PRD-1 scores inherit the tag via `trace_id`.

## 5. UX
- **Prompts** page (new `app/dashboard/prompts/page.tsx`): list, version history, **diff** between
  versions, **promote** a label.
- **Playground** (extend `workbench/arena`): run a version against models, compare.

## 6. Phased tasks → files (each gated by `tsc`/`build`)
- **P4.1** Registry migration + types. *AC:* tables + RLS; version append is monotonic.
- **P4.2** `/api/prompts` CRUD + label upsert. *AC:* create→version→label; `read_only` blocked.
- **P4.3** SDK `getPrompt` + cache (TS+Py). *AC:* `getPrompt(name,'production')` returns the labeled version; calls carry `prompt_version` tag.
- **P4.4** Playground UI on `/api/arena/chat`. *AC:* run a version vs 2 models, compare outputs+cost.
- **P4.5** Diff/version UI + label promote. *AC:* visual diff; promote moves the label pointer.
- **P4.6** PRD-2 hook. *AC:* a prompt version is selectable as an experiment subject.

## 7. Locked-decision alignment + small choices
- Inherits PRD-0/1 locks. **Storage:** Supabase (config/registry → Supabase, per the locked split).
- **Immutability — recommend:** API-layer enforcement (+ optional trigger); no version edits/deletes.
- **Cache invalidation — recommend:** label-keyed fetch + TTL; invalidate on label promote (mirrors
  Langfuse).

## 8. Risks
- **Cache staleness** → short TTL + label-based fetch; promote bumps a cache key.
- **Prompt sprawl** → `UNIQUE(org_id, project_id, name)` + ownership.
- **Secrets/PII in prompt bodies** → mask on display (reuse PRD-0 masker) for shared views.

## 9. Test plan
- **Unit:** version append monotonicity; label upsert points to one version; `read_only` blocked on write.
- **Integration:** `getPrompt` resolves label → version; a call made with it shows up under
  `spend_by_prompt_version`.
- **E2E:** create prompt → playground run vs 2 models → promote `production` → SDK `getPrompt` returns
  new version without redeploy.
- **Gates:** `tsc`/`lint`/`build`; SDK TS `vitest` + Python `pytest`.
