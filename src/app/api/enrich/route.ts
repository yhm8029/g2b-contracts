import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { enrichContractRecord } from "@/lib/g2b/enrichment";

export const runtime = "nodejs";

const requestBodySchema = z.object({
  recordId: z.number().int().positive(),
});

function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export async function POST(request: NextRequest) {
  if (process.env.ENRICHMENT_ENABLED !== "true") {
    return NextResponse.json({ error: "API enrichment disabled." }, { status: 403 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = requestBodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  }

  let connection: ReturnType<typeof createDb> | undefined;

  try {
    connection = createDb();
    initializeSqliteSchema(connection.sqlite);

    const result = await enrichContractRecord(connection.db, parsed.data.recordId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Enrichment failed." }, { status: 500 });
  } finally {
    connection?.sqlite.close();
  }
}
