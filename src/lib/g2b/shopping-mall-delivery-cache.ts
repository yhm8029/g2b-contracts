import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import {
  shoppingMallDeliveryRequestInfoCache,
  shoppingMallDeliveryRequestInfoCacheChunks,
} from "@/lib/db/schema";
import type { DateChunk } from "@/lib/g2b/date-chunks";

const THIRD_PARTY_CONTRACT_METHOD_KEYWORD = "제3자단가";
const INSERT_BATCH_SIZE = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type CachedDeliveryRequestInfoMatch = {
  deliveryRequestNos: string[];
  cachedRowCount: number;
  matchedRowCount: number;
};

export function readCachedShoppingMallDeliveryRequestInfoMatches(
  db: Db,
  chunk: DateChunk,
  normalizedBizNo: string,
): CachedDeliveryRequestInfoMatch | null {
  const cacheChunk = db
    .select({
      cachedRowCount: shoppingMallDeliveryRequestInfoCacheChunks.cachedRowCount,
      refreshedAt: shoppingMallDeliveryRequestInfoCacheChunks.refreshedAt,
    })
    .from(shoppingMallDeliveryRequestInfoCacheChunks)
    .where(
      and(
        eq(shoppingMallDeliveryRequestInfoCacheChunks.dateFrom, chunk.dateFrom),
        eq(shoppingMallDeliveryRequestInfoCacheChunks.dateTo, chunk.dateTo),
      ),
    )
    .get();

  if (cacheChunk === undefined) {
    return null;
  }

  if (!isFreshCacheTimestamp(cacheChunk.refreshedAt)) {
    return null;
  }

  const matchingRows = db
    .select({
      deliveryRequestNo: shoppingMallDeliveryRequestInfoCache.deliveryRequestNo,
    })
    .from(shoppingMallDeliveryRequestInfoCache)
    .where(
      and(
        eq(shoppingMallDeliveryRequestInfoCache.dateFrom, chunk.dateFrom),
        eq(shoppingMallDeliveryRequestInfoCache.dateTo, chunk.dateTo),
        eq(shoppingMallDeliveryRequestInfoCache.corpBizno, normalizedBizNo),
        sql`${shoppingMallDeliveryRequestInfoCache.contractMethod} like ${`%${THIRD_PARTY_CONTRACT_METHOD_KEYWORD}%`}`,
      ),
    )
    .all();

  const deliveryRequestNos = new Set<string>();
  let matchedRowCount = 0;
  for (const row of matchingRows) {
    if (row.deliveryRequestNo !== null && row.deliveryRequestNo.trim().length > 0) {
      deliveryRequestNos.add(row.deliveryRequestNo);
      matchedRowCount += 1;
    }
  }

  return {
    deliveryRequestNos: [...deliveryRequestNos],
    cachedRowCount: cacheChunk.cachedRowCount,
    matchedRowCount,
  };
}

export function beginShoppingMallDeliveryRequestInfoCacheRefresh(db: Db, chunk: DateChunk): void {
  db.delete(shoppingMallDeliveryRequestInfoCacheChunks)
    .where(
      and(
        eq(shoppingMallDeliveryRequestInfoCacheChunks.dateFrom, chunk.dateFrom),
        eq(shoppingMallDeliveryRequestInfoCacheChunks.dateTo, chunk.dateTo),
      ),
    )
    .run();

  db.delete(shoppingMallDeliveryRequestInfoCache)
    .where(
      and(
        eq(shoppingMallDeliveryRequestInfoCache.dateFrom, chunk.dateFrom),
        eq(shoppingMallDeliveryRequestInfoCache.dateTo, chunk.dateTo),
      ),
    )
    .run();
}

export function appendShoppingMallDeliveryRequestInfoCacheRows(
  db: Db,
  chunk: DateChunk,
  rows: Record<string, unknown>[],
): number {
  const now = new Date().toISOString();
  const values = rows.map((row) => ({
    dateFrom: chunk.dateFrom,
    dateTo: chunk.dateTo,
    sourceRowHash: hashProviderRow(row),
    deliveryRequestNo: pickString(row, ["dlvrReqNo"]),
    deliveryRequestChangeOrder: pickString(row, ["dlvrReqChgOrd"]),
    receiptDate: pickString(row, ["dlvrReqRcptDate"]),
    corpBizno: normalizeDigits(pickString(row, ["corpBizno"])),
    corpName: pickString(row, ["corpNm"]),
    contractMethod: pickString(row, ["cntrctCnclsStleNm"]),
    deliveryRequestName: pickString(row, ["dlvrReqNm"]),
    rawJson: JSON.stringify(row),
    updatedAt: now,
  }));

  for (let index = 0; index < values.length; index += INSERT_BATCH_SIZE) {
    const batch = values.slice(index, index + INSERT_BATCH_SIZE);
    if (batch.length === 0) {
      continue;
    }

    db.insert(shoppingMallDeliveryRequestInfoCache)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          shoppingMallDeliveryRequestInfoCache.dateFrom,
          shoppingMallDeliveryRequestInfoCache.dateTo,
          shoppingMallDeliveryRequestInfoCache.sourceRowHash,
        ],
        set: {
          deliveryRequestNo: sql`excluded.delivery_request_no`,
          deliveryRequestChangeOrder: sql`excluded.delivery_request_change_order`,
          receiptDate: sql`excluded.receipt_date`,
          corpBizno: sql`excluded.corp_bizno`,
          corpName: sql`excluded.corp_name`,
          contractMethod: sql`excluded.contract_method`,
          deliveryRequestName: sql`excluded.delivery_request_name`,
          rawJson: sql`excluded.raw_json`,
          updatedAt: now,
        },
      })
      .run();
  }

  return values.length;
}

export function markShoppingMallDeliveryRequestInfoCacheComplete(
  db: Db,
  chunk: DateChunk,
  totalCount: number,
  cachedRowCount: number,
): void {
  const now = new Date().toISOString();

  db.insert(shoppingMallDeliveryRequestInfoCacheChunks)
    .values({
      dateFrom: chunk.dateFrom,
      dateTo: chunk.dateTo,
      totalCount,
      cachedRowCount,
      refreshedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        shoppingMallDeliveryRequestInfoCacheChunks.dateFrom,
        shoppingMallDeliveryRequestInfoCacheChunks.dateTo,
      ],
      set: {
        totalCount,
        cachedRowCount,
        refreshedAt: now,
        updatedAt: now,
      },
    })
    .run();
}

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) {
      continue;
    }

    const text = String(value).trim();
    if (text.length > 0) {
      return text;
    }
  }

  return null;
}

function normalizeDigits(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.replace(/\D/g, "");
  return normalized.length > 0 ? normalized : null;
}

function hashProviderRow(row: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

function isFreshCacheTimestamp(value: string): boolean {
  const refreshedAt = Date.parse(value);
  return Number.isFinite(refreshedAt) && Date.now() - refreshedAt <= CACHE_TTL_MS;
}
