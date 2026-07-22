import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  createDb: vi.fn(() => ({ sqlite: { close: mocks.close }, db: {} })),
  initialize: vi.fn(),
  getOverview: vi.fn(),
  buildWorkbook: vi.fn(async () => Buffer.from("xlsx-content")),
}));

vi.mock("@/lib/db/client", () => ({ createDb: mocks.createDb }));
vi.mock("@/lib/db/init", () => ({ initializeSqliteSchema: mocks.initialize }));
vi.mock("@/lib/competitors/service", () => ({ getCompetitorSalesOverview: mocks.getOverview }));
vi.mock("@/lib/competitors/excel", () => ({ buildCompetitorSalesWorkbook: mocks.buildWorkbook }));

describe("GET /api/competitors/export", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.getOverview.mockResolvedValue(completeOverview());
  });

  it("strictly rejects unknown, duplicate, mismatched, and future period parameters before opening the database", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T03:00:00.000Z"));
    const { GET } = await import("@/app/api/competitors/export/route");

    const urls = [
      "?period=month&year=2026&month=7&extra=1",
      "?period=month&period=year&year=2026&month=7",
      "?period=month&year=2026&month=7&quarter=3",
      "?period=month&year=2026&month=8",
    ];
    for (const query of urls) {
      const response = await GET(new NextRequest(`http://localhost/api/competitors/export${query}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.createDb).not.toHaveBeenCalled();
    expect(mocks.getOverview).not.toHaveBeenCalled();
  });

  it("reads only SQLite cache and returns 409 when coverage is incomplete", async () => {
    mocks.getOverview.mockResolvedValue({
      ...completeOverview(),
      coverage: {
        complete: false,
        fresh: true,
        missingRanges: [{ dateFrom: "2026-07-10", dateTo: "2026-07-12" }],
      },
    });
    const { GET } = await import("@/app/api/competitors/export/route");

    const response = await GET(new NextRequest(
      "http://localhost/api/competitors/export?period=month&year=2026&month=7",
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "조회가 완료된 후 엑셀을 내보낼 수 있습니다." });
    expect(mocks.getOverview).toHaveBeenCalledWith(expect.objectContaining({
      query: { period: "month", year: 2026, month: 7 },
      cacheOnly: true,
      serviceKey: "",
      sqlite: expect.anything(),
    }));
    expect(mocks.buildWorkbook).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("returns 409 when cached coverage is complete but stale", async () => {
    mocks.getOverview.mockResolvedValue({
      ...completeOverview(),
      coverage: { complete: true, fresh: false, missingRanges: [] },
    });
    const { GET } = await import("@/app/api/competitors/export/route");

    const response = await GET(new NextRequest(
      "http://localhost/api/competitors/export?period=year&year=2025",
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "조회가 완료된 후 엑셀을 내보낼 수 있습니다." });
    expect(mocks.buildWorkbook).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("returns an xlsx attachment named for the normalized period", async () => {
    const { GET } = await import("@/app/api/competitors/export/route");

    const response = await GET(new NextRequest(
      "http://localhost/api/competitors/export?period=quarter&year=2026&quarter=2",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="competitor-sales-2026-Q2.xlsx"',
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("xlsx-content"));
    expect(mocks.getOverview).toHaveBeenCalledWith(expect.objectContaining({
      query: { period: "quarter", year: 2026, quarter: 2 },
      cacheOnly: true,
      serviceKey: "",
    }));
    expect(mocks.buildWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      coverage: expect.objectContaining({ complete: true }),
    }));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("always closes the SQLite connection when workbook generation fails", async () => {
    mocks.buildWorkbook.mockRejectedValueOnce(new Error("workbook failed"));
    const { GET } = await import("@/app/api/competitors/export/route");

    const response = await GET(new NextRequest(
      "http://localhost/api/competitors/export?period=year&year=2025",
    ));

    expect(response.status).toBe(500);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});

function completeOverview() {
  return {
    period: {
      period: "quarter",
      year: 2026,
      month: null,
      quarter: 2,
      label: "2026-Q2",
      dateFrom: "2026-04-01",
      dateTo: "2026-06-30",
      cacheKey: "v2:quarter:2026-Q2:2026-04-01:2026-06-30",
    },
    status: "ready",
    collectedAt: "2026-07-22T03:00:00.000Z",
    totalContractCount: 0,
    totalAmount: 0,
    latestContractDate: null,
    companies: [],
    coverage: { complete: true, fresh: true, missingRanges: [] },
  };
}
