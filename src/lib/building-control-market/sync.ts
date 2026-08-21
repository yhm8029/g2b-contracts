import type Database from "better-sqlite3";

import {
  collapseNoticeWinner,
  collectAwardRegistration,
  isFinalAwardOnOrAfter,
  type AwardRegistrationBatch,
  type AwardResultRow,
} from "@/lib/building-control/g2b/award-client";
import { fetchG2bJson } from "@/lib/g2b/http";
import {
  replaceMarketAwards,
  replaceMarketContracts,
  setMarketSyncState,
  upsertMarketAwards,
  upsertMarketContracts,
  type StoredMarketAward,
  type StoredMarketContract,
} from "./store";

const GOODS_BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const CONTRACT_BASE = "https://apis.data.go.kr/1230000/ao/PubDataOpnStdService";
const SHOPPING_MALL_BASE = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService";
const PAGE_SIZE = 999;
const TARGET_DETAIL_CODE = "3912180101";
const CONTRACT_KEYWORDS = ["\uC790\uB3D9\uC81C\uC5B4"];
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;
const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

type TargetNotice = {
  noticeNo: string;
  noticeOrder: string;
  noticeName: string;
  demandAgencyName: string | null;
  sourceUrl: string | null;
};

export async function syncMarketData(db: Database.Database, now = new Date()) {
  setMarketSyncState(db, "syncing", "\uB098\uB77C\uC7A5\uD130 \uB370\uC774\uD130\uB97C \uC870\uD68C\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4.");
  try {
    const notices = await collectTargetNotices(now);
    const { awards, unresolvedCount } = await collectTargetAwards(
      notices,
      now,
      (chunk) => upsertMarketAwards(db, chunk),
    );
    replaceMarketAwards(db, awards);
    const contracts = await collectTargetContracts(
      notices,
      now,
      (chunk) => upsertMarketContracts(db, chunk),
    );
    replaceMarketContracts(db, contracts);
    const lastSyncedAt = new Date().toISOString();
    setMarketSyncState(
      db,
      "ready",
      `\uB3D9\uAE30\uD654 \uC644\uB8CC: \uB300\uC0C1 \uACF5\uACE0 ${notices.length}\uAC74, \uB099\uCC30 ${awards.length}\uAC74, \uACC4\uC57D ${contracts.length}\uAC74`,
      lastSyncedAt,
    );
    return {
      noticeCount: notices.length,
      awardCount: awards.length,
      contractCount: contracts.length,
      unresolvedCount,
      lastSyncedAt,
    };
  } catch (error) {
    setMarketSyncState(db, "failed", "동기화가 중단되었습니다. 중단 전까지 수집한 데이터는 저장했습니다.");
    throw error;
  }
}

async function collectTargetNotices(now: Date) {
  const byIdentity = new Map<string, TargetNotice>();
  for (const range of monthlyRanges("202401010000", seoulEndOfDay(now))) {
    let totalCount: number | null = null;
    for (let pageNo = 1; ; pageNo += 1) {
      const payload = await fetchG2bJson(GOODS_BASE, "getBidPblancListInfoThngPPSSrch", {
        inqryDiv: "1",
        inqryBgnDt: range.from,
        inqryEndDt: range.to,
        dtilPrdctClsfcNo: "39121801",
        pageNo,
        numOfRows: PAGE_SIZE,
      });
      const page = parseSearchPage(payload);
      if (page.pageNo !== pageNo || page.pageSize !== PAGE_SIZE) {
        throw new Error("\uB300\uC0C1 \uACF5\uACE0 \uD398\uC774\uC9C0 \uC815\uBCF4\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
      }
      if (totalCount === null) totalCount = page.totalCount;
      if (page.totalCount !== totalCount) {
        throw new Error("\uB300\uC0C1 \uACF5\uACE0 \uCD1D\uAC74\uC218\uAC00 \uC870\uD68C \uC911 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
      }
      for (const item of page.items) {
        if (digits(item.dtilPrdctClsfcNo) !== TARGET_DETAIL_CODE) continue;
        const noticeNo = text(item.bidNtceNo);
        const noticeOrder = text(item.bidNtceOrd);
        if (!noticeNo || !noticeOrder) throw new Error("\uB300\uC0C1 \uACF5\uACE0 \uC2DD\uBCC4\uC790\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
        byIdentity.set(`${noticeNo}|${noticeOrder}`, {
          noticeNo,
          noticeOrder,
          noticeName: text(item.bidNtceNm),
          demandAgencyName: text(item.dmndInsttNm) || null,
          sourceUrl: safeUrl(item.bidNtceDtlUrl),
        });
      }
      if (pageNo >= Math.max(1, Math.ceil(totalCount / PAGE_SIZE))) break;
    }
  }
  return [...byIdentity.values()].sort((a, b) =>
    `${a.noticeNo}|${a.noticeOrder}`.localeCompare(`${b.noticeNo}|${b.noticeOrder}`),
  );
}

async function collectTargetAwards(
  notices: TargetNotice[],
  now: Date,
  onProgress?: (awards: StoredMarketAward[]) => void,
) {
  const noticeByIdentity = new Map(
    notices.map((notice) => [`${notice.noticeNo}|${notice.noticeOrder}`, notice]),
  );
  const rowsByNotice = new Map<string, AwardResultRow[]>();
  let unresolvedCount = 0;

  for (const range of weeklyRanges("202501010000", seoulEndOfDay(now))) {
    let batch;
    try {
      batch = await collectAwardRange(range);
    } catch (error) {
      throw new Error(
        `\uB099\uCC30 \uB4F1\uB85D\uAE30\uAC04 ${range.from}-${range.to}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    const touchedNoticeKeys = new Set<string>();
    for (const row of batch.awards) {
      const key = `${row.noticeNo}|${row.noticeOrder}`;
      if (!noticeByIdentity.has(key) || !isFinalAwardOnOrAfter(row, "2025-01-01")) continue;
      const existing = rowsByNotice.get(key) ?? [];
      existing.push(row);
      rowsByNotice.set(key, existing);
      touchedNoticeKeys.add(key);
    }
    unresolvedCount += batch.unresolvedAwards.filter(
      (row) =>
        row.noticeNo !== null &&
        row.noticeOrder !== null &&
        noticeByIdentity.has(`${row.noticeNo}|${row.noticeOrder}`),
    ).length;
    if (onProgress && touchedNoticeKeys.size > 0) {
      onProgress([...touchedNoticeKeys].map((key) => marketAwardFromRows(
        noticeByIdentity.get(key)!,
        rowsByNotice.get(key)!,
      )));
    }
  }

  const awards = [...rowsByNotice].map(([key, rows]) =>
    marketAwardFromRows(noticeByIdentity.get(key)!, rows));
  return { awards, unresolvedCount };
}

function marketAwardFromRows(notice: TargetNotice, rows: AwardResultRow[]): StoredMarketAward {
  const award = collapseNoticeWinner(rows);
  return {
    noticeNo: notice.noticeNo,
    noticeOrder: notice.noticeOrder,
    finalAwardDate: award.finalAwardDate,
    winnerBizNo: award.winnerBizNo,
    winnerName: award.winnerName,
    amount: award.amount,
    noticeName: notice.noticeName || null,
    demandAgencyName: notice.demandAgencyName,
    regionName: marketRegionName(notice.demandAgencyName),
    sourceUrl: notice.sourceUrl,
  };
}

async function collectTargetContracts(
  notices: TargetNotice[],
  now: Date,
  onProgress?: (contracts: StoredMarketContract[]) => void,
) {
  const noticeByIdentity = new Map(
    notices.map((notice) => [`${notice.noticeNo}|${notice.noticeOrder}`, notice] as const),
  );
  const contractByIdentity = new Map<string, StoredMarketContract>();
  const startDate = "2025-01-01";
  const endDate = seoulCalendarDate(now);

  for (const range of monthlyRanges(startDate + "0000", endDate + "2359")) {
    for (let pageNo = 1; ; pageNo += 1) {
      const payload = await fetchContractPage(range.from, range.to, pageNo);
      if (payload.pageNo !== pageNo || payload.pageSize !== PAGE_SIZE) {
        throw new Error("\uD45C\uC900\uACC4\uC57D \uD398\uC774\uC9C0 \uC815\uBCF4\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
      }
      const pageContracts: StoredMarketContract[] = [];
      for (const item of payload.items) {
        const contract = mapStandardContractRow(item, noticeByIdentity);
        if (!contract) continue;
        if (contract.contractDate < startDate || contract.contractDate > endDate) continue;
        contractByIdentity.set(contract.sourceIdentity, contract);
        pageContracts.push(contract);
      }
      if (pageContracts.length > 0) onProgress?.(pageContracts);
      if (pageNo >= Math.max(1, Math.ceil(payload.totalCount / PAGE_SIZE))) break;
    }
  }

  for (const range of monthlyRanges(startDate + "0000", endDate + "2359")) {
    for (let pageNo = 1; ; pageNo += 1) {
      const payload = await fetchShoppingMallPage(range.from.slice(0, 8), range.to.slice(0, 8), pageNo);
      if (payload.pageNo !== pageNo || payload.pageSize !== PAGE_SIZE) {
        throw new Error("\uC1A1\uC77C\uB9C8\uC744 \uACC4\uC57D \uD398\uC774\uC9C0 \uC815\uBCF4\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
      }
      const pageContracts: StoredMarketContract[] = [];
      for (const item of payload.items) {
        const contract = mapShoppingMallContractRow(item, noticeByIdentity);
        if (!contract) continue;
        if (contract.contractDate < startDate || contract.contractDate > endDate) continue;
        contractByIdentity.set(contract.sourceIdentity, contract);
        pageContracts.push(contract);
      }
      if (pageContracts.length > 0) onProgress?.(pageContracts);
      if (pageNo >= Math.max(1, Math.ceil(payload.totalCount / PAGE_SIZE))) break;
    }
  }

  return [...contractByIdentity.values()].sort((a, b) => {
    if (a.contractDate !== b.contractDate) return b.contractDate.localeCompare(a.contractDate);
    return a.sourceIdentity.localeCompare(b.sourceIdentity);
  });
}

async function fetchContractPage(dateFrom: string, dateTo: string, pageNo: number) {
  const payload = await fetchG2bJsonWithRetry(CONTRACT_BASE, "getDataSetOpnStdCntrctInfo", {
    cntrctCnclsBgnDate: dateFrom,
    cntrctCnclsEndDate: dateTo,
    pageNo,
    numOfRows: PAGE_SIZE,
  });
  return parseContractPage(payload);
}

async function fetchShoppingMallPage(dateFrom: string, dateTo: string, pageNo: number) {
  const payload = await fetchG2bJsonWithRetry(SHOPPING_MALL_BASE, "getSpcifyPrdlstPrcureInfoList", {
    inqryDiv: "1",
    inqryBgnDate: dateFrom,
    inqryEndDate: dateTo,
    inqryPrdctDiv: "2",
    dtilPrdctClsfcNo: TARGET_DETAIL_CODE,
    fnlCntrctDlvrReqChgOrdYn: "Y",
    pageNo,
    numOfRows: PAGE_SIZE,
  });
  return parseContractPage(payload);
}

async function fetchG2bJsonWithRetry(base: string, operation: string, params: Record<string, string | number>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await fetchG2bJson(base, operation, params);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_REQUEST_ATTEMPTS) break;
      const status = httpStatusFromError(error);
      if (status !== undefined && !TRANSIENT_HTTP_STATUSES.has(status)) break;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseContractPage(payload: unknown) {
  const response = record(payload).response;
  const body = record(record(response).body);
  const pageNo = integer(body.pageNo);
  const pageSize = integer(body.numOfRows);
  const totalCount = integer(body.totalCount, true);
  const itemsContainer = body.items;
  const rawItems = Array.isArray(itemsContainer) ? itemsContainer : record(itemsContainer).item;
  const items = rawItems == null
    ? []
    : Array.isArray(rawItems)
      ? rawItems.map(record)
      : [record(rawItems)];
  const expected = totalCount === 0
    ? 0
    : Math.min(pageSize, Math.max(0, totalCount - (pageNo - 1) * pageSize));
  if (items.length !== expected) throw new Error("\uACC4\uC57D \uD398\uC774\uC9C0 \uAC74\uC218\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  return { pageNo, pageSize, totalCount, items };
}

function mapStandardContractRow(
  item: Record<string, unknown>,
  noticeByIdentity: Map<string, TargetNotice>,
): StoredMarketContract | null {
  const contractNo = text(item.dcsnCntrctNo) || text(item.cntrctNo) || text(item.cntrctRefNo);
  const contractDate = normalizeDate(item.cntrctCnclsDate ?? item.cntrctDate ?? item.cntrctDt);
  const winnerBizNo = digits(item.rprsntCorpBizrno ?? item.corpBizno ?? item.cntrctCorpBizno);
  const winnerName = text(item.rprsntCorpNm) || text(item.corpNm) || text(item.cntrctCorpNm);
  if (!contractNo || !contractDate || !winnerBizNo || !winnerName) return null;
  const amount = parseAmount(item.totCntrctAmt) ?? parseAmount(item.ttalCntrctAmt) ?? parseAmount(item.cntrctAmt);
  const demandAgencyName = text(item.dminsttNm) || text(item.dmndInsttNm) || text(item.orderInsttNm) || null;
  const noticeNo = text(item.bidNtceNo);
  const noticeOrder = text(item.bidNtceOrd);
  const detailNo = noticeNo && noticeOrder ? `${noticeNo}|${noticeOrder}` : "";
  const notice = detailNo ? noticeByIdentity.get(detailNo) : undefined;
  const noticeName = notice?.noticeName ?? text(item.cntrctNm);
  const contractName = text(item.cntrctNm) || noticeName;
  if (!notice) {
    if (!containsKeyword(contractName) && !containsKeyword(noticeName)) return null;
  }
  const sourceUrl = safeUrl(item.cntrctDtlInfoUrl) || safeUrl(item.cntrctInfoUrl)
    || safeUrl(item.cntrctDtlUrl) || safeUrl(item.bidNtceDtlUrl) || safeUrl(item.bidNtceUrl) || null;
  const sourceIdentity = [
    "standard",
    normalizeDigits(winnerBizNo),
    contractNo,
    digits(item.cntrctOrd ?? item.cntrctChgOrd) || "0",
    contractDate,
    amount ?? "0",
  ].join(":");
  return {
    sourceIdentity,
    contractNo,
    contractName: contractName || noticeName,
    contractDate,
    noticeNo: noticeNo || null,
    noticeOrder: noticeOrder || null,
    winnerBizNo: normalizeDigits(winnerBizNo),
    winnerName,
    amount,
    demandAgencyName,
    regionName: marketRegionName(demandAgencyName),
    sourceUrl,
  } as StoredMarketContract;
}

function mapShoppingMallContractRow(
  item: Record<string, unknown>,
  noticeByIdentity: Map<string, TargetNotice>,
): StoredMarketContract | null {
  const contractNo = text(item.cntrctDlvrReqNo) || text(item.cntrctNo);
  const contractDate = normalizeDate(item.cntrctDlvrReqDate ?? item.cntrctDate ?? item.cntrctCnclsDate ?? item.dlvrReqRcptDate);
  const winnerBizNo = digits(item.bizno) || digits(item.cntrctCorpBizno);
  const winnerName = text(item.corpNm);
  if (!contractNo || !contractDate || !winnerBizNo || !winnerName) return null;
  if (digits(item.dtilPrdctClsfcNo) !== TARGET_DETAIL_CODE) return null;
  const amount = parseAmount(item.prdctAmt);
  const demandAgencyName = text(item.dminsttNm) || null;
  const noticeNo = text(item.uprcCntrctNo);
  const noticeOrder = text(item.bidNtceOrd);
  const detailNo = noticeNo && noticeOrder ? `${noticeNo}|${noticeOrder}` : "";
  const notice = detailNo ? noticeByIdentity.get(detailNo) : undefined;
  const contractName = text(item.cntrctDlvrReqNm) || notice?.noticeName || text(item.prdctNm);
  const noticeName = notice?.noticeName ?? contractName;
  if (!notice) {
    if (!containsKeyword(contractName) && !containsKeyword(noticeName)) return null;
  }
  const sourceUrl = safeUrl(item.cntrctDlvrReqUrl) || null;
  const sourceIdentity = [
    "shopping-mall",
    normalizeDigits(winnerBizNo),
    contractNo,
    text(item.cntrctDlvrReqChgOrd) || "0",
    digits(item.prdctIdntNo) || "0",
    contractDate,
    amount ?? "0",
  ].join(":");
  return {
    sourceIdentity,
    contractNo,
    contractName: contractName || noticeName,
    contractDate,
    noticeNo: noticeNo || null,
    noticeOrder: noticeOrder || null,
    winnerBizNo: normalizeDigits(winnerBizNo),
    winnerName,
    amount,
    demandAgencyName,
    regionName: marketRegionName(demandAgencyName),
    sourceUrl,
  } as StoredMarketContract;
}

function containsKeyword(value: string) {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return CONTRACT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function marketRegionName(demandAgencyName: string | null) {
  return demandAgencyName?.includes("\uBD80\uC0B0") ? "\uBD80\uC0B0" : "\uAE30\uD0C0";
}

async function collectAwardRange(range: { from: string; to: string }): Promise<AwardRegistrationBatch> {
  try {
    return await collectAwardRegistration({
      dateFrom: range.from,
      dateTo: range.to,
      pageSize: PAGE_SIZE,
      maxPages: 50,
      allowDuplicateGrains: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate identity across pages") || range.from.slice(0, 8) === range.to.slice(0, 8)) {
      throw error;
    }
    const batches: AwardRegistrationBatch[] = [];
    for (const day of dailyRanges(range.from, range.to)) {
      batches.push(await collectAwardRegistration({
        dateFrom: day.from,
        dateTo: day.to,
        pageSize: PAGE_SIZE,
        maxPages: 10,
        allowDuplicateGrains: true,
      }));
    }
    return {
      dateFrom: range.from,
      dateTo: range.to,
      totalCount: batches.reduce((sum, batch) => sum + batch.totalCount, 0),
      awards: batches.flatMap((batch) => batch.awards),
      unresolvedAwards: batches.flatMap((batch) => batch.unresolvedAwards),
      registrationWindowComplete: batches.every((batch) => batch.registrationWindowComplete),
    };
  }
}

function parseSearchPage(payload: unknown) {
  const response = record(payload).response;
  const body = record(record(response).body);
  const pageNo = integer(body.pageNo);
  const pageSize = integer(body.numOfRows);
  const totalCount = integer(body.totalCount, true);
  const itemsContainer = body.items;
  const rawItems = Array.isArray(itemsContainer) ? itemsContainer : record(itemsContainer).item;
  const items = rawItems == null
    ? []
    : Array.isArray(rawItems)
      ? rawItems.map(record)
      : [record(rawItems)];
  const expected = totalCount === 0
    ? 0
    : Math.min(pageSize, Math.max(0, totalCount - (pageNo - 1) * pageSize));
  if (items.length !== expected) throw new Error("\uB300\uC0C1 \uACF5\uACE0 \uD398\uC774\uC9C0 \uAC74\uC218\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  return { pageNo, pageSize, totalCount, items };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function integer(value: unknown, allowZero = false) {
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error("\uB098\uB77C\uC7A5\uD130 \uD398\uC774\uC9C0 \uC22B\uC790 \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  }
  return parsed;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function digits(value: unknown) {
  return text(value).replace(/\D/g, "");
}

function normalizeDigits(value: unknown) {
  return text(value).replace(/\D/g, "");
}

function normalizeDate(value: unknown) {
  const compact = text(value).replace(/\D/g, "");
  if (!/^\d{8}$/.test(compact)) return "";
  const dashed = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const date = new Date(`${dashed}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === dashed ? dashed : "";
}

function parseAmount(value: unknown) {
  if (value === null || value === undefined) return null;
  const str = String(value).replace(/,/g, "").trim();
  if (!str) return null;
  const parsed = Number(str);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function safeUrl(value: unknown) {
  const candidate = text(value);
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

function httpStatusFromError(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: number; statusCode?: number }).status
    ?? (error as { status?: number; statusCode?: number }).statusCode;
  return typeof status === "number" ? status : undefined;
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function seoulEndOfDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}2359`;
}

function seoulCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function monthlyRanges(start: string, end: string) {
  const ranges: Array<{ from: string; to: string }> = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(4, 6));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(4, 6));
  while (year < endYear || year === endYear && month <= endMonth) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const from = `${year}${String(month).padStart(2, "0")}010000`;
    const monthEnd = `${year}${String(month).padStart(2, "0")}${String(lastDay).padStart(2, "0")}2359`;
    ranges.push({ from, to: year === endYear && month === endMonth ? end : monthEnd });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return ranges;
}

function weeklyRanges(start: string, end: string) {
  const ranges: Array<{ from: string; to: string }> = [];
  const startDay = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(4, 6)) - 1, Number(start.slice(6, 8)));
  const endDay = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(4, 6)) - 1, Number(end.slice(6, 8)));
  for (let cursor = startDay; cursor <= endDay; cursor += 7 * 86_400_000) {
    const rangeEnd = Math.min(cursor + 6 * 86_400_000, endDay);
    ranges.push({
      from: `${compactUtcDay(cursor)}0000`,
      to: rangeEnd === endDay ? end : `${compactUtcDay(rangeEnd)}2359`,
    });
  }
  return ranges;
}

function compactUtcDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10).replace(/-/g, "");
}

function dailyRanges(start: string, end: string) {
  const ranges: Array<{ from: string; to: string }> = [];
  const startDay = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(4, 6)) - 1, Number(start.slice(6, 8)));
  const endDay = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(4, 6)) - 1, Number(end.slice(6, 8)));
  for (let cursor = startDay; cursor <= endDay; cursor += 86_400_000) {
    ranges.push({
      from: `${compactUtcDay(cursor)}0000`,
      to: cursor === endDay ? end : `${compactUtcDay(cursor)}2359`,
    });
  }
  return ranges;
}
