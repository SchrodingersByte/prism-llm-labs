"use client";

import { useState } from "react";
import { DollarSign, Activity, Cpu, AlertTriangle, Inbox, type LucideIcon } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/patterns/PageHeader";
import { KpiCard } from "@/components/patterns/KpiCard";
import { ChartCard } from "@/components/patterns/ChartCard";
import { DataTable } from "@/components/patterns/DataTable";
import { EmptyState } from "@/components/patterns/EmptyState";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";
import { Sparkline } from "@/components/charts/Sparkline";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { Donut } from "@/components/charts/Donut";
import { BarList } from "@/components/charts/BarList";
import { VIZ } from "@/lib/charts/theme";
import { formatCost } from "@/lib/utils";

const SPARK = [4, 6, 5, 8, 7, 9, 8, 11, 10, 13];
const AREA = Array.from({ length: 14 }, (_, i) => ({ date: `d${i + 1}`, cost: 2600 + i * 110 + (i % 3) * 80 }));
const DONUT = [
  { name: "OpenAI", value: 46 }, { name: "Anthropic", value: 33 },
  { name: "Google", value: 12 }, { name: "Other", value: 9 },
];
const BARS = [
  { label: "gpt-4o", value: 38 }, { label: "claude-sonnet-4", value: 29 },
  { label: "gpt-4o-mini", value: 18 }, { label: "gemini-2.0", value: 9 },
];

interface ModelRow { model: string; cost: number; requests: number }
const ROWS: ModelRow[] = [
  { model: "gpt-4o", cost: 18230.55, requests: 482000 },
  { model: "claude-sonnet-4", cost: 13980.12, requests: 351000 },
  { model: "gpt-4o-mini", cost: 4120.88, requests: 910000 },
];
const COLUMNS: ColumnDef<ModelRow>[] = [
  { accessorKey: "model", header: "Model" },
  { accessorKey: "cost", header: "Cost", cell: ({ getValue }) => formatCost(getValue<number>()) },
  { accessorKey: "requests", header: "Requests", cell: ({ getValue }) => getValue<number>().toLocaleString() },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function GalleryPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const KPIS: { label: string; value: string; color: "indigo" | "cyan" | "violet" | "amber"; icon: LucideIcon; spark: string }[] = [
    { label: "Total spend", value: "$48,210", color: "indigo", icon: DollarSign, spark: VIZ.indigo },
    { label: "Requests", value: "1.24M", color: "cyan", icon: Activity, spark: VIZ.cyan },
    { label: "Tokens", value: "894M", color: "violet", icon: Cpu, spark: VIZ.violet },
    { label: "Error rate", value: "0.42%", color: "amber", icon: AlertTriangle, spark: VIZ.amber },
  ];

  return (
    <div>
      <PageHeader title="Component gallery" description="Dev-only visual QA for the Phase 0 design system." />

      <div className="space-y-10 p-5">
        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
          </div>
        </Section>

        <Section title="Badges & status">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="danger">Danger</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="violet">Violet</Badge>
            <StatusBadge tone="success">Active</StatusBadge>
            <StatusBadge tone="warning">Paused</StatusBadge>
            <StatusBadge tone="danger">Error</StatusBadge>
          </div>
        </Section>

        <Section title="KPI cards">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {KPIS.map((k) => (
              <KpiCard
                key={k.label}
                label={k.label}
                value={k.value}
                icon={k.icon}
                color={k.color}
                delta={{ value: "12% vs prior", direction: "up", tone: "neutral" }}
                chart={<Sparkline data={SPARK} color={k.spark} />}
              />
            ))}
          </div>
        </Section>

        <Section title="Charts">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ChartCard title="Spend over time" className="lg:col-span-2">
              <AreaTrend data={AREA} xKey="date" yKey="cost" height={180} valueFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
            </ChartCard>
            <ChartCard title="Spend by provider">
              <Donut data={DONUT} height={180} valueFormatter={(v) => `${v}%`} />
            </ChartCard>
            <ChartCard title="Top models" className="lg:col-span-1">
              <BarList items={BARS} valueFormatter={(v) => `${v}%`} />
            </ChartCard>
            <ChartCard title="Recent activity" className="lg:col-span-2" contentClassName="p-0">
              <DataTable columns={COLUMNS} data={ROWS} />
            </ChartCard>
          </div>
        </Section>

        <Section title="Forms & inputs">
          <div className="flex max-w-md flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">Workspace name</Label>
              <Input id="g-name" placeholder="Acme Inc" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="g-switch" defaultChecked />
              <Label htmlFor="g-switch">Enable gateway mode</Label>
            </div>
            <Select defaultValue="prod">
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="prod">Production</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="dev">Development</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
            </TabsList>
            <TabsContent value="overview"><p className="text-sm text-muted-foreground">Overview tab content.</p></TabsContent>
            <TabsContent value="models"><p className="text-sm text-muted-foreground">Models tab content.</p></TabsContent>
            <TabsContent value="sessions"><p className="text-sm text-muted-foreground">Sessions tab content.</p></TabsContent>
          </Tabs>
        </Section>

        <Section title="Overlays">
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild><Button variant="outline">Hover for tooltip</Button></TooltipTrigger>
              <TooltipContent>A themed tooltip</TooltipContent>
            </Tooltip>
            <Dialog>
              <DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Example dialog</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">Dialog body content goes here.</p>
              </DialogContent>
            </Dialog>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>Delete (confirm)</Button>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Delete API key?"
              description="This action cannot be undone."
              confirmLabel="Delete"
              destructive
              onConfirm={() => setConfirmOpen(false)}
            />
          </div>
        </Section>

        <Section title="Empty state">
          <EmptyState
            icon={Inbox}
            title="No provider keys yet"
            description="Add your first provider key to start routing traffic through the gateway."
            action={<Button size="sm">Add provider key</Button>}
          />
        </Section>
      </div>
    </div>
  );
}
