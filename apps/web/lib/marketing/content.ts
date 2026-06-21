/**
 * Marketing content — single source of truth for the public site.
 * Feature groups, FAQ, nav + footer links, provider list, and headline stats.
 * Imported by both server and client components (no "use client" here).
 */
import type { LucideIcon } from "lucide-react";
import {
  Network, Code2, Activity, Wallet, ShieldCheck, Calculator,
  Workflow, FlaskConical, Waves, Radar, Bell,
} from "lucide-react";
import type { VizKind } from "@/components/marketing/FeatureVisuals";

export type Accent = "violet" | "sky" | "emerald" | "gold" | "coral";

export interface FeatureGroup {
  id: string;
  icon: LucideIcon;
  title: string;
  tagline: string;
  bullets: string[];
  accent: Accent;
  href?: string;
}

/** The ten capability pillars, ordered for the landing narrative. */
export const FEATURES: FeatureGroup[] = [
  {
    id: "gateway",
    icon: Network,
    title: "Universal LLM gateway",
    tagline: "One endpoint, every provider, full control on the wire.",
    accent: "violet",
    href: "/docs#gateway",
    bullets: [
      "Route 16+ providers through a single OpenAI-compatible URL",
      "Enforce model policies, data residency, and spend caps inline",
      "Automatic fallback chains and soft-cap model downgrades",
    ],
  },
  {
    id: "sdks",
    icon: Code2,
    title: "Drop-in SDKs",
    tagline: "Swap one import. Keep your code. Get full telemetry.",
    accent: "sky",
    href: "/docs#install",
    bullets: [
      "TypeScript & Python drop-in clients — no call-site changes",
      "MCP wrapper, import interceptor, and zero-code proxy CLI",
      "Works in SDK mode (direct) or gateway mode (auto-detected)",
    ],
  },
  {
    id: "observability",
    icon: Activity,
    title: "Cost & usage observability",
    tagline: "Every call, every token, every dollar — in real time.",
    accent: "emerald",
    href: "/docs#telemetry",
    bullets: [
      "Live KPIs: spend, requests, tokens, latency, error rate",
      "Per-model, per-project, per-key breakdowns with sparklines",
      "Sub-second analytics backed by a columnar pipeline",
    ],
  },
  {
    id: "finops",
    icon: Wallet,
    title: "FinOps & chargeback",
    tagline: "Attribute spend to the team that drove it.",
    accent: "gold",
    bullets: [
      "Spend by project, team, key, branch, and GL cost center",
      "Vendor spend, budgets, and forecast burn-down",
      "Unified LLM + MCP + training infrastructure cost view",
    ],
  },
  {
    id: "governance",
    icon: ShieldCheck,
    title: "Governance & guardrails",
    tagline: "Policy on the request path, not in a spreadsheet.",
    accent: "coral",
    bullets: [
      "Org model policies: allow, block, or require approval",
      "Content safety — warn / block / redact with PII detection",
      "Per-key spend caps, data residency, and approval workflows",
    ],
  },
  {
    id: "unit-economics",
    icon: Calculator,
    title: "Unit economics",
    tagline: "Connect model spend to business outcomes.",
    accent: "violet",
    bullets: [
      "Cost per feature and per business action",
      "Cache hit rate and tokens-per-dollar efficiency",
      "Efficiency trends that surface optimization wins",
    ],
  },
  {
    id: "agents",
    icon: Workflow,
    title: "Agents & MCP analytics",
    tagline: "See what your agents actually cost — tool by tool.",
    accent: "sky",
    bullets: [
      "Session traces linking LLM calls to tool calls",
      "Per-tool breakdown and repeated-loop detection",
      "Vector DB cost attribution via downstream resources",
    ],
  },
  {
    id: "quality",
    icon: FlaskConical,
    title: "Quality & evals",
    tagline: "Ship prompts with evidence, not vibes.",
    accent: "emerald",
    bullets: [
      "Annotations, error analysis, and prompt management",
      "Arena to compare models side by side",
      "Eval runs scored against your own criteria",
    ],
  },
  {
    id: "drift",
    icon: Waves,
    title: "Drift & anomaly detection",
    tagline: "Catch the spike before the invoice does.",
    accent: "gold",
    bullets: [
      "Cost-spike anomaly detection across providers",
      "Model and quality drift monitoring",
      "Alerts wired to the channels you already use",
    ],
  },
  {
    id: "compliance",
    icon: Radar,
    title: "Shadow IT & compliance",
    tagline: "Find the un-instrumented spend you can't see.",
    accent: "coral",
    bullets: [
      "Detect SDK bypasses and measure gateway coverage",
      "Audit log and actual-vs-estimated cost reconciliation",
      "Per-customer P&L for usage-based businesses",
    ],
  },
];

/* ── Features page: capability areas (mirrors the product's own IA) ──────────
   Each area carries an illustrative visual (CategoryVisual) + the specific,
   named features it ships and what each does — grounded in the live nav,
   Tinybird pipes, and SDK surface. */
export interface Capability { name: string; desc: string }
export interface FeatureCategory {
  id: string;
  icon: LucideIcon;
  title: string;
  intro: string;
  accent: Accent;
  visual: VizKind;
  capabilities: Capability[];
}

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    id: "capture",
    icon: Network,
    title: "Capture everything",
    intro: "One integration. Every model and tool call recorded — your way, with zero call-site changes.",
    accent: "violet",
    visual: "capture",
    capabilities: [
      { name: "Universal gateway", desc: "One OpenAI-compatible endpoint for 16+ providers, with inline policy, fallbacks, and capture." },
      { name: "Drop-in SDKs", desc: "TypeScript & Python clients — swap a single import and keep every call site exactly as-is." },
      { name: "MCP & tool tracking", desc: "Wrap tool calls and attribute vector-DB cost via downstream resources (Pinecone, Qdrant)." },
      { name: "Enforce & proxy", desc: "Import interceptor and a zero-code proxy CLI surface any un-instrumented traffic." },
    ],
  },
  {
    id: "observe",
    icon: Activity,
    title: "See every dollar in real time",
    intro: "Live cost, usage, and performance across every model, provider, session, and project.",
    accent: "sky",
    visual: "observe",
    capabilities: [
      { name: "Command Center", desc: "A customizable overview: cost, requests, tokens, error rate, and spend trend — with role templates." },
      { name: "Models", desc: "Per-model spend, cache-hit rate, tokens-per-dollar, latency and TTFT percentiles, plus side-by-side compare." },
      { name: "Sessions & traces", desc: "Session list → trace waterfall → payload viewer, with the true cost of every session." },
      { name: "Logs", desc: "A searchable request-log explorer; jump from any row straight to its full trace." },
      { name: "Agents & MCP", desc: "Per-tool cost breakdown, agent loop detection, and vector-DB cost attribution." },
    ],
  },
  {
    id: "finops",
    icon: Wallet,
    title: "Control spend with FinOps",
    intro: "Attribute every dollar to the team that drove it — and stop overspend before the invoice lands.",
    accent: "gold",
    visual: "finops",
    capabilities: [
      { name: "Vendor spend & chargeback", desc: "Spend by provider, project, team, key, git branch, developer, and GL cost center." },
      { name: "Budgets & forecasts", desc: "Org and project budgets with burn-down and forecast; hard caps on Free, predictable overage on paid." },
      { name: "Unit economics", desc: "Cost per feature and per action, tokens-per-dollar, cache-hit rate, and cost-per-outcome / ROI." },
      { name: "Infrastructure & training", desc: "A unified LLM + MCP + vector-DB + fine-tuning cost view, reconciled to your actual cloud bills." },
      { name: "Anomaly detection", desc: "Automatic cost-spike detection across providers and models, before it compounds." },
    ],
  },
  {
    id: "govern",
    icon: ShieldCheck,
    title: "Govern & secure",
    intro: "Put policy on the request path — enforced inline at the gateway, not buried in a spreadsheet.",
    accent: "coral",
    visual: "govern",
    capabilities: [
      { name: "Model governance", desc: "Allow, block, or require approval per model and per scope, with a built-in approval queue." },
      { name: "Guardrails", desc: "Warn / block / redact on input and output, with built-in PII detection and masking." },
      { name: "Spend caps & residency", desc: "Per-key multi-period spend caps and data-residency policies that pin traffic to a region." },
      { name: "Shadow IT", desc: "A gateway-coverage score plus SDK-bypass detection to find un-instrumented spend." },
      { name: "Compliance & audit", desc: "Audit log, cost reconciliation, and per-project content-capture controls." },
    ],
  },
  {
    id: "quality",
    icon: FlaskConical,
    title: "Improve quality",
    intro: "Ship prompt and model changes with evidence. Score, compare, review, and catch drift.",
    accent: "emerald",
    visual: "quality",
    capabilities: [
      { name: "Quality scoring", desc: "LLM-judge scores by model and scorer — faithfulness, answer relevancy, toxicity, hallucination, and more." },
      { name: "Prompt registry", desc: "Named prompts → immutable versions → movable production / staging labels, decoupled from deploys." },
      { name: "Evals & experiments", desc: "Run a subject over a dataset, compare against a baseline, and gate CI on the verdict." },
      { name: "Arena", desc: "Run one prompt against multiple models side by side with real, normalized cost." },
      { name: "Annotations & feedback", desc: "A human review queue plus end-user thumbs that calibrate the automated judge." },
      { name: "Drift & errors", desc: "Drift by segment and clustered error signatures that drill straight to the offending traces." },
    ],
  },
  {
    id: "operate",
    icon: Bell,
    title: "Operate & grow",
    intro: "Run the platform day to day — and connect model spend all the way to revenue.",
    accent: "violet",
    visual: "operate",
    capabilities: [
      { name: "Alerts", desc: "12 trigger types — budget, spend spike, anomaly, error rate, tool-loop, PII, drift, and more — to email, Slack, or webhook." },
      { name: "Customers P&L", desc: "Cost-to-serve, revenue, and gross margin per customer, with unprofitable-account flags." },
      { name: "Copilot", desc: "Ask questions in plain English; answers cite the underlying data and link to the trace." },
      { name: "Projects & teams", desc: "Project workspaces with cost attribution, four-role RBAC, invites, and per-project grants." },
    ],
  },
];

export interface FaqItem { q: string; a: string }

export const FAQS: FaqItem[] = [
  {
    q: "How does pricing work?",
    a: "Prism is metered on the telemetry events you ingest each month — not per seat. Free includes 100k events, Pro 2M, and Team 10M, with predictable overage on paid plans. Add as many teammates as your plan's member cap allows at no extra per-head cost.",
  },
  {
    q: "What counts as an event?",
    a: "One captured telemetry record — an LLM request or an MCP tool call — is one event. Metadata is always captured; prompt/response payload capture is optional and configurable per project.",
  },
  {
    q: "Do I have to route my traffic through Prism?",
    a: "No. In SDK mode the wrapper captures usage in-process and ships telemetry directly — your provider traffic never touches our servers. Gateway mode is opt-in for teams that want inline policy enforcement, fallbacks, and guardrails.",
  },
  {
    q: "Which providers and models are supported?",
    a: "OpenAI, Anthropic, Google, Azure OpenAI, AWS Bedrock, Mistral, Cohere, Groq, xAI, Together, Fireworks, Perplexity, OpenRouter, Cerebras, and Nebius — plus Ollama and any OpenAI-compatible endpoint for local or self-hosted models.",
  },
  {
    q: "Is my prompt and response data stored?",
    a: "Only if you opt in. Content capture defaults to metadata-only; you can enable redacted or full-content capture per project, with a configurable retention window and built-in PII detection and masking.",
  },
  {
    q: "Can I enforce budgets and spend caps?",
    a: "Yes. Set monthly budgets per org or project and multi-period spend caps per key. Free plans hard-stop ingestion at quota; paid plans bill predictable overage so you're never surprised or cut off.",
  },
  {
    q: "Do you track fine-tuning and infrastructure costs?",
    a: "Yes. Training runs, vector DB usage, and MCP infrastructure reconcile against actual cloud bills, giving you a single unified cost view across inference, training, and tooling.",
  },
  {
    q: "How long does it take to get started?",
    a: "Minutes. Install the SDK, set PRISM_API_KEY, and swap one import. Your first events appear on the dashboard in real time — no infrastructure to deploy.",
  },
  {
    q: "Is there a free trial?",
    a: "The Free plan is free forever within its quota. Paid plans include a 14-day trial, and Enterprise adds SSO, custom retention, and a dedicated environment.",
  },
];

export interface NavLink { label: string; href: string }

export const NAV_LINKS: NavLink[] = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "FAQ", href: "/faq" },
  { label: "Contact", href: "/contact" },
];

export interface FooterColumn { title: string; links: NavLink[] }

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "How it works", href: "/how-it-works" },
      { label: "Roadmap", href: "/roadmap" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "TypeScript SDK", href: "/docs#install" },
      { label: "Python SDK", href: "/docs#install" },
      { label: "Gateway", href: "/docs#gateway" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Contact", href: "/contact" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

/** Provider display names for the "works with everything" strip. */
export const PROVIDERS: string[] = [
  "OpenAI", "Anthropic", "Google", "Azure OpenAI", "AWS Bedrock", "Mistral",
  "Cohere", "Groq", "xAI", "Together", "Fireworks", "Perplexity",
  "OpenRouter", "Cerebras", "Nebius", "Ollama",
];

export interface Stat { value: string; label: string }

export const STATS: Stat[] = [
  { value: "16+", label: "providers, one API" },
  { value: "2", label: "drop-in SDKs" },
  { value: "<1s", label: "analytics freshness" },
  { value: "100%", label: "of spend attributed" },
];

export interface HowItWorksStep { step: string; title: string; body: string }

export const HOW_IT_WORKS: HowItWorksStep[] = [
  {
    step: "01",
    title: "Install & swap one import",
    body: "Add the Prism SDK and replace your provider client import. Your existing call sites stay exactly as they are.",
  },
  {
    step: "02",
    title: "Calls are captured",
    body: "In SDK mode telemetry ships directly; in gateway mode every call is proxied, governed, and recorded — your choice, no code change.",
  },
  {
    step: "03",
    title: "See, govern, optimize",
    body: "Spend, attribution, guardrails, and unit economics light up in real time. Set budgets, enforce policy, and cut waste.",
  },
];
