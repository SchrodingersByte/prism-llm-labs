import { randomBytes, createHash } from "crypto";

export interface GeneratedKey {
  /** Plaintext key — shown to the user exactly once; never stored. */
  rawKey:    string;
  /** sha256(rawKey) — what we persist + look up by. */
  keyHash:   string;
  /** First 12 chars of the raw key — stored for display. */
  keyPrefix: string;
}

/**
 * Generate a Prism API key of the form `prism_<env>_<orgPrefix>_<random>`.
 * `environment === "production"` → `live`, anything else → `test`.
 * Only the hash + prefix are persisted; the raw key is returned once.
 *
 * Single source of truth for key generation — used by POST /api/keys and the
 * onboarding default-key creation.
 */
export function generatePrismKey(environment: string, orgId: string): GeneratedKey {
  const orgPrefix = orgId.replace(/-/g, "").slice(0, 4);
  const envTag    = environment === "production" ? "live" : "test";
  const rawKey    = `prism_${envTag}_${orgPrefix}_${randomBytes(24).toString("hex")}`;
  const keyHash   = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);
  return { rawKey, keyHash, keyPrefix };
}
