import { TARGET_DETAIL_CODE, TARGET_PARENT_CODE } from "./constants";

const ASCII_WHITESPACE = /[\t\n\r\v\f ]/;
const SEPARATOR_PATTERN = /^[0-9]([ \t-]*[0-9])*$/;

function isAsciiDigit(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x39;
}

function isFullWidthDigit(codePoint: number): boolean {
  return codePoint >= 0xff10 && codePoint <= 0xff19;
}

function fullWidthToAsciiDigit(ch: string): string {
  const code = ch.codePointAt(0);
  if (code === undefined || !isFullWidthDigit(code)) {
    return ch;
  }
  return String.fromCodePoint(code - 0xff10 + 0x30);
}

function nfkc(input: string): string {
  if (typeof (input as { normalize?: unknown }).normalize === "function") {
    return input.normalize("NFKC");
  }
  return input;
}

export function normalizeProductCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = nfkc(trimmed);

  if (normalized.includes("e") || normalized.includes("E")) {
    return null;
  }
  if (normalized.includes(".")) {
    return null;
  }
  if (normalized.includes("+") || normalized.includes("-")) {
    if (!SEPARATOR_PATTERN.test(normalized)) {
      return null;
    }
  }

  let digitBuffer = "";
  for (const ch of normalized) {
    const code = ch.codePointAt(0);
    if (code === undefined) {
      return null;
    }
    if (isAsciiDigit(code)) {
      digitBuffer += ch;
    } else if (isFullWidthDigit(code)) {
      digitBuffer += fullWidthToAsciiDigit(ch);
    } else if (ch === "-" || ASCII_WHITESPACE.test(ch)) {
      continue;
    } else {
      return null;
    }
  }

  if (digitBuffer.length !== 8 && digitBuffer.length !== 10) {
    return null;
  }

  return digitBuffer;
}

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

export function matchesTargetProduct(input: {
  parentCode: unknown;
  detailCode: unknown;
}): boolean {
  if (isBlank(input.detailCode)) {
    const parent = normalizeProductCode(input.parentCode);
    return parent === TARGET_PARENT_CODE;
  }

  const detail = normalizeProductCode(input.detailCode);
  if (detail === null) {
    return false;
  }
  return detail === TARGET_DETAIL_CODE;
}

function requireNonBlankString(field: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} must not be blank`);
  }
  return trimmed;
}

export function buildAwardSourceKey(input: {
  noticeNo: string;
  noticeOrder: string;
  bidClassNo: string;
  rebidNo: string;
}): string {
  const noticeNo = requireNonBlankString("noticeNo", input.noticeNo);
  const noticeOrder = requireNonBlankString("noticeOrder", input.noticeOrder);
  const bidClassNo = requireNonBlankString("bidClassNo", input.bidClassNo);
  const rebidNo = requireNonBlankString("rebidNo", input.rebidNo);

  return [noticeNo, noticeOrder, bidClassNo, rebidNo].join("|");
}
