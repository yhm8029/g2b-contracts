// src/lib/building-control/g2b/designation-list-client.ts
// G2B designation list client. No network, no global state.
// TypeScript 5.7. Pure functions. Deterministic ordering. ASCII only.

import { createHash } from "node:crypto";
import {
  collectCompletePages,
  type CollectResult,
  type CompletePage,
} from "@/lib/building-control/g2b/paging";

// ----------------------------- Types -----------------------------------------

export type DesignationStatus =
  "" | "\uC720\uD6A8" | "\uB9CC\uB8CC" | "\uD6A8\uB825\uC815\uC9C0";

export interface DesignationListRequest {
  readonly applVldYn: string;
  readonly currentPage: number;
  readonly recordCountPerPage: number;
}

export interface DesignationListFact {
  readonly applVldYn: string;
  readonly bzmnRegNo: string;
  readonly dsgnBgngYmd: string;
  readonly dsgnEndYmd: string | null;
  readonly dsgnExtsYmd: string;
  readonly entNm: string;
  readonly etpmDsgnCrfcNo: string;
  readonly etpmDsgnDmndNo: string;
  readonly dsgnDmndChgOrd: string;
  readonly etpsSqno: string;
  readonly productName: string;
  readonly companyName: string;
  readonly status: DesignationStatus;
  readonly listRawJson: string;
  readonly schemaVersion: 1;
  readonly sourceIdentity: string;
}

export interface DesignationListPage {
  readonly schemaVersion: 1;
  readonly status: "ok" | "error";
  readonly totalCount: number;
  readonly items: readonly DesignationListFact[];
  readonly rawJson: string;
  readonly request: DesignationListRequest;
  readonly pageNo: number;
  readonly pageSize: number;
}

export interface ParseDesignationListInput {
  readonly payload: unknown;
  readonly rawJson: string;
  readonly request: DesignationListRequest;
}

export interface CollectAllDesignationFactsInput {
  readonly pageSize: number;
  readonly maxPages: number;
  readonly fetchPage: (
    pageNo: number,
    pageSize: number,
  ) => Promise<CompletePage<DesignationListFact>>;
}

export interface CollectAllDesignationFactsResult {
  readonly pageCount: number;
  readonly totalCount: number;
  readonly items: readonly DesignationListFact[];
  readonly rawPages: readonly string[];
  readonly coverageHash: string;
}

export interface ReconcileDesignationStatusUnionInput {
  readonly allCount: number;
  readonly snapshot: {
    readonly "\uC720\uD6A8": number;
    readonly "\uB9CC\uB8CC": number;
    readonly "\uD6A8\uB825\uC815\uC9C0": number;
  };
  readonly items: readonly DesignationListFact[];
}

export interface ReconcileDesignationStatusUnionResult {
  readonly allCount: number;
  readonly buckets: {
    readonly "": number;
    readonly "\uC720\uD6A8": number;
    readonly "\uB9CC\uB8CC": number;
    readonly "\uD6A8\uB825\uC815\uC9C0": number;
  };
  readonly snapshot: {
    readonly "\uC720\uD6A8": number;
    readonly "\uB9CC\uB8CC": number;
    readonly "\uD6A8\uB825\uC815\uC9C0": number;
  };
}

export interface AssertNoDesignationContractionInput {
  readonly previous: readonly DesignationListFact[];
  readonly current: readonly DesignationListFact[];
}

// ------------------------- Status normalization ------------------------------

const EXACT_STATUSES: readonly DesignationStatus[] = Object.freeze([
  "",
  "\uC720\uD6A8",
  "\uB9CC\uB8CC",
  "\uD6A8\uB825\uC815\uC9C0",
]);

function normalizeStatus(applVldYn: unknown): DesignationStatus {
  if (typeof applVldYn !== "string") {
    throw new Error("designation-list-client: applVldYn must be a string");
  }
  for (const s of EXACT_STATUSES) {
    if (s === applVldYn) {
      return s;
    }
  }
  throw new Error(
    "designation-list-client: applVldYn must be one of '', '" +
      "\uC720\uD6A8" +
      "', '" +
      "\uB9CC\uB8CC" +
      "', '" +
      "\uD6A8\uB825\uC815\uC9C0" +
      "'",
  );
}

// ----------------------------- Helpers ---------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    result[key] = canonicalize(obj[key]);
  }
  return result;
}

function canonicalDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function requireStringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") {
    throw new Error(
      "designation-list-client: missing required string field '" + key + "'",
    );
  }
  return v;
}

function asInteger(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(
      "designation-list-client: " + label + " must be an integer",
    );
  }
  return v;
}

export function designationListIdentity(args: {
  etpmDsgnCrfcNo: string;
  etpmDsgnDmndNo: string;
  dsgnDmndChgOrd: string;
  etpsSqno: string;
}): string {
  return [
    args.etpmDsgnCrfcNo,
    args.etpmDsgnDmndNo,
    args.dsgnDmndChgOrd,
    args.etpsSqno,
  ].join("|");
}

// ----------------------- Date normalization ----------------------------------

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    return 0;
  }
  const t = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return (t[month - 1] ?? 0) as number;
}

function normalizeDateField(args: {
  value: unknown;
  key: string;
  allowBlank: boolean;
}): string {
  if (typeof args.value !== "string") {
    throw new Error(
      "designation-list-client: missing required string field '" +
        args.key +
        "'",
    );
  }
  if (args.value.length === 0) {
    if (args.allowBlank) {
      return "";
    }
    throw new Error(
      "designation-list-client: '" + args.key + "' must not be blank",
    );
  }
  const s = args.value;
  let yearStr: string;
  let monthStr: string;
  let dayStr: string;
  if (s.length === 8 && /^[0-9]{8}$/.test(s)) {
    yearStr = s.slice(0, 4);
    monthStr = s.slice(4, 6);
    dayStr = s.slice(6, 8);
  } else if (s.length === 10 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) {
    const parts = s.split("-");
    yearStr = parts[0] ?? "";
    monthStr = parts[1] ?? "";
    dayStr = parts[2] ?? "";
  } else {
    throw new Error(
      "designation-list-client: '" +
        args.key +
        "' must be YYYYMMDD or YYYY-MM-DD",
    );
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error(
      "designation-list-client: '" +
        args.key +
        "' is not a valid calendar date",
    );
  }
  const dim = daysInMonth(year, month);
  if (dim === 0 || day < 1 || day > dim) {
    throw new Error(
      "designation-list-client: '" +
        args.key +
        "' is not a valid calendar date",
    );
  }
  const mm = month < 10 ? "0" + String(month) : String(month);
  const dd = day < 10 ? "0" + String(day) : String(day);
  return yearStr + "-" + mm + "-" + dd;
}

// ----------------------------- Parsing ---------------------------------------

function requireNonBlankStringField(
  obj: Record<string, unknown>,
  key: string,
): string {
  const v = requireStringField(obj, key);
  if (v.length === 0) {
    throw new Error("designation-list-client: '" + key + "' must not be blank");
  }
  return v;
}

function requireBzmnRegNo(obj: Record<string, unknown>): string {
  const v = requireStringField(obj, "bzmnRegNo");
  if (!/^[0-9]{10}$/.test(v)) {
    throw new Error(
      "designation-list-client: 'bzmnRegNo' must be a 10-digit number",
    );
  }
  return v;
}

function normalizeEndDateField(args: {
  value: unknown;
  key: string;
}): string | null {
  if (typeof args.value !== "string") {
    throw new Error(
      "designation-list-client: missing required string field '" +
        args.key +
        "'",
    );
  }
  if (args.value.length === 0) {
    return null;
  }
  return normalizeDateField({
    value: args.value,
    key: args.key,
    allowBlank: false,
  });
}

function parseRow(row: Record<string, unknown>): {
  bzmnRegNo: string;
  dsgnBgngYmd: string;
  dsgnEndYmd: string | null;
  dsgnExtsYmd: string;
  entNm: string;
  etpmDsgnCrfcNo: string;
  etpmDsgnDmndNo: string;
  dsgnDmndChgOrd: string;
  etpsSqno: string;
  itemCfnm: string;
  applVldYn: string;
  totCnt: number;
} {
  const bzmnRegNo = requireBzmnRegNo(row);
  const entNm = requireNonBlankStringField(row, "entNm");
  const etpmDsgnCrfcNo = requireNonBlankStringField(row, "etpmDsgnCrfcNo");
  const etpmDsgnDmndNo = requireNonBlankStringField(row, "etpmDsgnDmndNo");
  const dsgnDmndChgOrd = requireNonBlankStringField(row, "dsgnDmndChgOrd");
  const etpsSqno = requireNonBlankStringField(row, "etpsSqno");
  const itemCfnm = requireNonBlankStringField(row, "itemCfnm");
  const applVldYn = requireStringField(row, "applVldYn");
  const totCnt = asInteger(row["totCnt"], "totCnt");
  if (totCnt < 0) {
    throw new Error(
      "designation-list-client: totCnt must be a non-negative integer",
    );
  }
  return {
    bzmnRegNo,
    dsgnBgngYmd: normalizeDateField({
      value: row["dsgnBgngYmd"],
      key: "dsgnBgngYmd",
      allowBlank: false,
    }),
    dsgnEndYmd: normalizeEndDateField({
      value: row["dsgnEndYmd"],
      key: "dsgnEndYmd",
    }),
    dsgnExtsYmd: normalizeDateField({
      value: row["dsgnExtsYmd"],
      key: "dsgnExtsYmd",
      allowBlank: true,
    }),
    entNm,
    etpmDsgnCrfcNo,
    etpmDsgnDmndNo,
    dsgnDmndChgOrd,
    etpsSqno,
    itemCfnm,
    applVldYn,
    totCnt,
  };
}

export function parseDesignationListResponse(
  input: ParseDesignationListInput,
): DesignationListPage {
  if (typeof input.rawJson !== "string" || input.rawJson.length === 0) {
    throw new Error(
      "designation-list-client: rawJson must be a non-empty string",
    );
  }
  if (!isObject(input.payload)) {
    throw new Error("designation-list-client: payload must be an object");
  }
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(input.rawJson);
  } catch {
    throw new Error("designation-list-client: rawJson is not valid JSON");
  }
  if (!isObject(parsedRaw)) {
    throw new Error(
      "designation-list-client: parsed rawJson must be an object",
    );
  }
  if (!canonicalDeepEqual(parsedRaw, input.payload)) {
    throw new Error("designation-list-client: payload does not match rawJson");
  }
  const payload = parsedRaw;

  const errorCode = asInteger(payload["ErrorCode"], "ErrorCode");
  if (errorCode !== 0) {
    throw new Error(
      "designation-list-client: non-zero ErrorCode: " + String(errorCode),
    );
  }

  const rows = payload["dlElpdtSlctnSttusL"];
  if (!Array.isArray(rows)) {
    throw new Error(
      "designation-list-client: dlElpdtSlctnSttusL must be an array",
    );
  }

  if (typeof input.request !== "object" || input.request === null) {
    throw new Error("designation-list-client: request must be an object");
  }
  const req = input.request;
  if (
    typeof req.currentPage !== "number" ||
    typeof req.recordCountPerPage !== "number" ||
    typeof req.applVldYn !== "string"
  ) {
    throw new Error("designation-list-client: request is malformed");
  }
  normalizeStatus(req.applVldYn);

  const items: DesignationListFact[] = [];
  for (const row of rows) {
    if (!isObject(row)) {
      throw new Error("designation-list-client: row must be an object");
    }
    const parsed = parseRow(row);
    const status = normalizeStatus(parsed.applVldYn);
    if (req.applVldYn && status !== req.applVldYn) {
      throw new Error("designation-list-client: status filter mismatch");
    }
    const sourceIdentity = designationListIdentity({
      etpmDsgnCrfcNo: parsed.etpmDsgnCrfcNo,
      etpmDsgnDmndNo: parsed.etpmDsgnDmndNo,
      dsgnDmndChgOrd: parsed.dsgnDmndChgOrd,
      etpsSqno: parsed.etpsSqno,
    });
    items.push({
      applVldYn: parsed.applVldYn,
      bzmnRegNo: parsed.bzmnRegNo,
      dsgnBgngYmd: parsed.dsgnBgngYmd,
      dsgnEndYmd: parsed.dsgnEndYmd,
      dsgnExtsYmd: parsed.dsgnExtsYmd,
      entNm: parsed.entNm,
      etpmDsgnCrfcNo: parsed.etpmDsgnCrfcNo,
      etpmDsgnDmndNo: parsed.etpmDsgnDmndNo,
      dsgnDmndChgOrd: parsed.dsgnDmndChgOrd,
      etpsSqno: parsed.etpsSqno,
      productName: parsed.itemCfnm,
      companyName: parsed.entNm,
      status,
      listRawJson: input.rawJson,
      schemaVersion: 1 as const,
      sourceIdentity,
    });
  }

  let totalCount = 0;
  if (rows.length > 0) {
    const first = rows[0] as Record<string, unknown>;
    const v = first["totCnt"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(
        "designation-list-client: totCnt on first row is required",
      );
    }
    totalCount = v;
    for (const r of rows) {
      if (!isObject(r)) {
        continue;
      }
      const tc = r["totCnt"];
      if (typeof tc !== "number" || !Number.isInteger(tc) || tc < 0) {
        throw new Error(
          "designation-list-client: totCnt must be a non-negative integer",
        );
      }
      if (tc !== totalCount) {
        throw new Error(
          "designation-list-client: totCnt is not consistent across rows",
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    status: "ok",
    totalCount,
    items: Object.freeze(items.slice()) as readonly DesignationListFact[],
    rawJson: input.rawJson,
    request: {
      applVldYn: req.applVldYn,
      currentPage: req.currentPage,
      recordCountPerPage: req.recordCountPerPage,
    },
    pageNo: req.currentPage,
    pageSize: req.recordCountPerPage,
  };
}

// ----------------------- Collection + Coverage hash --------------------------

export async function collectAllDesignationFacts(
  input: CollectAllDesignationFactsInput,
): Promise<CollectAllDesignationFactsResult> {
  const result: CollectResult<DesignationListFact> =
    await collectCompletePages<DesignationListFact>({
      pageSize: input.pageSize,
      maxPages: input.maxPages,
      fetchPage: input.fetchPage,
      identity: (item) => item.sourceIdentity,
    });

  const coverageHash = createHash("sha256")
    .update(String(result.totalCount))
    .update("|");
  for (const page of result.rawPages) {
    coverageHash.update(page);
    coverageHash.update("\u001e");
  }
  const finalHash = coverageHash.digest("hex");

  return {
    pageCount: result.pageCount,
    totalCount: result.totalCount,
    items: result.items,
    rawPages: result.rawPages,
    coverageHash: finalHash,
  };
}

// ---------------------- Reconciliation / Contraction -------------------------

export function reconcileDesignationStatusUnion(
  input: ReconcileDesignationStatusUnionInput,
): ReconcileDesignationStatusUnionResult {
  if (!Number.isInteger(input.allCount) || input.allCount < 0) {
    throw new Error(
      "designation-list-client: allCount must be a non-negative integer",
    );
  }
  if (input.items.length !== input.allCount) {
    throw new Error(
      "designation-list-client: items length does not equal allCount",
    );
  }

  const snapValid = input.snapshot["\uC720\uD6A8"];
  const snapExpired = input.snapshot["\uB9CC\uB8CC"];
  const snapSuspended = input.snapshot["\uD6A8\uB825\uC815\uC9C0"];
  if (
    !Number.isInteger(snapValid) ||
    snapValid < 0 ||
    !Number.isInteger(snapExpired) ||
    snapExpired < 0 ||
    !Number.isInteger(snapSuspended) ||
    snapSuspended < 0
  ) {
    throw new Error(
      "designation-list-client: snapshot counts must be non-negative integers",
    );
  }

  let countBlank = 0;
  let countValid = 0;
  let countExpired = 0;
  let countSuspended = 0;
  for (const item of input.items) {
    switch (item.status) {
      case "":
        countBlank++;
        break;
      case "\uC720\uD6A8":
        countValid++;
        break;
      case "\uB9CC\uB8CC":
        countExpired++;
        break;
      case "\uD6A8\uB825\uC815\uC9C0":
        countSuspended++;
        break;
      default:
        throw new Error("designation-list-client: item has unknown status");
    }
  }

  if (countValid !== snapValid) {
    throw new Error(
      "designation-list-client: \uC720\uD6A8 snapshot (" +
        String(snapValid) +
        ") does not match bucket (" +
        String(countValid) +
        ")",
    );
  }
  if (countExpired !== snapExpired) {
    throw new Error(
      "designation-list-client: \uB9CC\uB8CC snapshot (" +
        String(snapExpired) +
        ") does not match bucket (" +
        String(countExpired) +
        ")",
    );
  }
  if (countSuspended !== snapSuspended) {
    throw new Error(
      "designation-list-client: \uD6A8\uB825\uC815\uC9C0 snapshot (" +
        String(snapSuspended) +
        ") does not match bucket (" +
        String(countSuspended) +
        ")",
    );
  }

  if (
    countBlank + countValid + countExpired + countSuspended !==
    input.allCount
  ) {
    throw new Error(
      "designation-list-client: bucket sum does not equal allCount",
    );
  }

  return Object.freeze({
    allCount: input.allCount,
    buckets: Object.freeze({
      "": countBlank,
      "\uC720\uD6A8": countValid,
      "\uB9CC\uB8CC": countExpired,
      "\uD6A8\uB825\uC815\uC9C0": countSuspended,
    }),
    snapshot: Object.freeze({
      "\uC720\uD6A8": snapValid,
      "\uB9CC\uB8CC": snapExpired,
      "\uD6A8\uB825\uC815\uC9C0": snapSuspended,
    }),
  });
}

export function assertNoDesignationContraction(
  input: AssertNoDesignationContractionInput,
): void {
  if (input.current.length < input.previous.length) {
    throw new Error(
      "designation-list-client: contraction detected (current count smaller than previous)",
    );
  }
  const previousIds = new Set<string>();
  for (const f of input.previous) {
    if (typeof f.bzmnRegNo !== "string" || f.bzmnRegNo.length === 0) {
      throw new Error(
        "designation-list-client: previous contains identity with empty bzmnRegNo",
      );
    }
    previousIds.add(f.sourceIdentity);
  }
  const currentIds = new Set<string>();
  for (const f of input.current) {
    if (typeof f.bzmnRegNo !== "string" || f.bzmnRegNo.length === 0) {
      throw new Error(
        "designation-list-client: current contains identity with empty bzmnRegNo",
      );
    }
    if (!previousIds.has(f.sourceIdentity)) {
      continue;
    }
    currentIds.add(f.sourceIdentity);
    const match = input.previous.find(
      (p) => p.sourceIdentity === f.sourceIdentity,
    );
    if (match !== undefined && match.bzmnRegNo !== f.bzmnRegNo) {
      throw new Error(
        "designation-list-client: identity mismatch (bzmnRegNo changed) for " +
          f.sourceIdentity,
      );
    }
  }
  for (const id of previousIds) {
    if (!currentIds.has(id)) {
      throw new Error(
        "designation-list-client: disappearance or contraction: prior identity " +
          id +
          " is missing from current",
      );
    }
  }
}

// ---------------------- Internal exports for detail client --------------------

export const __test__ = Object.freeze({
  EXACT_STATUSES,
});
