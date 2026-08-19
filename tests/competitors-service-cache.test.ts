import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  deliveries: vi.fn(),
  build: vi.fn(),
  resolvePeriod: vi.fn(),
  deleteIntersecting: vi.fn(),
  deleteThirdPartyCacheInRange: vi.fn(),
  enrich: vi.fn(),
}));

vi.mock("@/lib/competitors/cache", () => ({
  SqliteCompetitorQueryCache: class SqliteCompetitorQueryCache {
    deleteIntersecting = mocks.deleteIntersecting;
  },
}));
vi.mock("@/lib/competitors/contracts", () => ({
  searchCompetitorContracts: mocks.search,
}));
vi.mock("@/lib/competitors/third-party-deliveries", () => ({
  searchCompetitorThirdPartyDeliveries: mocks.deliveries,
  deleteCompetitorThirdPartyDeliveryCacheInRange: mocks.deleteThirdPartyCacheInRange,
}));
vi.mock("@/lib/competitors/overview", () => ({
  COMPETITOR_SALES_REGISTRY: [{ bizNo: "1234567890" }],
  resolveCompetitorSalesPeriod: mocks.resolvePeriod,
  buildCompetitorSalesOverview: mocks.build,
}));
vi.mock("@/lib/competitors/purchase-target-products", () => ({
  enrichCompetitorStandardContractItemCodes: mocks.enrich,
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
    mocks.deliveries.mockResolvedValue({
      fetchedAt: "2026-07-21T00:00:00.000Z",
      rows: [{ id: "delivery-row", sourceDataset: "g2b-shopping-mall-third-party-delivery" }],
      coverage: { complete: true, fresh: false, missingRanges: [] },
    });
    mocks.build.mockReturnValue({ status: "ready", companies: [] });
    mocks.enrich.mockImplementation((rows) => Promise.resolve(rows));
  });

  it("passes cache-only mode to contract search and preserves coverage in the response", async () => {
    const standardRow = { id: "standard-row", bizNo: "1234567890" };
    mocks.search.mockResolvedValue({
      fetchedAt: "2026-07-20T00:00:00.000Z",
      rows: [standardRow],
      summary: { contractCount: 1, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
      coverage: { complete: true, fresh: false, missingRanges: [] },
    });
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
    expect(mocks.deliveries).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: "2026-01-01", dateTo: "2026-07-22", bizNos: ["1234567890"] }),
      expect.objectContaining({ cacheOnly: true }),
    );
    expect(mocks.enrich).toHaveBeenCalledWith(
      [standardRow],
      expect.objectContaining({
        sqlite: {},
        serviceKey: "",
        fetchImpl: undefined,
        cacheOnly: true,
      }),
    );
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({
      rows: [standardRow, { id: "delivery-row", sourceDataset: "g2b-shopping-mall-third-party-delivery" }],
    }));
    expect(result).toEqual({
      status: "ready",
      companies: [],
      coverage: { complete: true, fresh: false, missingRanges: [] },
    });
  });

  it("starts standard contracts and third-party deliveries in parallel", async () => {
    const standard = deferred<Awaited<ReturnType<typeof mocks.search>>>();
    const deliveries = deferred<Awaited<ReturnType<typeof mocks.deliveries>>>();
    mocks.search.mockImplementation(() => standard.promise);
    mocks.deliveries.mockImplementation(() => deliveries.promise);
    const { getCompetitorSalesOverview } = await import("@/lib/competitors/service");

    const request = getCompetitorSalesOverview({
      query: { period: "year", year: 2026 },
      serviceKey: "test-key",
      sqlite: {} as never,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });

    await vi.waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1));
    expect(mocks.deliveries).toHaveBeenCalledTimes(1);

    standard.resolve({
      fetchedAt: "2026-07-20T00:00:00.000Z",
      rows: [],
      summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
      coverage: { complete: true, fresh: true, missingRanges: [] },
    });
    deliveries.resolve({
      fetchedAt: "2026-07-21T00:00:00.000Z",
      rows: [],
      coverage: { complete: true, fresh: true, missingRanges: [] },
    });
    await request;
  });

  it("waits for both parallel sources to settle before propagating a failure", async () => {
    const failure = new Error("standard source failed");
    const deliveries = deferred<Awaited<ReturnType<typeof mocks.deliveries>>>();
    mocks.search.mockRejectedValue(failure);
    mocks.deliveries.mockImplementation(() => deliveries.promise);
    const { getCompetitorSalesOverview } = await import("@/lib/competitors/service");

    const request = getCompetitorSalesOverview({
      query: { period: "year", year: 2026 },
      serviceKey: "test-key",
      sqlite: {} as never,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });
    const outcome = request.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );

    await vi.waitFor(() => expect(mocks.deliveries).toHaveBeenCalledTimes(1));
    const early = await Promise.race([
      outcome,
      new Promise<{ status: "pending" }>((resolve) => setTimeout(() => resolve({ status: "pending" }), 20)),
    ]);
    expect(early).toEqual({ status: "pending" });

    deliveries.resolve({
      fetchedAt: "2026-07-21T00:00:00.000Z",
      rows: [],
      coverage: { complete: true, fresh: true, missingRanges: [] },
    });
    expect(await outcome).toEqual({ status: "rejected", error: failure });
  });

  it("invalidates both caches for the 13-day recent window before searches when refreshRecent is true", async () => {
    const { getCompetitorSalesOverview } = await import("@/lib/competitors/service");

    await getCompetitorSalesOverview({
      query: { period: "year", year: 2026 },
      serviceKey: "test-key",
      sqlite: {} as never,
      refreshRecent: true,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });

    expect(mocks.deleteIntersecting).toHaveBeenCalledTimes(1);
    expect(mocks.deleteIntersecting).toHaveBeenCalledWith({
      bizNoNormalized: "1234567890",
      dateFrom: "2026-07-09",
      dateTo: "2026-07-22",
    });
    expect(mocks.deleteThirdPartyCacheInRange).toHaveBeenCalledTimes(1);
    expect(mocks.deleteThirdPartyCacheInRange).toHaveBeenCalledWith(
      {},
      "1234567890",
      "2026-07-09",
      "2026-07-22",
    );

    const deleteIntersectingOrder = mocks.deleteIntersecting.mock.invocationCallOrder[0]!;
    const deleteRangeOrder = mocks.deleteThirdPartyCacheInRange.mock.invocationCallOrder[0]!;
    const searchOrder = mocks.search.mock.invocationCallOrder[0]!;
    const deliveriesOrder = mocks.deliveries.mock.invocationCallOrder[0]!;
    expect(deleteIntersectingOrder).toBeLessThan(searchOrder);
    expect(deleteIntersectingOrder).toBeLessThan(deliveriesOrder);
    expect(deleteRangeOrder).toBeLessThan(searchOrder);
    expect(deleteRangeOrder).toBeLessThan(deliveriesOrder);
  });

  it("skips cache invalidation when refreshRecent is not set", async () => {
    const { getCompetitorSalesOverview } = await import("@/lib/competitors/service");

    await getCompetitorSalesOverview({
      query: { period: "year", year: 2026 },
      serviceKey: "test-key",
      sqlite: {} as never,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });

    expect(mocks.deleteIntersecting).not.toHaveBeenCalled();
    expect(mocks.deleteThirdPartyCacheInRange).not.toHaveBeenCalled();
  });

  it("passes enriched rows with item codes to overview construction", async () => {
    const standardRow = { id: "standard-row", bizNo: "1234567890" };
    const enrichedRow = { ...standardRow, itemCodes: ["3912180101"] };
    mocks.search.mockResolvedValue({
      fetchedAt: "2026-07-20T00:00:00.000Z",
      rows: [standardRow],
      summary: { contractCount: 1, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
      coverage: { complete: true, fresh: false, missingRanges: [] },
    });
    mocks.enrich.mockResolvedValueOnce([enrichedRow]);
    const { getCompetitorSalesOverview } = await import("@/lib/competitors/service");

    await getCompetitorSalesOverview({
      query: { period: "year", year: 2026 },
      serviceKey: "test-key",
      sqlite: {} as never,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });

    expect(mocks.enrich).toHaveBeenCalledWith([standardRow], expect.any(Object));
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({
      rows: expect.arrayContaining([enrichedRow]),
    }));
    expect(mocks.build.mock.invocationCallOrder[0]!).toBeGreaterThan(
      mocks.enrich.mock.invocationCallOrder[0]!,
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
