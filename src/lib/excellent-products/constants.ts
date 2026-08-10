/**
 * Fixed product classification prefix for the building-control excellent
 * products lookup (조달청 물품분류 39121801 = 빌딩자동제어장치).
 */
export const TARGET_PRODUCT_CLASSIFICATION_PREFIX = "39121801";

/**
 * Logical field names keyed by the canonical / official header text.
 * Each array is the set of header aliases that map to the same logical field.
 */
export const EXCELLENT_PRODUCT_HEADER_ALIASES = {
  spec: ["물품규격내용", "규격모델", "규격"],
  classificationCombined: ["물품분류"],
  classificationNumber: ["물품분류번호"],
  classificationName: ["물품분류명"],
  representative: ["업체대표자명", "대표자명", "대표자"],
  company: ["업체명", "상호명"],
  business: ["업체사업자번호", "사업자등록번호"],
  phone: ["업체전화번호", "전화번호"],
  address: ["업체주소", "주소"],
  product: ["우수조달지정요청분야", "품명"],
  designation: ["우수조달지정증서번호", "지정번호"],
  certification: ["인증내역"],
  sanction: ["제제유형"],
  issueDate: ["지정시작일자", "발급일자"],
  endDate: ["지정연장일자", "인정(연장)기간", "지정종료일자"],
} as const satisfies Record<string, readonly string[]>;

/**
 * Stable identifier for the building-control excellent products snapshot.
 *
 * The CSV parser tags every row with this constant so the entire snapshot
 * shares a single source dataset across imports, regardless of the source
 * CSV file name. `sourceFileName` continues to record the file that
 * produced each row for traceability.
 */
export const EXCELLENT_PRODUCTS_SOURCE_DATASET =
  "building-control-excellent-products";

/**
 * Source name used for `import_runs.source_name` when an excellent
 * products snapshot replaces the previous dataset.
 */
export const EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME = "excellent-products-csv";

/**
 * Source identifier used for the contract CSV import (lowest profile
 * priority). `importParsedRows` records `import_runs` rows with this name.
 */
export const EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME = "csv";

/**
 * Source identifier used for official user-info / company enrichment
 * (highest profile priority). Reserved so future enrichment flows can
 * tag their `businesses.profile_source` writes consistently.
 */
export const EXCELLENT_PRODUCTS_API_SOURCE_NAME = "user-info";

/**
 * Priority order used when reconciling business profile fields. Higher
 * numbers always win: a non-null value from a higher-priority source
 * replaces a lower-priority existing value, but a `null` never erases
 * a stored non-null value.
 *
 * Unknown source strings are treated as the lowest priority so legacy
 * data without a `profile_source` cannot override fresh enrichment.
 */
export const BUSINESS_PROFILE_SOURCE_PRIORITY: Readonly<Record<string, number>> = {
  [EXCELLENT_PRODUCTS_API_SOURCE_NAME]: 3,
  [EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME]: 2,
  [EXCELLENT_PRODUCTS_CONTRACT_SOURCE_NAME]: 1,
};

/**
 * Return the priority rank for a profile source identifier. Unknown or
 * null sources resolve to `0` so they always lose against a known source.
 */
export function getBusinessProfileSourcePriority(
  source: string | null | undefined,
): number {
  if (source === null || source === undefined) {
    return 0;
  }
  return BUSINESS_PROFILE_SOURCE_PRIORITY[source] ?? 0;
}
