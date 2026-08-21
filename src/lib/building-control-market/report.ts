export type MarketAwardInput = {
  noticeNo: string;
  noticeOrder: string;
  finalAwardDate: string;
  winnerBizNo: string;
  winnerName: string;
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

const COOPERATIVE_NAME = "빌딩자동제어공업협동조합";
const NON_EXCELLENT_NAME = "조달우수X";

export function buildMarketShareReport(input: {
  period: { year: number; quarter?: number };
  awards: MarketAwardInput[];
  excellentRegistry: ExcellentRegistryEntry[];
  cooperativeBizNo: string;
}): MarketShareReport {
  validatePeriod(input.period);
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

  for (const award of input.awards) {
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
      ? `${input.period.year}년 ${input.period.quarter}분기`
      : `${input.period.year}년`,
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
