import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { queryTinybird } from "@/lib/tinybird/client";

export const runtime = "nodejs";

const ROW_LIMIT = 100_000;

function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function today(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

const QuerySchema = z.object({
  format:     z.enum(["csv", "json"]).default("csv"),
  from:       z.string().default(() => thirtyDaysAgo()),
  to:         z.string().default(() => today()),
  project_id: z.string().optional(),
  user_id:    z.string().optional(),
  provider:   z.string().optional(),
});

const CSV_COLUMNS = [
  "event_id", "timestamp", "project_id", "project_name", "user_id",
  "environment", "provider", "model", "input_tokens", "output_tokens",
  "cached_tokens", "cost_usd", "latency_ms", "status_code", "request_id",
] as const;

function escapeCSV(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCsv(row: Record<string, unknown>): string {
  return CSV_COLUMNS.map((col) => escapeCSV(row[col])).join(",");
}

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: member } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle() as { data: { org_id: string; role: string } | null };

  if (!member) {
    return NextResponse.json({ error: "No org membership found" }, { status: 403 });
  }

  // ── Validate query params ─────────────────────────────────────────────────
  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) {
    return NextResponse.json({ error: params.error.issues[0]?.message ?? "Invalid params" }, { status: 400 });
  }

  const { format, from, to, project_id, user_id, provider } = params.data;

  // ── Non-admin users can only export their own data ────────────────────────
  const resolvedUserId =
    ["owner"].includes(member.role)
      ? (user_id ?? "")
      : user.id;

  // ── Query Tinybird ────────────────────────────────────────────────────────
  const tbParams: Record<string, string> = {
    org_id:    member.org_id,
    from_date: from,
    to_date:   to,
  };
  if (project_id)      tbParams.project_id = project_id;
  if (resolvedUserId)  tbParams.user_id    = resolvedUserId;
  if (provider)        tbParams.provider   = provider;

  const rows = await queryTinybird("export_events", tbParams) as Array<Record<string, unknown>>;

  if (rows.length >= ROW_LIMIT) {
    return NextResponse.json(
      {
        error: `Result set exceeds ${ROW_LIMIT.toLocaleString()} rows. Narrow your date range or add filters.`,
        rows:  rows.length,
      },
      { status: 413 },
    );
  }

  // ── Stream response ────────────────────────────────────────────────────────
  const filename = `prism-events-${from.slice(0, 10)}-to-${to.slice(0, 10)}.${format}`;

  if (format === "csv") {
    const header = CSV_COLUMNS.join(",");
    const body   = [header, ...rows.map(rowToCsv)].join("\n");
    return new NextResponse(body, {
      headers: {
        "Content-Type":        "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON
  return new NextResponse(JSON.stringify(rows, null, 2), {
    headers: {
      "Content-Type":        "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
