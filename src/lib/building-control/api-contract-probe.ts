import { assertNoSensitiveFixtureShapes } from "./probe-contract-guards";

export type G2bPageRecord = Readonly<Record<string, unknown>>;

type G2bPageHeader = Readonly<{
  resultCode: string;
  resultMsg?: string;
}>;

type G2bPageBody = Readonly<{
  pageNo: number;
  numOfRows: number;
  totalCount: number;
  items: ReadonlyArray<G2bPageRecord>;
}>;

type G2bResponseEnvelope = Readonly<{
  header: G2bPageHeader;
  body: G2bPageBody;
}>;

export type G2bPage = Readonly<{
  resultCode: string;
  resultMsg: string;
  pageNo: number;
  numOfRows: number;
  totalCount: number;
  items: ReadonlyArray<G2bPageRecord>;
}>;

const FORBIDDEN_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "serviceKey",
  "apiKey",
  "authorization",
  "cookie",
  "setCookie",
  "token",
  "accessToken",
  "secret",
  "password",
]);

const RECOGNIZED_PII_KEYS: ReadonlySet<string> = new Set([
  "bidwinnrBizno",
  "bzmnRegNo",
  "companyBizNo",
  "sourceBizNo",
]);

const RECOGNIZED_COMPANY_KEYS: ReadonlySet<string> = new Set([
  "bidwinnrNm",
  "entNm",
  "companyName",
  "sourceCompanyName",
]);

const RECOGNIZED_PERSON_KEYS: ReadonlySet<string> = new Set([
  "bidwinnrCeoNm",
  "personName",
  "sourcePersonName",
]);

const RECOGNIZED_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "etpmDsgnDmndNo",
  "requestId",
  "sessionId",
  "requestIdentity",
  "sessionIdentity",
  "dsgnDmndNo",
]);

const FORBIDDEN_REQUEST_KEY_NORMALIZED: ReadonlySet<string> = new Set(
  Array.from(FORBIDDEN_REQUEST_KEYS, normalizeForbiddenKey),
);
const RAW_REQUEST_IDENTITY_KEY_NORMALIZED: string =
  normalizeForbiddenKey("rawRequestIdentity");

const BUSINESS_SAFE_PATTERN: RegExp = /^\d{10}$/;
const BUSINESS_SAFE_ALIAS_START: number = 9000000001;
const BUSINESS_SAFE_ALIAS_END: number = 9000099999;
const BUSINESS_SAFE_ALIAS_MAX_COUNT: number =
  BUSINESS_SAFE_ALIAS_END - BUSINESS_SAFE_ALIAS_START + 1;
const COMPANY_SAFE_PATTERN: RegExp = /^Company \d{3}$/;
const PERSON_SAFE_PATTERN: RegExp = /^Person \d{3}$/;
const REQUEST_SAFE_PATTERN: RegExp = /^REQUEST-\d{3}$/;

const HTTP_URL_PATTERN: RegExp = /https?:\/\/[^\s"'<>]+/gi;
const SECRET_SENTINEL_PATTERN: RegExp = /secret_sentinel/i;

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const child = (value as Record<string, unknown>)[key];
    if (
      child !== null &&
      typeof child === "object" &&
      !Object.isFrozen(child)
    ) {
      deepFreeze(child);
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalInteger(value: unknown, field: string): number {
  let canonical: number;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new RangeError(`g2b ${field} must be a canonical integer string`);
    }
    canonical = Number(trimmed);
  } else if (typeof value === "number") {
    canonical = value;
  } else {
    throw new TypeError(`g2b ${field} must be an integer`);
  }
  if (
    !Number.isFinite(canonical) ||
    !Number.isSafeInteger(canonical) ||
    !Number.isInteger(canonical)
  ) {
    throw new TypeError(`g2b ${field} must be a finite safe integer`);
  }
  return canonical;
}

function isSyntheticBusinessAlias(value: string): boolean {
  if (!BUSINESS_SAFE_PATTERN.test(value)) {
    return false;
  }
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)) {
    return false;
  }
  return (
    normalized >= BUSINESS_SAFE_ALIAS_START &&
    normalized <= BUSINESS_SAFE_ALIAS_END
  );
}

function normalizeForbiddenKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isForbiddenRequestKey(key: string): boolean {
  return FORBIDDEN_REQUEST_KEY_NORMALIZED.has(normalizeForbiddenKey(key));
}

function readObject(payload: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(payload)) {
    throw new TypeError(`g2b ${path} must be an object`);
  }
  return payload;
}

export function parseG2bPage(
  payload: unknown,
  expectedPageNo: number,
): G2bPage {
  if (
    typeof expectedPageNo !== "number" ||
    !Number.isInteger(expectedPageNo) ||
    expectedPageNo <= 0
  ) {
    throw new RangeError("g2b expectedPageNo must be a positive integer");
  }

  const root = readObject(payload, "payload");
  const response = readObject(root["response"], "response");

  const headerRaw = readObject(response["header"], "response.header");
  const headerResultCode = headerRaw["resultCode"];
  if (typeof headerResultCode !== "string" || headerResultCode !== "00") {
    throw new RangeError(
      `g2b header.resultCode must be "00" (got ${String(headerResultCode)})`,
    );
  }
  const headerResultMsg =
    typeof headerRaw["resultMsg"] === "string" ? headerRaw["resultMsg"] : "";

  const bodyRaw = readObject(response["body"], "response.body");
  const pageNo = canonicalInteger(bodyRaw["pageNo"], "body.pageNo");
  const numOfRows = canonicalInteger(bodyRaw["numOfRows"], "body.numOfRows");
  const totalCount = canonicalInteger(bodyRaw["totalCount"], "body.totalCount");

  if (pageNo <= 0) {
    throw new RangeError("g2b body.pageNo must be positive");
  }
  if (numOfRows <= 0) {
    throw new RangeError("g2b body.numOfRows must be positive");
  }
  if (totalCount < 0) {
    throw new RangeError("g2b body.totalCount must be nonnegative");
  }
  if (pageNo !== expectedPageNo) {
    throw new RangeError(
      `g2b body.pageNo ${pageNo} does not match expected ${expectedPageNo}`,
    );
  }

  const itemsRaw = bodyRaw["items"];
  const isWrapperShape =
    isPlainObject(itemsRaw) &&
    Object.keys(itemsRaw).length === 1 &&
    Object.prototype.hasOwnProperty.call(itemsRaw, "item");

  const wrappedItems = isWrapperShape ? itemsRaw["item"] : itemsRaw;
  let itemsList: ReadonlyArray<unknown>;
  if (Array.isArray(wrappedItems)) {
    itemsList = wrappedItems;
  } else if (wrappedItems === undefined || wrappedItems === null) {
    itemsList = [];
  } else if (isPlainObject(wrappedItems)) {
    itemsList = [wrappedItems];
  } else {
    throw new TypeError(
      isWrapperShape
        ? "g2b body.items.item must be an array, object, or null"
        : "g2b body.items must be an array, object, or null",
    );
  }

  const offset = (pageNo - 1) * numOfRows;
  const expectedCount =
    totalCount === 0 ? 0 : Math.min(numOfRows, totalCount - offset);
  if (itemsList.length !== expectedCount) {
    throw new RangeError(
      `g2b body.items length ${itemsList.length} does not match expected ${expectedCount}`,
    );
  }

  const items: ReadonlyArray<G2bPageRecord> = itemsList.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new TypeError(`g2b body.items[${index}] must be a plain object`);
    }
    return deepFreeze({ ...item });
  });

  return deepFreeze({
    resultCode: headerResultCode,
    resultMsg: headerResultMsg,
    pageNo,
    numOfRows,
    totalCount,
    items,
  });
}

export function validateCollectedPages(
  pages: readonly G2bPage[],
): readonly G2bPageRecord[] {
  if (pages.length === 0) {
    throw new RangeError("g2b collected pages must not be empty");
  }

  const first = pages[0];
  if (first.pageNo !== 1) {
    throw new RangeError(
      `g2b collected pages must start at pageNo 1 (got ${first.pageNo})`,
    );
  }

  const totalCount = first.totalCount;
  const numOfRows = first.numOfRows;
  const expectedPageCount =
    totalCount === 0 ? 1 : Math.ceil(totalCount / numOfRows);
  if (pages.length !== expectedPageCount) {
    throw new RangeError(
      `g2b collected pages length ${pages.length} does not match expected ${expectedPageCount}`,
    );
  }

  const output: G2bPageRecord[] = [];
  let itemCount = 0;

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const expectedPageNo = index + 1;
    if (page.pageNo !== expectedPageNo) {
      throw new RangeError(
        `g2b collected pages are out of order at index ${index}: pageNo ${page.pageNo} (expected ${expectedPageNo})`,
      );
    }
    if (page.totalCount !== totalCount) {
      throw new RangeError(
        `g2b collected pages have mismatched totalCount at pageNo ${page.pageNo}: ${page.totalCount} (expected ${totalCount})`,
      );
    }
    if (page.numOfRows !== numOfRows) {
      throw new RangeError(
        `g2b collected pages have mismatched numOfRows at pageNo ${page.pageNo}: ${page.numOfRows} (expected ${numOfRows})`,
      );
    }
    itemCount += page.items.length;
    output.push(...page.items);
  }

  if (itemCount !== totalCount) {
    throw new RangeError(
      `g2b collected items count ${itemCount} does not match totalCount ${totalCount}`,
    );
  }

  return output;
}

export type IdentityDelta<T extends string | number> = Readonly<{
  missingFromServer: ReadonlyArray<T>;
  extraOnServer: ReadonlyArray<T>;
}>;

export function compareIdentitySets<T extends string | number>(
  serverIdentities: readonly T[],
  localIdentities: readonly T[],
): IdentityDelta<T> {
  const serverSet = new Set<T>(serverIdentities);
  const localSet = new Set<T>(localIdentities);

  const missingFromServer: T[] = [];
  for (const id of localSet) {
    if (!serverSet.has(id)) {
      missingFromServer.push(id);
    }
  }
  missingFromServer.sort((a, b) => String(a).localeCompare(String(b), "en"));

  const extraOnServer: T[] = [];
  for (const id of serverSet) {
    if (!localSet.has(id)) {
      extraOnServer.push(id);
    }
  }
  extraOnServer.sort((a, b) => String(a).localeCompare(String(b), "en"));

  return { missingFromServer, extraOnServer };
}

function makePseudonym(prefix: string, index: number): string {
  if (prefix === "biz") {
    if (
      index <= 0 ||
      !Number.isSafeInteger(index) ||
      index > BUSINESS_SAFE_ALIAS_MAX_COUNT
    ) {
      throw new RangeError("g2b synthetic business alias space exhausted");
    }
    return String(BUSINESS_SAFE_ALIAS_START + index - 1);
  }
  if (prefix === "company" || prefix === "person") {
    return `${prefix[0].toUpperCase()}${prefix.slice(1)} ${String(index).padStart(3, "0")}`;
  }
  if (prefix === "request") {
    return `REQUEST-${String(index).padStart(3, "0")}`;
  }
  throw new Error(`unhandled pseudonym prefix: ${prefix}`);
}

function buildPseudonymRegistry(): {
  pii: Map<string, string>;
  company: Map<string, string>;
  person: Map<string, string>;
  request: Map<string, string>;
} {
  return {
    pii: new Map<string, string>(),
    company: new Map<string, string>(),
    person: new Map<string, string>(),
    request: new Map<string, string>(),
  };
}

function pseudonymizeValue(
  key: string,
  value: string,
  registry: ReturnType<typeof buildPseudonymRegistry>,
  counters: { pii: number; company: number; person: number; request: number },
): string {
  if (RECOGNIZED_PII_KEYS.has(key)) {
    let mapped = registry.pii.get(value);
    if (mapped === undefined) {
      counters.pii += 1;
      mapped = makePseudonym("biz", counters.pii);
      registry.pii.set(value, mapped);
    }
    return mapped;
  }
  if (RECOGNIZED_COMPANY_KEYS.has(key)) {
    let mapped = registry.company.get(value);
    if (mapped === undefined) {
      counters.company += 1;
      mapped = makePseudonym("company", counters.company);
      registry.company.set(value, mapped);
    }
    return mapped;
  }
  if (RECOGNIZED_PERSON_KEYS.has(key)) {
    let mapped = registry.person.get(value);
    if (mapped === undefined) {
      counters.person += 1;
      mapped = makePseudonym("person", counters.person);
      registry.person.set(value, mapped);
    }
    return mapped;
  }
  if (RECOGNIZED_REQUEST_KEYS.has(key)) {
    let mapped = registry.request.get(value);
    if (mapped === undefined) {
      counters.request += 1;
      mapped = makePseudonym("request", counters.request);
      registry.request.set(value, mapped);
    }
    return mapped;
  }
  return value;
}

function redactUrlsInString(value: string): string {
  return value.replace(HTTP_URL_PATTERN, "[REDACTED_URL]");
}

function sanitizeInternal(
  value: unknown,
  seen: Map<object, true>,
  registry: ReturnType<typeof buildPseudonymRegistry>,
  counters: { pii: number; company: number; person: number; request: number },
): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (typeof value === "bigint") {
    throw new Error("probe fixture contains bigint");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("probe fixture contains nonfinite number");
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return redactUrlsInString(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error("probe fixture contains a cycle");
    }
    seen.set(value, true);
    try {
      const out: unknown[] = [];
      for (const item of value) {
        const sanitized = sanitizeInternal(item, seen, registry, counters);
        if (typeof sanitized !== "undefined") {
          out.push(sanitized);
        }
      }
      return out;
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === "object") {
    if (seen.has(value as object)) {
      throw new Error("probe fixture contains a cycle");
    }
    seen.set(value as object, true);
    try {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (
          normalizeForbiddenKey(key) === RAW_REQUEST_IDENTITY_KEY_NORMALIZED
        ) {
          continue;
        }
        if (isForbiddenRequestKey(key)) {
          continue;
        }
        const sanitizedChild = sanitizeInternal(
          child,
          seen,
          registry,
          counters,
        );
        if (typeof sanitizedChild === "undefined") {
          continue;
        }
        if (
          typeof sanitizedChild === "string" &&
          RECOGNIZED_PII_KEYS.has(key)
        ) {
          out[key] = pseudonymizeValue(key, sanitizedChild, registry, counters);
          continue;
        }
        if (
          typeof sanitizedChild === "string" &&
          RECOGNIZED_COMPANY_KEYS.has(key)
        ) {
          out[key] = pseudonymizeValue(key, sanitizedChild, registry, counters);
          continue;
        }
        if (
          typeof sanitizedChild === "string" &&
          RECOGNIZED_PERSON_KEYS.has(key)
        ) {
          out[key] = pseudonymizeValue(key, sanitizedChild, registry, counters);
          continue;
        }
        if (
          typeof sanitizedChild === "string" &&
          RECOGNIZED_REQUEST_KEYS.has(key)
        ) {
          out[key] = pseudonymizeValue(key, sanitizedChild, registry, counters);
          continue;
        }
        out[key] = sanitizedChild;
      }
      return out;
    } finally {
      seen.delete(value as object);
    }
  }
  return undefined;
}

export function sanitizeProbeFixture<T>(input: T): T {
  const seen = new Map<object, true>();
  const registry = buildPseudonymRegistry();
  const counters = { pii: 0, company: 0, person: 0, request: 0 };
  const result = sanitizeInternal(input, seen, registry, counters);
  return result as T;
}

function findForbiddenKey(
  value: unknown,
  seen: Map<object, true>,
): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  if (seen.has(value as object)) {
    return undefined;
  }
  seen.set(value as object, true);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findForbiddenKey(item, seen);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (normalizeForbiddenKey(key) === RAW_REQUEST_IDENTITY_KEY_NORMALIZED) {
        return "rawRequestIdentity";
      }
      if (isForbiddenRequestKey(key)) {
        return key;
      }
      const found = findForbiddenKey(child, seen);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  } finally {
    seen.delete(value as object);
  }
}

function looksLikeRawCredentialUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  return /serviceKey|apiKey|authorization|token|secret|password|cookie|session/i.test(
    value,
  );
}

function valueContainsSecretSentinel(
  value: unknown,
  seen: Map<object, true>,
): boolean {
  if (typeof value === "string") {
    return SECRET_SENTINEL_PATTERN.test(value);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value as object)) {
    return false;
  }
  seen.set(value as object, true);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (valueContainsSecretSentinel(item, seen)) {
          return true;
        }
      }
      return false;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (valueContainsSecretSentinel(child, seen)) {
        return true;
      }
    }
    return false;
  } finally {
    seen.delete(value as object);
  }
}

function containsRawUrlWithCredentials(
  value: unknown,
  seen: Map<object, true>,
): boolean {
  if (typeof value === "string") {
    return looksLikeRawCredentialUrl(value);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value as object)) {
    return false;
  }
  seen.set(value as object, true);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (containsRawUrlWithCredentials(item, seen)) {
          return true;
        }
      }
      return false;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (containsRawUrlWithCredentials(child, seen)) {
        return true;
      }
    }
    return false;
  } finally {
    seen.delete(value as object);
  }
}

function checkAssignmentLikeStrings(
  value: unknown,
  seen: Map<object, true>,
): boolean {
  if (typeof value === "string") {
    if (/(?:^|[;,\\s])Bearer\s+/i.test(value)) {
      return true;
    }
    if (/(?:^|[;,\\s])(?:session|cookie)=/i.test(value)) {
      return true;
    }
    return false;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value as object)) {
    return false;
  }
  seen.set(value as object, true);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (checkAssignmentLikeStrings(item, seen)) {
          return true;
        }
      }
      return false;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (checkAssignmentLikeStrings(child, seen)) {
        return true;
      }
    }
    return false;
  } finally {
    seen.delete(value as object);
  }
}

function containsRawPii(
  value: unknown,
  seen: Map<object, true>,
): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  if (seen.has(value as object)) {
    return undefined;
  }
  seen.set(value as object, true);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = containsRawPii(item, seen);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (RECOGNIZED_PII_KEYS.has(key)) {
        if (typeof child === "string" && !isSyntheticBusinessAlias(child)) {
          return key;
        }
      } else if (RECOGNIZED_COMPANY_KEYS.has(key)) {
        if (typeof child === "string" && !COMPANY_SAFE_PATTERN.test(child)) {
          return key;
        }
      } else if (RECOGNIZED_PERSON_KEYS.has(key)) {
        if (typeof child === "string" && !PERSON_SAFE_PATTERN.test(child)) {
          return key;
        }
      } else if (RECOGNIZED_REQUEST_KEYS.has(key)) {
        if (typeof child === "string" && !REQUEST_SAFE_PATTERN.test(child)) {
          return key;
        }
      }
      const found = containsRawPii(child, seen);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  } finally {
    seen.delete(value as object);
  }
}

function findCycle(value: unknown, seen: Map<object, true>): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value as object)) {
    return true;
  }
  seen.set(value as object, true);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (findCycle(item, seen)) {
          return true;
        }
      }
      return false;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (findCycle(child, seen)) {
        return true;
      }
    }
    return false;
  } finally {
    seen.delete(value as object);
  }
}

function findDisallowedScalar(
  value: unknown,
  seen: Map<object, true>,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value === "bigint") {
    return "bigint";
  }
  if (typeof value === "function") {
    return "function";
  }
  if (typeof value === "symbol") {
    return "symbol";
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return "nonfinite";
  }
  if (typeof value === "undefined") {
    return "undefined";
  }
  if (typeof value !== "object") {
    return undefined;
  }
  if (seen.has(value as object)) {
    return undefined;
  }
  seen.set(value as object, true);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findDisallowedScalar(item, seen);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      const found = findDisallowedScalar(child, seen);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  } finally {
    seen.delete(value as object);
  }
}

export function assertProbeFixtureSafe(value: unknown): void {
  assertNoSensitiveFixtureShapes(value);

  if (value === null || typeof value !== "object") {
    return;
  }

  const forbidden = findForbiddenKey(value, new Map<object, true>());
  if (forbidden !== undefined) {
    throw new Error(`probe fixture contains forbidden key: ${forbidden}`);
  }

  if (containsRawUrlWithCredentials(value, new Map<object, true>())) {
    throw new Error(
      "probe fixture contains a raw URL with embedded credentials",
    );
  }

  if (valueContainsSecretSentinel(value, new Map<object, true>())) {
    throw new Error("probe fixture contains SECRET_SENTINEL");
  }

  if (checkAssignmentLikeStrings(value, new Map<object, true>())) {
    throw new Error(
      "probe fixture contains a Bearer/cookie/session assignment string",
    );
  }

  const rawPiiKey = containsRawPii(value, new Map<object, true>());
  if (rawPiiKey !== undefined) {
    throw new Error(
      `probe fixture contains unsanitized recognized value at key: ${rawPiiKey}`,
    );
  }

  if (findCycle(value, new Map<object, true>())) {
    throw new Error("probe fixture contains a cycle");
  }

  const disallowed = findDisallowedScalar(value, new Map<object, true>());
  if (disallowed !== undefined) {
    throw new Error(`probe fixture contains disallowed scalar: ${disallowed}`);
  }
}
