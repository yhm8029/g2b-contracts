import { createHash } from "node:crypto";

export const G2B_PUBLIC_STANDARD_CONTRACT_DATASET = "g2b-public-standard-contract" as const;
const CONTRACT_IDENTITY_VERSION = "v1";
const OBSERVATION_HASH_VERSION = "v1";

const DIRECT_BUSINESS_NUMBER_FIELDS = [
  "bizno",
  "bizrno",
  "cntrctCorpBizno",
  "cntrctEntrpsBizno",
  "bidwinnrBizrno",
  "corpBizno",
  "rprsntCorpBizrno",
] as const;

const DIRECT_BUSINESS_NAME_FIELDS = [
  "cntrctCorpNm",
  "cntrctEntrpsNm",
  "bidwinnrNm",
  "corpNm",
  "rprsntCorpNm",
] as const;

export type G2bPublicStandardContractSupplier = {
  raw: Record<string, unknown>;
  businessName: string;
  businessNumber: string;
};

export type G2bPublicStandardContractProjection = {
  sourceDataset: typeof G2B_PUBLIC_STANDARD_CONTRACT_DATASET;
  rawRow: Record<string, unknown>;
  contractKey: string;
  contractKeyKind: "contract-no" | "notice-detail" | "fallback";
  contractIdentityVersion: typeof CONTRACT_IDENTITY_VERSION;
  observationHash: string;
  observationHashVersion: typeof OBSERVATION_HASH_VERSION;
  suppliers: G2bPublicStandardContractSupplier[];
  contractName: string;
  itemNames?: string[];
  itemCodes?: string[];
  contractDate: string | null;
  originalContractDate?: string;
  amendmentOrder?: number;
  currentContractAmount: number;
  totalContractAmount: number;
  demandAgencyName: string;
  demandAgencyCode: string;
  contractAgencyName: string;
  contractAgencyCode: string;
  contractMethod: string;
  contractType?: string;
  contractNo: string;
  noticeNo: string;
  contractDetailUrl: string;
  noticeDetailUrl: string;
};

export function mapG2bPublicStandardContractRow(
  row: Record<string, unknown>,
): G2bPublicStandardContractProjection {
  const itemNames = itemNamesForG2bPublicStandardContractRow(row);
  const itemCodes = itemCodesForG2bPublicStandardContractRow(row);
  const totalContractAmount = parseAmount(firstText(row, ["totCntrctAmt", "ttalCntrctAmt", "cntrctAmt", "cntrctPrce"]));
  const currentContractAmount =
    parseAmount(firstText(row, ["thtmCntrctAmt", "currCntrctAmt", "cntrctAmt", "cntrctPrce"])) || totalContractAmount;
  const originalContractDate = normalizeDate(
    firstText(row, ["frstCntrctDate", "firstContractDate", "orgnlCntrctDate", "originalContractDate"]),
  );
  const amendmentOrder = parseNonnegativeInteger(
    firstText(row, ["cntrctOrd", "contractOrder", "cntrctChgOrd", "contractChangeOrder"]),
  );
  const contractKey = contractKeyPartsForG2bPublicStandardContractRow(row);

  return {
    sourceDataset: G2B_PUBLIC_STANDARD_CONTRACT_DATASET,
    rawRow: row,
    contractKey: keyFromParts("contract", contractKey.kind, contractKey.parts),
    contractKeyKind: contractKey.kind,
    contractIdentityVersion: CONTRACT_IDENTITY_VERSION,
    observationHash: observationHashForG2bPublicStandardContractRow(row),
    observationHashVersion: OBSERVATION_HASH_VERSION,
    suppliers: suppliersForG2bPublicStandardContractRow(row),
    contractName: firstText(row, ["cntrctNm", "prodNm", "prdlstNm"]) || "-",
    ...(itemNames.length > 0 ? { itemNames } : {}),
    ...(itemCodes.length > 0 ? { itemCodes } : {}),
    contractDate: normalizeDate(firstText(row, ["cntrctCnclsDate", "cntrctDate", "cntrctDt"])),
    ...(originalContractDate ? { originalContractDate } : {}),
    ...(amendmentOrder === null ? {} : { amendmentOrder }),
    currentContractAmount,
    totalContractAmount,
    demandAgencyName: firstText(row, ["dminsttNm", "dmndInsttNm", "demandInsttNm", "demandAgencyName"]) || "-",
    demandAgencyCode: firstText(row, ["dminsttCd", "dmndInsttCd", "demandInsttCd", "demandAgencyCode"]),
    contractAgencyName: firstText(row, ["cntrctInsttNm", "contractInsttNm", "contractAgencyName"]) || "-",
    contractAgencyCode: firstText(row, ["cntrctInsttCd", "contractInsttCd", "contractAgencyCode"]),
    contractMethod: firstText(row, ["cntrctMthdNm", "cntrctCnclsMthdNm", "contractMthdNm", "contractMethod"]) || "-",
    ...optionalTextField("contractType", firstText(row, [
      "cntrctCnclsSttusNm",
      "contractConclusionStatusName",
      "contractType",
    ])),
    contractNo: firstText(row, ["dcsnCntrctNo", "cntrctNo", "cntrctRefNo"]),
    noticeNo: firstText(row, ["bidNtceNo", "ntceNo", "noticeNo"]),
    contractDetailUrl: firstText(row, [
      "cntrctDtlInfoUrl",
      "cntrctInfoUrl",
      "cntrctDetailUrl",
      "contractDetailUrl",
      "dtlInfoUrl",
      "detailUrl",
    ]),
    noticeDetailUrl: firstText(row, ["bidNtceDtlUrl", "bidNtceDetailUrl", "bidNtceUrl", "noticeDetailUrl"]),
  };
}

export function suppliersForG2bPublicStandardContractRow(
  row: Record<string, unknown>,
): G2bPublicStandardContractSupplier[] {
  const corpListSuppliers = parseCorpList(row.corpList)
    .filter((supplier) => supplier.businessNumber)
    .map((supplier) => ({
      raw: supplier.raw,
      businessName: supplier.businessName,
      businessNumber: supplier.businessNumber,
    }));

  return dedupeSuppliers([...corpListSuppliers, ...findDirectSuppliers(row)]);
}

export function contractKeyForG2bPublicStandardContractRow(row: Record<string, unknown>) {
  const contractKey = contractKeyPartsForG2bPublicStandardContractRow(row);
  return keyFromParts("contract", contractKey.kind, contractKey.parts);
}

export function observationHashForG2bPublicStandardContractRow(row: Record<string, unknown>) {
  return keyFromParts("observation", "raw-row", [stableCanonicalValue(row)]);
}

export function itemNamesForG2bPublicStandardContractRow(row: Record<string, unknown>) {
  return uniqueNonemptyTexts([row.prodNm, row.prdlstNm]);
}

export function itemCodesForG2bPublicStandardContractRow(row: Record<string, unknown>) {
  return [...new Set([
    row.dtilPrdctClsfcNo,
    row.detailItemCode,
    row.itemCode,
  ].map(asText).map((value) => value.replace(/\D/g, "")).filter((value) => value.length === 10))];
}

function contractKeyPartsForG2bPublicStandardContractRow(row: Record<string, unknown>): {
  kind: "contract-no" | "notice-detail" | "fallback";
  parts: unknown[];
} {
  const contractNo = canonicalIdentifier(firstText(row, ["dcsnCntrctNo", "cntrctNo", "cntrctRefNo"]));
  if (contractNo) {
    return { kind: "contract-no", parts: [G2B_PUBLIC_STANDARD_CONTRACT_DATASET, contractNo] };
  }

  const noticeNo = canonicalIdentifier(firstText(row, ["bidNtceNo", "ntceNo", "noticeNo"]));
  const contractDetailUrl = canonicalText(
    firstText(row, [
      "cntrctDtlInfoUrl",
      "cntrctInfoUrl",
      "cntrctDetailUrl",
      "contractDetailUrl",
      "dtlInfoUrl",
      "detailUrl",
    ]),
  );
  if (noticeNo && contractDetailUrl) {
    return {
      kind: "notice-detail",
      parts: [G2B_PUBLIC_STANDARD_CONTRACT_DATASET, noticeNo, contractDetailUrl],
    };
  }

  return {
    kind: "fallback",
    parts: [
      G2B_PUBLIC_STANDARD_CONTRACT_DATASET,
      noticeNo,
      canonicalText(firstText(row, ["cntrctCnclsDate", "cntrctDate", "cntrctDt"])),
      canonicalText(firstText(row, ["dminsttNm", "dmndInsttNm", "demandInsttNm", "demandAgencyName"])),
      canonicalText(firstText(row, ["cntrctInsttNm", "contractInsttNm", "contractAgencyName"])),
      canonicalText(firstText(row, ["cntrctNm", "prodNm", "prdlstNm"])),
      itemNamesForG2bPublicStandardContractRow(row).map(canonicalText).filter(Boolean).sort(),
      canonicalText(firstText(row, ["cntrctMthdNm", "cntrctCnclsMthdNm", "contractMthdNm", "contractMethod"])),
      canonicalText(firstText(row, ["cntrctCnclsSttusNm", "contractConclusionStatusName", "contractType"])),
      canonicalNumber(parseAmount(firstText(row, ["totCntrctAmt", "ttalCntrctAmt", "cntrctAmt", "cntrctPrce"]))),
    ],
  };
}

function parseCorpList(value: unknown): G2bPublicStandardContractSupplier[] {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const raw = getRecord(entry);
      return {
        raw,
        businessName: firstText(raw, ["corpNm", "rprsntCorpNm", "cntrctCorpNm"]),
        businessNumber: normalizeBusinessNumber(firstText(raw, ["bizno", "bizrno", "corpBizno", "rprsntCorpBizrno"])),
      };
    });
  }

  const text = asText(value);
  if (!text) {
    const raw = getRecord(value);
    return Object.keys(raw).length > 0
      ? [
          {
            raw,
            businessName: firstText(raw, ["corpNm", "rprsntCorpNm", "cntrctCorpNm"]),
            businessNumber: normalizeBusinessNumber(firstText(raw, ["bizno", "bizrno", "corpBizno", "rprsntCorpBizrno"])),
          },
        ]
      : [];
  }

  const bracketedEntries = [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  const entries = bracketedEntries.length > 0 ? bracketedEntries : [text];
  return entries.map((entry) => {
    const parts = entry.split("^").map((part) => part.trim());
    return {
      raw: {},
      businessName: asText(parts[3]),
      businessNumber: normalizeCorpListBusinessNumber(parts),
    };
  });
}

function findDirectSuppliers(row: Record<string, unknown>): G2bPublicStandardContractSupplier[] {
  const suppliers: G2bPublicStandardContractSupplier[] = [];
  for (const businessNumberField of DIRECT_BUSINESS_NUMBER_FIELDS) {
    const businessNumber = normalizeBusinessNumber(asText(row[businessNumberField]));
    if (!businessNumber) {
      continue;
    }
    const businessNameField =
      DIRECT_BUSINESS_NAME_FIELDS.find((field) => asText(row[field])) ?? DIRECT_BUSINESS_NAME_FIELDS[0];
    suppliers.push({
      raw: { businessNameField, businessNumberField },
      businessName: firstText(row, [...DIRECT_BUSINESS_NAME_FIELDS]),
      businessNumber,
    });
  }
  return suppliers;
}

function dedupeSuppliers(suppliers: G2bPublicStandardContractSupplier[]) {
  const seen = new Set<string>();
  const result: G2bPublicStandardContractSupplier[] = [];
  for (const supplier of suppliers) {
    const key = `${supplier.businessNumber}\n${supplier.businessName}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(supplier);
  }
  return result;
}

function normalizeCorpListBusinessNumber(parts: string[]) {
  for (const part of parts.slice().reverse()) {
    const digits = normalizeBusinessNumber(part);
    if (digits) {
      return digits;
    }
  }
  return "";
}

function normalizeBusinessNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? digits : "";
}

function normalizeDate(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) {
    return null;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function parseAmount(value: string) {
  const numeric = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseNonnegativeInteger(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function firstText(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = asText(row[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function uniqueNonemptyTexts(values: unknown[]) {
  return [...new Set(values.map(asText).filter(Boolean))];
}

function optionalTextField<Key extends string>(key: Key, value: string): Partial<Record<Key, string>> {
  return value ? ({ [key]: value } as Record<Key, string>) : {};
}

function asText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function keyFromParts(scope: string, kind: string, parts: unknown[]) {
  return `g2b-standard-contract:${CONTRACT_IDENTITY_VERSION}:${scope}:${kind}:${sha256(parts)}`;
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stableCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableCanonicalValue);
  }
  const record = getRecord(value);
  if (Object.keys(record).length === 0) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableCanonicalValue(record[key])]),
  );
}

function canonicalText(value: string | null) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalIdentifier(value: string) {
  return canonicalText(value);
}

function canonicalNumber(value: number) {
  return Object.is(value, -0) ? "0" : String(value);
}
