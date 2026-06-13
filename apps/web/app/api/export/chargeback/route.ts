/**
 * GET /api/export/chargeback?from=&to=&format=pdf|csv
 *
 * Generate a chargeback report for the authenticated org.
 * PDF format returns a formatted multi-page document.
 * CSV format returns the raw data (falls back to existing /api/export/finops).
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { ChargebackPdf } from "@/lib/reports/chargeback-pdf";
import { buildChargebackReport } from "@/lib/reports/chargeback";
import { createElement } from "react";
import { z } from "zod";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function todayEnd() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

const QuerySchema = z.object({
  from:   z.string().default(daysAgo(30)),
  to:     z.string().default(todayEnd),
  format: z.enum(["pdf", "csv"]).default("pdf"),
});

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (admin as any)
    .from("organizations").select("name").eq("id", member.org_id).maybeSingle() as {
      data: { name: string } | null;
    };

  const { from, to, format } = params.data;

  const reportData = await buildChargebackReport(
    member.org_id,
    org?.name ?? "Your Organization",
    from,
    to,
  );

  if (format === "pdf") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(
      createElement(ChargebackPdf, { data: reportData }) as any,
    );

    const fromLabel = from.slice(0, 7).replace("-", "-");
    const filename  = `prism-chargeback-${fromLabel}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(buffer.byteLength),
      },
    });
  }

  // CSV fallback — redirect to existing finops export
  return NextResponse.redirect(
    new URL(`/api/export/finops?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, req.url),
  );
}
