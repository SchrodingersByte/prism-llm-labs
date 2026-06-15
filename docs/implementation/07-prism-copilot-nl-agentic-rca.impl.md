# Code-Analysis / Implementation Design — PRD-7: Prism Copilot (NL Query + Agentic RCA)

> **Implements:** [PRD-7](../prd/07-prism-copilot-nl-agentic-rca.md) · **Phase:** 4 (Differentiator) ·
> **Status:** Implementation design for review (no code yet) · **Critical-path position:** #8 ·
> **Depends on:** existing cost/anomaly data (can start now); deepens with PRD-1 (quality) + PRD-5 (drift).

## 0. How to read this doc
Engineering design behind PRD-7 — the one area where Prism can lead. It's an **agent over the existing
pipe surface**, reusing `queryTinybird`, the engine driver, and the gateway. The safety story is a
**semantic layer (pipe calls, not raw SQL)** + org-scoping + read-only + self-metering.

---

## 1. Current-state analysis (corrected by code reading)
- **Queryable surface exists:** 40+ Tinybird pipes; `queryTinybird(pipe, params)` (`lib/tinybird/
  client.ts:27`) **requires `org_id`** (built-in scoping); `querySql()` (`:11`) for ad-hoc (avoid with
  user input).
- **Engine driver + LLM plumbing exist:** `lib/engine/run.ts` (`computeRecommendations` /
  `computeAndPersistRecommendations`), `lib/engine/narratives.ts` (Claude Haiku via raw fetch — switch
  to the gateway), `recommendations.ts`, `actions.ts` (one-click action overlay).
- **Triggers exist:** `tinybird/pipes/anomaly_detection.pipe` + `spend_velocity_5min.pipe`.
- **Scoping exists:** `lib/supabase/metrics-scope.ts` (`resolveMetricsScope`, `getAccessibleProjectIds`)
  — the Copilot must apply this so a user only sees their scope.
- **Today's "intelligence"** = rules + templated Haiku narratives — **not** NL query or agentic RCA.

---

## 2. Design summary
1. **Semantic layer / metrics catalog** (`lib/copilot/catalog.ts`): NL concepts → `{pipe, params,
   dimensions}`. The agent may only call catalogued pipes — **no raw SQL, no DML** (the safety
   guarantee; ~90% accuracy per research).
2. **Planner agent loop** (`lib/copilot/agent.ts`): given a question + catalog, pick pipe(s) → call
   `queryTinybird` (org-scoped) → refine (6–27 calls) → synthesize narrative + chart spec +
   recommended actions. Runs **through Prism's own gateway** (self-metered, capped — same lock as PRD-1).
3. **Chat + investigate routes**; **auto-invoke** on anomaly/spend-velocity.
4. **Conversations** persisted in Supabase.

## 3. Data model & migrations
Migration `supabase/migrations/20260620090000_copilot.sql`:
```sql
CREATE TABLE public.copilot_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.copilot_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.copilot_conversations(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant','tool')),
  content         text,
  tool_calls      jsonb,          -- pipes called + params + row counts (provenance)
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.copilot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_messages      ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_select ON public.copilot_conversations FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY cc_write  ON public.copilot_conversations FOR ALL USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE POLICY cm_select ON public.copilot_messages FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY cm_write  ON public.copilot_messages FOR ALL USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE INDEX idx_cc_org ON public.copilot_conversations(org_id, created_at DESC);
CREATE INDEX idx_cm_conv ON public.copilot_messages(conversation_id, created_at);
```
- **No analytics datasources needed** for v1 — the Copilot reads existing pipes.

## 4. Code changes (file-by-file)
### 4.1 Semantic layer — `apps/web/lib/copilot/catalog.ts` (new)
- A typed registry: each entry = `{ concept, pipe, requiredParams, dimensions, description }` covering
  the core pipes (`spend_by_model/provider/feature/customer/cost_center`, `overview_metrics`,
  `anomaly_detection`, `quality_*` from PRD-1, `drift_timeseries` from PRD-5, etc.). The agent is
  prompted with this catalog (not the DB schema).

### 4.2 Agent loop — `apps/web/lib/copilot/agent.ts` (new)
- Tool-use loop against the gateway (reuse the `narratives.ts` fetch pattern but point at
  `/api/gateway/anthropic`): the model emits `call_pipe(pipe, params)` tool calls; the runner executes
  `queryTinybird` **with `org_id` + scope from `resolveMetricsScope`**, feeds results back, iterates,
  then returns `{ narrative, charts[], actions[] }`. Hard cap on iterations + self-cost.

### 4.3 Chat route — `app/api/copilot/chat/route.ts` (new)
- `requireAuth` + `checkFeature("engine")` (locked reuse) + `resolveMetricsScope`; streams SSE;
  persists to `copilot_messages` with **tool-call provenance** (which pipes ran).

### 4.4 Investigate route — `app/api/copilot/investigate/route.ts` (new)
- Agentic RCA for a given anomaly/time window; reused by an **auto-invoke** hook in
  `cron/*`/alerts when `anomaly_detection`/`spend_velocity_5min` fires (opt-in per org).

### 4.5 Action overlay — reuse `lib/engine/actions.ts`
- Investigations may surface a recommendation action (e.g., model downgrade) via the existing overlay.

### 4.6 Guardrails
- **Read-only**: agent may only call catalogued pipes via `queryTinybird` — never `querySql` with model
  output, never writes. **Org-scoped** via `metrics-scope`. **Self-metered + capped** via the gateway.

## 5. UX
- **Global Copilot chat panel** (command palette / sidebar; `cmdk` already a dep).
- **Investigation results** view (narrative + charts + provenance + actions).
- **"Explain this"** buttons on dashboard charts → seed a Copilot query.

## 6. Phased task breakdown → files (each gated by `tsc`/`build`)
- **P7.1** Catalog (≥10 core pipes) + migration. *AC:* concepts map to pipes with params/dimensions.
- **P7.2** Agent loop via gateway (self-metered). *AC:* a question returns the right pipe call + answer (read-only, scoped).
- **P7.3** Chat API + UI (streaming) + provenance. *AC:* multi-turn chat with charts + which pipes ran.
- **P7.4** Agentic RCA loop. *AC:* an anomaly is investigated across multiple pipe calls → narrative.
- **P7.5** Anomaly auto-investigate (opt-in). *AC:* a spend spike auto-generates an explanation.
- **P7.6** Action overlay + "explain this" buttons. *AC:* an investigation proposes an action.
- **P7.7** Self-metering. *AC:* Copilot LLM spend appears in Prism's own usage (dogfood).

## 7. Locked-decision alignment + small choices
- **Inherits the PRD-1 gateway lock** → Copilot LLM runs through Prism's gateway (self-metered/capped).
- **Pipe-calls-only (no raw SQL) — recommend** for v1 (safety + accuracy); a guarded read-only
  `querySql` mode is a later add-on.
- **Models — recommend:** a capable planner model (e.g. Sonnet) + Haiku for cheap steps, both via the
  gateway; configurable.
- **Auto-invoke on anomaly — recommend:** opt-in per org.

## 8. Risks
- **Hallucinated insights** → semantic layer + return **provenance** (pipes/params used) + read-only +
  optional secondary check.
- **Cost** → self-meter + iteration cap + cache (`queryTinybird` already edge-caches 30s).
- **Data-scope leakage** → every pipe call carries `org_id` + `resolveMetricsScope`; never `querySql`
  with user input.
- **Latency** → stream + cap iterations.

## 9. Test plan
- **Unit:** catalog resolution (concept→pipe/params); agent never emits non-catalogued calls; scope
  injected on every call.
- **Integration:** seeded data → "why did spend spike last week?" → agent calls
  `anomaly_detection`+`spend_by_model` → correct narrative with provenance; cross-org query returns
  only in-scope data.
- **E2E:** anomaly fires → auto-investigation posts an explanation + action; "explain this" on a chart
  returns a scoped answer; Copilot spend shows in dogfood usage.
- **Gates:** `tsc`/`lint`/`build`.
