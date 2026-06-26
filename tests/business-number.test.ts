import { describe, expect, it } from "vitest";
import { formatBusinessNumber, normalizeBusinessNumber, parseBusinessNumber } from "@/lib/domain/business-number";

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
});
