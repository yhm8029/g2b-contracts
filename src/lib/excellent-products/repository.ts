import { and, eq, notInArray } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import {
  businesses,
  companyIndustries,
  excellentProducts,
  factoryLocations,
  importRuns,
} from "@/lib/db/schema";
import type { ExcellentProductCsvRow } from "./types";

export const EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME = "excellent-products-csv";

export type ExcellentProductImportResult = {
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  sourceFileName: string;
  startedAt: string;
  finishedAt: string;
};

/**
 * Replace the current excellent-product snapshot with the supplied rows.
 *
 * - Rejects an empty target snapshot before opening the replacing
 *   transaction so a stray empty import cannot wipe the existing dataset.
 * - Inside one transaction: upsert CSV fallback business profiles
 *   without overwriting non-null API-synced fields, delete any prior
 *   rows for the same source dataset that are no longer part of the
 *   new snapshot, insert or update the supplied rows, and record an
 *   `import_runs` row with the `excellent-products-csv` source name.
 * - Factory and industry rows are intentionally left untouched so that
 *   previously-enriched data survives the CSV replacement.
 */
export function replaceExcellentProductsSnapshot(
  db: Db,
  rows: ExcellentProductCsvRow[],
  sourceFileName: string,
): ExcellentProductImportResult {
  if (rows.length === 0) {
    throw new Error(
      "Excellent product snapshot is empty; refusing to replace the existing dataset.",
    );
  }

  const startedAt = new Date().toISOString();

  // Dedupe by source row hash so the same row presented twice in the
  // input is stored exactly once.
  const dedupedRows: ExcellentProductCsvRow[] = [];
  const seenHashes = new Set<string>();
  for (const row of rows) {
    if (seenHashes.has(row.sourceRowHash)) {
      continue;
    }
    seenHashes.add(row.sourceRowHash);
    dedupedRows.push(row);
  }
  const skippedCount = rows.length - dedupedRows.length;
  const sourceDataset = dedupedRows[0].sourceDataset;

  let insertedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  db.transaction((tx) => {
    for (const row of dedupedRows) {
      try {
        upsertBusinessProfileFallback(
          tx,
          {
            bizNoNormalized: row.bizNoNormalized,
            bizNoDisplay: row.bizNoNormalized,
            businessName: row.companyNameCsv,
            representativeName: row.representativeNameCsv,
            address: row.addressCsv,
            phone: row.phoneCsv,
            profileSource: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
            lastSyncedAt: row.sourceImportedAt,
          },
          row.sourceImportedAt,
        );

        const existing = tx
          .select({ id: excellentProducts.id })
          .from(excellentProducts)
          .where(
            and(
              eq(excellentProducts.sourceDataset, row.sourceDataset),
              eq(excellentProducts.sourceRowHash, row.sourceRowHash),
            ),
          )
          .get();

        if (existing === undefined) {
          tx.insert(excellentProducts)
            .values({
              bizNoNormalized: row.bizNoNormalized,
              designationNo: row.designationNo,
              companyNameCsv: row.companyNameCsv,
              representativeNameCsv: row.representativeNameCsv,
              phoneCsv: row.phoneCsv,
              addressCsv: row.addressCsv,
              productName: row.productName,
              productSpec: row.productSpec,
              productClassificationNo: row.productClassificationNo,
              productClassificationNormalized: row.productClassificationNormalized,
              productClassificationName: row.productClassificationName,
              designationStartDate: row.designationStartDate,
              designationEndDate: row.designationEndDate,
              certificationDetailsRaw: row.certificationDetailsRaw,
              sanctionType: row.sanctionType,
              sourceDataset: row.sourceDataset,
              sourceRowHash: row.sourceRowHash,
              sourceFileName: row.sourceFileName,
              sourceImportedAt: row.sourceImportedAt,
              rawJson: JSON.stringify(row.rawData ?? {}),
            })
            .run();
          insertedCount += 1;
        } else {
          tx.update(excellentProducts)
            .set({
              bizNoNormalized: row.bizNoNormalized,
              designationNo: row.designationNo,
              companyNameCsv: row.companyNameCsv,
              representativeNameCsv: row.representativeNameCsv,
              phoneCsv: row.phoneCsv,
              addressCsv: row.addressCsv,
              productName: row.productName,
              productSpec: row.productSpec,
              productClassificationNo: row.productClassificationNo,
              productClassificationNormalized: row.productClassificationNormalized,
              productClassificationName: row.productClassificationName,
              designationStartDate: row.designationStartDate,
              designationEndDate: row.designationEndDate,
              certificationDetailsRaw: row.certificationDetailsRaw,
              sanctionType: row.sanctionType,
              sourceFileName: row.sourceFileName,
              sourceImportedAt: row.sourceImportedAt,
              rawJson: JSON.stringify(row.rawData ?? {}),
              updatedAt: row.sourceImportedAt,
            })
            .where(eq(excellentProducts.id, existing.id))
            .run();
          updatedCount += 1;
        }
      } catch {
        errorCount += 1;
      }
    }

    // Remove any rows for this source dataset that are no longer part of
    // the new snapshot. Factory and industry rows are intentionally
    // untouched because they are owned by separate enrichment flows.
    if (dedupedRows.length > 0) {
      tx.delete(excellentProducts)
        .where(
          and(
            eq(excellentProducts.sourceDataset, sourceDataset),
            notInArray(
              excellentProducts.sourceRowHash,
              dedupedRows.map((row) => row.sourceRowHash),
            ),
          ),
        )
        .run();
    }

    const finishedAt = new Date().toISOString();

    tx.insert(importRuns)
      .values({
        sourceName: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
        sourceFileName,
        rowCount: rows.length,
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount,
        startedAt,
        finishedAt,
        status: errorCount > 0 ? "completed_with_errors" : "completed",
      })
      .run();
  });

  const finishedAt = new Date().toISOString();

  return {
    rowCount: rows.length,
    insertedCount,
    updatedCount,
    skippedCount,
    errorCount,
    sourceFileName,
    startedAt,
    finishedAt,
  };
}

type BusinessProfileInput = {
  bizNoNormalized: string;
  bizNoDisplay: string | null;
  businessName: string | null;
  representativeName: string | null;
  address: string | null;
  phone: string | null;
  profileSource: string | null;
  lastSyncedAt: string | null;
};

function upsertBusinessProfileFallback(
  tx: Pick<Db, "select" | "insert" | "update">,
  row: BusinessProfileInput,
  now: string,
): void {
  const incoming = {
    bizNoNormalized: row.bizNoNormalized,
    bizNoDisplay: row.bizNoDisplay ?? null,
    businessName: row.businessName ?? null,
    representativeName: row.representativeName ?? null,
    address: row.address ?? null,
    phone: row.phone ?? null,
    profileSource: row.profileSource ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
    updatedAt: now,
  };

  const existing = tx
    .select({
      businessName: businesses.businessName,
      representativeName: businesses.representativeName,
      address: businesses.address,
      phone: businesses.phone,
      profileSource: businesses.profileSource,
      lastSyncedAt: businesses.lastSyncedAt,
      bizNoDisplay: businesses.bizNoDisplay,
    })
    .from(businesses)
    .where(eq(businesses.bizNoNormalized, row.bizNoNormalized))
    .get();

  if (existing === undefined) {
    tx.insert(businesses).values(incoming).run();
    return;
  }

  tx.update(businesses)
    .set({
      bizNoDisplay: existing.bizNoDisplay ?? incoming.bizNoDisplay,
      businessName: existing.businessName ?? incoming.businessName,
      representativeName:
        existing.representativeName ?? incoming.representativeName,
      address: existing.address ?? incoming.address,
      phone: existing.phone ?? incoming.phone,
      profileSource: existing.profileSource ?? incoming.profileSource,
      lastSyncedAt: existing.lastSyncedAt ?? incoming.lastSyncedAt,
      updatedAt: now,
    })
    .where(eq(businesses.bizNoNormalized, row.bizNoNormalized))
    .run();
}

/**
 * Helper used by tests and CLI scripts to count the rows currently in
 * the building-control excellent product snapshot.
 */
export function getBuildingControlExcellentProductsSnapshotRowCount(
  sqlite: { prepare: (sql: string) => { get: () => unknown } },
): number {
  const row = sqlite
    .prepare("select count(*) as count from excellent_products")
    .get() as { count: number };
  return row.count;
}

export { businesses, companyIndustries, excellentProducts, factoryLocations };