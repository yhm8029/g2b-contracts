import { eq } from "drizzle-orm";

import { fetchBidNotice, type BidNoticeInfo } from "@/lib/g2b/bid-notice-client";
import { fetchContractInfo, type ContractInfo } from "@/lib/g2b/contract-info-client";
import type { Db } from "@/lib/db/client";
import { apiEnrichmentLogs, contractRecords } from "@/lib/db/schema";

export type EnrichmentResult = {
  updated: boolean;
  message: string;
};

export type EnrichmentClients = {
  fetchBidNotice: (noticeNo: string, noticeOrder?: string | null) => Promise<BidNoticeInfo>;
  fetchContractInfo: (contractNo: string) => Promise<ContractInfo>;
};

const defaultClients: EnrichmentClients = {
  fetchBidNotice,
  fetchContractInfo,
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
    return error.message;
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
  responseStatus: "success" | "error",
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
      errorMessage: message ?? null,
    })
    .run();
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
      return { updated: false, message: "Record not found." };
    }

    const updates: ContractRecordUpdates = {};

    if (record.noticeNo !== null) {
      const notice = await clients.fetchBidNotice(record.noticeNo, record.noticeOrder);
      applyValue(updates, record, "noticeNo", notice.noticeNo);
      applyValue(updates, record, "noticeOrder", notice.noticeOrder);
      applyValue(updates, record, "noticeName", notice.noticeName);
      applyValue(updates, record, "noticeDetailUrl", notice.noticeDetailUrl);
    }

    if (record.contractNo !== null) {
      const contract = await clients.fetchContractInfo(record.contractNo);
      applyValue(updates, record, "contractNo", contract.contractNo);
      applyValue(updates, record, "unifiedContractNo", contract.unifiedContractNo);
      applyValue(updates, record, "contractName", contract.contractName);
      applyValue(updates, record, "contractDetailUrl", contract.contractDetailUrl);
    }

    if (Object.keys(updates).length === 0) {
      return { updated: false, message: "No enrichment fields changed." };
    }

    const now = new Date().toISOString();

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
    return { updated: true, message: "Record enriched." };
  } catch (error) {
    const message = errorMessage(error);
    insertLog(db, record?.id ?? null, "error", requestParams, message);
    return { updated: false, message };
  }
}
