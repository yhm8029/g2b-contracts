import { NextResponse } from "next/server";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import {
  syncBuildingControlCompanies,
  type ExcellentProductSyncResult,
} from "@/lib/excellent-products/enrichment";
import { redactG2bSecrets } from "@/lib/g2b/http";

export const runtime = "nodejs";

let inFlightSync: Promise<ExcellentProductSyncResult> | null = null;

function startSync(): Promise<ExcellentProductSyncResult> {
  if (inFlightSync !== null) {
    return inFlightSync;
  }

  const current = (async () => {
    let connection: ReturnType<typeof createDb> | undefined;
    try {
      connection = createDb();
      initializeSqliteSchema(connection.sqlite);
      return await syncBuildingControlCompanies(connection.db);
    } finally {
      connection?.sqlite.close();
    }
  })();

  inFlightSync = current;
  current.then(
    () => {
      if (inFlightSync === current) inFlightSync = null;
    },
    () => {
      if (inFlightSync === current) inFlightSync = null;
    },
  );
  return current;
}

function sanitizeResult(result: ExcellentProductSyncResult): ExcellentProductSyncResult {
  return {
    ...result,
    errors: result.errors.map((error) => ({
      ...error,
      message: redactG2bSecrets(error.message),
    })),
  };
}

export async function POST(_request?: Request) {
  try {
    const result = sanitizeResult(await startSync());
    const allAttemptedCompaniesFailed =
      result.processedCompanies > 0 &&
      result.updatedCompanies === 0 &&
      result.errors.length > 0;
    return NextResponse.json(result, { status: allAttemptedCompaniesFailed ? 500 : 200 });
  } catch {
    return NextResponse.json({ error: "Excellent products sync failed." }, { status: 500 });
  }
}
