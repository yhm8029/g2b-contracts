import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  searchContractsByBusinessNumber: vi.fn(),
  searchContractsByBusinessNumbers: vi.fn(),
  getDatabaseHealth: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  createDb: vi.fn(() => ({ sqlite: { close: mocks.close }, db: {} })),
}));

vi.mock("@/lib/db/init", () => ({
  initializeSqliteSchema: vi.fn(),
}));

vi.mock("@/lib/contracts/repository", () => ({
  getDatabaseHealth: mocks.getDatabaseHealth,
  searchContractsByBusinessNumber: mocks.searchContractsByBusinessNumber,
  searchContractsByBusinessNumbers: mocks.searchContractsByBusinessNumbers,
}));

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
    mocks.searchContractsByBusinessNumber.mockReset();
    mocks.searchContractsByBusinessNumbers.mockReset();
    mocks.getDatabaseHealth.mockReset();
    mocks.searchContractsByBusinessNumber.mockReturnValue([]);
    mocks.searchContractsByBusinessNumbers.mockReturnValue([]);
    mocks.getDatabaseHealth.mockReturnValue({ contractCount: 0, latestImportAt: null });
  });

  it("accepts comma separated business numbers and searches them together", async () => {
    const { GET } = await import("@/app/api/search/route");
    const response = await GET(
      new NextRequest("http://localhost/api/search?bizNo=123-45-67890%2C2048145651"),
    );

    expect(response.status).toBe(200);
    expect(mocks.searchContractsByBusinessNumbers).toHaveBeenCalledWith(
      {},
      { bizNo: "123-45-67890,2048145651", dateFrom: undefined, dateTo: undefined, businessCategory: undefined },
    );
    expect(mocks.searchContractsByBusinessNumber).not.toHaveBeenCalled();
  });

  it("returns generic 500 JSON when repository search fails unexpectedly", async () => {
    mocks.searchContractsByBusinessNumbers.mockImplementation(() => {
      throw new Error("SQLITE_CANTOPEN: unable to open C:\\secret\\g2b.sqlite");
    });

    const { GET } = await import("@/app/api/search/route");
    const response = await GET(
      new NextRequest("http://localhost/api/search?bizNo=1234567890"),
    );

    await expect(response.json()).resolves.toEqual({ error: "Search failed." });
    expect(response.status).toBe(500);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("returns safe API key and enrichment status in health payload", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "test-secret-value");
    vi.stubEnv("ENRICHMENT_ENABLED", "true");
    mocks.getDatabaseHealth.mockReturnValue({ contractCount: 7, latestImportAt: "2026-06-26T01:02:03.000Z" });

    const { GET } = await import("@/app/api/search/route");
    const response = await GET(new NextRequest("http://localhost/api/search?bizNo=1234567890"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      health: {
        contractCount: 7,
        latestImportAt: "2026-06-26T01:02:03.000Z",
        apiKeyConfigured: true,
        enrichmentEnabled: true,
      },
    });
  });
});
