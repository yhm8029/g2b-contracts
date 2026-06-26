import { z } from "zod";

import { formatBusinessNumber, parseBusinessNumber } from "@/lib/domain/business-number";
import { parseAmountToWon } from "@/lib/domain/money";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";

type CsvRawRow = Record<string, string>;

export type ParsedContractCsvRow = {
  sourceDataset: string;
  sourceRowHash: string;
  bizNoNormalized: string;
  bizNoDisplay: string;
  businessName: string;
  representativeName: string | null;
  address: string | null;
  businessCategory: string | null;
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  contractNo: string | null;
  unifiedContractNo: string | null;
  contractName: string;
  contractDate: string;
  currentContractAmount: number | null;
  totalContractAmount: number | null;
  demandAgencyCode: string | null;
  demandAgencyName: string | null;
  contractAgencyCode: string | null;
  contractAgencyName: string | null;
  contractMethod: string | null;
  winningMethod: string | null;
  businessNameAtContract: string | null;
  contractDetailUrl: string | null;
  noticeDetailUrl: string | null;
  rawSourceUrl: string | null;
};

export type ContractCsvParseResult = {
  validRows: ParsedContractCsvRow[];
  errors: string[];
};

type CsvRecord = {
  lineNumber: number;
  fields: string[];
};

const requiredHeaders = ["biz_no", "business_name", "contract_date", "contract_name"];

const requiredRowSchema = z.object({
  biz_no: z.string().trim().min(1, "biz_no is required."),
  business_name: z.string().trim().min(1, "business_name is required."),
  contract_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "contract_date must be YYYY-MM-DD."),
  contract_name: z.string().trim().min(1, "contract_name is required."),
});

export function parseContractCsv(content: string, sourceFileName: string): ContractCsvParseResult {
  const records = parseCsvRecords(removeBom(content));

  if (records.length === 0) {
    return { validRows: [], errors: ["CSV file is empty."] };
  }

  const headers = records[0].fields.map((header) => header.trim());
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    return {
      validRows: [],
      errors: [`Missing required CSV headers: ${missingHeaders.join(", ")}`],
    };
  }

  const validRows: ParsedContractCsvRow[] = [];
  const errors: string[] = [];

  for (const record of records.slice(1)) {
    if (record.fields.length !== headers.length) {
      errors.push(`Row ${record.lineNumber}: Expected ${headers.length} columns but found ${record.fields.length}.`);
      continue;
    }

    const raw = toRawRow(headers, record.fields);
    const parsed = parseRawRow(raw, sourceFileName);

    if (parsed.success) {
      validRows.push(parsed.row);
    } else {
      errors.push(`Row ${record.lineNumber}: ${parsed.error}`);
    }
  }

  return { validRows, errors };
}

function removeBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function parseCsvRecords(content: string): CsvRecord[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => ({ fields: parseCsvLine(line), lineNumber }));
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }

  fields.push(field);

  return fields;
}

function toRawRow(headers: string[], fields: string[]): CsvRawRow {
  return Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? ""]));
}

function parseRawRow(
  raw: CsvRawRow,
  sourceFileName: string,
): { success: true; row: ParsedContractCsvRow } | { success: false; error: string } {
  const validationResult = requiredRowSchema.safeParse(raw);

  if (!validationResult.success) {
    return {
      success: false,
      error: validationResult.error.issues.map((issue) => issue.message).join(" "),
    };
  }

  try {
    const bizNoNormalized = parseBusinessNumber(value(raw, "biz_no") ?? "");
    const currentContractAmount = parseOptionalAmount(raw, "current_contract_amount");
    const totalContractAmount = parseOptionalAmount(raw, "total_contract_amount");

    return {
      success: true,
      row: {
        sourceDataset: `csv:${sourceFileName}`,
        sourceRowHash: createSourceRowHash(raw),
        bizNoNormalized,
        bizNoDisplay: formatBusinessNumber(bizNoNormalized),
        businessName: value(raw, "business_name") ?? "",
        representativeName: value(raw, "representative_name"),
        address: value(raw, "address"),
        businessCategory: value(raw, "business_category"),
        noticeNo: value(raw, "notice_no"),
        noticeOrder: value(raw, "notice_order"),
        noticeName: value(raw, "notice_name"),
        contractNo: value(raw, "contract_no"),
        unifiedContractNo: value(raw, "unified_contract_no"),
        contractName: value(raw, "contract_name") ?? "",
        contractDate: value(raw, "contract_date") ?? "",
        currentContractAmount,
        totalContractAmount,
        demandAgencyCode: value(raw, "demand_agency_code"),
        demandAgencyName: value(raw, "demand_agency_name"),
        contractAgencyCode: value(raw, "contract_agency_code"),
        contractAgencyName: value(raw, "contract_agency_name"),
        contractMethod: value(raw, "contract_method"),
        winningMethod: value(raw, "winning_method"),
        businessNameAtContract: value(raw, "business_name_at_contract"),
        contractDetailUrl: value(raw, "contract_detail_url"),
        noticeDetailUrl: value(raw, "notice_detail_url"),
        rawSourceUrl: value(raw, "raw_source_url"),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid row.",
    };
  }
}

function value(row: CsvRawRow, key: string): string | null {
  const field = row[key]?.trim() ?? "";
  return field.length > 0 ? field : null;
}

function parseOptionalAmount(row: CsvRawRow, key: string): number | null {
  const raw = value(row, key);

  if (raw === null) {
    return null;
  }

  const parsed = parseAmountToWon(raw);

  if (parsed === null) {
    throw new Error(`${key} must be a valid amount.`);
  }

  return parsed;
}
