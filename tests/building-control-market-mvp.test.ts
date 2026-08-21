import { describe, expect, it } from "vitest";

import {
  buildMarketShareReport,
  type ExcellentRegistryEntry,
  type MarketAwardInput,
} from "@/lib/building-control-market/report";

const cooperative = "111-22-33333";

const excellentRegistry: ExcellentRegistryEntry[] = [
  {
    bizNo: "222-33-44444",
    companyName: "한빛제어",
    designationStartDate: "2026-01-01",
    designationEndDate: "2026-12-31",
    enabled: true,
  },
  {
    bizNo: "333-44-55555",
    companyName: "미래시스템",
    designationStartDate: "2026-04-01",
    designationEndDate: "2026-12-31",
    enabled: true,
  },
  {
    bizNo: "444-55-66666",
    companyName: "비활성업체",
    designationStartDate: "2026-01-01",
    designationEndDate: "2026-12-31",
    enabled: false,
  },
];

describe("buildMarketShareReport", () => {
  it("classifies 2026 Q1 awards and keeps zero-count excellent rows", () => {
    const awards: MarketAwardInput[] = [
      { noticeNo: "N-001", noticeOrder: "1", finalAwardDate: "2026-02-15", winnerBizNo: "222-33-44444", winnerName: "한빛제어" },
      { noticeNo: "N-002", noticeOrder: "1", finalAwardDate: "2026-01-20", winnerBizNo: "555-66-77777", winnerName: "일반업체" },
      { noticeNo: "N-003", noticeOrder: "1", finalAwardDate: "2026-03-10", winnerBizNo: cooperative, winnerName: "빌딩자동제어공업협동조합" },
    ];

    const report = buildMarketShareReport({
      period: { year: 2026, quarter: 1 },
      awards,
      excellentRegistry,
      cooperativeBizNo: cooperative,
    });

    expect(report.periodLabel).toBe("2026년 1분기");
    expect(report.totalAwardCount).toBe(3);
    expect(report.rows.find((row) => row.companyName === "한빛제어")).toMatchObject({ awardCount: 1, category: "excellent" });
    expect(report.rows.find((row) => row.companyName === "조달우수X")).toMatchObject({ awardCount: 1, category: "non_excellent" });
    expect(report.rows.find((row) => row.companyName === "빌딩자동제어공업협동조합")).toMatchObject({ awardCount: 1, category: "cooperative" });
    expect(report.rows.find((row) => row.companyName === "미래시스템")).toMatchObject({ awardCount: 0, marketSharePercent: 0 });
    expect(report.rows.find((row) => row.companyName === "한빛제어")?.marketSharePercent).toBeCloseTo(33.333, 2);
    expect(report.rows).toHaveLength(4);
  });

  it("attributes an award before designation start to 조달우수X", () => {
    const report = buildMarketShareReport({
      period: { year: 2026, quarter: 1 },
      awards: [{ noticeNo: "N-010", noticeOrder: "1", finalAwardDate: "2026-01-15", winnerBizNo: "333-44-55555", winnerName: "미래시스템" }],
      excellentRegistry,
      cooperativeBizNo: cooperative,
    });

    expect(report.rows.find((row) => row.companyName === "미래시스템")?.awardCount).toBe(0);
    expect(report.rows.find((row) => row.companyName === "조달우수X")).toMatchObject({ awardCount: 1, marketSharePercent: 100 });
  });

  it("includes all quarters for a year and excludes disabled registry rows", () => {
    const report = buildMarketShareReport({
      period: { year: 2026 },
      awards: [
        { noticeNo: "N-Q1", noticeOrder: "1", finalAwardDate: "2026-02-01", winnerBizNo: "222-33-44444", winnerName: "한빛제어" },
        { noticeNo: "N-Q2", noticeOrder: "1", finalAwardDate: "2026-05-01", winnerBizNo: "333-44-55555", winnerName: "미래시스템" },
        { noticeNo: "N-Q3", noticeOrder: "1", finalAwardDate: "2026-08-01", winnerBizNo: cooperative, winnerName: "빌딩자동제어공업협동조합" },
        { noticeNo: "N-Q4", noticeOrder: "1", finalAwardDate: "2026-11-01", winnerBizNo: "555-66-77777", winnerName: "일반업체" },
      ],
      excellentRegistry,
      cooperativeBizNo: cooperative,
    });

    expect(report.periodLabel).toBe("2026년");
    expect(report.totalAwardCount).toBe(4);
    expect(report.rows.find((row) => row.companyName === "한빛제어")?.marketSharePercent).toBe(25);
    expect(report.rows.find((row) => row.companyName === "미래시스템")?.marketSharePercent).toBe(25);
    expect(report.rows.some((row) => row.companyName === "비활성업체")).toBe(false);
  });
});
