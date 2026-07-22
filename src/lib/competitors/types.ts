export type {
  CompetitorContractCoverage,
  CompetitorContractRow,
  CompetitorContractSearchResponse,
  CompetitorContractSearchResult,
} from "./contracts";
export type {
  CompetitorSalesOverview,
  CompetitorSalesPeriod,
  CompetitorSalesPeriodQuery,
  CompetitorSalesRegistryItem,
  CompetitorSalesRelatedContract,
} from "./overview";

import type { CompetitorContractCoverage } from "./contracts";
import type { CompetitorSalesOverview } from "./overview";

export type CompetitorSalesOverviewResponse = CompetitorSalesOverview & {
  coverage: CompetitorContractCoverage;
};
