import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { summarizeContracts } from "@/lib/contracts/summary";
import {
  getDatabaseHealth,
  importParsedRows,
  searchContractsByBusinessNumber,
} from "@/lib/contracts/repository";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { parseContractCsv, type ParsedContractCsvRow } from "@/lib/import/csv";

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "g2b-contracts-"));
  const connection = createDb(join(dir, "contracts.sqlite"));
  initializeSqliteSchema(connection.sqlite);
  return connection;
}

describe("contract repository", () => {
  it("imports sample contracts, searches, filters, and summarizes idempotently", () => {
    const { sqlite, db } = createTempDb();
    const sourceFileName = "sample-contracts.csv";
    const csv = readFileSync(join(process.cwd(), "data", sourceFileName), "utf8");
    const parsed = parseContractCsv(csv, sourceFileName);

    expect(parsed.errors).toEqual([]);

    try {
      const firstImport = importParsedRows(db, parsed.validRows, sourceFileName);

      expect(firstImport).toMatchObject({
        rowCount: 2,
        insertedCount: 2,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      });

      const searchRows = searchContractsByBusinessNumber(db, {
        bizNo: "123-45-67890",
      });

      expect(searchRows).toHaveLength(2);
      expect(searchRows.map((row) => row.contractDate)).toEqual(["2026-03-20", "2026-01-15"]);
      expect(searchRows[0]).toMatchObject({
        contractName: "Maintenance service",
        businessName: "Sample Office Co",
        bizNoNormalized: "1234567890",
        contractDetailUrl: "https://example.test/contract/2",
        noticeDetailUrl: "https://example.test/notice/2",
        rawSourceUrl: "https://example.test/raw/2",
        sourceDataset: "csv:sample-contracts.csv",
        sourceStatus: "local_only",
        demandAgencyName: "Seoul Test Office",
        contractAgencyName: "Seoul Test Office",
        lastImportedAt: expect.any(String),
        lastEnrichedAt: null,
      });

      const dateFilteredRows = searchContractsByBusinessNumber(db, {
        bizNo: "1234567890",
        dateFrom: "2026-02-01",
        dateTo: "2026-12-31",
      });
      expect(dateFilteredRows.map((row) => row.contractName)).toEqual(["Maintenance service"]);

      const categoryFilteredRows = searchContractsByBusinessNumber(db, {
        bizNo: "1234567890",
        businessCategory: "goods",
      });
      expect(categoryFilteredRows.map((row) => row.contractName)).toEqual(["Printer supply"]);

      const allCategoryRows = searchContractsByBusinessNumber(db, {
        bizNo: "1234567890",
        businessCategory: "all",
      });
      expect(allCategoryRows).toHaveLength(2);

      const summary = summarizeContracts(searchRows);
      expect(summary).toEqual({
        contractCount: 2,
        totalAmount: 4_600_000,
        noticeLinkedCount: 2,
        latestContractDate: "2026-03-20",
      });

      const secondImport = importParsedRows(db, parsed.validRows, sourceFileName);
      expect(secondImport.insertedCount).toBe(0);
      expect(secondImport.updatedCount).toBe(2);
      expect(secondImport.errorCount).toBe(0);

      const health = getDatabaseHealth(db);
      expect(health.contractCount).toBe(2);
      expect(health.latestImportAt).toEqual(expect.any(String));

      const records = sqlite
        .prepare("select count(*) as count from contract_records")
        .get() as { count: number };
      expect(records.count).toBe(2);

      const latestImportRun = sqlite
        .prepare("select source_name as sourceName from import_runs order by id desc limit 1")
        .get() as { sourceName: string };
      expect(latestImportRun.sourceName).toBe("csv");
    } finally {
      sqlite.close();
    }
  });

  it("preserves enrichment metadata when CSV rows are re-imported", () => {
    const { sqlite, db } = createTempDb();
    const sourceFileName = "sample-contracts.csv";
    const csv = readFileSync(join(process.cwd(), "data", sourceFileName), "utf8");
    const parsed = parseContractCsv(csv, sourceFileName);
    const enrichedAt = "2026-06-26T12:34:56.000Z";

    expect(parsed.errors).toEqual([]);

    try {
      importParsedRows(db, parsed.validRows, sourceFileName);

      sqlite
        .prepare(
          [
            "update contract_records",
            "set source_status = ?, last_enriched_at = ?",
            "where contract_no = ?",
          ].join(" "),
        )
        .run("api_enriched", enrichedAt, "CN-2026-0001");

      const reimport = importParsedRows(db, parsed.validRows, sourceFileName);
      expect(reimport.updatedCount).toBe(2);

      const enrichedRecord = sqlite
        .prepare(
          [
            "select source_status as sourceStatus, last_enriched_at as lastEnrichedAt",
            "from contract_records",
            "where contract_no = ?",
          ].join(" "),
        )
        .get("CN-2026-0001") as { sourceStatus: string; lastEnrichedAt: string | null };

      expect(enrichedRecord).toEqual({
        sourceStatus: "api_enriched",
        lastEnrichedAt: enrichedAt,
      });
    } finally {
      sqlite.close();
    }
  });

  it("records csv as the default import source name", () => {
    const { sqlite, db } = createTempDb();
    const sourceFileName = "sample-contracts.csv";
    const csv = readFileSync(join(process.cwd(), "data", sourceFileName), "utf8");
    const parsed = parseContractCsv(csv, sourceFileName);

    expect(parsed.errors).toEqual([]);

    try {
      importParsedRows(db, [parsed.validRows[0]], sourceFileName);

      const latestImportRun = sqlite
        .prepare("select source_name as sourceName from import_runs order by id desc limit 1")
        .get() as { sourceName: string };

      expect(latestImportRun.sourceName).toBe("csv");
    } finally {
      sqlite.close();
    }
  });

  it("returns latest enrichment log status and error with search rows", () => {
    const { sqlite, db } = createTempDb();
    const sourceFileName = "sample-contracts.csv";
    const csv = readFileSync(join(process.cwd(), "data", sourceFileName), "utf8");
    const parsed = parseContractCsv(csv, sourceFileName);

    expect(parsed.errors).toEqual([]);

    try {
      importParsedRows(db, parsed.validRows, sourceFileName);

      const record = sqlite
        .prepare("select id from contract_records where contract_no = ?")
        .get("CN-2026-0001") as { id: number };

      sqlite
        .prepare(
          [
            "insert into api_enrichment_logs",
            "(contract_record_id, provider, operation, response_status, error_message, created_at)",
            "values (?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(record.id, "data-go-kr", "contract-info", "ok", null, "2026-06-26T01:00:00.000Z");
      sqlite
        .prepare(
          [
            "insert into api_enrichment_logs",
            "(contract_record_id, provider, operation, response_status, error_message, created_at)",
            "values (?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          record.id,
          "data-go-kr",
          "contract-info",
          "error",
          "DATA_GO_KR_SERVICE_KEY=[REDACTED] timeout",
          "2026-06-26T02:00:00.000Z",
        );

      const [latestRow] = searchContractsByBusinessNumber(db, {
        bizNo: "1234567890",
        businessCategory: "goods",
      });

      expect(latestRow).toMatchObject({
        latestEnrichmentStatus: "error",
        latestEnrichmentError: "DATA_GO_KR_SERVICE_KEY=[REDACTED] timeout",
      });
    } finally {
      sqlite.close();
    }
  });

  it("does not leave a business-only partial write when a contract row fails", () => {
    const { sqlite, db } = createTempDb();
    const sourceFileName = "sample-contracts.csv";
    const csv = readFileSync(join(process.cwd(), "data", sourceFileName), "utf8");
    const parsed = parseContractCsv(csv, sourceFileName);
    const validRow = {
      ...parsed.validRows[0],
      sourceRowHash: "valid-sibling",
      bizNoNormalized: "1112223334",
      bizNoDisplay: "111-22-23334",
      businessName: "Valid Sibling Co",
    } satisfies ParsedContractCsvRow;
    const malformedRow = {
      ...parsed.validRows[0],
      sourceRowHash: "malformed-row",
      bizNoNormalized: "9876543210",
      bizNoDisplay: "987-65-43210",
      businessName: "Broken Import Co",
      contractName: null as unknown as string,
    } satisfies ParsedContractCsvRow;

    expect(parsed.errors).toEqual([]);

    try {
      const result = importParsedRows(db, [validRow, malformedRow], "malformed.csv");

      expect(result).toMatchObject({
        rowCount: 2,
        insertedCount: 1,
        updatedCount: 0,
        errorCount: 1,
      });

      const business = sqlite
        .prepare("select id from businesses where biz_no_normalized = ?")
        .get("9876543210");
      expect(business).toBeUndefined();

      const contract = sqlite
        .prepare("select id from contract_records where source_row_hash = ?")
        .get("malformed-row");
      expect(contract).toBeUndefined();

      const siblingBusiness = sqlite
        .prepare("select id from businesses where biz_no_normalized = ?")
        .get("1112223334");
      expect(siblingBusiness).toBeDefined();

      const siblingContract = sqlite
        .prepare("select contract_name from contract_records where source_row_hash = ?")
        .get("valid-sibling");
      expect(siblingContract).toBeDefined();

      const importRun = sqlite
        .prepare(
          "select error_count, inserted_count, status from import_runs where source_file_name = ?",
        )
        .get("malformed.csv");
      expect(importRun).toMatchObject({
        error_count: 1,
        inserted_count: 1,
        status: "completed_with_errors",
      });
    } finally {
      sqlite.close();
    }
  });
});
