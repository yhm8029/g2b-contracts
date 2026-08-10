import { parseBusinessNumber } from "@/lib/domain/business-number";
import { fetchG2bJson, redactG2bSecrets } from "@/lib/g2b/http";
import {
  G2bStandardContractError,
  type G2bStandardContractErrorCode,
} from "@/lib/g2b/standard-contract-client";

export const USER_INFO_SERVICE_BASE_URL =
  "https://apis.data.go.kr/1230000/ao/UsrInfoService02";
export const GET_BASIC_INFO_OPERATION = "getPrcrmntCorpBasicInfo02";
export const GET_INDUSTRY_INFO_OPERATION = "getPrcrmntCorpIndstrytyInfo02";

const PAGE_SIZE = 100;

/**
 * Company basic info returned by `getPrcrmntCorpBasicInfo02`.
 *
 * The `address` field is composed from the official `adrs` and `dtlAdrs`
 * fields; they are joined with a single space and the detail segment is
 * dropped when it is empty or duplicates the base address so the value
 * shown to users never contains the same street address twice.
 */
export type CompanyBasicInfo = {
  corpNm: string | null;
  ceoNm: string | null;
  telNo: string | null;
  address: string | null;
};

/**
 * One row of `getPrcrmntCorpIndstrytyInfo02`. Every field is nullable
 * because the official provider does not guarantee all columns for every
 * business and the client must surface the absence as `null` instead of
 * substituting another value.
 */
export type CompanyIndustryInfo = {
  indstrytyCd: string | null;
  indstrytyNm: string | null;
  status: string | null;
};

type RawCompanyBasicInfo = {
  corpNm?: unknown;
  ceoNm?: unknown;
  telNo?: unknown;
  adrs?: unknown;
  dtlAdrs?: unknown;
};

type RawCompanyIndustryInfo = {
  indstrytyCd?: unknown;
  indstrytyNm?: unknown;
  /** Official industry status name (canonical). */
  indstrytyStatsNm?: unknown;
  /** Legacy alias for indstrytyStatsNm. */
  status?: unknown;
};

/**
 * Fetch the official company basic-info record for a business number.
 *
 * Calls `getPrcrmntCorpBasicInfo02` with `inqryDiv=1` and the normalized
 * 10-digit business number, paginates with `numOfRows=100` until the
 * official `totalCount` is exhausted, then returns the first parsed
 * item (or `null` when the provider returned no items).
 */
export async function fetchCompanyBasicInfo(
  bizNo: string,
): Promise<CompanyBasicInfo | null> {
  const normalizedBizNo = parseBusinessNumber(bizNo);
  const items = await fetchAllPages(
    GET_BASIC_INFO_OPERATION,
    {
      inqryDiv: 1,
      bizno: normalizedBizNo,
    },
    "getPrcrmntCorpBasicInfo02",
  );
  const first = items[0];
  return first === undefined ? null : parseBasicInfoItem(first);
}

/**
 * Fetch every industry entry for a business number from
 * `getPrcrmntCorpIndstrytyInfo02`. The provider is paginated with
 * `numOfRows=100` so a single business can have many industry rows
 * (one per `indstrytyCd`).
 */
export async function fetchCompanyIndustries(
  bizNo: string,
): Promise<CompanyIndustryInfo[]> {
  const normalizedBizNo = parseBusinessNumber(bizNo);
  const items = await fetchAllPages(
    GET_INDUSTRY_INFO_OPERATION,
    {
      inqryDiv: 1,
      bizno: normalizedBizNo,
    },
    "getPrcrmntCorpIndstrytyInfo02",
  );

  return items.map(parseIndustryItem);
}

async function fetchAllPages(
  operation: string,
  baseParams: Record<string, string | number>,
  operationLabel: string,
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  let pageNo = 1;
  let totalCount: number | null = null;

  while (totalCount === null || allItems.length < totalCount) {
    let response: unknown;
    try {
      response = await fetchG2bJson(USER_INFO_SERVICE_BASE_URL, operation, {
        ...baseParams,
        pageNo,
        numOfRows: PAGE_SIZE,
      });
    } catch (error) {
      throw mapFetchError(error, operationLabel);
    }

    const body = parseUserInfoResponseBody(response, operationLabel);
    if (totalCount === null) {
      totalCount = body.totalCount;
    }

    const pageItems = body.items;
    if (pageItems.length === 0) {
      if (allItems.length < totalCount) {
        throw new G2bStandardContractError(
          "provider_error",
          `G2B user-info ${operationLabel} page ${pageNo} returned no items while ${totalCount - allItems.length} more rows were still expected.`,
        );
      }
      break;
    }

    allItems.push(...pageItems);
    pageNo += 1;
  }

  return allItems;
}

type UserInfoResponseBody = {
  items: Record<string, unknown>[];
  totalCount: number;
};

function parseUserInfoResponseBody(
  response: unknown,
  operationLabel: string,
): UserInfoResponseBody {
  const errorEnvelope = isRecord(response)
    ? response["nkoneps.com.response.ResponseError"]
    : undefined;
  if (isRecord(errorEnvelope)) {
    const header = isRecord(errorEnvelope.header) ? errorEnvelope.header : {};
    const resultCode = asString(header.resultCode) ?? "unknown";
    const resultMsg = asString(header.resultMsg) ?? "Unknown provider error.";
    throw new G2bStandardContractError(
      classifyErrorCode(resultMsg),
      `G2B user-info provider error ${resultCode}: ${redactG2bSecrets(resultMsg)}`,
    );
  }

  if (!isRecord(response) || !isRecord(response.response)) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B user-info ${operationLabel} response: missing response envelope.`,
    );
  }

  const envelope = response.response;
  if (!isRecord(envelope.header)) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B user-info ${operationLabel} response: missing response header.`,
    );
  }

  const resultCode = asString(envelope.header.resultCode);
  const resultMsg = asString(envelope.header.resultMsg);

  if (resultCode === null) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B user-info ${operationLabel} response: missing resultCode.`,
    );
  }

  if (resultCode !== "00") {
    throw new G2bStandardContractError(
      classifyErrorCode(resultMsg),
      `G2B user-info provider error ${resultCode}: ${redactG2bSecrets(resultMsg ?? "Unknown provider error.")}`,
    );
  }

  if (!isRecord(envelope.body)) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B user-info ${operationLabel} response: missing response body.`,
    );
  }

  return {
    items: normalizeItems(envelope.body.items ?? envelope.body.item),
    totalCount: parseTotalCount(envelope.body.totalCount, operationLabel),
  };
}

function parseBasicInfoItem(raw: Record<string, unknown>): CompanyBasicInfo {
  const typed = raw as RawCompanyBasicInfo;
  return {
    corpNm: asString(typed.corpNm),
    ceoNm: asString(typed.ceoNm),
    telNo: asString(typed.telNo),
    address: combineAddress(asString(typed.adrs), asString(typed.dtlAdrs)),
  };
}

function parseIndustryItem(raw: Record<string, unknown>): CompanyIndustryInfo {
  const typed = raw as RawCompanyIndustryInfo;
  return {
    indstrytyCd: asString(typed.indstrytyCd),
    indstrytyNm: asString(typed.indstrytyNm),
    status: asString(typed.indstrytyStatsNm) ?? asString(typed.status),
  };
}

/**
 * Combine the official `adrs` (base address) and `dtlAdrs` (detail
 * address) into a single human-readable string. The detail segment is
 * dropped when empty or when it would repeat the base address verbatim;
 * this matches how operations staff read the company record and keeps
 * the address column free of accidental duplication.
 */
function combineAddress(base: string | null, detail: string | null): string | null {
  if (base === null) {
    return detail;
  }
  if (detail === null) {
    return base;
  }
  if (detail.length === 0) {
    return base;
  }
  if (base === detail) {
    return base;
  }
  if (base.endsWith(detail)) {
    return base;
  }
  if (detail.startsWith(base)) {
    return detail;
  }
  return `${base} ${detail}`;
}

function mapFetchError(error: unknown, operationLabel: string): G2bStandardContractError {
  if (error instanceof G2bStandardContractError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("403")) {
    return new G2bStandardContractError(
      "unauthorized_service_key",
      `G2B user-info ${operationLabel} service request was rejected with status 403.`,
    );
  }
  return new G2bStandardContractError("provider_error", redactG2bSecrets(message));
}

function classifyErrorCode(resultMsg: string | null): G2bStandardContractErrorCode {
  if (
    resultMsg !== null &&
    /service\s*key|unauthorized|forbidden|인증|서비스키/i.test(resultMsg)
  ) {
    return "unauthorized_service_key";
  }
  return "provider_error";
}

function normalizeItems(value: unknown): Record<string, unknown>[] {
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

function parseTotalCount(value: unknown, operationLabel: string): number {
  const text = asString(value);

  if (text === null || !/^\d+$/.test(text)) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B user-info ${operationLabel} response: invalid totalCount.`,
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