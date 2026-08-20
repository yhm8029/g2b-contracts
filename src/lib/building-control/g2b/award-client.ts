// src/lib/building-control/g2b/award-client.ts
import { createHash } from "node:crypto";
import { collectCompletePages, type CompletePage } from "./paging";
import type { NoticeProductRow, G2bFetchJson } from "./notice-client";
import { fetchG2bJson } from "../../g2b/http";
import { isAwardRegistrationTimestampInWindow } from "../probe-contract-guards";

export type { G2bFetchJson } from "./notice-client";

export interface AwardResultRow {
  noticeNo: string;
  noticeOrder: string;
  bidClassNo: string;
  rebidNo: string;
  registeredAt: string;
  finalAwardDate: string;
  status: "final";
  winnerBizNo: string;
  winnerName: string;
  amount: number | null;
  rate: number | null;
  providerResultIdentity: string;
  sourceHash: string;
  rawJson: string;
}

export interface UnresolvedAwardResultRow {
  noticeNo: string | null;
  noticeOrder: string | null;
  bidClassNo: string | null;
  rebidNo: string | null;
  registeredAt: string | null;
  finalAwardDate: string | null;
  status: "unresolved";
  unresolvedReason: "missing_final_award_date" | "invalid_award_row";
  winnerBizNo: string | null;
  winnerName: string | null;
  amount: number | null;
  rate: number | null;
  providerResultIdentity: string;
  sourceHash: string;
  rawJson: string;
}

export type AwardObservationRow = AwardResultRow | UnresolvedAwardResultRow;

export interface AwardRegistrationBatch {
  dateFrom: string;
  dateTo: string;
  totalCount: number;
  awards: AwardResultRow[];
  unresolvedAwards: UnresolvedAwardResultRow[];
  registrationWindowComplete: boolean;
}

export interface CollectAwardRegistrationInput {
  dateFrom: string;
  dateTo: string;
  pageSize: number;
  maxPages: number;
  fetchJson?: G2bFetchJson;
}

const G2B_DEFAULT_BASE = "https://apis.data.go.kr/1230000/as/ScsbidInfoService";
const G2B_OPERATION = "getScsbidListSttusThng";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) return n;
  }
  throw new Error(`invalid g2b field: ${fieldName}`);
}

function parseNonnegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  throw new Error(`invalid g2b field: ${fieldName}`);
}

function extractItems(body: Record<string, unknown>): unknown[] {
  const items = body["items"];
  if (items == null) return [];
  if (Array.isArray(items)) return items;
  if (typeof items === "object") {
    const inner = (items as Record<string, unknown>)["item"];
    if (inner == null) return [];
    if (Array.isArray(inner)) return inner;
    return [inner];
  }
  throw new Error("invalid g2b envelope: items");
}

function readStringField(row: Record<string, unknown>, field: string): string {
  const v = row[field];
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function validateIdentityField(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid final award field: ${field}`);
  }
  return value;
}

function parseRebidNo(raw: string): string {
  if (!/^\d+$/.test(raw)) {
    throw new Error("invalid rbidNo");
  }
  return raw;
}

function parseRegisteredAt(raw: string): string {
  const trimmed = raw.trim();
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(trimmed)
  ) {
    throw new Error("invalid registeredAt");
  }
  const year = Number(trimmed.slice(0, 4));
  const month = Number(trimmed.slice(5, 7));
  const day = Number(trimmed.slice(8, 10));
  const hour = Number(trimmed.slice(11, 13));
  const minute = Number(trimmed.slice(14, 16));
  const second = Number(trimmed.slice(17, 19));
  if (!isGregorianDateValid(year, month, day)) {
    throw new Error("invalid registeredAt");
  }
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new Error("invalid registeredAt");
  }
  return trimmed;
}

function isGregorianDateValid(
  year: number,
  month: number,
  day: number,
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 && isLeap ? 29 : monthDays[month - 1]!;
  return day <= maxDay;
}

function extractAuthoritativeDay(raw: string): {
  year: number;
  month: number;
  day: number;
} {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("invalid final award date");
  }
  let year: number;
  let month: number;
  let day: number;
  const dateOnly = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
  const dateTime =
    /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})$/;
  const compact = /^([0-9]{4})([0-9]{2})([0-9]{2})$/;
  const dateOnlyMatch = trimmed.match(dateOnly);
  const dateTimeMatch = trimmed.match(dateTime);
  const compactMatch = trimmed.match(compact);
  if (dateTimeMatch) {
    const hh = Number(dateTimeMatch[4]);
    const mm = Number(dateTimeMatch[5]);
    const ss = Number(dateTimeMatch[6]);
    if (!Number.isInteger(hh) || hh < 0 || hh > 23) {
      throw new Error("invalid final award date");
    }
    if (!Number.isInteger(mm) || mm < 0 || mm > 59) {
      throw new Error("invalid final award date");
    }
    if (!Number.isInteger(ss) || ss < 0 || ss > 59) {
      throw new Error("invalid final award date");
    }
    year = Number(dateTimeMatch[1]);
    month = Number(dateTimeMatch[2]);
    day = Number(dateTimeMatch[3]);
  } else if (dateOnlyMatch) {
    year = Number(dateOnlyMatch[1]);
    month = Number(dateOnlyMatch[2]);
    day = Number(dateOnlyMatch[3]);
  } else if (compactMatch) {
    year = Number(compactMatch[1]);
    month = Number(compactMatch[2]);
    day = Number(compactMatch[3]);
  } else {
    throw new Error("invalid final award date");
  }
  if (!isGregorianDateValid(year, month, day)) {
    throw new Error("invalid final award date");
  }
  return { year, month, day };
}

function parseFinalAwardDateRequired(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("invalid final award date");
  }
  const { year, month, day } = extractAuthoritativeDay(trimmed);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeBizNo(raw: string): string {
  if (typeof raw !== "string") {
    throw new Error("invalid winner biz no");
  }
  const stripped = raw.replace(/[-\s]/g, "");
  if (!/^[0-9]{10}$/.test(stripped)) {
    throw new Error("invalid winner biz no");
  }
  return stripped;
}

function parseOfficialAmountOrNull(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/,/g, "");
  if (cleaned === "") return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(cleaned)) {
    throw new Error("invalid final award amount");
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("invalid final award amount");
  }
  return n;
}

function parseOfficialRateOrNull(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/,/g, "");
  if (cleaned === "") return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(cleaned)) {
    throw new Error("invalid final award rate");
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("invalid final award rate");
  }
  return n;
}

interface ParsedObservationIdentity {
  noticeNo: string;
  noticeOrder: string;
  bidClassNo: string;
  rebidNo: string;
  registeredAt: string;
  providerResultIdentity: string;
  rawJson: string;
  sourceHash: string;
}

function parseCommonIdentityFields(
  row: Record<string, unknown>,
): ParsedObservationIdentity {
  const noticeNo = validateIdentityField(
    readStringField(row, "bidNtceNo"),
    "bidNtceNo",
  );
  const noticeOrder = validateIdentityField(
    readStringField(row, "bidNtceOrd"),
    "bidNtceOrd",
  );
  const bidClassNo = validateIdentityField(
    readStringField(row, "bidClsfcNo"),
    "bidClsfcNo",
  );
  const rebidNoRaw = readStringField(row, "rbidNo");
  const rebidNo = parseRebidNo(rebidNoRaw);
  const registeredAt = parseRegisteredAt(readStringField(row, "rgstDt"));

  const providerResultIdentity = `${noticeNo}|${noticeOrder}|${bidClassNo}|${rebidNo}`;
  const rawJson = JSON.stringify(row);
  const sourceHash = createHash("sha256").update(rawJson).digest("hex");

  return {
    noticeNo,
    noticeOrder,
    bidClassNo,
    rebidNo,
    registeredAt,
    providerResultIdentity,
    rawJson,
    sourceHash,
  };
}

function parseFinalObservation(row: Record<string, unknown>): AwardResultRow {
  const identity = parseCommonIdentityFields(row);

  const finalAwardDateRaw = readStringField(row, "fnlSucsfDate");
  const finalAwardDate = parseFinalAwardDateRequired(finalAwardDateRaw);

  const winnerName = validateIdentityField(
    readStringField(row, "bidwinnrNm"),
    "bidwinnrNm",
  );
  const winnerBizNoRaw = readStringField(row, "bidwinnrBizno");
  const winnerBizNo = normalizeBizNo(winnerBizNoRaw);

  const amount = parseOfficialAmountOrNull(readStringField(row, "sucsfbidAmt"));
  const rate = parseOfficialRateOrNull(readStringField(row, "sucsfbidRate"));

  return {
    noticeNo: identity.noticeNo,
    noticeOrder: identity.noticeOrder,
    bidClassNo: identity.bidClassNo,
    rebidNo: identity.rebidNo,
    registeredAt: identity.registeredAt,
    finalAwardDate,
    status: "final",
    winnerBizNo,
    winnerName,
    amount,
    rate,
    providerResultIdentity: identity.providerResultIdentity,
    sourceHash: identity.sourceHash,
    rawJson: identity.rawJson,
  };
}

function parseUnresolvedObservation(
  row: Record<string, unknown>,
  identity: ParsedObservationIdentity,
): UnresolvedAwardResultRow {
  const amount = parseOfficialAmountOrNull(readStringField(row, "sucsfbidAmt"));
  const rate = parseOfficialRateOrNull(readStringField(row, "sucsfbidRate"));

  const winnerName = validateIdentityField(
    readStringField(row, "bidwinnrNm"),
    "bidwinnrNm",
  );
  const winnerBizNo = normalizeBizNo(readStringField(row, "bidwinnrBizno"));

  return {
    noticeNo: identity.noticeNo,
    noticeOrder: identity.noticeOrder,
    bidClassNo: identity.bidClassNo,
    rebidNo: identity.rebidNo,
    registeredAt: identity.registeredAt,
    finalAwardDate: null,
    status: "unresolved",
    unresolvedReason: "missing_final_award_date",
    winnerBizNo,
    winnerName,
    amount,
    rate,
    providerResultIdentity: identity.providerResultIdentity,
    sourceHash: identity.sourceHash,
    rawJson: identity.rawJson,
  };
}

function parseOneObservation(raw: unknown): AwardObservationRow {
  if (raw == null || typeof raw !== "object") {
    throw new Error("invalid final award row");
  }
  const row = raw as Record<string, unknown>;
  const identity = parseCommonIdentityFields(row);
  const finalAwardDateRaw = readStringField(row, "fnlSucsfDate");
  if (finalAwardDateRaw.trim() === "") {
    return parseUnresolvedObservation(row, identity);
  }
  return parseFinalObservation(row);
}

function parseQuarantinedObservation(
  raw: unknown,
  pageNo: number,
  index: number,
): UnresolvedAwardResultRow {
  const rawJson = JSON.stringify(raw) ?? "null";
  const sourceHash = createHash("sha256").update(rawJson).digest("hex");
  const row = isRecord(raw) ? raw : null;
  const attempt = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  const identityField = (field: string): string | null =>
    row === null
      ? null
      : attempt(() =>
          validateIdentityField(readStringField(row, field), field),
        );
  const noticeNo = identityField("bidNtceNo");
  const noticeOrder = identityField("bidNtceOrd");
  const bidClassNo = identityField("bidClsfcNo");
  const rebidNo =
    row === null
      ? null
      : attempt(() => parseRebidNo(readStringField(row, "rbidNo")));
  const registeredAt =
    row === null
      ? null
      : attempt(() => parseRegisteredAt(readStringField(row, "rgstDt")));
  const finalAwardDateRaw =
    row === null ? "" : readStringField(row, "fnlSucsfDate");
  const finalAwardDate =
    finalAwardDateRaw.trim() === ""
      ? null
      : attempt(() => parseFinalAwardDateRequired(finalAwardDateRaw));
  const winnerBizNo =
    row === null
      ? null
      : attempt(() => normalizeBizNo(readStringField(row, "bidwinnrBizno")));
  const winnerName = identityField("bidwinnrNm");
  const amount =
    row === null
      ? null
      : attempt(() =>
          parseOfficialAmountOrNull(readStringField(row, "sucsfbidAmt")),
        );
  const rate =
    row === null
      ? null
      : attempt(() =>
          parseOfficialRateOrNull(readStringField(row, "sucsfbidRate")),
        );
  const providerResultIdentity =
    noticeNo !== null &&
    noticeOrder !== null &&
    bidClassNo !== null &&
    rebidNo !== null
      ? `${noticeNo}|${noticeOrder}|${bidClassNo}|${rebidNo}`
      : `quarantine:${pageNo}:${index}:${sourceHash}`;
  return {
    noticeNo,
    noticeOrder,
    bidClassNo,
    rebidNo,
    registeredAt,
    finalAwardDate,
    status: "unresolved",
    unresolvedReason: "invalid_award_row",
    winnerBizNo,
    winnerName,
    amount,
    rate,
    providerResultIdentity,
    sourceHash,
    rawJson,
  };
}

function grainKey(row: {
  noticeNo: string;
  noticeOrder: string;
  bidClassNo: string;
}): string {
  return `${row.noticeNo}|${row.noticeOrder}|${row.bidClassNo}`;
}

export function parseFinalAwardRows(
  rawRows: readonly unknown[],
): AwardResultRow[] {
  const out: AwardResultRow[] = [];
  const seen = new Set<string>();
  for (const raw of rawRows) {
    if (raw == null || typeof raw !== "object") {
      throw new Error("invalid final award row");
    }
    const row = raw as Record<string, unknown>;
    const finalAwardDateRaw = readStringField(row, "fnlSucsfDate");
    if (finalAwardDateRaw.trim() === "") {
      throw new Error("invalid final award row: unresolved");
    }
    const parsed = parseFinalObservation(row);
    const key = grainKey(parsed);
    if (seen.has(key)) {
      throw new Error("duplicate final award grain");
    }
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

export function parseAwardPage(
  payload: unknown,
  rawJson?: string,
): CompletePage<AwardObservationRow> {
  if (payload == null || typeof payload !== "object") {
    throw new Error("invalid g2b envelope");
  }
  const p = payload as Record<string, unknown>;
  const response = p["response"];
  if (response == null || typeof response !== "object") {
    throw new Error("invalid g2b envelope: response");
  }
  const responseObj = response as Record<string, unknown>;
  const header = responseObj["header"];
  const body = responseObj["body"];
  if (header == null || typeof header !== "object") {
    throw new Error("invalid g2b envelope: header");
  }
  if (body == null || typeof body !== "object") {
    throw new Error("invalid g2b envelope: body");
  }
  const headerObj = header as Record<string, unknown>;
  const bodyObj = body as Record<string, unknown>;
  const resultCode = String(headerObj["resultCode"] ?? "");
  if (resultCode !== "00" && resultCode !== "0") {
    throw new Error(`g2b error resultCode: ${resultCode}`);
  }

  const pageNo = parsePositiveInteger(bodyObj["pageNo"], "pageNo");
  const pageSize = parsePositiveInteger(bodyObj["numOfRows"], "numOfRows");
  const totalCount = parseNonnegativeInteger(
    bodyObj["totalCount"],
    "totalCount",
  );

  const items = extractItems(bodyObj);
  const parsedItems: AwardObservationRow[] = [];
  for (const [index, raw] of items.entries()) {
    try {
      parsedItems.push(parseOneObservation(raw));
    } catch {
      parsedItems.push(parseQuarantinedObservation(raw, pageNo, index));
    }
  }

  const finalRawJson = rawJson ?? JSON.stringify(payload);
  if (finalRawJson === "") {
    throw new Error("invalid g2b envelope: rawJson empty");
  }

  return {
    pageNo,
    pageSize,
    totalCount,
    items: parsedItems,
    rawJson: finalRawJson,
  };
}

export async function collectAwardRegistration(
  input: CollectAwardRegistrationInput,
): Promise<AwardRegistrationBatch> {
  const fetchJson: G2bFetchJson =
    input.fetchJson ??
    ((operation, params) => fetchG2bJson(G2B_DEFAULT_BASE, operation, params));

  const result = await collectCompletePages<AwardObservationRow>({
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    identity: (item) => item.providerResultIdentity,
    fetchPage: async (pageNo, pageSize) => {
      const payload = await fetchJson(G2B_OPERATION, {
        inqryDiv: "1",
        inqryBgnDt: input.dateFrom,
        inqryEndDt: input.dateTo,
        numOfRows: pageSize,
        pageNo,
      });
      return parseAwardPage(payload);
    },
  });

  const awards: AwardResultRow[] = [];
  const unresolvedAwards: UnresolvedAwardResultRow[] = [];
  const seenGrain = new Set<string>();
  let registrationWindowComplete = true;

  for (const item of result.items) {
    if (item.registeredAt === null) {
      registrationWindowComplete = false;
    }
    if (
      item.registeredAt !== null &&
      !isAwardRegistrationTimestampInWindow(
        item.registeredAt,
        input.dateFrom,
        input.dateTo,
      )
    ) {
      throw new Error("registeredAt outside requested window");
    }
    if (
      item.noticeNo !== null &&
      item.noticeOrder !== null &&
      item.bidClassNo !== null &&
      item.rebidNo !== null
    ) {
      const key = `${item.noticeNo}|${item.noticeOrder}|${item.bidClassNo}`;
      if (seenGrain.has(key)) {
        throw new Error("duplicate final award grain");
      }
      seenGrain.add(key);
    }
    if (item.status === "final") {
      awards.push(item);
    } else {
      unresolvedAwards.push(item);
    }
  }

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    totalCount: result.totalCount,
    awards,
    unresolvedAwards,
    registrationWindowComplete,
  };
}

export function joinAwardObservationToTargetProduct<
  T extends AwardObservationRow,
>(products: readonly NoticeProductRow[], observation: T): T {
  if (
    observation.noticeNo === null ||
    observation.noticeOrder === null ||
    observation.bidClassNo === null
  ) {
    throw new Error("award has no matching target product");
  }
  for (const product of products) {
    if (
      product.noticeNo === observation.noticeNo &&
      product.noticeOrder === observation.noticeOrder &&
      product.bidClassNo === observation.bidClassNo &&
      product.targetCode != null
    ) {
      return observation;
    }
  }
  throw new Error("award has no matching target product");
}

export function joinAwardToTargetProduct(
  products: readonly NoticeProductRow[],
  award: AwardResultRow,
): AwardResultRow {
  return joinAwardObservationToTargetProduct(products, award);
}

export function collapseNoticeWinner(
  rows: readonly AwardResultRow[],
): AwardResultRow {
  if (rows.length === 0) {
    throw new Error("different target-lot winners");
  }
  const first = rows[0]!;

  const referenceDay = extractAuthoritativeDay(first.finalAwardDate);
  for (const r of rows) {
    if (r.noticeNo !== first.noticeNo || r.noticeOrder !== first.noticeOrder) {
      throw new Error("different target-lot final dates");
    }
    if (r.winnerBizNo !== first.winnerBizNo) {
      throw new Error("different target-lot winners");
    }
    const day = extractAuthoritativeDay(r.finalAwardDate);
    if (
      day.year !== referenceDay.year ||
      day.month !== referenceDay.month ||
      day.day !== referenceDay.day
    ) {
      throw new Error("different target-lot final dates");
    }
  }

  let best = first;
  for (const r of rows) {
    const aNum = Number(best.bidClassNo);
    const bNum = Number(r.bidClassNo);
    const aFinite = Number.isFinite(aNum);
    const bFinite = Number.isFinite(bNum);
    if (aFinite && bFinite) {
      if ((bNum as number) < (aNum as number)) best = r;
    } else if (!aFinite && bFinite) {
      best = r;
    } else if (!aFinite && !bFinite) {
      if (r.bidClassNo < best.bidClassNo) best = r;
    }
  }
  return best;
}

function parseLowerBound(lowerBound: string): {
  year: number;
  month: number;
  day: number;
} {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(lowerBound)) {
    throw new Error("invalid lowerBound");
  }
  const year = Number(lowerBound.slice(0, 4));
  const month = Number(lowerBound.slice(5, 7));
  const day = Number(lowerBound.slice(8, 10));
  if (!isGregorianDateValid(year, month, day)) {
    throw new Error("invalid lowerBound");
  }
  return { year, month, day };
}

function dateToOrdinal(year: number, month: number, day: number): number {
  const y =
    (year - 1) * 365 +
    Math.floor((year - 1) / 4) -
    Math.floor((year - 1) / 100) +
    Math.floor((year - 1) / 400);
  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  let mDays = 0;
  for (let i = 0; i < month - 1; i++) mDays += monthDays[i]!;
  if (month > 2 && isLeap) mDays += 1;
  return y + mDays + (day - 1);
}

export function isFinalAwardOnOrAfter(
  row: AwardResultRow,
  lowerBound: string,
): boolean {
  const lb = parseLowerBound(lowerBound);
  const d = extractAuthoritativeDay(row.finalAwardDate);
  return (
    dateToOrdinal(d.year, d.month, d.day) >=
    dateToOrdinal(lb.year, lb.month, lb.day)
  );
}
