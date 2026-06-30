import { formatBusinessNumber, parseBusinessNumber } from "@/lib/domain/business-number";
import { parseAmountToWon } from "@/lib/domain/money";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";
import type { ParsedContractCsvRow } from "@/lib/import/csv";

export type ShoppingMallDeliveryRow = Record<string, unknown>;

type MappingResult = { success: true; row: ParsedContractCsvRow } | { success: false; reason: string };

export const SHOPPING_THIRD_PARTY_SOURCE_DATASET = "g2b-shopping-mall-third-party-delivery";
export const SHOPPING_THIRD_PARTY_CATEGORY = "shopping_third_party";

export function mapShoppingMallThirdPartyDeliveryRow(
  row: ShoppingMallDeliveryRow,
  normalizedBizNo: string,
): MappingResult {
  let bizNoNormalized: string;

  try {
    bizNoNormalized = parseBusinessNumber(normalizedBizNo);
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : "Invalid biz_no." };
  }

  const providerBizNo = normalizeDigits(row.cntrctCorpBizno);
  if (providerBizNo !== bizNoNormalized) {
    return { success: false, reason: "biz_no does not match shopping mall delivery row." };
  }

  const contractMethod = pickString(row, ["cntrctCnclsStleNm"]);
  if (contractMethod === null || !contractMethod.includes("제3자단가")) {
    return { success: false, reason: "shopping mall delivery row is not third-party unit-price." };
  }

  const businessName = pickString(row, ["corpNm"]);
  const contractDate = normalizeProviderDate(pickString(row, ["dlvrReqRcptDate", "IntlCntrctDlvrReqDate"]));
  const contractName = pickString(row, ["prdctIdntNoNm", "dtilPrdctClsfcNoNm", "prdctClsfcNoNm", "dlvrReqNm"]);
  const deliveryRequestNo = pickString(row, ["dlvrReqNo"]);
  const productSequence = pickString(row, ["prdctSno"]);
  const missingFields: string[] = [];

  if (businessName === null) missingFields.push("business_name");
  if (contractDate === null) missingFields.push("contract_date");
  if (contractName === null) missingFields.push("contract_name");
  if (deliveryRequestNo === null) missingFields.push("delivery_request_no");

  if (missingFields.length > 0) {
    return { success: false, reason: `Missing required mapped fields: ${missingFields.join(", ")}.` };
  }

  const deliveryChangeOrder = pickString(row, ["dlvrReqChgOrd"]);
  const amount = parseDeliveryAmount(row);

  return {
    success: true,
    row: {
      sourceDataset: SHOPPING_THIRD_PARTY_SOURCE_DATASET,
      sourceRowHash: createSourceRowHash(hashableRow(row, bizNoNormalized)),
      bizNoNormalized,
      bizNoDisplay: formatBusinessNumber(bizNoNormalized),
      businessName: businessName!,
      representativeName: null,
      address: pickString(row, ["dminsttRgnNm"]),
      businessCategory: SHOPPING_THIRD_PARTY_CATEGORY,
      noticeNo: null,
      noticeOrder: null,
      noticeName: pickString(row, ["dlvrReqNm"]),
      contractNo: deliveryRequestNo,
      unifiedContractNo: buildUnifiedDeliveryNo(deliveryRequestNo!, deliveryChangeOrder, productSequence),
      contractName: contractName!,
      contractDate: contractDate!,
      currentContractAmount: amount,
      totalContractAmount: amount,
      demandAgencyCode: pickString(row, ["dminsttCd"]),
      demandAgencyName: pickString(row, ["dminsttNm"]),
      contractAgencyCode: null,
      contractAgencyName: pickString(row, ["brnofceNm"]),
      contractMethod,
      winningMethod: null,
      businessNameAtContract: businessName!,
      contractDetailUrl: null,
      noticeDetailUrl: null,
      rawSourceUrl: null,
    },
  };
}

function pickString(row: ShoppingMallDeliveryRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = asNonBlankString(row[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function asNonBlankString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeDigits(value: unknown): string {
  return asNonBlankString(value)?.replace(/\D/g, "") ?? "";
}

function normalizeProviderDate(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const compact = value.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  const separated = value.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  const match = compact ?? separated;

  if (match === null) {
    return null;
  }

  const [, year, month, day] = match;
  const normalized = `${year}-${month}-${day}`;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return parsed.toISOString().slice(0, 10) === normalized ? normalized : null;
}

function parseDeliveryAmount(row: ShoppingMallDeliveryRow): number | null {
  const directAmount = parseProviderAmount(pickString(row, ["prdctAmt", "dlvrReqAmt"]));
  if (directAmount !== null && directAmount !== 0) {
    return directAmount;
  }

  const changedAmount = parseProviderAmount(pickString(row, ["incdecAmt"]));
  return changedAmount ?? directAmount;
}

function parseProviderAmount(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim().replace(/,/g, "");
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? parseAmountToWon(normalized) : null;
}

function buildUnifiedDeliveryNo(deliveryRequestNo: string, deliveryChangeOrder: string | null, productSequence: string | null): string {
  return [deliveryRequestNo, deliveryChangeOrder, productSequence].filter((value) => value !== null).join("-");
}

function hashableRow(row: ShoppingMallDeliveryRow, normalizedBizNo: string): Record<string, string | number | null> {
  const hashable: Record<string, string | number | null> = {
    __normalizedBizNo: normalizedBizNo,
  };

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "number") {
      hashable[key] = value ?? null;
    } else {
      hashable[key] = JSON.stringify(value);
    }
  }

  return hashable;
}
