import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  searchContractsByBusinessNumber: vi.fn(),
  searchContractsByBusinessNumbers: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  createDb: vi.fn(() => ({ sqlite: { close: mocks.close }, db: {} })),
}));

vi.mock("@/lib/db/init", () => ({
  initializeSqliteSchema: vi.fn(),
}));

vi.mock("@/lib/contracts/repository", () => ({
  searchContractsByBusinessNumber: mocks.searchContractsByBusinessNumber,
  searchContractsByBusinessNumbers: mocks.searchContractsByBusinessNumbers,
}));

describe("GET /api/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchContractsByBusinessNumber.mockReset();
    mocks.searchContractsByBusinessNumbers.mockReset();
    mocks.searchContractsByBusinessNumber.mockReturnValue([]);
    mocks.searchContractsByBusinessNumbers.mockReturnValue([]);
  });

  it("exports comma separated business numbers together", async () => {
    const { GET } = await import("@/app/api/export/route");
    const response = await GET(
      new NextRequest("http://localhost/api/export?bizNo=123-45-67890%2C2048145651"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("g2b-contracts-multi.csv");
    expect(mocks.searchContractsByBusinessNumbers).toHaveBeenCalledWith(
      {},
      { bizNo: "123-45-67890,2048145651", dateFrom: undefined, dateTo: undefined, businessCategory: undefined },
    );
    expect(mocks.searchContractsByBusinessNumber).not.toHaveBeenCalled();
  });

  it("returns 400 JSON when repository search rejects the business number", async () => {
    mocks.searchContractsByBusinessNumbers.mockImplementation(() => {
      throw new Error("Business registration number must contain 10 digits.");
    });

    const { GET } = await import("@/app/api/export/route");
    const response = await GET(
      new NextRequest("http://localhost/api/export?bizNo=1234567890"),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Business registration number must contain 10 digits.",
    });
    expect(response.status).toBe(400);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("returns generic 500 JSON when repository search fails unexpectedly", async () => {
    mocks.searchContractsByBusinessNumbers.mockImplementation(() => {
      throw new Error("SQLITE_BUSY: database is locked at C:\\data\\g2b.sqlite");
    });

    const { GET } = await import("@/app/api/export/route");
    const response = await GET(
      new NextRequest("http://localhost/api/export?bizNo=1234567890"),
    );

    await expect(response.json()).resolves.toEqual({ error: "Export failed." });
    expect(response.status).toBe(500);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
