import { and, eq, notInArray } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import {
  businesses,
  companyIndustries,
  excellentProducts,
  factoryLocations,
  importRuns,
} from "@/lib/db/schema";
import { upsertBusinessProfilePriority } from "@/lib/excellent-products/profile";
import {
  EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
  EXCELLENT_PRODUCTS_SOURCE_DATASET,
} from "./constants";
import type { ExcellentProductCsvRow } from "./types";

export {
  EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
  EXCELLENT_PRODUCTS_SOURCE_DATASET,
} from "./constants";

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
 *   rows for the entire stable source dataset that are no longer part
 *   of the new snapshot, insert or update the supplied rows, and record
 *   an `import_runs` row with the `excellent-products-csv` source name.
 * - Database write failures roll back the entire replacement; the
 *   `excellent_products`, enrichment tables, and `import_runs` are left
 *   exactly as they were before the call.
 * - Factory and industry rows are intentionally left untouched so that
 *   previously-enriched data survives the CSV replacement.
 *
 * The snapshot identity is anchored to `EXCELLENT_PRODUCTS_SOURCE_DATASET`
 * (a stable, file-independent constant) rather than the CSV filename so
 * that consecutive imports from differently-named files reconcile
 * against the same logical dataset.
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

  let insertedCount = 0;
  let updatedCount = 0;

  db.transaction((tx) => {
    for (const row of dedupedRows) {
      upsertBusinessProfilePriority(tx, {
        bizNoNormalized: row.bizNoNormalized,
        bizNoDisplay: row.bizNoNormalized,
        businessName: row.companyNameCsv,
        representativeName: row.representativeNameCsv,
        address: row.addressCsv,
        phone: row.phoneCsv,
        profileSource: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
        lastSyncedAt: row.sourceImportedAt,
      }, row.sourceImportedAt);

      const existing = tx
        .select({ id: excellentProducts.id })
        .from(excellentProducts)
        .where(
          and(
            eq(excellentProducts.sourceDataset, EXCELLENT_PRODUCTS_SOURCE_DATASET),
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
            sourceDataset: EXCELLENT_PRODUCTS_SOURCE_DATASET,
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
    }

    // Remove any rows for the stable snapshot dataset that are no longer
    // part of the new snapshot. This covers rows imported from previous
    // CSV files because all rows share the same `source_dataset`. Factory
    // and industry rows are intentionally untouched because they are
    // owned by separate enrichment flows.
    tx.delete(excellentProducts)
      .where(
        and(
          eq(excellentProducts.sourceDataset, EXCELLENT_PRODUCTS_SOURCE_DATASET),
          notInArray(
            excellentProducts.sourceRowHash,
            dedupedRows.map((row) => row.sourceRowHash),
          ),
        ),
      )
      .run();

    const finishedAt = new Date().toISOString();

    tx.insert(importRuns)
      .values({
        sourceName: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
        sourceFileName,
        rowCount: rows.length,
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount: 0,
        startedAt,
        finishedAt,
        status: "completed",
      })
      .run();
  });

  const finishedAt = new Date().toISOString();

  return {
    rowCount: rows.length,
    insertedCount,
    updatedCount,
    skippedCount,
    errorCount: 0,
    sourceFileName,
    startedAt,
    finishedAt,
  };
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
