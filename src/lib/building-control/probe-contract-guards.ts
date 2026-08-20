import {
  parseApiContractReport,
  BUILDING_CONTROL_REQUIRED_CHECKS,
} from "./api-contract";

const REQUIRED_PROMOTION_FIXTURE_FILES: readonly string[] = [
  "notice-page.json",
  "purchase-target-page.json",
  "award-page.json",
  "designation-list-valid.json",
  "designation-list-expired.json",
  "designation-list-extended.json",
  "designation-detail.json",
];

export function shouldPromoteProbeFixtures(report: unknown): boolean {
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    return false;
  }
  const raw = report as Record<string, unknown>;
  if (raw["version"] !== 1) {
    return false;
  }
  if (raw["passed"] !== true) {
    return false;
  }
  if (raw["productDiscoveryStrategy"] !== "exhaustive_fallback") {
    return false;
  }
  if (raw["fixtureSchemaVersion"] !== 1) {
    return false;
  }
  const rawFixtureHashes = raw["fixtureHashes"];
  if (
    typeof rawFixtureHashes !== "object" ||
    rawFixtureHashes === null ||
    Array.isArray(rawFixtureHashes)
  ) {
    return false;
  }
  const fixtureHashesObj = rawFixtureHashes as Record<string, unknown>;
  const fixtureHashKeys = Object.keys(fixtureHashesObj);
  if (fixtureHashKeys.length !== REQUIRED_PROMOTION_FIXTURE_FILES.length) {
    return false;
  }
  for (const required of REQUIRED_PROMOTION_FIXTURE_FILES) {
    if (!fixtureHashKeys.includes(required)) {
      return false;
    }
  }
  for (const key of fixtureHashKeys) {
    if (!REQUIRED_PROMOTION_FIXTURE_FILES.includes(key)) {
      return false;
    }
    const value = fixtureHashesObj[key];
    if (typeof value !== "string") {
      return false;
    }
    if (value !== value.toLowerCase()) {
      return false;
    }
    if (!/^[0-9a-f]{64}$/.test(value)) {
      return false;
    }
  }
  const rawChecks = raw["checks"];
  if (
    typeof rawChecks !== "object" ||
    rawChecks === null ||
    Array.isArray(rawChecks)
  ) {
    return false;
  }
  const checksObj = rawChecks as Record<string, unknown>;
  for (const required of BUILDING_CONTROL_REQUIRED_CHECKS) {
    if (checksObj[required] !== true) {
      return false;
    }
  }
  try {
    parseApiContractReport(report);
  } catch {
    return false;
  }
  return true;
}
const SUPPORTED_FILES = new Set<string>([
  "notice-page.json",
  "purchase-target-page.json",
  "award-page.json",
  "designation-list-valid.json",
  "designation-list-expired.json",
  "designation-list-extended.json",
  "designation-detail.json",
]);
type AllowedKeySet = ReadonlySet<string>;
const PAGE_TOP_ALLOWED: AllowedKeySet = new Set<string>([
  "schemaVersion",
  "page",
]);
const PAGE_PAGE_ALLOWED: AllowedKeySet = new Set<string>([
  "pageNo",
  "numOfRows",
  "totalCount",
  "items",
]);
const NOTICE_ITEM_ALLOWED: AllowedKeySet = new Set<string>([
  "bidNtceNo",
  "bidNtceOrd",
  "bidNtceNm",
]);
const PURCHASE_ITEM_ALLOWED: AllowedKeySet = new Set<string>([
  "bidNtceNo",
  "bidNtceOrd",
  "bidClsfcNo",
  "prdctSno",
  "prdctClsfcNo",
  "dtilPrdctClsfcNo",
]);
const AWARD_ITEM_ALLOWED: AllowedKeySet = new Set<string>([
  "bidNtceNo",
  "bidNtceOrd",
  "bidClsfcNo",
  "rbidNo",
  "rgstDt",
  "fnlSucsfDate",
  "bidwinnrBizno",
  "bidwinnrNm",
]);
const DESIGNATION_LIST_TOP_ALLOWED: AllowedKeySet = new Set<string>([
  "schemaVersion",
  "status",
  "totalCount",
  "items",
]);
const DESIGNATION_LIST_ITEM_ALLOWED: AllowedKeySet = new Set<string>([
  "applVldYn",
  "bzmnRegNo",
  "dsgnBgngYmd",
  "dsgnEndYmd",
  "dsgnExtsYmd",
  "entNm",
  "etpmDsgnCrfcNo",
  "etpmDsgnDmndNo",
  "dsgnDmndChgOrd",
  "etpsSqno",
  "itemCfnm",
]);
const DESIGNATION_DETAIL_TOP_ALLOWED: AllowedKeySet = new Set<string>([
  "schemaVersion",
  "designationRequest",
  "classifications",
]);
const DESIGNATION_DETAIL_REQUEST_ALLOWED: AllowedKeySet = new Set<string>([
  "etpmDsgnCrfcNo",
  "etpmDsgnDmndNo",
  "dsgnDmndChgOrd",
  "etpsSqno",
]);
const DESIGNATION_DETAIL_CLASSIFICATION_ALLOWED: AllowedKeySet =
  new Set<string>(["itemUntyNo"]);
const STATUS_VALID = "\uC720\uD6A8";
const STATUS_EXPIRED = "\uB9CC\uB8CC";
const STATUS_SUSPENDED = "\uD6A8\uB825\uC815\uC9C0";
const DESIGNATION_VALID_STATUSES: ReadonlySet<string> = new Set<string>([
  STATUS_VALID,
]);
const DESIGNATION_EXPIRED_STATUSES: ReadonlySet<string> = new Set<string>([
  STATUS_EXPIRED,
]);
const DESIGNATION_EXTENDED_STATUSES: ReadonlySet<string> = new Set<string>([
  STATUS_VALID,
  STATUS_EXPIRED,
]);
function isLeapYear(year: number): boolean {
  if (year % 400 === 0) {
    return true;
  }
  if (year % 100 === 0) {
    return false;
  }
  return year % 4 === 0;
}
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}
function isGregorianDate(yyyy: string, mm: string, dd: string): boolean {
  if (!/^\d{4}$/.test(yyyy) || !/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd)) {
    return false;
  }
  const y = Number(yyyy);
  const m = Number(mm);
  const d = Number(dd);
  if (y < 1 || y > 9999) {
    return false;
  }
  if (m < 1 || m > 12) {
    return false;
  }
  const max = daysInMonth(y, m);
  if (d < 1 || d > max) {
    return false;
  }
  return true;
}

export function normalizeDesignationDate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const digits = /^\d{8}$/.test(trimmed)
    ? trimmed
    : /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? trimmed.replace(/-/g, "")
      : null;
  if (
    digits === null ||
    !isGregorianDate(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8))
  ) {
    throw new Error("invalid designation date");
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function hasDesignationExtensionEvidence(input: {
  endDate: string;
  extensionDate: string;
}): boolean {
  const end = normalizeDesignationDate(input.endDate);
  const exts = normalizeDesignationDate(input.extensionDate);
  if (!exts || exts.length === 0) return false;
  if (!end || end.length === 0) return false;
  if (!(exts >= end)) return false;
  return true;
}

function isTimeOfDay(hh: string, mi: string, ss: string): boolean {
  if (!/^\d{2}$/.test(hh) || !/^\d{2}$/.test(mi) || !/^\d{2}$/.test(ss)) {
    return false;
  }
  const h = Number(hh);
  const m = Number(mi);
  const s = Number(ss);
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) {
    return false;
  }
  return true;
}
function validateGregorianDateTime(
  date: string,
  time: string,
): { dateKey: string; timeKey: string } {
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) {
    throw new Error(`Invalid digit date/time: ${date} ${time}`);
  }
  if (!isGregorianDate(date.slice(0, 4), date.slice(4, 6), date.slice(6, 8))) {
    throw new Error(`Invalid Gregorian date: ${date}`);
  }
  if (!isTimeOfDay(time.slice(0, 2), time.slice(2, 4), time.slice(4, 6))) {
    throw new Error(`Invalid time of day: ${time}`);
  }
  return { dateKey: date, timeKey: time };
}
function timestampToKey(timestamp: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }
  const yyyy = timestamp.slice(0, 4);
  const mm = timestamp.slice(5, 7);
  const dd = timestamp.slice(8, 10);
  const hh = timestamp.slice(11, 13);
  const mi = timestamp.slice(14, 16);
  const ss = timestamp.slice(17, 19);
  const date = yyyy + mm + dd;
  const time = hh + mi + ss;
  if (!isGregorianDate(yyyy, mm, dd)) {
    throw new Error(`Invalid Gregorian date in timestamp: ${timestamp}`);
  }
  if (!isTimeOfDay(hh, mi, ss)) {
    throw new Error(`Invalid time in timestamp: ${timestamp}`);
  }
  return date + time;
}
function beginEndBounds(
  begin: string,
  end: string,
): { lo: string; hi: string } {
  if (!/^\d{12}$/.test(begin) || !/^\d{12}$/.test(end)) {
    throw new Error(`Invalid begin/end digit keys`);
  }
  const beginDate = begin.slice(0, 8);
  const beginTime = begin.slice(8, 12);
  const endDate = end.slice(0, 8);
  const endTime = end.slice(8, 12);
  validateGregorianDateTime(beginDate, beginTime + "00");
  validateGregorianDateTime(endDate, endTime + "59");
  const beginFull = beginDate + beginTime + "00";
  const endFull = endDate + endTime + "59";
  if (beginFull > endFull) {
    throw new Error(`begin must be <= end`);
  }
  return { lo: beginFull, hi: endFull };
}
export function isAwardRegistrationTimestampInWindow(
  timestamp: string,
  begin: string,
  end: string,
): boolean {
  try {
    const tsKey = timestampToKey(timestamp);
    const { lo, hi } = beginEndBounds(begin, end);
    return tsKey >= lo && tsKey <= hi;
  } catch {
    return false;
  }
}
export function hasExactDesignationStatusUnion(
  statuses: readonly string[],
): boolean {
  if (!Array.isArray(statuses)) {
    return false;
  }
  if (statuses.length !== 4) {
    return false;
  }
  const seen = new Set<string>();
  for (const s of statuses) {
    if (typeof s !== "string") {
      return false;
    }
    if (seen.has(s)) {
      return false;
    }
    seen.add(s);
  }
  const expected = new Set<string>([
    "",
    STATUS_VALID,
    STATUS_EXPIRED,
    STATUS_SUSPENDED,
  ]);
  if (seen.size !== expected.size) {
    return false;
  }
  for (const s of expected) {
    if (!seen.has(s)) {
      return false;
    }
  }
  return true;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const DISALLOWED_KEY_TOKENS: readonly string[] = [
  "cookie",
  "cookies",
  "session",
  "auth",
  "token",
  "password",
  "secret",
];
const PROJECTION_SAFE_OVERRIDE_KEYS: ReadonlySet<string> = new Set<string>([
  "designationRequest",
]);
function rejectIfSensitiveKey(
  key: string,
  allowExact: ReadonlySet<string>,
): void {
  if (allowExact.has(key)) {
    return;
  }
  const lower = key.toLowerCase();
  for (const tok of DISALLOWED_KEY_TOKENS) {
    if (lower.includes(tok)) {
      throw new Error(`Sensitive key not allowed: ${key}`);
    }
  }
}
function validateKeys(
  value: unknown,
  allowed: AllowedKeySet,
  path: string,
  childProjection?: Map<string, AllowedKeySet>,
): void {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const present = Object.keys(value);
  if (present.length !== allowed.size) {
    throw new Error(
      `Unexpected key count at ${path}: expected ${allowed.size}, got ${present.length}`,
    );
  }
  for (const k of present) {
    if (!allowed.has(k)) {
      throw new Error(`Unexpected key at ${path}: ${k}`);
    }
    rejectIfSensitiveKey(k, PROJECTION_SAFE_OVERRIDE_KEYS);
  }
  for (const required of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, required)) {
      throw new Error(`Missing required key at ${path}: ${required}`);
    }
  }
  if (childProjection) {
    for (const k of present) {
      const childAllowed = childProjection.get(k);
      if (childAllowed) {
        validateKeys(value[k], childAllowed, `${path}.${k}`);
      }
    }
  }
}
function validatePageEnvelope(
  payload: unknown,
  fileName: string,
  itemAllowed: AllowedKeySet,
): void {
  if (!isPlainObject(payload)) {
    throw new TypeError(`${fileName} payload must be an object`);
  }
  validateKeys(payload, PAGE_TOP_ALLOWED, fileName);
  if (payload["schemaVersion"] !== 1) {
    throw new Error(`${fileName} schemaVersion must be 1`);
  }
  const page = payload["page"];
  if (!isPlainObject(page)) {
    throw new TypeError(`${fileName} page must be an object`);
  }
  validateKeys(page, PAGE_PAGE_ALLOWED, `${fileName}.page`);
  const pageNo = page["pageNo"];
  const numOfRows = page["numOfRows"];
  const totalCount = page["totalCount"];
  const items = page["items"];
  if (pageNo !== 1) {
    throw new Error(`${fileName} page.pageNo must be 1`);
  }
  if (
    typeof numOfRows !== "number" ||
    !Number.isInteger(numOfRows) ||
    numOfRows <= 0
  ) {
    throw new TypeError(
      `${fileName} page.numOfRows must be a positive integer`,
    );
  }
  if (
    typeof totalCount !== "number" ||
    !Number.isInteger(totalCount) ||
    totalCount < 0
  ) {
    throw new TypeError(
      `${fileName} page.totalCount must be a non-negative integer`,
    );
  }
  if (!Array.isArray(items)) {
    throw new TypeError(`${fileName} page.items must be an array`);
  }
  const expectedCount = Math.min(numOfRows, totalCount);
  if (items.length !== expectedCount) {
    throw new Error(
      `${fileName} page.items length (${items.length}) must equal min(numOfRows,totalCount)=${expectedCount}`,
    );
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item)) {
      throw new TypeError(`${fileName} page.items[${i}] must be an object`);
    }
    validateKeys(item, itemAllowed, `${fileName}.page.items[${i}]`);
    for (const k of Object.keys(item)) {
      if (typeof item[k] !== "string") {
        throw new TypeError(
          `${fileName}.page.items[${i}].${k} must be a string`,
        );
      }
    }
  }
}
function validateDesignationList(
  payload: unknown,
  fileName: string,
  allowedStatuses: ReadonlySet<string>,
  requireExtendedCheck: boolean,
): void {
  if (!isPlainObject(payload)) {
    throw new TypeError(`${fileName} payload must be an object`);
  }
  validateKeys(payload, DESIGNATION_LIST_TOP_ALLOWED, fileName);
  if (payload["schemaVersion"] !== 1) {
    throw new Error(`${fileName} schemaVersion must be 1`);
  }
  if (typeof payload["status"] !== "string") {
    throw new TypeError(`${fileName} status must be a string`);
  }
  if (!allowedStatuses.has(payload["status"])) {
    throw new Error(`${fileName} status not in allowed set`);
  }
  const totalCount = payload["totalCount"];
  if (
    typeof totalCount !== "number" ||
    !Number.isInteger(totalCount) ||
    totalCount < 0
  ) {
    throw new TypeError(
      `${fileName} totalCount must be a non-negative integer`,
    );
  }
  const items = payload["items"];
  if (!Array.isArray(items)) {
    throw new TypeError(`${fileName} items must be an array`);
  }
  if (items.length !== totalCount) {
    throw new Error(`${fileName} items length must equal totalCount`);
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item)) {
      throw new TypeError(`${fileName} items[${i}] must be an object`);
    }
    validateKeys(
      item,
      DESIGNATION_LIST_ITEM_ALLOWED,
      `${fileName}.items[${i}]`,
    );
    for (const k of Object.keys(item)) {
      if (typeof item[k] !== "string") {
        throw new TypeError(`${fileName}.items[${i}].${k} must be a string`);
      }
    }
  }
  if (requireExtendedCheck) {
    if (items.length !== 1) {
      throw new Error(`${fileName} extended must have exactly one item`);
    }
    const only = items[0] as Record<string, unknown>;
    const endYmd = only["dsgnEndYmd"];
    const extsYmd = only["dsgnExtsYmd"];
    if (typeof endYmd !== "string" || typeof extsYmd !== "string") {
      throw new Error(`${fileName} extended item dates must be strings`);
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(endYmd) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(extsYmd)
    ) {
      throw new Error(`${fileName} extended item dates must be YYYY-MM-DD`);
    }
    if (
      !isGregorianDate(
        endYmd.slice(0, 4),
        endYmd.slice(5, 7),
        endYmd.slice(8, 10),
      )
    ) {
      throw new Error(`${fileName} dsgnEndYmd not a real date`);
    }
    if (
      !isGregorianDate(
        extsYmd.slice(0, 4),
        extsYmd.slice(5, 7),
        extsYmd.slice(8, 10),
      )
    ) {
      throw new Error(`${fileName} dsgnExtsYmd not a a real date`);
    }
    if (
      !hasDesignationExtensionEvidence({
        endDate: endYmd,
        extensionDate: extsYmd,
      })
    ) {
      throw new Error(
        `${fileName} dsgnExtsYmd must be equal to or later than dsgnEndYmd`,
      );
    }
  }
}
function validateDesignationDetail(payload: unknown, fileName: string): void {
  if (!isPlainObject(payload)) {
    throw new TypeError(`${fileName} payload must be an object`);
  }
  validateKeys(payload, DESIGNATION_DETAIL_TOP_ALLOWED, fileName);
  if (payload["schemaVersion"] !== 1) {
    throw new Error(`${fileName} schemaVersion must be 1`);
  }
  const req = payload["designationRequest"];
  if (!isPlainObject(req)) {
    throw new TypeError(`${fileName} designationRequest must be an object`);
  }
  validateKeys(
    req,
    DESIGNATION_DETAIL_REQUEST_ALLOWED,
    `${fileName}.designationRequest`,
  );
  for (const k of Object.keys(req)) {
    if (typeof req[k] !== "string") {
      throw new TypeError(
        `${fileName}.designationRequest.${k} must be a string`,
      );
    }
  }
  const cls = payload["classifications"];
  if (!Array.isArray(cls) || cls.length === 0) {
    throw new Error(`${fileName} classifications must be a non-empty array`);
  }
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (!isPlainObject(c)) {
      throw new TypeError(
        `${fileName}.classifications[${i}] must be an object`,
      );
    }
    validateKeys(
      c,
      DESIGNATION_DETAIL_CLASSIFICATION_ALLOWED,
      `${fileName}.classifications[${i}]`,
    );
    if (typeof c["itemUntyNo"] !== "string") {
      throw new TypeError(
        `${fileName}.classifications[${i}].itemUntyNo must be a string`,
      );
    }
  }
}
export function assertBuildingControlFixtureProjection(
  fileName: string,
  payload: unknown,
): void {
  if (typeof fileName !== "string") {
    throw new TypeError("fileName must be a string");
  }
  if (!SUPPORTED_FILES.has(fileName)) {
    throw new Error(`Unsupported fixture file: ${fileName}`);
  }
  if (
    fileName === "notice-page.json" ||
    fileName === "purchase-target-page.json" ||
    fileName === "award-page.json"
  ) {
    const itemAllowed: AllowedKeySet =
      fileName === "notice-page.json"
        ? NOTICE_ITEM_ALLOWED
        : fileName === "purchase-target-page.json"
          ? PURCHASE_ITEM_ALLOWED
          : AWARD_ITEM_ALLOWED;
    validatePageEnvelope(payload, fileName, itemAllowed);
    assertNoSensitiveFixtureShapes(payload);
    return;
  }
  if (fileName === "designation-list-valid.json") {
    validateDesignationList(
      payload,
      fileName,
      DESIGNATION_VALID_STATUSES,
      false,
    );
    assertNoSensitiveFixtureShapes(payload);
    return;
  }
  if (fileName === "designation-list-expired.json") {
    validateDesignationList(
      payload,
      fileName,
      DESIGNATION_EXPIRED_STATUSES,
      false,
    );
    assertNoSensitiveFixtureShapes(payload);
    return;
  }
  if (fileName === "designation-list-extended.json") {
    validateDesignationList(
      payload,
      fileName,
      DESIGNATION_EXTENDED_STATUSES,
      true,
    );
    assertNoSensitiveFixtureShapes(payload);
    return;
  }
  if (fileName === "designation-detail.json") {
    validateDesignationDetail(payload, fileName);
    assertNoSensitiveFixtureShapes(payload);
    return;
  }
  throw new Error(`Unsupported fixture file: ${fileName}`);
}
const SENSITIVE_KEY_NORMALIZED: ReadonlySet<string> = new Set<string>([
  "xapikey",
  "apikey",
  "servicekey",
  "refreshtoken",
  "jsessionid",
  "contactname",
  "address",
  "adrs",
  "tel",
  "phone",
  "fax",
  "mobile",
  "email",
  "phoneno",
  "mobileno",
  "faxno",
  "emailaddr",
]);
const URL_QUERY_FRAGMENT_CREDENTIAL_NAMES: ReadonlySet<string> =
  new Set<string>([
    "servicekey",
    "apikey",
    "key",
    "token",
    "accesstoken",
    "refreshtoken",
    "auth",
    "password",
    "secret",
    "session",
    "cookie",
  ]);
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_CREDENTIAL_REGEX =
  /[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/[^\/\s:@]+:[^\/\s@]+@/;
const SERVICE_KEY_VALUE_REGEX = /serviceKey\s*=/i;
const URL_QUERY_CREDENTIAL_REGEX = /[?&#]([A-Za-z0-9_\-]+)\s*=/g;
const REDACTED_URL_MARKER = "[REDACTED_URL]";
function isLikelyPhone(value: string): boolean {
  let s = value;
  s = s.replace(
    /\b(tel|telno|phone|phoneno|mobile|mobileno|fax|faxno)\s*[:=#]\s*/gi,
    "",
  );
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}\d{2}\d{2}$/.test(s)) {
    return false;
  }
  if (/^\d{1,2}-\d{1,2}-\d{1,2}$/.test(s)) {
    return false;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    return false;
  }
  if (/^\d{12}$/.test(s) || /^\d{14}$/.test(s)) {
    return false;
  }
  if (/^\d{1,3}(\.\d+)?%$/.test(s)) {
    return false;
  }
  const ccMatch = s.match(/^\+(\d{1,3})[\s\-]*/);
  let ccDigits = "";
  let rest = s;
  if (ccMatch) {
    ccDigits = ccMatch[1];
    rest = s.slice(ccMatch[0].length);
  }
  if (ccMatch) {
    const stripped = rest.replace(/[^0-9]/g, "");
    if (stripped.length === 0) {
      return false;
    }
    const total = ccDigits.length + stripped.length;
    if (total < 8 || total > 15) {
      return false;
    }
    return true;
  }
  const hasPlus = s.indexOf("+") !== -1;
  if (hasPlus) {
    return false;
  }
  if (rest.indexOf("-") === -1 && rest.indexOf(" ") === -1) {
    return false;
  }
  if (!/^[\d][\d\s\-]+\d$/.test(rest)) {
    return false;
  }
  const stripped = rest.replace(/[^0-9]/g, "");
  if (stripped.length < 9 || stripped.length > 11) {
    return false;
  }
  return true;
}
function checkUrlQueryCredentialNames(value: string, path: string): void {
  URL_QUERY_CREDENTIAL_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_QUERY_CREDENTIAL_REGEX.exec(value)) !== null) {
    const raw = m[1];
    const normalized = raw.toLowerCase().replace(/[_\-]/g, "");
    if (URL_QUERY_FRAGMENT_CREDENTIAL_NAMES.has(normalized)) {
      throw new Error(`URL query/fragment credential name at ${path}: ${raw}`);
    }
  }
}
export function assertNoSensitiveFixtureShapes(payload: unknown): void {
  const seen = new WeakSet<object>();
  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === "string") {
      if (SERVICE_KEY_VALUE_REGEX.test(value)) {
        throw new Error(`Sensitive serviceKey value at ${path}`);
      }
      if (URL_CREDENTIAL_REGEX.test(value)) {
        throw new Error(`URL with credentials at ${path}`);
      }
      if (value !== REDACTED_URL_MARKER) {
        checkUrlQueryCredentialNames(value, path);
      }
      if (EMAIL_REGEX.test(value)) {
        throw new Error(`Email-shaped value at ${path}`);
      }
      if (value !== REDACTED_URL_MARKER && isLikelyPhone(value)) {
        throw new Error(`Phone-shaped value at ${path}`);
      }
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    const obj = value as object;
    if (seen.has(obj)) {
      throw new Error(`Cycle detected at ${path}`);
    }
    seen.add(obj);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`);
      }
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    for (const key of Object.keys(value)) {
      const normalized = key.toLowerCase().replace(/[_\-]/g, "");
      if (SENSITIVE_KEY_NORMALIZED.has(normalized)) {
        throw new Error(`Sensitive key at ${path}.${key}`);
      }
      rejectIfSensitiveKey(key, PROJECTION_SAFE_OVERRIDE_KEYS);
      walk(value[key], `${path}.${key}`);
    }
  }
  walk(payload, "$");
}
