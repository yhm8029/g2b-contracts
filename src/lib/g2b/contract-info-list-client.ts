import { fetchG2bJson, redactG2bSecrets } from "@/lib/g2b/http";
import {
  G2bStandardContractError,
  type G2bContractBusinessCategory,
  type StandardContractChunk,
  type StandardContractPage,
} from "@/lib/g2b/standard-contract-client";
import type { StandardContractRow } from "@/lib/g2b/standard-contract-mapper";

export const CONTRACT_INFO_LIST_BASE_URL = "https://apis.data.go.kr/1230000/ao/CntrctInfoService";

const CONTRACT_INFO_OPERATIONS: Record<G2bContractBusinessCategory, string> = {
  goods: "getCntrctInfoListThng",
  services: "getCntrctInfoListServc",
  construction: "getCntrctInfoListCnstwk",
  foreign: "getCntrctInfoListFrgcpt",
};

export async function fetchContractInfoPage(
  chunk: StandardContractChunk,
  pageNo: number,
  numOfRows = 100,
  businessCategory: G2bContractBusinessCategory = "goods",
): Promise<StandardContractPage> {
  try {
    const response = await fetchG2bJson(CONTRACT_INFO_LIST_BASE_URL, CONTRACT_INFO_OPERATIONS[businessCategory], {
      inqryDiv: 1,
      inqryBgnDt: toProviderDateTime(chunk.dateFrom, "0000"),
      inqryEndDt: toProviderDateTime(chunk.dateTo, "2359"),
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
        "G2B contract information service request was rejected with status 403.",
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
      resultMsg ?? "G2B contract information service key is unauthorized.",
    );
  }

  if (isDateRangeTooLargeMessage(resultMsg)) {
    throw new G2bStandardContractError("date_range_too_large", resultMsg ?? "Date range is too large.");
  }

  throw new G2bStandardContractError(
    "provider_error",
    `G2B contract information provider error ${resultCode}: ${resultMsg ?? "Unknown provider error."}`,
  );
}

function malformedProviderResponse(reason: string): G2bStandardContractError {
  return new G2bStandardContractError(
    "provider_error",
    `Malformed G2B contract information service response: ${reason}.`,
  );
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

function toProviderDateTime(value: string, hhmm: string): string {
  return `${toProviderDate(value)}${hhmm}`;
}

function parseCount(value: unknown): number {
  const text = asString(value);

  if (text === null || !/^\d+$/.test(text)) {
    throw new G2bStandardContractError("provider_error", "Malformed G2B contract information response: invalid totalCount.");
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
  return message !== null && /service\s*key|unauthorized|forbidden|인증|서비스키/i.test(message);
}

function isDateRangeTooLargeMessage(message: string | null): boolean {
  return message !== null && (/date\s*range|too\s*large|too\s*long|exceed|over|조회기간|초과/i.test(message));
}
