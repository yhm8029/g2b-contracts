// src/lib/building-control/g2b/designation-detail-client.ts
// G2B designation detail client. No network, no global state.
// TypeScript 5.7. Pure functions. Deterministic ordering. ASCII only.

import { createHash } from "node:crypto";
import type {
  DesignationListFact,
  DesignationListRequest,
} from "@/lib/building-control/g2b/designation-list-client";

// ----------------------------- Types -----------------------------------------

export interface DesignationDetailRequest {
  readonly etpmDsgnCrfcNo: string;
  readonly etpmDsgnDmndNo: string;
  readonly dsgnDmndChgOrd: string;
  readonly etpsSqno: string;
}

export interface DesignationDetailClassification {
  readonly itemUntyNo: string;
}

export type DesignationDetailEvidence =
  "complete_target" | "complete_non_target" | "missing";

export type TerminationState =
  "unverified" | "verified_none" | "verified_dates";
export type TerminationEvidence =
  | { readonly state: "unverified" }
  | {
      readonly state: "verified_none";
      readonly evidenceHash: string;
      readonly evidenceRawJson: string;
    }
  | {
      readonly state: "verified_dates";
      readonly cancellationDate: string | null;
      readonly revocationDate: string | null;
      readonly evidenceHash: string;
      readonly evidenceRawJson: string;
    };

export interface DesignationDetailResult {
  readonly schemaVersion: 1;
  readonly status: "ok";
  readonly designationRequest: DesignationDetailRequest;
  readonly classifications: readonly DesignationDetailClassification[];
  readonly rawJson: string;
  readonly evidence: DesignationDetailEvidence;
}

export interface DesignationDetailFact {
  readonly classifications: readonly DesignationDetailClassification[];
  readonly detailRawJson: string;
}

export interface DesignationObservationInput {
  readonly sourceHash: string;
  readonly listFact: DesignationListFact;
  readonly detail: DesignationDetailFact | null;
  readonly effectiveEndDate: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly extensionDate: string;
  readonly termination: TerminationEvidence;
  readonly hasTargetClassification: boolean;
  readonly detailRawJson: string | null;
  readonly completenessReason?: string;
}

export type DesignationClassificationKind =
  "excellent" | "not_excellent" | "incomplete";

export interface DesignationClassificationResult {
  readonly kind: DesignationClassificationKind;
  readonly reason?: string;
}

export interface ParseDesignationDetailInput {
  readonly payload: unknown;
  readonly rawJson: string;
  readonly request: DesignationDetailRequest;
}

export interface BuildDesignationObservationInput {
  readonly listFact: DesignationListFact;
  readonly detailFact: DesignationDetailFact | null;
  readonly termination: TerminationEvidence;
}

export interface ClassifyDesignationAtAwardDateInput {
  readonly observation: DesignationObservationInput;
  readonly awardDate: string;
}

// ------------------------- Constants ----------------------------------------

const TARGET_CODES: readonly string[] = Object.freeze([
  "39121801",
  "3912180101",
]);
const TARGET_CODES_SET: ReadonlySet<string> = new Set(TARGET_CODES);

const BIZNO_REGEX = /^\d{10}$/;
const GREGORIAN_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------- Helpers ------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function requireStringField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const v = obj[key];
  if (typeof v !== "string") {
    throw new Error(label + ": missing required string field '" + key + "'");
  }
  return v;
}

function isGregorianDate(s: string): boolean {
  if (!GREGORIAN_DATE_REGEX.test(s)) return false;
  const parts = s.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isInteger(y) || y < 1900 || y > 9999) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > 31) return false;
  // Validate day-of-month using JS Date (Gregorian-only).
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return false;
  }
  return true;
}

function compareDate(a: string, b: string): number {
  // Lexicographic compare works for ISO YYYY-MM-DD strings.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Canonical deep equality with stable key-order normalization.
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = canonicalize(obj[k]);
  }
  return out;
}

function canonicalDeepEqual(a: unknown, b: unknown): boolean {
  const ca = canonicalize(a);
  const cb = canonicalize(b);
  return JSON.stringify(ca) === JSON.stringify(cb);
}

// --------------------- Exact target classification --------------------------

export function containsExactTargetClassification(
  codes: readonly string[],
): boolean {
  for (const raw of codes) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (TARGET_CODES_SET.has(trimmed)) {
      return true;
    }
  }
  return false;
}

function trimCodes(codes: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const c of codes) {
    if (typeof c !== "string") continue;
    out.push(c.trim());
  }
  return out;
}

// ------------------------- Termination validation ---------------------------

export function validateTerminationEvidence(
  t: TerminationEvidence,
): { ok: true } | { ok: false; reason: string } {
  if (t === null || typeof t !== "object") {
    return { ok: false, reason: "invalid_termination_shape" };
  }
  const obj = t as unknown as Record<string, unknown>;
  if (obj["state"] === "unverified") {
    return { ok: true };
  }
  if (obj["state"] === "verified_none" || obj["state"] === "verified_dates") {
    return { ok: false, reason: "termination_contract_unproven" };
  }
  return { ok: false, reason: "invalid_termination_state" };
}

// ------------------------- Detail parsing -----------------------------------

function parseClassifications(arr: unknown): DesignationDetailClassification[] {
  if (!Array.isArray(arr)) {
    throw new Error(
      "designation-detail-client: dlProdSpecModlDtlL must be an array",
    );
  }
  const result: DesignationDetailClassification[] = [];
  for (const row of arr) {
    if (!isObject(row)) {
      throw new Error(
        "designation-detail-client: classification row must be an object",
      );
    }
    const code = requireStringField(
      row,
      "itemUntyNo",
      "designation-detail-client",
    );
    result.push({ itemUntyNo: code });
  }
  return result;
}

function parseMetadata(raw: unknown): DesignationDetailRequest {
  if (!isObject(raw)) {
    throw new Error(
      "designation-detail-client: dlElpdtSlctnSttusDtlM must be an object",
    );
  }
  return {
    etpmDsgnCrfcNo: requireStringField(
      raw,
      "etpmDsgnCrfcNo",
      "designation-detail-client",
    ),
    etpmDsgnDmndNo: requireStringField(
      raw,
      "etpmDsgnDmndNo",
      "designation-detail-client",
    ),
    dsgnDmndChgOrd: requireStringField(
      raw,
      "dsgnDmndChgOrd",
      "designation-detail-client",
    ),
    etpsSqno: requireStringField(raw, "etpsSqno", "designation-detail-client"),
  };
}

export function parseDesignationDetailResponse(
  input: ParseDesignationDetailInput,
): DesignationDetailResult {
  if (typeof input.rawJson !== "string" || input.rawJson.length === 0) {
    throw new Error(
      "designation-detail-client: rawJson must be a non-empty string",
    );
  }
  if (!isObject(input.payload)) {
    throw new Error("designation-detail-client: payload must be an object");
  }
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(input.rawJson);
  } catch {
    throw new Error("designation-detail-client: rawJson is not valid JSON");
  }
  if (!isObject(parsedRaw)) {
    throw new Error(
      "designation-detail-client: parsed rawJson must be an object",
    );
  }
  if (!canonicalDeepEqual(parsedRaw, input.payload)) {
    throw new Error(
      "designation-detail-client: payload does not match rawJson",
    );
  }
  const payload = parsedRaw;

  const errorCode = payload["ErrorCode"];
  if (typeof errorCode !== "number" || !Number.isInteger(errorCode)) {
    throw new Error("designation-detail-client: ErrorCode must be an integer");
  }
  if (errorCode !== 0) {
    throw new Error(
      "designation-detail-client: non-zero ErrorCode: " + String(errorCode),
    );
  }

  const rawMetadata = payload["dlElpdtSlctnSttusDtlM"];
  let metadata: DesignationDetailRequest;
  if (rawMetadata === undefined || rawMetadata === null) {
    metadata = {
      etpmDsgnCrfcNo: input.request.etpmDsgnCrfcNo,
      etpmDsgnDmndNo: input.request.etpmDsgnDmndNo,
      dsgnDmndChgOrd: input.request.dsgnDmndChgOrd,
      etpsSqno: input.request.etpsSqno,
    };
  } else {
    if (!isObject(rawMetadata)) {
      throw new Error(
        "designation-detail-client: dlElpdtSlctnSttusDtlM must be an object",
      );
    }
    const metaObj = rawMetadata as Record<string, unknown>;
    const IDENTITY_KEYS = [
      "etpmDsgnCrfcNo",
      "etpmDsgnDmndNo",
      "dsgnDmndChgOrd",
      "etpsSqno",
    ] as const;
    const echoedCount = IDENTITY_KEYS.reduce(
      (n, k) => n + (metaObj[k] !== undefined && metaObj[k] !== null ? 1 : 0),
      0,
    );
    if (echoedCount === 0) {
      metadata = {
        etpmDsgnCrfcNo: input.request.etpmDsgnCrfcNo,
        etpmDsgnDmndNo: input.request.etpmDsgnDmndNo,
        dsgnDmndChgOrd: input.request.dsgnDmndChgOrd,
        etpsSqno: input.request.etpsSqno,
      };
    } else if (echoedCount !== IDENTITY_KEYS.length) {
      throw new Error(
        "designation-detail-client: partial identity echo in dlElpdtSlctnSttusDtlM",
      );
    } else {
      const parsed = parseMetadata(rawMetadata);
      if (
        parsed.etpmDsgnCrfcNo !== input.request.etpmDsgnCrfcNo ||
        parsed.etpmDsgnDmndNo !== input.request.etpmDsgnDmndNo ||
        parsed.dsgnDmndChgOrd !== input.request.dsgnDmndChgOrd ||
        parsed.etpsSqno !== input.request.etpsSqno
      ) {
        throw new Error(
          "designation-detail-client: metadata identity does not match request",
        );
      }
      metadata = parsed;
    }
  }

  // dlSlctnSttusDtlInfoM is accepted but not required to be a specific shape.
  // We still validate it's an object if present.
  const statusBlock = payload["dlSlctnSttusDtlInfoM"];
  if (statusBlock !== undefined && !isObject(statusBlock)) {
    throw new Error(
      "designation-detail-client: dlSlctnSttusDtlInfoM must be an object if present",
    );
  }

  // Classifications: top-level dlProdSpecModlDtlL preferred; otherwise nested
  // under dlElpdtSlctnSttusDtlM. If neither is present, an empty array is used.
  const topLevelClassifications = payload["dlProdSpecModlDtlL"];
  let classifications: DesignationDetailClassification[];
  if (
    topLevelClassifications !== undefined &&
    topLevelClassifications !== null
  ) {
    classifications = parseClassifications(topLevelClassifications);
  } else if (
    rawMetadata !== undefined &&
    rawMetadata !== null &&
    isObject(rawMetadata) &&
    Object.prototype.hasOwnProperty.call(rawMetadata, "dlProdSpecModlDtlL") &&
    (rawMetadata as Record<string, unknown>)["dlProdSpecModlDtlL"] !==
      undefined &&
    (rawMetadata as Record<string, unknown>)["dlProdSpecModlDtlL"] !== null
  ) {
    const nested = (rawMetadata as Record<string, unknown>)[
      "dlProdSpecModlDtlL"
    ];
    classifications = parseClassifications(nested);
  } else {
    classifications = [];
  }

  let evidence: DesignationDetailEvidence;
  if (classifications.length === 0) {
    evidence = "missing";
  } else if (
    containsExactTargetClassification(
      trimCodes(classifications.map((c) => c.itemUntyNo)),
    )
  ) {
    evidence = "complete_target";
  } else {
    evidence = "complete_non_target";
  }

  return {
    schemaVersion: 1,
    status: "ok",
    designationRequest: metadata,
    classifications: Object.freeze(
      classifications.slice(),
    ) as readonly DesignationDetailClassification[],
    rawJson: input.rawJson,
    evidence,
  };
}

// ------------------------- Observation building -----------------------------

export function buildDesignationObservation(
  input: BuildDesignationObservationInput,
): DesignationObservationInput {
  const listFact = input.listFact;
  const detailFact = input.detailFact;
  const termination = input.termination;

  const startDate = listFact.dsgnBgngYmd;
  const endDateRaw = listFact.dsgnEndYmd;
  const extensionDate = listFact.dsgnExtsYmd;

  // Blank-list end is null; extension wins when nonblank.
  const endDate: string | null =
    typeof endDateRaw === "string" && endDateRaw.length > 0 ? endDateRaw : null;
  const extensionNonblank =
    typeof extensionDate === "string" && extensionDate.length > 0;
  const effectiveEndDate: string | null = extensionNonblank
    ? (extensionDate as string)
    : endDate;

  const hasTargetClassification =
    detailFact !== null
      ? containsExactTargetClassification(
          detailFact.classifications.map((c) => c.itemUntyNo),
        )
      : false;

  const detailRawJson = detailFact !== null ? detailFact.detailRawJson : null;

  const terminationValidation = validateTerminationEvidence(termination);

  let completenessReason: string | undefined;
  if (listFact.bzmnRegNo.length === 0) {
    completenessReason = "empty_bzmn_reg_no";
  } else if (!isGregorianDate(startDate)) {
    completenessReason = "invalid_start_date";
  } else if (effectiveEndDate === null) {
    completenessReason = "invalid_end_date";
  } else if (!isGregorianDate(effectiveEndDate)) {
    completenessReason = "invalid_end_date";
  } else if (
    endDate !== null &&
    extensionNonblank &&
    isGregorianDate(extensionDate as string) &&
    isGregorianDate(endDate) &&
    compareDate(extensionDate as string, endDate) < 0
  ) {
    completenessReason = "extension_before_original_end";
  } else if (endDate === null && extensionNonblank === false) {
    // Missing both end and extension is not "inverted"; the inversion rule
    // below only applies when both are present.
  } else if (
    endDate !== null &&
    isGregorianDate(startDate) &&
    isGregorianDate(endDate) &&
    compareDate(startDate, endDate) > 0
  ) {
    completenessReason = "invalid_end_date";
  } else if (!terminationValidation.ok) {
    completenessReason = terminationValidation.reason;
  } else if (detailFact === null) {
    completenessReason = "missing_detail_evidence";
  } else if (detailFact.classifications.length === 0) {
    completenessReason = "missing_detail_evidence";
  } else if (
    !containsExactTargetClassification(
      detailFact.classifications.map((c) => c.itemUntyNo),
    ) &&
    !detailFact.classifications.some(
      (c) => typeof c.itemUntyNo === "string" && c.itemUntyNo.length > 0,
    )
  ) {
    // Defensive: classifications present but all empty strings.
    completenessReason = "missing_detail_evidence";
  }

  // Canonical normalized hash input: only normalized row/detail/termination
  // fields. Excludes listRawJson and detailRawJson. Whitespace/formatting in
  // raw JSON must not change the hash.
  const normalizedListRow = [
    listFact.applVldYn,
    listFact.bzmnRegNo,
    listFact.dsgnBgngYmd,
    listFact.dsgnEndYmd,
    listFact.dsgnExtsYmd,
    listFact.entNm,
    listFact.etpmDsgnCrfcNo,
    listFact.etpmDsgnDmndNo,
    listFact.dsgnDmndChgOrd,
    listFact.etpsSqno,
    listFact.productName,
    listFact.companyName,
    listFact.status,
    listFact.sourceIdentity,
  ].map((v) => String(v ?? ""));

  const normalizedClassifications =
    detailFact === null
      ? []
      : detailFact.classifications
          .map((c) => c.itemUntyNo.trim())
          .slice()
          .sort();

  const terminationState = termination.state;
  const terminationCand =
    termination.state === "verified_dates"
      ? (termination.cancellationDate ?? null)
      : null;
  const terminationRev =
    termination.state === "verified_dates"
      ? (termination.revocationDate ?? null)
      : null;
  const terminationHash =
    termination.state === "verified_none" ||
    termination.state === "verified_dates"
      ? (termination.evidenceHash ?? "")
      : "";

  // Delimiter-safe canonical composition: JSON.stringify of a fixed shape so
  // delimiters cannot collide. Raw page/detail whitespace remains excluded by
  // virtue of only normalized fields being present (raw evidence JSON is
  // represented solely by its digest via evidenceHash).
  const delimiterSource = JSON.stringify({
    list: normalizedListRow,
    classifications: normalizedClassifications,
    termination: {
      state: terminationState,
      cancellationDate: terminationCand,
      revocationDate: terminationRev,
      evidenceHash: terminationHash,
    },
    effectiveEndDate,
    endDate,
  });
  const sourceHash = sha256Hex(delimiterSource);

  const obs: DesignationObservationInput = {
    sourceHash,
    listFact,
    detail: detailFact,
    effectiveEndDate,
    startDate,
    endDate,
    extensionDate,
    termination,
    hasTargetClassification,
    detailRawJson,
  };
  if (completenessReason !== undefined) {
    return { ...obs, completenessReason };
  }
  return obs;
}

// ------------------------- Classification -----------------------------------

export function classifyDesignationAtAwardDate(
  input: ClassifyDesignationAtAwardDateInput,
): DesignationClassificationResult {
  const { observation, awardDate } = input;
  if (typeof awardDate !== "string" || !isGregorianDate(awardDate)) {
    return { kind: "incomplete", reason: "invalid_award_date" };
  }
  if (!BIZNO_REGEX.test(observation.listFact.bzmnRegNo)) {
    return { kind: "incomplete", reason: "invalid_bizno" };
  }
  if (!isGregorianDate(observation.startDate)) {
    return { kind: "incomplete", reason: "invalid_start_date" };
  }
  if (
    observation.effectiveEndDate === null ||
    !isGregorianDate(observation.effectiveEndDate)
  ) {
    return { kind: "incomplete", reason: "invalid_end_date" };
  }

  if (compareDate(observation.startDate, observation.effectiveEndDate) > 0) {
    return { kind: "incomplete", reason: "invalid_end_date" };
  }
  // Missing detail (or empty classifications) stays incomplete regardless of
  // other checks.
  if (
    observation.detail === null ||
    observation.detail.classifications.length === 0
  ) {
    return { kind: "incomplete", reason: "missing_detail_evidence" };
  }

  const detailFact = observation.detail;
  const classifications = detailFact.classifications;
  const classificationCodes = classifications.map((c) => c.itemUntyNo);
  const hasExactTarget = containsExactTargetClassification(classificationCodes);

  // Complete non-target detail (nonempty classifications and no exact target)
  // is immediately not_excellent BEFORE blank-status or termination checks.
  if (classifications.length > 0 && !hasExactTarget) {
    return { kind: "not_excellent", reason: "non_target_classification" };
  }

  const structuralReason = observation.completenessReason;
  const isTerminationReason =
    structuralReason === "termination_contract_unproven" ||
    structuralReason === "invalid_termination_evidence" ||
    structuralReason === "suspended_without_verified_termination";

  // Target detail: termination / status / interval logic.
  const withinInterval =
    compareDate(awardDate, observation.startDate) >= 0 &&
    compareDate(awardDate, observation.effectiveEndDate) <= 0;

  if (!withinInterval) {
    if (structuralReason !== undefined && !isTerminationReason) {
      return { kind: "incomplete", reason: structuralReason };
    }
    return { kind: "not_excellent", reason: "outside_interval" };
  }

  // Within the valid interval. A blank official status means we have no
  // status to lean on; that is incomplete regardless of termination.
  if (observation.listFact.status === "") {
    if (structuralReason !== undefined && !isTerminationReason) {
      return { kind: "incomplete", reason: structuralReason };
    }
    return { kind: "incomplete", reason: "blank_status" };
  }

  if (structuralReason !== undefined) {
    return { kind: "incomplete", reason: structuralReason };
  }

  // 효력정지 requires verified_dates with at least one valid date; verified_none
  // or unverified is incomplete (cannot verify the suspension boundary).
  if (observation.listFact.status === "효력정지") {
    if (observation.termination.state !== "verified_dates") {
      return {
        kind: "incomplete",
        reason: "suspended_without_verified_termination",
      };
    }
  }

  const terminationValidation = validateTerminationEvidence(
    observation.termination,
  );
  if (!terminationValidation.ok) {
    return { kind: "incomplete", reason: terminationValidation.reason };
  }
  if (observation.termination.state === "unverified") {
    return { kind: "excellent" };
  }
  return { kind: "incomplete", reason: "termination_contract_unproven" };
}

// --------------------- Re-export for convenience ----------------------------

export type { DesignationListFact, DesignationListRequest };
