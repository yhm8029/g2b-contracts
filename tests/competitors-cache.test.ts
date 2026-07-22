import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_COMPETITOR_QUERY_CACHE_TTL_MS,
  type CompetitorContractQueryCache,
  SqliteCompetitorQueryCache,
} from "@/lib/competitors/cache";
import { initializeSqliteSchema } from "@/lib/db/init";

const databases: Database.Database[] = [];

function memoryDb() {
  const db = new Database(":memory:");
  databases.push(db);
  initializeSqliteSchema(db);
  return db;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("competitor query SQLite cache", () => {
  const key = {
    bizNoNormalized: "1111111111,2222222222",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-22",
  };

  it("stores and returns only the successful final query JSON", () => {
    const sqlite = memoryDb();
    const cache = new SqliteCompetitorQueryCache(sqlite, { now: () => 1_000 });
    const result = {
      fetchedAt: "2026-07-22T00:00:00.000Z",
      rows: [],
      summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
    };

    cache.set(key, result);

    expect(cache.get(key)).toEqual(result);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM competitor_contract_query_cache").get()).toEqual({ count: 1 });
  });

  it("expires entries after 24 hours", () => {
    const sqlite = memoryDb();
    let now = 1_000;
    const cache = new SqliteCompetitorQueryCache(sqlite, { now: () => now });
    cache.set(key, {
      rows: [],
      summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
    });

    now += DEFAULT_COMPETITOR_QUERY_CACHE_TTL_MS;

    expect(cache.get(key)).toBeNull();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM competitor_contract_query_cache").get()).toEqual({ count: 0 });
  });

  it("returns fresh cached intervals intersecting the requested range", () => {
    const sqlite = memoryDb();
    const cache: CompetitorContractQueryCache = new SqliteCompetitorQueryCache(sqlite, { now: () => 1_000 });
    const result = {
      fetchedAt: "2026-07-22T00:00:00.000Z",
      rows: [],
      summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
    };

    cache.setInterval!({ ...key, dateFrom: "2026-07-01", dateTo: "2026-07-07" }, result);
    cache.setInterval!({ ...key, dateFrom: "2026-07-15", dateTo: "2026-07-21" }, result);
    cache.setInterval!({ ...key, dateFrom: "2026-08-01", dateTo: "2026-08-07" }, result);

    expect(cache.getFreshIntervals!(key)).toEqual([
      { dateFrom: "2026-07-01", dateTo: "2026-07-07", result },
      { dateFrom: "2026-07-15", dateTo: "2026-07-21", result },
    ]);
  });

  it("excludes expired intervals so callers can refetch their dates", () => {
    const sqlite = memoryDb();
    let now = 1_000;
    const cache = new SqliteCompetitorQueryCache(sqlite, { now: () => now });
    cache.setInterval(key, {
      rows: [],
      summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
    });

    now += DEFAULT_COMPETITOR_QUERY_CACHE_TTL_MS;

    expect(cache.getFreshIntervals(key)).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM competitor_contract_interval_cache").get()).toEqual({ count: 0 });
  });
});
