import type Database from "better-sqlite3";
import type { CompetitorContractFetch, CompetitorContractRow } from "./contracts";

const ENDPOINT =
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThngPurchsObjPrdct";
const CACHE_TABLE = "competitor_purchase_target_cache";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENCY = 4;
const SEP = "\u0000";
const DEFAULT_ORDER = "000";

function normalizeTenDigits(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^0-9]/g, "");
  return digits.length === 10 ? digits : null;
}

export function buildG2bPurchaseTargetProductsUrl({
  serviceKey,
  bidNtceNo,
  bidNtceOrd,
}: {
  serviceKey: string;
  bidNtceNo: string;
  bidNtceOrd: string;
}): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("inqryDiv", "2");
  url.searchParams.set("bidNtceNo", bidNtceNo);
  url.searchParams.set("bidNtceOrd", bidNtceOrd);
  url.searchParams.set("numOfRows", "999");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("type", "json");
  url.searchParams.set("serviceKey", serviceKey);
  return url;
}

function extractItems(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const response = (body as Record<string, unknown>).response;
  if (!response || typeof response !== "object") return [];
  const bodyObj = (response as Record<string, unknown>).body;
  if (!bodyObj || typeof bodyObj !== "object") return [];
  const container = (bodyObj as Record<string, unknown>).items;
  if (!container) return [];
  if (Array.isArray(container)) return container;
  if (typeof container !== "object") return [];
  const inner = (container as Record<string, unknown>).item;
  if (Array.isArray(inner)) return inner;
  if (inner) return [inner];
  return [container];
}

export async function fetchG2bPurchaseTargetItemCodes({
  serviceKey,
  bidNtceNo,
  bidNtceOrd,
  fetchImpl,
  signal,
  timeoutMs,
}: {
  serviceKey: string;
  bidNtceNo: string;
  bidNtceOrd: string;
  fetchImpl?: CompetitorContractFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string[]> {
  const url = buildG2bPurchaseTargetProductsUrl({
    serviceKey,
    bidNtceNo,
    bidNtceOrd,
  });
  const f = fetchImpl ?? (fetch as CompetitorContractFetch);
  let response: Response;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    const localController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onExternalAbort = () => {
      if (!localController.signal.aborted) {
        localController.abort();
      }
    };
    if (signal) {
      if (signal.aborted) {
        localController.abort();
      } else {
        signal.addEventListener("abort", onExternalAbort);
      }
    }
    try {
      timer = setTimeout(() => {
        if (!localController.signal.aborted) {
          localController.abort();
        }
      }, timeoutMs);
      response = await f(url.toString(), { signal: localController.signal });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onExternalAbort);
      }
    }
  } else {
    response = await f(url.toString(), { signal });
  }
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} fetching purchase target products for ${bidNtceNo}/${bidNtceOrd}`,
    );
  }
  const body = (await response.json()) as {
    response?: {
      header?: { resultCode?: unknown; resultMsg?: unknown };
    };
  };
  const header = body.response?.header;
  if (header?.resultCode !== "00" && header?.resultCode !== "0") {
    throw new Error(
      `G2B API error ${String(header?.resultCode ?? "unknown")}: ${String(header?.resultMsg ?? "unknown error")}`,
    );
  }
  const items = extractItems(body);
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const code = normalizeTenDigits(
      (item as Record<string, unknown>).dtilPrdctClsfcNo,
    );
    if (code) seen.add(code);
  }
  return Array.from(seen);
}

function extractOrderFromUrl(
  raw: string | undefined,
  fallback = DEFAULT_ORDER,
): string {
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    return parsed.searchParams.get("bidPbancOrd") ?? fallback;
  } catch {
    return fallback;
  }
}

interface CacheRow {
  item_codes_json: string;
  cached_at_ms: number;
}

function ensureCacheTable(sqlite: Database.Database): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (
      notice_no TEXT NOT NULL,
      notice_order TEXT NOT NULL,
      item_codes_json TEXT NOT NULL,
      cached_at_ms INTEGER NOT NULL,
      PRIMARY KEY (notice_no, notice_order)
    )`,
  );
}

function deleteCacheRow(
  sqlite: Database.Database,
  noticeNo: string,
  noticeOrder: string,
): void {
  sqlite
    .prepare(
      `DELETE FROM ${CACHE_TABLE} WHERE notice_no = ? AND notice_order = ?`,
    )
    .run(noticeNo, noticeOrder);
}

function readCache(
  sqlite: Database.Database,
  noticeNo: string,
  noticeOrder: string,
): { codes: string[]; cachedAtMs: number } | null {
  const row = sqlite
    .prepare(
      `SELECT item_codes_json, cached_at_ms FROM ${CACHE_TABLE}
       WHERE notice_no = ? AND notice_order = ?`,
    )
    .get(noticeNo, noticeOrder) as CacheRow | undefined;
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.item_codes_json);
  } catch {
    deleteCacheRow(sqlite, noticeNo, noticeOrder);
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((c) => typeof c === "string")
  ) {
    deleteCacheRow(sqlite, noticeNo, noticeOrder);
    return null;
  }
  return { codes: parsed, cachedAtMs: row.cached_at_ms };
}

function writeCache(
  sqlite: Database.Database,
  noticeNo: string,
  noticeOrder: string,
  codes: string[],
  cachedAtMs: number,
): void {
  sqlite
    .prepare(
      `INSERT INTO ${CACHE_TABLE}
         (notice_no, notice_order, item_codes_json, cached_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(notice_no, notice_order) DO UPDATE SET
         item_codes_json = excluded.item_codes_json,
         cached_at_ms = excluded.cached_at_ms`,
    )
    .run(noticeNo, noticeOrder, JSON.stringify(codes), cachedAtMs);
}

function mergeCodes(existing: readonly string[], fetched: readonly string[]): string[] {
  return [...new Set([...existing, ...fetched])];
}

export async function enrichCompetitorStandardContractItemCodes(
  rows: CompetitorContractRow[],
  {
    serviceKey,
    sqlite,
    fetchImpl,
    signal,
    cacheOnly = false,
    now = () => new Date(),
    timeBudgetMs = 20000,
  }: {
    serviceKey: string;
    sqlite: Database.Database;
    fetchImpl?: CompetitorContractFetch;
    signal?: AbortSignal;
    cacheOnly?: boolean;
    now?: () => Date;
    timeBudgetMs?: number;
  },
): Promise<CompetitorContractRow[]> {
  const nowMs = now().getTime();
  ensureCacheTable(sqlite);
  const groups = new Map<string, CompetitorContractRow[]>();
  const existingCodesByKey = new Map<string, string[]>();
  for (const row of rows) {
    if (row.sourceDataset !== "g2b-public-standard-contract") continue;
    const noticeNo = row.noticeNo;
    if (!noticeNo) continue;
    const order = extractOrderFromUrl(row.noticeDetailUrl);
    const key = noticeNo + SEP + order;
    existingCodesByKey.set(
      key,
      mergeCodes(existingCodesByKey.get(key) ?? [], row.itemCodes ?? []),
    );
    if (row.itemCodes !== undefined && row.itemCodes.length > 0) continue;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }
  const keys = [...groups.keys()];
  if (keys.length === 0) return rows;

  let cursor = 0;
  const itemCodesByKey = new Map<string, string[]>();
  const budgetController = new AbortController();
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budgetStartedAt = Date.now();
  let stopped = false;
  const onBudgetAbort = () => {
    if (!budgetController.signal.aborted) {
      budgetController.abort();
    }
    stopped = true;
  };
  if (signal) {
    if (signal.aborted) {
      onBudgetAbort();
    } else {
      signal.addEventListener("abort", onBudgetAbort);
    }
  }
  budgetTimer = setTimeout(() => {
    onBudgetAbort();
  }, timeBudgetMs);
  const worker = async (): Promise<void> => {
    while (true) {
      if (stopped) return;
      const idx = cursor++;
      if (idx >= keys.length) return;
      const key = keys[idx];
      const sepIdx = key.indexOf(SEP);
      const noticeNo = key.slice(0, sepIdx);
      const order = key.slice(sepIdx + 1);
      const existingCodes = existingCodesByKey.get(key) ?? [];
      const cached = readCache(sqlite, noticeNo, order);
      const fresh = cached ? nowMs - cached.cachedAtMs < TTL_MS : false;
      if (cached && (fresh || cacheOnly)) {
        const merged = mergeCodes(existingCodes, cached.codes);
        if (merged.length > 0) itemCodesByKey.set(key, merged);
        continue;
      }
      if (cacheOnly || !serviceKey) continue;
      const remaining = timeBudgetMs - (Date.now() - budgetStartedAt);
      if (remaining <= 0) {
        onBudgetAbort();
        return;
      }
      try {
        const codes = await fetchG2bPurchaseTargetItemCodes({
          serviceKey,
          bidNtceNo: noticeNo,
          bidNtceOrd: order,
          fetchImpl,
          signal: budgetController.signal,
          timeoutMs: Math.min(10000, remaining),
        });
        writeCache(sqlite, noticeNo, order, codes, nowMs);
        const merged = mergeCodes(existingCodes, codes);
        if (merged.length > 0) itemCodesByKey.set(key, merged);
      } catch {
        // upstream failure: row unchanged, no cache write
      }
    }
  };

  const count = Math.min(MAX_CONCURRENCY, keys.length);
  try {
    await Promise.all(Array.from({ length: count }, () => worker()));
  } finally {
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
    if (signal) {
      signal.removeEventListener("abort", onBudgetAbort);
    }
  }
  return rows.map((row) => {
    if (row.sourceDataset !== "g2b-public-standard-contract") return row;
    if (row.itemCodes !== undefined && row.itemCodes.length > 0) return row;
    if (!row.noticeNo) return row;
    const key = row.noticeNo + SEP + extractOrderFromUrl(row.noticeDetailUrl);
    const itemCodes = itemCodesByKey.get(key);
    return itemCodes && itemCodes.length > 0 ? { ...row, itemCodes } : row;
  });
}
