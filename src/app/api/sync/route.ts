import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { normalizeBusinessNumber } from "@/lib/domain/business-number";
import { getServiceKey, redactG2bSecrets } from "@/lib/g2b/http";
import {
  syncStandardContractsForBusiness,
  type StandardContractSyncResult,
} from "@/lib/g2b/standard-contract-sync";

export const runtime = "nodejs";

const SERVICE_APPROVAL_MESSAGE =
  "Public Data Portal service usage approval is required for the G2B public data open standard service.";
const SHOPPING_MALL_SERVICE_APPROVAL_MESSAGE =
  "Public Data Portal service usage approval is required for the G2B shopping mall delivery request service.";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine(isValidIsoDate, "Expected a valid calendar date");

const requestBodySchema = z
  .object({
    bizNo: z
      .string()
      .min(1, "bizNo is required")
      .refine((value) => /^\d{10}$/.test(normalizeBusinessNumber(value)), {
        message: "bizNo must contain 10 digits",
      }),
    dateFrom: dateSchema,
    dateTo: dateSchema,
    businessCategory: z.string().min(1).optional(),
  })
  .refine((value) => value.dateFrom <= value.dateTo, {
    message: "dateFrom must be before or equal to dateTo",
    path: ["dateFrom"],
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

  if (getServiceKey() === null) {
    return NextResponse.json(
      { error: "DATA_GO_KR_SERVICE_KEY is required for G2B sync." },
      { status: 403 },
    );
  }

  let connection: ReturnType<typeof createDb> | undefined;

  try {
    connection = createDb();
    initializeSqliteSchema(connection.sqlite);

    const result = sanitizeSyncResult(
      await syncStandardContractsForBusiness(connection.db, parsed.data),
    );

    if (hasBlockingUnauthorizedServiceKeyError(result)) {
      return NextResponse.json({ error: serviceApprovalMessage(result) }, { status: 403 });
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "G2B sync failed." }, { status: 500 });
  } finally {
    connection?.sqlite.close();
  }
}

function sanitizeSyncResult(result: StandardContractSyncResult): StandardContractSyncResult {
  return {
    ...result,
    errors: result.errors.map((error) => ({
      ...error,
      message: redactG2bSecrets(error.message),
    })),
  };
}

function hasBlockingUnauthorizedServiceKeyError(result: StandardContractSyncResult): boolean {
  return result.status === "failed" && result.errors.some((error) => error.code === "unauthorized_service_key");
}

function serviceApprovalMessage(result: StandardContractSyncResult): string {
  const unauthorizedMessages = result.errors
    .filter((error) => error.code === "unauthorized_service_key")
    .map((error) => error.message.toLowerCase());

  return unauthorizedMessages.some((message) => message.includes("shopping mall"))
    ? SHOPPING_MALL_SERVICE_APPROVAL_MESSAGE
    : SERVICE_APPROVAL_MESSAGE;
}

function isValidIsoDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.toISOString().slice(0, 10) === value;
}
