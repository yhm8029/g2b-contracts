import { recordImportRun, upsertParsedRows } from "@/lib/contracts/repository";
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
  type G2bContractBusinessCategory,
  type StandardContractPage,
} from "@/lib/g2b/standard-contract-client";
import { fetchContractInfoPage } from "@/lib/g2b/contract-info-list-client";
import { redactG2bSecrets } from "@/lib/g2b/http";
import {
  appendShoppingMallDeliveryRequestInfoCacheRows,
  beginShoppingMallDeliveryRequestInfoCacheRefresh,
  markShoppingMallDeliveryRequestInfoCacheComplete,
  readCachedShoppingMallDeliveryRequestInfoMatches,
} from "@/lib/g2b/shopping-mall-delivery-cache";
import {
  fetchShoppingMallDeliveryRequestDetailPage,
  fetchShoppingMallDeliveryRequestInfoPage,
} from "@/lib/g2b/shopping-mall-client";
import {
  SHOPPING_THIRD_PARTY_CATEGORY,
  SHOPPING_THIRD_PARTY_SOURCE_DATASET,
  mapShoppingMallThirdPartyDeliveryRow,
} from "@/lib/g2b/shopping-mall-mapper";
import {
  CONTRACT_INFO_SOURCE_DATASET,
  PUBLIC_STANDARD_SOURCE_DATASET,
  mapStandardContractRow,
} from "@/lib/g2b/standard-contract-mapper";
import type { ParsedContractCsvRow } from "@/lib/import/csv";

const PAGE_SIZE = 100;
const SHOPPING_PAGE_SIZE = 999;
const MAX_PAGES_PER_CHUNK = 1000;
const SYNC_CONCURRENCY = 4;
const SHOPPING_SYNC_CONCURRENCY = 8;
const ALL_CONTRACT_CATEGORIES: G2bContractBusinessCategory[] = ["goods", "services", "construction", "foreign"];

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
  fetchContractInfoPage?(
    chunk: DateChunk,
    pageNo: number,
    numOfRows: number,
    businessCategory: G2bContractBusinessCategory,
  ): Promise<StandardContractPage>;
  fetchShoppingMallDeliveryRequestInfoPage?(
    chunk: DateChunk,
    pageNo: number,
    numOfRows: number,
  ): Promise<StandardContractPage>;
  fetchShoppingMallDeliveryRequestDetailPage?(
    chunk: DateChunk,
    deliveryRequestNo: string,
    pageNo: number,
    numOfRows: number,
  ): Promise<StandardContractPage>;
};

const defaultClient: StandardContractSyncClient = {
  fetchStandardContractPage,
  fetchContractInfoPage,
  fetchShoppingMallDeliveryRequestInfoPage,
  fetchShoppingMallDeliveryRequestDetailPage,
};

export async function syncStandardContractsForBusiness(
  db: Db,
  params: StandardContractSyncParams,
  client = defaultClient,
): Promise<StandardContractSyncResult> {
  const startedAt = new Date().toISOString();
  const normalizedBizNo = parseBusinessNumber(params.bizNo);
  const chunks = splitDateRangeIntoMonths(params.dateFrom, params.dateTo);
  const selectedCategory = selectedCategoryForFilter(params.businessCategory);
  const results: StandardContractSyncResult[] = [];

  if (shouldSyncStandardContracts(params.businessCategory)) {
    const primaryResult = await collectRowsForSource(
      db,
      {
        chunks,
        normalizedBizNo,
        selectedCategory,
        sourceDataset: PUBLIC_STANDARD_SOURCE_DATASET,
        fetchPage: (chunk, pageNo, numOfRows) => client.fetchStandardContractPage(chunk, pageNo, numOfRows),
      },
    );

    if (shouldFallbackToContractInfo(primaryResult) && client.fetchContractInfoPage !== undefined) {
      const fallbackResult = await collectRowsForContractInfoFallback(
        chunks,
        normalizedBizNo,
        params.businessCategory,
        client.fetchContractInfoPage,
        db,
      );

      persistSyncResult(db, startedAt, CONTRACT_INFO_SOURCE_DATASET, fallbackResult);
      results.push(fallbackResult);
    } else {
      persistSyncResult(db, startedAt, PUBLIC_STANDARD_SOURCE_DATASET, primaryResult);
      results.push(primaryResult);
    }
  }

  if (
    shouldSyncShoppingThirdParty(params.businessCategory) &&
    client.fetchShoppingMallDeliveryRequestInfoPage !== undefined &&
    client.fetchShoppingMallDeliveryRequestDetailPage !== undefined
  ) {
    const shoppingResult = await collectShoppingMallThirdPartyRows(
      db,
      chunks,
      normalizedBizNo,
      client.fetchShoppingMallDeliveryRequestInfoPage,
      client.fetchShoppingMallDeliveryRequestDetailPage,
    );

    persistSyncResult(db, startedAt, SHOPPING_THIRD_PARTY_SOURCE_DATASET, shoppingResult);
    results.push(shoppingResult);
  }

  return combineSyncResults(results);
}

function persistSyncResult(
  db: Db,
  startedAt: string,
  sourceName: string,
  result: StandardContractSyncResult,
): void {
  result.status = syncStatus(result);
  recordImportRun(db, {
    sourceName,
    sourceFileName: sourceName,
    rowCount: result.rowsFetched,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    skippedCount: result.skippedCount,
    errorCount: result.errorCount,
    startedAt,
    status: result.status,
  });

}

type SourceCollectionParams = {
  chunks: DateChunk[];
  normalizedBizNo: string;
  selectedCategory: G2bContractBusinessCategory | null;
  sourceDataset: string;
  fetchPage: (chunk: DateChunk, pageNo: number, numOfRows: number) => Promise<StandardContractPage>;
};

async function collectRowsForSource(db: Db, params: SourceCollectionParams): Promise<StandardContractSyncResult> {
  const validRows: ParsedContractCsvRow[] = [];
  const result = createEmptyResult();

  await mapWithConcurrency(params.chunks, SYNC_CONCURRENCY, (chunk) => fetchChunkRows(chunk, params, result, validRows));

  finalizeCollectedRows(db, result, validRows);
  return result;
}

async function collectRowsForContractInfoFallback(
  chunks: DateChunk[],
  normalizedBizNo: string,
  businessCategory: string | undefined,
  fetchPage: NonNullable<StandardContractSyncClient["fetchContractInfoPage"]>,
  db: Db,
): Promise<StandardContractSyncResult> {
  const validRows: ParsedContractCsvRow[] = [];
  const result = createEmptyResult();

  const tasks = categoriesForSync(businessCategory).flatMap((category) =>
    chunks.map((chunk) => ({
      category,
      chunk,
    })),
  );

  await mapWithConcurrency(tasks, SYNC_CONCURRENCY, ({ category, chunk }) =>
    fetchChunkRows(
      chunk,
      {
        chunks,
        normalizedBizNo,
        selectedCategory: null,
        sourceDataset: CONTRACT_INFO_SOURCE_DATASET,
        fetchPage: (innerChunk, pageNo, numOfRows) => fetchPage(innerChunk, pageNo, numOfRows, category),
      },
      result,
      validRows,
    ),
  );

  finalizeCollectedRows(db, result, validRows);
  return result;
}

async function collectShoppingMallThirdPartyRows(
  db: Db,
  chunks: DateChunk[],
  normalizedBizNo: string,
  fetchInfoPage: NonNullable<StandardContractSyncClient["fetchShoppingMallDeliveryRequestInfoPage"]>,
  fetchDetailPage: NonNullable<StandardContractSyncClient["fetchShoppingMallDeliveryRequestDetailPage"]>,
): Promise<StandardContractSyncResult> {
  const validRows: ParsedContractCsvRow[] = [];
  const result = createEmptyResult();

  await mapWithConcurrency(chunks, SYNC_CONCURRENCY, (chunk) =>
    fetchShoppingMallChunkRows(db, chunk, normalizedBizNo, fetchInfoPage, fetchDetailPage, result, validRows),
  );

  finalizeCollectedRows(db, result, validRows);
  return result;
}

async function fetchShoppingMallChunkRows(
  db: Db,
  chunk: DateChunk,
  normalizedBizNo: string,
  fetchInfoPage: NonNullable<StandardContractSyncClient["fetchShoppingMallDeliveryRequestInfoPage"]>,
  fetchDetailPage: NonNullable<StandardContractSyncClient["fetchShoppingMallDeliveryRequestDetailPage"]>,
  result: StandardContractSyncResult,
  validRows: ParsedContractCsvRow[],
): Promise<void> {
  result.chunksAttempted += 1;

  try {
    const deliveryRequestNos = await fetchMatchingDeliveryRequestNosForChunk(
      db,
      chunk,
      normalizedBizNo,
      fetchInfoPage,
      result,
    );

    await mapWithConcurrency(deliveryRequestNos, SHOPPING_SYNC_CONCURRENCY, (deliveryRequestNo) =>
      fetchAllShoppingMallDetailPagesForRequest(
        chunk,
        deliveryRequestNo,
        normalizedBizNo,
        fetchDetailPage,
        result,
        validRows,
      ),
    );
  } catch (error) {
    recordChunkError(result, chunk, error);
  }
}

async function fetchMatchingDeliveryRequestNosForChunk(
  db: Db,
  chunk: DateChunk,
  normalizedBizNo: string,
  fetchInfoPage: NonNullable<StandardContractSyncClient["fetchShoppingMallDeliveryRequestInfoPage"]>,
  result: StandardContractSyncResult,
): Promise<string[]> {
  const cached = readCachedShoppingMallDeliveryRequestInfoMatches(db, chunk, normalizedBizNo);
  if (cached !== null) {
    result.rowsFetched += cached.cachedRowCount;
    result.skippedCount += cached.cachedRowCount - cached.matchedRowCount;
    return cached.deliveryRequestNos;
  }

  const deliveryRequestNos = new Set<string>();
  beginShoppingMallDeliveryRequestInfoCacheRefresh(db, chunk);

  const firstPage = await fetchInfoPage(chunk, 1, SHOPPING_PAGE_SIZE);
  let cachedRowCount = appendShoppingMallDeliveryRequestInfoCacheRows(db, chunk, firstPage.items);
  processShoppingMallInfoPage(firstPage, normalizedBizNo, result, deliveryRequestNos);

  if (firstPage.items.length === 0 || firstPage.items.length >= firstPage.totalCount) {
    assertCompleteShoppingMallInfoFetch(chunk, firstPage.totalCount, cachedRowCount);
    markShoppingMallDeliveryRequestInfoCacheComplete(db, chunk, firstPage.totalCount, cachedRowCount);
    return [...deliveryRequestNos];
  }

  const pageSize = Math.max(1, firstPage.items.length);
  const totalPages = Math.ceil(firstPage.totalCount / pageSize);

  if (totalPages > MAX_PAGES_PER_CHUNK) {
    throw new G2bStandardContractError(
      "provider_error",
      `G2B shopping mall delivery request info page cap exceeded for ${chunk.dateFrom} to ${chunk.dateTo}.`,
    );
  }

  const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);

  await mapWithConcurrency(remainingPages, SHOPPING_SYNC_CONCURRENCY, async (pageNo) => {
    const page = await fetchInfoPage(chunk, pageNo, SHOPPING_PAGE_SIZE);
    cachedRowCount += appendShoppingMallDeliveryRequestInfoCacheRows(db, chunk, page.items);
    processShoppingMallInfoPage(page, normalizedBizNo, result, deliveryRequestNos);
  });

  assertCompleteShoppingMallInfoFetch(chunk, firstPage.totalCount, cachedRowCount);
  markShoppingMallDeliveryRequestInfoCacheComplete(db, chunk, firstPage.totalCount, cachedRowCount);
  return [...deliveryRequestNos];
}

function assertCompleteShoppingMallInfoFetch(chunk: DateChunk, expectedCount: number, actualCount: number): void {
  if (actualCount < expectedCount) {
    throw new G2bStandardContractError(
      "provider_error",
      `G2B shopping mall delivery request info returned ${actualCount} of ${expectedCount} rows for ${chunk.dateFrom} to ${chunk.dateTo}.`,
    );
  }
}

async function fetchAllShoppingMallDetailPagesForRequest(
  chunk: DateChunk,
  deliveryRequestNo: string,
  normalizedBizNo: string,
  fetchDetailPage: NonNullable<StandardContractSyncClient["fetchShoppingMallDeliveryRequestDetailPage"]>,
  result: StandardContractSyncResult,
  validRows: ParsedContractCsvRow[],
): Promise<void> {
  const firstPage = await fetchDetailPage(chunk, deliveryRequestNo, 1, SHOPPING_PAGE_SIZE);
  processShoppingMallPage(firstPage, normalizedBizNo, chunk.dateFrom, chunk.dateTo, result, validRows);

  if (firstPage.items.length === 0 || firstPage.items.length >= firstPage.totalCount) {
    return;
  }

  const pageSize = Math.max(1, firstPage.items.length);
  const totalPages = Math.ceil(firstPage.totalCount / pageSize);

  if (totalPages > MAX_PAGES_PER_CHUNK) {
    throw new G2bStandardContractError(
      "provider_error",
      `G2B shopping mall delivery request detail page cap exceeded for ${deliveryRequestNo}.`,
    );
  }

  const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);

  await mapWithConcurrency(remainingPages, SHOPPING_SYNC_CONCURRENCY, async (pageNo) => {
    const page = await fetchDetailPage(chunk, deliveryRequestNo, pageNo, SHOPPING_PAGE_SIZE);
    processShoppingMallPage(page, normalizedBizNo, chunk.dateFrom, chunk.dateTo, result, validRows);
  });
}

async function fetchChunkRows(
  chunk: DateChunk,
  source: SourceCollectionParams,
  result: StandardContractSyncResult,
  validRows: ParsedContractCsvRow[],
): Promise<void> {
  result.chunksAttempted += 1;

  try {
    await fetchAllPagesForChunk(chunk, source, result, validRows);
  } catch (error) {
    if (error instanceof G2bStandardContractError && error.code === "date_range_too_large") {
      const expandedChunks = expandRangeLimitedChunk(chunk);

      if (expandedChunks.length > 0) {
        result.chunksExpanded += 1;
        await mapWithConcurrency(expandedChunks, SYNC_CONCURRENCY, (expandedChunk) =>
          fetchChunkRows(expandedChunk, source, result, validRows),
        );
        return;
      }
    }

    recordChunkError(result, chunk, error);
  }
}

async function fetchAllPagesForChunk(
  chunk: DateChunk,
  source: SourceCollectionParams,
  result: StandardContractSyncResult,
  validRows: ParsedContractCsvRow[],
): Promise<void> {
  const firstPage = await source.fetchPage(chunk, 1, PAGE_SIZE);
  processPage(firstPage, source, result, validRows);

  if (firstPage.items.length === 0 || firstPage.items.length >= firstPage.totalCount) {
    return;
  }

  const pageSize = Math.max(1, firstPage.items.length);
  const totalPages = Math.ceil(firstPage.totalCount / pageSize);

  if (totalPages > MAX_PAGES_PER_CHUNK) {
    throw new G2bStandardContractError(
      "provider_error",
      `G2B standard contract page cap exceeded for ${chunk.dateFrom} to ${chunk.dateTo}.`,
    );
  }

  const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);

  await mapWithConcurrency(remainingPages, SYNC_CONCURRENCY, async (pageNo) => {
    const page = await source.fetchPage(chunk, pageNo, PAGE_SIZE);
    processPage(page, source, result, validRows);
  });
}

function processPage(
  page: StandardContractPage,
  source: SourceCollectionParams,
  result: StandardContractSyncResult,
  validRows: ParsedContractCsvRow[],
): void {
  result.pagesFetched += 1;
  result.rowsFetched += page.items.length;

  for (const item of page.items) {
    const mapped = mapStandardContractRow(item, source.normalizedBizNo, source.sourceDataset);

    if (mapped.success && rowMatchesSelectedCategory(mapped.row, source.selectedCategory)) {
      result.rowsMatched += 1;
      validRows.push(mapped.row);
    } else {
      result.skippedCount += 1;
    }
  }
}

function processShoppingMallInfoPage(
  page: StandardContractPage,
  normalizedBizNo: string,
  result: StandardContractSyncResult,
  deliveryRequestNos: Set<string>,
): void {
  result.pagesFetched += 1;
  result.rowsFetched += page.items.length;

  for (const item of page.items) {
    const deliveryRequestNo = asNonBlankString(item.dlvrReqNo);

    if (deliveryRequestNo !== null && shoppingMallInfoRowMatchesBusiness(item, normalizedBizNo)) {
      deliveryRequestNos.add(deliveryRequestNo);
    } else {
      result.skippedCount += 1;
    }
  }
}

function processShoppingMallPage(
  page: StandardContractPage,
  normalizedBizNo: string,
  dateFrom: string,
  dateTo: string,
  result: StandardContractSyncResult,
  validRows: ParsedContractCsvRow[],
): void {
  result.pagesFetched += 1;
  result.rowsFetched += page.items.length;

  for (const item of page.items) {
    const mapped = mapShoppingMallThirdPartyDeliveryRow(item, normalizedBizNo);

    if (mapped.success && rowMatchesDateRange(mapped.row, dateFrom, dateTo)) {
      result.rowsMatched += 1;
      validRows.push(mapped.row);
    } else {
      result.skippedCount += 1;
    }
  }
}

function shoppingMallInfoRowMatchesBusiness(row: Record<string, unknown>, normalizedBizNo: string): boolean {
  const providerBizNo = asNonBlankString(row.corpBizno)?.replace(/\D/g, "") ?? "";
  const contractMethod = asNonBlankString(row.cntrctCnclsStleNm);

  return (
    providerBizNo === normalizedBizNo &&
    contractMethod !== null &&
    contractMethod.includes("제3자단가")
  );
}

function asNonBlankString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function createEmptyResult(): StandardContractSyncResult {
  return {
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
}

function finalizeCollectedRows(db: Db, result: StandardContractSyncResult, validRows: ParsedContractCsvRow[]): void {
  if (validRows.length > 0) {
    const importResult = upsertParsedRows(db, validRows);
    result.insertedCount = importResult.insertedCount;
    result.updatedCount = importResult.updatedCount;
    result.skippedCount += importResult.skippedCount;
    result.errorCount += importResult.errorCount;
  }
}

function selectedCategoryForFilter(category: string | undefined): G2bContractBusinessCategory | null {
  if (category === undefined || category === "all") {
    return null;
  }

  return isG2bContractBusinessCategory(category) ? category : null;
}

function rowMatchesSelectedCategory(row: ParsedContractCsvRow, selectedCategory: G2bContractBusinessCategory | null): boolean {
  return selectedCategory === null || row.businessCategory === selectedCategory;
}

function rowMatchesDateRange(row: ParsedContractCsvRow, dateFrom: string, dateTo: string): boolean {
  return row.contractDate >= dateFrom && row.contractDate <= dateTo;
}

function shouldFallbackToContractInfo(result: StandardContractSyncResult): boolean {
  return (
    result.pagesFetched === 0 &&
    result.errors.length > 0 &&
    result.errors.every((error) => error.code === "unauthorized_service_key")
  );
}

function categoriesForSync(category: string | undefined): G2bContractBusinessCategory[] {
  if (category === undefined || category === "all") {
    return ALL_CONTRACT_CATEGORIES;
  }

  return isG2bContractBusinessCategory(category) ? [category] : [];
}

function isG2bContractBusinessCategory(value: string): value is G2bContractBusinessCategory {
  return (ALL_CONTRACT_CATEGORIES as string[]).includes(value);
}

function shouldSyncStandardContracts(category: string | undefined): boolean {
  return category !== SHOPPING_THIRD_PARTY_CATEGORY;
}

function shouldSyncShoppingThirdParty(category: string | undefined): boolean {
  return category === undefined || category === "all" || category === SHOPPING_THIRD_PARTY_CATEGORY;
}

function combineSyncResults(results: StandardContractSyncResult[]): StandardContractSyncResult {
  const combined = createEmptyResult();

  for (const result of results) {
    combined.chunksAttempted += result.chunksAttempted;
    combined.chunksExpanded += result.chunksExpanded;
    combined.pagesFetched += result.pagesFetched;
    combined.rowsFetched += result.rowsFetched;
    combined.rowsMatched += result.rowsMatched;
    combined.insertedCount += result.insertedCount;
    combined.updatedCount += result.updatedCount;
    combined.skippedCount += result.skippedCount;
    combined.errorCount += result.errorCount;
    combined.errors.push(...result.errors);
  }

  combined.status = syncStatus(combined);
  return combined;
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

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (firstError === undefined) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      try {
        await task(items[index]);
      } catch (error) {
        firstError = error;
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstError !== undefined) {
    throw firstError;
  }
}
