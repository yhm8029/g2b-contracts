import { createHash } from "node:crypto";
import type {
  CompetitorContractQueryCache,
  CompetitorContractQueryCacheKey,
} from "./cache";
import {
  G2B_PUBLIC_STANDARD_CONTRACT_NUM_OF_ROWS,
  G2bPublicStandardContractUpstreamError,
  fetchG2bPublicStandardContractPage,
} from "./standard-contract-client";
import {
  type G2bPublicStandardContractProjection,
  mapG2bPublicStandardContractRow,
} from "./standard-contract-row";

export type CompetitorContractSearchInput = {
  bizNo: string;
  dateFrom: string;
  dateTo: string;
};

export type CompetitorContractRow = {
  id: string;
  bizNoNormalized: string;
  bizNoDisplay: string;
  businessName: string;
  contractName: string;
  itemNames?: string[];
  itemCodes?: string[];
  contractDate: string | null;
  originalContractDate?: string;
  amendmentOrder?: number;
  currentContractAmount: number;
  totalContractAmount: number;
  contractTotalAmount?: number;
  amountAttribution?: "full-contract" | "supplier-reported" | "supplier-rate" | "equal-share";
  demandAgencyName: string;
  contractAgencyName: string;
  contractMethod: string;
  contractType?: string;
  contractNo: string;
  noticeNo: string;
  contractDetailUrl: string;
  noticeDetailUrl: string;
  sourceDataset: "g2b-public-standard-contract";
};

export type CompetitorContractSearchResult = {
  fetchedAt?: string;
  rows: CompetitorContractRow[];
  summary: {
    contractCount: number;
    totalAmount: number;
    noticeLinkedCount: number;
    latestContractDate: string | null;
  };
  coverage?: CompetitorContractCoverage;
};

export type CompetitorContractCoverage = {
  complete: boolean;
  fresh: boolean;
  missingRanges: Array<{ dateFrom: string; dateTo: string }>;
};

export type CompetitorContractSearchResponse = Omit<CompetitorContractSearchResult, "coverage"> & {
  coverage: CompetitorContractCoverage;
};

export type CompetitorContractFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type CompetitorContractSleep = (milliseconds: number) => Promise<void>;

export type CompetitorContractSearchDeps = {
  serviceKey: string;
  fetchImpl?: CompetitorContractFetch;
  queryCache?: Pick<CompetitorContractQueryCache, "get" | "set">
    & Partial<Pick<
      CompetitorContractQueryCache,
      "getStored" | "getFreshIntervals" | "getStoredIntervals" | "setInterval"
    >>;
  cacheOnly?: boolean;
  sleep?: CompetitorContractSleep;
  now?: () => Date;
  signal?: AbortSignal;
};

export class CompetitorContractInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompetitorContractInputError";
  }
}

export class CompetitorContractConfigurationError extends Error {
  readonly reason = "service_key_missing" as const;

  constructor() {
    super("G2B service key is required");
    this.name = "CompetitorContractConfigurationError";
  }
}

export type CompetitorContractUpstreamErrorKind = "temporary" | "response" | "incomplete";

export class CompetitorContractUpstreamError extends Error {
  constructor(
    message: string,
    readonly kind: CompetitorContractUpstreamErrorKind,
    readonly upstreamCode?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "CompetitorContractUpstreamError";
  }
}

const MAX_PAGES_PER_WINDOW = 100;
const MAX_TOTAL_PAGES = 2_500;
const REQUEST_CONCURRENCY = 4;
const MAX_WINDOW_DAYS = 7;
const TRAILING_DAILY_WINDOW_DAYS = 14;
const MAX_REQUIRED_EMPTY_PAGE_ATTEMPTS = 3;
const COMPETITOR_CONTRACT_IDENTITY_VERSION = "v1";

export async function searchCompetitorContracts(
  input: CompetitorContractSearchInput,
  deps: CompetitorContractSearchDeps,
): Promise<CompetitorContractSearchResponse> {
  const businessNumbers = parseBusinessNumbers(input.bizNo).sort();
  const dateFrom = parseDate(input.dateFrom, "dateFrom");
  const dateTo = parseDate(input.dateTo, "dateTo");
  if (dateFrom.compact > dateTo.compact) {
    throw new CompetitorContractInputError("dateFrom must be earlier than or equal to dateTo");
  }

  const cacheKey: CompetitorContractQueryCacheKey = {
    bizNoNormalized: businessNumbers.join(","),
    dateFrom: dateFrom.dashed,
    dateTo: dateTo.dashed,
  };
  const requested = new Set(businessNumbers);
  const storedExact = deps.cacheOnly ? deps.queryCache?.getStored?.(cacheKey) : null;
  const cached = deps.cacheOnly ? storedExact?.result : deps.queryCache?.get(cacheKey);
  if (cached) {
    const normalized = normalizeCachedCompetitorContractSearchResult(cached, requested);
    if (normalized) {
      return {
        ...normalized,
        coverage: {
          complete: true,
          fresh: deps.cacheOnly ? storedExact?.fresh === true : true,
          missingRanges: [],
        },
      };
    }
  }

  const intervalCandidates = deps.cacheOnly
    ? (deps.queryCache?.getStoredIntervals?.(cacheKey) ?? [])
    : (deps.queryCache?.getFreshIntervals?.(cacheKey) ?? []).map((interval) => ({ ...interval, fresh: true }));
  const normalizedIntervals = intervalCandidates
    .flatMap((interval) => {
      if (
        !isDashedCalendarDate(interval.dateFrom)
        || !isDashedCalendarDate(interval.dateTo)
        || interval.dateFrom > interval.dateTo
      ) {
        return [];
      }
      const normalized = normalizeCachedCompetitorContractSearchResult(interval.result, requested);
      return normalized ? [{ ...interval, result: normalized }] : [];
    });
  const freshMissingRanges = deps.cacheOnly
    ? findMissingDateRanges(cacheKey, normalizedIntervals.filter((interval) => interval.fresh))
    : [];
  const cachedIntervals = deps.cacheOnly
    ? normalizedIntervals.filter((interval) =>
      interval.fresh || freshMissingRanges.some((range) => dateRangesIntersect(interval, range)))
    : normalizedIntervals;
  const missingRanges = findMissingDateRanges(cacheKey, cachedIntervals);
  const cachedRows = cachedIntervals.flatMap((interval) =>
    interval.result.rows.filter((row) =>
      isRowWithinDateRange(row, cacheKey)
      && (interval.fresh || isRowWithinAnyDateRange(row, freshMissingRanges)))
  );
  const fetchedRows: CompetitorContractRow[] = [];
  const fetchedSourceRows: G2bPublicStandardContractProjection[] = [];
  const knownSourceGroupKeys = new Set(
    cachedRows.map(sourceContractGroupKeyForContractRow).filter((value): value is string => value !== null),
  );
  const fetchedAtValues = cachedIntervals
    .map((interval) => interval.result.fetchedAt)
    .filter((value): value is string => value !== undefined);

  if (deps.cacheOnly) {
    const rows = finalizeCompetitorContractRows(cachedRows);
    const fetchedAt = fetchedAtValues.sort().at(-1);
    return {
      ...(fetchedAt ? { fetchedAt } : {}),
      rows,
      summary: summarizeCompetitorContractRows(rows),
      coverage: {
        complete: missingRanges.length === 0,
        fresh: cachedIntervals.every((interval) => interval.fresh),
        missingRanges,
      },
    };
  }

  if (missingRanges.length > 0) {
    const serviceKey = deps.serviceKey?.trim();
    if (!serviceKey) {
      throw new CompetitorContractConfigurationError();
    }

    const fetchImpl = deps.fetchImpl ?? fetch;
    const now = (deps.now ?? (() => new Date()))();
    const fetchedAt = now.toISOString();
    const pageBudget = { remaining: MAX_TOTAL_PAGES };
    fetchedAtValues.push(fetchedAt);
    for (const missingRange of missingRanges) {
      const missingDateFrom = parseDate(missingRange.dateFrom, "dateFrom");
      const missingDateTo = parseDate(missingRange.dateTo, "dateTo");
      const latestSourceContracts = await fetchLatestRequestedStandardContracts({
        windows: splitInclusiveDateRange(missingDateFrom.date, missingDateTo.date, seoulCalendarDate(now)),
        fetchImpl,
        serviceKey,
        requested,
        knownGroupKeys: knownSourceGroupKeys,
        pageBudget,
        signal: deps.signal,
        sleep: deps.sleep ?? defaultSleep,
        onWindowComplete: (window, latestRows, knownGroupKeysBeforeWindow) => {
          const hasSupplierRemoval = latestSourceRowsRemoveRequestedSupplier(
            latestRows,
            knownGroupKeysBeforeWindow,
            requested,
          );
          for (const sourceRow of latestRows) {
            knownSourceGroupKeys.add(sourceContractGroupKey(sourceRow));
          }
          if (hasSupplierRemoval) return;
          const intervalRows = finalizeCompetitorContractRows(
            latestRows
              .flatMap((row) => mapStandardContractRows(row, requested))
              .filter((row) => requested.has(row.bizNoNormalized)),
          );
          deps.queryCache?.setInterval?.(
            {
              ...cacheKey,
              dateFrom: compactDateToDashed(window.dateFrom),
              dateTo: compactDateToDashed(window.dateTo),
            },
            {
              fetchedAt,
              rows: intervalRows,
              summary: summarizeCompetitorContractRows(intervalRows),
              coverage: { complete: true, fresh: true, missingRanges: [] },
            },
          );
        },
      });
      for (const sourceRow of latestSourceContracts) {
        knownSourceGroupKeys.add(sourceContractGroupKey(sourceRow));
        fetchedSourceRows.push(sourceRow);
      }
      throwIfSearchAborted(deps.signal);
      fetchedRows.push(...finalizeCompetitorContractRows(
        latestSourceContracts
          .flatMap((row) => mapStandardContractRows(row, requested))
          .filter((row) => requested.has(row.bizNoNormalized)),
      ));
    }
  }

  throwIfSearchAborted(deps.signal);
  const fetchedSourceByGroup = latestSourceProjectionByGroup(fetchedSourceRows);
  const survivingCachedRows = cachedRows.filter((row) => {
    const groupKey = sourceContractGroupKeyForContractRow(row);
    if (groupKey === null) return true;
    const fetchedSource = fetchedSourceByGroup.get(groupKey);
    return fetchedSource === undefined || !sourceProjectionIsNewerThanRow(fetchedSource, row);
  });
  const rows = finalizeCompetitorContractRows([...survivingCachedRows, ...fetchedRows]);
  const fetchedAt = fetchedAtValues.sort().at(-1);
  const result: CompetitorContractSearchResponse = {
    ...(fetchedAt ? { fetchedAt } : {}),
    rows,
    summary: summarizeCompetitorContractRows(rows),
    coverage: { complete: true, fresh: true, missingRanges: [] },
  };
  deps.queryCache?.set(cacheKey, result);
  return result;
}

export function resolveCompetitorContractServiceKey(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.DATA_GO_KR_SERVICE_KEY ??
    env.G2B_SERVICE_KEY ??
    env.PUBLIC_DATA_SERVICE_KEY ??
    env.NARA_BID_API_KEY ??
    ""
  ).trim();
}

function parseBusinessNumbers(value: string) {
  const parts = value
    .split(/[,\s/]+/)
    .map((part) => part.replace(/\D/g, ""))
    .filter(Boolean);
  if (parts.length === 0) {
    throw new CompetitorContractInputError("bizNo is required");
  }
  const invalid = parts.find((part) => part.length !== 10);
  if (invalid) {
    throw new CompetitorContractInputError("each bizNo must contain 10 digits");
  }
  return [...new Set(parts)];
}

function parseDate(value: string, fieldName: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new CompetitorContractInputError(`${fieldName} must be YYYY-MM-DD`);
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new CompetitorContractInputError(`${fieldName} must be a valid date`);
  }
  return {
    compact: `${yearText}${monthText}${dayText}`,
    dashed: `${yearText}-${monthText}-${dayText}`,
    date,
  };
}

function splitInclusiveDateRange(dateFrom: Date, dateTo: Date, seoulToday: Date) {
  const windows: Array<{ dateFrom: string; dateTo: string }> = [];
  const dailyWindowStart = addUtcDays(seoulToday, -(TRAILING_DAILY_WINDOW_DAYS - 1));
  let cursor = dateFrom;

  while (cursor <= dateTo) {
    const usesDailyWindow = cursor >= dailyWindowStart;
    const candidateEnd = usesDailyWindow
      ? cursor
      : minDate(addUtcDays(cursor, MAX_WINDOW_DAYS - 1), addUtcDays(dailyWindowStart, -1));
    const windowEnd = candidateEnd < dateTo ? candidateEnd : dateTo;
    windows.push({
      dateFrom: formatCompactDate(cursor),
      dateTo: formatCompactDate(windowEnd),
    });
    cursor = addUtcDays(windowEnd, 1);
  }

  return windows;
}

function seoulCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const numberPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(numberPart("year"), numberPart("month") - 1, numberPart("day")));
}

function minDate(left: Date, right: Date) {
  return left < right ? left : right;
}

function addUtcDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatCompactDate(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function formatDashedDate(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function compactDateToDashed(value: string) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function shiftDashedDate(value: string, days: number) {
  return formatDashedDate(addUtcDays(new Date(`${value}T00:00:00.000Z`), days));
}

function findMissingDateRanges(
  requestedRange: Pick<CompetitorContractQueryCacheKey, "dateFrom" | "dateTo">,
  intervals: readonly Pick<CompetitorContractQueryCacheKey, "dateFrom" | "dateTo">[],
) {
  const missing: Array<{ dateFrom: string; dateTo: string }> = [];
  let cursor = requestedRange.dateFrom;
  const ordered = [...intervals]
    .filter((interval) => interval.dateFrom <= requestedRange.dateTo && interval.dateTo >= requestedRange.dateFrom)
    .sort((left, right) => left.dateFrom.localeCompare(right.dateFrom) || left.dateTo.localeCompare(right.dateTo));

  for (const interval of ordered) {
    const coveredFrom = interval.dateFrom < requestedRange.dateFrom ? requestedRange.dateFrom : interval.dateFrom;
    const coveredTo = interval.dateTo > requestedRange.dateTo ? requestedRange.dateTo : interval.dateTo;
    if (coveredTo < cursor) continue;
    if (coveredFrom > cursor) {
      missing.push({ dateFrom: cursor, dateTo: shiftDashedDate(coveredFrom, -1) });
    }
    const nextCursor = shiftDashedDate(coveredTo, 1);
    if (nextCursor > cursor) cursor = nextCursor;
    if (cursor > requestedRange.dateTo) break;
  }

  if (cursor <= requestedRange.dateTo) {
    missing.push({ dateFrom: cursor, dateTo: requestedRange.dateTo });
  }
  return missing;
}

function isRowWithinDateRange(
  row: CompetitorContractRow,
  range: Pick<CompetitorContractQueryCacheKey, "dateFrom" | "dateTo">,
) {
  return row.contractDate !== null && row.contractDate >= range.dateFrom && row.contractDate <= range.dateTo;
}

function isRowWithinAnyDateRange(
  row: CompetitorContractRow,
  ranges: readonly Pick<CompetitorContractQueryCacheKey, "dateFrom" | "dateTo">[],
) {
  return ranges.some((range) => isRowWithinDateRange(row, range));
}

function dateRangesIntersect(
  left: Pick<CompetitorContractQueryCacheKey, "dateFrom" | "dateTo">,
  right: Pick<CompetitorContractQueryCacheKey, "dateFrom" | "dateTo">,
) {
  return left.dateFrom <= right.dateTo && left.dateTo >= right.dateFrom;
}

type OrderedTaskResult<Output> =
  | { status: "fulfilled"; value: Output }
  | { status: "rejected"; reason: unknown };

async function forEachWithConcurrencyInOrder<Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input, index: number) => Promise<Output>,
  consumer: (output: Output, index: number) => Promise<void> | void,
  signal?: AbortSignal,
) {
  const pending = new Map<number, Promise<OrderedTaskResult<Output>>>();
  let nextIndex = 0;

  const fill = () => {
    while (pending.size < concurrency && nextIndex < inputs.length) {
      throwIfSearchAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      pending.set(index, mapper(inputs[index], index).then(
        (value): OrderedTaskResult<Output> => ({ status: "fulfilled", value }),
        (reason): OrderedTaskResult<Output> => ({ status: "rejected", reason }),
      ));
    }
  };

  fill();
  for (let index = 0; index < inputs.length; index += 1) {
    throwIfSearchAborted(signal);
    const result = await pending.get(index)!;
    pending.delete(index);
    if (result.status === "rejected") {
      throw result.reason;
    }
    await consumer(result.value, index);
    fill();
  }
}

async function fetchLatestRequestedStandardContracts(input: {
  windows: Array<{ dateFrom: string; dateTo: string }>;
  fetchImpl: CompetitorContractFetch;
  serviceKey: string;
  requested: ReadonlySet<string>;
  knownGroupKeys?: ReadonlySet<string>;
  pageBudget?: { remaining: number };
  signal?: AbortSignal;
  sleep: CompetitorContractSleep;
  onWindowComplete?: (
    window: Pick<StandardContractPage, "dateFrom" | "dateTo">,
    latestRows: G2bPublicStandardContractProjection[],
    knownGroupKeysBeforeWindow: ReadonlySet<string>,
  ) => Promise<void> | void;
}) {
  const availablePageBudget = input.pageBudget?.remaining ?? MAX_TOTAL_PAGES;
  if (input.windows.length > availablePageBudget) {
    throw new CompetitorContractUpstreamError(
      `G2B contract result requires at least ${input.windows.length} pages across the requested range`,
      "incomplete",
    );
  }
  const overallCollector = createLatestRequestedSourceContractCollector(input.requested, input.knownGroupKeys);
  const firstPageRequests = input.windows.map((window, windowIndex) => ({
    ...window,
    windowIndex,
    pageNo: 1,
  }));
  let remainingAdditionalPageBudget = availablePageBudget - input.windows.length;
  // Ordered consumption lets unrelated rows update only groups already proven target-relevant.
  await forEachWithConcurrencyInOrder(
    firstPageRequests,
    REQUEST_CONCURRENCY,
    (request) => fetchStandardContractPage({
      ...request,
      fetchImpl: input.fetchImpl,
      serviceKey: input.serviceKey,
      signal: input.signal,
      sleep: input.sleep,
    }),
    async (firstPage) => {
      const knownGroupKeysBeforeWindow = overallCollector.retainedGroupKeys();
      const windowResult = await collectStandardContractWindow({
        firstPage,
        fetchImpl: input.fetchImpl,
        serviceKey: input.serviceKey,
        requested: input.requested,
        knownGroupKeys: knownGroupKeysBeforeWindow,
        signal: input.signal,
        sleep: input.sleep,
        remainingPageBudget: remainingAdditionalPageBudget + 1,
      });
      remainingAdditionalPageBudget -= windowResult.totalPages - 1;
      overallCollector.addMapped(windowResult.latestRows);
      await input.onWindowComplete?.(firstPage, windowResult.latestRows, knownGroupKeysBeforeWindow);
    },
    input.signal,
  );

  if (input.pageBudget) input.pageBudget.remaining = remainingAdditionalPageBudget;
  return overallCollector.finish();
}

async function collectStandardContractWindow(input: {
  firstPage: StandardContractPage;
  fetchImpl: CompetitorContractFetch;
  serviceKey: string;
  requested: ReadonlySet<string>;
  knownGroupKeys: ReadonlySet<string>;
  signal?: AbortSignal;
  sleep: CompetitorContractSleep;
  remainingPageBudget: number;
}) {
  const collector = createLatestRequestedSourceContractCollector(input.requested, input.knownGroupKeys);
  consumeStandardContractPage(input.firstPage, collector);
  // The upstream offset dataset is mutable, so grow the observed tail without replaying a window.
  let maxObservedTotalCount = input.firstPage.totalCount;
  let requiredTotalPages = totalPagesForCount(maxObservedTotalCount);
  assertPageBudget(requiredTotalPages, input.remainingPageBudget);
  let nextPageNo = 2;

  while (nextPageNo <= requiredTotalPages) {
    const batchEndPage = requiredTotalPages;
    const pageRequests = Array.from(
      { length: batchEndPage - nextPageNo + 1 },
      (_, index) => ({
        dateFrom: input.firstPage.dateFrom,
        dateTo: input.firstPage.dateTo,
        windowIndex: input.firstPage.windowIndex,
        pageNo: nextPageNo + index,
      }),
    );
    await forEachWithConcurrencyInOrder(
      pageRequests,
      REQUEST_CONCURRENCY,
      (request) => fetchStandardContractPage({
        ...request,
        fetchImpl: input.fetchImpl,
        serviceKey: input.serviceKey,
        signal: input.signal,
        sleep: input.sleep,
      }),
      (page) => {
        consumeStandardContractPage(page, collector);
        if (page.totalCount <= maxObservedTotalCount) return;
        maxObservedTotalCount = page.totalCount;
        requiredTotalPages = totalPagesForCount(maxObservedTotalCount);
        assertPageBudget(requiredTotalPages, input.remainingPageBudget);
      },
      input.signal,
    );
    nextPageNo = batchEndPage + 1;
  }

  return { latestRows: collector.finish(), totalPages: requiredTotalPages };
}

function totalPagesForCount(totalCount: number) {
  return Math.max(1, Math.ceil(totalCount / G2B_PUBLIC_STANDARD_CONTRACT_NUM_OF_ROWS));
}

function assertPageBudget(totalPages: number, remainingPageBudget: number) {
  if (totalPages > MAX_PAGES_PER_WINDOW) {
    throw new CompetitorContractUpstreamError(
      `G2B contract result requires ${totalPages} pages for one date window`,
      "incomplete",
    );
  }
  if (totalPages > remainingPageBudget) {
    throw new CompetitorContractUpstreamError(
      `G2B contract result requires more than ${MAX_TOTAL_PAGES} pages across the requested range`,
      "incomplete",
    );
  }
}

type StandardContractPage = {
  dateFrom: string;
  dateTo: string;
  windowIndex: number;
  pageNo: number;
  totalCount: number;
  items: Record<string, unknown>[];
};

function consumeStandardContractPage(
  page: StandardContractPage,
  collector: ReturnType<typeof createLatestRequestedSourceContractCollector>,
): void {
  collector.add(page.items);
}

async function fetchStandardContractPage(input: {
  dateFrom: string;
  dateTo: string;
  windowIndex: number;
  pageNo: number;
  fetchImpl: CompetitorContractFetch;
  serviceKey: string;
  signal?: AbortSignal;
  sleep: CompetitorContractSleep;
}): Promise<StandardContractPage> {
  try {
    for (let attempt = 1; attempt <= MAX_REQUIRED_EMPTY_PAGE_ATTEMPTS; attempt += 1) {
      const parsed = await fetchG2bPublicStandardContractPage({
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        pageNo: input.pageNo,
        fetchImpl: input.fetchImpl,
        serviceKey: input.serviceKey,
        signal: input.signal,
        sleep: input.sleep,
      });
      const page = {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        windowIndex: input.windowIndex,
        pageNo: input.pageNo,
        totalCount: parsed.totalCount,
        items: parsed.items,
      };
      if (!isRequiredEmptyStandardContractPage(page)) return page;
      if (attempt === MAX_REQUIRED_EMPTY_PAGE_ATTEMPTS) {
        throw new CompetitorContractUpstreamError(
          `G2B contract result returned an empty required page ${page.pageNo}`,
          "incomplete",
        );
      }
    }
    throw new CompetitorContractUpstreamError("G2B contract empty-page retry loop exhausted", "incomplete");
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason;
    throw normalizeUpstreamError(error);
  }
}

function normalizeUpstreamError(error: unknown) {
  if (error instanceof CompetitorContractUpstreamError) {
    return error;
  }
  if (error instanceof G2bPublicStandardContractUpstreamError) {
    return new CompetitorContractUpstreamError(
      error.message,
      error.kind,
      error.upstreamCode,
      error.httpStatus,
    );
  }
  return new CompetitorContractUpstreamError(
    error instanceof Error ? error.message : "G2B contract search request failed",
    "temporary",
  );
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isRequiredEmptyStandardContractPage(page: Pick<StandardContractPage, "pageNo" | "totalCount" | "items">) {
  return page.totalCount > 0 && page.items.length === 0 && page.pageNo <= totalPagesForCount(page.totalCount);
}

function throwIfSearchAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
}

function mapStandardContractRows(
  mapped: G2bPublicStandardContractProjection,
  requested: ReadonlySet<string>,
): CompetitorContractRow[] {
  const suppliers = uniqueSuppliersByBusinessNumber(mapped.suppliers);
  const matchingSuppliers = suppliers.filter((supplier) => requested.has(supplier.businessNumber));
  if (matchingSuppliers.length === 0) {
    return [];
  }
  const attributions = attributeContractAmounts(
    suppliers,
    mapped.currentContractAmount,
    mapped.totalContractAmount,
  );

  return matchingSuppliers.map((matchingSupplier) => {
    const attribution = attributions.get(matchingSupplier.businessNumber)!;
    return normalizeCompetitorContractRowIdentity({
      id: "",
      bizNoNormalized: matchingSupplier.businessNumber,
      bizNoDisplay: formatBusinessNumber(matchingSupplier.businessNumber),
      businessName: matchingSupplier.businessName || "-",
      contractName: mapped.contractName,
      ...(mapped.itemNames && mapped.itemNames.length > 0 ? { itemNames: mapped.itemNames } : {}),
      ...(mapped.itemCodes && mapped.itemCodes.length > 0 ? { itemCodes: mapped.itemCodes } : {}),
      contractDate: mapped.contractDate,
      ...(mapped.originalContractDate ? { originalContractDate: mapped.originalContractDate } : {}),
      ...(mapped.amendmentOrder === undefined ? {} : { amendmentOrder: mapped.amendmentOrder }),
      currentContractAmount: attribution.current,
      totalContractAmount: attribution.total,
      contractTotalAmount: mapped.totalContractAmount,
      amountAttribution: attribution.kind,
      demandAgencyName: mapped.demandAgencyName,
      contractAgencyName: mapped.contractAgencyName,
      contractMethod: mapped.contractMethod,
      ...(mapped.contractType ? { contractType: mapped.contractType } : {}),
      contractNo: mapped.contractNo,
      noticeNo: mapped.noticeNo,
      contractDetailUrl: mapped.contractDetailUrl,
      noticeDetailUrl: mapped.noticeDetailUrl,
      sourceDataset: mapped.sourceDataset,
    });
  });
}

function createLatestRequestedSourceContractCollector(
  requested: ReadonlySet<string>,
  knownGroupKeys: ReadonlySet<string> = new Set(),
) {
  const groups = new Map<string, {
    latestRows: G2bPublicStandardContractProjection[];
    sawRequestedSupplier: boolean;
  }>();

  const addMapped = (mappedRows: readonly G2bPublicStandardContractProjection[]) => {
    const orderedRows = [...mappedRows]
      .sort((left, right) => compareSourceContractAmendments(right, left));
    for (const mapped of orderedRows) {
      const key = sourceContractGroupKey(mapped);
      const hasRequestedSupplier = mapped.suppliers.some((supplier) => requested.has(supplier.businessNumber));
      const group = groups.get(key);
      if (!group) {
        groups.set(key, { latestRows: [mapped], sawRequestedSupplier: hasRequestedSupplier });
        continue;
      }

      group.sawRequestedSupplier ||= hasRequestedSupplier;
      const representative = group.latestRows[0]!;
      if (sameSourceContractVersion(mapped, representative)) {
        group.latestRows.push(mapped);
      } else if (compareSourceContractAmendments(mapped, representative) < 0) {
        group.latestRows = [mapped];
      }
    }
  };

  return {
    add(rows: readonly Record<string, unknown>[]) {
      addMapped(rows.map(mapG2bPublicStandardContractRow));
    },
    addMapped,
    retainedGroupKeys() {
      return new Set([
        ...knownGroupKeys,
        ...[...groups.entries()]
          .filter(([, group]) => group.sawRequestedSupplier)
          .map(([key]) => key),
      ]);
    },
    retainedGroupCount() {
      return [...groups.entries()].filter(([key, group]) =>
        knownGroupKeys.has(key) || group.sawRequestedSupplier
      ).length;
    },
    finish() {
      const latest: G2bPublicStandardContractProjection[] = [];
      for (const [key, group] of groups) {
        if (!knownGroupKeys.has(key) && !group.sawRequestedSupplier) continue;
        latest.push(...group.latestRows);
      }
      return latest;
    }
  };
}

export const competitorContractTestHooks = {
  createLatestRequestedSourceContractCollector,
};

function sourceContractGroupKey(row: G2bPublicStandardContractProjection) {
  if (row.contractKeyKind !== "fallback" || !row.originalContractDate) {
    return row.contractKey;
  }
  return `fallback-original:${sha256([
    row.sourceDataset,
    canonicalIdentifier(row.noticeNo),
    canonicalText(row.contractName),
    canonicalText(row.demandAgencyName),
    canonicalText(row.contractAgencyName),
    canonicalText(row.originalContractDate),
  ])}`;
}

function sourceContractGroupKeyForContractRow(row: CompetitorContractRow): string | null {
  const contractNo = canonicalIdentifier(row.contractNo);
  if (contractNo) {
    return `g2b-standard-contract:v1:contract:contract-no:${sha256([row.sourceDataset, contractNo])}`;
  }
  const noticeNo = canonicalIdentifier(row.noticeNo);
  const contractDetailUrl = canonicalText(row.contractDetailUrl);
  if (noticeNo && contractDetailUrl) {
    return `g2b-standard-contract:v1:contract:notice-detail:${sha256([
      row.sourceDataset,
      noticeNo,
      contractDetailUrl,
    ])}`;
  }
  if (!row.originalContractDate) return null;
  return `fallback-original:${sha256([
    row.sourceDataset,
    noticeNo,
    canonicalText(row.contractName),
    canonicalText(row.demandAgencyName),
    canonicalText(row.contractAgencyName),
    canonicalText(row.originalContractDate),
  ])}`;
}

function latestSourceProjectionByGroup(rows: readonly G2bPublicStandardContractProjection[]) {
  const latest = new Map<string, G2bPublicStandardContractProjection>();
  for (const row of rows) {
    const key = sourceContractGroupKey(row);
    const current = latest.get(key);
    if (!current || compareSourceContractAmendments(row, current) < 0) latest.set(key, row);
  }
  return latest;
}

function sourceProjectionIsNewerThanRow(
  source: G2bPublicStandardContractProjection,
  row: CompetitorContractRow,
) {
  const sourceOrder = source.amendmentOrder ?? -1;
  const rowOrder = row.amendmentOrder ?? -1;
  if (sourceOrder !== rowOrder) return sourceOrder > rowOrder;
  const sourceDate = source.contractDate ?? "";
  const rowDate = row.contractDate ?? "";
  if (sourceDate !== rowDate) return sourceDate > rowDate;
  return !source.suppliers.some((supplier) => supplier.businessNumber === row.bizNoNormalized);
}

function latestSourceRowsRemoveRequestedSupplier(
  rows: readonly G2bPublicStandardContractProjection[],
  knownGroupKeys: ReadonlySet<string>,
  requested: ReadonlySet<string>,
) {
  const rowsByGroup = new Map<string, G2bPublicStandardContractProjection[]>();
  for (const row of rows) {
    const key = sourceContractGroupKey(row);
    const group = rowsByGroup.get(key) ?? [];
    group.push(row);
    rowsByGroup.set(key, group);
  }
  return [...rowsByGroup.entries()].some(([key, latestRows]) =>
    knownGroupKeys.has(key)
    && !latestRows.some((row) => row.suppliers.some((supplier) => requested.has(supplier.businessNumber)))
  );
}

function compareSourceContractAmendments(
  left: G2bPublicStandardContractProjection,
  right: G2bPublicStandardContractProjection,
) {
  return (
    (right.amendmentOrder ?? -1) - (left.amendmentOrder ?? -1)
    || (right.contractDate ?? "").localeCompare(left.contractDate ?? "")
    || right.observationHash.localeCompare(left.observationHash)
  );
}

function sameSourceContractVersion(
  left: G2bPublicStandardContractProjection,
  right: G2bPublicStandardContractProjection,
) {
  return (
    (left.amendmentOrder ?? null) === (right.amendmentOrder ?? null)
    && left.contractDate === right.contractDate
  );
}

type StandardContractSupplier = ReturnType<typeof mapG2bPublicStandardContractRow>["suppliers"][number];
type AmountAttributionKind = NonNullable<CompetitorContractRow["amountAttribution"]>;

const SUPPLIER_AMOUNT_FIELDS = [
  "corpCntrctAmt",
  "supplierContractAmount",
  "participationAmount",
  "participAmt",
  "shareAmount",
  "cntrctAmt",
] as const;
const SUPPLIER_RATE_FIELDS = [
  "corpShareRate",
  "supplierRate",
  "participationRate",
  "participRate",
  "shareRate",
  "cntrctShrRt",
] as const;

function uniqueSuppliersByBusinessNumber(suppliers: readonly StandardContractSupplier[]) {
  const unique = new Map<string, StandardContractSupplier>();
  for (const supplier of suppliers) {
    const existing = unique.get(supplier.businessNumber);
    if (!existing || (!existing.businessName && supplier.businessName)) {
      unique.set(supplier.businessNumber, supplier);
    }
  }
  return [...unique.values()];
}

function attributeContractAmounts(
  suppliers: readonly StandardContractSupplier[],
  currentContractAmount: number,
  totalContractAmount: number,
) {
  const reportedAmounts = suppliers.map((supplier) => firstNonnegativeNumber(supplier.raw, SUPPLIER_AMOUNT_FIELDS));
  const allAmountsReported = reportedAmounts.every((amount): amount is number => amount !== null);
  if (allAmountsReported && reportedAmounts.reduce((sum, amount) => sum + amount, 0) <= totalContractAmount) {
    return attributionMap(
      suppliers,
      reportedAmounts,
      reportedAmounts.map((amount) => totalContractAmount > 0 ? currentContractAmount * amount / totalContractAmount : 0),
      "supplier-reported",
    );
  }

  const reportedRates = suppliers.map((supplier) => firstNonnegativeNumber(supplier.raw, SUPPLIER_RATE_FIELDS));
  const allRatesReported = reportedRates.every((rate): rate is number => rate !== null && rate <= 100);
  const rateTotal = allRatesReported ? reportedRates.reduce((sum, rate) => sum + rate, 0) : 0;
  if (allRatesReported && Math.abs(rateTotal - 100) < 0.001) {
    return attributionMap(
      suppliers,
      allocateByWeights(totalContractAmount, reportedRates),
      allocateByWeights(currentContractAmount, reportedRates),
      "supplier-rate",
    );
  }

  const kind: AmountAttributionKind = suppliers.length === 1 ? "full-contract" : "equal-share";
  const weights = suppliers.map(() => 1);
  return attributionMap(
    suppliers,
    allocateByWeights(totalContractAmount, weights),
    allocateByWeights(currentContractAmount, weights),
    kind,
  );
}

function attributionMap(
  suppliers: readonly StandardContractSupplier[],
  totals: readonly number[],
  currents: readonly number[],
  kind: AmountAttributionKind,
) {
  return new Map(suppliers.map((supplier, index) => [supplier.businessNumber, {
    total: totals[index] ?? 0,
    current: currents[index] ?? 0,
    kind,
  }]));
}

function allocateByWeights(amount: number, weights: readonly number[]) {
  if (weights.length === 0) return [];
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return weights.map(() => 0);
  if (!Number.isInteger(amount)) {
    const allocations = weights.map((weight) => amount * weight / weightTotal);
    allocations[0] += amount - allocations.reduce((sum, value) => sum + value, 0);
    return allocations;
  }
  const exact = weights.map((weight) => amount * weight / weightTotal);
  const allocations = exact.map(Math.floor);
  let remainder = amount - allocations.reduce((sum, value) => sum + value, 0);
  const byFraction = exact
    .map((value, index) => ({ fraction: value - Math.floor(value), index }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < byFraction.length && remainder > 0; index += 1, remainder -= 1) {
    allocations[byFraction[index]!.index] += 1;
  }
  return allocations;
}

function firstNonnegativeNumber(row: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) {
    const text = asText(row[field]);
    if (!text) continue;
    const value = Number(text.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export function normalizeCompetitorContractRowIdentity(row: CompetitorContractRow): CompetitorContractRow {
  const identity = competitorContractIdentity(row);
  const id = `competitor-contract:${COMPETITOR_CONTRACT_IDENTITY_VERSION}:${identity.kind}:${sha256(identity.parts)}`;
  return row.id === id ? row : { ...row, id };
}

function competitorContractIdentity(row: CompetitorContractRow) {
  const sourceAndBusiness = [canonicalText(row.sourceDataset), canonicalBusinessNumber(row.bizNoNormalized)];
  const observationFingerprint = sha256(fullRowIdentityParts(row));
  const contractNo = canonicalIdentifier(row.contractNo);
  if (contractNo) {
    return { kind: "contract-no", parts: [...sourceAndBusiness, contractNo, observationFingerprint] };
  }

  const noticeNo = canonicalIdentifier(row.noticeNo);
  if (noticeNo) {
    const detailDiscriminator = canonicalText(row.contractDetailUrl);
    if (detailDiscriminator) {
      return {
        kind: "notice-detail",
        parts: [...sourceAndBusiness, noticeNo, detailDiscriminator, observationFingerprint],
      };
    }
    return {
      kind: "notice-observation",
      parts: [...sourceAndBusiness, noticeNo, observationFingerprint],
    };
  }

  return {
    kind: "full-row",
    parts: [observationFingerprint],
  };
}

function fullRowIdentityParts(row: CompetitorContractRow) {
  return [
    canonicalText(row.sourceDataset),
    canonicalBusinessNumber(row.bizNoNormalized),
    canonicalText(row.bizNoDisplay),
    canonicalText(row.businessName),
    canonicalText(row.contractName),
    [...(row.itemNames ?? [])].map(canonicalText).filter(Boolean).sort(),
    uniqueItemCodes(row.itemCodes ?? []).sort(),
    canonicalText(row.contractDate),
    canonicalText(row.originalContractDate ?? null),
    row.amendmentOrder === undefined ? "" : canonicalNumber(row.amendmentOrder),
    canonicalNumber(row.currentContractAmount),
    canonicalNumber(row.totalContractAmount),
    row.contractTotalAmount === undefined ? "" : canonicalNumber(row.contractTotalAmount),
    canonicalText(row.amountAttribution ?? null),
    canonicalText(row.demandAgencyName),
    canonicalText(row.contractAgencyName),
    canonicalText(row.contractMethod),
    canonicalIdentifier(row.contractNo),
    canonicalIdentifier(row.noticeNo),
    canonicalText(row.contractDetailUrl),
    canonicalText(row.noticeDetailUrl),
  ];
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalText(value: string | null) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalIdentifier(value: string) {
  return canonicalText(value);
}

function canonicalBusinessNumber(value: string) {
  return value.replace(/\D/g, "") || canonicalIdentifier(value);
}

function canonicalNumber(value: number) {
  return Object.is(value, -0) ? "0" : String(value);
}

function compareContractRows(left: CompetitorContractRow, right: CompetitorContractRow) {
  return (right.contractDate ?? "").localeCompare(left.contractDate ?? "") || right.totalContractAmount - left.totalContractAmount;
}

function dedupeContractRows(rows: CompetitorContractRow[]) {
  const observationKeys = new Set<string>();
  const deduplicated: CompetitorContractRow[] = [];
  for (const row of rows) {
    const key = sha256(fullRowIdentityParts(row));
    if (observationKeys.has(key)) {
      continue;
    }
    observationKeys.add(key);
    deduplicated.push(row);
  }
  return deduplicated;
}

function finalizeCompetitorContractRows(rows: CompetitorContractRow[]) {
  const latestRows: CompetitorContractRow[] = [];
  const groups = new Map<string, CompetitorContractRow[]>();
  for (const row of dedupeContractRows(rows)) {
    const key = summaryContractIdentity(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const representative = [...group].sort(compareSummaryContractVersions)[0]!;
    latestRows.push(...group.filter((row) => sameLatestAmendmentPosition(row, representative)));
  }
  return latestRows
    .map(normalizeCompetitorContractRowIdentity)
    .sort(compareContractRows);
}

function sameLatestAmendmentPosition(left: CompetitorContractRow, right: CompetitorContractRow) {
  return (
    (left.amendmentOrder ?? null) === (right.amendmentOrder ?? null)
    && left.contractDate === right.contractDate
  );
}

const CACHED_CONTRACT_ROW_STRING_FIELDS = [
  "id",
  "bizNoNormalized",
  "bizNoDisplay",
  "businessName",
  "contractName",
  "demandAgencyName",
  "contractAgencyName",
  "contractMethod",
  "contractNo",
  "noticeNo",
  "contractDetailUrl",
  "noticeDetailUrl",
] as const;

export function normalizeCachedCompetitorContractSearchResult(
  value: unknown,
  requested: ReadonlySet<string>,
): CompetitorContractSearchResult | null {
  try {
    return normalizeCachedCompetitorContractSearchResultUnchecked(value, requested);
  } catch {
    return null;
  }
}

function normalizeCachedCompetitorContractSearchResultUnchecked(
  value: unknown,
  requested: ReadonlySet<string>,
): CompetitorContractSearchResult | null {
  const result = getRecord(value);
  if (!Array.isArray(result.rows)) {
    return null;
  }

  const rows: CompetitorContractRow[] = [];
  for (const valueRow of result.rows) {
    const row = normalizeCachedCompetitorContractRow(valueRow, requested);
    if (!row) {
      return null;
    }
    rows.push(row);
  }

  const normalizedRows = dedupeContractRows(rows)
    .map(normalizeCompetitorContractRowIdentity)
    .sort(compareContractRows);
  const fetchedAt = typeof result.fetchedAt === "string" && isIsoTimestamp(result.fetchedAt)
    ? result.fetchedAt
    : undefined;
  if (result.fetchedAt !== undefined && !fetchedAt) {
    return null;
  }
  return {
    ...(fetchedAt ? { fetchedAt } : {}),
    rows: normalizedRows,
    summary: summarizeCompetitorContractRows(normalizedRows),
    coverage: { complete: true, fresh: true, missingRanges: [] },
  };
}

function normalizeCachedCompetitorContractRow(
  value: unknown,
  requested: ReadonlySet<string>,
): CompetitorContractRow | null {
  const row = getRecord(value);
  if (CACHED_CONTRACT_ROW_STRING_FIELDS.some((field) => typeof row[field] !== "string")) {
    return null;
  }
  if (
    row.sourceDataset !== "g2b-public-standard-contract" ||
    (row.contractDate !== null && !isDashedCalendarDate(row.contractDate)) ||
    typeof row.currentContractAmount !== "number" ||
    !Number.isFinite(row.currentContractAmount) ||
    typeof row.totalContractAmount !== "number" ||
    !Number.isFinite(row.totalContractAmount) ||
    (row.contractTotalAmount !== undefined
      && (typeof row.contractTotalAmount !== "number" || !Number.isFinite(row.contractTotalAmount))) ||
    (row.amountAttribution !== undefined
      && !["full-contract", "supplier-reported", "supplier-rate", "equal-share"].includes(
        row.amountAttribution as string,
      )) ||
    (row.itemNames !== undefined && !isStringArray(row.itemNames)) ||
    (row.itemCodes !== undefined && !isStringArray(row.itemCodes)) ||
    (row.contractType !== undefined && typeof row.contractType !== "string") ||
    (row.originalContractDate !== undefined && !isDashedCalendarDate(row.originalContractDate)) ||
    (row.amendmentOrder !== undefined
      && (typeof row.amendmentOrder !== "number"
        || !Number.isSafeInteger(row.amendmentOrder)
        || row.amendmentOrder < 0))
  ) {
    return null;
  }

  const bizNoNormalized = canonicalBusinessNumber(row.bizNoNormalized as string);
  if (!requested.has(bizNoNormalized)) {
    return null;
  }
  const itemNames = uniqueNonemptyTexts((row.itemNames as string[] | undefined) ?? []);
  const itemCodes = uniqueItemCodes((row.itemCodes as string[] | undefined) ?? []);
  const contractType = typeof row.contractType === "string" ? row.contractType.trim() : "";
  const originalContractDate = row.originalContractDate as string | undefined;
  const amendmentOrder = row.amendmentOrder as number | undefined;
  const contractTotalAmount = row.contractTotalAmount as number | undefined;
  const amountAttribution = row.amountAttribution as CompetitorContractRow["amountAttribution"];
  const {
    itemNames: _itemNames,
    itemCodes: _itemCodes,
    contractType: _contractType,
    originalContractDate: _originalContractDate,
    amendmentOrder: _amendmentOrder,
    contractTotalAmount: _contractTotalAmount,
    amountAttribution: _amountAttribution,
    ...rowWithoutOptionalFields
  } = row;
  return {
    ...(rowWithoutOptionalFields as CompetitorContractRow),
    bizNoNormalized,
    ...(itemNames.length > 0 ? { itemNames } : {}),
    ...(itemCodes.length > 0 ? { itemCodes } : {}),
    ...(contractType ? { contractType } : {}),
    ...(originalContractDate ? { originalContractDate } : {}),
    ...(amendmentOrder === undefined ? {} : { amendmentOrder }),
    ...(contractTotalAmount === undefined ? {} : { contractTotalAmount }),
    ...(amountAttribution === undefined ? {} : { amountAttribution }),
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDashedCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function summarizeCompetitorContractRows(rows: CompetitorContractRow[]) {
  const groups = new Map<string, CompetitorContractRow[]>();
  for (const row of rows) {
    const key = summaryContractIdentity(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const notices = new Set<string>();
  let totalAmount = 0;
  let latestContractDate: string | null = null;
  for (const group of groups.values()) {
    const representative = [...group].sort(compareSummaryContractVersions)[0]!;
    const latestRows = group.filter((row) => sameSummaryContractVersion(row, representative));
    const attributedAmount = latestRows.reduce((sum, row) => sum + row.totalContractAmount, 0);
    const contractCeiling = representative.contractTotalAmount ?? attributedAmount;
    totalAmount += Math.min(attributedAmount, contractCeiling);
    if (representative.contractDate && (!latestContractDate || representative.contractDate > latestContractDate)) {
      latestContractDate = representative.contractDate;
    }
    for (const row of latestRows) {
      const notice = summaryNoticeIdentity(row);
      if (notice) notices.add(notice);
    }
  }
  return {
    contractCount: groups.size,
    totalAmount,
    noticeLinkedCount: notices.size,
    latestContractDate,
  };
}

function summaryContractIdentity(row: CompetitorContractRow) {
  const contractNo = canonicalIdentifier(row.contractNo);
  if (contractNo) return `contract:${contractNo}`;
  const noticeNo = canonicalIdentifier(row.noticeNo);
  const detailUrl = canonicalText(row.contractDetailUrl);
  if (noticeNo && detailUrl) return `notice-detail:${noticeNo}:${detailUrl}`;
  return `fallback:${sha256([
    canonicalText(row.contractName),
    canonicalText(row.demandAgencyName),
    canonicalText(row.contractAgencyName),
    canonicalText(row.originalContractDate ?? row.contractDate),
    detailUrl,
  ])}`;
}

function summaryNoticeIdentity(row: CompetitorContractRow) {
  const noticeNo = canonicalIdentifier(row.noticeNo);
  if (noticeNo) return `notice:${noticeNo}`;
  const detailUrl = canonicalText(row.noticeDetailUrl);
  return detailUrl ? `notice-url:${detailUrl}` : "";
}

function compareSummaryContractVersions(left: CompetitorContractRow, right: CompetitorContractRow) {
  return (
    (right.amendmentOrder ?? -1) - (left.amendmentOrder ?? -1)
    || (right.contractDate ?? "").localeCompare(left.contractDate ?? "")
    || (right.contractTotalAmount ?? right.totalContractAmount)
      - (left.contractTotalAmount ?? left.totalContractAmount)
  );
}

function sameSummaryContractVersion(left: CompetitorContractRow, right: CompetitorContractRow) {
  return (
    (left.amendmentOrder ?? null) === (right.amendmentOrder ?? null)
    && left.contractDate === right.contractDate
    && (left.contractTotalAmount ?? null) === (right.contractTotalAmount ?? null)
  );
}

function uniqueNonemptyTexts(values: unknown[]) {
  return [...new Set(values.map(asText).filter(Boolean))];
}

function isIsoTimestamp(value: string) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function uniqueItemCodes(values: unknown[]) {
  return [...new Set(values.map(asText).map((value) => value.replace(/\D/g, "")).filter((value) => value.length === 10))];
}

function formatBusinessNumber(value: string) {
  return `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}`;
}

function asText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
