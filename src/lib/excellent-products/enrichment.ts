import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { companyIndustries, factoryLocations } from "@/lib/db/schema";
import {
  fetchCompanyBasicInfo,
  fetchCompanyIndustries,
  type CompanyBasicInfo,
  type CompanyIndustryInfo,
} from "@/lib/g2b/user-info-client";
import {
  fetchThirdPartyProducts,
  type ShoppingMallProductInfo,
} from "@/lib/g2b/shopping-mall-product-client";
import { redactG2bSecrets } from "@/lib/g2b/http";
import { upsertBusinessProfilePriority } from "./profile";
import { EXCELLENT_PRODUCTS_API_SOURCE_NAME } from "./constants";
import { isTargetProductClassification } from "./csv";
import { getBuildingControlExcellentProductCompanies } from "./repository";

/** Optional aliases are accepted for callers using the API's older names. */
export type ExcellentProductShoppingRow = ShoppingMallProductInfo & {
  classificationNo?: string | null;
  detailedClassificationNo?: string | null;
};

export type ExcellentProductEnrichmentClients = {
  fetchCompanyBasicInfo: (bizNo: string) => Promise<CompanyBasicInfo | null>;
  fetchCompanyIndustries: (bizNo: string) => Promise<CompanyIndustryInfo[]>;
  fetchThirdPartyProducts: (
    companyName: string,
  ) => Promise<ExcellentProductShoppingRow[]>;
};

export type ExcellentProductSyncError = {
  bizNoNormalized: string;
  message: string;
};

export type ExcellentProductSyncResult = {
  processedCompanies: number;
  updatedCompanies: number;
  errors: ExcellentProductSyncError[];
};

const DEFAULT_CLIENTS: ExcellentProductEnrichmentClients = {
  fetchCompanyBasicInfo,
  fetchCompanyIndustries,
  fetchThirdPartyProducts,
};

const INDUSTRY_SOURCE = EXCELLENT_PRODUCTS_API_SOURCE_NAME;
const SHOPPING_SOURCE = "shopping-mall";

/**
 * Enrich every distinct business represented by the fixed snapshot.
 *
 * Businesses are processed serially. The three provider calls for one
 * business are started together, but no business can mutate the database
 * until all three have succeeded. This gives each company an all-or-nothing
 * enrichment boundary while allowing a later company to continue after an
 * earlier provider failure.
 */
export async function syncBuildingControlCompanies(
  db: Db,
  clients: ExcellentProductEnrichmentClients = DEFAULT_CLIENTS,
): Promise<ExcellentProductSyncResult> {
  const companies = getBuildingControlExcellentProductCompanies(db);
  const result: ExcellentProductSyncResult = {
    processedCompanies: companies.length,
    updatedCompanies: 0,
    errors: [],
  };

  for (const company of companies) {
    const shoppingCompanyName =
      company.companyNameProfile?.trim() || company.companyNameCsv.trim();

    try {
      // Deferring each invocation into a promise also turns a synchronous
      // mock/client throw into a rejection, ensuring all three attempts are
      // made exactly once. allSettled waits for every attempt before moving
      // to the next business, preserving sequential business processing.
      const settled = await Promise.allSettled([
        Promise.resolve().then(() => clients.fetchCompanyBasicInfo(company.bizNoNormalized)),
        Promise.resolve().then(() => clients.fetchCompanyIndustries(company.bizNoNormalized)),
        Promise.resolve().then(() => clients.fetchThirdPartyProducts(shoppingCompanyName)),
      ]);
      const rejected = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected",
      );
      if (rejected !== undefined) {
        throw rejected.reason;
      }
      const [basicInfo, industries, products] = settled.map(
        (entry) => (entry as PromiseFulfilledResult<unknown>).value,
      ) as [CompanyBasicInfo | null, CompanyIndustryInfo[], ExcellentProductShoppingRow[]];

      db.transaction((tx) => {
        if (basicInfo !== null && basicInfo !== undefined) {
          upsertBusinessProfilePriority(
            tx,
            {
              bizNoNormalized: company.bizNoNormalized,
              bizNoDisplay: company.bizNoNormalized,
              businessName: cleanNullable(basicInfo.corpNm),
              representativeName: cleanNullable(basicInfo.ceoNm),
              phone: cleanNullable(basicInfo.telNo),
              address: cleanNullable(basicInfo.address),
              profileSource: EXCELLENT_PRODUCTS_API_SOURCE_NAME,
              lastSyncedAt: new Date().toISOString(),
            },
            new Date().toISOString(),
          );
        }

        // This flow owns the current child rows for a successful company.
        // Delete first so stale values disappear when the provider returns a
        // changed or empty list on a later successful sync.
        tx.delete(companyIndustries)
          .where(eq(companyIndustries.bizNoNormalized, company.bizNoNormalized))
          .run();
        tx.delete(factoryLocations)
          .where(eq(factoryLocations.bizNoNormalized, company.bizNoNormalized))
          .run();

        const industryRows = dedupeIndustries(industries);
        if (industryRows.length > 0) {
          tx.insert(companyIndustries)
            .values(
              industryRows.map((industry) => ({
                bizNoNormalized: company.bizNoNormalized,
                industryCode: cleanNullable(industry.indstrytyCd) ?? "",
                industryName: industry.indstrytyNm,
                status: cleanNullable(industry.status),
                source: INDUSTRY_SOURCE,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              })),
            )
            .run();
        }

        const factoryRows = dedupeFactories(products);
        if (factoryRows.length > 0) {
          tx.insert(factoryLocations)
            .values(
              factoryRows.map((location) => ({
                bizNoNormalized: company.bizNoNormalized,
                location,
                source: SHOPPING_SOURCE,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              })),
            )
            .run();
        }
      });
      result.updatedCompanies += 1;
    } catch (error) {
      result.errors.push({
        bizNoNormalized: company.bizNoNormalized,
        message: redactG2bSecrets(errorMessage(error)),
      });
    }
  }

  return result;
}

function cleanNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

type NormalizedIndustry = {
  indstrytyCd: string | null;
  indstrytyNm: string;
  status: string | null;
};

function dedupeIndustries(rows: CompanyIndustryInfo[]): NormalizedIndustry[] {
  const seen = new Set<string>();
  const result: NormalizedIndustry[] = [];
  for (const row of rows) {
    const name = row.indstrytyNm?.trim() ?? "";
    if (name.length === 0) {
      continue;
    }
    const code = cleanNullable(row.indstrytyCd) ?? "";
    // The database's natural key is business + code + name + source;
    // statuses are mutable metadata and must not create duplicate rows.
    const key = `${code}\u0000${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      indstrytyCd: code,
      indstrytyNm: name,
      status: cleanNullable(row.status),
    });
  }
  return result;
}

function dedupeFactories(rows: ExcellentProductShoppingRow[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const classification =
      row.detailedClassificationNo ??
      row.classificationNo ??
      row.dtilPrdctClsfcNo ??
      row.prdctClsfcNo;
    if (!isTargetProductClassification(classification)) {
      continue;
    }
    const location = row.factoryLocation?.trim() ?? "";
    if (location.length === 0 || seen.has(location)) {
      continue;
    }
    seen.add(location);
    result.push(location);
  }
  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
