import { NextRequest, NextResponse } from "next/server";

import { buildMarketShareReport } from "@/lib/building-control-market/report";
import {
  COOPERATIVE_BIZ_NO,
  getMarketSyncState,
  initMarketStore,
  listExcellentRegistry,
  listMarketAwards,
} from "@/lib/building-control-market/store";
import { createSqliteConnection } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year"));
  const quarterValue = request.nextUrl.searchParams.get("quarter");
  const period = quarterValue ? { year, quarter: Number(quarterValue) } : { year };
  const db = createSqliteConnection();
  try {
    initMarketStore(db);
    const registry = listExcellentRegistry(db);
    const report = buildMarketShareReport({
      period,
      awards: listMarketAwards(db),
      excellentRegistry: registry,
      cooperativeBizNo: COOPERATIVE_BIZ_NO,
    });
    return NextResponse.json({ ...report, registry, sync: getMarketSyncState(db) });
  } catch {
    return NextResponse.json({ error: "조회 조건 또는 저장 데이터를 확인해 주세요." }, { status: 400 });
  } finally {
    db.close();
  }
}
