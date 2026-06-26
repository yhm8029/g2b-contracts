import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDatabaseHealth, searchContractsByBusinessNumber } from "@/lib/contracts/repository";
import { summarizeContracts } from "@/lib/contracts/summary";
import type { ContractSearchParams } from "@/lib/contracts/types";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { normalizeBusinessNumber } from "@/lib/domain/business-number";

export const runtime = "nodejs";

const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const querySchema = z.object({
  bizNo: z
    .string()
    .min(1, "bizNo is required")
    .refine((value) => /^\d{10}$/.test(normalizeBusinessNumber(value)), {
      message: "bizNo must contain 10 digits",
    }),
  dateFrom: dateParamSchema.optional(),
  dateTo: dateParamSchema.optional(),
  businessCategory: z.string().min(1).optional(),
});

function queryFromRequest(request: NextRequest): Record<string, string | undefined> {
  const { searchParams } = request.nextUrl;

  return {
    bizNo: searchParams.get("bizNo") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    businessCategory: searchParams.get("businessCategory") ?? undefined,
  };
}

function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function apiHealth() {
  return {
    apiKeyConfigured: (process.env.DATA_GO_KR_SERVICE_KEY?.trim().length ?? 0) > 0,
    enrichmentEnabled: process.env.ENRICHMENT_ENABLED === "true",
  };
}

export function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(queryFromRequest(request));

  if (!parsed.success) {
    return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  }

  let connection: ReturnType<typeof createDb> | undefined;

  try {
    connection = createDb();
    initializeSqliteSchema(connection.sqlite);

    const params: ContractSearchParams = parsed.data;
    const rows = searchContractsByBusinessNumber(connection.db, params);
    const summary = summarizeContracts(rows);
    const health = { ...getDatabaseHealth(connection.db), ...apiHealth() };

    return NextResponse.json({ rows, summary, health });
  } catch (error) {
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  } finally {
    connection?.sqlite.close();
  }
}
