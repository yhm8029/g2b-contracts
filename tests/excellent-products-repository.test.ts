import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importParsedRows } from "@/lib/contracts/repository";
import type { ParsedContractCsvRow } from "@/lib/import/csv";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import {
  EXCELLENT_PRODUCTS_API_SOURCE_NAME,
  EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME,
  EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
  EXCELLENT_PRODUCTS_SOURCE_DATASET,
} from "@/lib/excellent-products/constants";
import {
  getBuildingControlExcellentProductsSnapshotRowCount,
  replaceExcellentProductsSnapshot,
} from "@/lib/excellent-products/repository";
import type { ExcellentProductCsvRow } from "@/lib/excellent-products/types";

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "g2b-excellent-products-"));
  const connection = createDb(join(dir, "excellent.sqlite"));
  initializeSqliteSchema(connection.sqlite);
  return connection;
}

function createLegacyBusinessDb() {
  const dir = mkdtempSync(join(tmpdir(), "g2b-excellent-products-legacy-"));
  const sqlite = new Database(join(dir, "legacy.sqlite"));
  sqlite.exec(`
    CREATE TABLE businesses (
      id INTEGER PRIMARY KEY,
      biz_no_normalized TEXT NOT NULL,
      biz_no_display TEXT,
      business_name TEXT,
      representative_name TEXT,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return { dir, sqlite };
}

function buildRow(overrides: Partial<ExcellentProductCsvRow> = {}): ExcellentProductCsvRow {
  const base: ExcellentProductCsvRow = {
    designationNo: "EQ-2024-001",
    bizNoNormalized: "1234567890",
    companyNameCsv: "스마트빌딩",
    representativeNameCsv: "홍길동",
    phoneCsv: "02-1234-5678",
    addressCsv: "서울특별시 강남구 테헤란로 123",
    productName: "빌딩자동제어장치",
    designationStartDate: "2024-01-15",
    designationEndDate: "2026-01-14",
    productClassificationNo: "39121801-01",
    productClassificationNormalized: "3912180101",
    productClassificationName: "빌딩자동제어장치",
    productSpec: "표준규격",
    certificationDetailsRaw: "K마크",
    sanctionType: "없음",
    sourceRowHash: "hash-001",
    sourceDataset: "csv:test.csv",
    sourceFileName: "test.csv",
    sourceImportedAt: "2026-08-10T00:00:00.000Z",
    rawData: {},
  };

  return { ...base, ...overrides };
}

function listBusinessColumns(sqlite: Database.Database): string[] {
  const columns = sqlite
    .prepare("pragma table_info(businesses)")
    .all() as { name: string }[];
  return columns.map((column) => column.name);
}

function snapshotCount(sqlite: Database.Database): number {
  return getBuildingControlExcellentProductsSnapshotRowCount(sqlite);
}

describe("excellent products repository", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof createDb>["db"];

  beforeEach(() => {
    ({ sqlite, db } = createTempDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates excellent_products, factory_locations, and company_industries tables", () => {
    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as { name: string }[];

    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "excellent_products",
        "factory_locations",
        "company_industries",
      ]),
    );
  });

  it("adds phone, profile_source, and last_synced_at to businesses for fresh DBs", () => {
    expect(listBusinessColumns(sqlite)).toEqual(
      expect.arrayContaining(["phone", "profile_source", "last_synced_at"]),
    );
  });

  it("adds phone, profile_source, and last_synced_at to legacy businesses via ALTER", () => {
    sqlite.close();
    const { sqlite: legacySqlite } = createLegacyBusinessDb();

    initializeSqliteSchema(legacySqlite);

    expect(listBusinessColumns(legacySqlite)).toEqual(
      expect.arrayContaining(["phone", "profile_source", "last_synced_at"]),
    );

    legacySqlite.close();
  });

  it("is idempotent when initializeSqliteSchema runs twice", () => {
    initializeSqliteSchema(sqlite);

    expect(listBusinessColumns(sqlite)).toEqual(
      expect.arrayContaining(["phone", "profile_source", "last_synced_at"]),
    );

    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as { name: string }[];
    expect(tables.filter((row) => row.name === "excellent_products")).toHaveLength(1);
  });

  it("rejects empty target snapshots without opening a transaction", () => {
    expect(() => replaceExcellentProductsSnapshot(db, [], "empty.csv")).toThrow(
      /empty/i,
    );

    const productCount = sqlite
      .prepare("select count(*) as count from excellent_products")
      .get() as { count: number };
    expect(productCount.count).toBe(0);
  });

  it("stores duplicate source rows as a single product row", () => {
    const row = buildRow();
    const result = replaceExcellentProductsSnapshot(
      db,
      [row, { ...row, sourceImportedAt: "2026-08-10T01:00:00.000Z" }],
      "duplicate.csv",
    );

    expect(result.insertedCount).toBe(1);
    expect(snapshotCount(sqlite)).toBe(1);
  });

  it("stores multiple designations for the same business as separate rows", () => {
    const result = replaceExcellentProductsSnapshot(
      db,
      [
        buildRow({ designationNo: "EQ-2024-001", sourceRowHash: "hash-001" }),
        buildRow({
          designationNo: "EQ-2024-002",
          sourceRowHash: "hash-002",
          productSpec: "확장규격",
        }),
        buildRow({
          bizNoNormalized: "9876543210",
          companyNameCsv: "다른회사",
          designationNo: "EQ-2024-003",
          sourceRowHash: "hash-003",
        }),
      ],
      "multi.csv",
    );

    expect(result.insertedCount).toBe(3);

    const businessCount = sqlite
      .prepare("select count(*) as count from businesses")
      .get() as { count: number };
    expect(businessCount.count).toBe(2);
    expect(snapshotCount(sqlite)).toBe(3);
  });

  it("is idempotent when re-importing the same snapshot", () => {
    const rows = [
      buildRow({ designationNo: "EQ-2024-001", sourceRowHash: "hash-001" }),
      buildRow({
        designationNo: "EQ-2024-002",
        sourceRowHash: "hash-002",
        bizNoNormalized: "9876543210",
        companyNameCsv: "다른회사",
      }),
    ];

    replaceExcellentProductsSnapshot(db, rows, "first.csv");
    const second = replaceExcellentProductsSnapshot(db, rows, "second.csv");

    expect(second.insertedCount).toBe(0);
    expect(snapshotCount(sqlite)).toBe(2);
  });

  it("removes stale excellent products but preserves factory and industry rows on replacement", () => {
    replaceExcellentProductsSnapshot(
      db,
      [buildRow({ designationNo: "EQ-2024-001", sourceRowHash: "hash-001" })],
      "first.csv",
    );

    sqlite
      .prepare(
        "insert into factory_locations (biz_no_normalized, location, source, created_at, updated_at) values (?, ?, ?, ?, ?)",
      )
      .run(
        "1234567890",
        "경기도 화성",
        "shopping-mall",
        "2026-08-10T00:00:00.000Z",
        "2026-08-10T00:00:00.000Z",
      );
    sqlite
      .prepare(
        "insert into company_industries (biz_no_normalized, industry_code, industry_name, status, source, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "1234567890",
        "45211",
        "컴퓨터프로그래밍",
        "active",
        "user-info",
        "2026-08-10T00:00:00.000Z",
        "2026-08-10T00:00:00.000Z",
      );

    const replacement = replaceExcellentProductsSnapshot(
      db,
      [
        buildRow({
          designationNo: "EQ-2025-100",
          sourceRowHash: "hash-100",
          bizNoNormalized: "5555555555",
          companyNameCsv: "신규회사",
        }),
      ],
      "second.csv",
    );

    expect(replacement.insertedCount).toBe(1);
    expect(snapshotCount(sqlite)).toBe(1);

    const factory = sqlite
      .prepare("select count(*) as count from factory_locations")
      .get() as { count: number };
    const industry = sqlite
      .prepare("select count(*) as count from company_industries")
      .get() as { count: number };
    expect(factory.count).toBe(1);
    expect(industry.count).toBe(1);
  });

  it("records an import_runs row with the excellent-products-csv source name", () => {
    replaceExcellentProductsSnapshot(
      db,
      [buildRow({ designationNo: "EQ-2024-001", sourceRowHash: "hash-001" })],
      "snapshot.csv",
    );

    const latest = sqlite
      .prepare(
        "select source_name as sourceName, source_file_name as sourceFileName, status from import_runs order by id desc limit 1",
      )
      .get() as { sourceName: string; sourceFileName: string; status: string };

    expect(latest).toEqual({
      sourceName: "excellent-products-csv",
      sourceFileName: "snapshot.csv",
      status: "completed",
    });
  });

  it("upserts CSV profile values only as fallbacks when existing business profile is null", () => {
    replaceExcellentProductsSnapshot(
      db,
      [
        buildRow({
          designationNo: "EQ-2024-001",
          sourceRowHash: "hash-001",
          companyNameCsv: "CSV에서 가져온 이름",
          representativeNameCsv: "CSV대표",
          phoneCsv: "02-1111-2222",
          addressCsv: "CSV주소",
        }),
      ],
      "fallback.csv",
    );

    const business = sqlite
      .prepare(
        [
          "select business_name as businessName, representative_name as representativeName,",
          "phone, address, profile_source as profileSource",
          "from businesses where biz_no_normalized = ?",
        ].join(" "),
      )
      .get("1234567890") as {
      businessName: string;
      representativeName: string;
      phone: string;
      address: string;
      profileSource: string;
    };

    expect(business).toEqual({
      businessName: "CSV에서 가져온 이름",
      representativeName: "CSV대표",
      phone: "02-1111-2222",
      address: "CSV주소",
      profileSource: "excellent-products-csv",
    });
  });

  it("preserves API-enriched profile data when a later contract CSV has null profile fields", () => {
    sqlite
      .prepare(
        [
          "insert into businesses",
          "(biz_no_normalized, biz_no_display, business_name, representative_name, phone, address, profile_source, last_synced_at, created_at, updated_at)",
          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        "1234567890",
        "123-45-67890",
        "API 회사명",
        "API대표",
        "02-9999-9999",
        "API주소",
        "user-info",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      );

    const contractRow: ParsedContractCsvRow = {
      sourceDataset: "g2b-contracts",
      sourceRowHash: "contract-hash-1",
      bizNoNormalized: "1234567890",
      bizNoDisplay: "123-45-67890",
      businessName: null as unknown as string,
      representativeName: null,
      address: null,
      businessCategory: "goods",
      noticeNo: null,
      noticeOrder: null,
      noticeName: null,
      contractNo: "CN-2026-0001",
      unifiedContractNo: null,
      contractName: "Sample contract",
      contractDate: "2026-08-10",
      currentContractAmount: 1_000_000,
      totalContractAmount: 1_000_000,
      demandAgencyCode: null,
      demandAgencyName: null,
      contractAgencyCode: null,
      contractAgencyName: null,
      contractMethod: null,
      winningMethod: null,
      businessNameAtContract: null,
      contractDetailUrl: null,
      noticeDetailUrl: null,
      rawSourceUrl: null,
    };

    importParsedRows(db, [contractRow], "contract.csv");

    const business = sqlite
      .prepare(
        [
          "select business_name as businessName, representative_name as representativeName,",
          "phone, address, profile_source as profileSource",
          "from businesses where biz_no_normalized = ?",
        ].join(" "),
      )
      .get("1234567890") as {
      businessName: string;
      representativeName: string;
      phone: string;
      address: string;
      profileSource: string;
    };

    expect(business).toEqual({
      businessName: "API 회사명",
      representativeName: "API대표",
      phone: "02-9999-9999",
      address: "API주소",
      profileSource: "user-info",
    });
  });

  it("uses a stable source dataset regardless of CSV filename", () => {
    const rowFromA = buildRow({
      sourceRowHash: "shared-hash-001",
      sourceDataset: "csv:a.csv",
      sourceFileName: "a.csv",
    });
    const rowFromB = buildRow({
      sourceRowHash: "shared-hash-002",
      sourceDataset: "csv:b.csv",
      sourceFileName: "b.csv",
    });

    const fromA = replaceExcellentProductsSnapshot(db, [rowFromA], "a.csv");
    expect(fromA.insertedCount).toBe(1);

    // The second import reuses the same stable dataset, so it replaces
    // the previous rows; the source dataset identifier stays constant
    // even though the CSV filename changed.
    const fromB = replaceExcellentProductsSnapshot(db, [rowFromB], "b.csv");
    expect(fromB.insertedCount).toBe(1);
    expect(fromB.updatedCount).toBe(0);

    const datasets = sqlite
      .prepare(
        "select distinct source_dataset as sourceDataset from excellent_products",
      )
      .all() as { sourceDataset: string }[];
    expect(datasets.map((row) => row.sourceDataset)).toEqual([
      EXCELLENT_PRODUCTS_SOURCE_DATASET,
    ]);

    // The CSV filename is preserved per row for traceability even though
    // sourceDataset is stable.
    const fileNames = sqlite
      .prepare(
        "select source_file_name as sourceFileName from excellent_products",
      )
      .all() as { sourceFileName: string }[];
    expect(fileNames.map((row) => row.sourceFileName)).toEqual(["b.csv"]);
  });

  it("removes old rows when re-importing under a different CSV filename", () => {
    const firstBatch = [
      buildRow({ designationNo: "EQ-OLD-001", sourceRowHash: "old-hash-001" }),
      buildRow({ designationNo: "EQ-OLD-002", sourceRowHash: "old-hash-002" }),
    ];

    replaceExcellentProductsSnapshot(db, firstBatch, "first.csv");

    // Seed factory and industry enrichment that must survive.
    sqlite
      .prepare(
        "insert into factory_locations (biz_no_normalized, location, source, created_at, updated_at) values (?, ?, ?, ?, ?)",
      )
      .run(
        "1234567890",
        "경기도 화성",
        "shopping-mall",
        "2026-08-10T00:00:00.000Z",
        "2026-08-10T00:00:00.000Z",
      );
    sqlite
      .prepare(
        "insert into company_industries (biz_no_normalized, industry_code, industry_name, status, source, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "1234567890",
        "45211",
        "컴퓨터프로그래밍",
        "active",
        "user-info",
        "2026-08-10T00:00:00.000Z",
        "2026-08-10T00:00:00.000Z",
      );

    const secondBatch = [
      buildRow({
        designationNo: "EQ-NEW-001",
        sourceRowHash: "new-hash-001",
        bizNoNormalized: "5555555555",
        companyNameCsv: "신규회사",
      }),
      buildRow({
        designationNo: "EQ-NEW-002",
        sourceRowHash: "new-hash-002",
        bizNoNormalized: "6666666666",
        companyNameCsv: "또다른회사",
      }),
    ];

    const secondResult = replaceExcellentProductsSnapshot(db, secondBatch, "second.csv");

    expect(secondResult.insertedCount).toBe(2);

    const designations = sqlite
      .prepare(
        "select designation_no as designationNo from excellent_products order by designation_no",
      )
      .all() as { designationNo: string }[];
    expect(designations.map((row) => row.designationNo)).toEqual([
      "EQ-NEW-001",
      "EQ-NEW-002",
    ]);

    const staleCount = sqlite
      .prepare(
        "select count(*) as count from excellent_products where source_dataset = ?",
      )
      .get(EXCELLENT_PRODUCTS_SOURCE_DATASET) as { count: number };
    expect(staleCount.count).toBe(2);

    const factory = sqlite
      .prepare("select count(*) as count from factory_locations")
      .get() as { count: number };
    const industry = sqlite
      .prepare("select count(*) as count from company_industries")
      .get() as { count: number };
    expect(factory.count).toBe(1);
    expect(industry.count).toBe(1);
  });

  it("rolls back the entire snapshot when a row write fails mid-import", () => {
    const validRow = buildRow({
      designationNo: "EQ-INITIAL-001",
      sourceRowHash: "initial-hash",
      bizNoNormalized: "1111111111",
      companyNameCsv: "초기회사",
    });

    const initial = replaceExcellentProductsSnapshot(db, [validRow], "initial.csv");
    expect(initial.insertedCount).toBe(1);

    const importRunsBefore = sqlite
      .prepare("select count(*) as count from import_runs")
      .get() as { count: number };
    expect(importRunsBefore.count).toBe(1);

    // Simulate a row whose payload fails the SQLite write. Passing
    // undefined binds NULL, which violates the NOT NULL constraint on
    // biz_no_normalized and aborts the surrounding transaction.
    const invalidRow = {
      ...buildRow({ designationNo: "EQ-BAD-001", sourceRowHash: "bad-hash" }),
      bizNoNormalized: undefined as unknown as string,
    };

    expect(() =>
      replaceExcellentProductsSnapshot(db, [invalidRow], "broken.csv"),
    ).toThrow();

    const snapshotAfter = sqlite
      .prepare(
        "select designation_no as designationNo from excellent_products order by designation_no",
      )
      .all() as { designationNo: string }[];
    expect(snapshotAfter.map((row) => row.designationNo)).toEqual(["EQ-INITIAL-001"]);

    const importRunsAfter = sqlite
      .prepare("select count(*) as count from import_runs")
      .get() as { count: number };
    expect(importRunsAfter.count).toBe(1);
  });

  it("lets an excellent CSV replace non-null contract profile fields", () => {
    sqlite
      .prepare(
        [
          "insert into businesses",
          "(biz_no_normalized, biz_no_display, business_name, representative_name, phone, address, profile_source, last_synced_at, created_at, updated_at)",
          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        "1234567890",
        "123-45-67890",
        "계약 회사명",
        "계약대표",
        "02-1111-1111",
        "계약주소",
        EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME,
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );

    replaceExcellentProductsSnapshot(
      db,
      [
        buildRow({
          designationNo: "EQ-2024-001",
          sourceRowHash: "hash-001",
          companyNameCsv: "CSV 회사명",
          representativeNameCsv: "CSV대표",
          phoneCsv: "02-2222-2222",
          addressCsv: "CSV주소",
        }),
      ],
      "csv-wins.csv",
    );

    const business = sqlite
      .prepare(
        [
          "select business_name as businessName, representative_name as representativeName,",
          "phone, address, profile_source as profileSource",
          "from businesses where biz_no_normalized = ?",
        ].join(" "),
      )
      .get("1234567890") as {
      businessName: string;
      representativeName: string;
      phone: string;
      address: string;
      profileSource: string;
    };

    expect(business).toEqual({
      businessName: "CSV 회사명",
      representativeName: "CSV대표",
      phone: "02-2222-2222",
      address: "CSV주소",
      profileSource: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
    });
  });

  it("leaves API-enriched profile fields untouched when an excellent CSV arrives", () => {
    sqlite
      .prepare(
        [
          "insert into businesses",
          "(biz_no_normalized, biz_no_display, business_name, representative_name, phone, address, profile_source, last_synced_at, created_at, updated_at)",
          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        "1234567890",
        "123-45-67890",
        "API 회사명",
        "API대표",
        "02-9999-9999",
        "API주소",
        EXCELLENT_PRODUCTS_API_SOURCE_NAME,
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      );

    replaceExcellentProductsSnapshot(
      db,
      [
        buildRow({
          designationNo: "EQ-2024-001",
          sourceRowHash: "hash-001",
          companyNameCsv: "CSV 회사명",
          representativeNameCsv: "CSV대표",
          phoneCsv: "02-2222-2222",
          addressCsv: "CSV주소",
        }),
      ],
      "api-protected.csv",
    );

    const business = sqlite
      .prepare(
        [
          "select business_name as businessName, representative_name as representativeName,",
          "phone, address, profile_source as profileSource",
          "from businesses where biz_no_normalized = ?",
        ].join(" "),
      )
      .get("1234567890") as {
      businessName: string;
      representativeName: string;
      phone: string;
      address: string;
      profileSource: string;
    };

    expect(business).toEqual({
      businessName: "API 회사명",
      representativeName: "API대표",
      phone: "02-9999-9999",
      address: "API주소",
      profileSource: EXCELLENT_PRODUCTS_API_SOURCE_NAME,
    });
  });

  it("never lets a contract import overwrite non-null CSV or API profile values", () => {
    sqlite
      .prepare(
        [
          "insert into businesses",
          "(biz_no_normalized, biz_no_display, business_name, representative_name, phone, address, profile_source, last_synced_at, created_at, updated_at)",
          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        "1234567890",
        "123-45-67890",
        "CSV 회사명",
        "CSV대표",
        "02-2222-2222",
        "CSV주소",
        EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
      );

    const contractRow: ParsedContractCsvRow = {
      sourceDataset: "g2b-contracts",
      sourceRowHash: "contract-hash-overwrite",
      bizNoNormalized: "1234567890",
      bizNoDisplay: "123-45-67890",
      businessName: "계약 회사명",
      representativeName: "계약대표",
      address: "계약주소",
      businessCategory: "goods",
      noticeNo: null,
      noticeOrder: null,
      noticeName: null,
      contractNo: "CN-2026-9001",
      unifiedContractNo: null,
      contractName: "Sample contract",
      contractDate: "2026-08-10",
      currentContractAmount: 1_000_000,
      totalContractAmount: 1_000_000,
      demandAgencyCode: null,
      demandAgencyName: null,
      contractAgencyCode: null,
      contractAgencyName: null,
      contractMethod: null,
      winningMethod: null,
      businessNameAtContract: null,
      contractDetailUrl: null,
      noticeDetailUrl: null,
      rawSourceUrl: null,
    };

    importParsedRows(db, [contractRow], "contract.csv");

    const business = sqlite
      .prepare(
        [
          "select business_name as businessName, representative_name as representativeName,",
          "phone, address, profile_source as profileSource",
          "from businesses where biz_no_normalized = ?",
        ].join(" "),
      )
      .get("1234567890") as {
      businessName: string;
      representativeName: string;
      phone: string;
      address: string;
      profileSource: string;
    };

    expect(business).toEqual({
      businessName: "CSV 회사명",
      representativeName: "CSV대표",
      phone: "02-2222-2222",
      address: "CSV주소",
      profileSource: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
    });
  });

  it("never erases a stored non-null field when an incoming value is null", () => {
    sqlite
      .prepare(
        [
          "insert into businesses",
          "(biz_no_normalized, biz_no_display, business_name, representative_name, phone, address, profile_source, last_synced_at, created_at, updated_at)",
          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        "1234567890",
        "123-45-67890",
        "CSV 회사명",
        "CSV대표",
        "02-2222-2222",
        "CSV주소",
        EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
      );

    const contractRow: ParsedContractCsvRow = {
      sourceDataset: "g2b-contracts",
      sourceRowHash: "contract-hash-null",
      bizNoNormalized: "1234567890",
      bizNoDisplay: "123-45-67890",
      businessName: null as unknown as string,
      representativeName: null,
      address: null,
      businessCategory: "goods",
      noticeNo: null,
      noticeOrder: null,
      noticeName: null,
      contractNo: "CN-2026-9002",
      unifiedContractNo: null,
      contractName: "Another contract",
      contractDate: "2026-08-10",
      currentContractAmount: 1_000_000,
      totalContractAmount: 1_000_000,
      demandAgencyCode: null,
      demandAgencyName: null,
      contractAgencyCode: null,
      contractAgencyName: null,
      contractMethod: null,
      winningMethod: null,
      businessNameAtContract: null,
      contractDetailUrl: null,
      noticeDetailUrl: null,
      rawSourceUrl: null,
    };

    importParsedRows(db, [contractRow], "contract-null.csv");

    const business = sqlite
      .prepare(
        [
          "select business_name as businessName, representative_name as representativeName,",
          "phone, address, profile_source as profileSource",
          "from businesses where biz_no_normalized = ?",
        ].join(" "),
      )
      .get("1234567890") as {
      businessName: string;
      representativeName: string;
      phone: string;
      address: string;
      profileSource: string;
    };

    expect(business).toEqual({
      businessName: "CSV 회사명",
      representativeName: "CSV대표",
      phone: "02-2222-2222",
      address: "CSV주소",
      profileSource: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
    });
  });
});