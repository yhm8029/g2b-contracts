import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31" },
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
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-14" },
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
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-03" },
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
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31" },
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
        { bizNo: BIZ_NO, dateFrom: "2026-01-01", dateTo: "2026-01-31" },
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
});
