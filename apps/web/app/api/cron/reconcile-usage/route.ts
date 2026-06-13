/**
 * Nightly cron: fetch provider usage APIs and store snapshots.
 * Call via Vercel Cron (vercel.json) or any scheduler with
 * Authorization: Bearer <CRON_SECRET>
 *
 * Supports: OpenAI (/v1/usage), Anthropic (/v1/usage)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptKey } from "@/lib/crypto/keys";

export const runtime = "nodejs";
export const maxDuration = 300;

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const date = req.nextUrl.searchParams.get("date") ?? yesterday();

  // Fetch all provider keys flagged for reconciliation
  const { data: keys } = await admin
    .from("provider_keys")
    // account_label was dropped from provider_keys — dedup falls back to one key
    // per (org_id, provider), i.e. the existing "no label = same account" default.
    .select("id, org_id, provider, key_encrypted, azure_endpoint")
    .eq("use_for_reconciliation", true)
    .eq("is_active", true)
    .order("created_at", { ascending: false }); // newest key first per account

  if (!keys || keys.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  /**
   * Deduplicate by (org_id, provider): OpenAI and Anthropic usage APIs return
   * ACCOUNT-LEVEL totals, not per-key totals. Fetching multiple keys from the
   * same account would double-count. Use the first enabled key per provider per org.
   */
  /**
   * Dedup key: (org_id, provider, account_label ?? '')
   * - Same provider + same account_label = same account → only fetch once
   * - Same provider + different account_label = different accounts → fetch both
   * - Same provider + no label on either = assume same account → fetch once (safe default)
   */
  const seen = new Set<string>();
  const dedupedKeys = keys.filter(pk => {
    const dedupeKey = `${pk.org_id}:${pk.provider}:${(pk as {account_label?: string | null}).account_label ?? ""}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });

  let processed = 0;
  const errors: string[] = [];

  for (const pk of dedupedKeys) {
    try {
      const providerKey = decryptKey(pk.key_encrypted);
      const snapshots   = await fetchProviderUsage(pk.provider, providerKey, date, pk.azure_endpoint);

      if (snapshots.length === 0) continue;

      const rows = snapshots.map(s => ({
        org_id:          pk.org_id,
        provider_key_id: pk.id,
        provider:        pk.provider,
        snapshot_date:   date,
        model:           s.model,
        input_tokens:    s.input_tokens,
        output_tokens:   s.output_tokens,
        requests:        s.requests,
        raw_cost_usd:    s.cost_usd,
      }));

      await admin
        .from("provider_usage_snapshots")
        .upsert(rows, { onConflict: "provider_key_id,snapshot_date,model" });

      processed++;
    } catch (e) {
      errors.push(`${pk.provider}/${pk.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, processed, date, errors: errors.length ? errors : undefined });
}

interface ProviderSnapshot {
  model:         string;
  input_tokens:  number;
  output_tokens: number;
  requests:      number;
  cost_usd:      number;
}

async function fetchProviderUsage(
  provider: string,
  key: string,
  date: string,
  _azureEndpoint?: string,
): Promise<ProviderSnapshot[]> {
  if (provider === "openai") {
    return fetchOpenAIUsage(key, date);
  }
  if (provider === "anthropic") {
    return fetchAnthropicUsage(key, date);
  }
  // Azure OpenAI token-level usage snapshots are not available via a public API
  // (Azure doesn't expose a /v1/usage equivalent). Cost attribution for Azure
  // happens through the billing connections sync (lib/billing/azure.ts) instead,
  // which uses Azure Cost Management API to pull actual spend.
  // Google Gemini usage snapshots are also not available — same path via GCP billing.
  return [];
}

async function fetchOpenAIUsage(key: string, date: string): Promise<ProviderSnapshot[]> {
  // OpenAI usage API accepts a single `date` param (YYYY-MM-DD)
  const res = await fetch(
    `https://api.openai.com/v1/usage?date=${date}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );

  if (!res.ok) throw new Error(`OpenAI usage API returned ${res.status}`);

  const data = await res.json() as {
    data?: {
      snapshot_id?: string;
      model?: string;
      n_requests?: number;
      n_context_tokens_total?: number;
      n_generated_tokens_total?: number;
    }[]
  };

  const byModel = new Map<string, ProviderSnapshot>();

  for (const row of (data.data ?? [])) {
    const model = row.model ?? "unknown";
    const prev  = byModel.get(model) ?? { model, input_tokens: 0, output_tokens: 0, requests: 0, cost_usd: 0 };
    byModel.set(model, {
      model,
      input_tokens:  prev.input_tokens  + (row.n_context_tokens_total    ?? 0),
      output_tokens: prev.output_tokens + (row.n_generated_tokens_total  ?? 0),
      requests:      prev.requests      + (row.n_requests ?? 0),
      cost_usd:      0, // OpenAI doesn't return cost; we'll calculate in the UI
    });
  }

  return Array.from(byModel.values());
}

async function fetchAnthropicUsage(key: string, date: string): Promise<ProviderSnapshot[]> {
  // Anthropic usage API (2025+)
  const res = await fetch(
    `https://api.anthropic.com/v1/usage?start_date=${date}&end_date=${date}`,
    {
      headers: {
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
      },
    },
  );

  if (!res.ok) throw new Error(`Anthropic usage API returned ${res.status}`);

  const data = await res.json() as {
    data?: {
      model?: string;
      input_tokens?: number;
      output_tokens?: number;
    }[]
  };

  const byModel = new Map<string, ProviderSnapshot>();

  for (const row of (data.data ?? [])) {
    const model = row.model ?? "unknown";
    const prev  = byModel.get(model) ?? { model, input_tokens: 0, output_tokens: 0, requests: 0, cost_usd: 0 };
    byModel.set(model, {
      model,
      input_tokens:  prev.input_tokens  + (row.input_tokens  ?? 0),
      output_tokens: prev.output_tokens + (row.output_tokens ?? 0),
      requests:      prev.requests,
      cost_usd:      0,
    });
  }

  return Array.from(byModel.values());
}
