/**
 * GET /api/cron/send-reports
 *
 * Called daily by Vercel cron. Checks report_schedules for any schedules
 * due today, generates the chargeback report, and emails it to recipients.
 *
 * This endpoint is secured by the CRON_SECRET env var (same as other cron routes).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { buildChargebackReport } from "@/lib/reports/chargeback";
import { ChargebackPdf }         from "@/lib/reports/chargeback-pdf";
import { buildChargebackReportEmailHtml } from "@/lib/emails/templates";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function todayEnd() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

/** Check whether a schedule should fire today */
function isDueToday(schedule: { frequency: string; day_of_week?: number | null; day_of_month?: number | null }): boolean {
  const now = new Date();
  if (schedule.frequency === "daily") return true;
  if (schedule.frequency === "weekly") {
    const target = schedule.day_of_week ?? 1; // default Monday
    return now.getUTCDay() === target;
  }
  if (schedule.frequency === "monthly") {
    const target = schedule.day_of_month ?? 1; // default 1st
    return now.getUTCDate() === target;
  }
  return false;
}

export async function GET(req: NextRequest) {
  // Secure with CRON_SECRET
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin  = createAdminClient();
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Fetch all active schedules
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: schedules } = await (admin as any)
    .from("report_schedules")
    .select("id, org_id, frequency, recipients, format, day_of_week, day_of_month")
    .eq("is_active", true) as {
      data: Array<{
        id:            string;
        org_id:        string;
        frequency:     string;
        recipients:    string[];
        format:        string;
        day_of_week?:  number | null;
        day_of_month?: number | null;
      }> | null;
    };

  if (!schedules?.length) {
    return NextResponse.json({ sent: 0 });
  }

  // Fetch org names for all unique orgs
  const orgIds = Array.from(new Set(schedules.map(s => s.org_id)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs } = await (admin as any)
    .from("organizations")
    .select("id, name")
    .in("id", orgIds) as { data: Array<{ id: string; name: string }> | null };

  const orgNameMap = new Map((orgs ?? []).map(o => [o.id, o.name]));

  let sent = 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev";

  for (const schedule of schedules) {
    if (!isDueToday(schedule)) continue;

    try {
      const from = daysAgo(schedule.frequency === "daily" ? 1 : schedule.frequency === "weekly" ? 7 : 30);
      const to   = todayEnd();
      const orgName = orgNameMap.get(schedule.org_id) ?? "Your Organization";

      const reportData = await buildChargebackReport(schedule.org_id, orgName, from, to);
      const period     = reportData.period.label;

      if (schedule.format === "pdf") {
        // Generate PDF buffer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfBuffer = await renderToBuffer(createElement(ChargebackPdf, { data: reportData }) as any);
        const fromLabel = from.slice(0, 7);
        const filename  = `prism-chargeback-${fromLabel}.pdf`;

        await resend.emails.send({
          from:    process.env.RESEND_FROM_EMAIL ?? "reports@useprism.dev",
          to:      schedule.recipients,
          subject: `[Prism] AI Chargeback Report — ${period}`,
          html:    buildChargebackReportEmailHtml({
            orgName,
            period,
            totalCostUsd:  reportData.summary.total_cost_usd,
            providerCount: reportData.summary.provider_count,
            momDeltaPct:   reportData.summary.mom_delta_pct,
            downloadUrl:   `${appUrl}/api/export/chargeback?format=pdf`,
          }),
          attachments: [{
            filename,
            content: Buffer.from(pdfBuffer).toString("base64"),
          }],
        });
      } else {
        // CSV — provide a download link (no attachment for large exports)
        await resend.emails.send({
          from:    process.env.RESEND_FROM_EMAIL ?? "reports@useprism.dev",
          to:      schedule.recipients,
          subject: `[Prism] AI Chargeback Report — ${period}`,
          html:    buildChargebackReportEmailHtml({
            orgName,
            period,
            totalCostUsd:  reportData.summary.total_cost_usd,
            providerCount: reportData.summary.provider_count,
            momDeltaPct:   reportData.summary.mom_delta_pct,
            downloadUrl:   `${appUrl}/api/export/finops?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          }),
        });
      }

      // Update last_sent_at
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("report_schedules")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("id", schedule.id);

      sent++;
    } catch (err) {
      console.error(`[cron/send-reports] Failed for schedule ${schedule.id}:`, err);
    }
  }

  return NextResponse.json({ sent, evaluated: schedules.length });
}
