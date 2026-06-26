import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { apiEnrichmentLogs, contractRecords } from "@/lib/db/schema";
import { fetchBidNotice, type BidNoticeInfo } from "@/lib/g2b/bid-notice-client";
import {
  fetchContractInfoByContractIdentifier,
  type ContractInfo,
  type ContractInfoIdentifier,
} from "@/lib/g2b/contract-info-client";
import { redactG2bSecrets } from "@/lib/g2b/http";
import {
  fetchSuccessfulBid,
  type SuccessfulBidInfo,
} from "@/lib/g2b/successful-bid-client";

export type EnrichmentResult = {
  updated: boolean;
  message: string;
};

type ApiLookup<T> = T & {
  matched?: boolean;
};

export type EnrichmentClients = {
  fetchBidNotice: (
    noticeNo: string,
    noticeOrder?: string | null,
  ) => Promise<ApiLookup<BidNoticeInfo>>;
  fetchContractInfo: (identifier: ContractInfoIdentifier) => Promise<ApiLookup<ContractInfo>>;
  fetchSuccessfulBid?: (
    noticeNo: string,
    noticeOrder?: string | null,
  ) => Promise<ApiLookup<SuccessfulBidInfo>>;
};

const defaultClients: EnrichmentClients = {
  fetchBidNotice,
  fetchContractInfo: fetchContractInfoByContractIdentifier,
  fetchSuccessfulBid,
};

type ContractRecordForEnrichment = {
  id: number;
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  noticeDetailUrl: string | null;
  contractNo: string | null;
  unifiedContractNo: string | null;
  contractName: string;
  contractDetailUrl: string | null;
};

type ContractRecordUpdates = Partial<{
  noticeNo: string;
  noticeOrder: string;
  noticeName: string;
  noticeDetailUrl: string;
  contractNo: string;
  unifiedContractNo: string;
  contractName: string;
  contractDetailUrl: string;
}>;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return redactG2bSecrets(error.message);
  }

  return "G2B enrichment failed.";
}

function applyValue<K extends keyof ContractRecordUpdates>(
  updates: ContractRecordUpdates,
  record: ContractRecordForEnrichment,
  key: K,
  value: ContractRecordUpdates[K] | null,
): void {
  if (value === null || value === undefined || value === record[key]) {
    return;
  }

  updates[key] = value;
}

function insertLog(
  db: Db,
  recordId: number | null,
  responseStatus: "success" | "error" | "no_match" | "not_found" | "no_identifiers",
  requestParams: Record<string, string | number | null>,
  message?: string,
): void {
  db.insert(apiEnrichmentLogs)
    .values({
      contractRecordId: recordId,
      provider: "data.go.kr",
      operation: "enrichContractRecord",
      requestParamsJson: JSON.stringify(requestParams),
      responseStatus,
      errorMessage: message === undefined ? null : redactG2bSecrets(message),
    })
    .run();
}

function matchedApiItem(result: { matched?: boolean }): boolean {
  return result.matched !== false;
}

export async function enrichContractRecord(
  db: Db,
  recordId: number,
  clients: EnrichmentClients = defaultClients,
): Promise<EnrichmentResult> {
  const requestParams = { recordId };
  let record: ContractRecordForEnrichment | undefined;

  try {
    record = db
      .select({
        id: contractRecords.id,
        noticeNo: contractRecords.noticeNo,
        noticeOrder: contractRecords.noticeOrder,
        noticeName: contractRecords.noticeName,
        noticeDetailUrl: contractRecords.noticeDetailUrl,
        contractNo: contractRecords.contractNo,
        unifiedContractNo: contractRecords.unifiedContractNo,
        contractName: contractRecords.contractName,
        contractDetailUrl: contractRecords.contractDetailUrl,
      })
      .from(contractRecords)
      .where(eq(contractRecords.id, recordId))
      .get();

    if (record === undefined) {
      insertLog(db, null, "not_found", requestParams, "Record not found.");
      return { updated: false, message: "Record not found." };
    }

    const updates: ContractRecordUpdates = {};
    let attemptedApiCalls = 0;
    let matchedApiCalls = 0;

    if (record.noticeNo === null && record.contractNo === null && record.unifiedContractNo === null) {
      insertLog(db, record.id, "no_identifiers", requestParams);
      return { updated: false, message: "No enrichment identifiers available." };
    }

    if (record.noticeNo !== null) {
      const notice = await clients.fetchBidNotice(record.noticeNo, record.noticeOrder);
      attemptedApiCalls += 1;

      if (matchedApiItem(notice)) {
        matchedApiCalls += 1;
        applyValue(updates, record, "noticeNo", notice.noticeNo);
        applyValue(updates, record, "noticeOrder", notice.noticeOrder);
        applyValue(updates, record, "noticeName", notice.noticeName);
        applyValue(updates, record, "noticeDetailUrl", notice.noticeDetailUrl);
      }

      if (clients.fetchSuccessfulBid !== undefined) {
        const successfulBid = await clients.fetchSuccessfulBid(record.noticeNo, record.noticeOrder);
        attemptedApiCalls += 1;

        if (matchedApiItem(successfulBid)) {
          matchedApiCalls += 1;
        }
      }
    }

    const contractIdentifier =
      record.contractNo !== null
        ? { contractNo: record.contractNo }
        : record.unifiedContractNo !== null
          ? { unifiedContractNo: record.unifiedContractNo }
          : null;
    if (contractIdentifier !== null) {
      const contract = await clients.fetchContractInfo(contractIdentifier);
      attemptedApiCalls += 1;

      if (matchedApiItem(contract)) {
        matchedApiCalls += 1;
        applyValue(updates, record, "contractNo", contract.contractNo);
        applyValue(updates, record, "unifiedContractNo", contract.unifiedContractNo);
        applyValue(updates, record, "contractName", contract.contractName);
        applyValue(updates, record, "contractDetailUrl", contract.contractDetailUrl);
      }
    }

    const now = new Date().toISOString();
    const fieldsChanged = Object.keys(updates).length > 0;

    if (attemptedApiCalls > 0 && matchedApiCalls === 0) {
      db.update(contractRecords)
        .set({
          lastEnrichedAt: now,
          updatedAt: now,
        })
        .where(eq(contractRecords.id, record.id))
        .run();

      insertLog(db, record.id, "no_match", requestParams);
      return { updated: false, message: "No G2B API match found." };
    }

    db.update(contractRecords)
      .set({
        ...updates,
        sourceStatus: "api_enriched",
        lastEnrichedAt: now,
        updatedAt: now,
      })
      .where(eq(contractRecords.id, record.id))
      .run();

    insertLog(db, record.id, "success", requestParams);
    return {
      updated: true,
      message: fieldsChanged ? "Record enriched." : "Record enrichment checked.",
    };
  } catch (error) {
    const message = errorMessage(error);
    insertLog(db, record?.id ?? null, "error", requestParams, message);
    return { updated: false, message };
  }
}
