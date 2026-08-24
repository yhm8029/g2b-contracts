import {
  matchesMarketRegion,
  type ReportRegion,
} from "./regions";
import { isExcludedMarketFrameworkName } from "./rules";

export { isReportRegion } from "./regions";
export type { ReportRegion } from "./regions";

export type MarketAwardInput = {
  noticeNo: string;
  noticeOrder: string;
  finalAwardDate: string;
  winnerBizNo: string;
  winnerName: string;
  noticeName?: string | null;
  demandAgencyName?: string | null;
  amount?: number | null;
};

export type MarketContractInput = {
  contractNo: string;
  contractName: string;
  contractDate: string;
  winnerBizNo: string;
  winnerName: string;
  noticeNo?: string | null;
  noticeOrder?: string | null;
  demandAgencyName?: string | null;
  amount?: number | null;
};

export type ExcellentRegistryEntry = {
  bizNo: string;
  companyName: string;
  designationStartDate: string;
  designationEndDate: string;
  enabled: boolean;
};

export type MarketShareRow = {
  companyName: string;
  bizNo: string | null;
  designationEndDate: string | null;
  category: "excellent" | "non_excellent" | "cooperative";
  awardCount: number;
  marketSharePercent: number;
};

export type MarketShareReport = {
  period: { year: number; quarter?: number };
  periodLabel: string;
  totalAwardCount: number;
  rows: MarketShareRow[];
};

export type ReportBasis = "award" | "contract" | "combined";

export const COOPERATIVE_NAME = "\uBE4C\uB529\uC790\uB3D9\uC81C\uC5B4\uACF5\uC5C5\uD611\uB3D9\uC870\uD569";
export const NON_EXCELLENT_NAME = "\uC870\uB2EC\uC6B0\uC218X";

export function isReportBasis(value: unknown): value is ReportBasis {
  return value === "award" || value === "contract" || value === "combined";
}

export type AwardRecord = MarketAwardInput & { referenceDate: string };
export type ContractRecord = MarketContractInput & { referenceDate: string };

export function selectAwardRecords(input: {
  basis: ReportBasis;
  region: ReportRegion;
  awards: MarketAwardInput[];
  contracts: MarketContractInput[];
}): AwardRecord[] {
  const awardRecords = input.awards.filter((award) => !isExcludedMarketFrameworkName(award.noticeName)).map((award) => ({
      noticeNo: award.noticeNo,
      noticeOrder: award.noticeOrder,
      finalAwardDate: award.finalAwardDate,
      winnerBizNo: award.winnerBizNo,
      winnerName: award.winnerName,
      noticeName: award.noticeName,
      demandAgencyName: award.demandAgencyName,
      amount: award.amount,
      referenceDate: award.finalAwardDate,
    })).filter((record) => matchesMarketRegion(record.demandAgencyName, input.region, record.noticeName));
  const sourceContracts = input.basis === "combined"
    ? removeCrossSourceDuplicateContracts(input.awards, input.contracts)
    : input.contracts;
  const contractRecords = aggregateContractsAsAwards(sourceContracts, input.region);
  if (input.basis === "award") return awardRecords;
  if (input.basis === "contract") return contractRecords;
  return [...awardRecords, ...contractRecords];
}

export function selectContractRecords(input: {
  basis: ReportBasis;
  region: ReportRegion;
  awards: MarketAwardInput[];
  contracts: MarketContractInput[];
}): ContractRecord[] {
  const sourceContracts = input.basis === "combined"
    ? removeCrossSourceDuplicateContracts(input.awards, input.contracts)
    : input.contracts;
  const contractRecords = sourceContracts.map((contract) => ({
      contractNo: contract.contractNo,
      contractName: contract.contractName,
      contractDate: contract.contractDate,
      winnerBizNo: contract.winnerBizNo,
      winnerName: contract.winnerName,
      noticeNo: contract.noticeNo,
      noticeOrder: contract.noticeOrder,
      demandAgencyName: contract.demandAgencyName,
      amount: contract.amount,
      referenceDate: contract.contractDate,
    })).filter((record) => matchesMarketRegion(record.demandAgencyName, input.region, record.contractName));
  const awardRecords = aggregateAwardsAsContracts(input.awards, input.region);
  if (input.basis === "contract") return contractRecords;
  if (input.basis === "award") return awardRecords;
  return [...awardRecords, ...contractRecords];
}

function aggregateContractsAsAwards(contracts: MarketContractInput[], region: ReportRegion): AwardRecord[] {
  return contracts
    .filter((contract) => matchesMarketRegion(contract.demandAgencyName, region, contract.contractName))
    .map((contract) => ({
      noticeNo: contract.noticeNo ?? contract.contractNo,
      noticeOrder: contract.noticeOrder ?? "",
      finalAwardDate: contract.contractDate,
      winnerBizNo: contract.winnerBizNo,
      winnerName: contract.winnerName,
      noticeName: contract.contractName,
      demandAgencyName: contract.demandAgencyName,
      amount: contract.amount,
      referenceDate: contract.contractDate,
    }));
}

function aggregateAwardsAsContracts(awards: MarketAwardInput[], region: ReportRegion): ContractRecord[] {
  return awards
    .filter((award) => !isExcludedMarketFrameworkName(award.noticeName))
    .filter((award) => matchesMarketRegion(award.demandAgencyName, region, award.noticeName))
    .map((award) => ({
      contractNo: `${award.noticeNo}-${award.noticeOrder}`,
      contractName: award.noticeName ?? "",
      contractDate: award.finalAwardDate,
      winnerBizNo: award.winnerBizNo,
      winnerName: award.winnerName,
      noticeNo: award.noticeNo,
      noticeOrder: award.noticeOrder,
      demandAgencyName: award.demandAgencyName,
      amount: award.amount,
      referenceDate: award.finalAwardDate,
    }));
}

export function removeCrossSourceDuplicateContracts<T extends MarketContractInput>(
  awards: MarketAwardInput[],
  contracts: T[],
): T[] {
  const awardKeys = new Set(
    awards
      .filter((award) => !isExcludedMarketFrameworkName(award.noticeName))
      .map((award) => crossSourceMatchKey({
        name: award.noticeName,
        amount: award.amount,
        bizNo: award.winnerBizNo,
        demandAgencyName: award.demandAgencyName,
      }))
      .filter((key): key is string => key !== null),
  );
  return contracts.filter((contract) => {
    const key = crossSourceMatchKey({
      name: contract.contractName,
      amount: contract.amount,
      bizNo: contract.winnerBizNo,
      demandAgencyName: contract.demandAgencyName,
    });
    return key === null || !awardKeys.has(key);
  });
}

function crossSourceMatchKey(input: {
  name: string | null | undefined;
  amount: number | null | undefined;
  bizNo: string;
  demandAgencyName: string | null | undefined;
}): string | null {
  const name = normalizeMatchText(input.name);
  const agency = normalizeMatchText(input.demandAgencyName);
  const bizNo = input.bizNo.replace(/\D/g, "");
  if (!name || !agency || bizNo.length !== 10 || input.amount === null || input.amount === undefined || !Number.isFinite(input.amount)) {
    return null;
  }
  return `${name}|${input.amount}|${bizNo}|${agency}`;
}

function normalizeMatchText(value: string | null | undefined): string {
  return value?.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "") ?? "";
}

export function buildMarketShareReport(input: {
  period: { year: number; quarter?: number };
  awards: MarketAwardInput[];
  contracts?: MarketContractInput[];
  basis?: ReportBasis;
  region?: ReportRegion;
  excellentRegistry: ExcellentRegistryEntry[];
  cooperativeBizNo: string;
}): MarketShareReport {
  validatePeriod(input.period);
  const basis: ReportBasis = input.basis ?? "award";
  const region: ReportRegion = input.region ?? "all";
  const excellent = input.excellentRegistry.filter((entry) => entry.enabled);
  const rows: MarketShareRow[] = excellent.map((entry) => ({
    companyName: entry.companyName,
    bizNo: normalizeBizNo(entry.bizNo),
    designationEndDate: entry.designationEndDate,
    category: "excellent",
    awardCount: 0,
    marketSharePercent: 0,
  }));
  const excellentByBizNo = new Map(
    excellent.map((entry, index) => [normalizeBizNo(entry.bizNo), { entry, row: rows[index] }]),
  );
  const nonExcellent: MarketShareRow = {
    companyName: NON_EXCELLENT_NAME,
    bizNo: null,
    designationEndDate: null,
    category: "non_excellent",
    awardCount: 0,
    marketSharePercent: 0,
  };
  const cooperative: MarketShareRow = {
    companyName: COOPERATIVE_NAME,
    bizNo: normalizeBizNo(input.cooperativeBizNo),
    designationEndDate: null,
    category: "cooperative",
    awardCount: 0,
    marketSharePercent: 0,
  };

  const records = selectAwardRecords({ basis, region, awards: input.awards, contracts: input.contracts ?? [] });

  for (const award of records) {
    if (!isValidDate(award.finalAwardDate) || !isInPeriod(award.finalAwardDate, input.period)) continue;
    const winnerBizNo = normalizeBizNo(award.winnerBizNo);
    if (winnerBizNo && winnerBizNo === cooperative.bizNo) {
      cooperative.awardCount += 1;
      continue;
    }
    const match = excellentByBizNo.get(winnerBizNo);
    if (
      match
      && isValidDate(match.entry.designationStartDate)
      && isValidDate(match.entry.designationEndDate)
      && award.finalAwardDate >= match.entry.designationStartDate
      && award.finalAwardDate <= match.entry.designationEndDate
    ) {
      match.row.awardCount += 1;
    } else {
      nonExcellent.awardCount += 1;
    }
  }

  rows.push(nonExcellent, cooperative);
  const totalAwardCount = rows.reduce((total, row) => total + row.awardCount, 0);
  for (const row of rows) {
    row.marketSharePercent = totalAwardCount === 0 ? 0 : row.awardCount / totalAwardCount * 100;
  }

  return {
    period: input.period,
    periodLabel: input.period.quarter
      ? `${input.period.year}\uB144 ${input.period.quarter}\uBD84\uAE30`
      : `${input.period.year}\uB144`,
    totalAwardCount,
    rows,
  };
}

function validatePeriod(period: { year: number; quarter?: number }) {
  if (!Number.isInteger(period.year) || period.year < 2025 || period.year > 2100) {
    throw new Error("year must be an integer between 2025 and 2100");
  }
  if (period.quarter !== undefined && (!Number.isInteger(period.quarter) || period.quarter < 1 || period.quarter > 4)) {
    throw new Error("quarter must be an integer between 1 and 4");
  }
}

function normalizeBizNo(value: string) {
  return value.replace(/\D/g, "");
}

function isInPeriod(date: string, period: { year: number; quarter?: number }) {
  if (Number(date.slice(0, 4)) !== period.year) return false;
  return period.quarter === undefined || Math.ceil(Number(date.slice(5, 7)) / 3) === period.quarter;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
