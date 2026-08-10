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
  /**
   * Stable dataset identifier shared by the whole snapshot
   * (`EXCELLENT_PRODUCTS_SOURCE_DATASET`), independent of the CSV file
   * name so consecutive imports reconcile against one logical dataset.
   */
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

/**
 * One row of the 16-column building-control excellent products view.
 *
 * Product designations are the cardinality root: each designation stays a
 * separate item even when several belong to the same business. Company
 * fields resolve from the priority-managed `businesses` profile first and
 * fall back to the exact CSV values captured at import time; missing data
 * stays `null` and is never substituted from another source.
 */
export type ExcellentProductViewItem = {
  /** Designation certificate number (지정번호). */
  designationNo: string;
  /** Business registration number normalized to 10 digits. */
  bizNoNormalized: string;
  /** Resolved company name (상호명). */
  companyName: string;
  /** Resolved representative name (대표자명), or null when unknown. */
  representativeName: string | null;
  /** Resolved phone number (전화번호), or null when unknown. */
  phone: string | null;
  /** Resolved address (주소), or null when unknown. */
  address: string | null;
  /** Product name (품명). */
  productName: string;
  /** Product specification (규격모델). */
  productSpec: string | null;
  /** Raw classification token as stored (물품분류번호). */
  productClassificationNo: string;
  /** Normalized classification number (digits only). */
  productClassificationNormalized: string;
  /** Classification name (물품분류명). */
  productClassificationName: string | null;
  /** Designation start date (발급일자). */
  designationStartDate: string | null;
  /** Designation end date (인정(연장)기간). */
  designationEndDate: string | null;
  /** Certification details exactly as captured from the source. */
  certificationDetailsRaw: string | null;
  /** Deduplicated, sorted factory locations (생산지). Never head offices. */
  factoryLocations: string[];
  /** Deduplicated, sorted industry/license labels (면허 현황). */
  industries: string[];
};

/** Response payload of the dedicated building-control lookup. */
export type BuildingControlExcellentProductsResponse = {
  /** Always the fixed `39121801` classification prefix. */
  classification: string;
  /** Number of distinct normalized business numbers in the result. */
  companyCount: number;
  /** Number of result rows (designations). */
  designationCount: number;
  items: ExcellentProductViewItem[];
};