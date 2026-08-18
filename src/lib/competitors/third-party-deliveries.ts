import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import {
  CompetitorContractConfigurationError,
  CompetitorContractInputError,
  CompetitorContractUpstreamError,
  type CompetitorContractCoverage,
  type CompetitorContractFetch,
  type CompetitorContractRow,
} from "./contracts";

const TARGET_DETAIL_PRODUCT_CODE = "3912180101";
const PAGE_SIZE = 999;
const ENDPOINT = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getSpcifyPrdlstPrcureInfoList";
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_VERSION = "v3";
const MONTH_FETCH_CONCURRENCY = 3;
const MAX_PROVIDER_PAGES = 1_000;

export type CompetitorThirdPartyDeliverySearchInput = {
  bizNos: string[];
  dateFrom: string;
  dateTo: string;
};

export type CompetitorThirdPartyDeliverySearchDeps = {
  serviceKey: string;
  fetchImpl?: CompetitorContractFetch;
  signal?: AbortSignal;
  sqlite?: Database.Database;
  cacheOnly?: boolean;
  now?: () => Date;
};

export type CompetitorThirdPartyDeliverySearchResult = {
  fetchedAt: string;
  rows: CompetitorContractRow[];
  coverage: CompetitorContractCoverage;
};

export async function searchCompetitorThirdPartyDeliveries(
  input: CompetitorThirdPartyDeliverySearchInput,
  deps: CompetitorThirdPartyDeliverySearchDeps,
): Promise<CompetitorThirdPartyDeliverySearchResult> {
  const registeredBizNos = new Set(input.bizNos.map(normalizeBusinessNumber));
  const dateFrom = parseDashedDate(input.dateFrom, "dateFrom");
  const dateTo = parseDashedDate(input.dateTo, "dateTo");
  if (dateFrom > dateTo) {
    throw new CompetitorContractInputError("dateFrom must be earlier than or equal to dateTo");
  }
  const now = (deps.now ?? (() => new Date()))();
  const ranges = deps.sqlite || deps.cacheOnly ? splitMonthlyRanges(dateFrom, dateTo) : [{ dateFrom, dateTo }];
  const registryKey = [...registeredBizNos].sort().join(",");
  const cached = deps.sqlite
    ? ranges.map((range) => ({ range, entry: readMonthlyCache(deps.sqlite!, registryKey, range, now) }))
    : [];
  const missingRanges = cached.flatMap(({ range, entry }) => missingRangeAfterCachedPrefix(range, entry));

  if (deps.cacheOnly) {
    const entries = cached.flatMap(({ entry }) => entry ? [entry] : []);
    const cacheMissingRanges = deps.sqlite ? missingRanges : ranges;
    return {
      fetchedAt: entries.map((entry) => entry.fetchedAt).sort().at(-1) ?? now.toISOString(),
      rows: entries.flatMap((entry) => entry.rows),
      coverage: {
        complete: cacheMissingRanges.length === 0,
        fresh: entries.length > 0 && entries.every((entry) => entry.fresh),
        missingRanges: cacheMissingRanges,
      },
    };
  }

  const plans = ranges.map((range) => {
    const entry = cached.find((candidate) => cacheRangeKey(candidate.range) === cacheRangeKey(range))?.entry ?? null;
    if (entry?.fresh && entry.dateTo >= range.dateTo) return { range, entry, fetchRange: null };
    if (entry?.fresh) {
      return {
        range,
        entry,
        fetchRange: { dateFrom: nextCalendarDate(entry.dateTo), dateTo: range.dateTo },
      };
    }
    return { range, entry, fetchRange: range };
  });
  const toFetch = plans.filter((plan): plan is typeof plan & { fetchRange: DateRange } => plan.fetchRange !== null);
  if (toFetch.length > 0 && !deps.serviceKey.trim()) throw new CompetitorContractConfigurationError();
  const fetchedResults = await mapWithConcurrency(toFetch, MONTH_FETCH_CONCURRENCY, async (plan) => ({
    plan,
    rows: await fetchDeliveryRows({
      dateFrom: plan.fetchRange.dateFrom,
      dateTo: plan.fetchRange.dateTo,
      serviceKey: deps.serviceKey.trim(),
      fetchImpl: deps.fetchImpl ?? fetch,
      signal: deps.signal,
      registeredBizNos,
    }),
  }));
  const fetchedByRange = new Map(fetchedResults.map((result) => [cacheRangeKey(result.plan.range), result]));
  const completedEntries: CachedMonthlyRows[] = [];
  for (const plan of plans) {
    const fetched = fetchedByRange.get(cacheRangeKey(plan.range));
    if (!fetched) {
      if (plan.entry) completedEntries.push(plan.entry);
      continue;
    }
    const rows = plan.entry?.fresh && fetched.plan.fetchRange.dateFrom > plan.range.dateFrom
      ? [...plan.entry.rows, ...fetched.rows]
      : fetched.rows;
    const cachedAtMs = plan.entry?.fresh && fetched.plan.fetchRange.dateFrom > plan.range.dateFrom
      ? plan.entry.cachedAtMs
      : now.getTime();
    const entry: CachedMonthlyRows = {
      dateFrom: plan.range.dateFrom,
      dateTo: plan.range.dateTo,
      fetchedAt: now.toISOString(),
      rows,
      fresh: true,
      cachedAtMs,
    };
    completedEntries.push(entry);
    if (deps.sqlite) {
      writeMonthlyCache(deps.sqlite, registryKey, plan.range, entry);
      deleteShorterMonthlyPrefixes(deps.sqlite, registryKey, plan.range);
    }
  }

  const rows = completedEntries.flatMap((entry) => entry.rows);
  const fetchedAt = completedEntries
    .map((entry) => entry.fetchedAt)
    .sort()
    .at(-1) ?? now.toISOString();

  return { fetchedAt, rows, coverage: { complete: true, fresh: true, missingRanges: [] } };
}

type DateRange = { dateFrom: string; dateTo: string };
type CachedMonthlyRows = DateRange & {
  fetchedAt: string;
  rows: CompetitorContractRow[];
  fresh: boolean;
  cachedAtMs: number;
};

function fetchDeliveryRows(input: {
  dateFrom: string;
  dateTo: string;
  serviceKey: string;
  fetchImpl: CompetitorContractFetch;
  signal?: AbortSignal;
  registeredBizNos: ReadonlySet<string>;
}) {
  return fetchDeliveryRowsPages(input, 1, [], 0, null);
}

async function fetchDeliveryRowsPages(
  input: Parameters<typeof fetchDeliveryRows>[0],
  pageNo: number,
  rows: CompetitorContractRow[],
  receivedRowCount: number,
  expectedTotalCount: number | null,
): Promise<CompetitorContractRow[]> {
  if (pageNo > MAX_PROVIDER_PAGES) {
    throw new CompetitorContractUpstreamError(
      "G2B delivery request search exceeded the 1,000-page safety limit",
      "response",
    );
  }
  throwIfAborted(input.signal);
  const page = await fetchDeliveryPage({ ...input, pageNo });
  const totalCount = expectedTotalCount ?? page.totalCount;
  const nextReceivedRowCount = receivedRowCount + page.items.length;
  if (page.items.length === 0 && nextReceivedRowCount < totalCount) {
    throw new CompetitorContractUpstreamError("G2B delivery request search ended before totalCount was reached", "incomplete");
  }
  for (const sourceRow of page.items) {
    const mapped = mapDeliveryRow(sourceRow, input.registeredBizNos);
    if (mapped?.contractDate && mapped.contractDate >= input.dateFrom && mapped.contractDate <= input.dateTo) {
      rows.push(mapped);
    }
  }
  return nextReceivedRowCount >= totalCount
    ? rows
    : fetchDeliveryRowsPages(input, pageNo + 1, rows, nextReceivedRowCount, totalCount);
}

function readMonthlyCache(
  sqlite: Database.Database,
  registryKey: string,
  range: DateRange,
  now: Date,
): CachedMonthlyRows | null {
  const storedRows = sqlite.prepare(`
    SELECT date_from, date_to, result_json, cached_at_ms, result_version
    FROM competitor_third_party_delivery_monthly_cache
    WHERE registry_key = ? AND date_from = ?
    ORDER BY date_to DESC
  `).all(registryKey, range.dateFrom) as Array<{
    date_from: string;
    date_to: string;
    result_json: string;
    cached_at_ms: number;
    result_version: string;
  }>;
  const candidates: CachedMonthlyRows[] = [];
  for (const stored of storedRows) {
    if (stored.result_version !== CACHE_VERSION) {
      deleteMonthlyCacheRow(sqlite, registryKey, stored.date_from, stored.date_to);
      continue;
    }
    try {
      const result = JSON.parse(stored.result_json) as Partial<CachedMonthlyRows>;
      if (!Array.isArray(result.rows) || typeof result.fetchedAt !== "string") throw new Error("invalid cached result");
      candidates.push({
        dateFrom: stored.date_from,
        dateTo: stored.date_to,
        fetchedAt: result.fetchedAt,
        rows: result.rows.filter((row) => row.contractDate !== null && row.contractDate >= range.dateFrom && row.contractDate <= range.dateTo),
        fresh: stored.cached_at_ms > now.getTime() - CACHE_TTL_MS,
        cachedAtMs: stored.cached_at_ms,
      });
    } catch {
      deleteMonthlyCacheRow(sqlite, registryKey, stored.date_from, stored.date_to);
    }
  }
  const covering = candidates.filter((entry) => entry.dateTo >= range.dateTo).sort((left, right) => left.dateTo.localeCompare(right.dateTo));
  return covering[0] ?? candidates[0] ?? null;
}

function writeMonthlyCache(
  sqlite: Database.Database,
  registryKey: string,
  range: DateRange,
  entry: CachedMonthlyRows,
) {
  sqlite.prepare(`
    INSERT INTO competitor_third_party_delivery_monthly_cache
      (registry_key, date_from, date_to, result_json, cached_at_ms, result_version)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (registry_key, date_from, date_to) DO UPDATE SET
      result_json = excluded.result_json,
      cached_at_ms = excluded.cached_at_ms,
      result_version = excluded.result_version
  `).run(registryKey, range.dateFrom, range.dateTo, JSON.stringify(entry), entry.cachedAtMs, CACHE_VERSION);
}

function deleteShorterMonthlyPrefixes(sqlite: Database.Database, registryKey: string, range: DateRange) {
  sqlite.prepare(`
    DELETE FROM competitor_third_party_delivery_monthly_cache
    WHERE registry_key = ? AND date_from = ? AND date_to < ?
  `).run(registryKey, range.dateFrom, range.dateTo);
}

function deleteMonthlyCacheRow(sqlite: Database.Database, registryKey: string, dateFrom: string, dateTo: string) {
  sqlite.prepare(`
    DELETE FROM competitor_third_party_delivery_monthly_cache
    WHERE registry_key = ? AND date_from = ? AND date_to = ?
  `).run(registryKey, dateFrom, dateTo);
}

export function deleteCompetitorThirdPartyDeliveryCacheInRange(
  sqlite: Database.Database,
  registryKey: string,
  dateFrom: string,
  dateTo: string,
): number {
  const from = parseDashedDate(dateFrom, "dateFrom");
  const to = parseDashedDate(dateTo, "dateTo");
  if (from > to) {
    throw new CompetitorContractInputError("dateFrom must be earlier than or equal to dateTo");
  }
  const result = sqlite.prepare(`
    DELETE FROM competitor_third_party_delivery_monthly_cache
    WHERE registry_key = ? AND date_from <= ? AND date_to >= ?
  `).run(registryKey, to, from);
  return Number(result.changes);
}

function missingRangeAfterCachedPrefix(range: DateRange, entry: CachedMonthlyRows | null): DateRange[] {
  if (!entry) return [range];
  if (entry.dateTo >= range.dateTo) return [];
  return [{ dateFrom: nextCalendarDate(entry.dateTo), dateTo: range.dateTo }];
}

function nextCalendarDate(value: string) {
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

function splitMonthlyRanges(dateFrom: string, dateTo: string): DateRange[] {
  const ranges: DateRange[] = [];
  let cursor = dateFrom;
  while (cursor <= dateTo) {
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const range: DateRange = { dateFrom: cursor, dateTo: monthEnd < dateTo ? monthEnd : dateTo };
    ranges.push(range);
    if (range.dateTo === dateTo) break;
    const next = new Date(`${range.dateTo}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return ranges;
}

function cacheRangeKey(range: DateRange) {
  return `${range.dateFrom}:${range.dateTo}`;
}

async function fetchDeliveryPage(input: {
  dateFrom: string;
  dateTo: string;
  pageNo: number;
  serviceKey: string;
  fetchImpl: CompetitorContractFetch;
  signal?: AbortSignal;
}) {
  const url = new URL(ENDPOINT);
  const params = new URLSearchParams({
    type: "json",
    pageNo: String(input.pageNo),
    numOfRows: String(PAGE_SIZE),
    inqryDiv: "1",
    inqryBgnDate: input.dateFrom.replaceAll("-", ""),
    inqryEndDate: input.dateTo.replaceAll("-", ""),
    inqryPrdctDiv: "2",
    dtilPrdctClsfcNo: TARGET_DETAIL_PRODUCT_CODE,
    fnlCntrctDlvrReqChgOrdYn: "Y",
  });
  const serviceKey = input.serviceKey.includes("%") ? input.serviceKey : encodeURIComponent(input.serviceKey);
  url.search = `${params.toString()}&serviceKey=${serviceKey}`;

  let response: Response;
  try {
    response = await input.fetchImpl(url, { signal: input.signal });
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("The request was aborted", "AbortError");
    throw new CompetitorContractUpstreamError(
      error instanceof Error ? error.message : "G2B delivery request search failed",
      "temporary",
    );
  }
  if (!response.ok) {
    throw new CompetitorContractUpstreamError(
      `G2B delivery request search returned HTTP ${response.status}`,
      response.status >= 500 || response.status === 429 ? "temporary" : "response",
      undefined,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CompetitorContractUpstreamError("G2B delivery request search returned invalid JSON", "response");
  }
  return parseDeliveryPage(payload);
}

function parseDeliveryPage(payload: unknown) {
  const response = record(payload).response;
  const envelope = record(response);
  const header = record(envelope.header);
  if (asText(header.resultCode) !== "00") {
    throw new CompetitorContractUpstreamError(
      asText(header.resultMsg) || "G2B delivery request search returned an invalid result code",
      "response",
      asText(header.resultCode) || undefined,
    );
  }
  const body = record(envelope.body);
  const totalCount = Number(asText(body.totalCount));
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new CompetitorContractUpstreamError("G2B delivery request search returned an invalid totalCount", "response");
  }
  const itemsValue = record(body.items).item ?? body.items ?? [];
  const items = (Array.isArray(itemsValue) ? itemsValue : [itemsValue]).map(record).filter((item) => Object.keys(item).length > 0);
  return { totalCount, items };
}

function mapDeliveryRow(row: Record<string, unknown>, registeredBizNos: ReadonlySet<string>): CompetitorContractRow | null {
  const bizNoNormalized = normalizeDigits(row.bizno ?? row.cntrctCorpBizno);
  if (!registeredBizNos.has(bizNoNormalized)) return null;
  if (normalizeText(row.dtilPrdctClsfcNo) !== TARGET_DETAIL_PRODUCT_CODE) return null;
  if (normalizeText(row.cntrctDivNm) !== "제3자단가계약") return null;
  if (normalizeText(row.cntrctDlvrDivNm) !== "납품요구") return null;
  if (normalizeText(row.fnlCntrctDlvrReqChgOrdYn).toUpperCase() !== "Y") return null;

  const contractDate = normalizeDate(row.cntrctDlvrReqDate);
  const contractNo = asText(row.cntrctDlvrReqNo);
  const amount = parseAmount(row.prdctAmt);
  if (!contractDate || !contractNo || amount === null) return null;

  const businessName = asText(row.corpNm) || bizNoNormalized;
  const contractName = asText(row.cntrctDlvrReqNm) || "제3자단가계약 납품요구";
  const sourceIdentity = [bizNoNormalized, contractNo, asText(row.cntrctDlvrReqChgOrd), asText(row.prdctIdntNo), contractDate, amount].join(":");
  return {
    id: `competitor-third-party-delivery:${createHash("sha256").update(sourceIdentity).digest("hex")}`,
    bizNoNormalized,
    bizNoDisplay: formatBusinessNumber(bizNoNormalized),
    businessName,
    contractName,
    itemCodes: [TARGET_DETAIL_PRODUCT_CODE],
    contractDate,
    currentContractAmount: amount,
    totalContractAmount: amount,
    demandAgencyName: asText(row.dminsttNm),
    contractAgencyName: "",
    contractMethod: "제3자단가계약",
    contractType: "제3자단가계약",
    contractNo,
    noticeNo: asText(row.uprcCntrctNo),
    contractDetailUrl: "",
    noticeDetailUrl: "",
    sourceDataset: "g2b-shopping-mall-third-party-delivery",
  };
}

function parseDashedDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || normalizeDate(value) !== value) {
    throw new CompetitorContractInputError(`${field} must be YYYY-MM-DD`);
  }
  return value;
}

function normalizeBusinessNumber(value: string) {
  const normalized = normalizeDigits(value);
  if (normalized.length !== 10) throw new CompetitorContractInputError("each bizNo must contain 10 digits");
  return normalized;
}

function normalizeDigits(value: unknown) {
  return asText(value).replace(/\D/g, "");
}

function normalizeText(value: unknown) {
  return asText(value).normalize("NFKC").replace(/\s+/g, "");
}

function normalizeDate(value: unknown) {
  const compact = asText(value).replace(/\D/g, "");
  if (!/^\d{8}$/.test(compact)) return "";
  const dashed = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
  const date = new Date(`${dashed}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === dashed ? dashed : "";
}

function parseAmount(value: unknown) {
  const text = asText(value).replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const amount = Math.round(Number(text));
  return Number.isSafeInteger(amount) ? amount : null;
}

function formatBusinessNumber(value: string) {
  return `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}`;
}

function asText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The request was aborted", "AbortError");
}
