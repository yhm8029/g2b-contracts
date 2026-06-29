import { formatBusinessNumber, parseBusinessNumber } from "@/lib/domain/business-number";
import { parseAmountToWon } from "@/lib/domain/money";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";
import type { ParsedContractCsvRow } from "@/lib/import/csv";

export type StandardContractRow = Record<string, unknown>;

type MappingResult = { success: true; row: ParsedContractCsvRow } | { success: false; reason: string };

type CorpListEntry = {
  businessName: string | null;
  representativeName: string | null;
  businessNumber: string | null;
};

type DemandAgencyEntry = {
  code: string | null;
  name: string | null;
};

export const PUBLIC_STANDARD_SOURCE_DATASET = "g2b-public-standard-contract";
export const CONTRACT_INFO_SOURCE_DATASET = "g2b-contract-info-service";

const businessNumberFields = [
  "bizno",
  "bizrno",
  "cntrctCorpBizno",
  "cntrctEntrpsBizno",
  "bidwinnrBizrno",
  "corpBizno",
  "rprsntCorpBizrno",
];

const businessNameFields = ["cntrctCorpNm", "cntrctEntrpsNm", "bidwinnrNm", "corpNm", "rprsntCorpNm"];
const contractDateFields = ["cntrctCnclsDate", "cntrctDate", "cntrctDt"];
const contractNameFields = ["cntrctNm", "prodNm", "prdlstNm"];
const contractNoFields = ["dcsnCntrctNo", "cntrctNo", "cntrctRefNo"];
const currentAmountFields = ["thtmCntrctAmt", "cntrctAmt", "cntrctPrce"];
const totalAmountFields = ["totCntrctAmt", "ttalCntrctAmt", "cntrctAmt", "cntrctPrce"];
const contractDetailUrlFields = [
  "cntrctDtlInfoUrl",
  "cntrctInfoUrl",
  "cntrctDetailUrl",
  "contractDetailUrl",
  "dtlInfoUrl",
  "detailUrl",
];
const noticeDetailUrlFields = ["bidNtceDtlUrl", "bidNtceDetailUrl", "bidNtceUrl", "noticeDetailUrl"];

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

  return matchedCorpListEntry(row, normalizedInput) !== null;
}

export function mapStandardContractRow(
  row: StandardContractRow,
  normalizedBizNo: string,
  sourceDataset = PUBLIC_STANDARD_SOURCE_DATASET,
): MappingResult {
  let bizNoNormalized: string;

  try {
    bizNoNormalized = parseBusinessNumber(normalizedBizNo);
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : "Invalid biz_no." };
  }

  const corpEntry = matchedCorpListEntry(row, bizNoNormalized);

  if (!rowMatchesBusinessNumber(row, bizNoNormalized)) {
    return { success: false, reason: "biz_no does not match provider row." };
  }

  const demandAgency = firstDemandAgencyEntry(row);
  const businessName = pickString(row, businessNameFields, ["\uC5C5\uCCB4\uBA85"]) ?? corpEntry?.businessName ?? null;
  const representativeName =
    pickString(row, ["rprsntCorpCeoNm"], ["\uB300\uD45C\uC790\uBA85"]) ?? corpEntry?.representativeName ?? null;
  const contractDate = normalizeProviderDate(
    pickString(row, contractDateFields, ["\uACC4\uC57D\uCCB4\uACB0\uC77C\uC790", "\uACC4\uC57D\uC77C\uC790"]),
  );
  const contractName = pickString(row, contractNameFields, ["\uACC4\uC57D\uBA85", "\uD488\uBA85"]);

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
  const contractDetailUrl = pickString(row, contractDetailUrlFields, ["\uC0C1\uC138"]);
  const noticeDetailUrl = pickString(row, noticeDetailUrlFields, ["\uACF5\uACE0", "\uC0C1\uC138"]);
  const totalAmount = parseProviderAmount(
    pickString(row, totalAmountFields, ["\uCD1D\uACC4\uC57D\uAE08\uC561", "\uACC4\uC57D\uAE08\uC561", "\uAE08\uC561"]),
  );
  const currentAmount = parseProviderAmount(pickString(row, currentAmountFields, ["\uAE08\uC561"]));

  return {
    success: true,
    row: {
      sourceDataset,
      sourceRowHash: createSourceRowHash(hashableRow(row, bizNoNormalized)),
      bizNoNormalized,
      bizNoDisplay: formatBusinessNumber(bizNoNormalized),
      businessName: mappedBusinessName,
      representativeName,
      address: pickString(row, ["addr", "adres", "corpAddr", "rprsntCorpAdrs"], ["\uC8FC\uC18C"]),
      businessCategory: normalizeBusinessCategory(pickString(row, ["bsnsDivNm", "businessCategory"])),
      noticeNo: pickString(row, ["ntceNo", "bidNtceNo"]),
      noticeOrder: pickString(row, ["bidNtceOrd"]),
      noticeName: pickString(row, ["bidNtceNm"]),
      contractNo: pickString(row, contractNoFields),
      unifiedContractNo: pickString(row, ["untyCntrctNo"]),
      contractName: mappedContractName,
      contractDate: mappedContractDate,
      currentContractAmount: currentAmount,
      totalContractAmount: totalAmount,
      demandAgencyCode: pickString(row, ["dminsttCd", "dmndInsttCd"]) ?? demandAgency?.code ?? null,
      demandAgencyName: pickString(row, ["dminsttNm", "dmndInsttNm"]) ?? demandAgency?.name ?? null,
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
  return businessNumberFields.includes(key) || key.includes("\uC0AC\uC5C5\uC790\uB4F1\uB85D\uBC88\uD638");
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

function matchedCorpListEntry(row: StandardContractRow, normalizedBizNo: string): CorpListEntry | null {
  return parseCorpList(row.corpList).find((entry) => entry.businessNumber === normalizedBizNo) ?? null;
}

function parseCorpList(value: unknown): CorpListEntry[] {
  const text = asNonBlankString(value);
  if (text === null) {
    return [];
  }

  const bracketedEntries = [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  const entries = bracketedEntries.length > 0 ? bracketedEntries : [text];

  return entries
    .map((entry) => entry.split("^").map((part) => part.trim()))
    .map((parts) => ({
      businessName: asNonBlankString(parts[3]),
      representativeName: asNonBlankString(parts[4]),
      businessNumber: normalizeCorpListBusinessNumber(parts),
    }))
    .filter((entry) => entry.businessNumber !== null);
}

function normalizeCorpListBusinessNumber(parts: string[]): string | null {
  for (const part of parts.slice().reverse()) {
    const digits = part.replace(/\D/g, "");
    if (/^\d{10}$/.test(digits)) {
      return digits;
    }
  }

  return null;
}

function firstDemandAgencyEntry(row: StandardContractRow): DemandAgencyEntry | null {
  const text = asNonBlankString(row.dminsttList);
  if (text === null) {
    return null;
  }

  const match = text.match(/\[([^\]]+)\]/);
  const parts = (match?.[1] ?? text).split("^").map((part) => part.trim());

  return {
    code: asNonBlankString(parts[1]),
    name: asNonBlankString(parts[2]),
  };
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

  const trimmed = value.trim();
  const amountMatch = trimmed.match(/^(\d+|\d{1,3}(?:,\d{3})+)\s*(?:\uC6D0)?$/u);

  if (amountMatch === null) {
    return null;
  }

  return parseAmountToWon(amountMatch[1]);
}

function normalizeBusinessCategory(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const categoryMap: Record<string, string> = {
    goods: "goods",
    "\uBB3C\uD488": "goods",
    construction: "construction",
    "\uACF5\uC0AC": "construction",
    services: "services",
    service: "services",
    "\uC6A9\uC5ED": "services",
    foreign: "foreign",
    "\uC678\uC790": "foreign",
  };

  return categoryMap[normalized] ?? "unknown";
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
