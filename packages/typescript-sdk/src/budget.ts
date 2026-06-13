export class BudgetExceededError extends Error {
  readonly spend: number;
  readonly limit: number;

  constructor(spend: number, limit: number) {
    super(
      `Monthly budget exceeded: $${spend.toFixed(4)} spent of $${limit.toFixed(4)} limit. ` +
      "Set a higher budget in the Prism dashboard or disable enforce_hard_cap.",
    );
    this.name  = "BudgetExceededError";
    this.spend = spend;
    this.limit = limit;
  }
}

interface BudgetResult {
  allowed: boolean;
  spend:   number;
  limit:   number | null;
  enforce: boolean;
  pct:     number;   // spend as % of limit (0 when no limit)
}

/** Status returned by checkStatus() */
export type BudgetStatusResult = "ok" | "soft_cap_hit" | "hard_cap_exceeded";

const cache = new Map<string, { result: BudgetResult; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function cacheGet(key: string): BudgetResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.result;
}

function cacheSet(key: string, result: BudgetResult): void {
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

export class BudgetChecker {
  private readonly key:     string;
  private readonly baseUrl: string;

  constructor(key: string) {
    this.key     = key;
    this.baseUrl = (
      process.env["PRISM_APP_URL"] ??
      process.env["NEXT_PUBLIC_APP_URL"] ??
      "https://useprism.dev"
    ).replace(/\/$/, "");
  }

  /**
   * Returns the current budget status without throwing.
   * Used internally for the soft-cap model downgrade flow.
   * @param softCapPct - percentage threshold for soft cap (default 80)
   */
  async checkStatus(softCapPct = 80): Promise<BudgetStatusResult> {
    const month    = new Date().toISOString().slice(0, 7);
    const cacheKey = `${this.key.slice(0, 12)}:${month}`;

    let result = cacheGet(cacheKey);
    if (result === null) {
      result = await this._fetch();
      if (result !== null) cacheSet(cacheKey, result);
    }

    if (result === null) return "ok"; // API down — fail open

    if (!result.allowed) return "hard_cap_exceeded";
    if (result.limit != null && result.limit > 0 && result.pct >= softCapPct) {
      return "soft_cap_hit";
    }
    return "ok";
  }

  async checkOrThrow(): Promise<void> {
    const status = await this.checkStatus(101); // only hard cap
    if (status === "hard_cap_exceeded") {
      const month    = new Date().toISOString().slice(0, 7);
      const cacheKey = `${this.key.slice(0, 12)}:${month}`;
      const result   = cacheGet(cacheKey);
      throw new BudgetExceededError(result?.spend ?? 0, result?.limit ?? 0);
    }
  }

  private async _fetch(): Promise<BudgetResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/budget/check`, {
        headers: { Authorization: `Bearer ${this.key}` },
      });
      if (res.status === 401) {
        console.warn("[prism] Invalid API key for budget check");
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as BudgetResult;
    } catch {
      return null;
    }
  }
}
