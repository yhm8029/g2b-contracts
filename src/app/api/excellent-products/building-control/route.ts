import { NextResponse } from "next/server";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { getBuildingControlExcellentProducts } from "@/lib/excellent-products/repository";

export const runtime = "nodejs";

export async function GET() {
  let connection: ReturnType<typeof createDb> | undefined;
  try {
    connection = createDb();
    initializeSqliteSchema(connection.sqlite);
    return NextResponse.json(getBuildingControlExcellentProducts(connection.db));
  } catch {
    return NextResponse.json({ error: "Excellent products lookup failed." }, { status: 500 });
  } finally {
    connection?.sqlite.close();
  }
}
