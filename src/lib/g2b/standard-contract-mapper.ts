import { formatBusinessNumber, parseBusinessNumber } from "@/lib/domain/business-number";
import { parseAmountToWon } from "@/lib/domain/money";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";
import type { ParsedContractCsvRow } from "@/lib/import/csv";

export type StandardContractRow = Record<string, unknown>;

type MappingResult = { success: true; row: ParsedContractCsvRow } | { success: false; reason: string };

const SOURCE_DATASET = "g2b-public-standard-contract";

const businessNumberFields = [
  "bizno",
  "bizrno",
  "cntrctCorpBizno",
  "cntrctEntrpsBizno",
  "bidwinnrBizrno",
  "corpBizno",
];

const businessNameFields = ["cntrctCorpNm", "cntrctEntrpsNm", "bidwinnrNm", "corpNm"];
const contractDateFields = ["cntrctCnclsDate", "cntrctDt"];
const contractNameFields = ["cntrctNm", "prodNm", "prdlstNm"];
const contractNoFields = ["cntrctNo", "dcsnCntrctNo", "cntrctRefNo"];
const currentAmountFields = ["cntrctAmt", "cntrctPrce"];
const totalAmountFields = ["totCntrctAmt", "cntrctAmt", "cntrctPrce"];
const contractDetailUrlFields = [
  "cntrctDtlInfoUrl",
  "cntrctDetailUrl",
  "contractDetailUrl",
  "dtlInfoUrl",
  "detailUrl",
];
const noticeDetailUrlFields = ["bidNtceDtlUrl", "bidNtceDetailUrl", "noticeDetailUrl"];

export function rowMatchesBusinessNumber(row: StandardContractRow, normalizedBizNo: string): boolean {
  const normalizedInput = parseBusinessNumber(normalizedBizNo);

  for (const [key, value] of Object.entries(row)) {
    if (!isBusinessNumberKey(key)) {
      continue;
    }

    if (normalizeDigits(value) === normalizedInput) {
      return true;
    }
  }

  return false;
}

export function mapStandardContractRow(row: StandardContractRow, normalizedBizNo: string): MappingResult {
  let bizNoNormalized: string;

  try {
    bizNoNormalized = parseBusinessNumber(normalizedBizNo);
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : "Invalid biz_no." };
  }

  if (!rowMatchesBusinessNumber(row, bizNoNormalized)) {
    return { success: false, reason: "biz_no does not match provider row." };
  }

  const businessName = pickString(row, businessNameFields, ["업체명"]);
  const representativeName = pickString(row, [], ["대표자명"]);
  const contractDate = normalizeProviderDate(pickString(row, contractDateFields, ["계약체결일자", "계약일자"]));
  const contractName = pickString(row, contractNameFields, ["계약명", "품명"]);

  const missingFields: string[] = [];
  if (businessName === null) missingFields.push("business_name");
  if (contractDate === null) missingFields.push("contract_date");
  if (contractName === null) missingFields.push("contract_name");

  if (missingFields.length > 0) {
    return { success: false, reason: `Missing required mapped fields: ${missingFields.join(", ")}.` };
  }

  const mappedBusinessName = businessName!;
  const mappedContractDate = contractDate!;
  const mappedContractName = contractName!;
  const contractDetailUrl = pickString(row, contractDetailUrlFields, ["상세"]);
  const noticeDetailUrl = pickString(row, noticeDetailUrlFields, ["공고", "상세"]);

  return {
    success: true,
    row: {
      sourceDataset: SOURCE_DATASET,
      sourceRowHash: createSourceRowHash(hashableRow(row, bizNoNormalized)),
      bizNoNormalized,
      bizNoDisplay: formatBusinessNumber(bizNoNormalized),
      businessName: mappedBusinessName,
      representativeName,
      address: pickString(row, ["addr", "adres", "corpAddr"], ["주소"]),
      businessCategory: pickString(row, ["indstrytyNm", "bizcndNm"], ["업종"]),
      noticeNo: pickString(row, ["bidNtceNo"]),
      noticeOrder: pickString(row, ["bidNtceOrd"]),
      noticeName: pickString(row, ["bidNtceNm"]),
      contractNo: pickString(row, contractNoFields),
      unifiedContractNo: pickString(row, ["untyCntrctNo"]),
      contractName: mappedContractName,
      contractDate: mappedContractDate,
      currentContractAmount: parseProviderAmount(pickString(row, currentAmountFields, ["금액"])),
      totalContractAmount: parseProviderAmount(pickString(row, totalAmountFields, ["총계약금액", "계약금액", "금액"])),
      demandAgencyCode: pickString(row, ["dminsttCd"]),
      demandAgencyName: pickString(row, ["dminsttNm"]),
      contractAgencyCode: pickString(row, ["cntrctInsttCd"]),
      contractAgencyName: pickString(row, ["cntrctInsttNm"]),
      contractMethod: pickString(row, ["cntrctMthdNm", "cntrctCnclsMthdNm"]),
      winningMethod: pickString(row, ["bidwinrDcsnMthdNm"]),
      businessNameAtContract: mappedBusinessName,
      contractDetailUrl,
      noticeDetailUrl,
      rawSourceUrl: contractDetailUrl ?? noticeDetailUrl,
    },
  };
}

function isBusinessNumberKey(key: string): boolean {
  return businessNumberFields.includes(key) || key.includes("사업자등록번호");
}

function pickString(row: StandardContractRow, exactKeys: string[], keyIncludes: string[] = []): string | null {
  for (const key of exactKeys) {
    const value = asNonBlankString(row[key]);
    if (value !== null) {
      return value;
    }
  }

  for (const [key, value] of Object.entries(row)) {
    if (keyIncludes.some((fragment) => key.includes(fragment))) {
      const stringValue = asNonBlankString(value);
      if (stringValue !== null) {
        return stringValue;
      }
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

  const numericText = value.replace(/[^\d.-]/g, "");
  return parseAmountToWon(numericText);
}

function hashableRow(row: StandardContractRow, normalizedBizNo: string): Record<string, string | number | null> {
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
