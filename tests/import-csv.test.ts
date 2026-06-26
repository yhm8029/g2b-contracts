import { describe, expect, it } from "vitest";
import { parseContractCsv } from "@/lib/import/csv";

describe("parseContractCsv", () => {
  const requiredHeaders = "biz_no,business_name,contract_date,contract_name";
  const validRow = "123-45-67890,Sample Co,2026-01-15,Printer supply";

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

  it("returns an error for missing required headers", () => {
    const result = parseContractCsv(
      ["biz_no,business_name,contract_date", "123-45-67890,Sample Co,2026-01-15"].join("\n"),
      "sample.csv",
    );

    expect(result.validRows).toEqual([]);
    expect(result.errors).toEqual(["Missing required CSV headers: contract_name"]);
  });

  it("returns an error for empty CSV content", () => {
    const result = parseContractCsv(" \r\n\n", "empty.csv");

    expect(result.validRows).toEqual([]);
    expect(result.errors).toEqual(["CSV file is empty."]);
  });

  it("skips rows with invalid required data", () => {
    const result = parseContractCsv(
      [
        requiredHeaders,
        "123-45-67890,Sample Co,20260115,Printer supply",
        "123,Sample Co,2026-01-15,Printer supply",
      ].join("\n"),
      "sample.csv",
    );

    expect(result.validRows).toEqual([]);
    expect(result.errors).toEqual([
      "Row 2: contract_date must be YYYY-MM-DD.",
      "Row 3: Business registration number must contain 10 digits.",
    ]);
  });

  it("maps blank optional fields to null", () => {
    const result = parseContractCsv(
      [
        "biz_no,business_name,contract_date,contract_name,representative_name,current_contract_amount,total_contract_amount,notice_no",
        "123-45-67890,Sample Co,2026-01-15,Printer supply,,,,",
      ].join("\n"),
      "sample.csv",
    );

    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({
      representativeName: null,
      currentContractAmount: null,
      totalContractAmount: null,
      noticeNo: null,
    });
    expect(result.errors).toEqual([]);
  });

  it("handles BOM, CRLF, and blank lines", () => {
    const result = parseContractCsv(`\uFEFF${requiredHeaders}\r\n\r\n${validRow}\r\n`, "sample.csv");

    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({
      bizNoNormalized: "1234567890",
      contractDate: "2026-01-15",
    });
    expect(result.errors).toEqual([]);
  });

  it("parses quoted commas and escaped quotes", () => {
    const result = parseContractCsv(
      [
        requiredHeaders,
        '123-45-67890,"Sample, Co",2026-01-15,"Printer ""supply"""',
      ].join("\n"),
      "sample.csv",
    );

    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({
      businessName: "Sample, Co",
      contractName: 'Printer "supply"',
    });
    expect(result.errors).toEqual([]);
  });

  it("rejects rows with field-count mismatches", () => {
    const result = parseContractCsv(
      [requiredHeaders, "123-45-67890,Sample, Co,2026-01-15,Printer supply"].join("\n"),
      "sample.csv",
    );

    expect(result.validRows).toEqual([]);
    expect(result.errors).toEqual(["Row 2: Expected 4 columns but found 5."]);
  });

  it("rejects malformed non-blank amount fields", () => {
    const result = parseContractCsv(
      [
        "biz_no,business_name,contract_date,contract_name,current_contract_amount,total_contract_amount",
        "123-45-67890,Sample Co,2026-01-15,Printer supply,12x,1000",
        "123-45-67890,Sample Co,2026-01-16,Paper supply,1000,won",
      ].join("\n"),
      "sample.csv",
    );

    expect(result.validRows).toEqual([]);
    expect(result.errors).toEqual([
      "Row 2: current_contract_amount must be a valid amount.",
      "Row 3: total_contract_amount must be a valid amount.",
    ]);
  });
});
