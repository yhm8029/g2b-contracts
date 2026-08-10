import type { ExcellentProductViewItem } from "./types";

const utf8Bom = "\ufeff";

/**
 * The exact 16 columns of the building-control excellent products report,
 * in the order the operations team expects to open them in Excel.
 */
export const EXCELLENT_PRODUCTS_CSV_HEADERS = [
  "No.",
  "지정번호",
  "품명",
  "발급일자",
  "인정(연장)기간",
  "상호명",
  "사업자등록번호",
  "대표자명",
  "전화번호",
  "주소",
  "물품분류번호",
  "물품분류명",
  "규격모델",
  "인증내역",
  "생산지 (공장소재지)",
  "면허 현황",
] as const;

/** Separator between several factory locations or licenses in one cell. */
const MULTI_VALUE_SEPARATOR = "; ";

/**
 * Explicit labels for data the official sources never provided. They make
 * the absence visible instead of silently substituting another value.
 */
export const MISSING_PHONE_LABEL = "전화번호 정보 없음";
export const MISSING_FACTORY_LABEL = "공장소재지 정보 없음";
export const MISSING_LICENSE_LABEL = "면허정보 없음";

/**
 * Quote a field following RFC 4180: fields containing a comma, a double
 * quote, CR, or LF are wrapped in quotes and inner quotes are doubled, so
 * Korean text with embedded line breaks round-trips through Excel.
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function joinValues(values: string[], missingLabel: string): string {
  if (values.length === 0) {
    return missingLabel;
  }

  return values.join(MULTI_VALUE_SEPARATOR);
}

/**
 * Render the building-control result set as an Excel-safe UTF-8 BOM CSV
 * with exactly 16 columns per record and 1-based row numbers.
 *
 * Certification details are emitted exactly as stored, including commas,
 * quotes, and line breaks; only CSV quoting is applied.
 */
export function excellentProductsToCsv(items: ExcellentProductViewItem[]): string {
  const csvRows = items.map((item, index) =>
    [
      String(index + 1),
      item.designationNo,
      item.productName,
      item.designationStartDate ?? "",
      item.designationEndDate ?? "",
      item.companyName,
      item.bizNoNormalized,
      item.representativeName ?? "",
      item.phone ?? MISSING_PHONE_LABEL,
      item.address ?? "",
      item.productClassificationNo,
      item.productClassificationName ?? "",
      item.productSpec ?? "",
      item.certificationDetailsRaw ?? "",
      joinValues(item.factoryLocations, MISSING_FACTORY_LABEL),
      joinValues(item.industries, MISSING_LICENSE_LABEL),
    ]
      .map(csvField)
      .join(","),
  );

  return `${utf8Bom}${[EXCELLENT_PRODUCTS_CSV_HEADERS.join(","), ...csvRows, ""].join("\n")}`;
}