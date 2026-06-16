/**
 * Embedding clustering for topic/intent discovery (PRD-5).
 *
 * Deterministic cosine k-means (farthest-point init — no RNG) so results are
 * stable and unit-testable. The cron clusters a sampled current window, then
 * labels each cluster with the input snippet nearest its centroid (a cheap,
 * meaningful label without an LLM call). Surfaced as emerging topics to Product.
 */
import { cosineSim, meanVector, type Vec } from "./metrics";

export interface ClusterResult {
  assignments: number[];   // cluster index per input vector
  centroids:   Vec[];
  sizes:       number[];
}

function cosDist(a: Vec, b: Vec): number {
  return 1 - cosineSim(a, b);
}

/** Farthest-point (k-means++ style, deterministic) seeding. */
function initCentroids(vectors: Vec[], k: number): Vec[] {
  const chosen = [0];
  while (chosen.length < k) {
    let bestIdx = -1, bestDist = -1;
    for (let i = 0; i < vectors.length; i++) {
      if (chosen.indexOf(i) !== -1) continue;
      let minToChosen = Infinity;
      for (const c of chosen) minToChosen = Math.min(minToChosen, cosDist(vectors[i], vectors[c]));
      if (minToChosen > bestDist) { bestDist = minToChosen; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    chosen.push(bestIdx);
  }
  return chosen.map(i => vectors[i].slice());
}

/** Cosine k-means. k is clamped to the sample size. */
export function kMeans(vectors: Vec[], k: number, maxIter = 25): ClusterResult {
  if (vectors.length === 0) return { assignments: [], centroids: [], sizes: [] };
  const kk = Math.max(1, Math.min(k, vectors.length));
  let centroids = initCentroids(vectors, kk);
  const assignments = new Array(vectors.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < vectors.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = cosDist(vectors[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    const groups: Vec[][] = Array.from({ length: centroids.length }, () => []);
    for (let i = 0; i < vectors.length; i++) groups[assignments[i]].push(vectors[i]);
    centroids = groups.map((g, c) => (g.length ? meanVector(g) : centroids[c]));
    if (!changed) break;
  }

  const sizes = new Array(centroids.length).fill(0);
  for (const a of assignments) sizes[a]++;
  return { assignments, centroids, sizes };
}

/** Index of the vector nearest a centroid — used to pick a representative snippet as the label. */
export function nearestToCentroid(vectors: Vec[], indices: number[], centroid: Vec): number {
  let best = indices[0] ?? -1, bestD = Infinity;
  for (const i of indices) {
    const d = cosDist(vectors[i], centroid);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
