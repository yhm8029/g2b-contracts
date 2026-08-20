import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompetitorContractRow } from "@/lib/competitors/contracts";
import {
  buildG2bPurchaseTargetProductsUrl,
  enrichCompetitorStandardContractItemCodes,
  fetchG2bPurchaseTargetItemCodes,
} from "@/lib/competitors/purchase-target-products";

function makeRow(overrides: Partial<CompetitorContractRow> = {}): CompetitorContractRow {
  return {
    id: "row-1",
    bizNoNormalized: "1234567890",
    bizNoDisplay: "123-45-67890",
    businessName: "Test Co",
    contractName: "Test Contract",
    contractDate: "2024-01-01",
    currentContractAmount: 1_000_000,
    totalContractAmount: 1_000_000,
    demandAgencyName: "Agency",
    contractAgencyName: "Contractor",
    contractMethod: "open",
    contractNo: "CN-001",
    noticeNo: "NT-001",
    contractDetailUrl: "https://example.com/contract",
    noticeDetailUrl: "https://example.com/notice?bidPbancOrd=001",
    sourceDataset: "g2b-public-standard-contract",
    ...overrides,
  };
}

function purchaseTargetResponse(items: Record<string, unknown>[]) {
  return new Response(JSON.stringify({
    response: {
      header: { resultCode: "00", resultMsg: "OK" },
      body: { totalCount: items.length, items },
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("buildG2bPurchaseTargetProductsUrl", () => {
  it("builds the official endpoint with required query params", () => {
    const built = buildG2bPurchaseTargetProductsUrl({
      serviceKey: "KEY",
      bidNtceNo: "NT-001",
      bidNtceOrd: "001",
    });
    const url = new URL(String(built));

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThngPurchsObjPrdct",
    );
    expect(url.searchParams.get("inqryDiv")).toBe("2");
    expect(url.searchParams.get("bidNtceNo")).toBe("NT-001");
    expect(url.searchParams.get("bidNtceOrd")).toBe("001");
    expect(url.searchParams.get("type")).toBe("json");
    expect(url.searchParams.get("serviceKey")).toBe("KEY");
  });
});

describe("fetchG2bPurchaseTargetItemCodes", () => {
  it("normalizes detailed codes, dedupes them, and ignores 8-digit classification codes", async () => {
    const fetchImpl = vi.fn(async () => purchaseTargetResponse([
      { dtilPrdctClsfcNo: "39121801-01", prdctClsfcNo: "12345678" },
      { dtilPrdctClsfcNo: "39121801-01" },
      { dtilPrdctClsfcNo: "39121801-02" },
      { prdctClsfcNo: "87654321" },
    ]));

    const codes = await fetchG2bPurchaseTargetItemCodes({
      serviceKey: "K",
      bidNtceNo: "NT-001",
      bidNtceOrd: "001",
      fetchImpl,
    });

    expect(codes).toEqual(["3912180101", "3912180102"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a never-resolving fetch after timeoutMs", async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          }, { once: true });
        });
      });

      const request = fetchG2bPurchaseTargetItemCodes({
        serviceKey: "K",
        bidNtceNo: "NT-001",
        bidNtceOrd: "001",
        fetchImpl,
        timeoutMs: 2_000,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);
      const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(2_000);
      await rejection;
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes AbortSignal to fetch", async () => {
    const fetchImpl = vi.fn(async () => purchaseTargetResponse([]));
    const controller = new AbortController();

    await fetchG2bPurchaseTargetItemCodes({
      serviceKey: "K",
      bidNtceNo: "NT-001",
      bidNtceOrd: "001",
      fetchImpl,
      signal: controller.signal,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe("enrichCompetitorStandardContractItemCodes", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
  });

  it("stops queued enrichment when the whole-operation time budget elapses", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) signals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      });
      const rows = Array.from({ length: 8 }, (_, index) => makeRow({
        id: `row-${index}`,
        noticeNo: `NT-${index}`,
      }));

      const request = enrichCompetitorStandardContractItemCodes(rows, {
        serviceKey: "K",
        fetchImpl,
        sqlite,
        timeBudgetMs: 1_000,
      });

      expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
      expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await request;
      expect(result).toEqual({
        rows,
        complete: false,
        unresolvedCount: expect.any(Number),
      });
      expect(result.complete).toBe(false);
      expect(result.unresolvedCount).toBeGreaterThan(0);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(fetchImpl.mock.calls.length).toBeLessThan(rows.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes item classification requests to avoid upstream rate limits", async () => {
    let inFlight = 0;
    let overlapCount = 0;
    const fetchImpl = vi.fn(async (_rawUrl: string) => {
      if (inFlight > 0) {
        overlapCount += 1;
        return new Response("rate limited", { status: 429 });
      }
      inFlight += 1;
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return purchaseTargetResponse([{ dtilPrdctClsfcNo: "39121801-01" }]);
      } finally {
        inFlight -= 1;
      }
    });
    const rows = Array.from({ length: 8 }, (_, index) => makeRow({
      id: `row-${index}`,
      noticeNo: `NT-${index}`,
      noticeDetailUrl: `https://example.com/notice?bidPbancOrd=00${index}`,
    }));
    const result = await enrichCompetitorStandardContractItemCodes(rows, {
      serviceKey: "K",
      fetchImpl,
      sqlite,
      timeBudgetMs: 5_000,
    });
    expect(overlapCount).toBe(0);
    expect(result.complete).toBe(true);
    expect(result.unresolvedCount).toBe(0);
    expect(result.rows.map((row) => row.itemCodes)).toEqual(
      Array.from({ length: 8 }, () => ["3912180101"]),
    );
  });

  it("extracts bidPbancOrd from noticeDetailUrl and gets itemCodes", async () => {
    const fetchImpl = vi.fn(async () => purchaseTargetResponse([
      { dtilPrdctClsfcNo: "39121801-01" },
    ]));

    const result = await enrichCompetitorStandardContractItemCodes([makeRow()], {
      serviceKey: "K",
      fetchImpl,
      sqlite,
    });

    expect(result.rows[0]?.itemCodes).toEqual(["3912180101"]);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain("bidNtceNo=NT-001");
    expect(url).toContain("bidNtceOrd=001");
  });

  it("fetches once for duplicate rows with the same notice and order", async () => {
    const fetchImpl = vi.fn(async () => purchaseTargetResponse([
      { dtilPrdctClsfcNo: "39121801-01" },
    ]));

    const result = await enrichCompetitorStandardContractItemCodes(
      [makeRow({ id: "a" }), makeRow({ id: "b" })],
      { serviceKey: "K", fetchImpl, sqlite },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.rows.map((row) => row.itemCodes)).toEqual([["3912180101"], ["3912180101"]]);
  });

  it("does not fetch or modify third-party rows", async () => {
    const fetchImpl = vi.fn();
    const row = makeRow({ sourceDataset: "g2b-shopping-mall-third-party-delivery" });

    const result = await enrichCompetitorStandardContractItemCodes([row], {
      serviceKey: "K",
      fetchImpl,
      sqlite,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.rows[0]).toEqual(row);
    expect(result.rows[0]?.itemCodes).toBeUndefined();
  });

  it("persists positive cache in sqlite and reuses it in cache-only mode", async () => {
    const fetchImpl = vi.fn(async () => purchaseTargetResponse([
      { dtilPrdctClsfcNo: "39121801-01" },
    ]));

    await enrichCompetitorStandardContractItemCodes([makeRow()], {
      serviceKey: "K",
      fetchImpl,
      sqlite,
    });
    const cacheOnlyFetch = vi.fn();
    const result = await enrichCompetitorStandardContractItemCodes([makeRow()], {
      serviceKey: "K",
      fetchImpl: cacheOnlyFetch,
      sqlite,
      cacheOnly: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cacheOnlyFetch).not.toHaveBeenCalled();
    expect(result.rows[0]?.itemCodes).toEqual(["3912180101"]);
  });

  it("persists an empty successful result and reuses it in cache-only mode", async () => {
    const fetchImpl = vi.fn(async () => purchaseTargetResponse([]));

    const first = await enrichCompetitorStandardContractItemCodes([makeRow()], {
      serviceKey: "K",
      fetchImpl,
      sqlite,
    });
    const cacheOnlyFetch = vi.fn();
    const second = await enrichCompetitorStandardContractItemCodes([makeRow()], {
      serviceKey: "K",
      fetchImpl: cacheOnlyFetch,
      sqlite,
      cacheOnly: true,
    });

    expect(first.rows[0]?.itemCodes).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cacheOnlyFetch).not.toHaveBeenCalled();
    expect(second.rows[0]?.itemCodes).toBeUndefined();
  });

  it("enriches no-notice standard contract via contract number lookup", async () => {
    const row = makeRow({
      id: "row-no-notice",
      noticeNo: undefined,
      noticeDetailUrl: undefined,
      contractDetailUrl:
        "https://example.com/contract?ctrtNo=R26TA02080123&ctrtChgOrd=00",
    },);
    const fetchImpl = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith("/getCntrctInfoListThngPPSSrch")) {
        return new Response(
          JSON.stringify({
            response: {
              header: { resultCode: "00", resultMsg: "OK" },
              body: {
                items: {
                  item: { untyCntrctNo: "R26TE16824807" },
                },
              },
            },
          },),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname.endsWith("/getCntrctInfoListThngDetail")) {
        return new Response(
          JSON.stringify({
            response: {
              header: { resultCode: "00", resultMsg: "OK" },
              body: {
                items: {
                  item: { prdctClsfcNo: "39121801" },
                },
              },
            },
          },),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected URL: ${rawUrl}`);
    },);
    const result = await enrichCompetitorStandardContractItemCodes(
      [row],
      {
        serviceKey: "K",
        fetchImpl,
        sqlite,
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.rows[0]?.itemCodes).toEqual(["3912180101"]);
    expect(result.complete).toBe(true);
    expect(result.unresolvedCount).toBe(0);
    const firstUrl = new URL(fetchImpl.mock.calls[0][0]);
    const secondUrl = new URL(fetchImpl.mock.calls[1][0]);
    expect(firstUrl.pathname).toBe(
      "/1230000/ao/CntrctInfoService/getCntrctInfoListThngPPSSrch",
    );
    expect(firstUrl.searchParams.get("inqryDiv")).toBe("2");
    expect(firstUrl.searchParams.get("dcsnCntrctNo")).toBe("R26TA0208012300");
    expect(secondUrl.pathname).toBe(
      "/1230000/ao/CntrctInfoService/getCntrctInfoListThngDetail",
    );
    expect(secondUrl.searchParams.get("inqryDiv")).toBe("2");
    expect(secondUrl.searchParams.get("untyCntrctNo")).toBe("R26TE16824807");
  },);

  it("persists an empty no-notice contract search as a non-target cache result", async () => {
    const row = makeRow({
      id: "row-empty-no-notice",
      noticeNo: undefined,
      noticeDetailUrl: undefined,
      contractDetailUrl:
        "https://example.com/contract?ctrtNo=R26TA02080123&ctrtChgOrd=00",
    },);
    const fetchImpl = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith("/getCntrctInfoListThngPPSSrch")) {
        return new Response(
          JSON.stringify({
            response: {
              header: { resultCode: "00", resultMsg: "OK" },
              body: { totalCount: 0, items: { item: [] } },
            },
          },),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected URL: ${rawUrl}`);
    },);
    const result1 = await enrichCompetitorStandardContractItemCodes(
      [row],
      { serviceKey: "K", fetchImpl, sqlite },
    );
    const result2 = await enrichCompetitorStandardContractItemCodes(
      [row],
      { serviceKey: "K", fetchImpl, sqlite, cacheOnly: true },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result1.complete).toBe(true);
    expect(result1.unresolvedCount).toBe(0);
    expect(result1.rows[0]?.itemCodes).toBeUndefined();
    expect(result2.complete).toBe(true);
    expect(result2.unresolvedCount).toBe(0);
    expect(result2.rows[0]?.itemCodes).toBeUndefined();
  },);
});
