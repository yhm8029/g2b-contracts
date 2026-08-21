import { NextRequest, NextResponse } from "next/server";

import { buildMarketWorkbook } from "@/lib/building-control-market/excel";
import { buildMarketShareReport } from "@/lib/building-control-market/report";
import { COOPERATIVE_BIZ_NO, initMarketStore, listExcellentRegistry, listMarketAwards } from "@/lib/building-control-market/store";
import { createSqliteConnection } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year"));
  const quarterValue = request.nextUrl.searchParams.get("quarter");
  const period = quarterValue ? { year, quarter: Number(quarterValue) } : { year };
  const db = createSqliteConnection();
  try {
    initMarketStore(db);
    const awards = listMarketAwards(db);
    const report = buildMarketShareReport({ period, awards, excellentRegistry: listExcellentRegistry(db), cooperativeBizNo: COOPERATIVE_BIZ_NO });
    const workbook = await buildMarketWorkbook(report, awards);
    const suffix = period.quarter ? `-Q${period.quarter}` : "";
    return new NextResponse(workbook, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="building-control-market-${period.year}${suffix}.xlsx"`,
      "Cache-Control": "no-store",
    } });
  } catch {
    return NextResponse.json({ error: "엑셀을 생성하지 못했습니다." }, { status: 400 });
  } finally {
    db.close();
  }
}
