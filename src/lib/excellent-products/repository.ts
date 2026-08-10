import { and, asc, eq, inArray, like, notInArray } from "drizzle-orm";

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
  TARGET_PRODUCT_CLASSIFICATION_PREFIX,
} from "./constants";
import { isTargetProductClassification } from "./csv";
import type {
  BuildingControlExcellentProductsResponse,
  ExcellentProductCsvRow,
  ExcellentProductViewItem,
} from "./types";

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

/**
 * Collect the deduplicated child values of one business into a map.
 *
 * Child tables are always fetched separately and grouped by business
 * number; joining two one-to-many tables into the product query would
 * multiply designation rows by the factory/industry cross product.
 */
function groupByBusiness(
  rows: { bizNoNormalized: string; value: string }[],
): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();

  for (const row of rows) {
    const value = row.value.trim();
    if (value.length === 0) {
      continue;
    }
    const values = grouped.get(row.bizNoNormalized) ?? new Set<string>();
    values.add(value);
    grouped.set(row.bizNoNormalized, values);
  }

  return grouped;
}

function sortedValues(values: Set<string> | undefined): string[] {
  if (values === undefined) {
    return [];
  }

  return [...values].sort((left, right) => left.localeCompare(right, "ko"));
}

/** Render one industry row as the license label shown in 면허 현황. */
function formatIndustryLabel(industryName: string, industryCode: string): string {
  const name = industryName.trim();
  const code = industryCode.trim();

  if (name.length === 0) {
    return code;
  }
  if (code.length === 0) {
    return name;
  }

  return `${name} (${code})`;
}

/**
 * Read the building-control excellent products currently stored in the
 * local database. No external API is called.
 *
 * Product rows are the cardinality root: every designation stays its own
 * item. The fixed `39121801` prefix is rechecked in memory against both
 * the stored raw token and the stored normalized value so a manually
 * inserted, unrelated classification cannot leak into the result.
 * Company display values resolve from the priority-managed `businesses`
 * profile first (API > CSV > contract import) and fall back to the exact
 * value captured from the excellent-products CSV; nothing is invented.
 */
export function getBuildingControlExcellentProducts(
  db: Db,
): BuildingControlExcellentProductsResponse {
  const productRows = db
    .select({
      bizNoNormalized: excellentProducts.bizNoNormalized,
      designationNo: excellentProducts.designationNo,
      companyNameCsv: excellentProducts.companyNameCsv,
      representativeNameCsv: excellentProducts.representativeNameCsv,
      phoneCsv: excellentProducts.phoneCsv,
      addressCsv: excellentProducts.addressCsv,
      productName: excellentProducts.productName,
      productSpec: excellentProducts.productSpec,
      productClassificationNo: excellentProducts.productClassificationNo,
      productClassificationNormalized: excellentProducts.productClassificationNormalized,
      productClassificationName: excellentProducts.productClassificationName,
      designationStartDate: excellentProducts.designationStartDate,
      designationEndDate: excellentProducts.designationEndDate,
      certificationDetailsRaw: excellentProducts.certificationDetailsRaw,
      profileBusinessName: businesses.businessName,
      profileRepresentativeName: businesses.representativeName,
      profilePhone: businesses.phone,
      profileAddress: businesses.address,
    })
    .from(excellentProducts)
    // `businesses` holds at most one row per business number, so this join
    // resolves the managed profile without changing product cardinality.
    .leftJoin(businesses, eq(businesses.bizNoNormalized, excellentProducts.bizNoNormalized))
    .where(
      like(
        excellentProducts.productClassificationNormalized,
        `${TARGET_PRODUCT_CLASSIFICATION_PREFIX}%`,
      ),
    )
    .orderBy(
      asc(excellentProducts.designationNo),
      asc(excellentProducts.bizNoNormalized),
      asc(excellentProducts.productClassificationNormalized),
      asc(excellentProducts.productSpec),
      asc(excellentProducts.sourceRowHash),
    )
    .all()
    .filter(
      (row) =>
        isTargetProductClassification(row.productClassificationNormalized) &&
        isTargetProductClassification(row.productClassificationNo),
    );

  const bizNumbers = [...new Set(productRows.map((row) => row.bizNoNormalized))];

  const factoryRows =
    bizNumbers.length === 0
      ? []
      : db
          .select({
            bizNoNormalized: factoryLocations.bizNoNormalized,
            value: factoryLocations.location,
          })
          .from(factoryLocations)
          .where(inArray(factoryLocations.bizNoNormalized, bizNumbers))
          .all();

  const industryRows =
    bizNumbers.length === 0
      ? []
      : db
          .select({
            bizNoNormalized: companyIndustries.bizNoNormalized,
            industryCode: companyIndustries.industryCode,
            industryName: companyIndustries.industryName,
          })
          .from(companyIndustries)
          .where(inArray(companyIndustries.bizNoNormalized, bizNumbers))
          .all();

  // Production sites come from `factory_locations` only. Head-office
  // addresses are never stored there and never surface as a factory.
  const factoriesByBusiness = groupByBusiness(factoryRows);
  const industriesByBusiness = groupByBusiness(
    industryRows.map((row) => ({
      bizNoNormalized: row.bizNoNormalized,
      value: formatIndustryLabel(row.industryName, row.industryCode),
    })),
  );

  const items: ExcellentProductViewItem[] = productRows.map((row) => ({
    designationNo: row.designationNo,
    bizNoNormalized: row.bizNoNormalized,
    companyName: row.profileBusinessName ?? row.companyNameCsv,
    representativeName: row.profileRepresentativeName ?? row.representativeNameCsv,
    phone: row.profilePhone ?? row.phoneCsv,
    address: row.profileAddress ?? row.addressCsv,
    productName: row.productName,
    productSpec: row.productSpec,
    productClassificationNo: row.productClassificationNo,
    productClassificationNormalized: row.productClassificationNormalized,
    productClassificationName: row.productClassificationName,
    designationStartDate: row.designationStartDate,
    designationEndDate: row.designationEndDate,
    certificationDetailsRaw: row.certificationDetailsRaw,
    factoryLocations: sortedValues(factoriesByBusiness.get(row.bizNoNormalized)),
    industries: sortedValues(industriesByBusiness.get(row.bizNoNormalized)),
  }));

  return {
    classification: TARGET_PRODUCT_CLASSIFICATION_PREFIX,
    companyCount: bizNumbers.length,
    designationCount: items.length,
    items,
  };
}
export { businesses, companyIndustries, excellentProducts, factoryLocations };
