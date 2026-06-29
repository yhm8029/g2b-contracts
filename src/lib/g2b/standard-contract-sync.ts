import { importParsedRows } from "@/lib/contracts/repository";
import type { Db } from "@/lib/db/client";
import { parseBusinessNumber } from "@/lib/domain/business-number";
import {
  splitDateRangeIntoDays,
  splitDateRangeIntoMonths,
  splitDateRangeIntoWeeks,
  type DateChunk,
} from "@/lib/g2b/date-chunks";
import {
  fetchStandardContractPage,
  G2bStandardContractError,
  type StandardContractPage,
} from "@/lib/g2b/standard-contract-client";
import { redactG2bSecrets } from "@/lib/g2b/http";
import { mapStandardContractRow } from "@/lib/g2b/standard-contract-mapper";
import type { ParsedContractCsvRow } from "@/lib/import/csv";

const PAGE_SIZE = 100;
const MAX_PAGES_PER_CHUNK = 1000;
const SOURCE_NAME = "g2b-public-standard-contract";

export type StandardContractSyncParams = {
  bizNo: string;
  dateFrom: string;
  dateTo: string;
  businessCategory?: string;
};

export type StandardContractSyncError = {
  code: string;
  message: string;
  dateFrom?: string;
  dateTo?: string;
  granularity?: DateChunk["granularity"];
};

export type StandardContractSyncResult = {
  status: "completed" | "completed_with_errors" | "failed";
  chunksAttempted: number;
  chunksExpanded: number;
  pagesFetched: number;
  rowsFetched: number;
  rowsMatched: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: StandardContractSyncError[];
};

export type StandardContractSyncClient = {
  fetchStandardContractPage(
    chunk: DateChunk,
    pageNo: number,
    numOfRows: number,
  ): Promise<StandardContractPage>;
};

const defaultClient: StandardContractSyncClient = {
  fetchStandardContractPage,
};

export async function syncStandardContractsForBusiness(
  db: Db,
  params: StandardContractSyncParams,
  client = defaultClient,
): Promise<StandardContractSyncResult> {
  const normalizedBizNo = parseBusinessNumber(params.bizNo);
  const chunks = splitDateRangeIntoMonths(params.dateFrom, params.dateTo);
  const validRows: ParsedContractCsvRow[] = [];
  const result: StandardContractSyncResult = {
    status: "completed",
    chunksAttempted: 0,
    chunksExpanded: 0,
    pagesFetched: 0,
    rowsFetched: 0,
    rowsMatched: 0,
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
  };

  for (const chunk of chunks) {
    await fetchChunkRows(chunk, normalizedBizNo, client, result, validRows);
  }

  if (validRows.length > 0) {
    const importResult = importParsedRows(db, validRows, SOURCE_NAME, SOURCE_NAME);
    result.insertedCount = importResult.insertedCount;
    result.updatedCount = importResult.updatedCount;
    result.skippedCount += importResult.skippedCount;
    result.errorCount += importResult.errorCount;
  }

  result.status = syncStatus(result);
  return result;
}

async function fetchChunkRows(
  chunk: DateChunk,
  normalizedBizNo: string,
  client: StandardContractSyncClient,
  result: StandardContractSyncResult,
  validRows: ParsedContractCsvRow[],
): Promise<void> {
  result.chunksAttempted += 1;

  try {
    await fetchAllPagesForChunk(chunk, normalizedBizNo, client, result, validRows);
  } catch (error) {
    if (error instanceof G2bStandardContractError && error.code === "date_range_too_large") {
      const expandedChunks = expandRangeLimitedChunk(chunk);

      if (expandedChunks.length > 0) {
        result.chunksExpanded += 1;
        for (const expandedChunk of expandedChunks) {
          await fetchChunkRows(expandedChunk, normalizedBizNo, client, result, validRows);
        }
        return;
      }
    }

    recordChunkError(result, chunk, error);
  }
}

async function fetchAllPagesForChunk(
  chunk: DateChunk,
  normalizedBizNo: string,
  client: StandardContractSyncClient,
  result: StandardContractSyncResult,
  validRows: ParsedContractCsvRow[],
): Promise<void> {
  let pageNo = 1;
  let fetchedItemCount = 0;

  while (pageNo <= MAX_PAGES_PER_CHUNK) {
    const page = await client.fetchStandardContractPage(chunk, pageNo, PAGE_SIZE);
    result.pagesFetched += 1;
    result.rowsFetched += page.items.length;
    fetchedItemCount += page.items.length;

    for (const item of page.items) {
      const mapped = mapStandardContractRow(item, normalizedBizNo);

      if (mapped.success) {
        result.rowsMatched += 1;
        validRows.push(mapped.row);
      } else {
        result.skippedCount += 1;
      }
    }

    if (page.items.length === 0 || fetchedItemCount >= page.totalCount) {
      return;
    }

    pageNo += 1;
  }

  throw new G2bStandardContractError(
    "provider_error",
    `G2B standard contract page cap exceeded for ${chunk.dateFrom} to ${chunk.dateTo}.`,
  );
}

function expandRangeLimitedChunk(chunk: DateChunk): DateChunk[] {
  if (chunk.granularity === "month") {
    return splitDateRangeIntoWeeks(chunk.dateFrom, chunk.dateTo);
  }

  if (chunk.granularity === "week") {
    return splitDateRangeIntoDays(chunk.dateFrom, chunk.dateTo);
  }

  return [];
}

function recordChunkError(
  result: StandardContractSyncResult,
  chunk: DateChunk,
  error: unknown,
): void {
  const code = error instanceof G2bStandardContractError ? error.code : "provider_error";
  const message = error instanceof Error ? error.message : String(error);

  result.errorCount += 1;
  result.errors.push({
    code,
    message: redactG2bSecrets(message),
    dateFrom: chunk.dateFrom,
    dateTo: chunk.dateTo,
    granularity: chunk.granularity,
  });
}

function syncStatus(result: StandardContractSyncResult): StandardContractSyncResult["status"] {
  if (result.errorCount === 0) {
    return "completed";
  }

  if (result.insertedCount > 0 || result.updatedCount > 0 || result.rowsMatched > 0 || result.pagesFetched > 0) {
    return "completed_with_errors";
  }

  return "failed";
}
