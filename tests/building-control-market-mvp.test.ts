import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import ExcelJS from "exceljs";

import {
  buildMarketShareReport,
  selectAwardRecords,
  selectContractRecords,
  type ExcellentRegistryEntry,
  type MarketAwardInput,
  type MarketContractInput,
} from "@/lib/building-control-market/report";
import {
  buildMarketWorkbook,
  marketWorkbookFileName,
} from "@/lib/building-control-market/excel";
import {
  initMarketStore,
  listMarketAwards,
  listMarketContracts,
  updateMarketAwardNoticeMetadata,
  upsertMarketAwards,
  upsertMarketContracts,
} from "@/lib/building-control-market/store";
import {
  demandAgencyNameFromNotice,
  mapShoppingMallContractRow,
} from "@/lib/building-control-market/sync";

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

  it("combines notice awards and shopping mall requests", () => {
    const records = selectAwardRecords({ basis: "combined", region: "all", awards, contracts });

    expect(records).toHaveLength(4);
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

describe("shopping mall workbook", () => {
  it("names annual and quarterly exports from the selected filters", () => {
    expect(marketWorkbookFileName("award", "busan", { year: 2026 })).toBe(
      "\uB098\uB77C\uC7A5\uD130_\uBD80\uC0B0_2026\uC5F0\uAC04.xlsx",
    );
    expect(marketWorkbookFileName("combined", "all", { year: 2026, quarter: 3 })).toBe(
      "\uD1B5\uD569_\uC804\uAD6D_2026\uB1443\uBD84\uAE30.xlsx",
    );
  });

  it("exports the delivery request and original unit-price contract numbers separately", async () => {
    const contracts = [{
      sourceIdentity: "shopping-1",
      contractNo: "R26TB01528402",
      contractName: "빌딩자동제어장치 구입",
      contractDate: "2026-02-10",
      noticeNo: "R25TA00246561",
      noticeOrder: null,
      winnerBizNo: "2048169430",
      winnerName: "주식회사 삼원씨앤지",
      amount: 99_794_000,
      demandAgencyName: "강원특별자치도교육청",
      regionName: "기타",
      sourceUrl: null,
    }];
    const report = buildMarketShareReport({
      period: { year: 2026 },
      awards: [],
      contracts,
      basis: "contract",
      region: "all",
      excellentRegistry,
      cooperativeBizNo: cooperative,
    });
    const bytes = await buildMarketWorkbook({ report, basis: "contract", region: "all", awards: [], contracts });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const details = workbook.getWorksheet("쇼핑몰내역")!;

    expect(details.getCell("E1").value).toBe("납품요구번호");
    expect(details.getCell("F1").value).toBe("원 단가계약번호");
    expect(details.getCell("E2").value).toBe("R26TB01528402");
    expect(details.getCell("F2").value).toBe("R25TA00246561");
  });
});

describe("incremental market persistence", () => {
  it("keeps only the earliest contract when a later change contract repeats it", () => {
    const db = new Database(":memory:");
    initMarketStore(db);
    const shared = {
      contractName: "\uAE30\uCD08\uC0DD\uD65C\uAC70\uC810 \uBE4C\uB529\uC790\uB3D9\uC81C\uC5B4\uC7A5\uCE58 \uAD6C\uB9E4",
      noticeNo: null,
      noticeOrder: null,
      winnerBizNo: "3148613145",
      winnerName: "company",
      amount: 100,
      demandAgencyName: "\uD55C\uAD6D\uB18D\uC5B4\uCD0C\uACF5\uC0AC \uD64D\uC131\uC9C0\uC0AC",
      regionName: "\uAE30\uD0C0",
      sourceUrl: null,
    };
    upsertMarketContracts(db, [{
      ...shared,
      sourceIdentity: "original",
      contractNo: "R25TA00357976",
      contractDate: "2025-12-10",
    }]);
    upsertMarketContracts(db, [{
      ...shared,
      sourceIdentity: "changed",
      contractNo: "R26TA01557413",
      contractDate: "2026-03-10",
    }]);

    expect(listMarketContracts(db)).toMatchObject([{
      sourceIdentity: "original",
      contractNo: "R25TA00357976",
      contractDate: "2025-12-10",
    }]);
    db.close();
  });

  it("removes previously stored framework contracts during initialization", () => {
    const db = new Database(":memory:");
    initMarketStore(db);
    db.prepare(`INSERT INTO market_contracts
      (source_identity, contract_no, contract_name, contract_date, winner_biz_no, winner_name, region_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("legacy-framework", "F-1", "\uC6B0\uC218\uC870\uB2EC\uBB3C\uD488 \uC81C3\uC790 \uB2E8\uAC00\uACC4\uC57D", "2026-01-01", "1111111111", "legacy", "\uAE30\uD0C0");

    initMarketStore(db);

    expect(listMarketContracts(db)).toHaveLength(0);
    db.close();
  });

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
    upsertMarketContracts(db, [{
      sourceIdentity: "framework-1", contractNo: "F-1",
      contractName: "\uC218\uC758 \uC6B0\uC218\uC870\uB2EC\uBB3C\uD488 \uC81C3\uC790\uB2E8\uAC00\uACC4\uC57D",
      contractDate: "2026-01-03", noticeNo: null, noticeOrder: null,
      winnerBizNo: "1111111111", winnerName: "framework", amount: 100,
      demandAgencyName: "\uC870\uB2EC\uCCAD", regionName: "\uAE30\uD0C0", sourceUrl: null,
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

  it("keeps exact-code shopping mall contracts without a notice keyword", () => {
    const contract = mapShoppingMallContractRow({
      cntrctDlvrReqNo: "C-1",
      cntrctDlvrReqDate: "20260821",
      IntlCntrctDlvrReqDate: "20250210",
      bizno: "2048145651",
      corpNm: "(주)파노텍",
      dtilPrdctClsfcNo: "3912180101",
      cntrctDlvrReqNm: "통합관제 설비",
      dminsttNm: "부산광역시 동구",
      prdctAmt: "1000000",
    }, new Map());

    expect(contract).toMatchObject({
      contractNo: "C-1",
      contractDate: "2025-02-10",
      winnerBizNo: "2048145651",
      regionName: "부산",
    });
  });

  it("rejects procurement framework contracts from shopping mall facts", () => {
    const contract = mapShoppingMallContractRow({
      cntrctDlvrReqNo: "R25TA00246561",
      cntrctDlvrReqDate: "20250308",
      bizno: "2048169430",
      corpNm: "주식회사 삼원씨앤지",
      dtilPrdctClsfcNo: "3912180101",
      cntrctDlvrReqNm: "수의 우수조달물품(2024018, 빌딩자동제어장치) 제3자단가계약",
      dminsttNm: "조달청",
      prdctAmt: "1000000",
    }, new Map());

    expect(contract).toBeNull();
  });
});
