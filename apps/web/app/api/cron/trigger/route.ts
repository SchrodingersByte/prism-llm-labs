/**
 * Authenticated proxy for the reconciliation cron — lets the dashboard
 * trigger it manually without exposing CRON_SECRET to the browser.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  if (!ctx.isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const date = (await req.json().catch(() => ({}))).date as string | undefined;
  const url  = new URL("/api/cron/reconcile-usage", process.env.NEXT_PUBLIC_APP_URL!);
  if (date) url.searchParams.set("date", date);

  const res  = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET!}` },
  });

  const json = await res.json().catch(() => ({ error: "Invalid response" }));
  return NextResponse.json(json, { status: res.status });
}
