import { describe, expect, it } from "vitest";

import type { CompetitorSalesPeriod } from "@/lib/competitors/types";

import {
  buildOverviewQuery,
  cacheCollectionStatus,
  formatCompetitorAmount,
  getAvailableMonths,
  getAvailableQuarters,
  getSeoulPeriodSelection,
  getSeoulYearOptions,
  hasCachedOverviewData,
  periodContext,
  sortCompaniesBySales,
  switchPeriodSelection,
} from "@/components/CompetitorSalesApp";

describe("competitor sales period selection", () => {
  it("uses the current Seoul month for the initial selection", () => {
    expect(getSeoulPeriodSelection(new Date("2026-07-31T15:30:00.000Z"))).toEqual({
      period: "month",
      year: 2026,
      month: 8,
    });
  });

  it("builds only the selected period fields into the overview query", () => {
    expect(buildOverviewQuery({ period: "quarter", year: 2025, quarter: 3 })).toBe(
      "period=quarter&year=2025&quarter=3",
    );
  });

  it("adds cacheOnly to the first-stage overview query", () => {
    expect(buildOverviewQuery({ period: "year", year: 2026 }, { cacheOnly: true })).toBe(
      "period=year&year=2026&cacheOnly=1",
    );
  });

  it("lists years from the current Seoul year through 2020", () => {
    expect(getSeoulYearOptions(new Date("2026-07-22T03:00:00.000Z"))).toEqual([
      2026, 2025, 2024, 2023, 2022, 2021, 2020,
    ]);
  });

  it("limits current-year months and quarters to the current Seoul period", () => {
    const now = new Date("2026-07-31T15:30:00.000Z");

    expect(getAvailableMonths(2026, now)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(getAvailableQuarters(2026, now)).toEqual([1, 2, 3]);
    expect(getAvailableMonths(2025, now)).toHaveLength(12);
    expect(getAvailableQuarters(2025, now)).toEqual([1, 2, 3, 4]);
  });

  it("uses the current Seoul month and quarter when switching tabs", () => {
    const now = new Date("2026-07-31T15:30:00.000Z");

    expect(switchPeriodSelection({ period: "year", year: 2025 }, "month", now)).toEqual({
      period: "month",
      year: 2025,
      month: 8,
    });
    expect(switchPeriodSelection({ period: "month", year: 2025, month: 2 }, "quarter", now)).toEqual({
      period: "quarter",
      year: 2025,
      quarter: 3,
    });
  });

  it("describes the selected period without using a stale overview period", () => {
    const stalePeriod: CompetitorSalesPeriod = {
      period: "year",
      year: 2025,
      month: null,
      quarter: null,
      label: "2025년",
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
      cacheKey: "test",
    };

    expect(
      periodContext({ period: "month", year: 2026, month: 7 }, stalePeriod),
    ).toBe("2026년 7월 조달우수 지정 업체의 계약을 집계합니다.");
  });
});

describe("competitor sales cache collection status", () => {
  it("identifies an incomplete cached result and names the missing period collection state", () => {
    expect(cacheCollectionStatus({
      complete: false,
      fresh: false,
      missingRanges: [{ dateFrom: "2026-01-01", dateTo: "2026-06-30" }],
    })).toEqual({
      isPartial: true,
      message: "저장된 결과를 먼저 표시하고 누락 기간을 조회 중입니다.",
    });
  });

  it("does not show a collection state for complete cache coverage", () => {
    expect(cacheCollectionStatus({ complete: true, fresh: true, missingRanges: [] })).toEqual({
      isPartial: false,
      message: null,
    });
  });

  it("keeps a complete but stale cache visible while checking for newer data", () => {
    expect(cacheCollectionStatus({ complete: true, fresh: false, missingRanges: [] })).toEqual({
      isPartial: false,
      message: "저장된 전체 결과를 표시하고 최신 데이터를 확인 중입니다.",
    });
  });
});

describe("cached overview visibility", () => {
  const period = { dateFrom: "2026-01-01", dateTo: "2026-12-31" };
  const emptyCompanies = [{ contracts: [] }];

  it("keeps skeletons only when the whole requested period is missing from cache", () => {
    expect(hasCachedOverviewData({
      coverage: {
        complete: false,
        fresh: false,
        missingRanges: [{ dateFrom: "2026-01-01", dateTo: "2026-12-31" }],
      },
      companies: emptyCompanies,
      period,
    })).toBe(false);
  });

  it("shows a cached zero-contract segment while another segment is still missing", () => {
    expect(hasCachedOverviewData({
      coverage: {
        complete: false,
        fresh: false,
        missingRanges: [{ dateFrom: "2026-07-01", dateTo: "2026-12-31" }],
      },
      companies: emptyCompanies,
      period,
    })).toBe(true);
  });
});

describe("competitor sales display helpers", () => {
  it("sorts companies by contract amount while preserving registry order for ties", () => {
    const companies = [
      { competitorId: "third", totalAmount: 100, displayOrder: 3 },
      { competitorId: "first", totalAmount: 500, displayOrder: 1 },
      { competitorId: "second", totalAmount: 500, displayOrder: 2 },
    ];

    expect(sortCompaniesBySales(companies).map((company) => company.competitorId)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("marks equal-share company totals as estimates", () => {
    expect(
      formatCompetitorAmount({
        totalAmount: 1_250_000,
        collectionStatus: "collected",
        contracts: [{ amountAttribution: "equal-share" }],
      }),
    ).toBe("1,250,000원 (추정 포함)");
  });
});
