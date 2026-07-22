import { NextRequest, NextResponse } from "next/server";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { buildCompetitorSalesWorkbook } from "@/lib/competitors/excel";
import { parseCompetitorSalesPeriodQuery } from "@/lib/competitors/period-query";
import { getCompetitorSalesOverview } from "@/lib/competitors/service";

export const runtime = "nodejs";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(request: NextRequest) {
  const query = parseCompetitorSalesPeriodQuery(request.nextUrl.searchParams);
  if (query === null) {
    return NextResponse.json({ error: "조회 기간이 올바르지 않습니다." }, { status: 400 });
  }

  const connection = createDb();
  try {
    initializeSqliteSchema(connection.sqlite);
    const overview = await getCompetitorSalesOverview({
      query,
      serviceKey: "",
      sqlite: connection.sqlite,
      cacheOnly: true,
    });
    if (!overview.coverage.complete || !overview.coverage.fresh) {
      return NextResponse.json(
        { error: "조회가 완료된 후 엑셀을 내보낼 수 있습니다." },
        { status: 409 },
      );
    }

    const workbook = await buildCompetitorSalesWorkbook(overview);
    return new NextResponse(workbook, {
      status: 200,
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="competitor-sales-${overview.period.label}.xlsx"`,
        "Content-Length": String(workbook.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ error: "엑셀 파일을 생성하지 못했습니다." }, { status: 500 });
  } finally {
    connection.sqlite.close();
  }
}
