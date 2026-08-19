import type Database from "better-sqlite3";

import { SqliteCompetitorQueryCache } from "./cache";
import {
  searchCompetitorContracts,
  type CompetitorContractFetch,
  type CompetitorContractCoverage,
  type CompetitorContractSleep,
} from "./contracts";
import { enrichCompetitorStandardContractItemCodes } from "./purchase-target-products";
import { deleteCompetitorThirdPartyDeliveryCacheInRange, searchCompetitorThirdPartyDeliveries } from "./third-party-deliveries";
import {
  buildCompetitorSalesOverview,
  COMPETITOR_SALES_REGISTRY,
  resolveCompetitorSalesPeriod,
  type CompetitorSalesOverview,
  type CompetitorSalesPeriodQuery,
} from "./overview";

export type CompetitorOverviewServiceInput = {
  query: CompetitorSalesPeriodQuery;
  serviceKey: string;
  sqlite: Database.Database;
  fetchImpl?: CompetitorContractFetch;
  sleep?: CompetitorContractSleep;
  now?: () => Date;
  signal?: AbortSignal;
  cacheOnly?: boolean;
  refreshRecent?: boolean;
};

export async function getCompetitorSalesOverview(
  input: CompetitorOverviewServiceInput,
): Promise<CompetitorSalesOverview & { coverage: CompetitorContractCoverage }> {
  const now = (input.now ?? (() => new Date()))();
  const period = resolveCompetitorSalesPeriod(input.query, now);
  const queryCache = new SqliteCompetitorQueryCache(input.sqlite);
  const registryKey = buildRegistryKey(COMPETITOR_SALES_REGISTRY.map((competitor) => competitor.bizNo));
  await maybeInvalidateRecentCaches({
    enabled: input.refreshRecent === true && !input.cacheOnly,
    period,
    queryCache,
    sqlite: input.sqlite,
    registryKey,
  });
  const [contractOutcome, deliveryOutcome] = await Promise.allSettled([
    searchCompetitorContracts(
      {
        bizNo: COMPETITOR_SALES_REGISTRY.map((competitor) => competitor.bizNo).join(","),
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
      },
      {
        serviceKey: input.serviceKey,
        queryCache,
        fetchImpl: input.fetchImpl,
        sleep: input.sleep,
        now: input.now,
        signal: input.signal,
        cacheOnly: input.cacheOnly,
      },
    ),
    searchCompetitorThirdPartyDeliveries(
      {
        bizNos: COMPETITOR_SALES_REGISTRY.map((competitor) => competitor.bizNo),
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
      },
      {
        serviceKey: input.serviceKey,
        sqlite: input.sqlite,
        fetchImpl: input.fetchImpl,
        now: input.now,
        signal: input.signal,
        cacheOnly: input.cacheOnly,
      },
    ),
  ]);
  if (contractOutcome.status === "rejected") throw contractOutcome.reason;
  if (deliveryOutcome.status === "rejected") throw deliveryOutcome.reason;
  const result = contractOutcome.value;
  const deliveries = deliveryOutcome.value;
  const enrichedRows = await enrichCompetitorStandardContractItemCodes(result.rows, {
    serviceKey: input.serviceKey,
    sqlite: input.sqlite,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
    cacheOnly: input.cacheOnly,
    now: input.now,
  });
  const overview = buildCompetitorSalesOverview({
    period,
    rows: [...enrichedRows, ...deliveries.rows],
    collectedAt: [result.fetchedAt, deliveries.fetchedAt].filter((value): value is string => Boolean(value)).sort().at(-1)
      ?? now.toISOString(),
  });
  return { ...overview, coverage: mergeCoverage(result.coverage, deliveries.coverage) };
}

function mergeCoverage(...coverages: CompetitorContractCoverage[]): CompetitorContractCoverage {
  const missingRanges = new Map<string, { dateFrom: string; dateTo: string }>();
  for (const coverage of coverages) {
    for (const range of coverage.missingRanges) {
      missingRanges.set(`${range.dateFrom}:${range.dateTo}`, range);
    }
  }
  return {
    complete: coverages.every((coverage) => coverage.complete),
    fresh: coverages.every((coverage) => coverage.fresh),
    missingRanges: [...missingRanges.values()].sort((left, right) =>
      left.dateFrom.localeCompare(right.dateFrom) || left.dateTo.localeCompare(right.dateTo),
    ),
  };
}

const RECENT_REFRESH_LOOKBACK_DAYS = 13;

async function maybeInvalidateRecentCaches(input: {
  enabled: boolean;
  period: { dateFrom: string; dateTo: string };
  queryCache: SqliteCompetitorQueryCache;
  sqlite: Database.Database;
  registryKey: string;
}): Promise<void> {
  if (!input.enabled) return;
  const candidateFrom = shiftUtcDays(input.period.dateTo, -RECENT_REFRESH_LOOKBACK_DAYS);
  const dateFrom = candidateFrom < input.period.dateFrom ? input.period.dateFrom : candidateFrom;
  const dateTo = input.period.dateTo;
  input.queryCache.deleteIntersecting({ bizNoNormalized: input.registryKey, dateFrom, dateTo });
  deleteCompetitorThirdPartyDeliveryCacheInRange(input.sqlite, input.registryKey, dateFrom, dateTo);
}

function buildRegistryKey(bizNos: readonly string[]): string {
  const normalized = new Set<string>();
  for (const bizNo of bizNos) {
    const digits = bizNo.replace(/\D/g, "");
    if (digits) normalized.add(digits);
  }
  return [...normalized].sort().join(",");
}

function shiftUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
