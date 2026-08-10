import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { replaceExcellentProductsSnapshot } from "@/lib/excellent-products/repository";
import type { ExcellentProductCsvRow } from "@/lib/excellent-products/types";

const syncMock = vi.hoisted(() => ({
  syncBuildingControlCompanies: vi.fn(),
}));

vi.mock("@/lib/excellent-products/enrichment", () => syncMock);

function row(overrides: Partial<ExcellentProductCsvRow> = {}): ExcellentProductCsvRow {
  return {
    designationNo: "EQ-2026-001",
    bizNoNormalized: "1234567890",
    companyNameCsv: "Example Co",
    representativeNameCsv: "Jane Doe",
    phoneCsv: "02-1111-2222",
    addressCsv: "Seoul",
    productName: "Building control",
    designationStartDate: "2026-01-01",
    designationEndDate: "2029-01-01",
    productClassificationNo: "39121801-01",
    productClassificationNormalized: "3912180101",
    productClassificationName: "Building controls",
    productSpec: "BC-1",
    certificationDetailsRaw: "Details",
    sanctionType: null,
    sourceRowHash: "route-row-1",
    sourceDataset: "excellent-products",
    sourceFileName: "test.csv",
    sourceImportedAt: "2026-08-10T00:00:00.000Z",
    rawData: {},
    ...overrides,
  };
}

function setupDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "excellent-products-route-"));
  const databaseUrl = join(directory, "route.sqlite");
  vi.stubEnv("DATABASE_URL", databaseUrl);
  const connection = createDb(databaseUrl);
  initializeSqliteSchema(connection.sqlite);
  replaceExcellentProductsSnapshot(connection.db, [row()], "test.csv");
  connection.sqlite.close();
  return databaseUrl;
}

function syncRequest() {
  return new NextRequest("http://localhost/api/excellent-products/building-control/sync", {
    method: "POST",
  });
}

describe("excellent product building-control routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    syncMock.syncBuildingControlCompanies.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET returns only the fixed building-control snapshot and closes its database", async () => {
    setupDatabase();
    const { GET } = await import("@/app/api/excellent-products/building-control/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      classification: "39121801",
      companyCount: 1,
      designationCount: 1,
      items: [expect.objectContaining({ productClassificationNormalized: "3912180101" })],
    });
  });

  it("export returns the UTF-8 BOM CSV with the fixed filename", async () => {
    setupDatabase();
    const { GET } = await import("@/app/api/excellent-products/building-control/export/route");

    const response = await GET();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const body = new TextDecoder().decode(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="g2b-excellent-products-39121801.csv"',
    );
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(body.slice(1).split("\n")[0].split(",")).toHaveLength(16);
  });

  it("sync coalesces overlapping requests and returns a structured successful result", async () => {
    setupDatabase();
    let release!: (value: unknown) => void;
    syncMock.syncBuildingControlCompanies.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { POST } = await import("@/app/api/excellent-products/building-control/sync/route");

    const first = POST(syncRequest());
    const second = POST(syncRequest());
    await Promise.resolve();
    expect(syncMock.syncBuildingControlCompanies).toHaveBeenCalledOnce();

    release({ processedCompanies: 1, updatedCompanies: 1, errors: [] });
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(await (await first).json()).toEqual({
      processedCompanies: 1,
      updatedCompanies: 1,
      errors: [],
    });
  });

  it("does not turn an empty snapshot into a failed sync", async () => {
    vi.stubEnv("DATABASE_URL", join(mkdtempSync(join(tmpdir(), "excellent-products-empty-")), "empty.sqlite"));
    syncMock.syncBuildingControlCompanies.mockResolvedValue({
      processedCompanies: 0,
      updatedCompanies: 0,
      errors: [],
    });
    const { POST } = await import("@/app/api/excellent-products/building-control/sync/route");

    const response = await POST(syncRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processedCompanies: 0,
      updatedCompanies: 0,
      errors: [],
    });
  });

  it("returns 500 only when attempted companies all fail", async () => {
    setupDatabase();
    syncMock.syncBuildingControlCompanies.mockResolvedValue({
      processedCompanies: 1,
      updatedCompanies: 0,
      errors: [{ bizNoNormalized: "1234567890", message: "provider failed" }],
    });
    const { POST } = await import("@/app/api/excellent-products/building-control/sync/route");

    const response = await POST(syncRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ processedCompanies: 1, updatedCompanies: 0 });
  });
});
