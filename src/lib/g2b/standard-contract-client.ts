import { fetchG2bJson, redactG2bSecrets } from "@/lib/g2b/http";
import type { StandardContractRow } from "@/lib/g2b/standard-contract-mapper";

export const STANDARD_CONTRACT_BASE_URL = "https://apis.data.go.kr/1230000/ao/PubDataOpnStdService";
export const GET_STANDARD_CONTRACT_OPERATION = "getDataSetOpnStdCntrctInfo";

export type StandardContractChunk = {
  dateFrom: string;
  dateTo: string;
};

export type StandardContractPage = {
  items: StandardContractRow[];
  totalCount: number;
  pageNo: number;
  numOfRows: number;
};

export type G2bStandardContractErrorCode =
  | "unauthorized_service_key"
  | "date_range_too_large"
  | "provider_error";

export class G2bStandardContractError extends Error {
  constructor(
    public readonly code: G2bStandardContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "G2bStandardContractError";
  }
}

export async function fetchStandardContractPage(
  chunk: StandardContractChunk,
  pageNo: number,
  numOfRows = 100,
): Promise<StandardContractPage> {
  try {
    const response = await fetchG2bJson(STANDARD_CONTRACT_BASE_URL, GET_STANDARD_CONTRACT_OPERATION, {
      cntrctCnclsBgnDate: toProviderDate(chunk.dateFrom),
      cntrctCnclsEndDate: toProviderDate(chunk.dateTo),
      pageNo,
      numOfRows,
    });

    const body = successfulResponseBody(response);

    return {
      items: normalizeItems(body?.items ?? body?.item),
      totalCount: parseCount(body?.totalCount),
      pageNo,
      numOfRows,
    };
  } catch (error) {
    if (error instanceof G2bStandardContractError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("403")) {
      throw new G2bStandardContractError(
        "unauthorized_service_key",
        "G2B standard contract request was rejected with status 403.",
      );
    }

    throw new G2bStandardContractError("provider_error", redactG2bSecrets(message));
  }
}

function successfulResponseBody(response: unknown): Record<string, unknown> {
  if (!isRecord(response) || !isRecord(response.response)) {
    throw malformedProviderResponse("missing response envelope");
  }

  const envelope = response.response;
  if (!isRecord(envelope.header)) {
    throw malformedProviderResponse("missing response header");
  }

  const resultCode = asString(envelope.header.resultCode);
  const resultMsg = asString(envelope.header.resultMsg);

  if (resultCode === null) {
    throw malformedProviderResponse("missing resultCode");
  }

  if (resultCode === "00") {
    if (!isRecord(envelope.body)) {
      throw malformedProviderResponse("missing response body");
    }

    return envelope.body;
  }

  if (isUnauthorizedServiceKeyMessage(resultMsg)) {
    throw new G2bStandardContractError(
      "unauthorized_service_key",
      resultMsg ?? "G2B standard contract service key is unauthorized.",
    );
  }

  if (isDateRangeTooLargeMessage(resultMsg)) {
    throw new G2bStandardContractError("date_range_too_large", resultMsg ?? "Date range is too large.");
  }

  throw new G2bStandardContractError(
    "provider_error",
    `G2B standard contract provider error ${resultCode}: ${resultMsg ?? "Unknown provider error."}`,
  );
}

function malformedProviderResponse(reason: string): G2bStandardContractError {
  return new G2bStandardContractError("provider_error", `Malformed G2B standard contract response: ${reason}.`);
}

function normalizeItems(value: unknown): StandardContractRow[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (isRecord(value) && "item" in value) {
    return normalizeItems(value.item);
  }

  return isRecord(value) ? [value] : [];
}

function toProviderDate(value: string): string {
  return value.replace(/-/g, "");
}

function parseCount(value: unknown): number {
  const text = asString(value);

  if (text === null || !/^\d+$/.test(text)) {
    throw new G2bStandardContractError("provider_error", "Malformed G2B standard contract response: invalid totalCount.");
  }

  return Number(text);
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnauthorizedServiceKeyMessage(message: string | null): boolean {
  return message !== null && /service\s*key|unauthorized|forbidden|인증키|서비스키/i.test(message);
}

function isDateRangeTooLargeMessage(message: string | null): boolean {
  return (
    message !== null &&
    (/date\s*range|too\s*large|too\s*long|exceed|over/i.test(message) ||
      (message.includes("기간") && /초과|이상|크|넓|길/.test(message)))
  );
}
