import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import {
  EXCELLENT_PRODUCTS_API_SOURCE_NAME,
  EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
} from "@/lib/excellent-products/constants";
import { replaceExcellentProductsSnapshot } from "@/lib/excellent-products/repository";
import {
  syncBuildingControlCompanies,
  type ExcellentProductEnrichmentClients,
} from "@/lib/excellent-products/enrichment";
import type { ExcellentProductCsvRow } from "@/lib/excellent-products/types";

function row(biz: string, name: string, hash: string): ExcellentProductCsvRow {
  return {
    designationNo: hash,
    bizNoNormalized: biz,
    companyNameCsv: name,
    representativeNameCsv: "CSV 대표",
    phoneCsv: "02-1111-2222",
    addressCsv: "서울",
    productName: "건물자동제어장치",
    designationStartDate: null,
    designationEndDate: null,
    productClassificationNo: "39121801-01",
    productClassificationNormalized: "3912180101",
    productClassificationName: "건물자동제어장치",
    productSpec: null,
    certificationDetailsRaw: null,
    sanctionType: null,
    sourceRowHash: hash,
    sourceDataset: "ignored-by-repository",
    sourceFileName: "snapshot.csv",
    sourceImportedAt: "2026-08-10T00:00:00.000Z",
    rawData: {},
  };
}

function clientsFor(
  overrides: Partial<ExcellentProductEnrichmentClients> = {},
): ExcellentProductEnrichmentClients {
  return {
    fetchCompanyBasicInfo: vi.fn(async () => ({
      corpNm: "API 회사",
      ceoNm: "API 대표",
      telNo: "02-9999-9999",
      address: "API 주소",
    })),
    fetchCompanyIndustries: vi.fn(async () => [
      { indstrytyCd: "A", indstrytyNm: "  제조업 ", status: "active" },
      { indstrytyCd: "A", indstrytyNm: "제조업", status: "active" },
      { indstrytyCd: "B", indstrytyNm: "서비스업", status: null },
      { indstrytyCd: "", indstrytyNm: null, status: null },
    ]),
    fetchThirdPartyProducts: vi.fn(async () => [
      {
        prdctClsfcNo: "39121801",
        dtilPrdctClsfcNo: "3912180101",
        prdctNm: null,
        prdctIdntNoNm: null,
        prdctSpec: null,
        cntrctCorpNm: null,
        headOfficeLocation: "본사만",
        factoryLocation: " 공장 A ",
      },
      {
        prdctClsfcNo: "99999999",
        dtilPrdctClsfcNo: null,
        prdctNm: null,
        prdctIdntNoNm: null,
        prdctSpec: null,
        cntrctCorpNm: null,
        headOfficeLocation: null,
        factoryLocation: "무관 공장",
      },
      {
        prdctClsfcNo: "39121801",
        dtilPrdctClsfcNo: "3912180102",
        prdctNm: null,
        prdctIdntNoNm: null,
        prdctSpec: null,
        cntrctCorpNm: null,
        headOfficeLocation: null,
        factoryLocation: "공장 A",
      },
    ]),
    ...overrides,
  };
}

describe("excellent product enrichment", () => {
  let sqlite: ReturnType<typeof createDb>["sqlite"];
  let db: ReturnType<typeof createDb>["db"];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "g2b-excellent-enrichment-"));
    ({ sqlite, db } = createDb(join(dir, "test.sqlite")));
    initializeSqliteSchema(sqlite);
  });

  afterEach(() => sqlite.close());

  it("calls each client once per business and atomically replaces child data", async () => {
    replaceExcellentProductsSnapshot(
      db,
      [
        row("1111111111", "회사 A", "a1"),
        row("1111111111", "회사 A", "a2"),
        row("1111111111", "회사 A", "a3"),
        row("1111111111", "회사 A", "a4"),
        row("1111111111", "회사 A", "a5"),
        row("2222222222", "회사 B", "b1"),
        row("2222222222", "회사 B", "b2"),
      ],
      "snapshot.csv",
    );
    sqlite
      .prepare("insert into factory_locations (biz_no_normalized, location, source) values (?, ?, ?)")
      .run("1111111111", "stale", "shopping-mall");

    const clients = clientsFor();
    const first = await syncBuildingControlCompanies(db, clients);

    expect(first).toEqual({ processedCompanies: 2, updatedCompanies: 2, errors: [] });
    expect(clients.fetchCompanyBasicInfo).toHaveBeenCalledTimes(2);
    expect(clients.fetchCompanyIndustries).toHaveBeenCalledTimes(2);
    expect(clients.fetchThirdPartyProducts).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare("select location from factory_locations where biz_no_normalized = ?").all("1111111111")).toEqual([
      { location: "공장 A" },
    ]);
    expect(sqlite.prepare("select industry_name as name from company_industries where biz_no_normalized = ? order by name").all("1111111111")).toEqual([
      { name: "서비스업" },
      { name: "제조업" },
    ]);

    const second = await syncBuildingControlCompanies(db, clients);
    expect(second.updatedCompanies).toBe(2);
    expect(sqlite.prepare("select count(*) as count from factory_locations where biz_no_normalized = ?").get("1111111111")).toEqual({ count: 1 });
  });

  it("uses the CSV company name for shopping-mall lookup", async () => {
    replaceExcellentProductsSnapshot(
      db,
      [row("1111111111", "CSV Alpha", "a1"), row("2222222222", "CSV Beta", "b1")],
      "snapshot.csv",
    );
    sqlite
      .prepare("update businesses set business_name = ?, profile_source = ? where biz_no_normalized = ?")
      .run("API Alpha", EXCELLENT_PRODUCTS_API_SOURCE_NAME, "1111111111");

    const clients = clientsFor();
    await syncBuildingControlCompanies(db, clients);

    expect(clients.fetchThirdPartyProducts).toHaveBeenCalledTimes(2);
    expect(clients.fetchThirdPartyProducts).toHaveBeenNthCalledWith(1, "CSV Alpha");
    expect(clients.fetchThirdPartyProducts).toHaveBeenNthCalledWith(2, "CSV Beta");
  });

  it("preserves a failed company and continues, while retaining CSV fallback fields", async () => {
    replaceExcellentProductsSnapshot(db, [row("1111111111", "회사 A", "a1"), row("2222222222", "회사 B", "b1")], "snapshot.csv");
    sqlite.prepare("update businesses set business_name = ?, profile_source = ? where biz_no_normalized = ?").run("CSV 이름", EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME, "1111111111");
    sqlite.prepare("insert into factory_locations (biz_no_normalized, location, source) values (?, ?, ?)").run("2222222222", "기존 공장", "shopping-mall");

    sqlite.prepare("insert into factory_locations (biz_no_normalized, location, source) values (?, ?, ?)").run("1111111111", "Existing Factory", "shopping-mall");
    sqlite.prepare("insert into company_industries (biz_no_normalized, industry_code, industry_name, status, source) values (?, ?, ?, ?, ?)").run(
      "1111111111",
      "OLD",
      "Existing Industry",
      "active",
      "shopping-mall",
    );
    const clients = clientsFor({
      fetchCompanyBasicInfo: vi.fn(async (bizNo) => {
        if (bizNo === "1111111111") throw new Error("serviceKey=super-secret");
        return { corpNm: null, ceoNm: null, telNo: null, address: null };
      }),
    });
    const result = await syncBuildingControlCompanies(db, clients);

    expect(result.processedCompanies).toBe(2);
    expect(result.updatedCompanies).toBe(1);
    expect(result.errors).toEqual([{ bizNoNormalized: "1111111111", message: "serviceKey=[REDACTED]" }]);
    expect(sqlite.prepare("select location from factory_locations where biz_no_normalized = ?").all("2222222222")).toEqual([{ location: "공장 A" }]);
    expect(sqlite.prepare("select location from factory_locations where biz_no_normalized = ?").all("1111111111")).toEqual([
      { location: "Existing Factory" },
    ]);
    expect(
      sqlite
        .prepare("select industry_code as industryCode, industry_name as industryName, status from company_industries where biz_no_normalized = ?")
        .all("1111111111"),
    ).toEqual([{ industryCode: "OLD", industryName: "Existing Industry", status: "active" }]);
    expect(sqlite.prepare("select business_name as name, profile_source as source from businesses where biz_no_normalized = ?").get("1111111111")).toEqual({ name: "CSV 이름", source: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME });
  });


  it("removes stale factory and industry rows when repeated successful syncs return changed outputs", async () => {
    replaceExcellentProductsSnapshot(db, [row("1111111111", "Company A", "a1")], "snapshot.csv");
    sqlite.prepare("insert into factory_locations (biz_no_normalized, location, source) values (?, ?, ?)").run("1111111111", "stale factory", "shopping-mall");
    sqlite.prepare("insert into company_industries (biz_no_normalized, industry_code, industry_name, status, source) values (?, ?, ?, ?, ?)").run(
      "1111111111",
      "OLD",
      "Stale Industry",
      "active",
      "shopping-mall",
    );
    const clients = clientsFor({
      fetchCompanyIndustries: vi.fn()
        .mockResolvedValueOnce([{ indstrytyCd: "OLD", indstrytyNm: "Old Industry", status: "active" }])
        .mockResolvedValueOnce([{ indstrytyCd: "NEW", indstrytyNm: "New Industry", status: "active" }]),
      fetchThirdPartyProducts: vi.fn()
        .mockResolvedValueOnce([
          {
            prdctClsfcNo: "39121801",
            dtilPrdctClsfcNo: "3912180101",
            prdctNm: null,
            prdctIdntNoNm: null,
            prdctSpec: null,
            cntrctCorpNm: null,
            headOfficeLocation: null,
            factoryLocation: "Old Factory",
          },
        ])
        .mockResolvedValueOnce([
          {
            prdctClsfcNo: "39121801",
            dtilPrdctClsfcNo: "3912180102",
            prdctNm: null,
            prdctIdntNoNm: null,
            prdctSpec: null,
            cntrctCorpNm: null,
            headOfficeLocation: null,
            factoryLocation: "New Factory",
          },
        ]),
    });

    const first = await syncBuildingControlCompanies(db, clients);
    expect(first).toEqual({ processedCompanies: 1, updatedCompanies: 1, errors: [] });
    expect(sqlite.prepare("select location as location from factory_locations where biz_no_normalized = ?").all("1111111111")).toEqual([
      { location: "Old Factory" },
    ]);
    expect(
      sqlite
        .prepare("select industry_code as industryCode, industry_name as industryName, status from company_industries where biz_no_normalized = ?")
        .all("1111111111"),
    ).toEqual([{ industryCode: "OLD", industryName: "Old Industry", status: "active" }]);

    const second = await syncBuildingControlCompanies(db, clients);
    expect(second).toEqual({ processedCompanies: 1, updatedCompanies: 1, errors: [] });
    expect(sqlite.prepare("select location as location from factory_locations where biz_no_normalized = ?").all("1111111111")).toEqual([
      { location: "New Factory" },
    ]);
    expect(
      sqlite
        .prepare("select industry_code as industryCode, industry_name as industryName, status from company_industries where biz_no_normalized = ?")
        .all("1111111111"),
    ).toEqual([{ industryCode: "NEW", industryName: "New Industry", status: "active" }]);
  });

  it("stores no factory row when only a head office is returned", async () => {
    replaceExcellentProductsSnapshot(db, [row("1111111111", "CSV One", "a1")], "snapshot.csv");
    const clients = clientsFor({
      fetchCompanyIndustries: vi.fn(async () => []),
      fetchThirdPartyProducts: vi.fn(async () => [
        {
          prdctClsfcNo: "39121801",
          dtilPrdctClsfcNo: "3912180101",
          prdctNm: null,
          prdctIdntNoNm: null,
          prdctSpec: null,
          cntrctCorpNm: null,
          headOfficeLocation: "Head office only",
          factoryLocation: null,
        },
      ]),
    });

    await syncBuildingControlCompanies(db, clients);
    expect(sqlite.prepare("select count(*) as count from factory_locations where biz_no_normalized = ?").get("1111111111")).toEqual({ count: 0 });
  });
  it("does not call clients when the snapshot has no products", async () => {
    const clients = clientsFor();
    expect(await syncBuildingControlCompanies(db, clients)).toEqual({
      processedCompanies: 0,
      updatedCompanies: 0,
      errors: [],
    });
    expect(clients.fetchCompanyBasicInfo).not.toHaveBeenCalled();
    expect(clients.fetchCompanyIndustries).not.toHaveBeenCalled();
    expect(clients.fetchThirdPartyProducts).not.toHaveBeenCalled();
  });

  it("lets non-null API profile fields win while retaining CSV values for nulls", async () => {
    replaceExcellentProductsSnapshot(db, [row("1111111111", "CSV 이름", "a1")], "snapshot.csv");
    const clients = clientsFor({
      fetchCompanyBasicInfo: vi.fn(async () => ({
        corpNm: "API 이름",
        ceoNm: null,
        telNo: "02-7777-7777",
        address: null,
      })),
    });

    await syncBuildingControlCompanies(db, clients);
    expect(sqlite.prepare("select business_name as name, representative_name as representative, phone, address, profile_source as source from businesses where biz_no_normalized = ?").get("1111111111")).toEqual({
      name: "API 이름",
      representative: "CSV 대표",
      phone: "02-7777-7777",
      address: "서울",
      source: EXCELLENT_PRODUCTS_API_SOURCE_NAME,
    });
  });
});
