import { describe, expect, it } from "vitest";

import { parseCompetitorSalesPeriodQuery } from "@/lib/competitors/period-query";

describe("competitor sales period query parser", () => {
  const now = new Date("2026-07-22T03:00:00.000Z");

  it("parses strict month, quarter, and year queries", () => {
    expect(parse("period=month&year=2026&month=7")).toEqual({ period: "month", year: 2026, month: 7 });
    expect(parse("period=quarter&year=2026&quarter=2")).toEqual({ period: "quarter", year: 2026, quarter: 2 });
    expect(parse("period=year&year=2025")).toEqual({ period: "year", year: 2025 });
  });

  it("rejects unknown, duplicate, mismatched, malformed, and future parameters", () => {
    const invalid = [
      "period=year&year=2025&extra=1",
      "period=year&period=month&year=2025",
      "period=year&year=2025&month=1",
      "period=month&year=2026&month=abc",
      "period=month&year=2026&month=8",
    ];

    for (const query of invalid) expect(parse(query)).toBeNull();
  });

  it("allows configured extra keys while still rejecting duplicate extras", () => {
    const options = { now, extraAllowedKeys: ["cacheOnly"] };

    expect(parseCompetitorSalesPeriodQuery(
      new URLSearchParams("period=year&year=2025&cacheOnly=1"),
      options,
    )).toEqual({ period: "year", year: 2025 });
    expect(parse("period=year&year=2025&cacheOnly=1")).toBeNull();
    expect(parseCompetitorSalesPeriodQuery(
      new URLSearchParams("period=year&year=2025&cacheOnly=1&cacheOnly=1"),
      options,
    )).toBeNull();
  });

  function parse(query: string) {
    return parseCompetitorSalesPeriodQuery(new URLSearchParams(query), { now });
  }
});
