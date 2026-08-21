export type MarketAwardInput = {
  noticeNo: string;
  noticeOrder: string;
  finalAwardDate: string;
  winnerBizNo: string;
  winnerName: string;
  noticeName?: string | null;
  demandAgencyName?: string | null;
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

export type ReportBasis = "award" | "contract";
export type ReportRegion = "all" | "busan";

export const COOPERATIVE_NAME = "\uBE4C\uB529\uC790\uB3D9\uC81C\uC5B4\uACF5\uC5C5\uD611\uB3D9\uC870\uD569";
export const NON_EXCELLENT_NAME = "\uC870\uB2EC\uC6B0\uC218X";

export function isReportBasis(value: unknown): value is ReportBasis {
  return value === "award" || value === "contract";
}

export function isReportRegion(value: unknown): value is ReportRegion {
  return value === "all" || value === "busan";
}

export function isBusanDemandAgency(name: string | undefined | null): boolean {
  if (!name) return false;
  return name.toLowerCase().includes("\uBD80\uC0B0");
}

export type AwardRecord = MarketAwardInput & { referenceDate: string };
export type ContractRecord = MarketContractInput & { referenceDate: string };

export function selectAwardRecords(input: {
  basis: ReportBasis;
  region: ReportRegion;
  awards: MarketAwardInput[];
  contracts: MarketContractInput[];
}): AwardRecord[] {
  if (input.basis === "award") {
    return input.awards.map((award) => ({
      noticeNo: award.noticeNo,
      noticeOrder: award.noticeOrder,
      finalAwardDate: award.finalAwardDate,
      winnerBizNo: award.winnerBizNo,
      winnerName: award.winnerName,
      noticeName: award.noticeName,
      demandAgencyName: award.demandAgencyName,
      referenceDate: award.finalAwardDate,
    })).filter((record) => matchesRegion(record.demandAgencyName, input.region));
  }
  return aggregateContractsAsAwards(input.contracts, input.region);
}

export function selectContractRecords(input: {
  basis: ReportBasis;
  region: ReportRegion;
  awards: MarketAwardInput[];
  contracts: MarketContractInput[];
}): ContractRecord[] {
  if (input.basis === "contract") {
    return input.contracts.map((contract) => ({
      contractNo: contract.contractNo,
      contractName: contract.contractName,
      contractDate: contract.contractDate,
      winnerBizNo: contract.winnerBizNo,
      winnerName: contract.winnerName,
      noticeNo: contract.noticeNo,
      noticeOrder: contract.noticeOrder,
      demandAgencyName: contract.demandAgencyName,
      referenceDate: contract.contractDate,
    })).filter((record) => matchesRegion(record.demandAgencyName, input.region));
  }
  return aggregateAwardsAsContracts(input.awards, input.region);
}

function aggregateContractsAsAwards(contracts: MarketContractInput[], region: ReportRegion): AwardRecord[] {
  return contracts
    .filter((contract) => matchesRegion(contract.demandAgencyName, region))
    .map((contract) => ({
      noticeNo: contract.noticeNo ?? contract.contractNo,
      noticeOrder: contract.noticeOrder ?? "",
      finalAwardDate: contract.contractDate,
      winnerBizNo: contract.winnerBizNo,
      winnerName: contract.winnerName,
      noticeName: contract.contractName,
      demandAgencyName: contract.demandAgencyName,
      referenceDate: contract.contractDate,
    }));
}

function aggregateAwardsAsContracts(awards: MarketAwardInput[], region: ReportRegion): ContractRecord[] {
  return awards
    .filter((award) => matchesRegion(award.demandAgencyName, region))
    .map((award) => ({
      contractNo: `${award.noticeNo}-${award.noticeOrder}`,
      contractName: award.noticeName ?? "",
      contractDate: award.finalAwardDate,
      winnerBizNo: award.winnerBizNo,
      winnerName: award.winnerName,
      noticeNo: award.noticeNo,
      noticeOrder: award.noticeOrder,
      demandAgencyName: award.demandAgencyName,
      referenceDate: award.finalAwardDate,
    }));
}

function matchesRegion(demandAgencyName: string | null | undefined, region: ReportRegion): boolean {
  if (region === "all") return true;
  return isBusanDemandAgency(demandAgencyName);
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
