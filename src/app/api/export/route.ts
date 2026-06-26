import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { searchContractsByBusinessNumber } from "@/lib/contracts/repository";
import type { ContractSearchParams } from "@/lib/contracts/types";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { normalizeBusinessNumber } from "@/lib/domain/business-number";
import { contractsToCsv } from "@/lib/export/csv";

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error";
}

function isRepositoryValidationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Business registration number");
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
    const csv = contractsToCsv(rows);
    const normalizedBizNo = normalizeBusinessNumber(params.bizNo);

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="g2b-contracts-${normalizedBizNo}.csv"`,
      },
    });
  } catch (error) {
    const status = isRepositoryValidationError(error) ? 400 : 500;
    return NextResponse.json({ error: errorMessage(error) }, { status });
  } finally {
    connection?.sqlite.close();
  }
}
