import { parseBusinessNumber } from "@/lib/domain/business-number";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";

import {
  EXCELLENT_PRODUCTS_SOURCE_DATASET,
  EXCELLENT_PRODUCT_HEADER_ALIASES,
  TARGET_PRODUCT_CLASSIFICATION_PREFIX,
} from "./constants";
import type {
  ExcellentProductCsvParseResult,
  ExcellentProductCsvRow,
} from "./types";

export { TARGET_PRODUCT_CLASSIFICATION_PREFIX };

/**
 * Normalize a product classification number by stripping non-digit characters.
 * Non-string and empty values return an empty string.
 */
export function normalizeProductClassificationNo(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(/\D/g, "");
}

/**
 * Returns true when the normalized value starts with the fixed
 * `39121801` building-control product classification prefix.
 */
export function isTargetProductClassification(value: unknown): boolean {
  const normalized = normalizeProductClassificationNo(value);
  if (normalized.length === 0) {
    return false;
  }
  return normalized.startsWith(TARGET_PRODUCT_CLASSIFICATION_PREFIX);
}

type AliasKey = keyof typeof EXCELLENT_PRODUCT_HEADER_ALIASES;

type HeaderIndex = {
  aliases: Record<AliasKey, number>;
  rawHeaders: string[];
};

type CsvRow = {
  /** 1-indexed physical line number in the source file (header is row 1). */
  physicalRow: number;
  fields: string[];
};

const REQUIRED_LOGICAL_FIELDS: readonly AliasKey[] = [
  "company",
  "business",
  "product",
  "designation",
];

const DATE_PATTERNS: Array<{ pattern: RegExp; build: (m: RegExpExecArray) => string }> = [
  {
    pattern: /^(\d{4})(\d{2})(\d{2})$/,
    build: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
  {
    pattern: /^(\d{4})-(\d{2})-(\d{2})$/,
    build: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
  {
    pattern: /^(\d{4})\.(\d{2})\.(\d{2})$/,
    build: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
  {
    pattern: /^(\d{4})\/(\d{2})\/(\d{2})$/,
    build: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
];

// Match the classification token directly from the source cell so that
// later digits in the human-readable name never join the code. Accepts both
// a 10-digit no-separator form (e.g. "3912180101") and the 8-digit form
// optionally followed by punctuation/spacing and exactly two more digits
// (e.g. "39121801-01" or "39121801 01").
const CLASSIFICATION_TOKEN_SOURCE_PATTERN = /^(?:(\d{10})|(\d{8})(?:[\s\-:·./]+(\d{2}))?)(?!\d)/;

/**
 * Parse a 조달청 우수제품 지정 내역 CSV buffer into normalized snapshot rows.
 *
 * The parser is a state machine that tracks quote state across CR/LF so that
 * quoted fields containing commas, doubled quotes, and newline sequences are
 * preserved exactly. Lines are never split before quote parsing.
 */
export function parseExcellentProductsCsv(
  content: string,
  sourceFileName: string,
): ExcellentProductCsvParseResult {
  const stripped = stripBom(content);
  const { records, error: parseError } = parseCsvRecords(stripped);
  if (parseError !== null) {
    return { rows: [], errors: [parseError], totalRowCount: 0, skippedCount: 0 };
  }
  const nonBlankRecords = records.filter((record) => !isBlankRecord(record.fields));

  if (nonBlankRecords.length === 0) {
    return { rows: [], errors: ["CSV file is empty."], totalRowCount: 0, skippedCount: 0 };
  }

  const headers = nonBlankRecords[0].fields.map((header) => header.trim());
  const duplicateHeaders = findDuplicateHeaders(headers);

  if (duplicateHeaders.length > 0) {
    return {
      rows: [],
      errors: [`Duplicate CSV headers: ${duplicateHeaders.join(", ")}`],
      totalRowCount: 0,
      skippedCount: 0,
    };
  }

  const headerIndex = buildHeaderIndex(headers);
  const missingLogical = REQUIRED_LOGICAL_FIELDS.filter(
    (key) => headerIndex.aliases[key] === -1,
  );

  const hasClassification =
    headerIndex.aliases.classificationCombined !== -1 ||
    headerIndex.aliases.classificationNumber !== -1;

  if (!hasClassification) {
    missingLogical.push("classificationCombined");
  }

  if (missingLogical.length > 0) {
    const labels = missingLogical
      .map((key) => aliasKeyDisplayName(key))
      .join(", ");
    return {
      rows: [],
      errors: [`Missing required CSV headers: ${labels}`],
      totalRowCount: 0,
      skippedCount: 0,
    };
  }

  const rows: ExcellentProductCsvRow[] = [];
  const errors: string[] = [];
  const seenHashes = new Set<string>();
  let skippedCount = 0;
  let totalRowCount = 0;
  const importedAt = new Date().toISOString();

  for (const record of nonBlankRecords.slice(1)) {
    const physicalRow = record.physicalRow;
    totalRowCount += 1;

    if (record.fields.length !== headers.length) {
      errors.push(
        `Row ${physicalRow}: Expected ${headers.length} columns but found ${record.fields.length}.`,
      );
      continue;
    }

    const rawData = buildRawData(headerIndex.rawHeaders, record.fields);
    const parsed = parseDataRow(rawData, sourceFileName, importedAt);

    if ("error" in parsed) {
      errors.push(`Row ${physicalRow}: ${parsed.error}`);
      continue;
    }

    if (!parsed.row.productClassificationNormalized.startsWith(TARGET_PRODUCT_CLASSIFICATION_PREFIX)) {
      skippedCount += 1;
      continue;
    }

    if (seenHashes.has(parsed.row.sourceRowHash)) {
      skippedCount += 1;
      continue;
    }

    seenHashes.add(parsed.row.sourceRowHash);
    rows.push(parsed.row);
  }

  return { rows, errors, totalRowCount, skippedCount };
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function parseCsvRecords(content: string): { records: CsvRow[]; error: string | null } {
  const records: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let physicalRow = 1;
  let recordStartRow = 1;
  let started = false;

  let quoteStartRow = 1;

  const pushRecord = () => {
    fields.push(field);
    field = "";
    // Even if the record is empty (all blank fields), keep it so we can
    // count rows and report column-count errors consistently. Blank-line
    // handling is done at a higher level.
    records.push({ physicalRow: recordStartRow, fields });
    fields = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === '"') {
      if (inQuotes && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        if (!inQuotes) {
          quoteStartRow = physicalRow;
        }
        inQuotes = !inQuotes;
      }
      started = true;
      continue;
    }

    if (character === "\n" || character === "\r") {
      // Consume CRLF as a single line break regardless of quote state so
      // physical row counts track every newline in the source file.
      const isCRLF = character === "\r" && content[index + 1] === "\n";
      if (isCRLF) {
        index += 1;
      }
      physicalRow += 1;
      if (!inQuotes) {
        pushRecord();
        recordStartRow = physicalRow;
        started = false;
      } else {
        // Preserve the exact CR/LF sequence inside the field so that
        // quoted multi-line content (e.g. certification details) round-trips unchanged.
        field += character;
        if (isCRLF) {
          field += "\n";
        }
      }
      continue;
    }

    if (!inQuotes && character === ",") {
      fields.push(field);
      field = "";
      started = true;
      continue;
    }

    field += character;
    started = true;
  }

  if (started || field.length > 0 || fields.length > 0) {
    pushRecord();
  }

  if (inQuotes) {
    return {
      records,
      error: `Unterminated quoted field starting at line ${quoteStartRow}.`,
    };
  }

  return { records, error: null };
}

function isBlankRecord(fields: string[]): boolean {
  return fields.every((field) => field.trim().length === 0);
}

function findDuplicateHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const header of headers) {
    if (seen.has(header)) {
      duplicates.add(header);
    }
    seen.add(header);
  }

  return [...duplicates];
}

function buildHeaderIndex(headers: string[]): HeaderIndex {
  const aliases = {} as Record<AliasKey, number>;

  (Object.keys(EXCELLENT_PRODUCT_HEADER_ALIASES) as AliasKey[]).forEach((key) => {
    aliases[key] = -1;
    for (const alias of EXCELLENT_PRODUCT_HEADER_ALIASES[key]) {
      const index = headers.indexOf(alias);
      if (index !== -1) {
        aliases[key] = index;
        break;
      }
    }
  });

  return { aliases, rawHeaders: headers };
}

function aliasKeyDisplayName(key: AliasKey): string {
  return EXCELLENT_PRODUCT_HEADER_ALIASES[key][0];
}

function buildRawData(headers: string[], fields: string[]): Record<string, string> {
  const rawData: Record<string, string> = {};
  headers.forEach((header, index) => {
    rawData[header] = fields[index] ?? "";
  });
  return rawData;
}

type ParseDataResult =
  | { row: ExcellentProductCsvRow }
  | { error: string };

function parseDataRow(
  raw: Record<string, string>,
  sourceFileName: string,
  importedAt: string,
): ParseDataResult {
  let bizNoNormalized: string;
  try {
    bizNoNormalized = parseBusinessNumber(getField(raw, "business"));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid business registration number.",
    };
  }

  const designationNo = trimToString(getField(raw, "designation"));
  if (designationNo.length === 0) {
    return { error: "Missing designation number." };
  }

  const productName = trimToString(getField(raw, "product"));
  if (productName.length === 0) {
    return { error: "Missing product name." };
  }

  const companyNameCsv = trimToString(getField(raw, "company"));
  if (companyNameCsv.length === 0) {
    return { error: "Missing company name." };
  }

  const classification = parseClassification(raw);
  if (!classification.ok) {
    return { error: classification.error };
  }

  const productSpec = optionalField(raw, "spec");
  const representativeNameCsv = optionalField(raw, "representative");
  const phoneCsv = optionalField(raw, "phone");
  const addressCsv = optionalField(raw, "address");
  const sanctionType = optionalField(raw, "sanction");
  const certificationDetailsRaw = certificationField(raw);
  const designationStartDate = normalizeOptionalDate(getField(raw, "issueDate"));
  const designationEndDate = normalizeOptionalDate(getField(raw, "endDate"));

  const sourceRowHash = createSourceRowHash({
    bizNoNormalized,
    designationNo,
    productClassificationNormalized: classification.normalized,
    productSpec: productSpec ?? "",
  });

  const row: ExcellentProductCsvRow = {
    designationNo,
    bizNoNormalized,
    companyNameCsv,
    representativeNameCsv,
    phoneCsv,
    addressCsv,
    productName,
    designationStartDate,
    designationEndDate,
    productClassificationNo: classification.rawToken,
    productClassificationNormalized: classification.normalized,
    productClassificationName: classification.name,
    productSpec,
    certificationDetailsRaw,
    sanctionType,
    sourceRowHash,
    // The entire snapshot shares a single stable dataset identifier so
    // reconciliation and the unique (source_dataset, source_row_hash)
    // index treat rows from different CSV files as one logical dataset.
    sourceDataset: EXCELLENT_PRODUCTS_SOURCE_DATASET,
    sourceFileName,
    sourceImportedAt: importedAt,
    rawData: raw,
  };

  return { row };
}

function getField(raw: Record<string, string>, key: AliasKey): string {
  const header = (() => {
    for (const alias of EXCELLENT_PRODUCT_HEADER_ALIASES[key]) {
      if (alias in raw) {
        return alias;
      }
    }
    return null;
  })();

  if (header === null) {
    return "";
  }

  return raw[header] ?? "";
}

function optionalField(raw: Record<string, string>, key: AliasKey): string | null {
  const value = getField(raw, key).trim();
  return value.length > 0 ? value : null;
}

function certificationField(raw: Record<string, string>): string | null {
  const value = getField(raw, "certification");
  // Preserve the exact CSV-unquoted content (including leading/trailing
  // whitespace and line breaks) but collapse all-whitespace values to null.
  return value.trim().length > 0 ? value : null;
}

function trimToString(value: string): string {
  return value.trim();
}

type ClassificationResult =
  | { ok: true; rawToken: string; normalized: string; name: string | null }
  | { ok: false; error: string };

function parseClassification(raw: Record<string, string>): ClassificationResult {
  const numberField = getField(raw, "classificationNumber").trim();
  const nameField = getField(raw, "classificationName").trim();
  const combinedField = getField(raw, "classificationCombined").trim();

  if (numberField.length > 0) {
    const extracted = extractClassificationToken(numberField);
    if (extracted === null) {
      return { ok: false, error: "Missing product classification number." };
    }
    return {
      ok: true,
      rawToken: extracted.rawToken,
      normalized: extracted.normalized,
      name: nameField.length > 0 ? nameField : null,
    };
  }

  if (combinedField.length === 0) {
    return { ok: false, error: "Missing product classification number." };
  }

  // Match the classification token directly from the source cell so that
  // later digits in the human-readable name never join the code. The
  // negative lookahead at the end guarantees the token terminates at a
  // non-digit (or at end-of-string), so e.g. "39121801 model20" parses
  // as "39121801" and never accidentally consumes the trailing "20".
  const extracted = extractClassificationToken(combinedField);
  if (extracted === null) {
    return { ok: false, error: "Missing product classification number." };
  }

  const derivedName = deriveClassificationName(combinedField, extracted.normalized);
  return {
    ok: true,
    rawToken: extracted.rawToken,
    normalized: extracted.normalized,
    name: nameField.length > 0 ? nameField : derivedName,
  };
}

function extractClassificationToken(
  value: string,
): { rawToken: string; normalized: string } | null {
  const match = value.match(CLASSIFICATION_TOKEN_SOURCE_PATTERN);
  if (!match) {
    return null;
  }
  const normalized = match[1] ?? match[2] + (match[3] ?? "");
  return { rawToken: match[0], normalized };
}

function deriveClassificationName(combined: string, digits: string): string | null {
  // Walk the source string, skip the digits that compose the classification
  // code, and capture any remaining text after the last classification digit.
  let consumed = 0;
  let buffer = "";
  for (const character of combined) {
    if (consumed >= digits.length) {
      buffer += character;
      continue;
    }
    if (/\d/.test(character)) {
      consumed += 1;
    }
  }
  const trimmed = buffer.replace(/^[\s\-:·]+/, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalDate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  for (const { pattern, build } of DATE_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) {
      return build(match);
    }
  }

  return trimmed;
}
