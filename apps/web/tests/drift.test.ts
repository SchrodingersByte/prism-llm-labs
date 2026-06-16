/**
 * PRD-5 drift math + clustering tests (lib/drift/*).
 * No-drift ≈ 0; an injected distribution shift pushes PSI/JS/centroid-cosine up;
 * separable fixtures cluster cleanly. Deterministic fixtures → stable assertions.
 */
import { describe, it, expect } from "vitest";
import { cosineSim, computeEmbeddingDrift, centroidCosineDrift, psi, jsDivergence } from "@/lib/drift/metrics";
import { kMeans } from "@/lib/drift/cluster";

/** Deterministic point near (cx, cy) with a tiny per-index jitter. */
function near(cx: number, cy: number, i: number): number[] {
  return [cx + ((i % 13) - 6) * 0.01, cy + ((i % 7) - 3) * 0.01];
}
const cloud = (cx: number, cy: number, n: number, off = 0) =>
  Array.from({ length: n }, (_, i) => near(cx, cy, i + off));

describe("cosineSim", () => {
  it("is 1 for identical, 0 for orthogonal, -1 for opposite", () => {
    expect(cosineSim([1, 1], [1, 1])).toBeCloseTo(1, 6);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSim([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });
  it("returns 0 for a zero vector", () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });
});

describe("psi / jsDivergence", () => {
  it("are ~0 for identical distributions", () => {
    const p = [0.2, 0.3, 0.5];
    expect(psi(p, p)).toBeCloseTo(0, 6);
    expect(jsDivergence(p, p)).toBeCloseTo(0, 6);
  });
  it("grow when distributions diverge", () => {
    expect(psi([0.9, 0.1, 0.0], [0.0, 0.1, 0.9])).toBeGreaterThan(0.25);
    expect(jsDivergence([1, 0], [0, 1])).toBeGreaterThan(0.9);
  });
});

describe("computeEmbeddingDrift", () => {
  it("reports ~no drift for two samples from the same distribution", () => {
    const baseline = cloud(1, 0, 60);
    const current  = cloud(1, 0, 60, 3);
    const d = computeEmbeddingDrift(baseline, current);
    expect(d.centroid_cosine).toBeLessThan(0.05);
    expect(d.psi).toBeLessThan(0.1);
    expect(d.baseline_n).toBe(60);
    expect(d.current_n).toBe(60);
  });

  it("flags a clear distribution shift", () => {
    const baseline = cloud(1, 0, 60);
    const current  = cloud(0, 1, 60);   // rotated 90° → orthogonal centroids
    const d = computeEmbeddingDrift(baseline, current);
    expect(d.centroid_cosine).toBeGreaterThan(0.8);
    expect(d.psi).toBeGreaterThan(0.25);
    expect(d.js).toBeGreaterThan(0.1);
  });

  it("handles empty windows without throwing", () => {
    const d = computeEmbeddingDrift([], cloud(1, 0, 5));
    expect(d).toMatchObject({ psi: 0, js: 0, centroid_cosine: 0 });
  });
});

describe("centroidCosineDrift", () => {
  it("is ~0 for same-direction clouds and ~1 for orthogonal clouds", () => {
    expect(centroidCosineDrift(cloud(1, 0, 30), cloud(1, 0, 30, 5))).toBeLessThan(0.05);
    expect(centroidCosineDrift(cloud(1, 0, 30), cloud(0, 1, 30))).toBeGreaterThan(0.8);
  });
});

describe("kMeans", () => {
  it("separates two well-separated groups", () => {
    const groupA = cloud(1, 0, 30);
    const groupB = cloud(0, 1, 30);
    const { assignments, sizes } = kMeans([...groupA, ...groupB], 2);

    // Each group is internally consistent, and the two groups differ.
    const aLabels = new Set(assignments.slice(0, 30));
    const bLabels = new Set(assignments.slice(30));
    expect(aLabels.size).toBe(1);
    expect(bLabels.size).toBe(1);
    expect([...aLabels][0]).not.toBe([...bLabels][0]);
    expect(sizes.slice().sort()).toEqual([30, 30]);
  });

  it("clamps k to the sample size and never throws on tiny input", () => {
    const { centroids } = kMeans([[1, 0], [0, 1]], 5);
    expect(centroids.length).toBe(2);
  });
});
