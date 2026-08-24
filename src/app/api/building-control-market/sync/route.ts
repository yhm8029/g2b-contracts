import { NextResponse } from "next/server";

import { initMarketStore } from "@/lib/building-control-market/store";
import { classifyMarketSyncError, syncMarketData } from "@/lib/building-control-market/sync";
import { createSqliteConnection } from "@/lib/db/client";
import { redactG2bSecrets } from "@/lib/g2b/http";

export const runtime = "nodejs";
export const maxDuration = 900;

let inFlight: Promise<unknown> | null = null;

export async function POST() {
  if (inFlight) return NextResponse.json({ error: "이미 동기화가 진행 중입니다." }, { status: 409 });
  const db = createSqliteConnection();
  initMarketStore(db);
  inFlight = syncMarketData(db);
  try {
    return NextResponse.json(await inFlight);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = redactG2bSecrets(message);
    const classified = classifyMarketSyncError(error);
    console.error("building-control-market sync failed:", detail);
    return NextResponse.json({
      error: classified.message,
      code: classified.code,
      detail: classified.status === "quota_exhausted" ? undefined : detail,
    }, { status: classified.status === "quota_exhausted" ? 429 : 502 });
  } finally {
    inFlight = null;
    db.close();
  }
}
