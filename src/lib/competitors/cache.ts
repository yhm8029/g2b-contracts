import type Database from "better-sqlite3";

import type { CompetitorContractSearchResult } from "./contracts";

export type CompetitorContractQueryCacheKey = {
  bizNoNormalized: string;
  dateFrom: string;
  dateTo: string;
};

export type CompetitorContractCachedInterval = {
  dateFrom: string;
  dateTo: string;
  result: CompetitorContractSearchResult;
};

export interface CompetitorContractQueryCache {
  get(key: CompetitorContractQueryCacheKey): CompetitorContractSearchResult | null;
  set(key: CompetitorContractQueryCacheKey, result: CompetitorContractSearchResult): void;
  getFreshIntervals?(key: CompetitorContractQueryCacheKey): CompetitorContractCachedInterval[];
  setInterval?(key: CompetitorContractQueryCacheKey, result: CompetitorContractSearchResult): void;
}

export const DEFAULT_COMPETITOR_QUERY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const COMPETITOR_CONTRACT_QUERY_RESULT_VERSION = "latest-contract-v7";

type CacheOptions = { ttlMs?: number; now?: () => number };

export class SqliteCompetitorQueryCache implements CompetitorContractQueryCache {
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly sqlite: Database.Database, options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_COMPETITOR_QUERY_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get(key: CompetitorContractQueryCacheKey): CompetitorContractSearchResult | null {
    const now = this.now();
    this.sqlite.prepare("DELETE FROM competitor_contract_query_cache WHERE cached_at_ms <= ?").run(now - this.ttlMs);
    const row = this.sqlite.prepare(`
      SELECT result_json, result_version FROM competitor_contract_query_cache
      WHERE biz_no_normalized = ? AND date_from = ? AND date_to = ?
    `).get(key.bizNoNormalized, key.dateFrom, key.dateTo) as
      | { result_json: string; result_version: string }
      | undefined;
    if (!row || row.result_version !== COMPETITOR_CONTRACT_QUERY_RESULT_VERSION) return null;
    try {
      return JSON.parse(row.result_json) as CompetitorContractSearchResult;
    } catch {
      this.delete(key);
      return null;
    }
  }

  set(key: CompetitorContractQueryCacheKey, result: CompetitorContractSearchResult): void {
    this.sqlite.prepare(`
      INSERT INTO competitor_contract_query_cache
        (biz_no_normalized, date_from, date_to, result_json, cached_at_ms, result_version)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (biz_no_normalized, date_from, date_to) DO UPDATE SET
        result_json = excluded.result_json,
        cached_at_ms = excluded.cached_at_ms,
        result_version = excluded.result_version
    `).run(
      key.bizNoNormalized,
      key.dateFrom,
      key.dateTo,
      JSON.stringify(result),
      this.now(),
      COMPETITOR_CONTRACT_QUERY_RESULT_VERSION,
    );
  }

  getFreshIntervals(key: CompetitorContractQueryCacheKey): CompetitorContractCachedInterval[] {
    const now = this.now();
    this.pruneIntervals(now);
    const rows = this.sqlite.prepare(`
      SELECT date_from, date_to, result_json FROM competitor_contract_interval_cache
      WHERE biz_no_normalized = ? AND date_from <= ? AND date_to >= ?
      ORDER BY date_from, date_to
    `).all(key.bizNoNormalized, key.dateTo, key.dateFrom) as Array<{
      date_from: string;
      date_to: string;
      result_json: string;
    }>;
    const intervals: CompetitorContractCachedInterval[] = [];
    for (const row of rows) {
      try {
        intervals.push({
          dateFrom: row.date_from,
          dateTo: row.date_to,
          result: JSON.parse(row.result_json) as CompetitorContractSearchResult,
        });
      } catch {
        this.sqlite.prepare(`
          DELETE FROM competitor_contract_interval_cache
          WHERE biz_no_normalized = ? AND date_from = ? AND date_to = ?
        `).run(key.bizNoNormalized, row.date_from, row.date_to);
      }
    }
    return intervals;
  }

  setInterval(key: CompetitorContractQueryCacheKey, result: CompetitorContractSearchResult): void {
    this.sqlite.prepare(`
      INSERT INTO competitor_contract_interval_cache
        (biz_no_normalized, date_from, date_to, result_json, cached_at_ms, result_version)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (biz_no_normalized, date_from, date_to) DO UPDATE SET
        result_json = excluded.result_json,
        cached_at_ms = excluded.cached_at_ms,
        result_version = excluded.result_version
    `).run(
      key.bizNoNormalized,
      key.dateFrom,
      key.dateTo,
      JSON.stringify(result),
      this.now(),
      COMPETITOR_CONTRACT_QUERY_RESULT_VERSION,
    );
  }

  private delete(key: CompetitorContractQueryCacheKey) {
    this.sqlite.prepare(`
      DELETE FROM competitor_contract_query_cache
      WHERE biz_no_normalized = ? AND date_from = ? AND date_to = ?
    `).run(key.bizNoNormalized, key.dateFrom, key.dateTo);
  }

  private pruneIntervals(now: number) {
    this.sqlite.prepare(`
      DELETE FROM competitor_contract_interval_cache
      WHERE cached_at_ms <= ? OR result_version <> ?
    `).run(now - this.ttlMs, COMPETITOR_CONTRACT_QUERY_RESULT_VERSION);
  }
}
