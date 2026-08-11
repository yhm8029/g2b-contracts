import { fetchG2bJson, redactG2bSecrets } from "@/lib/g2b/http";
import {
  G2bStandardContractError,
  type G2bStandardContractErrorCode,
} from "@/lib/g2b/standard-contract-client";

export const SHOPPING_MALL_PRODUCT_SERVICE_BASE_URL =
  "https://apis.data.go.kr/1230000/ao/ShoppingMallPrdctInfoService";
export const GET_THIRD_PARTY_PRODUCT_OPERATION =
  "getThptyUcntrctPrdctInfoList";

const PAGE_SIZE = 100;

/**
 * One row of `getThptyUcntrctPrdctInfoList`.
 *
 * The provider exposes both the head office (`hdoffceLocplc`) and the
 * factory location (`fctryLocplc`) on a single row; the client must
 * preserve them as **independent** nullable fields. Substituting one for
 * the other would corrupt the building-control "생산지" column and is
 * explicitly forbidden by the design.
 *
 * `prdctClsfcNo` and `dtilPrdctClsfcNo` keep the digits-only official
 * classification codes so downstream filtering on the fixed
 * `39121801` prefix can run without re-parsing the human-readable
 * `prdctNm` text.
 */
export type ShoppingMallProductInfo = {
  /** Official 8-digit product classification number. */
  prdctClsfcNo: string | null;
  /** Official 10-digit detailed product classification number. */
  dtilPrdctClsfcNo: string | null;
  /** Human-readable product / classification name. */
  prdctNm: string | null;
  /** Product identification name (e.g. model + spec text). */
  prdctIdntNoNm: string | null;
  /** Official product specification name (canonical source prdctSpecNm). */
  prdctSpec: string | null;
  /** Company name used by the third-party contract. */
  cntrctCorpNm: string | null;
  /** Head office location (`hdoffceLocplc`). Never substituted by the factory location. */
  headOfficeLocation: string | null;
  /** Factory location (`fctryLocplc`). Never substituted by the head office. */
  factoryLocation: string | null;
};

type RawShoppingMallProduct = {
  prdctClsfcNo?: unknown;
  dtilPrdctClsfcNo?: unknown;
  prdctNm?: unknown;
  prdctIdntNoNm?: unknown;
  /** Official product specification name (canonical). */
  prdctSpecNm?: unknown;
  /** Legacy alias for prdctSpecNm. */
  prdctSpec?: unknown;
  cntrctCorpNm?: unknown;
  hdoffceLocplc?: unknown;
  fctryLocplc?: unknown;
};

/**
 * Fetch every product row from
 * `getThptyUcntrctPrdctInfoList` for the given company name.
 *
 * Calls the official third-party shopping-mall product endpoint with
 * `inqryDiv=1` and `cntrctCorpNm=<name>` and paginates with
 * `numOfRows=100` until `totalCount` is exhausted.
 */
export async function fetchThirdPartyProducts(
  companyName: string,
): Promise<ShoppingMallProductInfo[]> {
  const normalizedCompanyName = companyName.trim();
  if (normalizedCompanyName.length === 0) {
    throw new G2bStandardContractError(
      "provider_error",
      "Company name is required for shopping-mall product lookup.",
    );
  }

  const items = await fetchAllPages({
    inqryDiv: 1,
    cntrctCorpNm: normalizedCompanyName,
  });

  return items.map(parseProductItem);
}

async function fetchAllPages(
  baseParams: Record<string, string | number>,
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  let pageNo = 1;
  let totalCount: number | null = null;

  while (totalCount === null || allItems.length < totalCount) {
    let response: unknown;
    try {
      response = await fetchG2bJson(
        SHOPPING_MALL_PRODUCT_SERVICE_BASE_URL,
        GET_THIRD_PARTY_PRODUCT_OPERATION,
        {
          ...baseParams,
          pageNo,
          numOfRows: PAGE_SIZE,
        },
      );
    } catch (error) {
      throw mapFetchError(error);
    }

    const body = parseShoppingMallResponseBody(response);
    if (totalCount === null) {
      totalCount = body.totalCount;
    }

    const pageItems = body.items;
    if (pageItems.length === 0) {
      if (allItems.length < totalCount) {
        throw new G2bStandardContractError(
          "provider_error",
          `G2B shopping-mall product ${GET_THIRD_PARTY_PRODUCT_OPERATION} page ${pageNo} returned no items while ${totalCount - allItems.length} more rows were still expected.`,
        );
      }
      break;
    }

    allItems.push(...pageItems);
    pageNo += 1;
  }

  return allItems;
}

type ShoppingMallResponseBody = {
  items: Record<string, unknown>[];
  totalCount: number;
};

function parseShoppingMallResponseBody(response: unknown): ShoppingMallResponseBody {
  const errorEnvelope = isRecord(response)
    ? response["nkoneps.com.response.ResponseError"]
    : undefined;
  if (isRecord(errorEnvelope)) {
    const header = isRecord(errorEnvelope.header) ? errorEnvelope.header : {};
    const resultCode = asString(header.resultCode) ?? "unknown";
    const resultMsg = asString(header.resultMsg) ?? "Unknown provider error.";
    throw new G2bStandardContractError(
      classifyErrorCode(resultMsg),
      `G2B shopping-mall product provider error ${resultCode}: ${redactG2bSecrets(resultMsg)}`,
    );
  }

  if (!isRecord(response) || !isRecord(response.response)) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B shopping-mall product ${GET_THIRD_PARTY_PRODUCT_OPERATION} response: missing response envelope.`,
    );
  }

  const envelope = response.response;
  if (!isRecord(envelope.header)) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B shopping-mall product ${GET_THIRD_PARTY_PRODUCT_OPERATION} response: missing response header.`,
    );
  }

  const resultCode = asString(envelope.header.resultCode);
  const resultMsg = asString(envelope.header.resultMsg);

  if (resultCode === null) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B shopping-mall product ${GET_THIRD_PARTY_PRODUCT_OPERATION} response: missing resultCode.`,
    );
  }

  if (resultCode !== "00") {
    throw new G2bStandardContractError(
      classifyErrorCode(resultMsg),
      `G2B shopping-mall product provider error ${resultCode}: ${redactG2bSecrets(resultMsg ?? "Unknown provider error.")}`,
    );
  }

  if (!isRecord(envelope.body)) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B shopping-mall product ${GET_THIRD_PARTY_PRODUCT_OPERATION} response: missing response body.`,
    );
  }

  return {
    items: normalizeItems(envelope.body.items ?? envelope.body.item),
    totalCount: parseTotalCount(envelope.body.totalCount),
  };
}

function parseProductItem(raw: Record<string, unknown>): ShoppingMallProductInfo {
  const typed = raw as RawShoppingMallProduct;
  return {
    prdctClsfcNo: asString(typed.prdctClsfcNo),
    dtilPrdctClsfcNo: asString(typed.dtilPrdctClsfcNo),
    prdctNm: asString(typed.prdctNm),
    prdctIdntNoNm: asString(typed.prdctIdntNoNm),
    prdctSpec: asString(typed.prdctSpecNm) ?? asString(typed.prdctSpec),
    cntrctCorpNm: asString(typed.cntrctCorpNm),
    // The head office and the factory location are intentionally parsed
    // independently: never let one fall back to the other. A row that
    // only ships a head office produces a null `factoryLocation`, and a
    // row that only ships a factory produces a null `headOfficeLocation`.
    headOfficeLocation: asString(typed.hdoffceLocplc),
    factoryLocation: asString(typed.fctryLocplc),
  };
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

function parseTotalCount(value: unknown): number {
  const text = asString(value);

  if (text === null || !/^\d+$/.test(text)) {
    throw new G2bStandardContractError(
      "provider_error",
      `Malformed G2B shopping-mall product ${GET_THIRD_PARTY_PRODUCT_OPERATION} response: invalid totalCount.`,
    );
  }

  return Number(text);
}

function mapFetchError(error: unknown): G2bStandardContractError {
  if (error instanceof G2bStandardContractError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("403")) {
    return new G2bStandardContractError(
      "unauthorized_service_key",
      `G2B shopping-mall product ${GET_THIRD_PARTY_PRODUCT_OPERATION} service request was rejected with status 403.`,
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