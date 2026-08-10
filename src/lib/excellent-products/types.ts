/**
 * Shared types for the building-control excellent products feature.
 *
 * The import pipeline takes the official 조달청 "우수제품 지정 내역" CSV
 * and produces a normalized snapshot of rows whose product classification
 * number begins with the fixed `39121801` prefix.
 */

export type ExcellentProductCsvRow = {
  /** Designation certificate number (지정번호). */
  designationNo: string;
  /** Business registration number normalized to 10 digits. */
  bizNoNormalized: string;
  /** Company name as it appears in the source CSV (raw, untrimmed of internal whitespace). */
  companyNameCsv: string;
  /** Representative name from CSV (nullable). */
  representativeNameCsv: string | null;
  /** Phone number from CSV (nullable). */
  phoneCsv: string | null;
  /** Address from CSV (nullable). */
  addressCsv: string | null;
  /** Product name (품명 / 우수조달지정요청분야). */
  productName: string;
  /** Designation start date normalized to YYYY-MM-DD or raw value if invalid. */
  designationStartDate: string | null;
  /** Designation end date normalized to YYYY-MM-DD or raw value if invalid. */
  designationEndDate: string | null;
  /** Raw classification token (e.g. "39121801-01") taken from the cell. */
  productClassificationNo: string;
  /** Normalized classification number (digits only). */
  productClassificationNormalized: string;
  /** Human-readable classification name extracted from the combined cell. */
  productClassificationName: string | null;
  /** Product specification (규격내용 / 규격모델 / 규격). */
  productSpec: string | null;
  /** Unquoted certification details preserving commas, quotes, and line breaks. */
  certificationDetailsRaw: string | null;
  /** Sanction type (제제유형). */
  sanctionType: string | null;
  /** Stable SHA-256 hash of the canonical row keys. */
  sourceRowHash: string;
  /** Dataset identifier for traceability (e.g. csv:filename.csv). */
  sourceDataset: string;
  /** Source file name. */
  sourceFileName: string;
  /** ISO timestamp of import. */
  sourceImportedAt: string;
  /** Original header->value mapping for the row. */
  rawData: Record<string, string>;
};

export type ExcellentProductCsvParseResult = {
  rows: ExcellentProductCsvRow[];
  errors: string[];
  totalRowCount: number;
  skippedCount: number;
};
