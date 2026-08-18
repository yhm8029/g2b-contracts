import type { CompetitorContractRow } from "./contracts";
import { classifyAutomaticControlBemsContract, COMPETITOR_REGISTRY } from "./registry";

export const COMPETITOR_SALES_RULE_VERSION = "v3";
const TARGET_ITEM_CODE = "3912180101";

const COMPETITOR_DESIGNATION_START_DATES: Readonly<Record<string, string>> = {
  "2026058": "2026-07-20", "2025208": "2026-01-19", "2025205": "2026-01-19", "2025140": "2026-01-18",
  "2025135": "2025-10-20", "2025074": "2025-07-21", "2025073": "2025-07-21", "2024064": "2024-09-13",
  "2024063": "2024-07-15", "2024150": "2024-07-15", "2024018": "2024-04-15", "2024004": "2024-04-15",
  "2023197": "2024-01-22", "2022241": "2023-03-17", "2022186": "2022-10-24", "2022061": "2022-05-02",
  "2021037": "2021-06-07", "2020239": "2021-03-22", "2020220": "2021-03-22", "2020111": "2020-11-10",
  "2020101": "2020-11-10", "2020059": "2020-07-31",
};

export type CompetitorSalesRegistryItem = {
  competitorId: string;
  companyName: string;
  bizNo: string;
  designationNo: string;
  designationStartDate: string;
  designationEndDate: string;
  itemCode: typeof TARGET_ITEM_CODE;
  displayOrder: number;
};

export const COMPETITOR_SALES_REGISTRY: readonly CompetitorSalesRegistryItem[] = COMPETITOR_REGISTRY.map(
  (competitor) => {
    const designationStartDate = COMPETITOR_DESIGNATION_START_DATES[competitor.designationNo];
    if (!designationStartDate) throw new Error(`Missing verified designation start date: ${competitor.designationNo}`);
    return {
    ...competitor,
    designationStartDate,
    designationEndDate: designationEndDate(designationStartDate),
    itemCode: TARGET_ITEM_CODE,
    };
  },
);

export type CompetitorSalesPeriodQuery =
  | { period: "month"; year: number; month?: number; quarter?: number }
  | { period: "quarter"; year: number; month?: number; quarter?: number }
  | { period: "year"; year: number; month?: number; quarter?: number };

export type CompetitorSalesPeriod = {
  period: "month" | "quarter" | "year";
  year: number;
  month: number | null;
  quarter: number | null;
  label: string;
  dateFrom: string;
  dateTo: string;
  cacheKey: string;
};

export type CompetitorSalesRelatedContract = CompetitorContractRow & {
  positiveSignals: string[];
  conflictingSignals: string[];
  sourceRowCount: number;
};

export type CompetitorSalesOverview = {
  period: CompetitorSalesPeriod;
  status: "ready" | "uncollected" | "collecting" | "failed";
  collectedAt: string | null;
  totalContractCount: number | null;
  totalAmount: number | null;
  latestContractDate: string | null;
  companies: Array<CompetitorSalesRegistryItem & {
    collectionStatus: "collected" | "uncollected" | "collecting" | "failed";
    contractCount: number | null;
    totalAmount: number | null;
    latestContractDate: string | null;
    contracts: CompetitorSalesRelatedContract[];
  }>;
};

export function resolveCompetitorSalesPeriod(query: CompetitorSalesPeriodQuery, now: Date = new Date()): CompetitorSalesPeriod {
  const year = requireInteger(query.year, "year");
  let month: number | null = null;
  let quarter: number | null = null;
  let dateFrom: string;
  let dateTo: string;
  let label: string;
  let suffix: string;

  if (query.period === "month") {
    if (query.month === undefined) throw new Error("month is required");
    if (query.quarter !== undefined) throw new Error("quarter must not be set for month");
    month = requireRange(query.month, "month", 1, 12);
    dateFrom = formatDate(year, month, 1);
    dateTo = formatDate(year, month + 1, 0);
    label = `${year}-${String(month).padStart(2, "0")}`;
    suffix = "";
  } else if (query.period === "quarter") {
    if (query.quarter === undefined) throw new Error("quarter is required");
    if (query.month !== undefined) throw new Error("month must not be set for quarter");
    quarter = requireRange(query.quarter, "quarter", 1, 4);
    const startMonth = (quarter - 1) * 3 + 1;
    dateFrom = formatDate(year, startMonth, 1);
    dateTo = formatDate(year, startMonth + 3, 0);
    label = `${year}-Q${quarter}`;
    suffix = `${year}-Q${quarter}`;
  } else {
    if (query.month !== undefined) throw new Error("month must not be set for year");
    if (query.quarter !== undefined) throw new Error("quarter must not be set for year");
    dateFrom = formatDate(year, 1, 1);
    dateTo = formatDate(year + 1, 1, 0);
    label = String(year);
    suffix = String(year);
  }

  const seoulToday = seoulCalendarDate(now);
  if (dateFrom > seoulToday) throw new Error("future periods are not supported");
  if (dateTo > seoulToday) dateTo = seoulToday;
  return {
    period: query.period,
    year,
    month,
    quarter,
    label,
    dateFrom,
    dateTo,
    cacheKey: `${COMPETITOR_SALES_RULE_VERSION}:${query.period}:${suffix ? `${suffix}:` : ""}${dateFrom}:${dateTo}`,
  };
}

export function classifyCompetitorSalesContract(row: CompetitorContractRow) {
  if (isThirdPartyUnitPriceMasterCeiling(row)) {
    return { related: false, positiveSignals: [], conflictingSignals: [] };
  }
  const itemCodes = [...new Set((row.itemCodes ?? []).map(normalizeItemCode).filter(Boolean))];
  if (itemCodes.length > 0) {
    return { related: itemCodes.includes(TARGET_ITEM_CODE), positiveSignals: [], conflictingSignals: [] };
  }
  return classifyAutomaticControlBemsContract({
    ...row,
    contractName: [row.contractName, ...(row.itemNames ?? [])].join(" "),
  });
}

function isThirdPartyUnitPriceMasterCeiling(row: CompetitorContractRow) {
  return (
    row.sourceDataset === "g2b-public-standard-contract"
    && isThirdPartyUnitPriceContract(row)
    && normalizeDemandAgencyName(row.demandAgencyName) === "각수요기관"
  );
}

function isThirdPartyUnitPriceContract(row: Pick<CompetitorContractRow, "contractType" | "contractName">) {
  const thirdPartyUnitPriceContract = "제3자단가계약";
  if (normalizeContractType(row.contractType) === thirdPartyUnitPriceContract) return true;
  return normalizeContractType(row.contractName).includes(thirdPartyUnitPriceContract);
}

function normalizeContractType(value: string | undefined) {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, "");
}

function normalizeDemandAgencyName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

export function buildCompetitorSalesOverview(input: {
  period: CompetitorSalesPeriod;
  rows: readonly CompetitorContractRow[];
  collectedAt: string;
}): CompetitorSalesOverview {
  const registry = new Map(COMPETITOR_SALES_REGISTRY.map((competitor) => [competitor.bizNo, competitor]));
  const sourceGroups = new Map<string, CompetitorContractRow[]>();
  for (const row of input.rows) {
    if (row.sourceDataset === "g2b-public-standard-contract" && (row.amendmentOrder ?? 0) > 0) continue;
    if (!registry.has(row.bizNoNormalized)) continue;
    const key = contractIdentity(row);
    const group = sourceGroups.get(key) ?? [];
    group.push(row);
    sourceGroups.set(key, group);
  }

  const sourceRowCounts = new Map<string, number>();
  const latestRows: CompetitorContractRow[] = [];
  for (const [contractKey, rows] of sourceGroups) {
    const representative = [...rows].sort(compareRepresentativeRows)[0]!;
    latestRows.push(...rows.filter((row) => sameContractVersion(row, representative)));
    for (const row of rows) {
      const countKey = `${row.bizNoNormalized}:${contractKey}`;
      sourceRowCounts.set(countKey, (sourceRowCounts.get(countKey) ?? 0) + 1);
    }
  }

  const groups = new Map<string, CompetitorContractRow[]>();
  for (const row of latestRows) {
    const key = `${row.bizNoNormalized}:${contractIdentity(row)}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const byBusinessNumber = new Map<string, CompetitorSalesRelatedContract[]>();
  for (const rows of groups.values()) {
    const representative = [...rows].sort(compareRepresentativeRows)[0]!;
    const classification = classifyCompetitorSalesContract(representative);
    if (!classification.related) continue;
    const contracts = byBusinessNumber.get(representative.bizNoNormalized) ?? [];
    contracts.push({
      ...representative,
      ...classification,
      itemCodes: normalizeItemCodes(representative.itemCodes),
      sourceRowCount: sourceRowCounts.get(`${representative.bizNoNormalized}:${contractIdentity(representative)}`)
        ?? rows.length,
    });
    byBusinessNumber.set(representative.bizNoNormalized, contracts);
  }

  const companies = COMPETITOR_SALES_REGISTRY.map((competitor) => {
    const contracts = (byBusinessNumber.get(competitor.bizNo) ?? []).sort(compareContracts);
    return {
      ...competitor,
      collectionStatus: "collected" as const,
      contractCount: contracts.length,
      totalAmount: contracts.reduce((total, contract) => total + contract.totalContractAmount, 0),
      latestContractDate: contracts[0]?.contractDate ?? null,
      contracts,
    };
  }).sort((left, right) => right.totalAmount - left.totalAmount || left.displayOrder - right.displayOrder);
  const overallContracts = new Map<string, CompetitorSalesRelatedContract[]>();
  for (const company of companies) {
    for (const contract of company.contracts) {
      const key = contractIdentity(contract);
      const contracts = overallContracts.get(key) ?? [];
      contracts.push(contract);
      overallContracts.set(key, contracts);
    }
  }

  return {
    period: input.period,
    status: "ready",
    collectedAt: input.collectedAt,
    totalContractCount: overallContracts.size,
    totalAmount: [...overallContracts.values()].reduce((total, contracts) => {
      const attributedAmount = contracts.reduce((sum, contract) => sum + contract.totalContractAmount, 0);
      const latestContract = [...contracts].sort(compareRepresentativeRows)[0]!;
      const contractCeiling = latestContract.contractTotalAmount ?? attributedAmount;
      return total + Math.min(attributedAmount, contractCeiling);
    }, 0),
    latestContractDate: latestContractDate(companies.map((company) => company.latestContractDate)),
    companies,
  };
}

export function buildUnavailableCompetitorSalesOverview(input: {
  period: CompetitorSalesPeriod;
  status: "uncollected" | "collecting" | "failed";
}): CompetitorSalesOverview {
  const collectionStatus = input.status === "uncollected" ? "uncollected" : input.status;
  return {
    period: input.period,
    status: input.status,
    collectedAt: null,
    totalContractCount: null,
    totalAmount: null,
    latestContractDate: null,
    companies: COMPETITOR_SALES_REGISTRY.map((competitor) => ({
      ...competitor,
      collectionStatus,
      contractCount: null,
      totalAmount: null,
      latestContractDate: null,
      contracts: [],
    })),
  };
}

function contractIdentity(row: CompetitorContractRow) {
  const contractNo = row.contractNo.trim().toLowerCase();
  return contractNo || [
    row.contractName,
    row.demandAgencyName,
    row.originalContractDate ?? row.contractDate ?? "",
  ].map(normalizeText).join(":");
}

function compareRepresentativeRows(left: CompetitorContractRow, right: CompetitorContractRow) {
  return (
    (right.amendmentOrder ?? -1) - (left.amendmentOrder ?? -1)
    || (right.contractDate ?? "").localeCompare(left.contractDate ?? "")
    || right.totalContractAmount - left.totalContractAmount
  );
}

function compareContracts(left: CompetitorSalesRelatedContract, right: CompetitorSalesRelatedContract) {
  return (right.contractDate ?? "").localeCompare(left.contractDate ?? "") || right.totalContractAmount - left.totalContractAmount;
}

function sameContractVersion(left: CompetitorContractRow, right: CompetitorContractRow) {
  return (
    (left.amendmentOrder ?? null) === (right.amendmentOrder ?? null)
    && left.contractDate === right.contractDate
    && (left.contractTotalAmount ?? null) === (right.contractTotalAmount ?? null)
  );
}

function latestContractDate(dates: readonly (string | null)[]) {
  return dates.reduce<string | null>((latest, date) => date && (!latest || date > latest) ? date : latest, null);
}

function normalizeItemCodes(itemCodes: readonly string[] | undefined) {
  return [...new Set((itemCodes ?? []).map(normalizeItemCode).filter(Boolean))];
}

function normalizeItemCode(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? digits : "";
}

function designationEndDate(startDate: string) {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 6);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function requireInteger(value: number, name: string) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function requireRange(value: number, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

function formatDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

function seoulCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function normalizeText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
