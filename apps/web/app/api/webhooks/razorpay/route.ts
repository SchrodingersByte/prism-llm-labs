import { NextResponse } from "next/server";

// Razorpay removed. Webhook no longer active.
export async function POST() {
  return NextResponse.json({ ok: true });
}
