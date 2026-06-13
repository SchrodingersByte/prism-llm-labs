/**
 * GET /api/v1/customers/:customerId/usage
 *
 * Usage metering endpoint for multi-tenant billing passthrough.
 * Returns AI usage (tokens + cost + model breakdown) for a single customer
 * within a billing period. Operators call this from their billing system
 * (Stripe, Lago, Orb, etc.) to generate invoice line items.
 *
 * Auth: Bearer {PRISM_API_KEY}  (same key used for /api/mcp/ingest)
 *
 * Query params:
 *   period          YYYY-MM — billing month (default: current month)
 *   include_models  true | false — include per-model breakdown (default: true)
 *   include_daily   true | false — include daily time-series (default: false)
 *
 * Example:
 *   GET /api/v1/customers/acme-corp/usage?period=2026-06&include_models=true
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateIngestKey } from "@/lib/ingest/auth";
import { getSpendByCustomer, getCustomerModelBreakdown, getCustomerDailyTimeseries } from "@/lib/tinybird/queries";
import { getCustomerMonthSpend } from "@/lib/upstash/redis";
import { createClient } from "@supabase/supabase-js";

function periodBounds(period: string): { from: string; to: string; label: string } | null {
  // period = "2026-06"
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const year  = parseInt(match[1]!);
  const month = parseInt(match[2]!);
  if (month < 1 || month > 12) return null;

  const from = `${period}-01 00:00:00`;
  const lastDay = new Date(year, month, 0).getDate();
  const to      = `${period}-${String(lastDay).padStart(2, "0")} 23:59:59`;
  const label   = new Date(year, month - 1, 1)
    .toLocaleString("en-US", { month: "long", year: "numeric" });
  return { from, to, label };
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // "2026-06"
}

function quotaStatus(
  spendUsd:    number,
  limitUsd:    number | null,
): "on_track" | "at_risk" | "over_budget" | "unlimited" {
  if (!limitUsd) return "unlimited";
  const pct = (spendUsd / limitUsd) * 100;
  if (pct >= 100) return "over_budget";
  if (pct >= 80)  return "at_risk";
  return "on_track";
}

export async function GET(
  req:     NextRequest,
  { params }: { params: { customerId: string } },
) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await authenticateIngestKey(req.headers.get("authorization") ?? "");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { key } = auth;

  // ── Parse params ────────────────────────────────────────────────────────
  const { customerId } = params;
  if (!customerId?.trim()) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
  }

  const searchParams    = req.nextUrl.searchParams;
  const periodParam     = searchParams.get("period") ?? currentPeriod();
  const includeModels   = searchParams.get("include_models") !== "false";
  const includeDaily    = searchParams.get("include_daily")  === "true";

  const bounds = periodBounds(periodParam);
  if (!bounds) {
    return NextResponse.json(
      { error: "Invalid period format. Use YYYY-MM (e.g. 2026-06)" },
      { status: 400 },
    );
  }

  // ── Fetch usage from Tinybird + Redis ───────────────────────────────────
  const isCurrentPeriod = periodParam === currentPeriod();

  const [tbRows, redisSpend, modelRows, dailyRows] = await Promise.all([
    getSpendByCustomer(key.org_id, bounds.from, bounds.to, customerId),
    // Redis has real-time spend for the current month only
    isCurrentPeriod ? getCustomerMonthSpend(key.org_id, customerId) : Promise.resolve(null),
    includeModels
      ? getCustomerModelBreakdown(key.org_id, customerId, bounds.from, bounds.to)
      : Promise.resolve([]),
    includeDaily
      ? getCustomerDailyTimeseries(key.org_id, customerId, bounds.from, bounds.to)
      : Promise.resolve([]),
  ]);

  // Tinybird is the authoritative source; Redis provides a real-time supplement
  const tbRow = tbRows[0] ?? null;

  // For current period: use max(Tinybird, Redis) — Redis may be slightly ahead
  // due to events not yet aggregated in Tinybird.
  const costUsd = Math.max(
    tbRow?.total_cost_usd ?? 0,
    redisSpend?.spend_usd ?? 0,
  );
  const totalTokens = Math.max(
    (tbRow?.total_tokens ?? 0),
    (redisSpend?.tokens ?? 0),
  );

  // ── Fetch quota profile ─────────────────────────────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: quotaProfile } = await supabase
    .from("customer_quota_profiles" as any)
    .select("display_name, monthly_spend_usd, monthly_token_limit, soft_cap_pct, soft_cap_model, is_active")
    .eq("org_id", key.org_id)
    .eq("customer_id", customerId)
    .maybeSingle() as {
      data: {
        display_name: string | null;
        monthly_spend_usd: number | null;
        monthly_token_limit: number | null;
        soft_cap_pct: number;
        soft_cap_model: string | null;
        is_active: boolean;
      } | null
    };

  // ── Build response ──────────────────────────────────────────────────────
  const limitUsd = quotaProfile?.monthly_spend_usd ?? null;
  const utilizationPct = limitUsd && limitUsd > 0
    ? Math.round((costUsd / limitUsd) * 1000) / 10   // one decimal place
    : null;

  const response = {
    customer_id:   customerId,
    display_name:  quotaProfile?.display_name ?? null,
    period: {
      label:  bounds.label,
      from:   bounds.from,
      to:     bounds.to,
      period: periodParam,
    },
    usage: {
      total_cost_usd:  Math.round(costUsd      * 1_000_000) / 1_000_000,
      total_tokens:    totalTokens,
      input_tokens:    tbRow?.input_tokens   ?? 0,
      output_tokens:   tbRow?.output_tokens  ?? 0,
      cached_tokens:   tbRow?.cached_tokens  ?? 0,
      requests:        tbRow?.requests       ?? 0,
      error_count:     tbRow?.error_count    ?? 0,
      avg_latency_ms:  tbRow ? Math.round(tbRow.avg_latency_ms) : 0,
    },
    quota: quotaProfile ? {
      monthly_spend_usd:    limitUsd,
      monthly_token_limit:  quotaProfile.monthly_token_limit,
      soft_cap_pct:         quotaProfile.soft_cap_pct,
      soft_cap_model:       quotaProfile.soft_cap_model,
      utilization_pct:      utilizationPct,
      status:               quotaStatus(costUsd, limitUsd),
      is_active:            quotaProfile.is_active,
    } : null,
    ...(includeModels ? {
      model_breakdown: modelRows.map(r => ({
        model:                r.model,
        provider:             r.provider,
        cost_usd:             Math.round(r.cost_usd * 1_000_000) / 1_000_000,
        requests:             r.requests,
        input_tokens:         r.input_tokens,
        output_tokens:        r.output_tokens,
        cached_tokens:        r.cached_tokens,
        avg_cost_per_request: Math.round(r.avg_cost_per_request * 1_000_000) / 1_000_000,
      })),
    } : {}),
    ...(includeDaily ? { daily_series: dailyRows } : {}),
  };

  return NextResponse.json(response, {
    headers: {
      // Allow operators to cache this for up to 60 seconds
      "Cache-Control": "private, max-age=60",
    },
  });
}
