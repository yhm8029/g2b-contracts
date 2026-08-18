import { NextRequest, NextResponse } from "next/server";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import {
  CompetitorContractConfigurationError,
  CompetitorContractInputError,
  CompetitorContractUpstreamError,
  resolveCompetitorContractServiceKey,
} from "@/lib/competitors/contracts";
import { parseCompetitorSalesPeriodQuery } from "@/lib/competitors/period-query";
import { getCompetitorSalesOverview } from "@/lib/competitors/service";
import type { CompetitorSalesPeriodQuery } from "@/lib/competitors/types";

export const runtime = "nodejs";

const inFlightOverviews = new Map<string, ReturnType<typeof getCompetitorSalesOverview>>();
const INVALID_PERIOD = { error: "조회 기간이 올바르지 않습니다." };

export async function GET(request: NextRequest) {
  const query = parseCompetitorSalesPeriodQuery(request.nextUrl.searchParams, {
    extraAllowedKeys: ["cacheOnly", "refresh"],
  });
  const cacheOnly = parseCacheOnly(request.nextUrl.searchParams);
  const refresh = parseRefresh(request.nextUrl.searchParams);
  if (query === null || cacheOnly === null || refresh === null || (cacheOnly && refresh)) {
    return NextResponse.json(INVALID_PERIOD, { status: 400 });
  }

  const serviceKey = resolveCompetitorContractServiceKey();
  try {
    const overview = await waitForRequestAbort(
      getSharedOverview(query, serviceKey, { cacheOnly, refresh }),
      request.signal,
    );
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
  }
}

function getSharedOverview(
  query: CompetitorSalesPeriodQuery,
  serviceKey: string,
  options: { cacheOnly: boolean; refresh: boolean },
) {
  const key = normalizedQueryKey(query, options);
  const existing = inFlightOverviews.get(key);
  if (existing) return existing;

  const shared = loadOverview(query, serviceKey, options);
  inFlightOverviews.set(key, shared);
  shared.then(
    () => removeSettledOverview(key, shared),
    () => removeSettledOverview(key, shared),
  );
  return shared;
}

async function loadOverview(
  query: CompetitorSalesPeriodQuery,
  serviceKey: string,
  options: { cacheOnly: boolean; refresh: boolean },
) {
  const connection = createDb();
  try {
    initializeSqliteSchema(connection.sqlite);
    return await getCompetitorSalesOverview({
      query,
      serviceKey,
      sqlite: connection.sqlite,
      cacheOnly: options.cacheOnly,
      refreshRecent: options.refresh,
    });
  } finally {
    connection.sqlite.close();
  }
}

function removeSettledOverview(
  key: string,
  shared: ReturnType<typeof getCompetitorSalesOverview>,
) {
  if (inFlightOverviews.get(key) === shared) inFlightOverviews.delete(key);
}

function normalizedQueryKey(
  query: CompetitorSalesPeriodQuery,
  options: { cacheOnly: boolean; refresh: boolean },
) {
  return JSON.stringify({
    period: query.period,
    year: query.year,
    month: query.period === "month" ? query.month ?? null : null,
    quarter: query.period === "quarter" ? query.quarter ?? null : null,
    cacheOnly: options.cacheOnly,
    refresh: options.refresh,
  });
}

function waitForRequestAbort<T>(shared: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function createAbortError() {
  return new DOMException("The request was aborted", "AbortError");
}

function parseCacheOnly(params: URLSearchParams) {
  if (!params.has("cacheOnly")) return false;
  return params.get("cacheOnly") === "1" ? true : null;
}

function parseRefresh(params: URLSearchParams) {
  if (!params.has("refresh")) return false;
  return params.get("refresh") === "1" ? true : null;
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
