/**
 * Tinybird mock helpers for unit/integration tests.
 */
import { vi } from "vitest";

export const mockIngestToTinybird = vi.fn().mockResolvedValue(undefined);
export const mockQueryTinybird    = vi.fn().mockResolvedValue([]);

export const mockTinybirdModule = {
  ingestToTinybird: mockIngestToTinybird,
  queryTinybird:    mockQueryTinybird,
  querySql:         vi.fn().mockResolvedValue([]),
};

export function resetTinybirdMocks() {
  mockIngestToTinybird.mockReset().mockResolvedValue(undefined);
  mockQueryTinybird.mockReset().mockResolvedValue([]);
}

/** Make queryTinybird return specific data for a given pipe name */
export function mockPipeResult(pipe: string, data: unknown[]) {
  mockQueryTinybird.mockImplementation(async (p: string) => {
    if (p === pipe) return data;
    return [];
  });
}
