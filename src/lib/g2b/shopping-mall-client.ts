import type { DateChunk } from "@/lib/g2b/date-chunks";
import { fetchG2bJson, redactG2bSecrets } from "@/lib/g2b/http";
import { G2bStandardContractError, type StandardContractPage } from "@/lib/g2b/standard-contract-client";
import type { ShoppingMallDeliveryRow } from "@/lib/g2b/shopping-mall-mapper";

export const SHOPPING_MALL_SERVICE_BASE_URL = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService";
export const GET_DELIVERY_REQUEST_INFO_OPERATION = "getDlvrReqInfoList";
export const GET_DELIVERY_REQUEST_DETAIL_OPERATION = "getDlvrReqDtlInfoList";

export async function fetchShoppingMallDeliveryRequestInfoPage(
  chunk: DateChunk,
  pageNo: number,
  numOfRows = 100,
): Promise<StandardContractPage> {
  return fetchShoppingMallPage(GET_DELIVERY_REQUEST_INFO_OPERATION, {
    inqryDiv: 1,
    inqryBgnDate: toProviderDate(chunk.dateFrom),
    inqryEndDate: toProviderDate(chunk.dateTo),
    pageNo,
    numOfRows,
  }, pageNo, numOfRows);
}

export async function fetchShoppingMallDeliveryRequestDetailPage(
  chunk: DateChunk,
  deliveryRequestNo: string,
  pageNo: number,
  numOfRows = 100,
): Promise<StandardContractPage> {
  return fetchShoppingMallPage(GET_DELIVERY_REQUEST_DETAIL_OPERATION, {
    inqryDiv: 2,
    inqryBgnDate: toProviderDate(chunk.dateFrom),
    inqryEndDate: toProviderDate(chunk.dateTo),
    dlvrReqNo: deliveryRequestNo,
    pageNo,
    numOfRows,
  }, pageNo, numOfRows);
}

async function fetchShoppingMallPage(
  operation: string,
  params: Record<string, string | number>,
  pageNo: number,
  numOfRows: number,
): Promise<StandardContractPage> {
  try {
    const response = await fetchG2bJson(SHOPPING_MALL_SERVICE_BASE_URL, operation, params);
    const body = successfulResponseBody(response);

    return {
      items: normalizeItems(body.items ?? body.item),
      totalCount: parseCount(body.totalCount),
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
        "G2B shopping mall delivery request service request was rejected with status 403.",
      );
    }

    throw new G2bStandardContractError("provider_error", redactG2bSecrets(message));
  }
}

function successfulResponseBody(response: unknown): Record<string, unknown> {
  if (isRecord(response) && isRecord(response["nkoneps.com.response.ResponseError"])) {
    const errorEnvelope = response["nkoneps.com.response.ResponseError"];
    const header = isRecord(errorEnvelope.header) ? errorEnvelope.header : {};
    const resultCode = asString(header.resultCode) ?? "unknown";
    const resultMsg = asString(header.resultMsg) ?? "Unknown provider error.";
    throw new G2bStandardContractError("provider_error", `G2B shopping mall delivery request provider error ${resultCode}: ${resultMsg}`);
  }

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

  if (resultCode !== "00") {
    throw new G2bStandardContractError(
      isUnauthorizedServiceKeyMessage(resultMsg) ? "unauthorized_service_key" : "provider_error",
      `G2B shopping mall delivery request provider error ${resultCode}: ${resultMsg ?? "Unknown provider error."}`,
    );
  }

  if (!isRecord(envelope.body)) {
    throw malformedProviderResponse("missing response body");
  }

  return envelope.body;
}

function malformedProviderResponse(reason: string): G2bStandardContractError {
  return new G2bStandardContractError(
    "provider_error",
    `Malformed G2B shopping mall delivery request response: ${reason}.`,
  );
}

function normalizeItems(value: unknown): ShoppingMallDeliveryRow[] {
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

function parseCount(value: unknown): number {
  const text = asString(value);

  if (text === null || !/^\d+$/.test(text)) {
    throw new G2bStandardContractError(
      "provider_error",
      "Malformed G2B shopping mall delivery request response: invalid totalCount.",
    );
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

function toProviderDate(value: string): string {
  return value.replaceAll("-", "");
}
