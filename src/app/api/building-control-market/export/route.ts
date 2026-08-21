import { NextRequest, NextResponse } from "next/server";

import {
  buildMarketWorkbook,
  marketWorkbookFileName,
} from "@/lib/building-control-market/excel";
import {
  buildMarketShareReport,
  isReportBasis,
  isReportRegion,
  type ReportBasis,
  type ReportRegion,
} from "@/lib/building-control-market/report";
import {
  COOPERATIVE_BIZ_NO,
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
    const awards = listMarketAwards(db);
    const contracts = listMarketContracts(db);
    const registry = listExcellentRegistry(db);
    const report = buildMarketShareReport({
      period,
      awards,
      contracts,
      basis,
      region,
      excellentRegistry: registry,
      cooperativeBizNo: COOPERATIVE_BIZ_NO,
    });
    const workbook = await buildMarketWorkbook({ report, basis, region, awards, contracts });
    const fileName = marketWorkbookFileName(basis, region, period);
    return new NextResponse(workbook, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="market-report.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 생성하지 못했습니다." },
      { status: 400 },
    );
  } finally {
    db.close();
  }
}
