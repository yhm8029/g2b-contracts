// src/lib/building-control/g2b/designation-session.ts
// G2B designation session. Manual redirects, per-origin cookie jars,
// strict origin allowlist, transient retry via retryTransient, AbortController timeout.
// TypeScript 5.7. No global fetch, no logger, no filesystem, no env, no secrets.

import {
  validateRetryPolicy,
  retryTransient,
  type RetryPolicy,
} from "@/lib/building-control/g2b/paging";
import type { DesignationListRequest } from "@/lib/building-control/g2b/designation-list-client";
import type { DesignationDetailRequest } from "@/lib/building-control/g2b/designation-detail-client";

export type { DesignationListRequest, DesignationDetailRequest };

// ----------------------------- Constants ------------------------------------

export const DESIGNATION_BOOTSTRAP_URL =
  "https://shop.g2b.go.kr/link/GECB002_04/single";
export const DESIGNATION_LIST_URL =
  "https://shop.g2b.go.kr/ge/gec/gecb/ElpdtSlctnSttus/selectElpdtSlctnSttusLst.do";
export const DESIGNATION_DETAIL_URL =
  "https://shop.g2b.go.kr/ge/gec/gecb/ElpdtSlctnSttus/selectElpdtSlctnSttusDtl.do";

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://shop.g2b.go.kr",
  "https://sso.g2b.go.kr",
]);

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_MAX_REDIRECTS = 8;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_REDIRECT_BOUND = 64;

// ----------------------------- Types ----------------------------------------

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface DesignationSessionOptions {
  readonly fetch: FetchLike;
  readonly retryPolicy: RetryPolicy;
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

// Transport-level response payloads for each network call.
// Renamed for clarity: these describe the raw transport response
// (the bytes returned by the server + the parsed JSON payload).
export interface DesignationBootstrapTransportResult {
  readonly referer: string;
}

export interface DesignationListTransportResult {
  readonly rawJson: string;
  readonly payload: unknown;
}

export interface DesignationDetailTransportResult {
  readonly rawJson: string;
  readonly payload: unknown;
}

// Canonical transport result name (requested by RED tests).
export type DesignationSessionTransportResult =
  | DesignationListTransportResult
  | DesignationDetailTransportResult
  | DesignationBootstrapTransportResult;

// Backwards-compatible aliases for existing tests.
export type DesignationBootstrapResult = DesignationBootstrapTransportResult;
export type DesignationListResult = DesignationListTransportResult;
export type DesignationDetailResult = DesignationDetailTransportResult;

export interface DesignationSession {
  bootstrap(): Promise<DesignationBootstrapTransportResult>;
  postList(
    req: DesignationListRequest,
  ): Promise<DesignationListTransportResult>;
  postDetail(
    req: DesignationDetailRequest,
  ): Promise<DesignationDetailTransportResult>;
}

// ----------------------------- Helpers --------------------------------------

function originOf(url: string): string {
  const u = new URL(url);
  return u.origin;
}

function isAllowedOrigin(url: string): boolean {
  try {
    const o = originOf(url);
    return ALLOWED_ORIGINS.has(o);
  } catch {
    return false;
  }
}

function hasCredentials(url: string): boolean {
  try {
    const u = new URL(url);
    return u.username.length > 0 || u.password.length > 0;
  } catch {
    return false;
  }
}

function resolveLocation(currentUrl: string, location: string): string {
  return new URL(location, currentUrl).toString();
}

interface CookieJar {
  readonly values: Map<string, string>;
}

function createJar(): CookieJar {
  return { values: new Map<string, string>() };
}

function applySetCookieHeader(jar: CookieJar, header: string | null): void {
  if (header === null || header.length === 0) return;
  // set-cookie headers may be combined; entries are comma-separated, but each
  // entry may contain commas in the Expires attribute. Use a regex split.
  const parts = header.split(/,(?=[^;]+?=)/);
  for (const raw of parts) {
    const segment = raw.trim();
    if (segment.length === 0) continue;
    const first = segment.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name.length === 0) continue;
    jar.values.set(name, value);
  }
}

function captureSetCookie(headers: Headers): string | null {
  // getSetCookie is available in modern environments; fall back to combined header.
  const fn = (headers as unknown as { getSetCookie?: () => string[] })
    .getSetCookie;
  if (typeof fn === "function") {
    const arr = fn.call(headers);
    if (arr.length === 0) return null;
    return arr.join(", ");
  }
  return headers.get("set-cookie");
}

function jarToHeader(jar: CookieJar): string {
  const parts: string[] = [];
  for (const [k, v] of jar.values) {
    parts.push(k + "=" + v);
  }
  return parts.join("; ");
}

function ensureIntegerString(v: number | string): string {
  if (typeof v === "number") {
    if (!Number.isInteger(v)) {
      throw new Error("designation-session: numeric field must be an integer");
    }
    return String(v);
  }
  return v;
}

function httpStatusError(status: number): Error & { status: number } {
  const err = new Error(
    "designation-session: HTTP " + String(status),
  ) as Error & { status: number };
  err.status = status;
  return err;
}

// ----------------------------- Per-origin jars -------------------------------

interface SessionState {
  readonly jars: Map<string, CookieJar>;
  referer: string | null;
}

function jarFor(state: SessionState, origin: string): CookieJar {
  let jar = state.jars.get(origin);
  if (jar === undefined) {
    jar = createJar();
    state.jars.set(origin, jar);
  }
  return jar;
}

// ----------------------------- Network primitive ----------------------------

interface FetchAttemptOptions {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body: string | undefined;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal | undefined;
  readonly state: SessionState;
  readonly followRedirects: boolean;
  readonly maxRedirects: number;
  readonly fetch: FetchLike;
}

interface FetchAttemptResult {
  readonly response: Response;
  readonly finalUrl: string;
}

async function fetchWithJar(
  opts: FetchAttemptOptions,
): Promise<FetchAttemptResult> {
  const { fetch, state, followRedirects, maxRedirects, url } = opts;

  if (!isAllowedOrigin(url)) {
    throw new Error(
      "designation-session: refusing request to disallowed origin",
    );
  }
  if (hasCredentials(url)) {
    throw new Error(
      "designation-session: refusing request with embedded credentials",
    );
  }

  let currentUrl = url;
  let redirectsLeft = maxRedirects;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!isAllowedOrigin(currentUrl)) {
      throw new Error(
        "designation-session: refusing request to disallowed origin",
      );
    }
    if (hasCredentials(currentUrl)) {
      throw new Error(
        "designation-session: refusing request with embedded credentials",
      );
    }

    // Resolve the per-origin jar IMMEDIATELY before each request. This is the
    // minimal fix that prevents a shop->sso redirect from carrying shop
    // cookies to sso (and vice versa). Each origin keeps its own jar, and a
    // request to origin O only ever sends O's cookies.
    const requestOrigin = originOf(currentUrl);
    const requestJar = jarFor(state, requestOrigin);
    const cookieHeader = jarToHeader(requestJar);

    const headers: Record<string, string> = { ...opts.headers };
    if (headers["accept"] === undefined || headers["accept"].length === 0) {
      headers["accept"] = "*/*";
    }
    if (cookieHeader.length > 0) {
      headers["cookie"] = cookieHeader;
    }

    const init: RequestInit = {
      method: opts.method,
      headers,
      redirect: "manual",
    };
    if (opts.body !== undefined) {
      init.body = opts.body;
    }
    if (opts.signal !== undefined) {
      init.signal = opts.signal;
    }

    const response = await fetch(currentUrl, init);

    // Capture Set-Cookie on the origin we just contacted. Only the jar for
    // the responding origin is updated; other origins' jars are untouched.
    const responseUrl = response.url || currentUrl;
    if (isAllowedOrigin(responseUrl) && !hasCredentials(responseUrl)) {
      const responseOrigin = originOf(responseUrl);
      const responseJar = jarFor(state, responseOrigin);
      const setCookie = captureSetCookie(response.headers);
      applySetCookieHeader(responseJar, setCookie);
    }

    if (
      followRedirects &&
      (response.status === 301 ||
        response.status === 302 ||
        response.status === 303 ||
        response.status === 307 ||
        response.status === 308)
    ) {
      const location = response.headers.get("location");
      if (location === null || location.length === 0) {
        throw new Error(
          "designation-session: redirect without Location header",
        );
      }
      if (redirectsLeft <= 0) {
        throw new Error("designation-session: redirect limit exceeded");
      }
      const nextUrl = resolveLocation(currentUrl, location);
      // Validate the next URL against the allowlist AND reject credentialed
      // URLs before any second fetch is issued.
      if (!isAllowedOrigin(nextUrl) || hasCredentials(nextUrl)) {
        throw new Error("designation-session: refusing redirect target");
      }
      currentUrl = nextUrl;
      redirectsLeft -= 1;
      // Drain body for redirect responses to release sockets.
      try {
        await response.text();
      } catch {
        // ignore
      }
      continue;
    }

    return { response, finalUrl: currentUrl };
  }
}

// ----------------------------- Factory --------------------------------------

export function createDesignationSession(
  options: DesignationSessionOptions,
): DesignationSession {
  const { fetch, retryPolicy } = options;

  // Validate retry policy (maxRetries, baseDelayMs, optional maxDelayMs).
  validateRetryPolicy(retryPolicy);

  // Validate and normalize maxRedirects.
  let maxRedirects: number;
  if (options.maxRedirects === undefined) {
    maxRedirects = DEFAULT_MAX_REDIRECTS;
  } else if (
    typeof options.maxRedirects !== "number" ||
    !Number.isInteger(options.maxRedirects) ||
    options.maxRedirects < 0 ||
    options.maxRedirects > MAX_REDIRECT_BOUND
  ) {
    throw new Error(
      "designation-session: maxRedirects must be a non-negative integer within " +
        String(MAX_REDIRECT_BOUND),
    );
  } else {
    maxRedirects = options.maxRedirects;
  }

  // Validate and normalize timeoutMs. The session always has a finite
  // default timeout (30 seconds), so we never operate unboundedly.
  let timeoutMs: number;
  if (options.timeoutMs === undefined) {
    timeoutMs = DEFAULT_TIMEOUT_MS;
  } else if (
    typeof options.timeoutMs !== "number" ||
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      "designation-session: timeoutMs must be a positive finite number within " +
        String(MAX_TIMEOUT_MS) +
        " milliseconds",
    );
  } else {
    timeoutMs = options.timeoutMs;
  }

  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const state: SessionState = {
    jars: new Map<string, CookieJar>(),
    referer: null,
  };

  function newAbortController(): {
    controller: AbortController;
    clear: () => void;
  } {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }, timeoutMs);
    }
    const clear = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return { controller, clear };
  }

  async function doBootstrap(): Promise<DesignationBootstrapTransportResult> {
    const { controller, clear } = newAbortController();
    try {
      const headers: Record<string, string> = {
        "user-agent": userAgent,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      };
      const { response, finalUrl } = await fetchWithJar({
        method: "GET",
        url: DESIGNATION_BOOTSTRAP_URL,
        body: undefined,
        headers,
        signal: controller.signal,
        state,
        followRedirects: true,
        maxRedirects,
        fetch,
      });

      // Bootstrap is a navigation; we treat any 2xx, 3xx-already-followed, or
      // 204 as success. Non-2xx final responses should be retried as transient
      // if eligible, otherwise fail closed.
      if (response.status >= 200 && response.status < 400) {
        // Drain body to release resources.
        try {
          await response.text();
        } catch {
          // ignore
        }
        state.referer = finalUrl;
        return { referer: finalUrl };
      }
      if (
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599)
      ) {
        // Drain body to release resources.
        try {
          await response.text();
        } catch {
          // ignore
        }
        throw httpStatusError(response.status);
      }
      try {
        await response.text();
      } catch {
        // ignore
      }
      throw new Error(
        "designation-session: bootstrap failed with HTTP " +
          String(response.status),
      );
    } finally {
      clear();
    }
  }

  async function bootstrap(): Promise<DesignationBootstrapTransportResult> {
    return retryTransient(doBootstrap, retryPolicy);
  }

  function requireBootstrap(): string {
    if (state.referer === null) {
      throw new Error(
        "designation-session: bootstrap must complete before this call",
      );
    }
    return state.referer;
  }

  async function doPostList(
    req: DesignationListRequest,
  ): Promise<DesignationListTransportResult> {
    const referer = requireBootstrap();

    const body = JSON.stringify({
      dlElpdtSlctnSttusM: {
        etpmDsgnCrfcNo: "",
        etpmDsgnDmndFldCd: "",
        bzmnRegNo: "",
        etpsNm: "",
        itemCfnm: "",
        dsgnBgngYmd: "",
        dsgnEndYmd: "",
        applVldYn: req.applVldYn,
        recordCountPerPage: ensureIntegerString(req.recordCountPerPage),
        currentPage: ensureIntegerString(req.currentPage),
      },
    });

    const headers: Record<string, string> = {
      "user-agent": userAgent,
      "content-type": "application/json;charset=UTF-8",
      accept: "application/json",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      referer,
      "x-requested-with": "XMLHttpRequest",
      submissionid: "mf_wfm_container_sbmElpdtSlctnSttusLst",
      "menu-info": JSON.stringify({
        menuNo: "23224",
        menuCangVal: "GECB002_04",
        bsneClsfCd: "%EC%97%85130035",
        scrnNo: "05444",
      }),
      "usr-id": "null",
    };

    const { controller, clear } = newAbortController();
    try {
      const { response } = await fetchWithJar({
        method: "POST",
        url: DESIGNATION_LIST_URL,
        body,
        headers,
        signal: controller.signal,
        state,
        followRedirects: false,
        maxRedirects,
        fetch,
      });

      if (
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599)
      ) {
        try {
          await response.text();
        } catch {
          // ignore
        }
        throw httpStatusError(response.status);
      }
      if (response.status < 200 || response.status >= 300) {
        try {
          await response.text();
        } catch {
          // ignore
        }
        throw new Error(
          "designation-session: list request failed with HTTP " +
            String(response.status),
        );
      }

      const rawJson = await response.text();
      if (rawJson.length === 0) {
        throw new Error("designation-session: list response body is empty");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(rawJson);
      } catch {
        throw new Error("designation-session: list response is not valid JSON");
      }
      return { rawJson, payload };
    } finally {
      clear();
    }
  }

  async function postList(
    req: DesignationListRequest,
  ): Promise<DesignationListTransportResult> {
    return retryTransient(() => doPostList(req), retryPolicy);
  }

  async function doPostDetail(
    req: DesignationDetailRequest,
  ): Promise<DesignationDetailTransportResult> {
    const referer = requireBootstrap();

    const body = JSON.stringify({
      dlElpdtSlctnSttusDtlM: {
        etpmDsgnCrfcNo: req.etpmDsgnCrfcNo,
        etpmDsgnDmndNo: req.etpmDsgnDmndNo,
        dsgnDmndChgOrd: req.dsgnDmndChgOrd,
        etpsSqno: req.etpsSqno,
        befDsgnCrfcYn: "",
      },
    });

    const headers: Record<string, string> = {
      "user-agent": userAgent,
      "content-type": "application/json;charset=UTF-8",
      accept: "application/json",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      referer: "https://shop.g2b.go.kr/link/GECB005_01/single/",
      "x-requested-with": "XMLHttpRequest",
      submissionid: "mf_wfm_container_sbmElpdtSlctnSttusDtl",
      "menu-info": JSON.stringify({
        menuNo: "24221",
        menuCangVal: "GECB005_01",
        bsneClsfCd: "%EC%97%85130035",
        scrnNo: "09716",
      }),
      "usr-id": "null",
    };

    const { controller, clear } = newAbortController();
    try {
      const { response } = await fetchWithJar({
        method: "POST",
        url: DESIGNATION_DETAIL_URL,
        body,
        headers,
        signal: controller.signal,
        state,
        followRedirects: false,
        maxRedirects,
        fetch,
      });

      if (
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599)
      ) {
        try {
          await response.text();
        } catch {
          // ignore
        }
        throw httpStatusError(response.status);
      }
      if (response.status < 200 || response.status >= 300) {
        try {
          await response.text();
        } catch {
          // ignore
        }
        throw new Error(
          "designation-session: detail request failed with HTTP " +
            String(response.status),
        );
      }

      const rawJson = await response.text();
      if (rawJson.length === 0) {
        throw new Error("designation-session: detail response body is empty");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(rawJson);
      } catch {
        throw new Error(
          "designation-session: detail response is not valid JSON",
        );
      }
      return { rawJson, payload };
    } finally {
      clear();
    }
  }

  async function postDetail(
    req: DesignationDetailRequest,
  ): Promise<DesignationDetailTransportResult> {
    return retryTransient(() => doPostDetail(req), retryPolicy);
  }

  return {
    bootstrap,
    postList,
    postDetail,
  };
}
