export type ResidencyPolicy = "any" | "eu_only" | "us_only" | "india_only";
export type DataRegion      = "global" | "eu" | "us" | "in";

// Region a region-locked policy requires, and its human label for error messages.
const POLICY_REGION: Record<Exclude<ResidencyPolicy, "any">, { region: DataRegion; label: string }> = {
  eu_only:     { region: "eu", label: "EU" },
  us_only:     { region: "us", label: "US" },
  india_only:  { region: "in", label: "India" },
};

/**
 * Returns whether a gateway request is allowed given the org's residency policy
 * and the declared region of the provider key being used.
 *
 * 'global' provider keys satisfy any policy — they indicate the vendor has no
 * specific region constraint (e.g. a standard OpenAI key with no DPA region).
 * NOTE: India data-localization (RBI / DPDP Act) may warrant a STRICT mode that
 * rejects 'global' for india_only; that is a deliberate follow-up, not the
 * default, to stay consistent with the eu_only / us_only semantics below.
 */
export function checkDataResidency(
  orgPolicy:         ResidencyPolicy,
  providerKeyRegion: DataRegion,
): { allowed: boolean; reason?: string } {
  if (orgPolicy === "any") return { allowed: true };

  const { region, label } = POLICY_REGION[orgPolicy];
  if (providerKeyRegion === region || providerKeyRegion === "global") {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason:  `Org policy requires ${label} data residency but provider key is declared region="${providerKeyRegion}". ` +
             `Use a provider key with data_region='${region}' or 'global'.`,
  };
}
