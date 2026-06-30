import { formatBusinessNumber, parseBusinessNumber } from "@/lib/domain/business-number";
import { parseAmountToWon } from "@/lib/domain/money";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";
import type { ParsedContractCsvRow } from "@/lib/import/csv";

export type ShoppingMallProductRow = Record<string, unknown>;

type MappingResult = { success: true; row: ParsedContractCsvRow } | { success: false; reason: string };

export const SHOPPING_THIRD_PARTY_SOURCE_DATASET = "g2b-shopping-mall-third-party-unit";
export const SHOPPING_THIRD_PARTY_CATEGORY = "shopping_third_party";

export function mapShoppingMallThirdPartyProductRow(
  row: ShoppingMallProductRow,
  normalizedBizNo: string,
): MappingResult {
  let bizNoNormalized: string;

  try {
    bizNoNormalized = parseBusinessNumber(normalizedBizNo);
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : "Invalid biz_no." };
  }

  const providerBizNo = normalizeDigits(row.cntrctCorpNo);
  if (providerBizNo !== bizNoNormalized) {
    return { success: false, reason: "biz_no does not match shopping mall row." };
  }

  const businessName = pickString(row, ["cntrctCorpNm"]);
  const contractDate = normalizeProviderDate(pickString(row, ["cntrctDate", "cntrctBgnDate", "rgstDt"]));
  const contractName = pickString(row, ["prdctSpecNm", "prdctClsfcNoNm", "prdctIdntNo"]);
  const missingFields: string[] = [];

  if (businessName === null) missingFields.push("business_name");
  if (contractDate === null) missingFields.push("contract_date");
  if (contractName === null) missingFields.push("contract_name");

  if (missingFields.length > 0) {
    return { success: false, reason: `Missing required mapped fields: ${missingFields.join(", ")}.` };
  }

  const contractNo = pickString(row, ["shopngCntrctNo"]);
  const contractOrder = pickString(row, ["shopngCntrctSno"]);
  const contractDetailUrl = pickString(row, ["prdctDtlInfo", "prdctImgUrl"]);
  const amount = parseProviderAmount(pickString(row, ["cntrctPrceAmt"]));

  return {
    success: true,
    row: {
      sourceDataset: SHOPPING_THIRD_PARTY_SOURCE_DATASET,
      sourceRowHash: createSourceRowHash(hashableRow(row, bizNoNormalized)),
      bizNoNormalized,
      bizNoDisplay: formatBusinessNumber(bizNoNormalized),
      businessName: businessName!,
      representativeName: null,
      address: pickString(row, ["hdoffceLocplc", "fctryLocplc"]),
      businessCategory: SHOPPING_THIRD_PARTY_CATEGORY,
      noticeNo: null,
      noticeOrder: null,
      noticeName: pickString(row, ["prdctClsfcNoNm"]),
      contractNo,
      unifiedContractNo: contractNo && contractOrder ? `${contractNo}-${contractOrder}` : contractNo,
      contractName: contractName!,
      contractDate: contractDate!,
      currentContractAmount: amount,
      totalContractAmount: amount,
      demandAgencyCode: null,
      demandAgencyName: null,
      contractAgencyCode: null,
      contractAgencyName: pickString(row, ["cntrctDeptNm"]),
      contractMethod: pickString(row, ["cntrctMthdNm"]),
      winningMethod: null,
      businessNameAtContract: businessName!,
      contractDetailUrl,
      noticeDetailUrl: null,
      rawSourceUrl: contractDetailUrl,
    },
  };
}

function pickString(row: ShoppingMallProductRow, keys: string[]): string | null {
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

function parseProviderAmount(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const amountMatch = value.trim().match(/^(\d+|\d{1,3}(?:,\d{3})+)$/);
  return amountMatch === null ? null : parseAmountToWon(amountMatch[1]);
}

function hashableRow(row: ShoppingMallProductRow, normalizedBizNo: string): Record<string, string | number | null> {
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
