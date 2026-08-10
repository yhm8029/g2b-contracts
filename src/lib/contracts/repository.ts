import { and, desc, eq, gte, lte, max, sql } from "drizzle-orm";

import type {
  ContractSearchParams,
  ContractSearchRow,
  DatabaseHealth,
  ImportResult,
} from "@/lib/contracts/types";
import type { Db } from "@/lib/db/client";
import { apiEnrichmentLogs, businesses, contractRecords, importRuns } from "@/lib/db/schema";
import { parseBusinessNumber } from "@/lib/domain/business-number";
import {
  EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME,
  upsertBusinessProfilePriority,
} from "@/lib/excellent-products/profile";
import type { ParsedContractCsvRow } from "@/lib/import/csv";

type ImportRunStatus = "completed" | "completed_with_errors" | "failed";

export type ImportRunInput = ImportResult & {
  sourceName: string;
  sourceFileName: string | null;
  status: ImportRunStatus;
  startedAt?: string;
  finishedAt?: string;
  notes?: string | null;
};

export function importParsedRows(
  db: Db,
  rows: ParsedContractCsvRow[],
  sourceFileName: string,
  sourceName = EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME,
): ImportResult {
  const startedAt = new Date().toISOString();
  const result = upsertParsedRows(db, rows);

  recordImportRun(db, {
    sourceName,
    sourceFileName,
    rowCount: result.rowCount,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    skippedCount: result.skippedCount,
    errorCount: result.errorCount,
    startedAt,
    status: result.errorCount > 0 ? "completed_with_errors" : "completed",
  });

  return result;
}

export function upsertParsedRows(db: Db, rows: ParsedContractCsvRow[]): ImportResult {
  const result: ImportResult = {
    rowCount: rows.length,
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };

  db.transaction((tx) => {
    for (const row of rows) {
      try {
        const now = new Date().toISOString();
        let existing: { id: number } | undefined;

        tx.transaction((rowTx) => {
          upsertBusinessProfilePriority(rowTx, {
            bizNoNormalized: row.bizNoNormalized,
            bizNoDisplay: row.bizNoDisplay ?? null,
            businessName: row.businessName ?? null,
            representativeName: row.representativeName ?? null,
            address: row.address ?? null,
            phone: null,
            profileSource: EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME,
            lastSyncedAt: null,
          }, now);

          const business = rowTx
            .select({ id: businesses.id })
            .from(businesses)
            .where(eq(businesses.bizNoNormalized, row.bizNoNormalized))
            .get();

          existing = rowTx
            .select({ id: contractRecords.id })
            .from(contractRecords)
            .where(
              and(
                eq(contractRecords.sourceDataset, row.sourceDataset),
                eq(contractRecords.sourceRowHash, row.sourceRowHash),
              ),
            )
            .get();

          rowTx
            .insert(contractRecords)
            .values({
              businessId: business?.id ?? null,
              sourceDataset: row.sourceDataset,
              sourceRowHash: row.sourceRowHash,
              businessCategory: row.businessCategory ?? "unknown",
              noticeNo: row.noticeNo,
              noticeOrder: row.noticeOrder,
              noticeName: row.noticeName,
              contractNo: row.contractNo,
              unifiedContractNo: row.unifiedContractNo,
              contractName: row.contractName,
              contractDate: row.contractDate,
              currentContractAmount: row.currentContractAmount,
              totalContractAmount: row.totalContractAmount,
              demandAgencyCode: row.demandAgencyCode,
              demandAgencyName: row.demandAgencyName,
              contractAgencyCode: row.contractAgencyCode,
              contractAgencyName: row.contractAgencyName,
              contractMethod: row.contractMethod,
              winningMethod: row.winningMethod,
              businessNameAtContract: row.businessNameAtContract,
              bizNoNormalized: row.bizNoNormalized,
              contractDetailUrl: row.contractDetailUrl,
              noticeDetailUrl: row.noticeDetailUrl,
              rawSourceUrl: row.rawSourceUrl,
              sourceStatus: "local_only",
              lastImportedAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [contractRecords.sourceDataset, contractRecords.sourceRowHash],
              set: {
                businessId: business?.id ?? null,
                businessCategory: row.businessCategory ?? "unknown",
                noticeNo: row.noticeNo,
                noticeOrder: row.noticeOrder,
                noticeName: row.noticeName,
                contractNo: row.contractNo,
                unifiedContractNo: row.unifiedContractNo,
                contractName: row.contractName,
                contractDate: row.contractDate,
                currentContractAmount: row.currentContractAmount,
                totalContractAmount: row.totalContractAmount,
                demandAgencyCode: row.demandAgencyCode,
                demandAgencyName: row.demandAgencyName,
                contractAgencyCode: row.contractAgencyCode,
                contractAgencyName: row.contractAgencyName,
                contractMethod: row.contractMethod,
                winningMethod: row.winningMethod,
                businessNameAtContract: row.businessNameAtContract,
                bizNoNormalized: row.bizNoNormalized,
                contractDetailUrl: row.contractDetailUrl,
                noticeDetailUrl: row.noticeDetailUrl,
                rawSourceUrl: row.rawSourceUrl,
                lastImportedAt: now,
                updatedAt: now,
              },
            })
            .run();
        });

        if (existing === undefined) {
          result.insertedCount += 1;
        } else {
          result.updatedCount += 1;
        }
      } catch {
        result.errorCount += 1;
      }
    }
  });

  return result;
}

export function recordImportRun(db: Db, input: ImportRunInput): void {
  db.insert(importRuns)
    .values({
      sourceName: input.sourceName,
      sourceFileName: input.sourceFileName,
      rowCount: input.rowCount,
      insertedCount: input.insertedCount,
      updatedCount: input.updatedCount,
      skippedCount: input.skippedCount,
      errorCount: input.errorCount,
      startedAt: input.startedAt ?? new Date().toISOString(),
      finishedAt: input.finishedAt ?? new Date().toISOString(),
      status: input.status,
      notes: input.notes,
    })
    .run();
}

export function searchContractsByBusinessNumber(
  db: Db,
  params: ContractSearchParams,
): ContractSearchRow[] {
  const bizNoNormalized = parseBusinessNumber(params.bizNo);
  const filters = [eq(contractRecords.bizNoNormalized, bizNoNormalized)];

  if (params.dateFrom !== undefined) {
    filters.push(gte(contractRecords.contractDate, params.dateFrom));
  }

  if (params.dateTo !== undefined) {
    filters.push(lte(contractRecords.contractDate, params.dateTo));
  }

  if (params.businessCategory !== undefined && params.businessCategory !== "all") {
    filters.push(eq(contractRecords.businessCategory, params.businessCategory));
  }

  return db
    .select({
      id: contractRecords.id,
      businessId: contractRecords.businessId,
      bizNoNormalized: contractRecords.bizNoNormalized,
      bizNoDisplay: businesses.bizNoDisplay,
      businessName: sql<string | null>`coalesce(${businesses.businessName}, ${contractRecords.businessNameAtContract})`,
      businessCategory: contractRecords.businessCategory,
      noticeNo: contractRecords.noticeNo,
      noticeOrder: contractRecords.noticeOrder,
      noticeName: contractRecords.noticeName,
      contractNo: contractRecords.contractNo,
      unifiedContractNo: contractRecords.unifiedContractNo,
      contractName: contractRecords.contractName,
      contractDate: contractRecords.contractDate,
      currentContractAmount: contractRecords.currentContractAmount,
      totalContractAmount: contractRecords.totalContractAmount,
      demandAgencyCode: contractRecords.demandAgencyCode,
      demandAgencyName: contractRecords.demandAgencyName,
      contractAgencyCode: contractRecords.contractAgencyCode,
      contractAgencyName: contractRecords.contractAgencyName,
      contractMethod: contractRecords.contractMethod,
      winningMethod: contractRecords.winningMethod,
      businessNameAtContract: contractRecords.businessNameAtContract,
      contractDetailUrl: contractRecords.contractDetailUrl,
      noticeDetailUrl: contractRecords.noticeDetailUrl,
      rawSourceUrl: contractRecords.rawSourceUrl,
      sourceDataset: contractRecords.sourceDataset,
      sourceRowHash: contractRecords.sourceRowHash,
      sourceStatus: contractRecords.sourceStatus,
      lastImportedAt: contractRecords.lastImportedAt,
      lastEnrichedAt: contractRecords.lastEnrichedAt,
      latestEnrichmentStatus: sql<string | null>`(
        select ${apiEnrichmentLogs.responseStatus}
        from ${apiEnrichmentLogs}
        where ${apiEnrichmentLogs.contractRecordId} = ${contractRecords.id}
        order by ${apiEnrichmentLogs.createdAt} desc, ${apiEnrichmentLogs.id} desc
        limit 1
      )`,
      latestEnrichmentError: sql<string | null>`(
        select ${apiEnrichmentLogs.errorMessage}
        from ${apiEnrichmentLogs}
        where ${apiEnrichmentLogs.contractRecordId} = ${contractRecords.id}
        order by ${apiEnrichmentLogs.createdAt} desc, ${apiEnrichmentLogs.id} desc
        limit 1
      )`,
    })
    .from(contractRecords)
    .leftJoin(businesses, eq(contractRecords.businessId, businesses.id))
    .where(and(...filters))
    .orderBy(desc(contractRecords.contractDate), desc(contractRecords.id))
    .all();
}

export function getDatabaseHealth(db: Db): DatabaseHealth {
  const contractCount = db
    .select({ count: sql<number>`count(*)` })
    .from(contractRecords)
    .get();
  const latestImport = db.select({ timestamp: max(importRuns.finishedAt) }).from(importRuns).get();

  return {
    contractCount: contractCount?.count ?? 0,
    latestImportAt: latestImport?.timestamp ?? null,
  };
}
