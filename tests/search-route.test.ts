import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  searchContractsByBusinessNumber: vi.fn(),
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
}));

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchContractsByBusinessNumber.mockReset();
    mocks.getDatabaseHealth.mockReset();
    mocks.searchContractsByBusinessNumber.mockReturnValue([]);
    mocks.getDatabaseHealth.mockReturnValue({ contractCount: 0, latestImportAt: null });
  });

  it("returns generic 500 JSON when repository search fails unexpectedly", async () => {
    mocks.searchContractsByBusinessNumber.mockImplementation(() => {
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
});
