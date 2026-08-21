import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

import {
  buildMarketShareReport,
  selectAwardRecords,
  selectContractRecords,
  type ExcellentRegistryEntry,
  type MarketAwardInput,
  type MarketContractInput,
} from "@/lib/building-control-market/report";
import {
  initMarketStore,
  listMarketAwards,
  listMarketContracts,
  updateMarketAwardNoticeMetadata,
  upsertMarketAwards,
  upsertMarketContracts,
} from "@/lib/building-control-market/store";
import { demandAgencyNameFromNotice } from "@/lib/building-control-market/sync";

const cooperative = "111-22-33333";

const excellentRegistry: ExcellentRegistryEntry[] = [
  {
    bizNo: "222-33-44444",
    companyName: "\uD55C\uBE5B\uC81C\uC5B4",
    designationStartDate: "2026-01-01",
    designationEndDate: "2026-12-31",
    enabled: true,
  },
  {
    bizNo: "333-44-55555",
    companyName: "\uBBF8\uB798\uC2DC\uC2A4\uD15C",
    designationStartDate: "2026-04-01",
    designationEndDate: "2026-12-31",
    enabled: true,
  },
  {
    bizNo: "444-55-66666",
    companyName: "\uBE44\uD65C\uC131\uC5C5\uCCB4",
    designationStartDate: "2026-01-01",
    designationEndDate: "2026-12-31",
    enabled: false,
  },
];

describe("buildMarketShareReport", () => {
  it("classifies 2026 Q1 awards and keeps zero-count excellent rows", () => {
    const awards: MarketAwardInput[] = [
      { noticeNo: "N-001", noticeOrder: "1", finalAwardDate: "2026-02-15", winnerBizNo: "222-33-44444", winnerName: "\uD55C\uBE5B\uC81C\uC5B4" },
      { noticeNo: "N-002", noticeOrder: "1", finalAwardDate: "2026-01-20", winnerBizNo: "555-66-77777", winnerName: "\uC77C\uBC18\uC5C5\uCCB4" },
      { noticeNo: "N-003", noticeOrder: "1", finalAwardDate: "2026-03-10", winnerBizNo: cooperative, winnerName: "\uBE4C\uB529\uC790\uB3D9\uC81C\uC5B4\uACF5\uC5C5\uD611\uB3D9\uC870\uD569" },
    ];

    const report = buildMarketShareReport({
      period: { year: 2026, quarter: 1 },
      awards,
      excellentRegistry,
      cooperativeBizNo: cooperative,
    });

    expect(report.periodLabel).toBe("2026\uB144 1\uBD84\uAE30");
    expect(report.totalAwardCount).toBe(3);
    expect(report.rows.find((row) => row.companyName === "\uD55C\uBE5B\uC81C\uC5B4")).toMatchObject({ awardCount: 1, category: "excellent" });
    expect(report.rows.find((row) => row.companyName === "\uC870\uB2EC\uC6B0\uC218X")).toMatchObject({ awardCount: 1, category: "non_excellent" });
    expect(report.rows.find((row) => row.companyName === "\uBE4C\uB529\uC790\uB3D9\uC81C\uC5B4\uACF5\uC5C5\uD611\uB3D9\uC870\uD569")).toMatchObject({ awardCount: 1, category: "cooperative" });
    expect(report.rows.find((row) => row.companyName === "\uBBF8\uB798\uC2DC\uC2A4\uD15C")).toMatchObject({ awardCount: 0, marketSharePercent: 0 });
    expect(report.rows.find((row) => row.companyName === "\uD55C\uBE5B\uC81C\uC5B4")?.marketSharePercent).toBeCloseTo(33.333, 2);
    expect(report.rows).toHaveLength(4);
  });

  it("attributes an award before designation start to \uC870\uB2EC\uC6B0\uC218X", () => {
    const report = buildMarketShareReport({
      period: { year: 2026, quarter: 1 },
      awards: [{ noticeNo: "N-010", noticeOrder: "1", finalAwardDate: "2026-01-15", winnerBizNo: "333-44-55555", winnerName: "\uBBF8\uB798\uC2DC\uC2A4\uD15C" }],
      excellentRegistry,
      cooperativeBizNo: cooperative,
    });

    expect(report.rows.find((row) => row.companyName === "\uBBF8\uB798\uC2DC\uC2A4\uD15C")?.awardCount).toBe(0);
    expect(report.rows.find((row) => row.companyName === "\uC870\uB2EC\uC6B0\uC218X")).toMatchObject({ awardCount: 1, marketSharePercent: 100 });
  });

  it("includes all quarters for a year and excludes disabled registry rows", () => {
    const report = buildMarketShareReport({
      period: { year: 2026 },
      awards: [
        { noticeNo: "N-Q1", noticeOrder: "1", finalAwardDate: "2026-02-01", winnerBizNo: "222-33-44444", winnerName: "\uD55C\uBE5B\uC81C\uC5B4" },
        { noticeNo: "N-Q2", noticeOrder: "1", finalAwardDate: "2026-05-01", winnerBizNo: "333-44-55555", winnerName: "\uBBF8\uB798\uC2DC\uC2A4\uD15C" },
        { noticeNo: "N-Q3", noticeOrder: "1", finalAwardDate: "2026-08-01", winnerBizNo: cooperative, winnerName: "\uBE4C\uB529\uC790\uB3D9\uC81C\uC5B4\uACF5\uC5C5\uD611\uB3D9\uC870\uD569" },
        { noticeNo: "N-Q4", noticeOrder: "1", finalAwardDate: "2026-11-01", winnerBizNo: "555-66-77777", winnerName: "\uC77C\uBC18\uC5C5\uCCB4" },
      ],
      excellentRegistry,
      cooperativeBizNo: cooperative,
    });

    expect(report.periodLabel).toBe("2026\uB144");
    expect(report.totalAwardCount).toBe(4);
    expect(report.rows.find((row) => row.companyName === "\uD55C\uBE5B\uC81C\uC5B4")?.marketSharePercent).toBe(25);
    expect(report.rows.find((row) => row.companyName === "\uBBF8\uB798\uC2DC\uC2A4\uD15C")?.marketSharePercent).toBe(25);
    expect(report.rows.some((row) => row.companyName === "\uBE44\uD65C\uC131\uC5C5\uCCB4")).toBe(false);
  });
});

describe("selectAwardRecords / selectContractRecords", () => {
  const awards: MarketAwardInput[] = [
    { noticeNo: "N-1", noticeOrder: "1", finalAwardDate: "2026-02-15", winnerBizNo: "222-33-44444", winnerName: "\uD55C\uBE5B\uC81C\uC5B4", demandAgencyName: "\uBD80\uC0B0\uC2DC\uCCAD" },
    { noticeNo: "N-2", noticeOrder: "1", finalAwardDate: "2026-02-20", winnerBizNo: "222-33-44444", winnerName: "\uD55C\uBE5B\uC81C\uC5B4", demandAgencyName: "\uC11C\uC6B8\uC2DC\uCCAD" },
  ];
  const contracts: MarketContractInput[] = [
    { contractNo: "C-1", contractName: "\uACC4\uC57D1", contractDate: "2026-02-15", winnerBizNo: "222-33-44444", winnerName: "\uD55C\uBE5B\uC81C\uC5B4", noticeNo: "N-1", noticeOrder: "1", demandAgencyName: "\uBD80\uC0B0\uC2DC\uCCAD" },
    { contractNo: "C-2", contractName: "\uACC4\uC57D2", contractDate: "2026-02-20", winnerBizNo: "222-33-44444", winnerName: "\uD55C\uBE5B\uC81C\uC5B4", noticeNo: "N-2", noticeOrder: "1", demandAgencyName: "\uC11C\uC6B8\uC2DC\uCCAD" },
  ];

  it("applies busan filter to award basis", () => {
    const busanOnly = selectAwardRecords({ basis: "award", region: "busan", awards, contracts });
    expect(busanOnly).toHaveLength(1);
    expect(busanOnly[0]?.noticeNo).toBe("N-1");

    const nationwide = selectAwardRecords({ basis: "award", region: "all", awards, contracts });
    expect(nationwide).toHaveLength(2);
  });

  it("applies busan filter to contract basis and counts each contract", () => {
    const busanOnly = selectContractRecords({ basis: "contract", region: "busan", awards, contracts });
    expect(busanOnly).toHaveLength(1);
    expect(busanOnly[0]?.contractNo).toBe("C-1");

    const nationwide = selectContractRecords({ basis: "contract", region: "all", awards, contracts });
    expect(nationwide).toHaveLength(2);
    expect(nationwide.map((c) => c.contractNo).sort()).toEqual(["C-1", "C-2"]);
  });

  it("keeps two contracts from the same notice as two market facts", () => {
    const sameNotice = contracts.map((contract) => ({ ...contract, noticeNo: "N-1", noticeOrder: "1" }));
    const records = selectAwardRecords({ basis: "contract", region: "all", awards, contracts: sameNotice });
    expect(records).toHaveLength(2);
  });
});

describe("market share UI text", () => {
  it("does not ship raw unicode escape sequences to JSX text nodes", () => {
    const source = readFileSync("src/components/MarketShareApp.tsx", "utf8");
    expect(source).not.toMatch(/\\u[0-9a-f]{4}/i);
  });

  it("uses reviewed Korean labels", () => {
    const source = readFileSync("src/components/MarketShareApp.tsx", "utf8");
    expect(source).not.toMatch(/풍목|폐맨|업숍|평집|마료/);
    expect(source).toContain("품목번호");
    expect(source).toContain("엑셀 다운로드");
  });
});

describe("incremental market persistence", () => {
  it("keeps completed rows when later chunks are upserted", () => {
    const db = new Database(":memory:");
    initMarketStore(db);
    upsertMarketAwards(db, [{
      noticeNo: "N-1", noticeOrder: "1", finalAwardDate: "2026-01-01",
      winnerBizNo: "1111111111", winnerName: "업체1", amount: 100,
      noticeName: "공고1", demandAgencyName: "부산광역시", regionName: "부산", sourceUrl: null,
    }]);
    upsertMarketAwards(db, [{
      noticeNo: "N-2", noticeOrder: "1", finalAwardDate: "2026-01-02",
      winnerBizNo: "2222222222", winnerName: "업체2", amount: 200,
      noticeName: "공고2", demandAgencyName: "서울특별시", regionName: "기타", sourceUrl: null,
    }]);
    upsertMarketContracts(db, [{
      sourceIdentity: "contract-1", contractNo: "C-1", contractName: "계약1",
      contractDate: "2026-01-03", noticeNo: "N-1", noticeOrder: "1",
      winnerBizNo: "1111111111", winnerName: "업체1", amount: 100,
      demandAgencyName: "부산광역시", regionName: "부산", sourceUrl: null,
    }]);
    updateMarketAwardNoticeMetadata(db, [{
      noticeNo: "N-1", noticeOrder: "1", noticeName: "공고1",
      demandAgencyName: "부산광역시 기장군", sourceUrl: null,
    }]);
    expect(listMarketAwards(db)).toHaveLength(2);
    expect(listMarketAwards(db).find((row) => row.noticeNo === "N-1")).toMatchObject({
      demandAgencyName: "부산광역시 기장군",
      regionName: "부산",
    });
    expect(listMarketContracts(db)).toHaveLength(1);
    db.close();
  });

  it("reads the live notice API demand agency field", () => {
    expect(demandAgencyNameFromNotice({ dminsttNm: "부산광역시 동구" })).toBe("부산광역시 동구");
  });
});
