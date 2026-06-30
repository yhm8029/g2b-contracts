import { describe, expect, it } from "vitest";

import type { ContractSearchRow } from "@/lib/contracts/types";
import { contractsToCsv } from "@/lib/export/csv";

function contractRow(overrides: Partial<ContractSearchRow> = {}): ContractSearchRow {
  return {
    id: 1,
    businessId: 1,
    bizNoNormalized: "1234567890",
    bizNoDisplay: "123-45-67890",
    businessName: "Sample Office Co",
    businessCategory: "goods",
    noticeNo: "20260123456",
    noticeOrder: null,
    noticeName: "Sample notice",
    contractNo: "C-2026-001",
    unifiedContractNo: null,
    contractName: "Sample contract",
    contractDate: "2026-01-15",
    currentContractAmount: 900,
    totalContractAmount: 1000,
    demandAgencyCode: null,
    demandAgencyName: "Demand Agency",
    contractAgencyCode: null,
    contractAgencyName: "Contract Agency",
    contractMethod: "Open bid",
    winningMethod: null,
    businessNameAtContract: null,
    contractDetailUrl: "https://example.test/contracts/1",
    noticeDetailUrl: "https://example.test/notices/1",
    rawSourceUrl: null,
    sourceDataset: "csv:sample.csv",
    sourceRowHash: "sample-hash",
    sourceStatus: "local_only",
    lastImportedAt: "2026-06-26T00:00:00.000Z",
    lastEnrichedAt: null,
    latestEnrichmentStatus: null,
    latestEnrichmentError: null,
    ...overrides,
  };
}

describe("contractsToCsv", () => {
  it("starts with a UTF-8 BOM so Windows Excel opens Korean text correctly", () => {
    const csv = contractsToCsv([contractRow({ contractName: "빌딩자동제어장치" })]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("exports contract search rows with the expected header and values", () => {
    const csv = contractsToCsv([contractRow()]);

    expect(csv).toBe(
      [
        "\ufeffcontract_date,contract_name,notice_name,contract_amount,demand_agency,contract_agency,contract_method,business_category,notice_no,contract_no,contract_detail_url,notice_detail_url,source_status",
        "2026-01-15,Sample contract,Sample notice,1000,Demand Agency,Contract Agency,Open bid,goods,20260123456,C-2026-001,https://example.test/contracts/1,https://example.test/notices/1,local_only",
        "",
      ].join("\n"),
    );
  });

  it("escapes commas, quotes, and newlines in CSV fields", () => {
    const csv = contractsToCsv([
      contractRow({
        contractName: 'Paper, toner, and "binding"',
        noticeName: "Line one\nLine two",
        demandAgencyName: "Agency\r\nBranch",
      }),
    ]);

    expect(csv).toContain('"Paper, toner, and ""binding"""');
    expect(csv).toContain('"Line one\nLine two"');
    expect(csv).toContain('"Agency\r\nBranch"');
  });

  it("falls back to current contract amount when total amount is missing", () => {
    const csv = contractsToCsv([
      contractRow({ totalContractAmount: null, currentContractAmount: 2500 }),
    ]);

    expect(csv).toContain(",2500,");
  });
});
