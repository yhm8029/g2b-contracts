import { describe, expect, it, vi } from "vitest";
import {
  G2bPublicStandardContractUpstreamError,
  fetchG2bPublicStandardContractPage,
} from "@/lib/competitors/standard-contract-client";

function standardResponse(items: Record<string, unknown>[], totalCount = items.length) {
  return new Response(
    JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "OK" },
        body: { totalCount, items },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("G2B public standard contract page client", () => {
  it("requests the public standard contract endpoint with the expected URL parameters", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL) => standardResponse([]));

    await fetchG2bPublicStandardContractPage({
      dateFrom: "20250101",
      dateTo: "20250107",
      pageNo: 2,
      serviceKey: "raw service/key",
      fetchImpl,
      sleep: async () => undefined,
    });

    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe(
      "https://apis.data.go.kr/1230000/ao/PubDataOpnStdService/getDataSetOpnStdCntrctInfo",
    );
    expect(Object.fromEntries(url.searchParams.entries())).toMatchObject({
      cntrctCnclsBgnDate: "20250101",
      cntrctCnclsEndDate: "20250107",
      numOfRows: "999",
      pageNo: "2",
      type: "json",
      serviceKey: "raw service/key",
    });
    expect(url.searchParams.get("validationNonce")).toMatch(/^\d+-\d+$/);
    expect(String(fetchImpl.mock.calls[0]?.[0]).indexOf("serviceKey=")).toBeLessThan(
      String(fetchImpl.mock.calls[0]?.[0]).indexOf("validationNonce="),
    );
  });

  it("passes the caller abort signal to fetch without retrying cancellation", async () => {
    const controller = new AbortController();
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      throw controller.signal.reason;
    });

    await expect(fetchG2bPublicStandardContractPage({
      dateFrom: "20250101",
      dateTo: "20250107",
      pageNo: 1,
      serviceKey: "test-key",
      fetchImpl,
      sleep,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns raw rows and total count without supplier business-number filtering", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse(
        [
          { cntrctNm: "Requested supplier row", cntrctCorpBizno: "123-45-67890" },
          { cntrctNm: "Unrelated supplier row", cntrctCorpBizno: "111-11-11111" },
        ],
        2,
      ),
    );

    const page = await fetchG2bPublicStandardContractPage({
      dateFrom: "20250101",
      dateTo: "20250107",
      pageNo: 1,
      serviceKey: "test-key",
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(page).toMatchObject({
      dateFrom: "20250101",
      dateTo: "20250107",
      pageNo: 1,
      totalCount: 2,
      returnedRowCount: 2,
    });
    expect(page.items.map((row) => row.cntrctNm)).toEqual([
      "Requested supplier row",
      "Unrelated supplier row",
    ]);
  });

  it("accepts item-array response envelopes and parses string total counts", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "OK" },
            body: {
              totalCount: "1",
              items: {
                item: [{ cntrctNm: "Nested item row" }],
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const page = await fetchG2bPublicStandardContractPage({
      dateFrom: "20250101",
      dateTo: "20250107",
      pageNo: 1,
      serviceKey: "test-key",
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(page.totalCount).toBe(1);
    expect(page.items).toEqual([{ cntrctNm: "Nested item row" }]);
  });

  it("retries retryable HTTP statuses and upstream result codes with injected sleep", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ response: { header: { resultCode: "02", resultMsg: "busy" } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(standardResponse([{ cntrctNm: "Recovered" }]));
    const sleep = vi.fn(async () => undefined);

    const page = await fetchG2bPublicStandardContractPage({
      dateFrom: "20250101",
      dateTo: "20250107",
      pageNo: 1,
      serviceKey: "test-key",
      fetchImpl,
      sleep,
    });

    expect(page.items).toEqual([{ cntrctNm: "Recovered" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("validationNonce")),
    ).toEqual([expect.any(String), expect.any(String), expect.any(String)]);
    expect(
      new Set(fetchImpl.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("validationNonce"))).size,
    ).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable upstream errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          OpenAPI_ServiceResponse: {
            cmmMsgHeader: {
              returnReasonCode: "30",
              returnAuthMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const sleep = vi.fn(async () => undefined);

    await expect(
      fetchG2bPublicStandardContractPage({
        dateFrom: "20250101",
        dateTo: "20250107",
        pageNo: 1,
        serviceKey: "test-key",
        fetchImpl,
        sleep,
      }),
    ).rejects.toMatchObject({
      name: "G2bPublicStandardContractUpstreamError",
      kind: "response",
      upstreamCode: "30",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws a typed response error for invalid total counts", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "OK" },
            body: { totalCount: "not-a-number", items: [] },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      fetchG2bPublicStandardContractPage({
        dateFrom: "20250101",
        dateTo: "20250107",
        pageNo: 1,
        serviceKey: "test-key",
        fetchImpl,
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(G2bPublicStandardContractUpstreamError);
  });
});
