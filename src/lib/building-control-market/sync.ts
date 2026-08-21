import type Database from "better-sqlite3";

import {
  collectAwardRegistration,
  collapseNoticeWinner,
  isFinalAwardOnOrAfter,
  type AwardResultRow,
} from "@/lib/building-control/g2b/award-client";
import {
  collectNoticeInventory,
  type NoticeInventoryRow,
  type NoticeProductRow,
} from "@/lib/building-control/g2b/notice-client";
import { replaceMarketAwards, setMarketSyncState, type StoredMarketAward } from "./store";

const NOTICE_SCAN_START = "202401010000";
const AWARD_SCAN_START = "202501010000";

export async function syncMarketData(db: Database.Database, now = new Date()) {
  setMarketSyncState(db, "syncing", "나라장터 데이터를 조회하고 있습니다.");
  try {
    const endStamp = seoulEndOfDay(now);
    const notices = new Map<string, NoticeInventoryRow>();
    const products = new Map<string, NoticeProductRow>();
    for (const range of monthlyRanges(NOTICE_SCAN_START, endStamp)) {
      const batch = await collectNoticeInventory({ dateFrom: range.from, dateTo: range.to, pageSize: 999, maxPages: 200 });
      for (const notice of batch.notices) notices.set(noticeKey(notice.noticeNo, notice.noticeOrder), notice);
      for (const product of batch.products) products.set(product.providerRowIdentity, product);
    }

    const targetGrains = new Set(
      [...products.values()].map((product) => grainKey(product.noticeNo, product.noticeOrder, product.bidClassNo)),
    );
    const resolved = new Map<string, AwardResultRow>();
    let unresolvedCount = 0;
    for (const range of monthlyRanges(AWARD_SCAN_START, endStamp)) {
      const batch = await collectAwardRegistration({ dateFrom: range.from, dateTo: range.to, pageSize: 999, maxPages: 200 });
      if (!batch.registrationWindowComplete) throw new Error("낙찰 등록일 범위를 확인할 수 없습니다.");
      for (const award of batch.awards) resolved.set(award.providerResultIdentity, award);
      for (const award of batch.unresolvedAwards) {
        unresolvedCount += 1;
        if (
          award.noticeNo !== null && award.noticeOrder !== null && award.bidClassNo !== null
          && targetGrains.has(grainKey(award.noticeNo, award.noticeOrder, award.bidClassNo))
        ) throw new Error("대상 품목 낙찰 결과에 확정일이 없습니다.");
      }
    }

    const byNotice = new Map<string, AwardResultRow[]>();
    for (const award of resolved.values()) {
      if (!targetGrains.has(grainKey(award.noticeNo, award.noticeOrder, award.bidClassNo))) continue;
      if (!isFinalAwardOnOrAfter(award, "2025-01-01")) continue;
      const key = noticeKey(award.noticeNo, award.noticeOrder);
      byNotice.set(key, [...(byNotice.get(key) ?? []), award]);
    }

    const stored: StoredMarketAward[] = [...byNotice.entries()].map(([key, rows]) => {
      const award = collapseNoticeWinner(rows);
      return {
        noticeNo: award.noticeNo,
        noticeOrder: award.noticeOrder,
        finalAwardDate: award.finalAwardDate,
        winnerBizNo: award.winnerBizNo,
        winnerName: award.winnerName,
        amount: award.amount,
        sourceUrl: notices.get(key)?.sourceUrl ?? null,
      };
    });
    replaceMarketAwards(db, stored);
    const lastSyncedAt = new Date().toISOString();
    setMarketSyncState(db, "ready", `동기화 완료: 낙찰 ${stored.length}건`, lastSyncedAt);
    return { awardCount: stored.length, unresolvedCount, lastSyncedAt };
  } catch (error) {
    setMarketSyncState(db, "failed", "동기화에 실패했습니다. 이전 결과를 유지합니다.");
    throw error;
  }
}

function noticeKey(noticeNo: string, noticeOrder: string) {
  return `${noticeNo}|${noticeOrder}`;
}

function grainKey(noticeNo: string, noticeOrder: string, bidClassNo: string) {
  return `${noticeNo}|${noticeOrder}|${bidClassNo}`;
}

function seoulEndOfDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
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
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const from = year === Number(start.slice(0, 4)) && month === Number(start.slice(4, 6))
      ? start
      : `${year}${String(month).padStart(2, "0")}010000`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthEnd = `${year}${String(month).padStart(2, "0")}${String(lastDay).padStart(2, "0")}2359`;
    ranges.push({ from, to: year === endYear && month === endMonth ? end : monthEnd });
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return ranges;
}
