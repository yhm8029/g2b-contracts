import { NextRequest, NextResponse } from "next/server";

import {
  initMarketStore,
  listExcellentRegistry,
  updateExcellentRegistry,
  type StoredExcellentRegistryEntry,
} from "@/lib/building-control-market/store";
import { createSqliteConnection } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET() {
  const db = createSqliteConnection();
  try {
    initMarketStore(db);
    return NextResponse.json({ registry: listExcellentRegistry(db) });
  } finally {
    db.close();
  }
}

export async function PATCH(request: NextRequest) {
  const db = createSqliteConnection();
  try {
    initMarketStore(db);
    updateExcellentRegistry(db, await request.json() as StoredExcellentRegistryEntry);
    return NextResponse.json({ registry: listExcellentRegistry(db) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "업체 정보를 수정하지 못했습니다." }, { status: 400 });
  } finally {
    db.close();
  }
}
