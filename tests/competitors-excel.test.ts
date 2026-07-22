import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildCompetitorSalesWorkbook } from "@/lib/competitors/excel";
import type { CompetitorSalesOverviewResponse } from "@/lib/competitors/types";

describe("competitor sales Excel workbook", () => {
  it("creates the approved two-sheet workbook with sortable dates and numeric won amounts", async () => {
    const buffer = await buildCompetitorSalesWorkbook(overviewFixture());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["업체별 요약", "전체"]);

    const summary = workbook.getWorksheet("업체별 요약")!;
    expect(summary.getRow(1).values).toEqual([
      undefined,
      "순위",
      "업체명",
      "사업자번호",
      "지정번호",
      "지정시작일",
      "지정종료일",
      "계약건수",
      "계약금액",
      "최근계약일",
    ]);
    expect(summary.views).toContainEqual(expect.objectContaining({ state: "frozen", ySplit: 1 }));
    expect(summary.autoFilter).toBe("A1:I2");
    expect(summary.getCell("A2").value).toBe(1);
    expect(summary.getCell("B2").value).toBe("테스트 주식회사");
    expect(summary.getCell("H2").value).toBe(123456789);
    expect(summary.getCell("H2").numFmt).toContain("₩");
    expect(summary.getCell("E2").value).toBeInstanceOf(Date);
    expect((summary.getCell("E2").value as Date).toISOString().slice(0, 10)).toBe("2024-04-15");
    expect(summary.getCell("E2").numFmt).toBe("yyyy-mm-dd");
    expect(summary.getCell("I2").value).toBeInstanceOf(Date);
    expect(summary.getCell("I2").numFmt).toBe("yyyy-mm-dd");

    const details = workbook.getWorksheet("전체")!;
    expect(details.getRow(1).values).toEqual([
      undefined,
      "업체명",
      "사업자번호",
      "지정번호",
      "지정시작일",
      "지정종료일",
      "계약명",
      "품목명",
      "수요기관",
      "계약기관",
      "계약일",
      "계약방식",
      "계약금액",
      "금액귀속",
      "계약번호",
      "공고번호",
      "원문 URL",
    ]);
    expect(details.views).toContainEqual(expect.objectContaining({ state: "frozen", ySplit: 1 }));
    expect(details.autoFilter).toBe("A1:P2");
    expect(details.getCell("F2").value).toBe("빌딩자동제어시스템 구매");
    expect(details.getCell("G2").value).toBe("빌딩자동제어, BEMS");
    expect(details.getCell("J2").value).toBeInstanceOf(Date);
    expect((details.getCell("J2").value as Date).toISOString().slice(0, 10)).toBe("2026-07-21");
    expect(details.getCell("J2").numFmt).toBe("yyyy-mm-dd");
    expect(details.getCell("L2").value).toBe(123456789);
    expect(details.getCell("L2").numFmt).toContain("₩");
    expect(details.getCell("M2").value).toBe("균등배분 추정");
    expect(details.getCell("P2").text).toBe("https://example.test/contracts/C-1");
    expect(details.getCell("P2").hyperlink).toBe("https://example.test/contracts/C-1");
  });

  it("keeps missing dates and URLs blank and falls back to the notice URL", async () => {
    const overview = overviewFixture();
    overview.companies[0]!.latestContractDate = null;
    overview.companies[0]!.contracts[0]!.contractDate = null;
    overview.companies[0]!.contracts[0]!.contractDetailUrl = "";

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildCompetitorSalesWorkbook(overview));

    expect(workbook.getWorksheet("업체별 요약")!.getCell("I2").value).toBeNull();
    expect(workbook.getWorksheet("전체")!.getCell("J2").value).toBeNull();
    const sourceCell = workbook.getWorksheet("전체")!.getCell("P2");
    expect(sourceCell.text).toBe("https://example.test/notices/N-1");
    expect(sourceCell.hyperlink).toBe("https://example.test/notices/N-1");
  });

  it("leaves unsafe and invalid source URLs as a blank non-hyperlink cell", async () => {
    const overview = overviewFixture();
    overview.companies[0]!.contracts[0]!.contractDetailUrl = "javascript:alert(1)";
    overview.companies[0]!.contracts[0]!.noticeDetailUrl = "not a url";

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildCompetitorSalesWorkbook(overview));

    const sourceCell = workbook.getWorksheet("전체")!.getCell("P2");
    expect(sourceCell.value).toBeNull();
    expect(sourceCell.hyperlink).toBeUndefined();
  });
});

function overviewFixture(): CompetitorSalesOverviewResponse {
  return {
    period: {
      period: "month",
      year: 2026,
      month: 7,
      quarter: null,
      label: "2026-07",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-22",
      cacheKey: "v2:month:2026-07-01:2026-07-22",
    },
    status: "ready",
    collectedAt: "2026-07-22T03:00:00.000Z",
    totalContractCount: 1,
    totalAmount: 123456789,
    latestContractDate: "2026-07-21",
    coverage: { complete: true, fresh: true, missingRanges: [] },
    companies: [{
      competitorId: "test-company",
      companyName: "테스트 주식회사",
      bizNo: "1234567890",
      designationNo: "2024004",
      designationStartDate: "2024-04-15",
      designationEndDate: "2030-04-14",
      itemCode: "3912180101",
      displayOrder: 1,
      collectionStatus: "collected",
      contractCount: 1,
      totalAmount: 123456789,
      latestContractDate: "2026-07-21",
      contracts: [{
        id: "contract-1",
        bizNoNormalized: "1234567890",
        bizNoDisplay: "123-45-67890",
        businessName: "테스트 주식회사",
        contractName: "빌딩자동제어시스템 구매",
        itemNames: ["빌딩자동제어", "BEMS"],
        itemCodes: ["3912180101"],
        contractDate: "2026-07-21",
        currentContractAmount: 123456789,
        totalContractAmount: 123456789,
        contractTotalAmount: 246913578,
        amountAttribution: "equal-share",
        demandAgencyName: "서울시청",
        contractAgencyName: "조달청",
        contractMethod: "제한경쟁",
        contractNo: "C-1",
        noticeNo: "N-1",
        contractDetailUrl: "https://example.test/contracts/C-1",
        noticeDetailUrl: "https://example.test/notices/N-1",
        sourceDataset: "g2b-public-standard-contract",
        positiveSignals: [],
        conflictingSignals: [],
        sourceRowCount: 1,
      }],
    }],
  };
}
