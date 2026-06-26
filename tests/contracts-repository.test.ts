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
import { parseContractCsv } from "@/lib/import/csv";

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
    } finally {
      sqlite.close();
    }
  });
});
