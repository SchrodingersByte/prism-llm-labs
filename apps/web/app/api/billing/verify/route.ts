import { NextResponse } from "next/server";

// Razorpay removed. This endpoint is no longer used.
export async function POST() {
  return NextResponse.json({ error: "Endpoint removed" }, { status: 410 });
}
