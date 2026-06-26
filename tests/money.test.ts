import { describe, expect, it } from "vitest";
import { parseAmountToWon } from "@/lib/domain/money";

describe("parseAmountToWon", () => {
  it("parses commas and blank values", () => {
    expect(parseAmountToWon("1,234,500")).toBe(1234500);
    expect(parseAmountToWon("")).toBeNull();
  });
});
