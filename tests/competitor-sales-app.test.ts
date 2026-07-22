import { describe, expect, it } from "vitest";

import type { CompetitorSalesPeriod } from "@/lib/competitors/types";

import {
  buildOverviewQuery,
  formatCompetitorAmount,
  getAvailableMonths,
  getAvailableQuarters,
  getSeoulPeriodSelection,
  getSeoulYearOptions,
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
