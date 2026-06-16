/**
 * Embedding-drift math (PRD-5).
 *
 * Pure, dependency-free functions over embedding vectors (number[]) so they can
 * be unit-tested on synthetic distributions. The cron (app/api/cron/compute-drift)
 * pulls sampled embeddings from content_embeddings (PRD-0) for a baseline window
 * and a current window, then calls computeEmbeddingDrift().
 *
 * Methods (per the research in the impl doc): PSI + Jensen–Shannon over a 1-D
 * projection (each sample's cosine distance to the BASELINE centroid), plus a
 * direct centroid-cosine drift. No-drift ≈ 0; a distribution shift pushes all
 * three up.
 */
export type Vec = number[];

export interface DriftResult {
  psi:             number;
  js:              number;   // Jensen–Shannon divergence (0..1, log base 2)
  centroid_cosine: number;   // 1 - cos(baseline_centroid, current_centroid)
  baseline_n:      number;
  current_n:       number;
}

const EPS = 1e-12;

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: Vec): number {
  return Math.sqrt(dot(a, a));
}

/** Cosine similarity in [-1, 1]. Zero vectors → 0. */
export function cosineSim(a: Vec, b: Vec): number {
  const na = norm(a), nb = norm(b);
  if (na < EPS || nb < EPS) return 0;
  return dot(a, b) / (na * nb);
}

/** Element-wise mean of a set of vectors (the centroid). */
export function meanVector(vectors: Vec[]): Vec {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

/** Cosine DISTANCE (1 - sim) of each vector to a reference (e.g. the baseline centroid). */
export function distancesToCentroid(vectors: Vec[], centroid: Vec): number[] {
  return vectors.map(v => 1 - cosineSim(v, centroid));
}

/** Normalized histogram of `values` over `bins` equal-width buckets across [min,max]. */
export function histogram(values: number[], bins: number, min: number, max: number): number[] {
  const counts = new Array(bins).fill(0);
  if (values.length === 0) return counts;
  const span = max - min || 1;
  for (const v of values) {
    let idx = Math.floor(((v - min) / span) * bins);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx]++;
  }
  return counts.map(c => c / values.length);
}

/**
 * Population Stability Index between two probability vectors (same length).
 * PSI = Σ (cur - base) * ln(cur / base). Rule of thumb: <0.1 stable,
 * 0.1–0.25 moderate shift, >0.25 significant.
 */
export function psi(baseline: number[], current: number[]): number {
  let s = 0;
  for (let i = 0; i < baseline.length; i++) {
    const b = baseline[i] + EPS;
    const c = current[i] + EPS;
    s += (c - b) * Math.log(c / b);
  }
  return Math.abs(s);
}

/** Jensen–Shannon divergence between two probability vectors (0..1, log base 2). */
export function jsDivergence(p: number[], q: number[]): number {
  const klDiv = (a: number[], b: number[]): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] + EPS;
      const bi = b[i] + EPS;
      s += ai * Math.log2(ai / bi);
    }
    return s;
  };
  const m = p.map((pi, i) => (pi + q[i]) / 2);
  return 0.5 * klDiv(p, m) + 0.5 * klDiv(q, m);
}

/** Centroid-cosine drift: 1 - cos(baseline_centroid, current_centroid). */
export function centroidCosineDrift(baseline: Vec[], current: Vec[]): number {
  if (baseline.length === 0 || current.length === 0) return 0;
  return 1 - cosineSim(meanVector(baseline), meanVector(current));
}

/**
 * Full drift summary over two embedding windows. Bins each window by cosine
 * distance to the BASELINE centroid (a shift moves the current window's mass
 * away from 0), then computes PSI + JS over those histograms, plus the direct
 * centroid-cosine drift.
 */
export function computeEmbeddingDrift(baseline: Vec[], current: Vec[], bins = 10): DriftResult {
  if (baseline.length === 0 || current.length === 0) {
    return { psi: 0, js: 0, centroid_cosine: 0, baseline_n: baseline.length, current_n: current.length };
  }
  const centroid = meanVector(baseline);
  const dBase = distancesToCentroid(baseline, centroid);
  const dCur  = distancesToCentroid(current, centroid);

  const lo = Math.min(...dBase, ...dCur);
  const hi = Math.max(...dBase, ...dCur);
  const hBase = histogram(dBase, bins, lo, hi);
  const hCur  = histogram(dCur, bins, lo, hi);

  return {
    psi:             Math.round(psi(hBase, hCur) * 100000) / 100000,
    js:              Math.round(jsDivergence(hBase, hCur) * 100000) / 100000,
    centroid_cosine: Math.round(centroidCosineDrift(baseline, current) * 100000) / 100000,
    baseline_n:      baseline.length,
    current_n:       current.length,
  };
}
