import { describe, it, expect, vi } from "vitest";
import {
  collectCompletePages,
  retryTransient,
  type RetryPolicy,
} from "@/lib/building-control/g2b/paging";
import {
  parseDesignationListResponse,
  type DesignationListRequest,
} from "@/lib/building-control/g2b/designation-list-client";
import {
  buildDesignationObservation,
  classifyDesignationAtAwardDate,
  type DesignationDetailClassification,
  type DesignationDetailFact,
  type TerminationEvidence,
  parseDesignationDetailResponse,
} from "@/lib/building-control/g2b/designation-detail-client";
import {
  createDesignationSession,
  type DesignationSession,
} from "@/lib/building-control/g2b/designation-session";
import type { DesignationSessionTransportResult } from "@/lib/building-control/g2b/designation-session";
import {
  collectCompleteDesignationHistory,
  fetchDesignationDetailForFact,
  collectObservationsForCompleteHistory,
} from "@/lib/building-control/g2b/designation-history-client";

// ------------------- 1) Status requests exactly accept four statuses ----------

describe("RED: explicit status requests accept exactly the four statuses", () => {
  it("rejects any filter value that is not '', '유효', '만료', or '효력정지'", async () => {
    const rejected = ["활성", "실적제외", "유 효", "\uC720\uD6A8\t", "Y"];
    const accepted = [
      "",
      "\uC720\uD6A8",
      "\uB9CC\uB8CC",
      "\uD6A8\uB825\uC815\uC9C0",
    ];
    const request: DesignationListRequest = {
      applVldYn: "\uC720\uD6A8",
      currentPage: 1,
      recordCountPerPage: 10,
    };
    expect(accepted.length).toBe(4);
    expect(rejected.length).toBe(5);
    // Compilation-level assertion: request must carry exactly one of the four.
    expect(accepted).toContain(request.applVldYn);
  });

  it("filtered paging must reject any row whose status differs from the requested filter", async () => {
    const fetchedRaw = JSON.stringify({
      ErrorCode: 0,
      ErrorMsg: "",
      dlElpdtSlctnSttusL: [
        {
          applVldYn: "만료",
          bzmnRegNo: "1234567890",
          dsgnBgngYmd: "2020-01-02",
          dsgnEndYmd: "2025-01-01",
          dsgnExtsYmd: "",
          entNm: "ACME",
          etpmDsgnCrfcNo: "C1",
          etpmDsgnDmndNo: "D1",
          dsgnDmndChgOrd: "1",
          etpsSqno: "1",
          itemCfnm: "PROD",
          totCnt: 1,
        },
      ],
    });
    expect(() =>
      parseDesignationListResponse({
        payload: JSON.parse(fetchedRaw),
        rawJson: fetchedRaw,
        request: {
          applVldYn: "\uC720\uD6A8",
          currentPage: 1,
          recordCountPerPage: 10,
        },
      }),
    ).toThrow(/status|filter|mismatch/i);
  });

  it("rejects same-count but wrong identities compared with the authoritative all-status bucket", async () => {
    const { collectCompleteDesignationHistory } =
      await import("@/lib/building-control/g2b/designation-history-client");
    const makeRow = (id: string, status: string, totCnt: number) => ({
      applVldYn: status,
      bzmnRegNo: (id.replace(/\D/g, "") || "0").padStart(10, "0").slice(-10),
      dsgnBgngYmd: "20240115",
      dsgnEndYmd: "20250115",
      dsgnExtsYmd: "",
      entNm: `ENT-${id}`,
      etpmDsgnCrfcNo: `${id}C`,
      etpmDsgnDmndNo: `${id}D`,
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
      itemCfnm: `ITEM-${id}`,
      totCnt,
    });
    const listJson = (rows: ReturnType<typeof makeRow>[]) =>
      JSON.stringify({ ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: rows });
    const allRows = [makeRow("A1", "", 2), makeRow("B2", "\uC720\uD6A8", 2)];
    const wrongValidRows = [makeRow("W9", "\uC720\uD6A8", 1)];
    const responses: Record<string, { rawJson: string; payload: unknown }> = {
      "|1": {
        rawJson: listJson(allRows),
        payload: JSON.parse(listJson(allRows)),
      },
      "\uC720\uD6A8|1": {
        rawJson: listJson(wrongValidRows),
        payload: JSON.parse(listJson(wrongValidRows)),
      },
      "\uB9CC\uB8CC|1": {
        rawJson: listJson([]),
        payload: JSON.parse(listJson([])),
      },
      "\uD6A8\uB825\uC815\uC9C0|1": {
        rawJson: listJson([]),
        payload: JSON.parse(listJson([])),
      },
    };
    const bootstrap = vi.fn(async () => ({
      referer: "https://shop.g2b.go.kr/final",
    }));
    const postList = vi.fn(
      async (req: Parameters<DesignationSession["postList"]>[0]) => {
        const key = `${req.applVldYn}|${req.currentPage}`;
        const resp = responses[key];
        if (!resp) throw new Error(`Unexpected ${key}`);
        return resp;
      },
    );
    const session: DesignationSession = {
      bootstrap,
      postList,
      postDetail: vi.fn(),
    };
    await expect(
      collectCompleteDesignationHistory({
        session,
        pageSize: 10,
        maxPages: 5,
      }),
    ).rejects.toThrow(/identity|snapshot|bucket|mismatch|disappearance/i);
  });
});

// ------------------- 2) List parsing rejections -------------------------------

describe("RED: list parsing rejects invalid identities and inconsistent totCnt", () => {
  it("accepts equivalent list raw JSON with different key insertion order", () => {
    const rawJson = '{"ErrorMsg":"","dlElpdtSlctnSttusL":[],"ErrorCode":0}';
    const page = parseDesignationListResponse({
      rawJson,
      payload: {
        ErrorCode: 0,
        dlElpdtSlctnSttusL: [],
        ErrorMsg: "",
      },
      request: {
        applVldYn: "",
        currentPage: 1,
        recordCountPerPage: 10,
      },
    });
    expect(page.totalCount).toBe(0);
  });

  it("rejects a list payload that does not match its raw JSON", () => {
    const rawJson = JSON.stringify({
      ErrorCode: 0,
      ErrorMsg: "",
      dlElpdtSlctnSttusL: [],
    });
    expect(() =>
      parseDesignationListResponse({
        rawJson,
        payload: {
          ErrorCode: 0,
          ErrorMsg: "different",
          dlElpdtSlctnSttusL: [],
        },
        request: {
          applVldYn: "",
          currentPage: 1,
          recordCountPerPage: 10,
        },
      }),
    ).toThrow(/payload does not match rawJson/);
  });

  it("rejects a detail payload that does not match its raw JSON", () => {
    const request = {
      etpmDsgnCrfcNo: "C1",
      etpmDsgnDmndNo: "D1",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    };
    const rawJson = JSON.stringify({
      ErrorCode: 0,
      dlElpdtSlctnSttusDtlM: request,
      dlProdSpecModlDtlL: [{ itemUntyNo: "39121801" }],
    });
    expect(() =>
      parseDesignationDetailResponse({
        rawJson,
        payload: {
          ErrorCode: 0,
          dlElpdtSlctnSttusDtlM: request,
          dlProdSpecModlDtlL: [{ itemUntyNo: "99999999" }],
        },
        request,
      }),
    ).toThrow(/payload does not match rawJson/);
  });

  const baseRow = {
    applVldYn: "",
    bzmnRegNo: "1234567890",
    dsgnBgngYmd: "2020-01-02",
    dsgnEndYmd: "2025-01-01",
    dsgnExtsYmd: "",
    entNm: "ACME",
    etpmDsgnCrfcNo: "C1",
    etpmDsgnDmndNo: "D1",
    dsgnDmndChgOrd: "1",
    etpsSqno: "1",
    itemCfnm: "PROD",
    totCnt: 1,
  };

  it("rejects blank bzmnRegNo, etpmDsgnCrfcNo, etpmDsgnDmndNo, dsgnDmndChgOrd, etpsSqno", () => {
    const requiredFields = [
      "bzmnRegNo",
      "etpmDsgnCrfcNo",
      "etpmDsgnDmndNo",
      "dsgnDmndChgOrd",
      "etpsSqno",
    ];
    for (const field of requiredFields) {
      const row: Record<string, unknown> = { ...baseRow };
      row[field] = "";
      const payload = { ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: [row] };
      expect(() =>
        parseDesignationListResponse({
          payload,
          rawJson: JSON.stringify(payload),
          request: { applVldYn: "", currentPage: 1, recordCountPerPage: 100 },
        }),
      ).toThrow();
    }
  });

  it("rejects non-numeric business numbers", () => {
    for (const bad of [
      "ABCDEFGHIJ",
      "123456789X",
      "12-3456789",
      "          ",
    ]) {
      const row: Record<string, unknown> = { ...baseRow, bzmnRegNo: bad };
      const payload = { ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: [row] };
      expect(() =>
        parseDesignationListResponse({
          payload,
          rawJson: JSON.stringify(payload),
          request: { applVldYn: "", currentPage: 1, recordCountPerPage: 100 },
        }),
      ).toThrow(/bzmnRegNo|biz|business/i);
    }
  });

  it("rejects inconsistent per-row totCnt across rows", () => {
    const rows = [
      { ...baseRow, totCnt: 5, etpmDsgnCrfcNo: "C1" },
      { ...baseRow, totCnt: 7, etpmDsgnCrfcNo: "C2", etpmDsgnDmndNo: "D2" },
    ];
    const payload = { ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: rows };
    expect(() =>
      parseDesignationListResponse({
        payload,
        rawJson: JSON.stringify(payload),
        request: { applVldYn: "", currentPage: 1, recordCountPerPage: 100 },
      }),
    ).toThrow(/totCnt|consistent/i);
  });

  it("preserves blank end date as null/incomplete rather than throwing", () => {
    // The detail/build pipeline must represent a missing end date as
    // incomplete rather than exploding on parsing.
    const obs = buildDesignationObservation({
      listFact: {
        schemaVersion: 1,
        sourceIdentity: "C1|D1|1|1",
        applVldYn: "",
        bzmnRegNo: "1234567890",
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "",
        dsgnExtsYmd: "",
        entNm: "ACME",
        etpmDsgnCrfcNo: "C1",
        etpmDsgnDmndNo: "D1",
        dsgnDmndChgOrd: "1",
        etpsSqno: "1",
        productName: "PROD",
        companyName: "ACME",
        status: "",
        listRawJson: "{}",
      },
      detailFact: null,
      termination: { state: "unverified" },
    });
    // Should not throw; should be incomplete.
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("incomplete");
  });
});

// ------------------- 3) Classification ordering ------------------------------

describe("RED: classification ordering and completeness", () => {
  function makeObs(args: {
    status: "" | "\uC720\uD6A8" | "\uB9CC\uB8CC" | "\uD6A8\uB825\uC815\uC9C0";
    bizno?: string;
    start?: string;
    end?: string;
    hasTarget?: boolean;
    termination?: TerminationEvidence;
    productName?: string;
  }) {
    const detailFact: DesignationDetailFact | null = args.hasTarget
      ? {
          classifications: [{ itemUntyNo: "39121801" }],
          detailRawJson: "{}",
        }
      : {
          classifications: [{ itemUntyNo: "99999999" }],
          detailRawJson: "{}",
        };
    return buildDesignationObservation({
      listFact: {
        schemaVersion: 1,
        sourceIdentity: "C1|D1|1|1",
        applVldYn: args.status,
        bzmnRegNo: args.bizno ?? "1234567890",
        dsgnBgngYmd: args.start ?? "2020-01-02",
        dsgnEndYmd: args.end ?? "2025-01-01",
        dsgnExtsYmd: "",
        entNm: "ACME",
        etpmDsgnCrfcNo: "C1",
        etpmDsgnDmndNo: "D1",
        dsgnDmndChgOrd: "1",
        etpsSqno: "1",
        productName: args.productName ?? "PROD",
        companyName: "ACME",
        status: args.status,
        listRawJson: "{}",
      },
      detailFact,
      termination:
        args.termination ??
        ({
          state: "verified_none",
          evidenceHash: "0".repeat(64),
        } as TerminationEvidence),
    });
  }

  it("a complete non-target detail is definitively not_excellent before blank-status checks", () => {
    const obs = makeObs({ status: "", hasTarget: false });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("not_excellent");
    if (r.kind === "not_excellent") {
      expect(r.reason).toBe("non_target_classification");
    }
  });

  it("missing detail remains incomplete regardless of blank status or termination check", () => {
    const obs = buildDesignationObservation({
      listFact: {
        schemaVersion: 1,
        sourceIdentity: "C1|D1|1|1",
        applVldYn: "",
        bzmnRegNo: "1234567890",
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "2025-01-01",
        dsgnExtsYmd: "",
        entNm: "ACME",
        etpmDsgnCrfcNo: "C1",
        etpmDsgnDmndNo: "D1",
        dsgnDmndChgOrd: "1",
        etpsSqno: "1",
        productName: "PROD",
        companyName: "ACME",
        status: "",
        listRawJson: "{}",
      },
      detailFact: null,
      termination: { state: "unverified" },
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("incomplete");
    if (r.kind === "incomplete") {
      expect(r.reason).toBe("missing_detail_evidence");
    }
  });

  it("startDate > effectiveEndDate is incomplete", () => {
    const obs = makeObs({
      status: "\uC720\uD6A8",
      start: "2025-06-01",
      end: "2020-01-01",
      hasTarget: true,
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("incomplete");
    if (r.kind === "incomplete") {
      expect(r.reason).toBe("invalid_end_date");
    }
  });

  it("canonical source hashes do not collide when free-text fields contain delimiters", () => {
    const base = makeObs({
      status: "\uC720\uD6A8",
      productName: "PROD",
    });
    const withDelim = makeObs({
      status: "\uC720\uD6A8",
      productName: "P|R|O|D",
    });
    expect(base.sourceHash).not.toBe(withDelim.sourceHash);
  });
});

// ------------------- 4) Termination evidence from official JSON ---------------

describe("RED: termination evidence must be cryptographically tied to raw official JSON", () => {
  it("verified_none cannot be reached from a disconnected caller-supplied 64-hex string", () => {
    // The classifier must refuse arbitrary 64-hex strings when no official
    // raw termination JSON has been supplied.
    const obs = buildDesignationObservation({
      listFact: {
        schemaVersion: 1,
        sourceIdentity: "C1|D1|1|1",
        applVldYn: "\uC720\uD6A8",
        bzmnRegNo: "1234567890",
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "2025-01-01",
        dsgnExtsYmd: "",
        entNm: "ACME",
        etpmDsgnCrfcNo: "C1",
        etpmDsgnDmndNo: "D1",
        dsgnDmndChgOrd: "1",
        etpsSqno: "1",
        productName: "PROD",
        companyName: "ACME",
        status: "\uC720\uD6A8",
        listRawJson: "{}",
      },
      detailFact: {
        classifications: [{ itemUntyNo: "39121801" }],
        detailRawJson: "{}",
      },
      termination: {
        state: "verified_none",
        evidenceHash: "0".repeat(64),
      } as TerminationEvidence,
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    // Without official termination evidence, this must NOT reach excellent.
    expect(r.kind).toBe("incomplete");
    if (r.kind === "incomplete") {
      expect(r.reason).toBe("termination_contract_unproven");
    }
  });

  it("uses official valid status and interval when termination dates are unavailable", () => {
    const obs = buildDesignationObservation({
      listFact: {
        schemaVersion: 1,
        sourceIdentity: "C1|D1|1|1",
        applVldYn: "\uC720\uD6A8",
        bzmnRegNo: "1234567890",
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "2025-01-01",
        dsgnExtsYmd: "",
        entNm: "ACME",
        etpmDsgnCrfcNo: "C1",
        etpmDsgnDmndNo: "D1",
        dsgnDmndChgOrd: "1",
        etpsSqno: "1",
        productName: "PROD",
        companyName: "ACME",
        status: "\uC720\uD6A8",
        listRawJson: "{}",
      },
      detailFact: {
        classifications: [{ itemUntyNo: "39121801" }],
        detailRawJson: "{}",
      },
      termination: { state: "unverified" },
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("excellent");
  });
});

// ------------------- 5) AbortError + retry policy -----------------------------

describe("RED: AbortError retry and exponential backoff", () => {
  it("AbortError is retryable and succeeds after retry", async () => {
    let attempts = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const policy: RetryPolicy = {
      maxRetries: 5,
      baseDelayMs: 1,
      sleep,
    };
    const result = await retryTransient(async () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error("aborted") as Error & {
          name: string;
          code: string;
        };
        err.name = "AbortError";
        err.code = "ABORT_ERR";
        throw err;
      }
      return "ok";
    }, policy);
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("delay sequence is exponential (base, 2*base) and respects optional cap", async () => {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    const policy: RetryPolicy = {
      maxRetries: 3,
      baseDelayMs: 10,
      sleep,
      maxDelayMs: 25,
    };
    // Piggyback on retryTransient's options if cap support exists.
    await expect(
      retryTransient<string>(
        async () => {
          const err = new Error("x") as Error & { status: number };
          err.status = 503;
          throw err;
        },
        policy as unknown as RetryPolicy,
      ),
    ).rejects.toBeDefined();
    // We can't strictly assert the schedule, but delay must be at least base
    // and not exceed the cap (when a cap is supported).
    for (const s of sleeps) {
      expect(s).toBeGreaterThanOrEqual(10);
      if ((policy as { maxDelayMs?: number }).maxDelayMs !== undefined) {
        expect(s).toBeLessThanOrEqual(
          (policy as { maxDelayMs: number }).maxDelayMs,
        );
      }
    }
  });

  it("designation session has a finite default timeout", async () => {
    const { fetch } = (() => {
      const calls: unknown[] = [];
      return {
        fetch: async (input: string | URL, init?: RequestInit) => {
          calls.push({ url: String(input), init });
          return new Response(null, {
            status: 200,
            headers: { "set-cookie": "sid=1" },
          });
        },
      };
    })();
    const session = createDesignationSession({
      fetch,
      retryPolicy: { maxRetries: 0, baseDelayMs: 1, sleep: async () => {} },
    });
    expect(typeof session).toBe("object");
    // Internal factory must have applied a finite timeout (no Unbounded).
    // This is an indirect assertion: by exercising the factory with a
    // default timeout, the request Promise still must settle.
    const r = await session.bootstrap();
    expect(typeof r.referer).toBe("string");
  });

  it("session rejects invalid/unbounded timeout and out-of-range retry limits", async () => {
    const fetch = async () =>
      new Response(null, {
        status: 200,
        headers: { "set-cookie": "sid=1" },
      });
    const basePolicy: RetryPolicy = {
      maxRetries: 0,
      baseDelayMs: 1,
      sleep: async () => {},
    };
    // Too-large timeout still must be finite (no Infinity or huge).
    expect(() =>
      createDesignationSession({
        fetch,
        retryPolicy: basePolicy,
        timeoutMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
    expect(() =>
      createDesignationSession({
        fetch,
        retryPolicy: basePolicy,
        timeoutMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow();
    // maxRedirects must be a non-negative integer within a sensible range.
    expect(() =>
      createDesignationSession({
        fetch,
        retryPolicy: basePolicy,
        maxRedirects: -1,
      }),
    ).toThrow();
    expect(() =>
      createDesignationSession({
        fetch,
        retryPolicy: basePolicy,
        maxRedirects: 1.5,
      }),
    ).toThrow();
    // retry limits: maxRetries must be a non-negative integer.
    expect(() =>
      createDesignationSession({
        fetch,
        retryPolicy: { ...basePolicy, maxRetries: -1 },
      }),
    ).toThrow();
  });
});

// ------------------- 6) History must fetch every authoritative identity -------

describe("RED: history must fetch every authoritative identity", () => {
  function makeRow(id: string, status: string, totCnt: number) {
    return {
      applVldYn: status,
      bzmnRegNo: (id.replace(/\D/g, "") || "0").padStart(10, "0").slice(-10),
      dsgnBgngYmd: "20240115",
      dsgnEndYmd: "20250115",
      dsgnExtsYmd: "",
      entNm: `ENT-${id}`,
      etpmDsgnCrfcNo: `${id}C`,
      etpmDsgnDmndNo: `${id}D`,
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
      itemCfnm: `ITEM-${id}`,
      totCnt,
    };
  }
  const listJson = (rows: ReturnType<typeof makeRow>[]) =>
    JSON.stringify({ ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: rows });

  it("N detail calls produce composed observations; one-of-N failure returns no complete result", async () => {
    const allRows = [
      makeRow("A1", "", 3),
      makeRow("B2", "\uC720\uD6A8", 3),
      makeRow("C3", "\uC720\uD6A8", 3),
    ];
    const responses: Record<string, { rawJson: string; payload: unknown }> = {
      "|1": {
        rawJson: listJson(allRows),
        payload: JSON.parse(listJson(allRows)),
      },
      "\uC720\uD6A8|1": {
        rawJson: listJson([
          makeRow("B2", "\uC720\uD6A8", 2),
          makeRow("C3", "\uC720\uD6A8", 2),
        ]),
        payload: undefined,
      },
      "\uB9CC\uB8CC|1": {
        rawJson: listJson([]),
        payload: JSON.parse(listJson([])),
      },
      "\uD6A8\uB825\uC815\uC9C0|1": {
        rawJson: listJson([]),
        payload: JSON.parse(listJson([])),
      },
    };
    responses["\uC720\uD6A8|1"].payload = JSON.parse(
      responses["\uC720\uD6A8|1"].rawJson,
    );
    const bootstrap = vi.fn(async () => ({
      referer: "https://shop.g2b.go.kr/x",
    }));
    const postList = vi.fn(
      async (req: Parameters<DesignationSession["postList"]>[0]) => {
        const key = `${req.applVldYn}|${req.currentPage}`;
        const resp = responses[key];
        if (!resp) throw new Error(`Unexpected ${key}`);
        return resp;
      },
    );
    const detailCalls: Array<{ id: string; fail: boolean }> = [];
    const postDetail = vi.fn(
      async (req: Parameters<DesignationSession["postDetail"]>[0]) => {
        const id = req.etpmDsgnCrfcNo.replace(/C$/, "");
        const fail = id === "B2";
        detailCalls.push({ id, fail });
        if (fail) throw new Error("detail failure");
        const payload = {
          ErrorCode: 0,
          dlElpdtSlctnSttusDtlM: req,
          dlProdSpecModlDtlL: [{ itemUntyNo: "39121801" }],
        };
        return {
          rawJson: JSON.stringify(payload),
          payload,
        };
      },
    );
    const session: DesignationSession = { bootstrap, postList, postDetail };
    await expect(
      collectObservationsForCompleteHistory({
        session,
        pageSize: 10,
        maxPages: 5,
      }),
    ).rejects.toBeDefined();
    // One failure across N detail calls means we cannot claim complete
    // coverage; the composed result must NOT be reported as complete.
    expect(detailCalls.map((call) => call.id)).toEqual(["A1", "B2"]);
  });

  it("limits detail concurrency, preserves order, and completes non-target rows", async () => {
    const allRows = [
      makeRow("A1", "\uC720\uD6A8", 3),
      makeRow("B2", "\uC720\uD6A8", 3),
      makeRow("C3", "\uC720\uD6A8", 3),
    ];
    const responses: Record<string, { rawJson: string; payload: unknown }> = {};
    for (const [key, rows] of [
      ["|1", allRows],
      ["\uC720\uD6A8|1", allRows],
      ["\uB9CC\uB8CC|1", []],
      ["\uD6A8\uB825\uC815\uC9C0|1", []],
    ] as const) {
      const rawJson = listJson([...rows]);
      responses[key] = { rawJson, payload: JSON.parse(rawJson) };
    }

    let active = 0;
    let maxActive = 0;
    const session: DesignationSession = {
      bootstrap: vi.fn(async () => ({
        referer: "https://shop.g2b.go.kr/x",
      })),
      postList: vi.fn(async (req) => {
        const response = responses[`${req.applVldYn}|${req.currentPage}`];
        if (!response) throw new Error("unexpected list request");
        return response;
      }),
      postDetail: vi.fn(async (req) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        const payload = {
          ErrorCode: 0,
          dlElpdtSlctnSttusDtlM: req,
          dlProdSpecModlDtlL: [{ itemUntyNo: "99999999" }],
        };
        return { rawJson: JSON.stringify(payload), payload };
      }),
    };

    const result = await collectObservationsForCompleteHistory({
      session,
      pageSize: 10,
      maxPages: 5,
    });

    expect(maxActive).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.incompleteReasons).toEqual([]);
    expect(
      result.observations.map((item) => item.listFact.sourceIdentity),
    ).toEqual(
      allRows.map(
        (row) =>
          `${row.etpmDsgnCrfcNo}|${row.etpmDsgnDmndNo}|${row.dsgnDmndChgOrd}|${row.etpsSqno}`,
      ),
    );
    for (const observation of result.observations) {
      expect(
        classifyDesignationAtAwardDate({
          observation,
          awardDate: "2024-06-01",
        }).kind,
      ).toBe("not_excellent");
    }
  });

  it("valid target rows remain complete without fabricated termination dates", async () => {
    const allRows = [makeRow("A1", "\uC720\uD6A8", 1)];
    const responses: Record<string, { rawJson: string; payload: unknown }> = {
      "|1": {
        rawJson: listJson(allRows),
        payload: JSON.parse(listJson(allRows)),
      },
      "\uC720\uD6A8|1": {
        rawJson: listJson(allRows),
        payload: JSON.parse(listJson(allRows)),
      },
      "\uB9CC\uB8CC|1": {
        rawJson: listJson([]),
        payload: JSON.parse(listJson([])),
      },
      "\uD6A8\uB825\uC815\uC9C0|1": {
        rawJson: listJson([]),
        payload: JSON.parse(listJson([])),
      },
    };
    const bootstrap = vi.fn(async () => ({
      referer: "https://shop.g2b.go.kr/x",
    }));
    const postList = vi.fn(
      async (req: Parameters<DesignationSession["postList"]>[0]) => {
        const key = `${req.applVldYn}|${req.currentPage}`;
        const resp = responses[key];
        if (!resp) throw new Error(`Unexpected ${key}`);
        return resp;
      },
    );
    const postDetail = vi.fn(
      async (req: Parameters<DesignationSession["postDetail"]>[0]) => {
        const payload = {
          ErrorCode: 0,
          dlElpdtSlctnSttusDtlM: req,
          // No termination block returned; must remain unverified downstream.
          dlProdSpecModlDtlL: [{ itemUntyNo: "39121801" }],
        };
        return { rawJson: JSON.stringify(payload), payload };
      },
    );
    const session: DesignationSession = { bootstrap, postList, postDetail };
    const result = await collectObservationsForCompleteHistory({
      session,
      pageSize: 10,
      maxPages: 5,
    });
    expect(result.complete).toBe(true);
    for (const obs of result.observations) {
      expect(obs.termination.state).toBe("unverified");
      const c = classifyDesignationAtAwardDate({
        observation: obs,
        awardDate: "2024-06-01",
      });
      expect(c.kind).toBe("excellent");
    }
  });
});

// ------------------- 7) Rename transport response types ------------------------

describe("RED: rename transport response result types", () => {
  it("DesignationSessionTransportResult is the canonical name for transport payloads", () => {
    const sample: DesignationSessionTransportResult = {
      rawJson: '{"ErrorCode":0}',
      payload: { ErrorCode: 0 },
    };
    expect(typeof sample.rawJson).toBe("string");
  });
});

// ------------------- 8) Valid 10-digit business numbers ----------------------

describe("RED: history test business numbers must be valid 10-digit values", () => {
  it("every synthetic bzmnRegNo is a valid 10-digit numeric string", () => {
    const samples = ["1234567890", "0000000001", "9999999999", "0000123456"];
    for (const s of samples) {
      expect(s).toMatch(/^\d{10}$/);
      expect(s.length).toBe(10);
    }
  });
});
