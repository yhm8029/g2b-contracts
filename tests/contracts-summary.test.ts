import { describe, expect, it } from "vitest";

import { summarizeContracts } from "@/lib/contracts/summary";
import type { ContractSearchRow } from "@/lib/contracts/types";

function contractRow(overrides: Partial<ContractSearchRow>): ContractSearchRow {
  return {
    id: 1,
    businessId: 1,
    bizNoNormalized: "1234567890",
    bizNoDisplay: "123-45-67890",
    businessName: "Sample Office Co",
    businessCategory: "goods",
    noticeNo: null,
    noticeOrder: null,
    noticeName: null,
    contractNo: null,
    unifiedContractNo: null,
    contractName: "Sample contract",
    contractDate: "2026-01-15",
    currentContractAmount: null,
    totalContractAmount: null,
    demandAgencyCode: null,
    demandAgencyName: null,
    contractAgencyCode: null,
    contractAgencyName: null,
    contractMethod: null,
    winningMethod: null,
    businessNameAtContract: null,
    contractDetailUrl: null,
    noticeDetailUrl: null,
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

describe("summarizeContracts", () => {
  it("falls back to current contract amount when total amount is missing", () => {
    const summary = summarizeContracts([
      contractRow({ totalContractAmount: 1_000, currentContractAmount: 900 }),
      contractRow({ id: 2, totalContractAmount: null, currentContractAmount: 2_000 }),
      contractRow({ id: 3, totalContractAmount: null, currentContractAmount: null }),
    ]);

    expect(summary.totalAmount).toBe(3_000);
  });

  it("counts rows with either a notice number or notice detail URL as notice-linked", () => {
    const summary = summarizeContracts([
      contractRow({ noticeNo: "20260123456", noticeDetailUrl: null }),
      contractRow({ id: 2, noticeNo: null, noticeDetailUrl: "https://example.test/notice/2" }),
      contractRow({ id: 3, noticeNo: null, noticeDetailUrl: null }),
    ]);

    expect(summary.noticeLinkedCount).toBe(2);
  });
});
