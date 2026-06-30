import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { searchContractsByBusinessNumbers } from "@/lib/contracts/repository";
import type { ContractSearchParams } from "@/lib/contracts/types";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { parseBusinessNumberList } from "@/lib/domain/business-number";
import { contractsToCsv } from "@/lib/export/csv";

export const runtime = "nodejs";

const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const querySchema = z.object({
  bizNo: z
    .string()
    .min(1, "bizNo is required")
    .refine((value) => canParseBusinessNumberList(value), {
      message: "each bizNo must contain 10 digits",
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

function isBusinessNumberError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Business registration number");
}

function canParseBusinessNumberList(value: string): boolean {
  try {
    parseBusinessNumberList(value);
    return true;
  } catch {
    return false;
  }
}

function exportFileName(bizNo: string): string {
  const businessNumbers = parseBusinessNumberList(bizNo);
  const suffix = businessNumbers.length === 1 ? businessNumbers[0] : "multi";

  return `g2b-contracts-${suffix}.csv`;
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
    const rows = searchContractsByBusinessNumbers(connection.db, params);
    const csv = contractsToCsv(rows);

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFileName(params.bizNo)}"`,
      },
    });
  } catch (error) {
    if (isBusinessNumberError(error)) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
    }

    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  } finally {
    connection?.sqlite.close();
  }
}
