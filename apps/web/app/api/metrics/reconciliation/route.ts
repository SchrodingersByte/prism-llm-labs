import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getSpendByModel, getSpendByKey, getSpendByKeyModel } from "@/lib/tinybird/queries";
import { normalizeModelName } from "@/lib/pricing/table";
import { z } from "zod";

function thirtyDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function today() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

const QuerySchema = z.object({
  from: z.string().default(thirtyDaysAgo),
  to:   z.string().default(today),
});

export async function GET(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  const admin    = createAdminClient();
  const fromDate = params.data.from.slice(0, 10);
  const toDate   = params.data.to.slice(0, 10);

  // ── 1. Provider usage snapshots (with provider_key_id for per-key detail) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: snapshots } = await (admin as any)
    .from("provider_usage_snapshots")
    .select("provider_key_id, provider, model, input_tokens, output_tokens, requests, raw_cost_usd, snapshot_date")
    .eq("org_id", ctx.orgId)
    .gte("snapshot_date", fromDate)
    .lte("snapshot_date", toDate) as { data: Array<{
      provider_key_id: string;
      provider: string; model: string;
      input_tokens: number; output_tokens: number;
      requests: number; raw_cost_usd: number;
      snapshot_date: string;
    }> | null };

  // ── 2. Provider key metadata (name, hint, account_label) ──
  const providerKeyIds = Array.from(new Set((snapshots ?? []).map(s => s.provider_key_id)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: providerKeyMeta } = providerKeyIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (admin as any)
        .from("provider_keys")
        // account_label dropped from provider_keys — keys of the same provider are
        // no longer sub-grouped by account (treated as one account, MAX taken).
        .select("id, name, key_hint")
        .in("id", providerKeyIds) as { data: Array<{ id: string; name: string; key_hint: string }> | null }
    : { data: [] };

  const pkMeta = new Map((providerKeyMeta ?? []).map(k => [k.id, k]));

  // ── 3. Prism-tracked spend ──
  const [prismByModel, prismByKey, prismByKeyModel] = await Promise.all([
    getSpendByModel(ctx.orgId, params.data.from, params.data.to).catch(() => []),
    getSpendByKey(ctx.orgId, params.data.from, params.data.to).catch(() => []),
    getSpendByKeyModel(ctx.orgId, params.data.from, params.data.to).catch(() => []),
  ]);

  // ── 4. Prism API key metadata ──
  const apiKeyIds = Array.from(new Set(prismByKey.map(k => k.api_key_id).filter(Boolean)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: apiKeyMeta } = apiKeyIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (admin as any)
        .from("api_keys")
        .select("id, name, key_prefix")
        .in("id", apiKeyIds) as { data: Array<{ id: string; name: string; key_prefix: string }> | null }
    : { data: [] };

  const akMeta = new Map((apiKeyMeta ?? []).map(k => [k.id, k]));

  // ── 5. Aggregate provider snapshots ──
  // Step A: per (provider_key_id / model / date) — preserve per-key breakdown
  type SnapAgg = { input_tokens: number; output_tokens: number; requests: number; cost_usd: number };
  const byKeyModelDate = new Map<string, SnapAgg>();

  for (const s of (snapshots ?? [])) {
    const k    = `${s.provider_key_id}/${s.model}/${s.snapshot_date}`;
    const prev = byKeyModelDate.get(k);
    byKeyModelDate.set(k, prev ? {
      input_tokens:  Math.max(prev.input_tokens,  s.input_tokens  ?? 0),
      output_tokens: Math.max(prev.output_tokens, s.output_tokens ?? 0),
      requests:      Math.max(prev.requests,      s.requests      ?? 0),
      cost_usd:      Math.max(prev.cost_usd,      s.raw_cost_usd  ?? 0),
    } : {
      input_tokens:  s.input_tokens  ?? 0,
      output_tokens: s.output_tokens ?? 0,
      requests:      s.requests      ?? 0,
      cost_usd:      s.raw_cost_usd  ?? 0,
    });
  }

  // Step B: sum deduplicated per-day rows across dates → (provider_key_id, model) totals
  // Build a lookup: provider_key_id → (provider, model) from raw snapshots
  const pkProviderModel = new Map<string, { provider: string; model: string }>();
  for (const s of (snapshots ?? [])) {
    pkProviderModel.set(`${s.provider_key_id}/${s.model}`, { provider: s.provider, model: s.model });
  }

  const byKeyModel = new Map<string, SnapAgg & { provider: string; model: string; provider_key_id: string }>();
  for (const [dayKey, day] of Array.from(byKeyModelDate.entries())) {
    // dayKey = "provider_key_id/model/snapshot_date"
    const [pkId, model] = dayKey.split("/");
    const k    = `${pkId}/${model}`;
    const prev = byKeyModel.get(k);
    const meta = pkProviderModel.get(k);
    byKeyModel.set(k, {
      provider:        meta?.provider ?? "",
      model:           meta?.model    ?? model ?? "",
      provider_key_id: pkId ?? "",
      input_tokens:    (prev?.input_tokens  ?? 0) + day.input_tokens,
      output_tokens:   (prev?.output_tokens ?? 0) + day.output_tokens,
      requests:        (prev?.requests      ?? 0) + day.requests,
      cost_usd:        (prev?.cost_usd      ?? 0) + day.cost_usd,
    });
  }

  // Step C: aggregate across keys per (provider, model) for the main row totals
  // Use MAX within same (account_label, provider, model) to avoid double-counting same account
  type AggRow = { input_tokens: number; output_tokens: number; requests: number; cost_usd: number };
  const providerByModel = new Map<string, AggRow>();

  // Group by (account_label, provider, model) first, take MAX across key_ids
  const byAccountModel = new Map<string, AggRow>();
  for (const [, row] of Array.from(byKeyModel.entries())) {
    const accountLabel = "";  // account_label dropped — one account per provider
    const ak           = `${accountLabel}||${row.provider}/${row.model}`;
    const prev         = byAccountModel.get(ak);
    byAccountModel.set(ak, prev ? {
      input_tokens:  Math.max(prev.input_tokens,  row.input_tokens),
      output_tokens: Math.max(prev.output_tokens, row.output_tokens),
      requests:      Math.max(prev.requests,      row.requests),
      cost_usd:      Math.max(prev.cost_usd,      row.cost_usd),
    } : { ...row });
  }

  // Now sum across accounts
  // Key format: "{accountLabel}||{provider}/{model}" — use "||" as separator to avoid "/" collision
  for (const [key, row] of Array.from(byAccountModel.entries())) {
    const modelKey = key.split("||")[1] ?? ""; // "provider/model"
    const prev     = providerByModel.get(modelKey) ?? { input_tokens: 0, output_tokens: 0, requests: 0, cost_usd: 0 };
    providerByModel.set(modelKey, {
      input_tokens:  prev.input_tokens  + row.input_tokens,
      output_tokens: prev.output_tokens + row.output_tokens,
      requests:      prev.requests      + row.requests,
      cost_usd:      prev.cost_usd      + row.cost_usd,
    });
  }

  // ── 6. Merge Prism model rows (normalise versioned names) ──
  type PrismRow = typeof prismByModel[number];
  const mergedPrism = new Map<string, PrismRow>();
  for (const pm of prismByModel) {
    const canonical = normalizeModelName(pm.model);
    const key       = `${pm.provider}/${canonical}`;
    const existing  = mergedPrism.get(key);
    mergedPrism.set(key, existing ? {
      ...existing,
      model:          canonical,
      total_cost_usd: existing.total_cost_usd + pm.total_cost_usd,
      input_tokens:   existing.input_tokens   + pm.input_tokens,
      output_tokens:  existing.output_tokens  + pm.output_tokens,
      requests:       existing.requests       + pm.requests,
    } : { ...pm, model: canonical });
  }

  // ── 7. Build per-key breakdowns for the "View keys" hover ──

  // Provider key breakdown per (provider, model)
  const providerKeyDetailsByModel = new Map<string, Array<{
    provider_key_id: string; name: string; hint: string; account_label: string | null;
    input_tokens: number; output_tokens: number; cost_usd: number;
  }>>();

  for (const [, row] of Array.from(byKeyModel.entries())) {
    const canonical = normalizeModelName(row.model);
    const modelKey  = `${row.provider}/${canonical}`;
    const meta      = pkMeta.get(row.provider_key_id);
    const list      = providerKeyDetailsByModel.get(modelKey) ?? [];
    list.push({
      provider_key_id: row.provider_key_id,
      name:            meta?.name        ?? `…${row.provider_key_id.slice(-4)}`,
      hint:            meta?.key_hint    ?? "????",
      account_label:   null,
      input_tokens:    row.input_tokens,
      output_tokens:   row.output_tokens,
      cost_usd:        row.cost_usd,
    });
    providerKeyDetailsByModel.set(modelKey, list);
  }

  // Prism key breakdown per (provider, model) — from spend_by_key_model if available
  const prismKeyDetailsByModel = new Map<string, Array<{
    api_key_id: string; name: string; prefix: string;
    input_tokens: number; output_tokens: number; cost_usd: number; requests: number;
  }>>();

  if (prismByKeyModel.length > 0) {
    for (const km of prismByKeyModel) {
      const canonical = normalizeModelName(km.model);
      const modelKey  = `${km.provider}/${canonical}`;
      const meta      = akMeta.get(km.api_key_id);
      const list      = prismKeyDetailsByModel.get(modelKey) ?? [];
      list.push({
        api_key_id:    km.api_key_id,
        name:          meta?.name       ?? km.api_key_id.slice(0, 16) + "…",
        prefix:        meta?.key_prefix ?? km.api_key_id.slice(0, 12),
        input_tokens:  km.input_tokens,
        output_tokens: km.output_tokens,
        cost_usd:      km.cost_usd,
        requests:      km.requests,
      });
      prismKeyDetailsByModel.set(modelKey, list);
    }
  } else {
    // Fallback: spend_by_key doesn't have model breakdown — attach all active keys to every model row
    for (const k of prismByKey) {
      const meta = akMeta.get(k.api_key_id);
      // We'll attach at the page level (prism_key_activity) instead
      void meta;
    }
  }

  // ── 8. Build reconciliation rows ──
  const rows = Array.from(mergedPrism.values()).map(pm => {
    const key = `${pm.provider}/${pm.model}`;
    const pv  = providerByModel.get(key);
    return {
      provider:       pm.provider,
      model:          pm.model,
      prism_cost:     pm.total_cost_usd,
      prism_tokens:   pm.input_tokens + pm.output_tokens,
      prism_requests: pm.requests,
      provider_cost:      pv?.cost_usd      ?? null,
      provider_tokens:    pv ? (pv.input_tokens + pv.output_tokens) : null,
      provider_requests:  pv?.requests      ?? null,
      coverage_pct:   pv && pv.input_tokens + pv.output_tokens > 0
        ? Math.round(((pm.input_tokens + pm.output_tokens) / (pv.input_tokens + pv.output_tokens)) * 100)
        : null,
      // Per-key details for "View keys" hover
      provider_key_details: providerKeyDetailsByModel.get(key) ?? [],
      prism_key_details:    prismKeyDetailsByModel.get(key)    ?? [],
    };
  });

  // Prism key activity summary (fallback when spend_by_key_model pipe not yet pushed)
  const prismKeyActivity = prismByKey.map(k => {
    const meta = akMeta.get(k.api_key_id);
    return {
      api_key_id:    k.api_key_id,
      name:          meta?.name       ?? k.api_key_id.slice(0, 16) + "…",
      prefix:        meta?.key_prefix ?? k.api_key_id.slice(0, 12),
      input_tokens:  k.input_tokens,
      output_tokens: k.output_tokens,
      cost_usd:      k.cost_usd,
      requests:      k.requests,
    };
  });

  const hasProviderData       = (snapshots ?? []).length > 0;
  const hasPerModelKeyData    = prismByKeyModel.length > 0;

  return NextResponse.json({
    data:                rows,
    has_provider_data:   hasProviderData,
    has_per_model_keys:  hasPerModelKeyData,
    prism_key_activity:  prismKeyActivity,  // fallback when pipe not yet pushed
  });
}
