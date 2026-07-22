import { NextRequest, NextResponse } from "next/server";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import {
  CompetitorContractConfigurationError,
  CompetitorContractInputError,
  CompetitorContractUpstreamError,
  resolveCompetitorContractServiceKey,
} from "@/lib/competitors/contracts";
import { getCompetitorSalesOverview } from "@/lib/competitors/service";
import { resolveCompetitorSalesPeriod } from "@/lib/competitors/overview";
import type { CompetitorSalesPeriodQuery } from "@/lib/competitors/types";

export const runtime = "nodejs";

const ALLOWED_QUERY_KEYS = new Set(["period", "year", "month", "quarter"]);
const INVALID_PERIOD = { error: "조회 기간이 올바르지 않습니다." };

export async function GET(request: NextRequest) {
  const query = parseQuery(request.nextUrl.searchParams, new Date());
  if (query === null) return NextResponse.json(INVALID_PERIOD, { status: 400 });

  const serviceKey = resolveCompetitorContractServiceKey();
  const connection = createDb();
  try {
    initializeSqliteSchema(connection.sqlite);
    const overview = await getCompetitorSalesOverview({
      query,
      serviceKey,
      sqlite: connection.sqlite,
      signal: request.signal,
    });
    return NextResponse.json(overview);
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) {
      return NextResponse.json({ error: "조회 요청이 취소되었습니다." }, { status: 499 });
    }
    if (error instanceof CompetitorContractInputError) {
      return NextResponse.json(INVALID_PERIOD, { status: 400 });
    }
    if (isCompetitorContractConfigurationError(error)) {
      return NextResponse.json(
        { error: "공공데이터포털 서비스 키가 설정되지 않았습니다." },
        { status: 503 },
      );
    }
    if (error instanceof CompetitorContractUpstreamError && error.kind === "temporary") {
      return NextResponse.json(
        { error: "조달청 계약 조회가 지연되고 있습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "조달청 계약 데이터를 조회하지 못했습니다." },
      { status: 502 },
    );
  } finally {
    connection.sqlite.close();
  }
}

function parseQuery(params: URLSearchParams, now: Date): CompetitorSalesPeriodQuery | null {
  if ([...params.keys()].some((key) => !ALLOWED_QUERY_KEYS.has(key))) return null;
  if ([...ALLOWED_QUERY_KEYS].some((key) => params.getAll(key).length > 1)) return null;

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
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function seoulYear(now: Date) {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(now));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isCompetitorContractConfigurationError(error: unknown) {
  if (error instanceof CompetitorContractConfigurationError) return true;
  try {
    return (
      typeof error === "object"
      && error !== null
      && "name" in error
      && error.name === "CompetitorContractConfigurationError"
      && "reason" in error
      && error.reason === "service_key_missing"
    );
  } catch {
    return false;
  }
}
