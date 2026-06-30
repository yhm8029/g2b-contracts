import { describe, expect, it } from "vitest";
import {
  formatBusinessNumber,
  normalizeBusinessNumber,
  parseBusinessNumber,
  parseBusinessNumberList,
} from "@/lib/domain/business-number";

describe("business-number", () => {
  it("normalizes hyphenated input", () => {
    expect(normalizeBusinessNumber("123-45-67890")).toBe("1234567890");
  });

  it("rejects non-10-digit input", () => {
    expect(() => parseBusinessNumber("123")).toThrow("Business registration number must contain 10 digits.");
  });

  it("formats normalized input for display", () => {
    expect(formatBusinessNumber("1234567890")).toBe("123-45-67890");
  });

  it("parses comma and newline separated business numbers in order", () => {
    expect(parseBusinessNumberList("123-45-67890, 2048145651\n220-81-92516")).toEqual([
      "1234567890",
      "2048145651",
      "2208192516",
    ]);
  });

  it("parses whitespace separated business numbers from pasted single-line input", () => {
    expect(parseBusinessNumberList("5028142086 1238180252 1068133832")).toEqual([
      "5028142086",
      "1238180252",
      "1068133832",
    ]);
  });

  it("parses slash separated pasted business numbers", () => {
    expect(parseBusinessNumberList("5028142086/1238180252/1068133832")).toEqual([
      "5028142086",
      "1238180252",
      "1068133832",
    ]);
  });

  it("accepts up to 50 business numbers", () => {
    const values = Array.from({ length: 50 }, (_, index) => `${1000000000 + index}`).join(",");

    expect(parseBusinessNumberList(values)).toHaveLength(50);
  });

  it("deduplicates business numbers after normalization while preserving first order", () => {
    expect(parseBusinessNumberList("2048145651, 204-81-45651, 1234567890")).toEqual([
      "2048145651",
      "1234567890",
    ]);
  });

  it("rejects more than 50 business numbers", () => {
    const values = Array.from({ length: 51 }, (_, index) => `${1000000000 + index}`).join(",");

    expect(() => parseBusinessNumberList(values)).toThrow("Business registration number list can contain up to 50 entries.");
  });
});
