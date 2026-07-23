import type Database from "better-sqlite3";

import { SqliteCompetitorQueryCache } from "./cache";
import {
  searchCompetitorContracts,
  type CompetitorContractFetch,
  type CompetitorContractCoverage,
  type CompetitorContractSleep,
} from "./contracts";
import { searchCompetitorThirdPartyDeliveries } from "./third-party-deliveries";
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
};

export async function getCompetitorSalesOverview(
  input: CompetitorOverviewServiceInput,
): Promise<CompetitorSalesOverview & { coverage: CompetitorContractCoverage }> {
  const now = (input.now ?? (() => new Date()))();
  const period = resolveCompetitorSalesPeriod(input.query, now);
  const [contractOutcome, deliveryOutcome] = await Promise.allSettled([
    searchCompetitorContracts(
      {
        bizNo: COMPETITOR_SALES_REGISTRY.map((competitor) => competitor.bizNo).join(","),
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
      },
      {
        serviceKey: input.serviceKey,
        queryCache: new SqliteCompetitorQueryCache(input.sqlite),
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
  const overview = buildCompetitorSalesOverview({
    period,
    rows: [...result.rows, ...deliveries.rows],
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
