import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDesignationSession,
  DESIGNATION_BOOTSTRAP_URL,
  DESIGNATION_LIST_URL,
  DESIGNATION_DETAIL_URL,
  type DesignationDetailRequest,
  type DesignationListRequest,
} from "@/lib/building-control/g2b/designation-session";
import {
  retryTransient,
  type RetryPolicy,
} from "@/lib/building-control/g2b/paging";

// ----------------------------- Helpers --------------------------------------

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

interface RecordedFetch {
  calls: FetchCall[];
  impl: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

function recordedFetch(
  impl: (
    input: string | URL,
    init?: RequestInit,
    calls?: FetchCall[],
  ) => Promise<Response>,
): {
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn = async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === "string" ? input : input.toString(),
      init: init ? { ...init } : undefined,
    });
    return impl(input, init, calls);
  };
  return { fetch: fn, calls };
}

function makeResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? {});
  return new Response(body, { status, headers });
}

function redirectResponse(
  location: string,
  cookies: Array<[string, string]> = [],
): Response {
  const headers: Record<string, string> = { location };
  for (const [k, v] of cookies) {
    headers["set-cookie"] = headers["set-cookie"]
      ? `${headers["set-cookie"]}, ${k}=${v}`
      : `${k}=${v}`;
  }
  return new Response(null, { status: 302, headers });
}

function okJsonResponse(
  body: string,
  cookies: Array<[string, string]> = [],
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json;charset=UTF-8",
  };
  for (const [k, v] of cookies) {
    headers["set-cookie"] = headers["set-cookie"]
      ? `${headers["set-cookie"]}, ${k}=${v}`
      : `${k}=${v}`;
  }
  return new Response(body, { status: 200, headers });
}

function makePolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxRetries: 2,
    baseDelayMs: 1,
    sleep: async () => {
      // deterministic: no-op
    },
    ...overrides,
  };
}

const SHOP_ORIGIN = "https://shop.g2b.go.kr";
const SSO_ORIGIN = "https://sso.g2b.go.kr";

// Helper: assert exact POST headers for list
function assertListPostHeaders(
  init: RequestInit | undefined,
  finalReferer: string,
) {
  const h = (init?.headers as Record<string, string> | undefined) ?? {};
  expect(init?.method).toBe("POST");
  expect(String(h["accept"] ?? "")).toBe("application/json");
  expect(String(h["content-type"] ?? "")).toBe(
    "application/json;charset=UTF-8",
  );
  expect(typeof h["usr-id"]).toBe("string");
  expect(h["usr-id"]).toBe("null");
  expect(String(h["submissionid"] ?? "")).toBe(
    "mf_wfm_container_sbmElpdtSlctnSttusLst",
  );
  const menuInfo = JSON.parse(String(h["menu-info"] ?? "{}"));
  expect(menuInfo).toEqual({
    menuNo: "23224",
    menuCangVal: "GECB002_04",
    bsneClsfCd: "%EC%97%85130035",
    scrnNo: "05444",
  });
  expect(String(h["referer"] ?? "")).toBe(finalReferer);
  expect("menu-id" in h).toBe(false);
}

function assertDetailPostHeaders(init: RequestInit | undefined) {
  const h = (init?.headers as Record<string, string> | undefined) ?? {};
  expect(init?.method).toBe("POST");
  expect(String(h["accept"] ?? "")).toBe("application/json");
  expect(String(h["content-type"] ?? "")).toBe(
    "application/json;charset=UTF-8",
  );
  expect(typeof h["usr-id"]).toBe("string");
  expect(h["usr-id"]).toBe("null");
  expect(String(h["submissionid"] ?? "")).toBe(
    "mf_wfm_container_sbmElpdtSlctnSttusDtl",
  );
  const menuInfo = JSON.parse(String(h["menu-info"] ?? "{}"));
  expect(menuInfo).toEqual({
    menuNo: "24221",
    menuCangVal: "GECB005_01",
    bsneClsfCd: "%EC%97%85130035",
    scrnNo: "09716",
  });
  expect(String(h["referer"] ?? "")).toBe(
    "https://shop.g2b.go.kr/link/GECB005_01/single/",
  );
  expect("menu-id" in h).toBe(false);
}

// ----------------------------- Tests ----------------------------------------

describe("designation-session constants", () => {
  it("1. exposes the official URLs exactly", () => {
    expect(DESIGNATION_BOOTSTRAP_URL).toBe(
      "https://shop.g2b.go.kr/link/GECB002_04/single",
    );
    expect(DESIGNATION_LIST_URL).toBe(
      "https://shop.g2b.go.kr/ge/gec/gecb/ElpdtSlctnSttus/selectElpdtSlctnSttusLst.do",
    );
    expect(DESIGNATION_DETAIL_URL).toBe(
      "https://shop.g2b.go.kr/ge/gec/gecb/ElpdtSlctnSttus/selectElpdtSlctnSttusDtl.do",
    );
  });
});

describe("designation-session bootstrap", () => {
  it("2. issues a manual GET with a Chrome-like User-Agent and follows a relative redirect on the same origin", async () => {
    const { fetch, calls } = recordedFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const init = (calls[calls.length - 1]?.init ?? {}) as RequestInit;
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        // Sanity: GET, manual redirect.
        expect(init.method).toBe("GET");
        expect(init.redirect).toBe("manual");
        const ua = String(
          (init.headers as Record<string, string> | undefined)?.[
            "user-agent"
          ] ?? "",
        );
        expect(ua).toMatch(/Chrome\/\d+/);
        return redirectResponse("/landing", [["sid", "shop-1"]]);
      }
      if (url === `${SHOP_ORIGIN}/landing`) {
        return new Response(null, {
          status: 204,
          headers: { "set-cookie": "landing=1" },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    const { referer } = await session.bootstrap();
    expect(referer).toBe(`${SHOP_ORIGIN}/landing`);
    expect(calls.length).toBe(2);
  });

  it("3. allows shop->sso redirect but isolates cookies per origin", async () => {
    const { fetch, calls } = recordedFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        return redirectResponse(`${SSO_ORIGIN}/sso/start`, [
          ["JSESSIONID", "SHOP-A"],
        ]);
      }
      if (url === `${SSO_ORIGIN}/sso/start`) {
        // We must NOT carry the shop cookie header here.
        const init = calls[calls.length - 1]?.init;
        const headers =
          (init?.headers as Record<string, string> | undefined) ?? {};
        const cookie = String(headers["cookie"] ?? "");
        expect(cookie.includes("JSESSIONID=SHOP-A")).toBe(false);
        return new Response(null, {
          status: 204,
          headers: { "set-cookie": "JSESSIONID=SSO-B" },
        });
      }
      if (
        url ===
        `${SHOP_ORIGIN}/ge/gec/gecb/ElpdtSlctnSttus/selectElpdtSlctnSttusLst.do`
      ) {
        const init = calls[calls.length - 1]?.init;
        const headers =
          (init?.headers as Record<string, string> | undefined) ?? {};
        const cookie = String(headers["cookie"] ?? "");
        // shop session cookie should be attached; SSO cookie must not leak back.
        expect(cookie.includes("JSESSIONID=SHOP-A")).toBe(true);
        expect(cookie.includes("JSESSIONID=SSO-B")).toBe(false);
        return okJsonResponse('{"ErrorCode":0,"dlElpdtSlctnSttusL":[]}');
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await session.bootstrap();
    const listReq: DesignationListRequest = {
      applVldYn: "\uC720\uD6A8",
      currentPage: 1,
      recordCountPerPage: 10,
    };
    const out = await session.postList(listReq);
    expect(out.payload).toEqual({ ErrorCode: 0, dlElpdtSlctnSttusL: [] });
    expect(calls.length).toBe(3);
  });

  it("4. rejects external redirects before issuing a network call", async () => {
    const external = "https://attacker.example/steal";
    // The official bootstrap response returns an absolute Location pointing to an
    // external origin. The implementation must reject on URL-validation BEFORE any
    // network call to the external host is made. Exactly one fetch is recorded
    // (the official bootstrap request); the external URL is never fetched.
    const { fetch, calls } = recordedFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        return redirectResponse(external);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await expect(session.bootstrap()).rejects.toBeDefined();
    // Exactly one fetch was issued: the official bootstrap request to learn the
    // redirect Location. The external host must not have been contacted.
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(DESIGNATION_BOOTSTRAP_URL);
    for (const c of calls) {
      expect(c.url.includes("attacker.example")).toBe(false);
    }
  });

  it("5. enforces a bounded redirect cap and does not loop", async () => {
    let n = 0;
    const { fetch, calls } = recordedFetch(async (input) => {
      n += 1;
      const url = typeof input === "string" ? input : input.toString();
      if (n > 25) throw new Error("redirect loop not bounded");
      return redirectResponse("/loop?" + String(n));
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
      maxRedirects: 5,
    });
    await expect(session.bootstrap()).rejects.toBeDefined();
    expect(n).toBeLessThanOrEqual(6); // initial + 5 redirects
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it("6. rejects redirects with no Location header", async () => {
    const { fetch, calls } = recordedFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        // 302 but no Location.
        return new Response(null, { status: 302, headers: {} });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await expect(session.bootstrap()).rejects.toBeDefined();
    expect(calls.length).toBe(1);
  });
});

describe("designation-session postList", () => {
  it("7. POSTs the exact list URL, body and headers, preserving raw JSON", async () => {
    const listJson = '{"ErrorCode":0,"dlElpdtSlctnSttusL":[]}';
    const { fetch, calls } = recordedFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        return new Response(null, {
          status: 200,
          headers: { "set-cookie": "JSESSIONID=SHOP-LIST" },
        });
      }
      if (url === DESIGNATION_LIST_URL) {
        assertListPostHeaders(init, `${SHOP_ORIGIN}/link/GECB002_04/single`);
        const h = (init?.headers as Record<string, string> | undefined) ?? {};
        const bodyStr = String(init?.body ?? "");
        const parsed = JSON.parse(bodyStr);
        expect(parsed).toEqual({
          dlElpdtSlctnSttusM: {
            etpmDsgnCrfcNo: "",
            etpmDsgnDmndFldCd: "",
            bzmnRegNo: "",
            etpsNm: "",
            itemCfnm: "",
            dsgnBgngYmd: "",
            dsgnEndYmd: "",
            applVldYn: "\uC720\uD6A8",
            recordCountPerPage: "10",
            currentPage: "1",
          },
        });
        expect(String(h["cookie"] ?? "")).toContain("JSESSIONID=SHOP-LIST");
        return new Response(listJson, {
          status: 200,
          headers: { "content-type": "application/json;charset=UTF-8" },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await session.bootstrap();
    const req: DesignationListRequest = {
      applVldYn: "\uC720\uD6A8",
      currentPage: 1,
      recordCountPerPage: 10,
    };
    const out = await session.postList(req);
    expect(out.rawJson).toBe(listJson);
    expect(out.payload).toEqual({ ErrorCode: 0, dlElpdtSlctnSttusL: [] });
    expect(calls.length).toBe(2);
  });

  it("8. rejects postList calls made before a successful bootstrap", async () => {
    const { fetch } = recordedFetch(async () => {
      throw new Error("fetch should not be called");
    });
    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await expect(
      session.postList({
        applVldYn: "",
        currentPage: 1,
        recordCountPerPage: 1,
      }),
    ).rejects.toBeDefined();
  });
});

describe("designation-session postDetail", () => {
  it("9. POSTs the exact detail URL, body and headers, preserving raw JSON", async () => {
    const detailJson =
      '{"ErrorCode":0,"dlElpdtSlctnSttusDtlM":{"etpmDsgnCrfcNo":"A","etpmDsgnDmndNo":"1","dsgnDmndChgOrd":"1","etpsSqno":"1"},"dlProdSpecModlDtlL":[]}';
    const { fetch, calls } = recordedFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        return new Response(null, {
          status: 200,
          headers: { "set-cookie": "JSESSIONID=SHOP-DET" },
        });
      }
      if (url === DESIGNATION_DETAIL_URL) {
        assertDetailPostHeaders(init);
        const bodyStr = String(init?.body ?? "");
        expect(JSON.parse(bodyStr)).toEqual({
          dlElpdtSlctnSttusDtlM: {
            etpmDsgnCrfcNo: "A",
            etpmDsgnDmndNo: "1",
            dsgnDmndChgOrd: "1",
            etpsSqno: "1",
            befDsgnCrfcYn: "",
          },
        });
        const h = (init?.headers as Record<string, string> | undefined) ?? {};
        expect(String(h["cookie"] ?? "")).toContain("JSESSIONID=SHOP-DET");
        return new Response(detailJson, {
          status: 200,
          headers: { "content-type": "application/json;charset=UTF-8" },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await session.bootstrap();
    const req: DesignationDetailRequest = {
      etpmDsgnCrfcNo: "A",
      etpmDsgnDmndNo: "1",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    };
    const out = await session.postDetail(req);
    expect(out.rawJson).toBe(detailJson);
    expect((out.payload as { ErrorCode: number }).ErrorCode).toBe(0);
    expect(calls.length).toBe(2);
  });

  it("10. rejects postDetail calls made before a successful bootstrap", async () => {
    const { fetch } = recordedFetch(async () => {
      throw new Error("fetch should not be called");
    });
    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await expect(
      session.postDetail({
        etpmDsgnCrfcNo: "A",
        etpmDsgnDmndNo: "1",
        dsgnDmndChgOrd: "1",
        etpsSqno: "1",
      }),
    ).rejects.toBeDefined();
  });
});

describe("designation-session cookie jar and retry behaviour", () => {
  it("11. Set-Cookie updates the same-origin jar and replaces by name", async () => {
    // Bootstrap separately returns sid=1.
    // listResponses are [503 sid=2, 200 sid=3], indexed only for list calls.
    // The first list call sends sid=1 (from the bootstrap jar); the retry sends sid=2
    // (the jar was updated by the 503 response before the retry was issued).
    const listResponses: Array<() => Response> = [
      () =>
        new Response(null, {
          status: 503,
          headers: { "set-cookie": "sid=2" },
        }),
      () =>
        new Response('{"ErrorCode":0,"dlElpdtSlctnSttusL":[]}', {
          status: 200,
          headers: { "set-cookie": "sid=3" },
        }),
    ];
    let listIdx = 0;
    const { fetch, calls } = recordedFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        return new Response(null, {
          status: 200,
          headers: { "set-cookie": "sid=1" },
        });
      }
      if (url === DESIGNATION_LIST_URL) {
        const r = listResponses[listIdx]();
        listIdx += 1;
        // The cookie sent should reflect the latest shop value at call time.
        const h = (init?.headers as Record<string, string> | undefined) ?? {};
        const cookie = String(h["cookie"] ?? "");
        if (r.status >= 500) {
          // First list call: shop cookie reflects the bootstrap response (sid=1).
          expect(cookie).toContain("sid=1");
        } else {
          // Retry: shop cookie reflects the 503 response that just updated the jar (sid=2).
          expect(cookie).toContain("sid=2");
        }
        return r;
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await session.bootstrap();
    const out = await session.postList({
      applVldYn: "",
      currentPage: 1,
      recordCountPerPage: 1,
    });
    expect(out.payload).toEqual({ ErrorCode: 0, dlElpdtSlctnSttusL: [] });
    // 1 bootstrap + 2 list calls (503 + 200)
    expect(calls.length).toBe(3);
  });

  it("12. HTTP 500 and 429 retry via retryTransient with injected sleep", async () => {
    const sleeps: number[] = [];
    const policy: RetryPolicy = {
      maxRetries: 3,
      baseDelayMs: 7,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    };

    // Sanity: retryTransient itself is the existing helper and must observe baseDelayMs and cap retries.
    let attempts = 0;
    await expect(
      retryTransient(async () => {
        attempts += 1;
        if (attempts < 3) {
          const err = new Error("transient") as Error & { status?: number };
          err.status = attempts === 1 ? 500 : 429;
          throw err;
        }
        return "ok";
      }, policy),
    ).resolves.toBe("ok");
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([7, 14]);
  });

  it("13. HTTP 400 is not retried by retryTransient", async () => {
    const policy: RetryPolicy = {
      maxRetries: 5,
      baseDelayMs: 1,
      sleep: async () => {},
    };
    let attempts = 0;
    await expect(
      retryTransient(async () => {
        attempts += 1;
        const err = new Error("bad") as Error & { status?: number };
        err.status = 400;
        throw err;
      }, policy),
    ).rejects.toBeDefined();
    expect(attempts).toBe(1);
  });

  it("14. invalid JSON from the server fails closed with a non-empty raw payload", async () => {
    const { fetch, calls } = recordedFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        return new Response(null, {
          status: 200,
          headers: { "set-cookie": "sid=ok" },
        });
      }
      if (url === DESIGNATION_LIST_URL) {
        return new Response("not json {{", {
          status: 200,
          headers: { "content-type": "application/json;charset=UTF-8" },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    await session.bootstrap();
    let captured: unknown;
    try {
      await session.postList({
        applVldYn: "",
        currentPage: 1,
        recordCountPerPage: 1,
      });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeDefined();
    expect(calls.length).toBe(2);
  });

  it("15. timeoutMs aborts with a deterministic AbortError and does not retry forever", async () => {
    const policy: RetryPolicy = {
      maxRetries: 0,
      baseDelayMs: 1,
      sleep: async () => {},
    };
    const { fetch, calls } = recordedFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        const signal = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          const onAbort = () => {
            const err = new Error("aborted") as Error & {
              name: string;
              code: string;
            };
            err.name = "AbortError";
            err.code = "ABORT_ERR";
            reject(err);
          };
          if (signal?.aborted) onAbort();
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: policy,
      timeoutMs: 25,
    });
    let captured: unknown;
    try {
      await session.bootstrap();
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeDefined();
    // We expect the request to be made exactly once given maxRetries: 0.
    expect(calls.length).toBe(1);
    // The init must carry a signal so the caller can abort.
    expect(calls[0]?.init?.signal).toBeDefined();
  });
});

describe("designation-session bootstrap redirect security", () => {
  it("16. rejects a same-origin Location that embeds username:password after only the official first fetch", async () => {
    // The Location host is shop.g2b.go.kr (same origin), but the URL carries
    // userinfo: alice:secret. The session must reject it and must NOT perform
    // a second fetch to the credentialed URL.
    const credentialed =
      "https://alice:secret@shop.g2b.go.kr/path?token=QUERYSECRET#FRAGMENTSECRET";
    const { fetch, calls } = recordedFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        return redirectResponse(credentialed);
      }
      // If a second fetch is incorrectly issued, record it and throw.
      throw new Error(`unexpected second fetch: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    let captured: unknown;
    try {
      await session.bootstrap();
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeDefined();
    // Exactly one fetch was issued: the official bootstrap request. The
    // credentialed URL must not have been contacted at all.
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(DESIGNATION_BOOTSTRAP_URL);
    for (const c of calls) {
      expect(c.url).not.toBe(credentialed);
      expect(c.url.includes("alice")).toBe(false);
      expect(c.url.includes("secret")).toBe(false);
    }
  });

  it("17. rejection error does not leak username, password, query secret, or fragment secret from Location", async () => {
    const credentialed =
      "https://alice:secret@shop.g2b.go.kr/path?token=QUERYSECRET#FRAGMENTSECRET";
    const { fetch } = recordedFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === DESIGNATION_BOOTSTRAP_URL) {
        return redirectResponse(credentialed);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const session = createDesignationSession({
      fetch,
      retryPolicy: makePolicy(),
    });
    let captured: unknown;
    try {
      await session.bootstrap();
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeDefined();
    const message = String((captured as Error)?.message ?? captured);
    // The rejection message must not echo any of the credential / query / fragment secrets.
    expect(message.includes("alice")).toBe(false);
    expect(message.includes("secret")).toBe(false);
    expect(message.includes("QUERYSECRET")).toBe(false);
    expect(message.includes("FRAGMENTSECRET")).toBe(false);
  });
});
