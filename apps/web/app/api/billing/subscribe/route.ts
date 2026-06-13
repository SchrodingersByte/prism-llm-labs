import { NextResponse } from "next/server";

// Razorpay integration removed. Use /api/billing/upgrade instead.
export async function POST() {
  return NextResponse.json(
    { error: "Use /api/billing/upgrade", redirect: "/api/billing/upgrade" },
    { status: 410 },
  );
}
