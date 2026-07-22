import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  build: vi.fn(),
  resolvePeriod: vi.fn(),
}));

vi.mock("@/lib/competitors/cache", () => ({
  SqliteCompetitorQueryCache: class SqliteCompetitorQueryCache {},
}));
vi.mock("@/lib/competitors/contracts", () => ({
  searchCompetitorContracts: mocks.search,
}));
vi.mock("@/lib/competitors/overview", () => ({
  COMPETITOR_SALES_REGISTRY: [{ bizNo: "1234567890" }],
  resolveCompetitorSalesPeriod: mocks.resolvePeriod,
  buildCompetitorSalesOverview: mocks.build,
}));

describe("competitor overview service cache mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePeriod.mockReturnValue({
      period: "year",
      year: 2026,
      month: null,
      quarter: null,
      label: "2026",
      dateFrom: "2026-01-01",
      dateTo: "2026-07-22",
      cacheKey: "2026",
    });
    mocks.search.mockResolvedValue({
      fetchedAt: "2026-07-20T00:00:00.000Z",
      rows: [],
      summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
      coverage: { complete: true, fresh: false, missingRanges: [] },
    });
    mocks.build.mockReturnValue({ status: "ready", companies: [] });
  });

  it("passes cache-only mode to contract search and preserves coverage in the response", async () => {
    const { getCompetitorSalesOverview } = await import("@/lib/competitors/service");

    const result = await getCompetitorSalesOverview({
      query: { period: "year", year: 2026 },
      serviceKey: "",
      sqlite: {} as never,
      cacheOnly: true,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });

    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: "2026-01-01", dateTo: "2026-07-22" }),
      expect.objectContaining({ cacheOnly: true }),
    );
    expect(result).toEqual({
      status: "ready",
      companies: [],
      coverage: { complete: true, fresh: false, missingRanges: [] },
    });
  });
});
