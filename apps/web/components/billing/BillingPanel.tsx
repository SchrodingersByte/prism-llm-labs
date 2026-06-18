"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost } from "@/lib/api/client";
import { PLANS, PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { useRole } from "@/components/layout/role-context";
import { cn } from "@/lib/utils";

interface BillingStatus {
  plan: { id: PlanId; name: string; priceUsd: number | null; memberLimit: number | null; eventsIncluded: number | null; retentionDays: number };
  subscription_status: string;
  trial_ends_at: string | null;
  billing: { region: "US" | "IN"; provider: string };
  members: { used: number; limit: number | null };
  usage: { eventsUsed: number; eventsIncluded: number | null; overage: number; pctUsed: number };
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function UsagePanel({ usage, retentionDays }: { usage: BillingStatus["usage"]; retentionDays: number }) {
  const unlimited = usage.eventsIncluded === null;
  const pct = Math.min(usage.pctUsed, 100);
  const tone = usage.pctUsed >= 100 ? "bg-[hsl(var(--signal))]" : usage.pctUsed >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="tabular font-medium">{compact.format(usage.eventsUsed)}</span>
        <span className="text-xs text-muted-foreground">{unlimited ? "unlimited" : `of ${compact.format(usage.eventsIncluded ?? 0)} events`}</span>
      </div>
      {!unlimited && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
        </div>
      )}
      {usage.overage > 0 && <p className="signal text-xs">{compact.format(usage.overage)} events over quota</p>}
      <p className="text-xs text-muted-foreground">{retentionDays}-day data retention</p>
    </div>
  );
}

function MembersPanel({ members }: { members: BillingStatus["members"] }) {
  const unlimited = members.limit === null;
  const atCap = !unlimited && members.used >= (members.limit ?? 0);
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="tabular font-medium">{members.used}</span>
        <span className="text-xs text-muted-foreground">{unlimited ? "unlimited seats" : `of ${members.limit} seats`}</span>
      </div>
      {atCap && <p className="text-xs text-amber-500">You&apos;re at your member limit — upgrade to add more.</p>}
    </div>
  );
}

/** Billing content (region · plans · usage · members · invoices) without a page header,
 *  so it can render under the Settings tab shell. */
export function BillingPanel() {
  const isOwner = useRole() === "owner";
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["billing-status"],
    queryFn: () => apiGet<BillingStatus>("/api/billing/status"),
  });

  async function setRegion(region: "US" | "IN") {
    if (!isOwner) return;
    setBusy("region");
    try {
      await apiPost("/api/billing/region", { region });
      await qc.invalidateQueries({ queryKey: ["billing-status"] });
      toast.success(`Billing region set to ${region === "US" ? "United States" : "India"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't set region");
    } finally { setBusy(null); }
  }

  async function checkout(plan: "pro" | "team") {
    setBusy(plan);
    try {
      const res = await apiPost<{ provider: string; url?: string; shortUrl?: string }>("/api/billing/checkout", { plan });
      if (res.url) { window.location.href = res.url; return; }
      if (res.shortUrl) { window.open(res.shortUrl, "_blank"); return; }
      toast.message("Checkout started", { description: "Complete payment to activate the plan." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally { setBusy(null); }
  }

  async function downgrade() {
    setBusy("free");
    try {
      await apiPost("/api/billing/downgrade", {});
      await qc.invalidateQueries({ queryKey: ["billing-status"] });
      toast.success("Downgraded to Free");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't downgrade");
    } finally { setBusy(null); }
  }

  const currentId = status?.plan.id ?? "free";
  const currentRank = PLANS[currentId].rank;

  return (
    <div className="space-y-6 p-5">
      <section className="dash-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Payment region</h3>
            <p className="text-xs text-muted-foreground">Sets the checkout provider — United States (Stripe) or India (Razorpay).</p>
          </div>
          <div className="flex items-center gap-1.5">
            {(["US", "IN"] as const).map((r) => (
              <Button key={r} size="sm" variant={status?.billing.region === r ? "default" : "outline"} disabled={!isOwner || busy === "region"} onClick={() => setRegion(r)}>
                {r === "US" ? "United States" : "India"}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PLAN_IDS.map((pid) => {
            const p = PLANS[pid];
            const isCurrent = pid === currentId;
            const higher = p.rank > currentRank;
            return (
              <div key={pid} className={cn("dash-card flex flex-col p-4", isCurrent && "ring-1 ring-primary")}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{p.name}</span>
                  {isCurrent && <Badge variant="info">Current</Badge>}
                </div>
                <div className="mt-2 text-2xl font-medium tabular">
                  {p.priceUsd === null ? "Custom" : p.priceUsd === 0 ? "$0" : `$${p.priceUsd}`}
                  {p.priceUsd ? <span className="text-xs font-normal text-muted-foreground">/mo</span> : null}
                </div>
                <ul className="mt-3 flex-1 space-y-1.5 text-xs text-muted-foreground">
                  <li>{p.memberLimit === Infinity ? "Unlimited" : p.memberLimit} members</li>
                  <li>{p.eventsIncluded === Infinity ? "Unlimited" : compact.format(p.eventsIncluded)} events/mo</li>
                  <li>{p.retentionDays}-day retention</li>
                  {p.overagePer1k ? <li>${p.overagePer1k}/1k overage</li> : null}
                </ul>
                <div className="mt-3">
                  {isCurrent ? (
                    <Button size="sm" variant="outline" className="w-full" disabled>Current plan</Button>
                  ) : pid === "enterprise" ? (
                    <Button size="sm" variant="outline" className="w-full" disabled={!isOwner} onClick={() => window.open("mailto:sales@useprism.dev")}>Contact sales</Button>
                  ) : higher ? (
                    <Button size="sm" className="w-full" disabled={!isOwner || busy === pid} onClick={() => checkout(pid as "pro" | "team")}>
                      {busy === pid ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upgrade"}
                    </Button>
                  ) : pid === "free" ? (
                    <Button size="sm" variant="outline" className="w-full" disabled={!isOwner || busy === "free"} onClick={downgrade}>
                      {busy === "free" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Downgrade"}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="w-full" disabled>—</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!isOwner && <p className="mt-2 text-xs text-muted-foreground">Only the workspace owner can change the plan or region.</p>}
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="dash-card p-4">
          <h3 className="text-sm font-medium">Usage this month</h3>
          {isLoading || !status ? <Skeleton className="mt-3 h-16 w-full" /> : <UsagePanel usage={status.usage} retentionDays={status.plan.retentionDays} />}
        </div>
        <div className="dash-card p-4">
          <h3 className="text-sm font-medium">Members</h3>
          {isLoading || !status ? <Skeleton className="mt-3 h-16 w-full" /> : <MembersPanel members={status.members} />}
        </div>
      </section>

      <section className="dash-card p-4">
        <h3 className="text-sm font-medium">Invoices</h3>
        <p className="mt-2 text-xs text-muted-foreground">No invoices yet. Paid invoices appear here once you upgrade.</p>
      </section>
    </div>
  );
}
