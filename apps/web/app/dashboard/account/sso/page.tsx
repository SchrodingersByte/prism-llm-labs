"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldHalf, Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns/EmptyState";
import { ChartCard } from "@/components/patterns/ChartCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiGet, apiPost } from "@/lib/api/client";
import { useRole } from "@/components/layout/role-context";

interface Account { id: string; name: string; slug: string; plan: string; sso_enabled: boolean; memberRole: string }

export default function SsoPage() {
  const role = useRole();
  const isOwner = role === "owner";
  const canManage = role === "owner" || role === "administrator";
  const qc = useQueryClient();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: ({ signal }) => apiGet<{ accounts: Account[] }>("/api/accounts", undefined, signal).then((r) => r.accounts ?? []),
    enabled: canManage,
  });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  if (!canManage) {
    return <div className="p-5"><EmptyState icon={ShieldHalf} title="SSO is manager-only" description="Single sign-on configuration is available to owners and admins." /></div>;
  }

  async function createAccount() {
    const n = name.trim();
    if (!n || busy) return;
    const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "account";
    setBusy(true);
    try {
      await apiPost("/api/accounts", { name: n, slug, plan: "enterprise" });
      toast.success("Enterprise account created");
      setOpen(false); setName("");
      await qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create account");
    } finally { setBusy(false); }
  }

  const account = (accounts ?? [])[0];

  if (isLoading) return <div className="p-5"><Skeleton className="h-40 w-full" /></div>;

  if (!account) {
    return (
      <div className="p-5">
        <EmptyState
          icon={ShieldHalf}
          title="Single sign-on is an Enterprise feature"
          description="SAML / OIDC sign-on is configured at the enterprise-account level. Create an enterprise account to link this org and enable SSO."
          action={isOwner ? <Button size="sm" onClick={() => setOpen(true)}><Building2 className="h-4 w-4" />Create enterprise account</Button> : undefined}
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Create enterprise account</DialogTitle></DialogHeader>
            <p className="-mt-1 text-sm text-muted-foreground">Groups one or more orgs under a single enterprise contract with SSO and SAML/OIDC.</p>
            <div className="space-y-1.5"><Label htmlFor="acct-name">Account name</Label><Input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Enterprise" autoFocus /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={createAccount} disabled={busy || !name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-3 p-5">
      <div className="col-span-12 lg:col-span-6">
        <ChartCard title="Enterprise account">
          <div className="space-y-2">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">{account.name}</span><span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize">{account.plan.replace("_", " ")}</span></div>
            <p className="text-xs text-muted-foreground">Slug: <span className="font-mono">{account.slug}</span> · your role: {account.memberRole}</p>
          </div>
        </ChartCard>
      </div>
      <div className="col-span-12 lg:col-span-6">
        <ChartCard title="Single sign-on">
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
            <div><p className="text-sm">SAML / OIDC</p><p className="text-xs text-muted-foreground">{account.sso_enabled ? "Sign-on is active for this account." : "Not configured yet."}</p></div>
            <span className={account.sso_enabled ? "positive text-xs font-medium" : "text-xs text-muted-foreground"}>{account.sso_enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Provider metadata (IdP entity ID, ACS URL, certificate) is exchanged during enterprise onboarding. Contact your account team to complete SAML/OIDC setup.</p>
        </ChartCard>
      </div>
    </div>
  );
}
