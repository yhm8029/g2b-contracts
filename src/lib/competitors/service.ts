import type Database from "better-sqlite3";

import { SqliteCompetitorQueryCache } from "./cache";
import {
  searchCompetitorContracts,
  type CompetitorContractFetch,
  type CompetitorContractSleep,
} from "./contracts";
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
};

export async function getCompetitorSalesOverview(
  input: CompetitorOverviewServiceInput,
): Promise<CompetitorSalesOverview> {
  const now = (input.now ?? (() => new Date()))();
  const period = resolveCompetitorSalesPeriod(input.query, now);
  const result = await searchCompetitorContracts(
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
    },
  );
  return buildCompetitorSalesOverview({
    period,
    rows: result.rows,
    collectedAt: result.fetchedAt ?? now.toISOString(),
  });
}
