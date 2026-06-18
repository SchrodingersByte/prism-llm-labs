"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check, Building2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPatch, apiPost } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";
import { PLANS, PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { REGIONS, type BillingRegion } from "@/lib/billing/provider";

export interface OrgOption {
  id: string;
  name: string;
}

const ORG_TYPES = [
  { id: "personal", label: "Personal" },
  { id: "team",     label: "Team" },
  { id: "business", label: "Business" },
  { id: "education", label: "Education" },
] as const;

function priceLabel(p: PlanId): string {
  const plan = PLANS[p];
  if (plan.priceUsd === null) return "Custom";
  return plan.priceUsd === 0 ? "$0/mo" : `$${plan.priceUsd}/mo`;
}

export function OrgSwitcher({ orgs, activeOrgId }: { orgs: OrgOption[]; activeOrgId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<string>("personal");
  const [plan, setPlan] = useState<PlanId>("free");
  const [region, setRegion] = useState<BillingRegion>("US");

  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const isPaid = plan === "pro" || plan === "team";

  async function switchOrg(id: string) {
    if (id === activeOrgId || pending) return;
    setPending(true);
    try {
      await apiPatch("/api/user/active-org", { org_id: id });
      router.refresh();
      toast.success("Workspace switched");
    } catch {
      toast.error("Couldn't switch workspace");
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setName(""); setType("personal"); setPlan("free"); setRegion("US");
  }

  async function submit() {
    const org_name = name.trim();
    if (!org_name || busy) return;
    setBusy(true);
    try {
      if (plan === "enterprise") {
        window.open("mailto:sales@useprism.dev?subject=Enterprise%20plan%20enquiry");
        return;
      }
      if (plan === "free") {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) { toast.error("You're not signed in"); return; }
        await apiPost("/api/auth/create-org", { org_name, user_id: user.id, type, region });
        toast.success("Organization created");
        setOpen(false); reset();
        router.push("/dashboard"); router.refresh();
        return;
      }
      // Paid (pro / team): bill at checkout BEFORE the org is created.
      const res = await apiPost<{ provider: string; url?: string; shortUrl?: string }>(
        "/api/billing/checkout-new-org",
        { org_name, plan, type, region },
      );
      if (res.url) { window.location.href = res.url; return; }
      if (res.shortUrl) { window.location.href = res.shortUrl; return; }
      toast.message("Checkout started", { description: "Complete payment to create the organization." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create organization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 gap-2 px-2" disabled={pending}>
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="max-w-[160px] truncate text-sm font-medium">{active?.name ?? "Workspace"}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {orgs.map((o) => (
            <DropdownMenuItem key={o.id} onClick={() => switchOrg(o.id)}>
              <span className="truncate">{o.name}</span>
              {o.id === activeOrgId && <Check className="ml-auto h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); }}>
            <Plus className="h-4 w-4" />
            Create organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create a new organization</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-sm text-muted-foreground">
            Organizations group your projects, each with its own members and billing.
          </p>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="new-org-name">Name</Label>
              <Input
                id="new-org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isPaid && submit()}
                placeholder="Acme Inc"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORG_TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={plan} onValueChange={(v) => setPlan(v as PlanId)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_IDS.map((p) => (
                    <SelectItem key={p} value={p}>{PLANS[p].name} — {priceLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isPaid && (
              <div className="space-y-1.5">
                <Label>Billing region</Label>
                <Select value={region} onValueChange={(v) => setRegion(v as BillingRegion)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.label} ({r.provider === "stripe" ? "Stripe" : "Razorpay"} · {r.currency})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              {plan === "free"
                ? "Free — your workspace is created instantly."
                : plan === "enterprise"
                ? "Enterprise is sales-led — we'll open an email to our team."
                : `Prism bills per organization. You'll be charged ${priceLabel(plan)} at checkout, and the workspace is created once payment succeeds.`}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {plan === "free" ? "Create organization" : plan === "enterprise" ? "Contact sales" : "Continue to payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
