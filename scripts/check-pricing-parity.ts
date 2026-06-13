/**
 * Pricing parity check — validates that the THREE model-pricing tables agree.
 *
 *   1. apps/web/lib/pricing/table.ts        ← the gateway bills from this one
 *   2. packages/typescript-sdk/src/pricing.ts
 *   3. packages/python-sdk/prism/_pricing.py
 *
 * Run:  pnpm test:pricing-parity
 * CI:   required check on PRs touching any of the three tables.
 *
 * Rules enforced:
 *  1. For any model shared by ≥2 tables, input / output / cached_input must be
 *     identical (±$0.0001 tolerance) → MISMATCH is fatal (exit 1).
 *  2. A model priced by an SDK but MISSING from the web billing table is a
 *     BILLING GAP — the gateway would record $0 cost for it. Listed loudly.
 *  3. Models present only in the web table (e.g. the OpenRouter long tail the
 *     SDKs don't ship) are benign coverage differences — summarised as a count.
 *
 * NOTE: packages/mcp-sdk/src/pricing.ts is a *tool*-cost catalog (per-call MCP
 * tool prices, mirrors apps/web/lib/pricing/tool-catalog.ts), NOT model pricing —
 * intentionally out of scope here.
 */

import { execSync } from "child_process";
import { MODEL_PRICING as TS_SDK_PRICING } from "../packages/typescript-sdk/src/pricing";
import { MODEL_PRICING as WEB_PRICING } from "../apps/web/lib/pricing/table";

// ── Shared shape ────────────────────────────────────────────────────────────

interface PriceEntry {
  provider?:     string;
  input:         number;
  output:        number;
  cached_input?: number;
}

const WEB_LABEL = "web/table.ts";

// ── Load Python pricing table (source of truth for the SDKs) ────────────────

function loadPythonPricing(): Record<string, PriceEntry> {
  const script = [
    "import json, sys",
    "sys.path.insert(0, 'packages/python-sdk')",
    "from prism._pricing import MODEL_PRICING",
    "print(json.dumps(MODEL_PRICING))",
  ].join("; ");

  for (const py of ["python3", "python"]) {
    try {
      const out = execSync(`${py} -c "${script}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return JSON.parse(out) as Record<string, PriceEntry>;
    } catch { /* try next interpreter */ }
  }
  console.error("[pricing-parity] Could not load Python pricing table.");
  console.error("  Ensure python3/python and packages/python-sdk are available.");
  process.exit(1);
}

// ── Comparison helpers ──────────────────────────────────────────────────────

function approxEqual(a: number, b: number, tolerance = 0.0001): boolean {
  return Math.abs(a - b) <= tolerance;
}

function cachedOf(e: PriceEntry): number | null {
  return e.cached_input ?? null;
}

/** Compare two entries; return a human-readable reason if they diverge, else null. */
function diff(a: PriceEntry, b: PriceEntry): string | null {
  const reasons: string[] = [];
  if (!approxEqual(a.input, b.input))   reasons.push(`input ${a.input}≠${b.input}`);
  if (!approxEqual(a.output, b.output)) reasons.push(`output ${a.output}≠${b.output}`);
  const ac = cachedOf(a), bc = cachedOf(b);
  const cachedMatch =
    ac === null && bc === null ? true
    : ac !== null && bc !== null ? approxEqual(ac, bc)
    : false; // one declares a cached rate, the other does not
  if (!cachedMatch) reasons.push(`cached ${ac ?? "—"}≠${bc ?? "—"}`);
  return reasons.length ? reasons.join(", ") : null;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const tables: Record<string, Record<string, PriceEntry>> = {
    [WEB_LABEL]:       WEB_PRICING as Record<string, PriceEntry>,
    "typescript-sdk":  TS_SDK_PRICING as Record<string, PriceEntry>,
    "python-sdk":      loadPythonPricing(),
  };
  const labels = Object.keys(tables);

  const allModels = new Set<string>();
  for (const t of Object.values(tables)) {
    for (const m of Object.keys(t)) allModels.add(m);
  }

  const mismatches: string[] = [];
  const billingGaps: string[] = [];   // priced by an SDK, missing from web billing table
  let   webOnly = 0;                   // benign: web table carries models the SDKs don't ship

  for (const model of Array.from(allModels).sort()) {
    const present = labels.filter(l => tables[l][model]);

    // Cross-check prices across every table that has the model.
    const ref = tables[present[0]][model];
    for (const l of present.slice(1)) {
      const reason = diff(ref, tables[l][model]);
      if (reason) {
        mismatches.push(
          `  MISMATCH "${model}": ${reason}\n` +
          `      ${present[0]}: input=${ref.input} output=${ref.output} cached=${cachedOf(ref) ?? "—"}\n` +
          `      ${l}: input=${tables[l][model].input} output=${tables[l][model].output} cached=${cachedOf(tables[l][model]) ?? "—"}`,
        );
      }
    }

    // Coverage: the dangerous direction is "an SDK prices it but the gateway can't".
    const inWeb = !!tables[WEB_LABEL][model];
    const inAnySdk = !!tables["typescript-sdk"][model] || !!tables["python-sdk"][model];
    if (!inWeb && inAnySdk) {
      const sdks = labels.filter(l => l !== WEB_LABEL && tables[l][model]).join(", ");
      billingGaps.push(`  GAP  "${model}" priced by [${sdks}] but absent from ${WEB_LABEL} → gateway bills $0`);
    } else if (inWeb && !inAnySdk) {
      webOnly++;
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const counts = labels.map(l => `${l}: ${Object.keys(tables[l]).length}`).join(", ");
  console.log(`[pricing-parity] table sizes — ${counts}`);
  console.log(`[pricing-parity] ${webOnly} model(s) are web-only (e.g. OpenRouter long tail) — benign.`);

  if (billingGaps.length > 0) {
    console.warn(`\n[pricing-parity] ${billingGaps.length} billing gap(s) — SDK prices a model the gateway can't cost:`);
    billingGaps.forEach(g => console.warn(g));
  }

  if (mismatches.length > 0) {
    console.error(`\n[pricing-parity] ${mismatches.length} price mismatch(es) — FIX BEFORE MERGING:\n`);
    mismatches.forEach(m => console.error(m));
    process.exit(1);
  }

  console.log(`\n[pricing-parity] ✓ all shared models agree across the three tables.`);
}

main();
