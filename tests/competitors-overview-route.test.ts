import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  initialize: vi.fn(),
  getOverview: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  createDb: vi.fn(() => ({ sqlite: { close: mocks.close }, db: {} })),
}));
vi.mock("@/lib/db/init", () => ({ initializeSqliteSchema: mocks.initialize }));
vi.mock("@/lib/competitors/service", () => ({ getCompetitorSalesOverview: mocks.getOverview }));

describe("GET /api/competitors/overview", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("rejects a fully future Seoul month before opening the database", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T03:00:00.000Z"));
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "test-key");
    const { GET } = await import("@/app/api/competitors/overview/route");

    const response = await GET(new NextRequest("http://localhost/api/competitors/overview?period=month&year=2026&month=8"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "조회 기간이 올바르지 않습니다." });
    expect(mocks.getOverview).not.toHaveBeenCalled();
  });

  it("strictly rejects unknown and mismatched period parameters", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "test-key");
    const { GET } = await import("@/app/api/competitors/overview/route");

    const response = await GET(new NextRequest("http://localhost/api/competitors/overview?period=month&year=2026&month=7&quarter=3"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "조회 기간이 올바르지 않습니다." });
    expect(mocks.getOverview).not.toHaveBeenCalled();
  });

  it("rejects present-but-invalid parameters instead of treating them as absent", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "test-key");
    const { GET } = await import("@/app/api/competitors/overview/route");

    const response = await GET(new NextRequest("http://localhost/api/competitors/overview?period=year&year=2026&month=abc"));

    expect(response.status).toBe(400);
    expect(mocks.getOverview).not.toHaveBeenCalled();
  });

  it("uses the first configured service-key alias and returns the overview", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "first-key");
    vi.stubEnv("G2B_SERVICE_KEY", "second-key");
    mocks.getOverview.mockResolvedValue({ status: "ready", companies: [] });
    const { GET } = await import("@/app/api/competitors/overview/route");

    const response = await GET(new NextRequest("http://localhost/api/competitors/overview?period=month&year=2026&month=7"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready", companies: [] });
    expect(mocks.getOverview).toHaveBeenCalledWith(expect.objectContaining({
      serviceKey: "first-key",
      query: { period: "month", year: 2026, month: 7 },
      sqlite: expect.anything(),
      signal: expect.any(AbortSignal),
    }));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("lets the service satisfy a cache hit when no service key is configured", async () => {
    mocks.getOverview.mockResolvedValue({ status: "ready", companies: [] });
    const { GET } = await import("@/app/api/competitors/overview/route");

    const response = await GET(new NextRequest("http://localhost/api/competitors/overview?period=year&year=2026"));

    expect(response.status).toBe(200);
    expect(mocks.getOverview).toHaveBeenCalledWith(expect.objectContaining({ serviceKey: "" }));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("returns a Korean 503 when an uncached request has no service key", async () => {
    mocks.getOverview.mockRejectedValue(Object.assign(new Error("G2B service key is required"), {
      name: "CompetitorContractConfigurationError",
      reason: "service_key_missing",
    }));
    const { GET } = await import("@/app/api/competitors/overview/route");

    const response = await GET(new NextRequest("http://localhost/api/competitors/overview?period=year&year=2026"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "공공데이터포털 서비스 키가 설정되지 않았습니다." });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
