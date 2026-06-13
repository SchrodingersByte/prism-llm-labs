/**
 * AWS Bedrock Guardrails — external safety provider for the guardrails evaluator.
 *
 * Calls the Bedrock ApplyGuardrail API via the same AWS SDK client bedrock.ts
 * uses (SigV4 handled by the SDK). Exposes an ExternalChecker the evaluator can
 * be given for profiles of type "bedrock".
 *
 * Credential source is INJECTED (makeBedrockChecker(resolveCreds)) rather than
 * read from the profile row, so AWS secrets never travel through the profiles
 * read API. The non-secret guardrail coordinates (id, version, region) live in
 * profile.config.
 */

import { BedrockRuntimeClient, ApplyGuardrailCommand } from "@aws-sdk/client-bedrock-runtime";
import type { BedrockCredentials } from "../../bedrock";
import type { ExternalCheckResult, ExternalChecker, GuardrailDirection, GuardrailProfile } from "../types";

export interface BedrockGuardrailConfig {
  guardrailIdentifier: string;
  guardrailVersion:    string;  // e.g. "DRAFT" or a published version like "1"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAssessmentTypes(resp: any): string[] {
  const out = new Set<string>();
  for (const a of (resp?.assessments ?? [])) {
    for (const t of (a?.topicPolicy?.topics ?? []))          if (t?.name) out.add(`topic:${t.name}`);
    for (const f of (a?.contentPolicy?.filters ?? []))       if (f?.type) out.add(`content:${String(f.type).toLowerCase()}`);
    for (const p of (a?.sensitiveInformationPolicy?.piiEntities ?? [])) if (p?.type) out.add(`pii:${String(p.type).toLowerCase()}`);
    for (const r of (a?.sensitiveInformationPolicy?.regexes ?? []))     if (r?.name) out.add(`regex:${r.name}`);
    for (const w of (a?.wordPolicy?.customWords ?? []))      if (w?.match) out.add("word");
  }
  return Array.from(out);
}

/**
 * Run one ApplyGuardrail call. Maps GUARDRAIL_INTERVENED → flagged, surfaces the
 * triggered assessment categories as `types`, and returns Bedrock's masked text
 * (when present) as the redacted payload.
 */
export async function applyBedrockGuardrail(
  creds:     BedrockCredentials,
  config:    BedrockGuardrailConfig,
  text:      string,
  direction: GuardrailDirection,
): Promise<ExternalCheckResult> {
  const client = new BedrockRuntimeClient({
    region:      creds.region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp: any = await client.send(new ApplyGuardrailCommand({
    guardrailIdentifier: config.guardrailIdentifier,
    guardrailVersion:    config.guardrailVersion,
    source:              direction === "output" ? "OUTPUT" : "INPUT",
    content:             [{ text: { text } }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);

  const flagged    = resp?.action === "GUARDRAIL_INTERVENED";
  const maskedText = resp?.outputs?.[0]?.text as string | undefined;

  return {
    flagged,
    types:           extractAssessmentTypes(resp),
    redactedPayload: flagged && maskedText ? [maskedText] : undefined,
  };
}

/**
 * Build an ExternalChecker for the evaluator. `resolveCreds` supplies the AWS
 * credentials for a given profile (e.g. decrypted from a Bedrock provider key) —
 * keeping secrets out of profile rows. Returns a no-op (never flags) when the
 * profile is not a Bedrock profile, has no guardrail id, or has no credentials.
 */
export function makeBedrockChecker(
  resolveCreds: (profile: GuardrailProfile) => BedrockCredentials | null,
): ExternalChecker {
  return async (profile, payload, direction) => {
    if (profile.type !== "bedrock") return { flagged: false, types: [] };

    const cfg = profile.config as { guardrail_id?: string; guardrail_version?: string } | undefined;
    if (!cfg?.guardrail_id) return { flagged: false, types: [] };

    const creds = resolveCreds(profile);
    if (!creds) return { flagged: false, types: [] };

    const text = payload.map(p => (typeof p === "string" ? p : JSON.stringify(p))).join("\n");
    return applyBedrockGuardrail(
      creds,
      { guardrailIdentifier: cfg.guardrail_id, guardrailVersion: cfg.guardrail_version ?? "DRAFT" },
      text,
      direction,
    );
  };
}
