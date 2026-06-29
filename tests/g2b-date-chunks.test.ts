import { describe, expect, it } from "vitest";
import {
  splitDateRangeIntoDays,
  splitDateRangeIntoMonths,
  splitDateRangeIntoWeeks,
} from "@/lib/g2b/date-chunks";

describe("g2b date chunks", () => {
  it("splits a partial range into calendar months", () => {
    expect(splitDateRangeIntoMonths("2025-01-15", "2025-03-02")).toEqual([
      { dateFrom: "2025-01-15", dateTo: "2025-01-31", granularity: "month" },
      { dateFrom: "2025-02-01", dateTo: "2025-02-28", granularity: "month" },
      { dateFrom: "2025-03-01", dateTo: "2025-03-02", granularity: "month" },
    ]);
  });

  it("splits a month into seven-day week chunks", () => {
    expect(splitDateRangeIntoWeeks("2026-06-01", "2026-06-15")).toEqual([
      { dateFrom: "2026-06-01", dateTo: "2026-06-07", granularity: "week" },
      { dateFrom: "2026-06-08", dateTo: "2026-06-14", granularity: "week" },
      { dateFrom: "2026-06-15", dateTo: "2026-06-15", granularity: "week" },
    ]);
  });

  it("splits a short range into days", () => {
    expect(splitDateRangeIntoDays("2026-06-27", "2026-06-29")).toEqual([
      { dateFrom: "2026-06-27", dateTo: "2026-06-27", granularity: "day" },
      { dateFrom: "2026-06-28", dateTo: "2026-06-28", granularity: "day" },
      { dateFrom: "2026-06-29", dateTo: "2026-06-29", granularity: "day" },
    ]);
  });

  it("throws a clear error for invalid dates", () => {
    expect(() => splitDateRangeIntoDays("2026-02-30", "2026-03-01")).toThrow(
      "Invalid date range: dateFrom must be a valid ISO date (YYYY-MM-DD)",
    );
    expect(() => splitDateRangeIntoDays("2026-03-01", "not-a-date")).toThrow(
      "Invalid date range: dateTo must be a valid ISO date (YYYY-MM-DD)",
    );
  });

  it("throws a clear error for a reversed range", () => {
    expect(() => splitDateRangeIntoMonths("2026-06-29", "2026-06-01")).toThrow(
      "Invalid date range: dateFrom must be before or equal to dateTo",
    );
  });
});
