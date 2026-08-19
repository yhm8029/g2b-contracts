import type Database from "better-sqlite3";
import type { CompetitorContractFetch, CompetitorContractRow } from "./contracts";

const ENDPOINT =
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThngPurchsObjPrdct";
const CACHE_TABLE = "competitor_purchase_target_cache";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENCY = 4;
const SEP = "\u0000";
const DEFAULT_ORDER = "000";

export interface CompetitorItemEnrichmentResult {
  rows: CompetitorContractRow[];
  complete: boolean;
  unresolvedCount: number;
}

const G2B_CONTRACT_SEARCH_ENDPOINT = "https://apis.data.go.kr/1230000/ao/CntrctInfoService/getCntrctInfoListThngPPSSrch",
  G2B_CONTRACT_DETAIL_ENDPOINT = "https://apis.data.go.kr/1230000/ao/CntrctInfoService/getCntrctInfoListThngDetail",
  G2B_TARGET_PRODUCT_CLASS = "39121801",
  G2B_CANONICAL_DETAILED_CLASS = "3912180101";

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

function parseDecisionContractNumber(contractDetailUrl?: string): string | null {
  if (!contractDetailUrl) return null;
  const queryIndex = contractDetailUrl.indexOf("?");
  if (queryIndex < 0) return null;
  const params = new URLSearchParams(contractDetailUrl.slice(queryIndex + 1));
  const ctrtNo = params.get("ctrtNo")?.trim();
  if (!ctrtNo) return null;
  const order = params.get("ctrtChgOrd")?.trim() || "00";
  return ctrtNo + order;
}

async function fetchG2bJson(url: string, fetchImpl: CompetitorContractFetch, signal?: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`G2B request failed: ${response.status}`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  const responseObj = body?.response as Record<string, unknown> | undefined;
  const header = responseObj?.header as Record<string, unknown> | undefined;
  const resultCode = header?.resultCode;
  if (resultCode !== "00" && resultCode !== "0") {
    throw new Error(`G2B API resultCode: ${String(resultCode)}`);
  }
  return body;
}

async function fetchG2bContractItemCodes(params: {
  serviceKey: string;
  dcsnCntrctNo: string;
  fetchImpl: CompetitorContractFetch;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { serviceKey, dcsnCntrctNo, fetchImpl, signal } = params;
  const searchUrl = new URL(G2B_CONTRACT_SEARCH_ENDPOINT);
  searchUrl.searchParams.set("inqryDiv", "2");
  searchUrl.searchParams.set("dcsnCntrctNo", dcsnCntrctNo);
  searchUrl.searchParams.set("numOfRows", "100");
  searchUrl.searchParams.set("pageNo", "1");
  searchUrl.searchParams.set("type", "json");
  searchUrl.searchParams.set("serviceKey", serviceKey);
  const searchBody = await fetchG2bJson(searchUrl.toString(), fetchImpl, signal);
  const searchItems = extractItems(searchBody);
  if (searchItems.length === 0) {
    throw new Error(
      "G2B contract search returned no matching contract; treating as transient upstream replication lag",
    );
  }
  const untyIds = new Set<string>();
  for (const raw of searchItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const value = typeof item?.untyCntrctNo === "string" ? item.untyCntrctNo.trim() : "";
    if (value) untyIds.add(value);
  }
  const canonicalCodes = new Set<string>();
  for (const untyCntrctNo of untyIds) {
    const detailUrl = new URL(G2B_CONTRACT_DETAIL_ENDPOINT);
    detailUrl.searchParams.set("inqryDiv", "2");
    detailUrl.searchParams.set("untyCntrctNo", untyCntrctNo);
    detailUrl.searchParams.set("numOfRows", "999");
    detailUrl.searchParams.set("pageNo", "1");
    detailUrl.searchParams.set("type", "json");
    detailUrl.searchParams.set("serviceKey", serviceKey);
    const detailBody = await fetchG2bJson(detailUrl.toString(), fetchImpl, signal);
    const detailItems = extractItems(detailBody);
    for (const raw of detailItems) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const digits = typeof item?.prdctClsfcNo === "string" ? item.prdctClsfcNo.replace(/\D/g, "") : "";
      if (digits.length === 8 && digits === G2B_TARGET_PRODUCT_CLASS) {
        canonicalCodes.add(G2B_CANONICAL_DETAILED_CLASS);
      }
    }
  }
  return [...canonicalCodes];
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
): Promise<CompetitorItemEnrichmentResult> {
  const nowMs = now().getTime();
  ensureCacheTable(sqlite);
  const groups = new Map<string, { descriptor: { kind: "notice"; noticeNo: string; order: string } | { kind: "contract"; dcsn: string }; rows: CompetitorContractRow[] }>();
  const existingCodesByKey = new Map<string, string[]>();
  let unresolvedCount = 0;
  for (const row of rows) {
    if (row.sourceDataset !== "g2b-public-standard-contract") continue;
    if (row.itemCodes !== undefined && row.itemCodes.length > 0) continue;
    let key: string;
    let descriptor: { kind: "notice"; noticeNo: string; order: string } | { kind: "contract"; dcsn: string };
    if (row.noticeNo) {
      const order = extractOrderFromUrl(row.noticeDetailUrl);
      key = row.noticeNo + SEP + order;
      descriptor = { kind: "notice", noticeNo: row.noticeNo, order };
    } else {
      const dcsn = parseDecisionContractNumber(row.contractDetailUrl);
      if (!dcsn) {
        unresolvedCount++;
        continue;
      }
      key = `contract:${dcsn}${SEP}000`;
      descriptor = { kind: "contract", dcsn };
    }
    existingCodesByKey.set(
      key,
      mergeCodes(existingCodesByKey.get(key) ?? [], row.itemCodes ?? []),
    );
    const existing = groups.get(key);
    if (existing) existing.rows.push(row);
    else groups.set(key, { descriptor, rows: [row] });
  }
  const keys = [...groups.keys()];
  if (keys.length === 0) {
    return { rows, complete: unresolvedCount === 0, unresolvedCount };
  }

  let cursor = 0;
  const itemCodesByKey = new Map<string, string[]>();
  const resolvedKeys = new Set<string>();
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
  if (timeBudgetMs <= 0) {
    onBudgetAbort();
  } else {
    budgetTimer = setTimeout(() => {
      onBudgetAbort();
    }, timeBudgetMs);
  }
  const worker = async (): Promise<void> => {
    while (true) {
      if (stopped) return;
      const idx = cursor++;
      if (idx >= keys.length) return;
      const key = keys[idx];
      const { descriptor } = groups.get(key)!;
      const existingCodes = existingCodesByKey.get(key) ?? [];
      const cached = descriptor.kind === "notice"
        ? readCache(sqlite, descriptor.noticeNo, descriptor.order)
        : readCache(sqlite, `contract:${descriptor.dcsn}`, "000");
      const fresh = cached ? nowMs - cached.cachedAtMs < TTL_MS : false;
      if (cached && (fresh || cacheOnly)) {
        const merged = mergeCodes(existingCodes, cached.codes);
        if (merged.length > 0) itemCodesByKey.set(key, merged);
        resolvedKeys.add(key);
        continue;
      }
      if (cacheOnly || !serviceKey) continue;
      const remaining = timeBudgetMs - (Date.now() - budgetStartedAt);
      if (remaining <= 0) {
        onBudgetAbort();
        return;
      }
      try {
        let codes: string[];
        if (descriptor.kind === "notice") {
          codes = await fetchG2bPurchaseTargetItemCodes({
            serviceKey,
            bidNtceNo: descriptor.noticeNo,
            bidNtceOrd: descriptor.order,
            fetchImpl,
            signal: budgetController.signal,
            timeoutMs: Math.min(10000, remaining),
          });
          writeCache(sqlite, descriptor.noticeNo, descriptor.order, codes, nowMs);
        } else {
          codes = await fetchG2bContractItemCodes({
            serviceKey,
            dcsnCntrctNo: descriptor.dcsn,
            fetchImpl: fetchImpl ?? (fetch as CompetitorContractFetch),
            signal: budgetController.signal,
          });
          writeCache(sqlite, `contract:${descriptor.dcsn}`, "000", codes, nowMs);
        }
        const merged = mergeCodes(existingCodes, codes);
        if (merged.length > 0) itemCodesByKey.set(key, merged);
        resolvedKeys.add(key);
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
  // count unresolved groups
  for (const [key, group] of groups) {
    if (!resolvedKeys.has(key)) {
      unresolvedCount += group.rows.length;
    }
  }
  const resultRows = rows.map((row) => {
    if (row.itemCodes !== undefined && row.itemCodes.length > 0) return row;
    if (row.sourceDataset !== "g2b-public-standard-contract") return row;
    let key: string;
    if (row.noticeNo) {
      const order = extractOrderFromUrl(row.noticeDetailUrl);
      key = row.noticeNo + SEP + order;
    } else {
      const dcsn = parseDecisionContractNumber(row.contractDetailUrl);
      if (!dcsn) return row;
      key = `contract:${dcsn}${SEP}000`;
    }
    const codes = itemCodesByKey.get(key);
    return codes && codes.length > 0 ? { ...row, itemCodes: codes } : row;
  });
  return { rows: resultRows, complete: unresolvedCount === 0, unresolvedCount };
}
