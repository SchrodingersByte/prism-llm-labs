"use client";

import { useState, useRef, KeyboardEvent } from "react";
import {
  ShieldCheck, Gauge, DollarSign, Server, Eye,
  X, ChevronDown, Pencil, Check, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PolicyRow {
  id?:                      string;
  name:                     string;
  scope_type:               "org" | "project";
  scope_id:                 string;
  requests_per_minute:      number | null;
  tokens_per_day:           number | null;
  monthly_budget_usd:       number | null;
  daily_budget_usd:         number | null;
  soft_cap_pct:             number | null;
  soft_cap_fallback_model:  string | null;
  gateway_required:         boolean;
  data_residency_region:    "us" | "eu" | "apac" | null;
  model_policy:             "open" | "allowlist" | "blocklist" | "requires_approval";
  allowed_models:           string[];
  blocked_models:           string[];
  pii_detection_enabled:    boolean;
  pii_action:               "mask" | "block" | "log_only";
}

type Draft = Omit<PolicyRow, "id" | "scope_type" | "scope_id">;

const EMPTY_DRAFT: Draft = {
  name:                    "Workspace Policy",
  requests_per_minute:     null,
  tokens_per_day:          null,
  monthly_budget_usd:      null,
  daily_budget_usd:        null,
  soft_cap_pct:            null,
  soft_cap_fallback_model: null,
  gateway_required:        false,
  data_residency_region:   null,
  model_policy:            "open",
  allowed_models:          [],
  blocked_models:          [],
  pii_detection_enabled:   false,
  pii_action:              "mask",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, description }: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-950/60 border border-indigo-900/40">
        <Icon className="h-3.5 w-3.5 text-indigo-400" />
      </div>
      <div>
        <p className="text-[13px] font-semibold text-white">{title}</p>
        <p className="text-[11px] text-[#5a6b8c] mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// A minimal toggle (no external deps)
function Toggle({ checked, onChange, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
        checked ? "bg-indigo-600" : "bg-[#2a3450]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

// A simple tag-input for model lists
function ModelTagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  function add() {
    const val = input.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput("");
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !input && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 min-h-[38px] w-full rounded-lg bg-[#0d1117] border border-[#2a3450] px-2 py-1.5 cursor-text"
      onClick={() => ref.current?.focus()}
    >
      {tags.map(tag => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-md bg-indigo-950/60 border border-indigo-900/50 px-2 py-0.5 text-[11px] text-indigo-300"
        >
          {tag}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onChange(tags.filter(t => t !== tag)); }}
            className="text-indigo-400/60 hover:text-indigo-300"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[140px] bg-transparent text-[12px] text-white placeholder:text-[#3d4f6e] outline-none"
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-[#8b9ab0]">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg bg-[#0d1117] border border-[#2a3450] px-3 py-2 text-[13px] text-white placeholder:text-[#3d4f6e] outline-none focus:border-indigo-500 transition-colors";
const selectCls = inputCls + " appearance-none cursor-pointer";

// ── Section badges ─────────────────────────────────────────────────────────────

const MODEL_POLICY_LABELS: Record<PolicyRow["model_policy"], string> = {
  open:               "Open",
  allowlist:          "Allowlist",
  blocklist:          "Blocklist",
  requires_approval:  "Requires Approval",
};

const MODEL_POLICY_COLORS: Record<PolicyRow["model_policy"], string> = {
  open:               "bg-emerald-950/60 text-emerald-400 border-emerald-900/50",
  allowlist:          "bg-indigo-950/60 text-indigo-300 border-indigo-900/50",
  blocklist:          "bg-red-950/60 text-red-400 border-red-900/50",
  requires_approval:  "bg-amber-950/60 text-amber-400 border-amber-900/50",
};

const REGION_LABELS: Record<string, string> = { us: "US", eu: "EU", apac: "APAC" };
const PII_ACTION_LABELS: Record<string, string> = {
  mask: "Mask", block: "Block request", log_only: "Log only",
};

function ReadValue({ value }: { value: React.ReactNode }) {
  return <span className="text-[13px] text-white">{value ?? <span className="text-[#3d4f6e]">Not set</span>}</span>;
}

// ── Main card ─────────────────────────────────────────────────────────────────

interface PolicyCardProps {
  initialPolicy: PolicyRow | null;
  isOwner: boolean;
}

export function PolicyCard({ initialPolicy, isOwner }: PolicyCardProps) {
  const [policy,  setPolicy]  = useState<PolicyRow | null>(initialPolicy);
  const [draft,   setDraft]   = useState<Draft>(toDraft(initialPolicy));
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  function toDraft(p: PolicyRow | null): Draft {
    if (!p) return { ...EMPTY_DRAFT };
    const { id: _id, scope_type: _st, scope_id: _si, ...rest } = p;
    return rest;
  }

  function startEdit() {
    setDraft(toDraft(policy));
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Failed to save");
        return;
      }
      setPolicy(json.policy);
      setEditing(false);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  const p = policy;

  return (
    <div className="rounded-xl bg-[#0b0f1a] border border-[#1a2035] overflow-hidden">

      {/* ── Card header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a2035]">
        <div>
          <p className="text-[14px] font-semibold text-white">{p?.name ?? "Workspace Policy"}</p>
          <p className="text-[11px] text-[#5a6b8c] mt-0.5">Applies to all API keys in this workspace</p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="rounded-lg border border-[#2a3450] bg-transparent px-3 py-1.5 text-[12px] text-[#8b9ab0] hover:text-white hover:border-[#3d4f6e] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-[12px] font-medium text-white transition-colors disabled:opacity-50"
              >
                {saving
                  ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                  : <><Check className="h-3 w-3" />Save</>
                }
              </button>
            </>
          ) : isOwner ? (
            <button
              type="button"
              onClick={startEdit}
              className="flex items-center gap-1.5 rounded-lg border border-[#2a3450] bg-transparent px-3 py-1.5 text-[12px] text-[#8b9ab0] hover:text-white hover:border-[#3d4f6e] transition-colors"
            >
              <Pencil className="h-3 w-3" />Edit
            </button>
          ) : null}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-lg bg-red-950/40 border border-red-900/50 px-4 py-2.5 text-[12px] text-red-400">
          {error}
        </div>
      )}

      {/* ── Sections ── */}
      <div className="divide-y divide-[#1a2035]">

        {/* 1. Model Access */}
        <Section icon={ShieldCheck} title="Model Access" description="Control which AI models can be used">
          {editing ? (
            <div className="flex flex-col gap-3">
              <Field label="Policy type">
                <div className="relative">
                  <select
                    value={draft.model_policy}
                    onChange={e => patch("model_policy", e.target.value as Draft["model_policy"])}
                    className={selectCls}
                  >
                    <option value="open">Open — allow all models</option>
                    <option value="allowlist">Allowlist — only permitted models</option>
                    <option value="blocklist">Blocklist — block specific models</option>
                    <option value="requires_approval">Requires approval</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5a6b8c]" />
                </div>
              </Field>
              {draft.model_policy === "allowlist" && (
                <Field label="Allowed models (press Enter to add)">
                  <ModelTagInput
                    tags={draft.allowed_models}
                    onChange={v => patch("allowed_models", v)}
                    placeholder="e.g. gpt-4o, claude-3-5-sonnet*, anthropic/*"
                  />
                </Field>
              )}
              {draft.model_policy === "blocklist" && (
                <Field label="Blocked models (press Enter to add)">
                  <ModelTagInput
                    tags={draft.blocked_models}
                    onChange={v => patch("blocked_models", v)}
                    placeholder="e.g. gpt-4o, o1-preview"
                  />
                </Field>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <span className={cn(
                "inline-flex w-fit rounded-md border px-2.5 py-1 text-[12px] font-medium",
                MODEL_POLICY_COLORS[p?.model_policy ?? "open"],
              )}>
                {MODEL_POLICY_LABELS[p?.model_policy ?? "open"]}
              </span>
              {p?.model_policy === "allowlist" && p.allowed_models.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.allowed_models.map(m => (
                    <span key={m} className="rounded-md bg-[#0d1117] border border-[#2a3450] px-2 py-0.5 text-[11px] text-[#8b9ab0]">{m}</span>
                  ))}
                </div>
              )}
              {p?.model_policy === "blocklist" && p.blocked_models.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.blocked_models.map(m => (
                    <span key={m} className="rounded-md bg-[#0d1117] border border-[#2a3450] px-2 py-0.5 text-[11px] text-[#8b9ab0]">{m}</span>
                  ))}
                </div>
              )}
              {(!p || p.model_policy === "open") && (
                <p className="text-[12px] text-[#5a6b8c]">All models are permitted. No restrictions in place.</p>
              )}
            </div>
          )}
        </Section>

        {/* 2. Rate Controls */}
        <Section icon={Gauge} title="Rate Controls" description="Limit request throughput and token volume">
          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max requests / minute">
                <input
                  type="number"
                  min={1}
                  value={draft.requests_per_minute ?? ""}
                  onChange={e => patch("requests_per_minute", e.target.value ? Number(e.target.value) : null)}
                  placeholder="Unlimited"
                  className={inputCls}
                />
              </Field>
              <Field label="Max tokens / day">
                <input
                  type="number"
                  min={1}
                  value={draft.tokens_per_day ?? ""}
                  onChange={e => patch("tokens_per_day", e.target.value ? Number(e.target.value) : null)}
                  placeholder="Unlimited"
                  className={inputCls}
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[11px] text-[#5a6b8c] mb-1">Requests / min</p>
                <ReadValue value={p?.requests_per_minute != null ? `${p.requests_per_minute.toLocaleString()} rpm` : null} />
              </div>
              <div>
                <p className="text-[11px] text-[#5a6b8c] mb-1">Tokens / day</p>
                <ReadValue value={p?.tokens_per_day != null ? `${p.tokens_per_day.toLocaleString()} tok` : null} />
              </div>
            </div>
          )}
        </Section>

        {/* 3. Budget Caps */}
        <Section icon={DollarSign} title="Budget Caps" description="Set spend limits and soft-cap fallback behaviour">
          {editing ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Daily limit (USD)">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={draft.daily_budget_usd ?? ""}
                    onChange={e => patch("daily_budget_usd", e.target.value ? Number(e.target.value) : null)}
                    placeholder="No limit"
                    className={inputCls}
                  />
                </Field>
                <Field label="Monthly limit (USD)">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={draft.monthly_budget_usd ?? ""}
                    onChange={e => patch("monthly_budget_usd", e.target.value ? Number(e.target.value) : null)}
                    placeholder="No limit"
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Soft-cap threshold (% of monthly)">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.soft_cap_pct ?? ""}
                    onChange={e => patch("soft_cap_pct", e.target.value ? Number(e.target.value) : null)}
                    placeholder="No soft cap"
                    className={inputCls}
                  />
                </Field>
                {draft.soft_cap_pct != null && (
                  <Field label="Fallback model at soft cap">
                    <input
                      type="text"
                      value={draft.soft_cap_fallback_model ?? ""}
                      onChange={e => patch("soft_cap_fallback_model", e.target.value || null)}
                      placeholder="e.g. gpt-4o-mini"
                      className={inputCls}
                    />
                  </Field>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <p className="text-[11px] text-[#5a6b8c] mb-1">Daily limit</p>
                <ReadValue value={p?.daily_budget_usd != null ? `$${p.daily_budget_usd.toFixed(2)}` : null} />
              </div>
              <div>
                <p className="text-[11px] text-[#5a6b8c] mb-1">Monthly limit</p>
                <ReadValue value={p?.monthly_budget_usd != null ? `$${p.monthly_budget_usd.toFixed(2)}` : null} />
              </div>
              <div>
                <p className="text-[11px] text-[#5a6b8c] mb-1">Soft-cap threshold</p>
                <ReadValue value={p?.soft_cap_pct != null ? `${p.soft_cap_pct}% of monthly` : null} />
              </div>
              {p?.soft_cap_pct != null && (
                <div>
                  <p className="text-[11px] text-[#5a6b8c] mb-1">Fallback model</p>
                  <ReadValue value={p.soft_cap_fallback_model} />
                </div>
              )}
            </div>
          )}
        </Section>

        {/* 4. Gateway & Residency */}
        <Section icon={Server} title="Gateway & Infrastructure" description="Force gateway mode and pin data to a region">
          {editing ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] text-white">Gateway required</p>
                  <p className="text-[11px] text-[#5a6b8c] mt-0.5">All traffic must route through the Prism gateway</p>
                </div>
                <Toggle checked={draft.gateway_required} onChange={v => patch("gateway_required", v)} />
              </div>
              <Field label="Data residency region">
                <div className="relative">
                  <select
                    value={draft.data_residency_region ?? ""}
                    onChange={e => patch("data_residency_region", (e.target.value || null) as Draft["data_residency_region"])}
                    className={selectCls}
                  >
                    <option value="">No restriction</option>
                    <option value="us">United States (US)</option>
                    <option value="eu">Europe (EU)</option>
                    <option value="apac">Asia-Pacific (APAC)</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5a6b8c]" />
                </div>
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[11px] text-[#5a6b8c] mb-1">Gateway mode</p>
                <span className={cn(
                  "inline-flex rounded-md border px-2.5 py-1 text-[12px] font-medium",
                  p?.gateway_required
                    ? "bg-emerald-950/60 text-emerald-400 border-emerald-900/50"
                    : "bg-[#0d1117] text-[#5a6b8c] border-[#2a3450]",
                )}>
                  {p?.gateway_required ? "Required" : "Optional"}
                </span>
              </div>
              <div>
                <p className="text-[11px] text-[#5a6b8c] mb-1">Data residency</p>
                <ReadValue value={p?.data_residency_region ? REGION_LABELS[p.data_residency_region] : null} />
              </div>
            </div>
          )}
        </Section>

        {/* 5. Privacy & PII */}
        <Section icon={Eye} title="Privacy & PII" description="Detect and act on personally identifiable information">
          {editing ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] text-white">PII detection</p>
                  <p className="text-[11px] text-[#5a6b8c] mt-0.5">Scan prompts and completions for sensitive data</p>
                </div>
                <Toggle checked={draft.pii_detection_enabled} onChange={v => patch("pii_detection_enabled", v)} />
              </div>
              {draft.pii_detection_enabled && (
                <Field label="Action on detection">
                  <div className="relative">
                    <select
                      value={draft.pii_action}
                      onChange={e => patch("pii_action", e.target.value as Draft["pii_action"])}
                      className={selectCls}
                    >
                      <option value="mask">Mask — redact PII before forwarding</option>
                      <option value="block">Block — reject the request entirely</option>
                      <option value="log_only">Log only — record but don't alter</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5a6b8c]" />
                  </div>
                </Field>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[11px] text-[#5a6b8c] mb-1">PII scanning</p>
                <span className={cn(
                  "inline-flex rounded-md border px-2.5 py-1 text-[12px] font-medium",
                  p?.pii_detection_enabled
                    ? "bg-indigo-950/60 text-indigo-300 border-indigo-900/50"
                    : "bg-[#0d1117] text-[#5a6b8c] border-[#2a3450]",
                )}>
                  {p?.pii_detection_enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              {p?.pii_detection_enabled && (
                <div>
                  <p className="text-[11px] text-[#5a6b8c] mb-1">Action</p>
                  <ReadValue value={PII_ACTION_LABELS[p.pii_action]} />
                </div>
              )}
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({ icon, title, description, children }: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-6 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <div className="sm:w-52 shrink-0">
          <SectionHeader icon={icon} title={title} description={description} />
        </div>
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
