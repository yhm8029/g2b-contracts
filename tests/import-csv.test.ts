import { describe, expect, it } from "vitest";
import { parseContractCsv } from "@/lib/import/csv";

describe("parseContractCsv", () => {
  it("parses required and optional columns", () => {
    const csv = [
      "biz_no,business_name,contract_date,contract_name,current_contract_amount,notice_no,contract_detail_url",
      "123-45-67890,Sample Co,2026-01-15,Printer supply,1200000,20260123456,https://example.test/contract",
    ].join("\n");

    const result = parseContractCsv(csv, "sample.csv");

    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({
      bizNoNormalized: "1234567890",
      businessName: "Sample Co",
      contractName: "Printer supply",
      currentContractAmount: 1200000,
      noticeNo: "20260123456",
    });
    expect(result.errors).toEqual([]);
  });
});
