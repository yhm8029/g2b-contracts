import { describe, expect, it } from "vitest";
import type { CompetitorContractRow } from "@/lib/competitors/contracts";
import {
  buildCompetitorSalesOverview,
  buildUnavailableCompetitorSalesOverview,
  classifyCompetitorSalesContract,
  COMPETITOR_SALES_REGISTRY,
  resolveCompetitorSalesPeriod,
} from "@/lib/competitors/overview";

describe("competitor sales overview", () => {
  const now = new Date("2026-07-22T03:00:00.000Z");

  it("keeps the 22 approved competitors with verified designation periods", () => {
    expect(COMPETITOR_SALES_REGISTRY).toHaveLength(22);
    expect(new Set(COMPETITOR_SALES_REGISTRY.map((item) => item.bizNo)).size).toBe(22);
    expect(new Set(COMPETITOR_SALES_REGISTRY.map((item) => item.designationNo)).size).toBe(22);
    expect(COMPETITOR_SALES_REGISTRY.every((item) => item.itemCode === "3912180101")).toBe(true);
    expect(COMPETITOR_SALES_REGISTRY.every((item) => /^20\d{2}-\d{2}-\d{2}$/.test(item.designationStartDate))).toBe(true);
    expect(COMPETITOR_SALES_REGISTRY.every((item) => /^20\d{2}-\d{2}-\d{2}$/.test(item.designationEndDate))).toBe(true);
    expect(COMPETITOR_SALES_REGISTRY[0]).toMatchObject({
      designationNo: "2026058",
      designationStartDate: "2026-07-20",
      designationEndDate: "2032-07-19",
    });
  });

  it("resolves Seoul calendar month, quarter, and year periods with versioned cache keys", () => {
    expect(resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6 }, now)).toMatchObject({
      period: "month",
      year: 2026,
      month: 6,
      quarter: null,
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      cacheKey: "v4:month:2026-06-01:2026-06-30",
    });
    expect(resolveCompetitorSalesPeriod({ period: "quarter", year: 2026, quarter: 2 }, now)).toMatchObject({
      dateFrom: "2026-04-01",
      dateTo: "2026-06-30",
      cacheKey: "v4:quarter:2026-Q2:2026-04-01:2026-06-30",
    });
    expect(resolveCompetitorSalesPeriod({ period: "year", year: 2025 }, now)).toMatchObject({
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
      cacheKey: "v4:year:2025:2025-01-01:2025-12-31",
    });
  });

  it("caps ongoing Seoul month, quarter, and year periods at today", () => {
    expect(resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 7 }, now)).toMatchObject({
      dateFrom: "2026-07-01",
      dateTo: "2026-07-22",
      cacheKey: "v4:month:2026-07-01:2026-07-22",
    });
    expect(resolveCompetitorSalesPeriod({ period: "quarter", year: 2026, quarter: 3 }, now)).toMatchObject({
      dateFrom: "2026-07-01",
      dateTo: "2026-07-22",
      cacheKey: "v4:quarter:2026-Q3:2026-07-01:2026-07-22",
    });
    expect(resolveCompetitorSalesPeriod({ period: "year", year: 2026 }, now)).toMatchObject({
      dateFrom: "2026-01-01",
      dateTo: "2026-07-22",
      cacheKey: "v4:year:2026:2026-01-01:2026-07-22",
    });
  });

  it("rejects incomplete and future period queries", () => {
    expect(() => resolveCompetitorSalesPeriod({ period: "month", year: 2026 }, now)).toThrow("month is required");
    expect(() => resolveCompetitorSalesPeriod({ period: "quarter", year: 2026, quarter: 5 }, now)).toThrow(
      "quarter must be between 1 and 4",
    );
    expect(() => resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 8 }, now)).toThrow(
      "future periods are not supported",
    );
  });

  it("rejects period parameters that belong to another unit", () => {
    expect(() => resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6, quarter: 2 }, now)).toThrow(
      "quarter must not be set for month",
    );
    expect(() => resolveCompetitorSalesPeriod({ period: "quarter", year: 2026, quarter: 2, month: 6 }, now)).toThrow(
      "month must not be set for quarter",
    );
    expect(() => resolveCompetitorSalesPeriod({ period: "year", year: 2025, month: 6 }, now)).toThrow(
      "month must not be set for year",
    );
  });

  it("matches only the exact 10-digit item code and ignores titles or BEMS keywords", () => {
    expect(classifyCompetitorSalesContract(contractRow({ itemCodes: ["3912180101"], contractName: "unrelated" })).related).toBe(true);
    expect(classifyCompetitorSalesContract(contractRow({ itemCodes: ["4010170101"], contractName: "BEMS installation" })).related).toBe(false);
    expect(classifyCompetitorSalesContract(contractRow({ itemCodes: [], contractName: "City hall BEMS installation" })).related).toBe(false);
    expect(classifyCompetitorSalesContract(contractRow({ itemCodes: ["39121801"], contractName: "City hall BEMS installation" })).related).toBe(false);
  });

  it("excludes only public-standard third-party unit-price contract ceilings", () => {
    const competitor = COMPETITOR_SALES_REGISTRY[0];
    const rows = [
      contractRow({
        id: "third-party-type",
        bizNoNormalized: competitor.bizNo,
        contractNo: "THIRD-PARTY-TYPE",
        contractType: "제3자단가계약",
        contractName: "우수조달물품 계약",
        demandAgencyName: "각 수요기관",
        itemCodes: ["3912180101"],
        totalContractAmount: 9_025_070_000,
      }),
      contractRow({
        id: "third-party-name",
        bizNoNormalized: competitor.bizNo,
        contractNo: "THIRD-PARTY-NAME",
        contractName: "우수조달물품 제 3자 단가계약",
        demandAgencyName: "각수요기관",
        itemCodes: ["3912180101"],
        totalContractAmount: 800,
      }),
      contractRow({
        id: "ordinary-unit-price",
        bizNoNormalized: competitor.bizNo,
        contractNo: "ORDINARY-UNIT-PRICE",
        contractType: "일반단가계약",
        contractName: "빌딩자동제어장치 일반단가계약",
        itemCodes: ["3912180101"],
        totalContractAmount: 700,
      }),
      contractRow({
        id: "third-party-delivery",
        bizNoNormalized: competitor.bizNo,
        contractNo: "DELIVERY-REQUEST-1",
        contractType: "제3자단가계약",
        contractMethod: "제3자단가계약",
        contractName: "빌딩자동제어장치 납품요구",
        itemCodes: ["3912180101"],
        totalContractAmount: 500,
        sourceDataset: "g2b-shopping-mall-third-party-delivery",
      }),
    ];

    expect(classifyCompetitorSalesContract(rows[0]!).related).toBe(false);
    expect(classifyCompetitorSalesContract(rows[1]!).related).toBe(false);
    expect(classifyCompetitorSalesContract(rows[2]!).related).toBe(true);
    expect(classifyCompetitorSalesContract(rows[3]!).related).toBe(true);

    const overview = buildCompetitorSalesOverview({
      period: resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6 }, now),
      collectedAt: "2026-07-22T03:00:00.000Z",
      rows,
    });

    expect(overview.totalContractCount).toBe(2);
    expect(overview.totalAmount).toBe(1_200);
    expect(overview.companies.find((company) => company.bizNo === competitor.bizNo)?.contracts).toHaveLength(2);
    expect(overview.companies.find((company) => company.bizNo === competitor.bizNo)?.contracts.map((row) => row.id)).toEqual([
      "ordinary-unit-price",
      "third-party-delivery",
    ]);
  });

  it("retains public-standard third-party unit-price sales for a specific demand agency", () => {
    const row = contractRow({
      contractType: "제3자단가계약",
      contractName: "빌딩자동제어장치 납품요구",
      demandAgencyName: "육군 제32보병사단",
      itemCodes: ["3912180101"],
      totalContractAmount: 250_000_000,
    });

    expect(classifyCompetitorSalesContract(row).related).toBe(true);

    const overview = buildCompetitorSalesOverview({
      period: resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6 }, now),
      collectedAt: "2026-07-22T03:00:00.000Z",
      rows: [row],
    });
    expect(overview.totalAmount).toBe(250_000_000);
  });

  it("uses the latest amendment amount per contract number and returns all 22 companies ordered by amount", () => {
    const first = COMPETITOR_SALES_REGISTRY[0];
    const second = COMPETITOR_SALES_REGISTRY[1];
    const overview = buildCompetitorSalesOverview({
      period: resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6 }, now),
      collectedAt: "2026-07-22T03:00:00.000Z",
      rows: [
        contractRow({ bizNoNormalized: first.bizNo, contractNo: "A-1", contractDate: "2026-06-03", totalContractAmount: 100, itemCodes: ["3912180101"] }),
        contractRow({ id: "amendment", bizNoNormalized: first.bizNo, contractNo: "A-1", contractDate: "2026-06-20", totalContractAmount: 150, itemCodes: ["3912180101"] }),
        contractRow({ id: "other", bizNoNormalized: second.bizNo, contractNo: "B-1", contractDate: "2026-06-10", totalContractAmount: 150, itemCodes: ["3912180101"] }),
      ],
    });

    expect(overview).toMatchObject({
      status: "ready",
      totalContractCount: 2,
      totalAmount: 300,
      latestContractDate: "2026-06-20",
    });
    expect(overview.companies).toHaveLength(22);
    expect(overview.companies.slice(0, 2).map((company) => company.bizNo)).toEqual([first.bizNo, second.bizNo]);
    expect(overview.companies[0]).toMatchObject({ contractCount: 1, totalAmount: 150, latestContractDate: "2026-06-20" });
    expect(overview.companies[0]?.contracts).toHaveLength(1);
    expect(overview.companies[0]?.contracts[0]).toMatchObject({ id: "amendment", sourceRowCount: 2 });
  });

  it("counts a joint contract once overall while retaining each competitor attribution", () => {
    const first = COMPETITOR_SALES_REGISTRY[0];
    const second = COMPETITOR_SALES_REGISTRY[1];
    const overview = buildCompetitorSalesOverview({
      period: resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6 }, now),
      collectedAt: "2026-07-22T03:00:00.000Z",
      rows: [
        contractRow({
          bizNoNormalized: first.bizNo,
          contractNo: "JOINT-1",
          totalContractAmount: 600,
          contractTotalAmount: 1000,
          amountAttribution: "supplier-reported",
          itemCodes: ["3912180101"],
        }),
        contractRow({
          id: "joint-second",
          bizNoNormalized: second.bizNo,
          contractNo: "JOINT-1",
          totalContractAmount: 400,
          contractTotalAmount: 1000,
          amountAttribution: "supplier-reported",
          itemCodes: ["3912180101"],
        }),
      ],
    });

    expect(overview.totalContractCount).toBe(1);
    expect(overview.totalAmount).toBe(1000);
    expect(overview.companies.find((company) => company.bizNo === first.bizNo)).toMatchObject({
      contractCount: 1,
      totalAmount: 600,
    });
    expect(overview.companies.find((company) => company.bizNo === second.bizNo)).toMatchObject({
      contractCount: 1,
      totalAmount: 400,
    });
  });

  it("uses only the original contract suppliers and amount in the overall totals", () => {
    const first = COMPETITOR_SALES_REGISTRY[0];
    const second = COMPETITOR_SALES_REGISTRY[1];
    const overview = buildCompetitorSalesOverview({
      period: resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6 }, now),
      collectedAt: "2026-07-22T03:00:00.000Z",
      rows: [
        contractRow({
          id: "old-first",
          bizNoNormalized: first.bizNo,
          contractNo: "JOINT-AMENDMENT",
          contractDate: "2026-06-10",
          amendmentOrder: 0,
          totalContractAmount: 600,
          contractTotalAmount: 1000,
          itemCodes: ["3912180101"],
        }),
        contractRow({
          id: "latest-second",
          bizNoNormalized: second.bizNo,
          contractNo: "JOINT-AMENDMENT",
          contractDate: "2026-06-20",
          amendmentOrder: 2,
          totalContractAmount: 800,
          contractTotalAmount: 800,
          itemCodes: ["3912180101"],
        }),
      ],
    });

    expect(overview.totalContractCount).toBe(1);
    expect(overview.totalAmount).toBe(600);
    expect(overview.companies.find((company) => company.bizNo === first.bizNo)?.contractCount).toBe(1);
    expect(overview.companies.find((company) => company.bizNo === second.bizNo)?.totalAmount).toBe(0);
  });

  it("groups missing contract numbers by explicit original date and keeps only amendment order zero", () => {
    const competitor = COMPETITOR_SALES_REGISTRY[0];
    const overview = buildCompetitorSalesOverview({
      period: resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6 }, now),
      collectedAt: "2026-07-22T03:00:00.000Z",
      rows: [
        contractRow({
          id: "earlier-order",
          bizNoNormalized: competitor.bizNo,
          contractNo: "",
          contractDate: "2026-06-20",
          originalContractDate: "2026-06-01",
          amendmentOrder: 0,
          totalContractAmount: 100,
          itemCodes: ["3912180101"],
        }),
        contractRow({
          id: "latest-order",
          bizNoNormalized: competitor.bizNo,
          contractNo: "",
          contractDate: "2026-06-15",
          originalContractDate: "2026-06-01",
          amendmentOrder: 2,
          totalContractAmount: 175,
          itemCodes: ["3912180101"],
        }),
      ],
    });

    expect(overview.totalContractCount).toBe(1);
    expect(overview.totalAmount).toBe(100);
    expect(overview.companies[0]?.contracts[0]).toMatchObject({
      id: "earlier-order",
      originalContractDate: "2026-06-01",
      amendmentOrder: 0,
      sourceRowCount: 2,
    });
  });

  it("classifies only the original contract and ignores later classification changes", () => {
    const competitor = COMPETITOR_SALES_REGISTRY[0];
    const overview = buildCompetitorSalesOverview({
      period: resolveCompetitorSalesPeriod({ period: "month", year: 2026, month: 6 }, now),
      collectedAt: "2026-07-22T03:00:00.000Z",
      rows: [
        contractRow({
          id: "target-initial",
          bizNoNormalized: competitor.bizNo,
          contractNo: "AMEND-1",
          amendmentOrder: 0,
          contractDate: "2026-06-01",
          itemCodes: ["3912180101"],
        }),
        contractRow({
          id: "unrelated-latest",
          bizNoNormalized: competitor.bizNo,
          contractNo: "AMEND-1",
          amendmentOrder: 2,
          contractDate: "2026-06-20",
          itemCodes: ["4010170101"],
          contractName: "BEMS installation",
        }),
      ],
    });

    expect(overview.totalContractCount).toBe(1);
    expect(overview.totalAmount).toBe(100);
    expect(overview.companies.find((company) => company.bizNo === competitor.bizNo)?.contracts.map((contract) => contract.id)).toEqual(["target-initial"]);
  });

  it("counts originals separately from amendments, excluding amendments whose contract year precedes the period year", () => {
    const competitor = COMPETITOR_SALES_REGISTRY[0];
    const collectedAt = "2026-08-18T03:00:00.000Z";
    const currentNow = new Date(collectedAt);
    const original = contractRow({ id: "original-2025", bizNoNormalized: competitor.bizNo, contractNo: "R25TA01174324", contractDate: "2025-12-05", amendmentOrder: 0, totalContractAmount: 246_500_000, itemCodes: ["3912180101"] });
    const amendment = contractRow({ id: "amendment-2026", bizNoNormalized: competitor.bizNo, contractNo: "R25TA01174324", contractDate: "2026-08-10", amendmentOrder: 1, totalContractAmount: 240_659_000, itemCodes: ["3912180101"] });
    const overview2025 = buildCompetitorSalesOverview({ period: resolveCompetitorSalesPeriod({ period: "year", year: 2025 }, currentNow), collectedAt, rows: [original, amendment] });
    expect(overview2025.totalContractCount).toBe(1);
    expect(overview2025.totalAmount).toBe(246_500_000);
    expect(overview2025.companies.find((company) => company.bizNo === competitor.bizNo)?.contracts.map((contract) => contract.id)).toEqual(["original-2025"]);
    const overview2026 = buildCompetitorSalesOverview({ period: resolveCompetitorSalesPeriod({ period: "year", year: 2026 }, currentNow), collectedAt, rows: [original, amendment] });
    expect(overview2026.totalContractCount).toBe(0);
    expect(overview2026.totalAmount).toBe(0);
    expect(overview2026.companies.find((company) => company.bizNo === competitor.bizNo)?.contracts.map((contract) => contract.id) ?? []).toEqual([]);
  });

  it("uses the amendment as a fallback for the year when no original contract row is present", () => {
    const competitor = COMPETITOR_SALES_REGISTRY[0];
    const collectedAt = "2026-08-18T03:00:00.000Z";
    const currentNow = new Date(collectedAt);
    const amendmentOnly = contractRow({ id: "amendment-2026", bizNoNormalized: competitor.bizNo, contractNo: "R26TA01330444", contractDate: "2026-03-22", amendmentOrder: 1, totalContractAmount: 240_659_000, itemCodes: ["3912180101"] });
    const overview2026 = buildCompetitorSalesOverview({ period: resolveCompetitorSalesPeriod({ period: "year", year: 2026 }, currentNow), collectedAt, rows: [amendmentOnly] });
    expect(overview2026.totalContractCount).toBe(1);
    expect(overview2026.totalAmount).toBe(240_659_000);
    expect(overview2026.companies.find((company) => company.bizNo === competitor.bizNo)?.contracts.map((contract) => contract.id)).toEqual(["amendment-2026"]);
  });

  it("keeps unavailable collection states distinct from zero-result ready overviews", () => {
    const overview = buildUnavailableCompetitorSalesOverview({
      period: resolveCompetitorSalesPeriod({ period: "year", year: 2025 }, now),
      status: "collecting",
    });

    expect(overview.status).toBe("collecting");
    expect(overview.totalAmount).toBeNull();
    expect(overview).toMatchObject({ latestContractDate: null });
    expect(overview.companies.every((company) => company.contractCount === null)).toBe(true);
  });
});

function contractRow(overrides: Partial<CompetitorContractRow> = {}): CompetitorContractRow {
  return {
    id: "contract-row",
    bizNoNormalized: COMPETITOR_SALES_REGISTRY[0]?.bizNo ?? "2208104763",
    bizNoDisplay: "220-81-04763",
    businessName: "Test supplier",
    contractName: "Building automation installation",
    itemCodes: [],
    contractDate: "2026-06-10",
    currentContractAmount: 100,
    totalContractAmount: 100,
    demandAgencyName: "Demand agency",
    contractAgencyName: "Contract agency",
    contractMethod: "Open competition",
    contractNo: "A-1",
    noticeNo: "N-1",
    contractDetailUrl: "https://example.test/contracts/1",
    noticeDetailUrl: "https://example.test/notices/1",
    sourceDataset: "g2b-public-standard-contract",
    ...overrides,
  };
}
