/**
 * Auth showcase scenes — the rolling feature demo on /login and /signup.
 * Two narratives (solo builder vs team) rotate through accurate, real-tier
 * scenes. Sample chart numbers are illustrative; plan badges use real tiers.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity, Code2, Wallet, Calculator, FlaskConical, Waves,
  Workflow, Radar, Network, ShieldCheck, MapPin, ScrollText,
} from "lucide-react";
import type { Accent } from "./content";

export type ShowcaseMode = "solo" | "team";
export type VisualKind = "spend-bars" | "efficiency" | "sessions" | "governance" | "budget";
export type Tier = "Free" | "Pro" | "Enterprise";

export interface ShowcaseFeature { icon: LucideIcon; title: string; desc: string; badge: Tier }
export interface ShowcaseBar { label: string; pct: number; accent: Accent }
export interface ShowcaseStat { label: string; value: string; accent: Accent }
export interface GovRow { label: string; status: "allow" | "block" | "approve" }

export interface Scene {
  eyebrow: string;
  lead: string;
  accent: string;
  subtitle: string;
  features: ShowcaseFeature[];
  visual: VisualKind;
  bars?: ShowcaseBar[];
  stats?: ShowcaseStat[];
  rows?: GovRow[];
  budgetPct?: number;
}

export const MODE_LABEL: Record<ShowcaseMode, string> = {
  solo: "Solo developer",
  team: "Team",
};

export const SCENES: Record<ShowcaseMode, Scene[]> = {
  solo: [
    {
      eyebrow: "For solo builders",
      lead: "Ship fast,",
      accent: "spend smart.",
      subtitle: "See every model call the moment it happens — nothing to wire up.",
      visual: "spend-bars",
      features: [
        { icon: Activity, title: "Real-time cost", desc: "Spend, tokens & latency per call", badge: "Free" },
        { icon: Code2, title: "One-line setup", desc: "Swap one import, keep your code", badge: "Free" },
        { icon: Wallet, title: "Budget guardrails", desc: "Hard-stop before surprise bills", badge: "Free" },
      ],
      bars: [
        { label: "gpt-4o", pct: 46, accent: "violet" },
        { label: "claude-opus", pct: 31, accent: "sky" },
        { label: "gpt-4o-mini", pct: 14, accent: "emerald" },
        { label: "embeddings", pct: 9, accent: "gold" },
      ],
    },
    {
      eyebrow: "Efficiency",
      lead: "Cut waste,",
      accent: "keep quality.",
      subtitle: "Cache hit rate and tokens-per-dollar surface the cheap wins.",
      visual: "efficiency",
      features: [
        { icon: Calculator, title: "Unit economics", desc: "Cost per feature & action", badge: "Pro" },
        { icon: FlaskConical, title: "Model arena", desc: "Compare models side by side", badge: "Pro" },
        { icon: Waves, title: "Anomaly alerts", desc: "Catch spikes before the invoice", badge: "Pro" },
      ],
      stats: [
        { label: "Cache hit rate", value: "63%", accent: "emerald" },
        { label: "Tokens / $", value: "18.2k", accent: "violet" },
        { label: "Saved / mo", value: "$1,240", accent: "gold" },
      ],
    },
    {
      eyebrow: "Agents",
      lead: "Trace every",
      accent: "tool call.",
      subtitle: "Link LLM calls to MCP tools and see what each session really costs.",
      visual: "sessions",
      features: [
        { icon: Workflow, title: "Session traces", desc: "LLM + tool calls on one timeline", badge: "Pro" },
        { icon: Radar, title: "Loop detection", desc: "Spot runaway agent loops", badge: "Pro" },
        { icon: Network, title: "Vector DB costs", desc: "Attribute Pinecone / Qdrant spend", badge: "Pro" },
      ],
    },
  ],
  team: [
    {
      eyebrow: "For engineering teams",
      lead: "Attribute spend,",
      accent: "by the team.",
      subtitle: "Chargeback by project, team, key, branch, and GL cost center.",
      visual: "spend-bars",
      features: [
        { icon: Wallet, title: "FinOps & chargeback", desc: "Cost centers & budgets", badge: "Pro" },
        { icon: ShieldCheck, title: "Model governance", desc: "Allow, block or require approval", badge: "Pro" },
        { icon: Calculator, title: "Unit economics", desc: "Tie spend to outcomes", badge: "Pro" },
      ],
      bars: [
        { label: "platform", pct: 38, accent: "violet" },
        { label: "growth", pct: 27, accent: "sky" },
        { label: "research", pct: 21, accent: "emerald" },
        { label: "support", pct: 14, accent: "gold" },
      ],
    },
    {
      eyebrow: "Governance",
      lead: "Policy on the",
      accent: "request path.",
      subtitle: "Guardrails, residency, and caps enforced inline at the gateway.",
      visual: "governance",
      features: [
        { icon: ShieldCheck, title: "Guardrails", desc: "Warn / block / redact + PII", badge: "Pro" },
        { icon: MapPin, title: "Data residency", desc: "Pin traffic to a region", badge: "Pro" },
        { icon: Wallet, title: "Spend caps", desc: "Per-key, multi-period limits", badge: "Pro" },
      ],
      rows: [
        { label: "gpt-4o", status: "allow" },
        { label: "o1-preview", status: "approve" },
        { label: "deepseek-r1", status: "block" },
        { label: "claude-opus", status: "allow" },
      ],
    },
    {
      eyebrow: "At scale",
      lead: "Built for",
      accent: "the whole org.",
      subtitle: "SSO, audit, and reconciliation when usage gets serious.",
      visual: "budget",
      features: [
        { icon: ShieldCheck, title: "SSO / SAML", desc: "SCIM provisioning", badge: "Enterprise" },
        { icon: Radar, title: "Shadow IT", desc: "Find un-instrumented spend", badge: "Pro" },
        { icon: ScrollText, title: "Reconciliation", desc: "Actual vs estimated infra cost", badge: "Pro" },
      ],
      stats: [
        { label: "Budget", value: "$50k", accent: "violet" },
        { label: "Spent", value: "$38.6k", accent: "gold" },
      ],
      budgetPct: 77,
    },
  ],
};
