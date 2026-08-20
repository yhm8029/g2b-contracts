import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveProfileValue } from "@/lib/businesses/profile";
import { importParsedRows } from "@/lib/contracts/repository";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { businesses } from "@/lib/db/schema";
import type { ParsedContractCsvRow } from "@/lib/import/csv";

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "g2b-business-profile-"));
  const connection = createDb(join(dir, "business-profile.sqlite"));
  initializeSqliteSchema(connection.sqlite);
  return connection;
}

describe("business profile", () => {
  describe("resolveProfileValue", () => {
    it("preserves an existing non-null value when the incoming value is null", () => {
      expect(resolveProfileValue("Existing", null, 3, 1)).toBe("Existing");
    });

    it("fills a null existing value with the incoming value", () => {
      expect(resolveProfileValue(null, "Incoming", 2, 2)).toBe("Incoming");
    });

    it("replaces existing when incoming priority is higher", () => {
      expect(resolveProfileValue("Existing", "Incoming", 1, 3)).toBe("Incoming");
    });

    it("replaces existing when incoming priority equals existing priority", () => {
      expect(resolveProfileValue("Existing", "Incoming", 2, 2)).toBe("Incoming");
    });

    it("keeps existing when incoming priority is lower", () => {
      expect(resolveProfileValue("Existing", "Incoming", 3, 1)).toBe("Existing");
    });
  });

  it("does not overwrite higher-priority profile fields when contract CSV is imported", () => {
    const { sqlite, db } = createTempDb();
    const bizNoNormalized = "1234567890";
    const bizNoDisplay = "123-45-67890";
    const seededLastSyncedAt = "2026-01-01T00:00:00.000Z";
    const updatedAt = "2026-01-02T00:00:00.000Z";

    try {
      db.insert(businesses)
        .values({
          bizNoNormalized,
          bizNoDisplay,
          businessName: "Excellent Office Co",
          representativeName: "Excellent Representative",
          address: "Excellent Address 1",
          phone: "02-0000-0000",
          profileSource: "excellent-products-csv",
          lastSyncedAt: seededLastSyncedAt,
          updatedAt,
        })
        .run();

      const contractRow: ParsedContractCsvRow = {
        sourceDataset: "csv:contract-legacy.csv",
        sourceRowHash: "legacy-row-hash",
        bizNoNormalized,
        bizNoDisplay,
        businessName: "Contract Office Co",
        representativeName: "Contract Representative",
        address: "Contract Address 1",
        businessCategory: "goods",
        noticeNo: null,
        noticeOrder: null,
        noticeName: null,
        contractNo: "CN-LEGACY-0001",
        unifiedContractNo: null,
        contractName: "Legacy contract",
        contractDate: "2026-02-01",
        currentContractAmount: 1_000,
        totalContractAmount: 1_000,
        demandAgencyCode: null,
        demandAgencyName: null,
        contractAgencyCode: null,
        contractAgencyName: null,
        contractMethod: null,
        winningMethod: null,
        businessNameAtContract: "Contract Office Co",
        contractDetailUrl: null,
        noticeDetailUrl: null,
        rawSourceUrl: null,
      };

      const result = importParsedRows(db, [contractRow], "contract-legacy.csv");

      expect(result).toMatchObject({
        rowCount: 1,
        insertedCount: 1,
        updatedCount: 0,
        errorCount: 0,
      });

      const business = sqlite
        .prepare(
          [
            "select business_name as businessName,",
            "representative_name as representativeName,",
            "address,",
            "phone,",
            "profile_source as profileSource,",
            "last_synced_at as lastSyncedAt",
            "from businesses where biz_no_normalized = ?",
          ].join(" "),
        )
        .get(bizNoNormalized) as {
        businessName: string;
        representativeName: string;
        address: string;
        phone: string;
        profileSource: string;
        lastSyncedAt: string;
      };

      expect(business).toEqual({
        businessName: "Excellent Office Co",
        representativeName: "Excellent Representative",
        address: "Excellent Address 1",
        phone: "02-0000-0000",
        profileSource: "excellent-products-csv",
        lastSyncedAt: seededLastSyncedAt,
      });

      const contract = sqlite
        .prepare("select id from contract_records where source_row_hash = ?")
        .get("legacy-row-hash") as { id: number } | undefined;
      expect(contract).toBeDefined();
    } finally {
      sqlite.close();
    }
  });
});
