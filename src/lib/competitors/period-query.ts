import { resolveCompetitorSalesPeriod } from "./overview";
import type { CompetitorSalesPeriodQuery } from "./types";

const PERIOD_QUERY_KEYS = ["period", "year", "month", "quarter"] as const;

export function parseCompetitorSalesPeriodQuery(
  params: URLSearchParams,
  options: {
    now?: Date;
    extraAllowedKeys?: readonly string[];
  } = {},
): CompetitorSalesPeriodQuery | null {
  const now = options.now ?? new Date();
  const allowedKeys = new Set<string>([...PERIOD_QUERY_KEYS, ...(options.extraAllowedKeys ?? [])]);
  if ([...params.keys()].some((key) => !allowedKeys.has(key))) return null;
  if ([...allowedKeys].some((key) => params.getAll(key).length > 1)) return null;

  const period = params.get("period");
  const year = parseInteger(params.get("year"));
  const month = parseInteger(params.get("month"));
  const quarter = parseInteger(params.get("quarter"));
  const hasMonth = params.has("month");
  const hasQuarter = params.has("quarter");
  if (period === null || year === null || year < 2004 || year > seoulYear(now)) return null;

  let query: CompetitorSalesPeriodQuery | null = null;
  if (period === "month" && hasMonth && !hasQuarter && month !== null && month >= 1 && month <= 12) {
    query = { period, year, month };
  }
  if (period === "quarter" && hasQuarter && !hasMonth && quarter !== null && quarter >= 1 && quarter <= 4) {
    query = { period, year, quarter };
  }
  if (period === "year" && !hasMonth && !hasQuarter) query = { period, year };
  if (query === null) return null;

  try {
    resolveCompetitorSalesPeriod(query, now);
    return query;
  } catch {
    return null;
  }
}

function parseInteger(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function seoulYear(now: Date) {
  return Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(now));
}
