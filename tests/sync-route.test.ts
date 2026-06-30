import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  syncStandardContractsForBusiness: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  createDb: vi.fn(() => ({ sqlite: { close: mocks.close }, db: {} })),
}));

vi.mock("@/lib/db/init", () => ({
  initializeSqliteSchema: vi.fn(),
}));

vi.mock("@/lib/g2b/standard-contract-sync", () => ({
  syncStandardContractsForBusiness: mocks.syncStandardContractsForBusiness,
}));

function syncRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sync", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("POST /api/sync", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
    mocks.syncStandardContractsForBusiness.mockReset();
  });

  it("returns 403 when the G2B service key is missing", async () => {
    const { POST } = await import("@/app/api/sync/route");

    const response = await POST(
      syncRequest({ bizNo: "1234567890", dateFrom: "2026-01-01", dateTo: "2026-01-31" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "DATA_GO_KR_SERVICE_KEY is required for G2B sync.",
    });
    expect(mocks.syncStandardContractsForBusiness).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid request body", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "TEST_KEY");
    const { POST } = await import("@/app/api/sync/route");

    const response = await POST(syncRequest({ bizNo: "123", dateFrom: "2026-01-31", dateTo: "2026-01-01" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("bizNo"),
    });
    expect(mocks.syncStandardContractsForBusiness).not.toHaveBeenCalled();
  });

  it("returns 403 with the service approval message for unauthorized provider responses", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "SECRET_SERVICE_KEY");
    mocks.syncStandardContractsForBusiness.mockResolvedValue({
      status: "failed",
      chunksAttempted: 1,
      chunksExpanded: 0,
      pagesFetched: 0,
      rowsFetched: 0,
      rowsMatched: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      errors: [
        {
          code: "unauthorized_service_key",
          message: "SECRET_SERVICE_KEY was rejected",
          dateFrom: "2026-01-01",
          dateTo: "2026-01-31",
          granularity: "month",
        },
      ],
    });

    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(
      syncRequest({ bizNo: "1234567890", dateFrom: "2026-01-01", dateTo: "2026-01-31" }),
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe(
      "Public Data Portal service usage approval is required for the G2B public data open standard service.",
    );
    expect(JSON.stringify(json)).not.toContain("SECRET_SERVICE_KEY");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("returns 403 with the shopping mall approval message for shopping-mall-only authorization failures", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "SECRET_SERVICE_KEY");
    mocks.syncStandardContractsForBusiness.mockResolvedValue({
      status: "failed",
      chunksAttempted: 1,
      chunksExpanded: 0,
      pagesFetched: 0,
      rowsFetched: 0,
      rowsMatched: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      errors: [
        {
          code: "unauthorized_service_key",
          message: "G2B shopping mall product service request was rejected with status 403.",
        },
      ],
    });

    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(
      syncRequest({
        bizNo: "1234567890",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        businessCategory: "shopping_third_party",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Public Data Portal service usage approval is required for the G2B shopping mall product service.",
    });
  });

  it("returns successful sync counts", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "TEST_KEY");
    mocks.syncStandardContractsForBusiness.mockResolvedValue({
      status: "completed",
      chunksAttempted: 1,
      chunksExpanded: 0,
      pagesFetched: 1,
      rowsFetched: 2,
      rowsMatched: 1,
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 1,
      errorCount: 0,
      errors: [],
    });

    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(
      syncRequest({
        bizNo: "123-45-67890",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        businessCategory: "goods",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      pagesFetched: 1,
      rowsFetched: 2,
      rowsMatched: 1,
      insertedCount: 1,
      skippedCount: 1,
    });
    expect(mocks.syncStandardContractsForBusiness).toHaveBeenCalledWith(
      {},
      {
        bizNo: "123-45-67890",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        businessCategory: "goods",
      },
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("returns partial sync results when one source succeeds and another source is unauthorized", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "SECRET_SERVICE_KEY");
    mocks.syncStandardContractsForBusiness.mockResolvedValue({
      status: "completed_with_errors",
      chunksAttempted: 2,
      chunksExpanded: 0,
      pagesFetched: 1,
      rowsFetched: 2,
      rowsMatched: 1,
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 1,
      errorCount: 1,
      errors: [
        {
          code: "unauthorized_service_key",
          message: "SECRET_SERVICE_KEY was rejected by shopping mall service",
        },
      ],
    });

    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(
      syncRequest({
        bizNo: "123-45-67890",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        businessCategory: "all",
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      status: "completed_with_errors",
      insertedCount: 1,
      errorCount: 1,
    });
    expect(JSON.stringify(json)).not.toContain("SECRET_SERVICE_KEY");
  });
});
