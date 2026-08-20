// src/lib/building-control/live-api-contract-probe.ts
// Live API contract probe for the building-control product domain.
// Production TypeScript, strict mode, no external deps.

export {
  assertBuildingControlFixtureProjection,
  hasDesignationExtensionEvidence,
  hasExactDesignationStatusUnion,
  isAwardRegistrationTimestampInWindow,
  normalizeDesignationDate,
  shouldPromoteProbeFixtures,
} from "./probe-contract-guards";

import {
  assertBuildingControlFixtureProjection,
  hasDesignationExtensionEvidence,
  hasExactDesignationStatusUnion,
  isAwardRegistrationTimestampInWindow,
  normalizeDesignationDate,
  shouldPromoteProbeFixtures,
} from "./probe-contract-guards";

import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";

import {
  BUILDING_CONTROL_REQUIRED_CHECKS,
  parseApiContractReport,
} from "./api-contract";
import { TARGET_DETAIL_CODE, TARGET_PARENT_CODE } from "./constants";
import { buildAwardSourceKey, matchesTargetProduct } from "./normalization";
import {
  assertProbeFixtureSafe,
  compareIdentitySets,
  parseG2bPage,
  sanitizeProbeFixture,
  validateCollectedPages,
} from "./api-contract-probe";
import type { G2bPage } from "./api-contract-probe";

/* eslint-disable no-console */

type AnyObj = Record<string, unknown>;

interface ProbeCheckState {
  [key: string]: boolean;
}

const REQUEST_TIMEOUT_MS = 20_000;
const PUBLIC_MAX_ROWS = 999;
const PUBLIC_MAX_PAGES = 20;
const DESIG_MAX_ROWS = 1000;
const DESIG_MAX_PAGES = 20;
const DESIG_DETAIL_MAX = 64;

const NOTICE_DAY = { begin: "202608190000", end: "202608192359" };
const RECALL_DAY = { begin: "202501100000", end: "202501102359" };

const PUBLIC_BASE_GOODS =
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const PUBLIC_BASE_AWARDS =
  "https://apis.data.go.kr/1230000/as/ScsbidInfoService";

const DESIGNATION_LIST_URL =
  "https://shop.g2b.go.kr/ge/gec/gecb/ElpdtSlctnSttus/selectElpdtSlctnSttusLst.do";
const DESIGNATION_DETAIL_URL =
  "https://shop.g2b.go.kr/ge/gec/gecb/ElpdtSlctnSttus/selectElpdtSlctnSttusDtl.do";
const DESIGNATION_BOOTSTRAP_URL =
  "https://shop.g2b.go.kr/link/GECB002_04/single";
const DESIGNATION_DETAIL_REFERER =
  "https://shop.g2b.go.kr/link/GECB005_01/single/";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SAMPLE_TERM = "\uC790\uB3D9\uC81C\uC5B4";
const SCHEMA_VERSION = 1;

export function resolveAllowedDesignationRedirect(
  currentUrl: string,
  location: string,
): string {
  let resolved: URL;
  try {
    resolved = new URL(location, currentUrl);
  } catch {
    throw new Error("designation redirect invalid location");
  }
  if (
    !DESIGNATION_ORIGINS.includes(resolved.origin) ||
    resolved.username !== "" ||
    resolved.password !== ""
  ) {
    throw new Error("designation redirect origin is not allowed");
  }
  return resolved.toString();
}

const FIXTURE_DIR = resolve(process.cwd(), "tests/fixtures/building-control");
const REPORT_DIR = resolve(process.cwd(), "data/api-contract");
const REPORT_FILE = join(REPORT_DIR, "building-control.json");

/* ----------------------- small helpers ----------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

function redactString(s: string): string {
  return s.replace(
    /[A-Za-z0-9]{16,}/g,
    (m) => `${m.slice(0, 4)}??${m.length})`,
  );
}

function safeLog(line: string): void {
  console.log(redactString(line));
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function getField(row: AnyObj, key: string): string {
  const v = row?.[key];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normalizeBizno(raw: string): string {
  const cleaned = raw.replace(/[-\s]/g, "");
  return cleaned;
}

function isNonblank(s: string): boolean {
  return s.length > 0;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function writeAtomicUtf8Json(
  filePath: string,
  data: unknown,
): Promise<{ bytes: Buffer; hash: string }> {
  const json = JSON.stringify(data, null, 2);
  const buf = Buffer.from(json + "\n", "utf8");
  const dir = dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, buf, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, filePath);
  } catch (err) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { bytes: buf, hash: sha256Hex(buf) };
}

/**
 * Immutable publisher for sanitized building-control live-API probe fixtures.
 *
 * Writes seven files into <committedRoot>/generations/<generationId>/, then
 * atomically activates them by writing a single active-generation.json
 * pointer at <committedRoot>/active-generation.json. The generation
 * directory itself is staged under a hidden staging subdirectory and
 * renamed into place; on any failure the staging directory is removed
 * and the pointer is never touched.
 */

export type PublishedGeneration = {
  version: 1;
  generationId: string;
  fixtureSchemaVersion: 1;
  fixtureHashes: Record<string, string>;
};

export const PUBLISHED_FIXTURE_FILES = [
  "notice-page.json",
  "purchase-target-page.json",
  "award-page.json",
  "designation-list-valid.json",
  "designation-list-expired.json",
  "designation-list-extended.json",
  "designation-detail.json",
] as const;

const POINTER_FILENAME = "active-generation.json";
const GENERATIONS_DIRNAME = "generations";
const STAGING_PREFIX = ".staging-";

export async function publishFixtureGeneration(args: {
  committedRoot: string;
  bundle: Record<string, unknown>;
  generatedAt: string;
}): Promise<PublishedGeneration> {
  const { committedRoot, bundle, generatedAt } = args;

  // generatedAt must be a canonical ISO UTC timestamp (toISOString() round-trip).
  const parsedDate = new Date(generatedAt);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString() !== generatedAt
  ) {
    throw new Error(
      "publishFixtureGeneration: generatedAt must be a canonical ISO UTC timestamp",
    );
  }

  // Validate bundle shape: exactly the seven required filenames.
  const required = PUBLISHED_FIXTURE_FILES as readonly string[];
  const provided = Object.keys(bundle);
  if (provided.length !== required.length) {
    throw new Error(
      `publishFixtureGeneration: bundle must contain exactly ${required.length} files, got ${provided.length}`,
    );
  }
  const providedSorted = [...provided].sort();
  const requiredSorted = [...required].sort();
  for (let i = 0; i < requiredSorted.length; i += 1) {
    if (providedSorted[i] !== requiredSorted[i]) {
      throw new Error(
        `publishFixtureGeneration: bundle is missing or has unexpected file "${requiredSorted[i]}"`,
      );
    }
  }
  for (const name of required) {
    const data = bundle[name];
    // Sanity / safety check first (allow-list / sensitive-key guard).
    assertProbeFixtureSafe(data);
    // Then strict projection check (filename -> data shape).
    assertBuildingControlFixtureProjection(name, data);
  }

  // Deterministic generationId: sha256(generatedAt + "\n" + sorted("name:hash")) lowercase hex.
  const sortedNames = [...required].sort();
  const fixtureHashes: Record<string, string> = {};
  for (const name of sortedNames) {
    const data = bundle[name];
    const json = JSON.stringify(data, null, 2) + "\n";
    const buf = Buffer.from(json, "utf8");
    fixtureHashes[name] = createHash("sha256").update(buf).digest("hex");
  }

  const lines: string[] = [];
  for (const name of sortedNames) {
    lines.push(`${name}:${fixtureHashes[name]}`);
  }
  const generationId = createHash("sha256")
    .update(generatedAt + "\n" + lines.join("\n"))
    .digest("hex");

  const generationsRoot = join(committedRoot, GENERATIONS_DIRNAME);
  const finalGenDir = join(generationsRoot, generationId);
  const stagingGenDir = join(
    generationsRoot,
    `${STAGING_PREFIX}${generationId}-${process.pid}-${Date.now()}`,
  );

  // Ensure generations root exists; do NOT create the final gen dir directly
  // because that would be a non-atomic, observable half-state.
  await mkdir(generationsRoot, { recursive: true });

  let staged = false;
  try {
    await mkdir(stagingGenDir, { recursive: true });
    staged = true;

    // Write each fixture file into the staging directory with mode 0600.
    for (const name of sortedNames) {
      const data = bundle[name];
      const json = JSON.stringify(data, null, 2) + "\n";
      const buf = Buffer.from(json, "utf8");
      const filePath = join(stagingGenDir, name);
      // Use the atomic write primitive: writeFile with mode 0o600, then rename.
      const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, buf, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, filePath);
    }

    // Atomically publish the generation directory.
    await rename(stagingGenDir, finalGenDir);
    staged = false; // staging no longer exists; do not clean it up on failure.
  } catch (err) {
    if (staged) {
      try {
        await rm(stagingGenDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup failure; original error wins */
      }
    }
    throw err;
  }

  // Activate by writing the single, immutable active pointer.
  const pointer: PublishedGeneration = {
    version: 1,
    generationId,
    fixtureSchemaVersion: 1,
    fixtureHashes,
  };
  const pointerPath = join(committedRoot, POINTER_FILENAME);
  await writeAtomicUtf8Json(pointerPath, pointer);

  return pointer;
}

/* ----------------------- fetch with timeout ----------------------- */

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number; redirect?: RequestRedirect } = {},
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  try {
    const resp = await fetch(url, {
      ...init,
      redirect: init.redirect ?? "manual",
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(t);
  }
}

function buildPublicUrl(
  base: string,
  operation: string,
  params: Record<string, string>,
): URLSearchParams {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      u.set(k, v);
    }
  }
  void base;
  void operation;
  return u;
}

/* ----------------------- public-data collection ----------------------- */

interface PublicParams {
  base: string;
  operation: string;
  extra: Record<string, string>;
}

async function collectPublicPages(
  p: PublicParams,
  label: string,
): Promise<{ rows: AnyObj[]; pages: number; totalCount: number }> {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY ?? "";
  if (!serviceKey) {
    throw new Error("missing service key env");
  }

  const makeUrl = (pageNo: number): string => {
    const u = buildPublicUrl(p.base, p.operation, {
      serviceKey,
      type: "json",
      pageNo: String(pageNo),
      numOfRows: String(PUBLIC_MAX_ROWS),
      ...p.extra,
    });
    return `${p.base}/${p.operation}?${u.toString()}`;
  };

  const collected: G2bPage[] = [];

  const t0 = performance.now();
  const r1 = await fetchWithTimeout(makeUrl(1), {
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!r1.ok) {
    throw new Error(`public http ${r1.status} on ${label} page1`);
  }
  const j1 = (await r1.json()) as AnyObj;
  const parsed1: G2bPage = parseG2bPage(j1, 1);
  collected.push(parsed1);
  const totalCount = parsed1.totalCount;
  const expectedPages = Math.max(1, Math.ceil(totalCount / PUBLIC_MAX_ROWS));
  if (expectedPages > PUBLIC_MAX_PAGES) {
    throw new Error(`public page cap exceeded for ${label}: ${expectedPages}`);
  }

  for (let pageNo = 2; pageNo <= expectedPages; pageNo += 1) {
    const r = await fetchWithTimeout(makeUrl(pageNo), {
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!r.ok) {
      throw new Error(`public http ${r.status} on ${label} page${pageNo}`);
    }
    const j = (await r.json()) as AnyObj;
    const parsed: G2bPage = parseG2bPage(j, pageNo);
    collected.push(parsed);
  }
  const elapsed = Math.round(performance.now() - t0);
  validateCollectedPages(collected);
  const rowsForCallers: AnyObj[] = [];
  for (const pg of collected) {
    for (const it of pg.items) rowsForCallers.push(it as AnyObj);
  }
  safeLog(
    `probe.public.${label} pages=${expectedPages} rows=${rowsForCallers.length} elapsed_ms=${elapsed}`,
  );
  return { rows: rowsForCallers, pages: expectedPages, totalCount };
}

/* ----------------------- designation bootstrap + list ----------------------- */

interface DesignationState {
  cookiesByOrigin: Record<string, string[]>;
}

const DESIGNATION_ORIGINS: ReadonlyArray<string> = [
  "https://shop.g2b.go.kr",
  "https://sso.g2b.go.kr",
];

function normalizeOrigin(raw: string): string {
  const u = new URL(raw);
  return `${u.protocol}//${u.host}`;
}

function getOriginJar(state: DesignationState, origin: string): string[] {
  let jar = state.cookiesByOrigin[origin];
  if (!jar) {
    jar = [];
    state.cookiesByOrigin[origin] = jar;
  }
  return jar;
}

function captureSetCookies(resp: Response): string[] {
  const anyResp = resp as unknown as { headers: Headers };
  const h = anyResp.headers;
  if (typeof h.getSetCookie === "function") {
    const list = h.getSetCookie();
    if (Array.isArray(list) && list.length > 0) {
      return list.map((c) => c.split(";")[0]).filter(Boolean);
    }
  }
  const combined = h.get("set-cookie");
  if (!combined) return [];
  return combined
    .split(/,(?=[^ ;]+=)/g)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean);
}

function cookieHeader(state: DesignationState, origin: string): string {
  const jar = state.cookiesByOrigin[origin] ?? [];
  return jar.join("; ");
}

function mergeCookies(
  state: DesignationState,
  origin: string,
  newOnes: string[],
): void {
  const jar = getOriginJar(state, origin);
  for (const c of newOnes) {
    const name = c.split("=")[0]?.trim();
    if (!name) continue;
    const idx = jar.findIndex((x) => x.split("=")[0]?.trim() === name);
    if (idx >= 0) jar[idx] = c;
    else jar.push(c);
  }
}

async function bootstrapDesignation(state: DesignationState): Promise<string> {
  let url = resolveAllowedDesignationRedirect(
    DESIGNATION_BOOTSTRAP_URL,
    DESIGNATION_BOOTSTRAP_URL,
  );
  for (let i = 0; i < 10; i += 1) {
    const origin = normalizeOrigin(url);
    if (!DESIGNATION_ORIGINS.includes(origin)) {
      throw new Error(`designation bootstrap disallowed origin ${origin}`);
    }
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: "*/*",
    };
    const jar = state.cookiesByOrigin[origin] ?? [];
    if (jar.length > 0) {
      headers.cookie = cookieHeader(state, origin);
    }
    const r = await fetchWithTimeout(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers,
    });
    const newCookies = captureSetCookies(r);
    if (newCookies.length > 0) mergeCookies(state, origin, newCookies);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location") ?? "";
      if (!loc) {
        throw new Error("designation bootstrap redirect missing location");
      }
      url = resolveAllowedDesignationRedirect(url, loc);
      continue;
    }
    if (!r.ok) {
      throw new Error(`designation bootstrap http ${r.status}`);
    }
    return url;
  }
  throw new Error("designation bootstrap exceeded redirect limit");
}
interface DesignationListParams {
  itemCfnm?: string;
  applVldYn: string;
  recordCountPerPage?: string;
  currentPage?: string;
  etpmDsgnCrfcNo?: string;
  etpmDsgnDmndFldCd?: string;
  bzmnRegNo?: string;
  etpsNm?: string;
  dsgnBgngYmd?: string;
  dsgnEndYmd?: string;
}

interface DesignationListRow {
  applVldYn: string;
  bzmnRegNo: string;
  dsgnBgngYmd: string;
  dsgnEndYmd: string;
  dsgnExtsYmd: string;
  entNm: string;
  etpmDsgnCrfcNo: string;
  etpmDsgnDmndNo: string;
  dsgnDmndChgOrd: string;
  etpsSqno: string;
  itemCfnm: string;
}

async function designationList(
  state: DesignationState,
  p: DesignationListParams,
  referer: string,
): Promise<{ rows: AnyObj[]; totalCount: number; pages: number }> {
  const body = {
    dlElpdtSlctnSttusM: {
      etpmDsgnCrfcNo: p.etpmDsgnCrfcNo ?? "",
      etpmDsgnDmndFldCd: p.etpmDsgnDmndFldCd ?? "",
      bzmnRegNo: p.bzmnRegNo ?? "",
      etpsNm: p.etpsNm ?? "",
      itemCfnm: p.itemCfnm ?? "",
      dsgnBgngYmd: p.dsgnBgngYmd ?? "",
      dsgnEndYmd: p.dsgnEndYmd ?? "",
      applVldYn: p.applVldYn,
      recordCountPerPage: p.recordCountPerPage ?? String(DESIG_MAX_ROWS),
      currentPage: p.currentPage ?? "1",
    },
  };
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json;charset=UTF-8",
    "usr-id": "null",
    submissionid: "mf_wfm_container_sbmElpdtSlctnSttusLst",
    "menu-info": JSON.stringify({
      menuNo: "23224",
      menuCangVal: "GECB002_04",
      bsneClsfCd: "%EC%97%85130035",
      scrnNo: "05444",
    }),
    referer,
    "user-agent": USER_AGENT,
  };
  const origin = new URL(DESIGNATION_LIST_URL).origin;
  const cookies = cookieHeader(state, origin);
  if (cookies !== "") headers.cookie = cookies;
  const r = await fetchWithTimeout(DESIGNATION_LIST_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const newCookies = captureSetCookies(r);
  if (newCookies.length > 0) mergeCookies(state, origin, newCookies);
  if (!r.ok) {
    throw new Error(`designation list http ${r.status}`);
  }
  if (!r.ok) {
    throw new Error(`designation list http ${r.status}`);
  }
  const j = (await r.json()) as AnyObj;
  const ec = asNumber((j as AnyObj).ErrorCode);
  if (!Number.isFinite(ec) || ec !== 0) {
    throw new Error("designation list error code non-zero");
  }
  const rawRows = (j as AnyObj).dlElpdtSlctnSttusL;
  if (!Array.isArray(rawRows)) {
    throw new Error("designation list rows is not array");
  }
  if (
    !rawRows.every(
      (row) => row !== null && typeof row === "object" && !Array.isArray(row),
    )
  ) {
    throw new Error("designation list row has invalid shape");
  }
  const rows = rawRows as AnyObj[];
  const totalCount = (() => {
    if (rows.length === 0) return 0;
    const tc = asNumber((rows[0] as AnyObj).totCnt);
    if (
      !Number.isFinite(tc) ||
      !Number.isSafeInteger(tc) ||
      tc < 0 ||
      tc < rows.length
    ) {
      throw new Error("designation list totalCount invalid");
    }
    return tc;
  })();
  const pages = Math.ceil(totalCount / DESIG_MAX_ROWS);
  return { rows, totalCount, pages };
}

async function collectDesignationAll(
  state: DesignationState,
  referer: string,
  filter: Omit<DesignationListParams, "currentPage" | "recordCountPerPage">,
): Promise<{ rows: AnyObj[]; totalCount: number; pages: number }> {
  const first = await designationList(
    state,
    { ...filter, recordCountPerPage: String(DESIG_MAX_ROWS), currentPage: "1" },
    referer,
  );
  const totalCount = first.totalCount;
  const expectedPages = Math.max(1, Math.ceil(totalCount / DESIG_MAX_ROWS));
  if (expectedPages > DESIG_MAX_PAGES) {
    throw new Error(`designation page cap exceeded: ${expectedPages}`);
  }
  const all: AnyObj[] = [...first.rows];
  for (let p = 2; p <= expectedPages; p += 1) {
    const r = await designationList(
      state,
      {
        ...filter,
        recordCountPerPage: String(DESIG_MAX_ROWS),
        currentPage: String(p),
      },
      referer,
    );
    if (r.totalCount !== first.totalCount || r.pages !== expectedPages) {
      throw new Error(
        `designation pagination mismatch page=${p} total=${r.totalCount}/${first.totalCount} pages=${r.pages}/${expectedPages}`,
      );
    }
    all.push(...r.rows);
  }
  if (all.length !== totalCount) {
    throw new Error(
      `designation row count mismatch: got=${all.length} expected=${totalCount}`,
    );
  }
  return { rows: all, totalCount, pages: expectedPages };
}

interface DesignationDetailRequestKeys {
  etpmDsgnCrfcNo: string;
  etpmDsgnDmndNo: string;
  dsgnDmndChgOrd: string;
  etpsSqno: string;
}

interface DesignationDetailRow {
  itemUntyNo: string;
}

export function parseDesignationDetailPayload(
  payload: unknown,
  request: DesignationDetailRequestKeys,
): {
  rows: DesignationDetailRow[];
  status: string;
  request: DesignationDetailRequestKeys;
} {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("designation detail payload is not an object");
  }
  const j = payload as AnyObj;
  const ec = asNumber(j.ErrorCode);
  if (!Number.isFinite(ec) || ec !== 0) {
    throw new Error("designation detail error code non-zero");
  }
  const detailRaw = j.dlElpdtSlctnSttusDtlM;
  let status = "";
  let detail: AnyObj | null = null;
  if (
    detailRaw !== null &&
    typeof detailRaw === "object" &&
    !Array.isArray(detailRaw)
  ) {
    detail = detailRaw as AnyObj;
    status = String(detail.applVldYn ?? "").trim();
  }
  if (status === "") {
    const info = j.dlSlctnSttusDtlInfoM;
    if (info !== null && typeof info === "object" && !Array.isArray(info)) {
      status = String((info as AnyObj).applVldYn ?? "").trim();
    }
  }
  if (detail !== null) {
    const identityKeys: Array<keyof DesignationDetailRequestKeys> = [
      "etpmDsgnCrfcNo",
      "etpmDsgnDmndNo",
      "dsgnDmndChgOrd",
      "etpsSqno",
    ];
    let anyIdentity = false;
    for (const key of identityKeys) {
      const v = String(detail[key] ?? "").trim();
      if (v !== "") {
        anyIdentity = true;
        break;
      }
    }
    if (anyIdentity) {
      for (const key of identityKeys) {
        if (String(detail[key] ?? "").trim() !== request[key].trim()) {
          throw new Error(`designation detail identity mismatch: ${key}`);
        }
      }
    }
  }
  const topList = j.dlProdSpecModlDtlL;
  const nestedList = detail !== null ? detail.dlProdSpecModlDtlL : undefined;
  const arr: unknown[] = Array.isArray(topList)
    ? (topList as unknown[])
    : Array.isArray(nestedList)
      ? (nestedList as unknown[])
      : [];
  const rows: DesignationDetailRow[] = (arr as AnyObj[]).map((r0) => ({
    itemUntyNo: String(r0.itemUntyNo ?? "").trim(),
  }));
  const clonedRequest: DesignationDetailRequestKeys = {
    etpmDsgnCrfcNo: request.etpmDsgnCrfcNo,
    etpmDsgnDmndNo: request.etpmDsgnDmndNo,
    dsgnDmndChgOrd: request.dsgnDmndChgOrd,
    etpsSqno: request.etpsSqno,
  };
  return { rows, status, request: clonedRequest };
}

async function designationDetail(
  state: DesignationState,
  keys: DesignationDetailRequestKeys,
): Promise<{
  rows: DesignationDetailRow[];
  status: string;
  request: DesignationDetailRequestKeys;
}> {
  const body = {
    dlElpdtSlctnSttusDtlM: {
      etpmDsgnCrfcNo: keys.etpmDsgnCrfcNo,
      etpmDsgnDmndNo: keys.etpmDsgnDmndNo,
      dsgnDmndChgOrd: keys.dsgnDmndChgOrd,
      etpsSqno: keys.etpsSqno,
      befDsgnCrfcYn: "",
    },
  };
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json;charset=UTF-8",
    "usr-id": "null",
    submissionid: "mf_wfm_container_sbmElpdtSlctnSttusDtl",
    "menu-info": JSON.stringify({
      menuNo: "24221",
      menuCangVal: "GECB005_01",
      bsneClsfCd: "%EC%97%85130035",
      scrnNo: "09716",
    }),
    referer: DESIGNATION_DETAIL_REFERER,
    "user-agent": USER_AGENT,
  };
  const origin = new URL(DESIGNATION_DETAIL_URL).origin;
  const cookies = cookieHeader(state, origin);
  if (cookies !== "") headers.cookie = cookies;
  const r = await fetchWithTimeout(DESIGNATION_DETAIL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const newCookies = captureSetCookies(r);
  if (newCookies.length > 0) mergeCookies(state, origin, newCookies);
  if (!r.ok) {
    throw new Error(`designation detail http ${r.status}`);
  }
  const j = (await r.json()) as AnyObj;
  return parseDesignationDetailPayload(j, keys);
}
function normalizeUntyNo(s: string): string {
  return s.replace(/\s+/g, "");
}

function classifyUntyNo(code: string): "parent" | "detail" | "none" {
  const c = normalizeUntyNo(code);
  if (!c) return "none";
  if (c === TARGET_PARENT_CODE) return "parent";
  if (c === TARGET_DETAIL_CODE) return "detail";
  return "none";
}

/* ----------------------- check evaluators ----------------------- */

interface ProbeEvidence {
  checks: ProbeCheckState;
  counts: Record<string, number>;
  productDiscoveryStrategy: "server_exact" | "exhaustive_fallback" | "none";
  selected: {
    validSample?: DesignationListRow;
    expiredSample?: DesignationListRow;
    extendedSample?: DesignationListRow;
    validDetailClassifications?: DesignationDetailRow[];
  };
  fixtures: {
    noticePage: AnyObj;
    purchaseTargetPage: AnyObj;
    awardPage: AnyObj;
    designationListValid: AnyObj;
    designationListExpired: AnyObj;
    designationListExtended: AnyObj;
    designationDetail: AnyObj;
  };
}

function initChecks(): ProbeCheckState {
  const out: ProbeCheckState = {};
  for (const k of BUILDING_CONTROL_REQUIRED_CHECKS) out[k] = false;
  return out;
}

function buildFixturePage(items: AnyObj[]): AnyObj {
  return {
    schemaVersion: SCHEMA_VERSION,
    page: {
      pageNo: 1,
      numOfRows: items.length,
      totalCount: items.length,
      items,
    },
  };
}

function evaluateNotice(rows: AnyObj[], ev: ProbeEvidence): void {
  ev.checks.noticePagination = rows.length > 0;
  if (rows.length > 0) {
    const first3 = rows.slice(0, 3).map((r) => ({
      bidNtceNo: getField(r, "bidNtceNo"),
      bidNtceOrd: getField(r, "bidNtceOrd"),
      bidNtceNm: getField(r, "bidNtceNm"),
    }));
    ev.fixtures.noticePage = buildFixturePage(first3);
    ev.checks.noticeOfficialKeys = first3.length > 0;
  } else {
    ev.fixtures.noticePage = buildFixturePage([]);
    ev.checks.noticeOfficialKeys = false;
  }
  ev.counts.noticeRows = rows.length;
  ev.counts.noticeFixtureItems = (
    ev.fixtures.noticePage as { page: { items: unknown[] } }
  ).page.items.length;
}

function evaluatePurchaseTarget(rows: AnyObj[], ev: ProbeEvidence): void {
  ev.checks.purchaseTargetPagination = rows.length > 0;

  const exactRows = rows.filter((r) => {
    const parent = getField(r, "prdctClsfcNo");
    const detail = getField(r, "dtilPrdctClsfcNo");
    return (
      matchesTargetProduct({
        parentCode: TARGET_PARENT_CODE,
        detailCode: TARGET_DETAIL_CODE,
      }) &&
      matchesTargetProduct({ parentCode: parent, detailCode: detail }) &&
      parent === TARGET_PARENT_CODE &&
      detail === TARGET_DETAIL_CODE
    );
  });

  const parentOnlyRows = rows.filter((r) => {
    const parent = getField(r, "prdctClsfcNo");
    const detail = getField(r, "dtilPrdctClsfcNo");
    return (
      matchesTargetProduct({ parentCode: parent, detailCode: detail }) &&
      parent === TARGET_PARENT_CODE &&
      !detail
    );
  });

  const siblingRows = rows.filter((r) => {
    const parent = getField(r, "prdctClsfcNo");
    const detail = getField(r, "dtilPrdctClsfcNo");
    return parent === TARGET_PARENT_CODE && detail === "3912180102";
  });

  ev.checks.productFieldPrecedence =
    exactRows.length > 0 &&
    matchesTargetProduct({
      parentCode: TARGET_PARENT_CODE,
      detailCode: TARGET_DETAIL_CODE,
    }) &&
    matchesTargetProduct({ parentCode: TARGET_PARENT_CODE, detailCode: "" }) &&
    !matchesTargetProduct({
      parentCode: TARGET_PARENT_CODE,
      detailCode: "3912180102",
    });

  const fixtureSource = exactRows.length > 0 ? exactRows : rows;
  const first3 = fixtureSource.slice(0, 3).map((r) => ({
    bidNtceNo: getField(r, "bidNtceNo"),
    bidNtceOrd: getField(r, "bidNtceOrd"),
    bidClsfcNo: getField(r, "bidClsfcNo"),
    prdctSno: getField(r, "prdctSno"),
    prdctClsfcNo: getField(r, "prdctClsfcNo"),
    dtilPrdctClsfcNo: getField(r, "dtilPrdctClsfcNo"),
  }));
  ev.fixtures.purchaseTargetPage = buildFixturePage(first3);

  ev.counts.purchaseTargetRows = rows.length;
  ev.counts.purchaseTargetExact = exactRows.length;
  ev.counts.purchaseTargetParentOnly = parentOnlyRows.length;
  ev.counts.purchaseTargetSibling = siblingRows.length;
  ev.counts.purchaseTargetFixtureItems = (
    ev.fixtures.purchaseTargetPage as { page: { items: unknown[] } }
  ).page.items.length;
}

function evaluateRecall(
  serverExactRows: AnyObj[],
  exhaustiveRows: AnyObj[],
  ev: ProbeEvidence,
): void {
  const buildServerSet = (src: AnyObj[]): Set<string> => {
    const s = new Set<string>();
    for (const r of src) {
      const id = getField(r, "bidNtceNo");
      const ord = getField(r, "bidNtceOrd");
      if (id && ord) s.add(`${id}|${ord}`);
    }
    return s;
  };
  const buildLocalDetailExactSet = (src: AnyObj[]): Set<string> => {
    const s = new Set<string>();
    for (const r of src) {
      const parent = getField(r, "prdctClsfcNo");
      const detail = getField(r, "dtilPrdctClsfcNo");
      const ok = matchesTargetProduct({
        parentCode: parent,
        detailCode: detail,
      });
      if (!ok || parent !== TARGET_PARENT_CODE || detail !== TARGET_DETAIL_CODE)
        continue;
      const id = getField(r, "bidNtceNo");
      const ord = getField(r, "bidNtceOrd");
      if (id && ord) s.add(`${id}|${ord}`);
    }
    return s;
  };
  const buildLocalAllTargetSet = (src: AnyObj[]): Set<string> => {
    const s = new Set<string>();
    for (const r of src) {
      const parent = getField(r, "prdctClsfcNo");
      const detail = getField(r, "dtilPrdctClsfcNo");
      if (!matchesTargetProduct({ parentCode: parent, detailCode: detail }))
        continue;
      const id = getField(r, "bidNtceNo");
      const ord = getField(r, "bidNtceOrd");
      if (id && ord) s.add(`${id}|${ord}`);
    }
    return s;
  };
  const serverSet = buildServerSet(serverExactRows);
  const localDetailExactSet = buildLocalDetailExactSet(exhaustiveRows);
  const localAllTargetSet = buildLocalAllTargetSet(exhaustiveRows);
  const cmp = compareIdentitySets([...serverSet], [...localDetailExactSet]);
  const missing = cmp.missingFromServer.length;
  const extra = cmp.extraOnServer.length;
  const delta = missing + extra;
  ev.counts.recallServerCount = serverSet.size;
  ev.counts.recallLocalDetailExactCount = localDetailExactSet.size;
  ev.counts.recallLocalAllTargetCount = localAllTargetSet.size;
  ev.counts.recallDelta = delta;
  ev.counts.recallMissing = missing;
  ev.counts.recallExtra = extra;

  const nonemptyExactEquality =
    serverSet.size > 0 && localDetailExactSet.size > 0 && delta === 0;
  ev.checks.recallIdentity = nonemptyExactEquality;

  const exhaustiveNonempty = exhaustiveRows.length > 0;
  const useExhaustive = exhaustiveNonempty && localAllTargetSet.size > 0;
  ev.productDiscoveryStrategy = useExhaustive
    ? "exhaustive_fallback"
    : nonemptyExactEquality
      ? "server_exact"
      : "none";
  ev.checks.productDiscoveryStrategyProven = useExhaustive;
}

export function hasRepresentativeWinnerIdentity(
  rows: readonly AnyObj[],
): boolean {
  if (!rows || rows.length === 0) return false;
  const grainCounts: Record<string, number> = {};
  for (const r of rows) {
    const noticeNo = getField(r, "bidNtceNo");
    const noticeOrder = getField(r, "bidNtceOrd");
    const bidClassNo = getField(r, "bidClsfcNo");
    const bidwinnrBizno = getField(r, "bidwinnrBizno");
    const bidwinnrNm = getField(r, "bidwinnrNm");
    const rgstDt = getField(r, "rgstDt");
    if (!noticeNo || !noticeOrder || !bidClassNo) return false;
    if (!bidwinnrNm) return false;
    if (!rgstDt) return false;
    const biz = normalizeBizno(bidwinnrBizno);
    if (biz.length !== 10 || !/^\d{10}$/.test(biz)) return false;
    const grain = `${noticeNo}|${noticeOrder}|${bidClassNo}`;
    grainCounts[grain] = (grainCounts[grain] ?? 0) + 1;
  }
  for (const c of Object.values(grainCounts)) {
    if (c !== 1) return false;
  }
  return true;
}

export function hasResolvedFinalAwardDate(row: AnyObj): boolean {
  const value = getField(row, "fnlSucsfDate");
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    const normalized = normalizeDesignationDate(value);
    return normalized === value;
  } catch {
    return false;
  }
}

export function hasTerminalAwardFeedEvidence(rows: readonly AnyObj[]): boolean {
  if (!rows || rows.length === 0) return false;
  const grainCounts: Record<string, number> = {};
  let hasPositiveRbid = false;
  for (const r of rows) {
    const noticeNo = getField(r, "bidNtceNo");
    const noticeOrder = getField(r, "bidNtceOrd");
    const bidClassNo = getField(r, "bidClsfcNo");
    const rebidNo = getField(r, "rbidNo");
    if (!noticeNo || !noticeOrder || !bidClassNo) return false;
    if (!/^\d+$/.test(rebidNo)) return false;
    const n = Number(rebidNo);
    if (!Number.isSafeInteger(n) || n < 0) return false;
    if (n > 0) hasPositiveRbid = true;
    const grain = `${noticeNo}|${noticeOrder}|${bidClassNo}`;
    grainCounts[grain] = (grainCounts[grain] ?? 0) + 1;
  }
  if (!hasPositiveRbid) return false;
  for (const c of Object.values(grainCounts)) {
    if (c !== 1) return false;
  }
  return true;
}

function evaluateAwards(rows: AnyObj[], ev: ProbeEvidence): void {
  const inWindow = (rgstDt: string): boolean =>
    isAwardRegistrationTimestampInWindow(
      rgstDt,
      "202608190000",
      "202608192359",
    );

  let allRgstInWindow = true;
  let allFourPartNonblank = true;
  let allFourPartUnique = true;

  const keyCounts: Record<string, number> = {};
  const grainCounts: Record<string, number> = {};
  const terminalRows: AnyObj[] = [];

  for (const r of rows) {
    const noticeNo = getField(r, "bidNtceNo");
    const noticeOrder = getField(r, "bidNtceOrd");
    const bidClassNo = getField(r, "bidClsfcNo");
    const rebidNo = getField(r, "rbidNo");
    const rgstDt = getField(r, "rgstDt");
    const fnlSucsfDate = getField(r, "fnlSucsfDate");
    const bidwinnrBizno = getField(r, "bidwinnrBizno");
    const bidwinnrNm = getField(r, "bidwinnrNm");

    const fourNonblank = !!(noticeNo && noticeOrder && bidClassNo && rebidNo);
    if (!fourNonblank) allFourPartNonblank = false;

    if (fourNonblank) {
      const k = buildAwardSourceKey({
        noticeNo,
        noticeOrder,
        bidClassNo,
        rebidNo,
      });
      keyCounts[k] = (keyCounts[k] ?? 0) + 1;
      const grain = `${noticeNo}|${noticeOrder}|${bidClassNo}`;
      grainCounts[grain] = (grainCounts[grain] ?? 0) + 1;
    }

    if (!inWindow(rgstDt)) allRgstInWindow = false;

    terminalRows.push({
      bidNtceNo: noticeNo,
      bidNtceOrd: noticeOrder,
      bidClsfcNo: bidClassNo,
      rbidNo: rebidNo,
      rgstDt,
      fnlSucsfDate,
      bidwinnrBizno,
      bidwinnrNm,
    });
  }

  if (Object.values(keyCounts).some((c) => c !== 1)) allFourPartUnique = false;

  const nonempty = rows.length > 0;
  ev.checks.awardRegistrationWindow = nonempty && allRgstInWindow;
  ev.checks.awardFourPartIdentity =
    nonempty && allFourPartNonblank && allFourPartUnique;
  ev.checks.representativeWinner = hasRepresentativeWinnerIdentity(rows);
  ev.checks.terminalRebid = hasTerminalAwardFeedEvidence(rows);

  let awardMissingFinalDate = 0;
  for (const r of terminalRows) {
    if (!getField(r, "fnlSucsfDate")) awardMissingFinalDate += 1;
  }
  ev.counts.awardMissingFinalDate = awardMissingFinalDate;

  const grainCount = Object.keys(grainCounts).length;

  const seen = new Set<string>();
  const uniqTerminal: AnyObj[] = [];
  for (const r of terminalRows) {
    const k = buildAwardSourceKey({
      noticeNo: getField(r, "bidNtceNo"),
      noticeOrder: getField(r, "bidNtceOrd"),
      bidClassNo: getField(r, "bidClsfcNo"),
      rebidNo: getField(r, "rbidNo"),
    });
    if (seen.has(k)) continue;
    seen.add(k);
    uniqTerminal.push(r);
  }

  let unresolved: AnyObj | undefined;
  const resolvedRows: AnyObj[] = [];
  for (const r of uniqTerminal) {
    if (hasResolvedFinalAwardDate(r)) {
      resolvedRows.push(r);
    } else if (!unresolved) {
      unresolved = r;
    }
  }
  const fixtureRows = unresolved ? [unresolved, ...resolvedRows] : resolvedRows;
  const projected = fixtureRows.slice(0, 3).map((r) => ({
    bidNtceNo: getField(r, "bidNtceNo"),
    bidNtceOrd: getField(r, "bidNtceOrd"),
    bidClsfcNo: getField(r, "bidClsfcNo"),
    rbidNo: getField(r, "rbidNo"),
    rgstDt: getField(r, "rgstDt"),
    fnlSucsfDate: getField(r, "fnlSucsfDate"),
    bidwinnrBizno: getField(r, "bidwinnrBizno"),
    bidwinnrNm: getField(r, "bidwinnrNm"),
  }));
  ev.fixtures.awardPage = buildFixturePage(projected);
  ev.counts.awardUnresolvedFixtureItems = projected.filter(
    (r) => !hasResolvedFinalAwardDate(r),
  ).length;

  ev.counts.awardRows = rows.length;
  ev.counts.awardInWindow = rows.filter((r) =>
    inWindow(getField(r, "rgstDt")),
  ).length;
  ev.counts.awardUniqueKeys = Object.keys(keyCounts).length;
  ev.counts.awardTerminalRows = uniqTerminal.length;
  ev.counts.awardGrains = grainCount;
  ev.counts.awardFixtureItems = (
    ev.fixtures.awardPage as { page: { items: unknown[] } }
  ).page.items.length;
  ev.counts.awardPositiveRbidRows = terminalRows.filter((r) => {
    const n = Number(getField(r, "rbidNo"));
    return Number.isFinite(n) && n > 0;
  }).length;
}
/* ----------------------- designation fixture projections ----------------------- */

function projectDesignationRow(
  status: string,
  row: DesignationListRow | undefined,
): AnyObj {
  if (!row) {
    return {
      schemaVersion: SCHEMA_VERSION,
      status,
      totalCount: 0,
      items: [],
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    totalCount: 1,
    items: [
      {
        applVldYn: row.applVldYn,
        bzmnRegNo: row.bzmnRegNo,
        dsgnBgngYmd: row.dsgnBgngYmd,
        dsgnEndYmd: row.dsgnEndYmd,
        dsgnExtsYmd: row.dsgnExtsYmd,
        entNm: row.entNm,
        etpmDsgnCrfcNo: row.etpmDsgnCrfcNo,
        etpmDsgnDmndNo: row.etpmDsgnDmndNo,
        dsgnDmndChgOrd: row.dsgnDmndChgOrd,
        etpsSqno: row.etpsSqno,
        itemCfnm: row.itemCfnm,
      },
    ],
  };
}

function projectionDetailFixture(
  detail: DesignationDetailRow[] | undefined,
  keys: {
    etpmDsgnCrfcNo: string;
    etpmDsgnDmndNo: string;
    dsgnDmndChgOrd: string;
    etpsSqno: string;
  },
): AnyObj {
  return {
    schemaVersion: SCHEMA_VERSION,
    designationRequest: { ...keys },
    classifications: (detail ?? []).map((r) => ({ itemUntyNo: r.itemUntyNo })),
  };
}

/* ----------------------- main entrypoint ----------------------- */

export async function runBuildingControlApiContractProbe(): Promise<void> {
  const startedAt = nowIso();
  const ev: ProbeEvidence = {
    checks: initChecks(),
    counts: {},
    productDiscoveryStrategy: "none",
    selected: {},
    fixtures: {
      noticePage: {
        schemaVersion: SCHEMA_VERSION,
        page: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 0,
          items: [],
        },
      },
      purchaseTargetPage: {
        schemaVersion: SCHEMA_VERSION,
        page: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 0,
          items: [],
        },
      },
      awardPage: {
        schemaVersion: SCHEMA_VERSION,
        page: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 0,
          items: [],
        },
      },
      designationListValid: projectDesignationRow("\uC720\uD6A8", undefined),
      designationListExpired: projectDesignationRow("\uB9CC\uB8CC", undefined),
      designationListExtended: projectDesignationRow("\uC720\uD6A8", undefined),
      designationDetail: projectionDetailFixture(undefined, {
        etpmDsgnCrfcNo: "",
        etpmDsgnDmndNo: "",
        dsgnDmndChgOrd: "",
        etpsSqno: "",
      }),
    },
  };

  const generatedAt = nowIso();
  const candidateDir = join(
    REPORT_DIR,
    "candidates",
    generatedAt.replace(/[^0-9A-Za-z_-]/g, "-"),
  );
  let finalized = false;
  const reportPath = REPORT_FILE;
  const committedDir = FIXTURE_DIR;

  const writeCandidateFiles = async (
    bundle: Record<string, unknown>,
  ): Promise<Record<string, string>> => {
    for (const [name, data] of Object.entries(bundle)) {
      assertProbeFixtureSafe(data);
      assertBuildingControlFixtureProjection(name, data);
    }
    await mkdir(candidateDir, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [name, data] of Object.entries(bundle)) {
      const { hash } = await writeAtomicUtf8Json(
        join(candidateDir, name),
        data,
      );
      hashes[name] = hash;
    }
    return hashes;
  };

  const buildBundle = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      "notice-page.json": ev.fixtures.noticePage,
      "purchase-target-page.json": ev.fixtures.purchaseTargetPage,
      "award-page.json": ev.fixtures.awardPage,
      "designation-list-valid.json": ev.fixtures.designationListValid,
      "designation-list-expired.json": ev.fixtures.designationListExpired,
      "designation-list-extended.json": ev.fixtures.designationListExtended,
    };
    let count = 0;
    for (const _ of Object.keys(b)) count += 1;
    if (count !== 6) {
      throw new Error("bundle size mismatch (expected 6 before detail)");
    }
    b["designation-detail.json"] = ev.fixtures.designationDetail;
    let total = 0;
    for (const _ of Object.keys(b)) total += 1;
    if (total !== 7) {
      throw new Error("bundle size mismatch (expected 7)");
    }
    return b;
  };

  const buildReport = (
    passed: boolean,
    fixtureHashes: Record<string, string>,
    extra?: Record<string, unknown>,
  ): Record<string, unknown> => ({
    version: 1 as const,
    generatedAt,
    passed,
    productDiscoveryStrategy: ev.productDiscoveryStrategy,
    checks: ev.checks,
    fixtureSchemaVersion: SCHEMA_VERSION,
    fixtureHashes,
    counts: ev.counts,
    ...(extra ?? {}),
  });

  const finalizeFailed = async (
    reason: string,
    bundle: Record<string, unknown>,
  ): Promise<void> => {
    if (finalized) return;
    const sanitized = sanitizeProbeFixture(bundle) as Record<string, unknown>;
    let fixtureHashes: Record<string, string> = {};
    try {
      for (const data of Object.values(sanitized)) {
        assertProbeFixtureSafe(data);
      }
      assertProbeFixtureSafe(sanitized);
      fixtureHashes = await writeCandidateFiles(sanitized);
    } catch {
      fixtureHashes = {};
    }
    const report = buildReport(false, fixtureHashes, {
      failure: "probe_failed",
    });
    await writeAtomicUtf8Json(reportPath, report);
    finalized = true;
    process.exitCode = 1;
    safeLog(`api_contract=failed: ${redactString(reason)}`);
  };

  try {
    /* ---------- 1) public-data: notice (2026-08-19) ---------- */
    const notice = await collectPublicPages(
      {
        base: PUBLIC_BASE_GOODS,
        operation: "getBidPblancListInfoThng",
        extra: {
          inqryDiv: "1",
          inqryBgnDt: NOTICE_DAY.begin,
          inqryEndDt: NOTICE_DAY.end,
        },
      },
      "notice",
    );
    evaluateNotice(notice.rows, ev);

    /* ---------- 2) public-data: purchase-target (2026-08-19) ---------- */
    const purchase = await collectPublicPages(
      {
        base: PUBLIC_BASE_GOODS,
        operation: "getBidPblancListInfoThngPurchsObjPrdct",
        extra: {
          inqryDiv: "1",
          inqryBgnDt: NOTICE_DAY.begin,
          inqryEndDt: NOTICE_DAY.end,
        },
      },
      "purchase",
    );
    evaluatePurchaseTarget(purchase.rows, ev);

    /* ---------- 3) recall: server exact vs exhaustive local ---------- */
    const serverExact = await collectPublicPages(
      {
        base: PUBLIC_BASE_GOODS,
        operation: "getBidPblancListInfoThngPPSSrch",
        extra: {
          inqryDiv: "1",
          inqryBgnDt: RECALL_DAY.begin,
          inqryEndDt: RECALL_DAY.end,
          dtilPrdctClsfcNo: TARGET_DETAIL_CODE,
        },
      },
      "recall_server",
    );
    const exhaustive = await collectPublicPages(
      {
        base: PUBLIC_BASE_GOODS,
        operation: "getBidPblancListInfoThngPurchsObjPrdct",
        extra: {
          inqryDiv: "1",
          inqryBgnDt: RECALL_DAY.begin,
          inqryEndDt: RECALL_DAY.end,
        },
      },
      "recall_exhaustive",
    );
    evaluateRecall(serverExact.rows, exhaustive.rows, ev);

    /* ---------- 4) public-data: awards (2026-08-19) ---------- */
    const awards = await collectPublicPages(
      {
        base: PUBLIC_BASE_AWARDS,
        operation: "getScsbidListSttusThng",
        extra: {
          inqryDiv: "1",
          inqryBgnDt: NOTICE_DAY.begin,
          inqryEndDt: NOTICE_DAY.end,
        },
      },
      "award",
    );
    evaluateAwards(awards.rows, ev);

    /* ---------- 5) designation bootstrap + list pagination ---------- */
    const state: DesignationState = { cookiesByOrigin: {} };
    const referer = await bootstrapDesignation(state);

    const allStatus = await collectDesignationAll(state, referer, {
      applVldYn: "",
      itemCfnm: "",
    });
    ev.counts.designationAllRows = allStatus.rows.length;
    ev.counts.designationAllTotal = allStatus.totalCount;

    const observed = new Set<string>();
    let validCount = 0;
    let expiredCount = 0;
    let stoppedCount = 0;
    for (const r of allStatus.rows) {
      const s = String((r as AnyObj).applVldYn ?? "").trim();
      observed.add(s);
      if (s === "\uC720\uD6A8") validCount += 1;
      else if (s === "\uB9CC\uB8CC") expiredCount += 1;
      else if (s === "\uD6A8\uB825\uC815\uC9C0") stoppedCount += 1;
    }
    ev.counts.designationValidCount = validCount;
    ev.counts.designationExpiredCount = expiredCount;
    ev.counts.designationStoppedCount = stoppedCount;

    const validExplicit = await collectDesignationAll(state, referer, {
      applVldYn: "\uC720\uD6A8",
      itemCfnm: "",
    });
    const expiredExplicit = await collectDesignationAll(state, referer, {
      applVldYn: "\uB9CC\uB8CC",
      itemCfnm: "",
    });
    const stoppedExplicit = await collectDesignationAll(state, referer, {
      applVldYn: "\uD6A8\uB825\uC815\uC9C0",
      itemCfnm: "",
    });
    ev.counts.designationValidExplicit = validExplicit.totalCount;
    ev.counts.designationExpiredExplicit = expiredExplicit.totalCount;
    ev.counts.designationStoppedExplicit = stoppedExplicit.totalCount;

    ev.checks.designationStatusUnion =
      hasExactDesignationStatusUnion([...observed]) &&
      validExplicit.totalCount === validCount &&
      expiredExplicit.totalCount === expiredCount &&
      stoppedExplicit.totalCount === stoppedCount;

    const sampleSearch = await collectDesignationAll(state, referer, {
      applVldYn: "",
      itemCfnm: SAMPLE_TERM,
    });
    ev.counts.designationSampleRows = sampleSearch.rows.length;
    ev.counts.designationSampleTotal = sampleSearch.totalCount;

    /* ---------- 6) bounded sample discovery (details) ---------- */
    type Cand = DesignationListRow;
    const candidates: Cand[] = [];
    for (const r of sampleSearch.rows) {
      const s = String((r as AnyObj).applVldYn ?? "").trim();
      if (s !== "\uC720\uD6A8" && s !== "\uB9CC\uB8CC") continue;
      const cand: Cand = {
        applVldYn: s,
        bzmnRegNo: getField(r, "bzmnRegNo"),
        dsgnBgngYmd: getField(r, "dsgnBgngYmd"),
        dsgnEndYmd: getField(r, "dsgnEndYmd"),
        dsgnExtsYmd: getField(r, "dsgnExtsYmd"),
        entNm: getField(r, "entNm"),
        etpmDsgnCrfcNo: getField(r, "etpmDsgnCrfcNo"),
        etpmDsgnDmndNo: getField(r, "etpmDsgnDmndNo"),
        dsgnDmndChgOrd: getField(r, "dsgnDmndChgOrd"),
        etpsSqno: getField(r, "etpsSqno"),
        itemCfnm: getField(r, "itemCfnm"),
      };
      if (
        !cand.etpmDsgnCrfcNo ||
        !cand.etpmDsgnDmndNo ||
        !cand.dsgnDmndChgOrd ||
        !cand.etpsSqno
      ) {
        continue;
      }
      const bgng = normalizeDesignationDate(cand.dsgnBgngYmd);
      const end = normalizeDesignationDate(cand.dsgnEndYmd);
      if (!bgng || !end) {
        throw new Error("designation start/end date missing");
      }
      cand.dsgnBgngYmd = bgng;
      cand.dsgnEndYmd = end;
      cand.dsgnExtsYmd = normalizeDesignationDate(cand.dsgnExtsYmd) ?? "";
      candidates.push(cand);
    }
    ev.counts.designationCandidates = candidates.length;

    let designationExtensionBlank = 0;
    let designationExtensionAfterEnd = 0;
    let designationExtensionEqualEnd = 0;
    let designationExtensionBeforeEnd = 0;
    for (const c of candidates) {
      const end = c.dsgnEndYmd;
      if (!end || end.length === 0) {
        throw new Error("designation end date missing");
      }
      const exts = c.dsgnExtsYmd;
      if (!exts || exts.length === 0) {
        designationExtensionBlank += 1;
      } else if (exts > end) {
        designationExtensionAfterEnd += 1;
      } else if (exts === end) {
        designationExtensionEqualEnd += 1;
      } else {
        designationExtensionBeforeEnd += 1;
      }
    }
    ev.counts.designationExtensionBlank = designationExtensionBlank;
    ev.counts.designationExtensionAfterEnd = designationExtensionAfterEnd;
    ev.counts.designationExtensionEqualEnd = designationExtensionEqualEnd;
    ev.counts.designationExtensionBeforeEnd = designationExtensionBeforeEnd;

    let foundValid: {
      row: Cand;
      classifications: DesignationDetailRow[];
    } | null = null;
    let foundExpired: {
      row: Cand;
      classifications: DesignationDetailRow[];
    } | null = null;
    let foundExtended: {
      row: Cand;
      classifications: DesignationDetailRow[];
      extension: string;
      listedEnd: string;
    } | null = null;

    const detailBudget = Math.min(DESIG_DETAIL_MAX, candidates.length);
    for (let i = 0; i < detailBudget; i += 1) {
      const c = candidates[i];
      const detail = await designationDetail(state, {
        etpmDsgnCrfcNo: c.etpmDsgnCrfcNo,
        etpmDsgnDmndNo: c.etpmDsgnDmndNo,
        dsgnDmndChgOrd: c.dsgnDmndChgOrd,
        etpsSqno: c.etpsSqno,
      });
      const classifications = detail.rows.filter(
        (r) => normalizeUntyNo(r.itemUntyNo).length > 0,
      );
      const hasExact = classifications.some((r) => {
        const cls = classifyUntyNo(r.itemUntyNo);
        return cls === "parent" || cls === "detail";
      });
      if (!hasExact) continue;
      const status = detail.status || c.applVldYn;
      if (status === "\uC720\uD6A8" && !foundValid) {
        foundValid = { row: c, classifications };
      }
      if (status === "\uB9CC\uB8CC" && !foundExpired) {
        foundExpired = { row: c, classifications };
      }
      if (
        !foundExtended &&
        (status === "\uC720\uD6A8" || status === "\uB9CC\uB8CC")
      ) {
        if (
          hasDesignationExtensionEvidence({
            endDate: c.dsgnEndYmd,
            extensionDate: c.dsgnExtsYmd,
          })
        ) {
          foundExtended = {
            row: c,
            classifications,
            extension: c.dsgnExtsYmd,
            listedEnd: c.dsgnEndYmd,
          };
        }
      }
      if (foundValid && foundExpired && foundExtended) break;
    }

    ev.checks.designationValid = !!foundValid;
    ev.checks.designationExpired = !!foundExpired;
    ev.checks.designationExtended = !!foundExtended;

    ev.fixtures.designationListValid = projectDesignationRow(
      "\uC720\uD6A8",
      foundValid?.row,
    );
    ev.fixtures.designationListExpired = projectDesignationRow(
      "\uB9CC\uB8CC",
      foundExpired?.row,
    );

    if (foundExtended) {
      const extRow: Cand = {
        ...foundExtended.row,
        dsgnExtsYmd: foundExtended.extension,
        dsgnEndYmd: foundExtended.listedEnd,
        applVldYn: foundExtended.row.applVldYn,
      };
      ev.fixtures.designationListExtended = projectDesignationRow(
        extRow.applVldYn,
        extRow,
      );
    } else {
      ev.fixtures.designationListExtended = projectDesignationRow(
        "\uC720\uD6A8",
        undefined,
      );
    }

    const detailKeys = foundValid
      ? {
          etpmDsgnCrfcNo: foundValid.row.etpmDsgnCrfcNo,
          etpmDsgnDmndNo: foundValid.row.etpmDsgnDmndNo,
          dsgnDmndChgOrd: foundValid.row.dsgnDmndChgOrd,
          etpsSqno: foundValid.row.etpsSqno,
        }
      : {
          etpmDsgnCrfcNo: "",
          etpmDsgnDmndNo: "",
          dsgnDmndChgOrd: "",
          etpsSqno: "",
        };
    ev.fixtures.designationDetail = projectionDetailFixture(
      foundValid?.classifications ?? [],
      detailKeys,
    );

    ev.counts.designationDetailsRequested = detailBudget;
    ev.counts.designationValidFound = foundValid ? 1 : 0;
    ev.counts.designationExpiredFound = foundExpired ? 1 : 0;
    ev.counts.designationExtendedFound = foundExtended ? 1 : 0;

    /* ---------- ensure all required checks present ---------- */
    for (const k of BUILDING_CONTROL_REQUIRED_CHECKS) {
      if (typeof ev.checks[k] !== "boolean") {
        ev.checks[k] = false;
      }
    }

    const passed = BUILDING_CONTROL_REQUIRED_CHECKS.every(
      (k) => ev.checks[k] === true,
    );

    void startedAt;

    const bundle = buildBundle();
    const sanitized = sanitizeProbeFixture(bundle) as Record<string, unknown>;

    if (!passed) {
      throw new Error("required_check_failed");
    }

    for (const [name, data] of Object.entries(sanitized)) {
      assertProbeFixtureSafe(data);
      assertBuildingControlFixtureProjection(name, data);
    }

    const candidateHashes = await writeCandidateFiles(sanitized);

    const report = buildReport(true, candidateHashes);
    const parsed = parseApiContractReport(report);
    if (parsed.passed !== true) {
      throw new Error("report_passed_mismatch");
    }
    if (!shouldPromoteProbeFixtures(report)) {
      throw new Error("promotion_validation_failed");
    }

    const manifest = await publishFixtureGeneration({
      committedRoot: committedDir,
      bundle: sanitized,
      generatedAt,
    });

    const finalReport = buildReport(true, manifest.fixtureHashes, {
      fixtureGeneration: manifest.generationId,
    });
    await writeAtomicUtf8Json(reportPath, finalReport);
    finalized = true;
    safeLog("api_contract=passed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!finalized) {
      const bundle = buildBundle();
      try {
        await finalizeFailed(msg, bundle);
      } catch {
        process.exitCode = 1;
      }
    } else {
      process.exitCode = 1;
    }
    throw new Error(redactString(msg));
  }
}
