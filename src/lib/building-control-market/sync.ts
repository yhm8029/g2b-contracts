import type Database from "better-sqlite3";

import {
  collapseNoticeWinner,
  collectAwardRegistration,
  isFinalAwardOnOrAfter,
  type AwardResultRow,
} from "@/lib/building-control/g2b/award-client";
import { fetchG2bJson } from "@/lib/g2b/http";
import { replaceMarketAwards, setMarketSyncState, type StoredMarketAward } from "./store";

const GOODS_BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const PAGE_SIZE = 999;
const TARGET_DETAIL_CODE = "3912180101";

type TargetNotice = {
  noticeNo: string;
  noticeOrder: string;
  noticeName: string;
  sourceUrl: string | null;
};

export async function syncMarketData(db: Database.Database, now = new Date()) {
  setMarketSyncState(db, "syncing", "나라장터 데이터를 조회하고 있습니다.");
  try {
    const notices = await collectTargetNotices(now);
    const { awards, unresolvedCount } = await collectTargetAwards(notices, now);
    replaceMarketAwards(db, awards);
    const lastSyncedAt = new Date().toISOString();
    setMarketSyncState(
      db,
      "ready",
      `동기화 완료: 대상 공고 ${notices.length}건, 낙찰 ${awards.length}건`,
      lastSyncedAt,
    );
    return { noticeCount: notices.length, awardCount: awards.length, unresolvedCount, lastSyncedAt };
  } catch (error) {
    setMarketSyncState(db, "failed", "동기화에 실패했습니다. 이전 결과를 유지합니다.");
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
        throw new Error("대상 공고 페이지 정보가 일치하지 않습니다.");
      }
      if (totalCount === null) totalCount = page.totalCount;
      if (page.totalCount !== totalCount) {
        throw new Error("대상 공고 총건수가 조회 중 변경되었습니다.");
      }
      for (const item of page.items) {
        if (digits(item.dtilPrdctClsfcNo) !== TARGET_DETAIL_CODE) continue;
        const noticeNo = text(item.bidNtceNo);
        const noticeOrder = text(item.bidNtceOrd);
        if (!noticeNo || !noticeOrder) throw new Error("대상 공고 식별자가 없습니다.");
        byIdentity.set(`${noticeNo}|${noticeOrder}`, {
          noticeNo,
          noticeOrder,
          noticeName: text(item.bidNtceNm),
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

async function collectTargetAwards(notices: TargetNotice[], now: Date) {
  const noticeByIdentity = new Map(
    notices.map((notice) => [`${notice.noticeNo}|${notice.noticeOrder}`, notice]),
  );
  const rowsByNotice = new Map<string, AwardResultRow[]>();
  let unresolvedCount = 0;

  for (const range of monthlyRanges("202501010000", seoulEndOfDay(now))) {
    const batch = await collectAwardRegistration({
      dateFrom: range.from,
      dateTo: range.to,
      pageSize: PAGE_SIZE,
      maxPages: 500,
    });
    for (const row of batch.awards) {
      const key = `${row.noticeNo}|${row.noticeOrder}`;
      if (!noticeByIdentity.has(key) || !isFinalAwardOnOrAfter(row, "2025-01-01")) continue;
      const existing = rowsByNotice.get(key) ?? [];
      existing.push(row);
      rowsByNotice.set(key, existing);
    }
    unresolvedCount += batch.unresolvedAwards.filter(
      (row) =>
        row.noticeNo !== null &&
        row.noticeOrder !== null &&
        noticeByIdentity.has(`${row.noticeNo}|${row.noticeOrder}`),
    ).length;
  }

  const awards: StoredMarketAward[] = [];
  for (const [key, rows] of rowsByNotice) {
    const notice = noticeByIdentity.get(key)!;
    const award = collapseNoticeWinner(rows);
    awards.push({
      noticeNo: notice.noticeNo,
      noticeOrder: notice.noticeOrder,
      finalAwardDate: award.finalAwardDate,
      winnerBizNo: award.winnerBizNo,
      winnerName: award.winnerName,
      amount: award.amount,
      sourceUrl: notice.sourceUrl,
    });
  }
  return { awards, unresolvedCount };
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
  if (items.length !== expected) throw new Error("대상 공고 페이지 건수가 일치하지 않습니다.");
  return { pageNo, pageSize, totalCount, items };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function integer(value: unknown, allowZero = false) {
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error("나라장터 페이지 숫자 형식이 올바르지 않습니다.");
  }
  return parsed;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function digits(value: unknown) {
  return text(value).replace(/\D/g, "");
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
