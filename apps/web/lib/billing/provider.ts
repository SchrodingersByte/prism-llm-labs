/**
 * Billing provider selection by region. The owner picks a region (United States
 * or India); that determines the payment processor:
 *   US (and default) → Stripe (USD)
 *   IN               → Razorpay (INR)
 *
 * The unified /api/billing/checkout route reads the org's billing_region and
 * dispatches to the right provider lib.
 */
export type BillingProvider = "stripe" | "razorpay";
export type BillingRegion = "US" | "IN";

export interface RegionInfo {
  id:       BillingRegion;
  label:    string;
  provider: BillingProvider;
  currency: string;
}

export const REGIONS: RegionInfo[] = [
  { id: "US", label: "United States", provider: "stripe",   currency: "USD" },
  { id: "IN", label: "India",         provider: "razorpay", currency: "INR" },
];

export function providerForRegion(region: string | null | undefined): BillingProvider {
  return region === "IN" ? "razorpay" : "stripe";
}

export function regionInfo(region: string | null | undefined): RegionInfo {
  return REGIONS.find(r => r.id === region) ?? REGIONS[0];
}
