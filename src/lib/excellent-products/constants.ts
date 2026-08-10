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
