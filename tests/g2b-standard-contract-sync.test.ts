import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { getDatabaseHealth } from "@/lib/contracts/repository";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { G2bStandardContractError } from "@/lib/g2b/standard-contract-client";
import {
  syncStandardContractsForBusiness,
  type StandardContractSyncClient,
} from "@/lib/g2b/standard-contract-sync";
import type { StandardContractRow } from "@/lib/g2b/standard-contract-mapper";

const BIZ_NO = "1234567890";

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "g2b-sync-"));
  const connection = createDb(join(dir, "contracts.sqlite"));
  initializeSqliteSchema(connection.sqlite);
  return connection;
}

function providerRow(overrides: StandardContractRow = {}): StandardContractRow {
  return {
    bidwinnrBizrno: "123-45-67890",
    cntrctCorpNm: "Sample Sync Co",
    cntrctCnclsDate: "2026-01-15",
    cntrctNm: "Synced contract",
    cntrctNo: "SYNC-1",
    bsnsDivNm: "goods",
    ...overrides,
  };
}

function mockClient(
  implementation: StandardContractSyncClient["fetchStandardContractPage"],
): StandardContractSyncClient {
  return {
    fetchStandardContractPage: vi.fn(implementation),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function resolvesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
}

describe("syncStandardContractsForBusiness", () => {
  it("imports matching rows for month chunks and records the G2B import source name", async () => {
    const { sqlite, db } = createTempDb();
    const client = mockClient(async () => ({
      items: [providerRow(), providerRow({ bidwinnrBizrno: "999-99-99999", cntrctNo: "OTHER-1" })],
      totalCount: 2,
      pageNo: 1,
      numOfRows: 100,
    }));

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31", businessCategory: "goods" },
        client,
      );

      expect(result).toMatchObject({
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

      const latestImportRun = sqlite
        .prepare("select source_name as sourceName, source_file_name as sourceFileName from import_runs order by id desc limit 1")
        .get() as { sourceName: string; sourceFileName: string };
      expect(latestImportRun).toEqual({
        sourceName: "g2b-public-standard-contract",
        sourceFileName: "g2b-public-standard-contract",
      });
    } finally {
      sqlite.close();
    }
  });

  it("records a completed import run when provider rows do not match the business", async () => {
    const { sqlite, db } = createTempDb();
    const client = mockClient(async () => ({
      items: [providerRow({ bidwinnrBizrno: "999-99-99999", cntrctNo: "NO-MATCH-1" })],
      totalCount: 1,
      pageNo: 1,
      numOfRows: 100,
    }));

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31", businessCategory: "goods" },
        client,
      );

      expect(result).toMatchObject({
        status: "completed",
        rowsFetched: 1,
        rowsMatched: 0,
        insertedCount: 0,
        skippedCount: 1,
        errorCount: 0,
      });

      const latestImportRun = sqlite
        .prepare(
          [
            "select source_name as sourceName, source_file_name as sourceFileName,",
            "row_count as rowCount, inserted_count as insertedCount, skipped_count as skippedCount,",
            "error_count as errorCount, status",
            "from import_runs order by id desc limit 1",
          ].join(" "),
        )
        .get() as {
        sourceName: string;
        sourceFileName: string;
        rowCount: number;
        insertedCount: number;
        skippedCount: number;
        errorCount: number;
        status: string;
      };

      expect(latestImportRun).toEqual({
        sourceName: "g2b-public-standard-contract",
        sourceFileName: "g2b-public-standard-contract",
        rowCount: 1,
        insertedCount: 0,
        skippedCount: 1,
        errorCount: 0,
        status: "completed",
      });
      expect(getDatabaseHealth(db).latestImportAt).toEqual(expect.any(String));
    } finally {
      sqlite.close();
    }
  });

  it("queries every approved contract info business division when category is all", async () => {
    const { sqlite, db } = createTempDb();
    const client = mockClient(async (chunk, pageNo, numOfRows, category) => ({
      items: [providerRow({ bsnsDivNm: category === "services" ? "용역" : "물품", cntrctNo: `SYNC-${category}` })],
      totalCount: 1,
      pageNo,
      numOfRows,
    }));

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31", businessCategory: "all" },
        client,
      );

      expect(result.status).toBe("completed");
      expect(result.chunksAttempted).toBe(1);
      expect(result.pagesFetched).toBe(1);
      expect(result.rowsMatched).toBe(1);
      expect(client.fetchStandardContractPage).toHaveBeenCalledWith(
        { dateFrom: "2026-01-01", dateTo: "2026-01-31", granularity: "month" },
        1,
        100,
      );
    } finally {
      sqlite.close();
    }
  });

  it("falls back to approved contract information divisions when public standard service is unauthorized", async () => {
    const { sqlite, db } = createTempDb();
    const fetchStandardContractPage = vi.fn(async () => {
      throw new G2bStandardContractError("unauthorized_service_key", "standard service rejected");
    });
    const fetchContractInfoPage = vi.fn(async (_chunk, pageNo, numOfRows, category) => ({
      items: category === "goods" ? [providerRow({ cntrctNo: "FALLBACK-GOODS" })] : [],
      totalCount: category === "goods" ? 1 : 0,
      pageNo,
      numOfRows,
    }));
    const client: StandardContractSyncClient = {
      fetchStandardContractPage,
      fetchContractInfoPage,
    };

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31", businessCategory: "all" },
        client,
      );

      expect(result).toMatchObject({
        status: "completed",
        chunksAttempted: 4,
        pagesFetched: 4,
        rowsFetched: 1,
        rowsMatched: 1,
        insertedCount: 1,
        errorCount: 0,
      });
      expect(fetchStandardContractPage).toHaveBeenCalledOnce();
      expect(fetchContractInfoPage).toHaveBeenCalledTimes(4);
      expect(fetchContractInfoPage).toHaveBeenCalledWith(
        { dateFrom: "2026-01-01", dateTo: "2026-01-31", granularity: "month" },
        1,
        100,
        "goods",
      );

      const latestImportRun = sqlite
        .prepare("select source_name as sourceName, source_file_name as sourceFileName from import_runs order by id desc limit 1")
        .get() as { sourceName: string; sourceFileName: string };
      expect(latestImportRun).toEqual({
        sourceName: "g2b-contract-info-service",
        sourceFileName: "g2b-contract-info-service",
      });
    } finally {
      sqlite.close();
    }
  });

  it("falls back from a month range-limit error to week chunks", async () => {
    const { sqlite, db } = createTempDb();
    const client = mockClient(async (chunk) => {
      if (chunk.granularity === "month") {
        throw new G2bStandardContractError("date_range_too_large", "month too large");
      }

      return {
        items: [providerRow({ cntrctCnclsDate: chunk.dateFrom.replace(/-/g, "") })],
        totalCount: 1,
        pageNo: 1,
        numOfRows: 100,
      };
    });

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-14", businessCategory: "goods" },
        client,
      );

      expect(result.status).toBe("completed");
      expect(result.chunksAttempted).toBe(3);
      expect(result.chunksExpanded).toBe(1);
      expect(result.pagesFetched).toBe(2);
      expect(result.insertedCount).toBe(2);
      expect(client.fetchStandardContractPage).toHaveBeenCalledWith(
        { dateFrom: "2026-01-01", dateTo: "2026-01-14", granularity: "month" },
        1,
        100,
      );
      expect(client.fetchStandardContractPage).toHaveBeenCalledWith(
        { dateFrom: "2026-01-01", dateTo: "2026-01-07", granularity: "week" },
        1,
        100,
      );
    } finally {
      sqlite.close();
    }
  });

  it("falls back from a week range-limit error to day chunks", async () => {
    const { sqlite, db } = createTempDb();
    const client = mockClient(async (chunk) => {
      if (chunk.granularity === "month" || chunk.granularity === "week") {
        throw new G2bStandardContractError("date_range_too_large", `${chunk.granularity} too large`);
      }

      return {
        items: [providerRow({ cntrctCnclsDate: chunk.dateFrom })],
        totalCount: 1,
        pageNo: 1,
        numOfRows: 100,
      };
    });

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-03", businessCategory: "goods" },
        client,
      );

      expect(result.status).toBe("completed");
      expect(result.chunksExpanded).toBe(2);
      expect(result.pagesFetched).toBe(3);
      expect(result.insertedCount).toBe(3);
      expect(client.fetchStandardContractPage).toHaveBeenCalledWith(
        { dateFrom: "2026-01-01", dateTo: "2026-01-01", granularity: "day" },
        1,
        100,
      );
    } finally {
      sqlite.close();
    }
  });

  it("reports provider errors without shrinking the failed chunk", async () => {
    const { sqlite, db } = createTempDb();
    const client = mockClient(async () => {
      throw new G2bStandardContractError("provider_error", "provider unavailable");
    });

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31", businessCategory: "goods" },
        client,
      );

      expect(result).toMatchObject({
        status: "failed",
        chunksAttempted: 1,
        chunksExpanded: 0,
        pagesFetched: 0,
        rowsFetched: 0,
        insertedCount: 0,
        errorCount: 1,
      });
      expect(result.errors[0]).toMatchObject({
        code: "provider_error",
        message: "provider unavailable",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        granularity: "month",
      });
      expect(client.fetchStandardContractPage).toHaveBeenCalledTimes(1);
    } finally {
      sqlite.close();
    }
  });

  it("records completed_with_errors import history when some chunks succeed and another chunk fails", async () => {
    const { sqlite, db } = createTempDb();
    const client = mockClient(async (chunk) => {
      if (chunk.dateFrom === "2026-02-01") {
        throw new G2bStandardContractError("provider_error", "provider unavailable");
      }

      return {
        items: [providerRow({ cntrctNo: "MIXED-1", cntrctCnclsDate: chunk.dateFrom })],
        totalCount: 1,
        pageNo: 1,
        numOfRows: 100,
      };
    });

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-02-28", businessCategory: "goods" },
        client,
      );

      expect(result).toMatchObject({
        status: "completed_with_errors",
        pagesFetched: 1,
        rowsFetched: 1,
        insertedCount: 1,
        skippedCount: 0,
        errorCount: 1,
      });

      const importRuns = sqlite
        .prepare(
          [
            "select row_count as rowCount, inserted_count as insertedCount, skipped_count as skippedCount,",
            "error_count as errorCount, status",
            "from import_runs order by id",
          ].join(" "),
        )
        .all() as Array<{
        rowCount: number;
        insertedCount: number;
        skippedCount: number;
        errorCount: number;
        status: string;
      }>;

      expect(importRuns).toEqual([
        {
          rowCount: 1,
          insertedCount: 1,
          skippedCount: 0,
          errorCount: 1,
          status: "completed_with_errors",
        },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("fetches independent month chunks concurrently", async () => {
    const { sqlite, db } = createTempDb();
    const releaseJanuary = deferred();
    const februaryStarted = deferred();
    const client = mockClient(async (chunk) => {
      if (chunk.dateFrom === "2026-01-01") {
        await releaseJanuary.promise;
      }

      if (chunk.dateFrom === "2026-02-01") {
        februaryStarted.resolve();
      }

      return {
        items: [providerRow({ cntrctNo: `SYNC-${chunk.dateFrom}`, cntrctCnclsDate: chunk.dateFrom })],
        totalCount: 1,
        pageNo: 1,
        numOfRows: 100,
      };
    });

    try {
      const syncPromise = syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-02-28", businessCategory: "goods" },
        client,
      );

      await expect(resolvesWithin(februaryStarted.promise, 50)).resolves.toBe(true);
      releaseJanuary.resolve();

      const result = await syncPromise;
      expect(result.status).toBe("completed");
      expect(result.insertedCount).toBe(2);
    } finally {
      releaseJanuary.resolve();
      sqlite.close();
    }
  });

  it("fetches multiple pages and stops when fetched items reach totalCount", async () => {
    const { sqlite, db } = createTempDb();
    const client = mockClient(async (_chunk, pageNo) => ({
      items:
        pageNo === 1
          ? [providerRow({ cntrctNo: "PAGE-1", cntrctCnclsDate: "2026-01-01" })]
          : [providerRow({ cntrctNo: "PAGE-2", cntrctCnclsDate: "2026-01-02" })],
      totalCount: 2,
      pageNo,
      numOfRows: 100,
    }));

    try {
      const result = await syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31", businessCategory: "goods" },
        client,
      );

      expect(result.status).toBe("completed");
      expect(result.pagesFetched).toBe(2);
      expect(result.rowsFetched).toBe(2);
      expect(result.insertedCount).toBe(2);
      expect(client.fetchStandardContractPage).toHaveBeenCalledTimes(2);
      expect(client.fetchStandardContractPage).toHaveBeenLastCalledWith(
        { dateFrom: "2026-01-01", dateTo: "2026-01-31", granularity: "month" },
        2,
        100,
      );
    } finally {
      sqlite.close();
    }
  });

  it("fetches remaining pages in a chunk concurrently after the first page", async () => {
    const { sqlite, db } = createTempDb();
    const releasePageTwo = deferred();
    const pageThreeStarted = deferred();
    const client = mockClient(async (_chunk, pageNo) => {
      if (pageNo === 2) {
        await releasePageTwo.promise;
      }

      if (pageNo === 3) {
        pageThreeStarted.resolve();
      }

      return {
        items: [providerRow({ cntrctNo: `PAGE-${pageNo}`, cntrctCnclsDate: `2026-01-0${pageNo}` })],
        totalCount: 3,
        pageNo,
        numOfRows: 1,
      };
    });

    try {
      const syncPromise = syncStandardContractsForBusiness(
        db,
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31", businessCategory: "goods" },
        client,
      );

      await expect(resolvesWithin(pageThreeStarted.promise, 50)).resolves.toBe(true);
      releasePageTwo.resolve();

      const result = await syncPromise;
      expect(result.status).toBe("completed");
      expect(result.insertedCount).toBe(3);
    } finally {
      releasePageTwo.resolve();
      sqlite.close();
    }
  });
});
