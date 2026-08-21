import { NextRequest, NextResponse } from "next/server";

import {
  buildMarketShareReport,
  isReportBasis,
  isReportRegion,
  type ReportBasis,
  type ReportRegion,
} from "@/lib/building-control-market/report";
import {
  COOPERATIVE_BIZ_NO,
  getMarketSyncState,
  initMarketStore,
  listExcellentRegistry,
  listMarketAwards,
  listMarketContracts,
} from "@/lib/building-control-market/store";
import { createSqliteConnection } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year"));
  const quarterValue = request.nextUrl.searchParams.get("quarter");
  const basisValue = request.nextUrl.searchParams.get("basis");
  const regionValue = request.nextUrl.searchParams.get("region");

  const basis: ReportBasis = isReportBasis(basisValue) ? basisValue : "award";
  const region: ReportRegion = isReportRegion(regionValue) ? regionValue : "all";
  const period = quarterValue ? { year, quarter: Number(quarterValue) } : { year };

  const db = createSqliteConnection();
  try {
    initMarketStore(db);
    const registry = listExcellentRegistry(db);
    const awards = listMarketAwards(db);
    const contracts = listMarketContracts(db);
    const report = buildMarketShareReport({
      period,
      awards,
      contracts,
      basis,
      region,
      excellentRegistry: registry,
      cooperativeBizNo: COOPERATIVE_BIZ_NO,
    });
    return NextResponse.json({
      ...report,
      basis,
      region,
      registry,
      sync: getMarketSyncState(db),
    });
  } catch {
    return NextResponse.json(
      { error: "조회 조건 또는 저장 데이터를 확인해 주세요." },
      { status: 400 },
    );
  } finally {
    db.close();
  }
}
