import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { getNarrative } from "@/lib/engine/narratives";
import { checkFeature } from "@/lib/billing/feature-guard";
import { z } from "zod";

const BodySchema = z.object({
  rec: z.object({
    id:                    z.string(),
    type:                  z.string(),
    title:                 z.string(),
    description:           z.string(),
    potential_savings_usd: z.number(),
    confidence:            z.number(),
    status:                z.string(),
    current_model:         z.string().optional(),
    suggested_model:       z.string().optional(),
    feature:               z.string().optional(),
    stats:                 z.record(z.number()).optional(),
  }),
});

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const guard = await checkFeature(ctx.orgId, "engine");
  if (guard) return guard;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const narrative = await getNarrative(ctx.orgId, parsed.data.rec as any);
  return NextResponse.json({ narrative });
}
