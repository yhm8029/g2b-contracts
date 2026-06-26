import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  searchContractsByBusinessNumber: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  createDb: vi.fn(() => ({ sqlite: { close: mocks.close }, db: {} })),
}));

vi.mock("@/lib/db/init", () => ({
  initializeSqliteSchema: vi.fn(),
}));

vi.mock("@/lib/contracts/repository", () => ({
  searchContractsByBusinessNumber: mocks.searchContractsByBusinessNumber,
}));

describe("GET /api/export", () => {
  it("returns 400 JSON when repository search throws", async () => {
    mocks.searchContractsByBusinessNumber.mockImplementation(() => {
      throw new Error("Repository validation failed");
    });

    const { GET } = await import("@/app/api/export/route");
    const response = await GET(
      new NextRequest("http://localhost/api/export?bizNo=1234567890"),
    );

    await expect(response.json()).resolves.toEqual({ error: "Repository validation failed" });
    expect(response.status).toBe(400);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
