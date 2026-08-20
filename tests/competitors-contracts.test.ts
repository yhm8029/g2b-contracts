import { describe, expect, it, vi } from "vitest";
import { COMPETITOR_CONTRACT_QUERY_RESULT_VERSION } from "@/lib/competitors/cache";
import type { CompetitorContractRow, CompetitorContractSearchResult } from "@/lib/competitors/contracts";
import {
  competitorContractTestHooks,
  CompetitorContractUpstreamError,
  normalizeCachedCompetitorContractSearchResult,
  normalizeCompetitorContractRowIdentity,
  searchCompetitorContracts,
} from "@/lib/competitors/contracts";

const directBusinessNumberFields = [
  "bizno",
  "bizrno",
  "cntrctCorpBizno",
  "cntrctEntrpsBizno",
  "bidwinnrBizrno",
  "corpBizno",
  "rprsntCorpBizrno",
] as const;

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

function contractRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    corpList: "[A^B^C^Test Competitor^1234567890]",
    cntrctCorpBizno: "123-45-67890",
    cntrctCorpNm: "Test Competitor",
    cntrctCnclsDate: "20250115",
    cntrctNm: `Contract ${index}`,
    totCntrctAmt: String(1000 + index),
    dcsnCntrctNo: `C-${index}`,
    ...overrides,
  };
}

function mappedContractRow(overrides: Partial<CompetitorContractRow> = {}): CompetitorContractRow {
  return {
    id: "legacy-index-based-id",
    bizNoNormalized: "1234567890",
    bizNoDisplay: "123-45-67890",
    businessName: "Test Competitor",
    contractName: "Legacy cached contract",
    contractDate: "2025-01-15",
    currentContractAmount: 1_001,
    totalContractAmount: 1_001,
    demandAgencyName: "Demand agency",
    contractAgencyName: "Contract agency",
    contractMethod: "Open competition",
    contractNo: "CACHE-1",
    noticeNo: "NOTICE-1",
    contractDetailUrl: "https://example.test/contracts/1",
    noticeDetailUrl: "https://example.test/notices/1",
    sourceDataset: "g2b-public-standard-contract",
    ...overrides,
  };
}

function requestedUrl(fetchImpl: ReturnType<typeof vi.fn>, callIndex: number) {
  return new URL(String(fetchImpl.mock.calls[callIndex]?.[0]));
}

describe("competitor contract search", () => {
  it("uses the contract-type-aware query-cache result version", () => {
    expect(COMPETITOR_CONTRACT_QUERY_RESULT_VERSION).toBe("latest-contract-v8");
  });

  it("keeps the stable row id when contract type enrichment is added", () => {
    const legacy = normalizeCompetitorContractRowIdentity(mappedContractRow());
    const enriched = normalizeCompetitorContractRowIdentity(
      mappedContractRow({ contractType: "제3자단가계약" }),
    );

    expect(enriched.id).toBe(legacy.id);
  });

  it("maps G2B standard contract rows for a searched business number", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "OK" },
            body: {
              totalCount: 1,
              items: [
                {
                  corpList: "[A^B^C^^1234567890]",
                  cntrctCorpBizno: "123-45-67890",
                  cntrctCorpNm: "테스트 경쟁사",
                  cntrctCnclsDate: "20250115",
                  cntrctNm: "공공청사 설계용역",
                  totCntrctAmt: "120000000",
                  dminsttNm: "서울특별시",
                  cntrctInsttNm: "서울지방조달청",
                  cntrctMthdNm: "제한경쟁",
                  cntrctCnclsSttusNm: "제3자단가계약",
                  dcsnCntrctNo: "C2025-001",
                  bidNtceNo: "20250100001",
                  bidNtceDtlUrl: "https://www.g2b.go.kr/detail",
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await searchCompetitorContracts(
      {
        bizNo: "123-45-67890",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-07",
      },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.summary).toMatchObject({
      contractCount: 1,
      totalAmount: 120000000,
      noticeLinkedCount: 1,
      latestContractDate: "2025-01-15",
    });
    expect(result.rows[0]).toMatchObject({
      bizNoDisplay: "123-45-67890",
      businessName: "테스트 경쟁사",
      contractName: "공공청사 설계용역",
      contractDate: "2025-01-15",
      totalContractAmount: 120000000,
      demandAgencyName: "서울특별시",
      contractAgencyName: "서울지방조달청",
      contractMethod: "제한경쟁",
      contractType: "제3자단가계약",
      contractNo: "C2025-001",
      noticeNo: "20250100001",
      noticeDetailUrl: "https://www.g2b.go.kr/detail",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records fetchedAt before starting the first upstream request", async () => {
    const events: string[] = [];
    const fetchImpl = vi.fn(async () => {
      events.push("fetch");
      return standardResponse([]);
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      {
        serviceKey: "test-key",
        fetchImpl,
        now: () => {
          events.push("now");
          return new Date("2026-07-22T00:00:00.000Z");
        },
      },
    );

    expect(events).toEqual(["now", "fetch"]);
    expect(result.fetchedAt).toBe("2026-07-22T00:00:00.000Z");
  });

  it("propagates the search abort signal to the G2B page fetch", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return standardResponse([]);
    });

    await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, signal: controller.signal },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves unique nonempty product names without changing the contract name", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([
        contractRow(1, {
          cntrctNm: "Building automation installation",
          prodNm: " BEMS controller ",
          prdlstNm: "BEMS controller",
        }),
      ]),
    );

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows[0]).toMatchObject({
      contractName: "Building automation installation",
      itemNames: ["BEMS controller"],
    });
  });

  it("propagates optional item codes through upstream mapping and normalized cache hits", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([contractRow(1, { dtilPrdctClsfcNo: "39121801-01" })]),
    );

    const upstreamResult = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );
    const cachedResult = normalizeCachedCompetitorContractSearchResult(
      { rows: [mappedContractRow({ itemCodes: ["39121801-01", "3912180101"] })] },
      new Set(["1234567890"]),
    );

    expect(upstreamResult.rows[0]?.itemCodes).toEqual(["3912180101"]);
    expect(cachedResult?.rows[0]?.itemCodes).toEqual(["3912180101"]);
  });

  it("propagates explicit original-contract metadata through mapping and normalized cache hits", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([contractRow(1, { frstCntrctDate: "20250105", cntrctOrd: "2" })]),
    );

    const upstreamResult = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );
    const cachedResult = normalizeCachedCompetitorContractSearchResult(
      { rows: [mappedContractRow({ originalContractDate: "2025-01-05", amendmentOrder: 2 })] },
      new Set(["1234567890"]),
    );

    expect(upstreamResult.rows[0]).toMatchObject({ originalContractDate: "2025-01-05", amendmentOrder: 2 });
    expect(cachedResult?.rows[0]).toMatchObject({ originalContractDate: "2025-01-05", amendmentOrder: 2 });
  });

  it("keeps G2B rows without product names valid", async () => {
    const fetchImpl = vi.fn(async () => standardResponse([contractRow(1)]));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows[0]?.itemNames).toBeUndefined();
  });

  it("preserves rows with distinct product-name payloads", async () => {
    const first = contractRow(1, {
      cntrctNm: "Building automation installation",
      prodNm: "DDC controller",
    });
    const duplicate = { ...first, prodNm: "BEMS gateway" };
    const fetchImpl = vi.fn(async () => standardResponse([first, duplicate], 2));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.itemNames)).toEqual(
      expect.arrayContaining([["DDC controller"], ["BEMS gateway"]]),
    );
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
    expect(result.summary.contractCount).toBe(1);
  });

  it("rejects invalid business registration numbers before calling G2B", async () => {
    const fetchImpl = vi.fn();

    await expect(
      searchCompetitorContracts(
        { bizNo: "123", dateFrom: "2025-01-01", dateTo: "2025-03-31" },
        { serviceKey: "test-key", fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: "CompetitorContractInputError",
      message: "each bizNo must contain 10 digits",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a missing service key with a typed configuration error", async () => {
    const fetchImpl = vi.fn();

    await expect(
      searchCompetitorContracts(
        { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
        { serviceKey: "", fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: "CompetitorContractConfigurationError",
      reason: "service_key_missing",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an exact normalized cache hit without fetching upstream", async () => {
    const cachedResult = {
      rows: [],
      summary: {
        contractCount: 0,
        totalAmount: 0,
        noticeLinkedCount: 0,
        latestContractDate: null,
      },
    };
    const queryCache = {
      get: vi.fn(() => cachedResult),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([]));

    const result = await searchCompetitorContracts(
      { bizNo: "123-45-67890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache },
    );

    expect(result).toEqual({
      ...cachedResult,
      coverage: { complete: true, fresh: true, missingRanges: [] },
    });
    expect(queryCache.get).toHaveBeenCalledWith({
      bizNoNormalized: "1234567890",
      dateFrom: "2025-01-01",
      dateTo: "2025-01-07",
    });
    expect(queryCache.set).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a fully covered interval cache hit without fetching upstream", async () => {
    const cachedResult = {
      fetchedAt: "2026-07-22T00:00:00.000Z",
      rows: [mappedContractRow({ contractDate: "2025-01-03" })],
      summary: { contractCount: 1, totalAmount: 1_001, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => [{ dateFrom: "2025-01-01", dateTo: "2025-01-07", result: cachedResult }]),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([]));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.fetchedAt).toBe(cachedResult.fetchedAt);
    expect(result.coverage).toEqual({ complete: true, fresh: true, missingRanges: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(queryCache.setInterval).not.toHaveBeenCalled();
  });

  it("returns stale stored interval rows immediately in cache-only mode without fetching or exact caching", async () => {
    const cachedResult = {
      fetchedAt: "2026-07-20T00:00:00.000Z",
      rows: [mappedContractRow({ contractDate: "2025-01-03", contractNo: "STALE-1" })],
      summary: { contractCount: 1, totalAmount: 1_001, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      getStored: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => []),
      getStoredIntervals: vi.fn(() => [{
        dateFrom: "2025-01-01",
        dateTo: "2025-01-07",
        result: cachedResult,
        fresh: false,
      }]),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn();

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-14" },
      { serviceKey: "", fetchImpl, queryCache, cacheOnly: true },
    );

    expect(result.rows.map((row) => row.contractNo)).toEqual(["STALE-1"]);
    expect(result.coverage).toEqual({
      complete: false,
      fresh: false,
      missingRanges: [{ dateFrom: "2025-01-08", dateTo: "2025-01-14" }],
    });
    expect(queryCache.getStored).toHaveBeenCalledOnce();
    expect(queryCache.getFreshIntervals).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(queryCache.set).not.toHaveBeenCalled();
    expect(queryCache.setInterval).not.toHaveBeenCalled();
  });

  it("returns a stale exact cache hit as complete in cache-only mode", async () => {
    const cachedResult = {
      fetchedAt: "2026-07-20T00:00:00.000Z",
      rows: [mappedContractRow({ contractDate: "2025-01-03", contractNo: "EXACT-STALE" })],
      summary: { contractCount: 1, totalAmount: 1_001, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      getStored: vi.fn(() => ({ result: cachedResult, fresh: false })),
      set: vi.fn(),
      getStoredIntervals: vi.fn(() => []),
    };
    const fetchImpl = vi.fn();

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "", fetchImpl, queryCache, cacheOnly: true },
    );

    expect(result.rows.map((row) => row.contractNo)).toEqual(["EXACT-STALE"]);
    expect(result.coverage).toEqual({ complete: true, fresh: false, missingRanges: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("marks fully covered stale intervals complete but not fresh in cache-only mode", async () => {
    const cachedResult = {
      rows: [mappedContractRow({ contractDate: "2025-01-03", contractNo: "STALE-INTERVAL" })],
      summary: { contractCount: 1, totalAmount: 1_001, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      getStored: vi.fn(() => null),
      set: vi.fn(),
      getStoredIntervals: vi.fn(() => [{
        dateFrom: "2025-01-01",
        dateTo: "2025-01-07",
        result: cachedResult,
        fresh: false,
      }]),
    };

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "", fetchImpl: vi.fn(), queryCache, cacheOnly: true },
    );

    expect(result.coverage).toEqual({ complete: true, fresh: false, missingRanges: [] });
    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("prefers complete fresh interval coverage over overlapping stale intervals in cache-only mode", async () => {
    const staleResult = {
      rows: [mappedContractRow({ contractDate: "2025-01-03", contractNo: "OUTDATED" })],
      summary: { contractCount: 1, totalAmount: 1_001, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const freshResult = {
      rows: [],
      summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
    };
    const queryCache = {
      get: vi.fn(() => null),
      getStored: vi.fn(() => null),
      set: vi.fn(),
      getStoredIntervals: vi.fn(() => [
        { dateFrom: "2025-01-01", dateTo: "2025-01-07", result: staleResult, fresh: false },
        { dateFrom: "2025-01-01", dateTo: "2025-01-07", result: freshResult, fresh: true },
      ]),
    };

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "", fetchImpl: vi.fn(), queryCache, cacheOnly: true },
    );

    expect(result.rows).toEqual([]);
    expect(result.coverage).toEqual({ complete: true, fresh: true, missingRanges: [] });
  });

  it("fetches only dates missing from fresh interval coverage", async () => {
    const cachedResult = {
      rows: [mappedContractRow({ contractDate: "2025-01-03", contractNo: "CACHE-1" })],
      summary: { contractCount: 1, totalAmount: 1_001, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => [{ dateFrom: "2025-01-01", dateTo: "2025-01-07", result: cachedResult }]),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([
      contractRow(2, { cntrctCnclsDate: "20250110" }),
    ]));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-14" },
      { serviceKey: "test-key", fetchImpl, queryCache, now: () => new Date("2026-07-22T00:00:00.000Z") },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestedUrl(fetchImpl, 0).searchParams.get("cntrctCnclsBgnDate")).toBe("20250108");
    expect(requestedUrl(fetchImpl, 0).searchParams.get("cntrctCnclsEndDate")).toBe("20250114");
    expect(result.rows.map((row) => row.contractNo).sort()).toEqual(["C-2", "CACHE-1"]);
    expect(queryCache.setInterval).toHaveBeenCalledWith(
      { bizNoNormalized: "1234567890", dateFrom: "2025-01-08", dateTo: "2025-01-14" },
      expect.objectContaining({ rows: [expect.objectContaining({ contractNo: "C-2" })] }),
    );
  });

  it("refetches dates omitted from coverage after their interval expires", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => []),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([]));

    await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache, now: () => new Date("2026-07-22T00:00:00.000Z") },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestedUrl(fetchImpl, 0).searchParams.get("cntrctCnclsBgnDate")).toBe("20250101");
    expect(requestedUrl(fetchImpl, 0).searchParams.get("cntrctCnclsEndDate")).toBe("20250107");
    expect(queryCache.setInterval).toHaveBeenCalledOnce();
  });

  it("stores only an earlier successful missing interval when a later interval fails", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => [{
        dateFrom: "2025-01-08",
        dateTo: "2025-01-14",
        result: {
          rows: [],
          summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
        },
      }]),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const from = new URL(String(input)).searchParams.get("cntrctCnclsBgnDate");
      return from === "20250101" ? standardResponse([]) : new Response("bad request", { status: 400 });
    });

    await expect(searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-21" },
      { serviceKey: "test-key", fetchImpl, queryCache, now: () => new Date("2026-07-22T00:00:00.000Z") },
    )).rejects.toMatchObject({ kind: "response" });

    expect(queryCache.setInterval).toHaveBeenCalledOnce();
    expect(queryCache.setInterval).toHaveBeenCalledWith(
      { bizNoNormalized: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      expect.objectContaining({ rows: [] }),
    );
    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("keeps only the latest amendment when cached and fetched intervals overlap by contract", async () => {
    const cachedResult = {
      rows: [mappedContractRow({
        contractNo: "SHARED-1",
        contractDate: "2025-01-03",
        originalContractDate: "2025-01-03",
        amendmentOrder: 1,
        currentContractAmount: 1_000,
        totalContractAmount: 1_000,
        contractTotalAmount: 1_000,
      })],
      summary: { contractCount: 1, totalAmount: 1_000, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => [{ dateFrom: "2025-01-01", dateTo: "2025-01-07", result: cachedResult }]),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([
      contractRow(2, {
        dcsnCntrctNo: "SHARED-1",
        cntrctCnclsDate: "20250110",
        frstCntrctDate: "20250103",
        cntrctOrd: "2",
        totCntrctAmt: "2000",
      }),
    ]));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-14" },
      { serviceKey: "test-key", fetchImpl, queryCache, now: () => new Date("2026-07-22T00:00:00.000Z") },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ contractNo: "SHARED-1", amendmentOrder: 2, totalContractAmount: 2_000 });
    expect(result.summary).toMatchObject({ contractCount: 1, totalAmount: 2_000 });
  });

  it("removes a cached supplier when a later fetched amendment excludes it", async () => {
    const cachedResult = {
      rows: [mappedContractRow({
        contractNo: "SHARED-REMOVAL",
        contractDate: "2025-01-03",
        originalContractDate: "2025-01-03",
        amendmentOrder: 1,
      })],
      summary: { contractCount: 1, totalAmount: 1_001, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => [{ dateFrom: "2025-01-01", dateTo: "2025-01-07", result: cachedResult }]),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([
      contractRow(2, {
        corpList: "[A^B^C^Replacement Supplier^9999999999]",
        cntrctCorpBizno: "9999999999",
        cntrctCorpNm: "Replacement Supplier",
        dcsnCntrctNo: "SHARED-REMOVAL",
        cntrctCnclsDate: "20250110",
        frstCntrctDate: "20250103",
        cntrctOrd: "2",
      }),
    ]));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-14" },
      { serviceKey: "test-key", fetchImpl, queryCache, now: () => new Date("2026-07-22T00:00:00.000Z") },
    );

    expect(result.rows).toEqual([]);
    expect(result.summary.contractCount).toBe(0);
  });

  it("uses full interval coverage without a service key and filters cached rows to the requested dates", async () => {
    const cachedResult = {
      rows: [
        mappedContractRow({ contractNo: "IN-RANGE", contractDate: "2025-01-03" }),
        mappedContractRow({ contractNo: "OUTSIDE", contractDate: "2025-02-01" }),
      ],
      summary: { contractCount: 2, totalAmount: 2_002, noticeLinkedCount: 1, latestContractDate: "2025-02-01" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => [{ dateFrom: "2025-01-01", dateTo: "2025-03-31", result: cachedResult }]),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn();

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "", fetchImpl, queryCache },
    );

    expect(result.rows.map((row) => row.contractNo)).toEqual(["IN-RANGE"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes valid legacy cache-hit rows before returning them", async () => {
    const cachedResult = {
      rows: [mappedContractRow()],
      summary: {
        contractCount: 999,
        totalAmount: 999,
        noticeLinkedCount: 999,
        latestContractDate: null,
      },
    };
    const queryCache = {
      get: vi.fn(() => cachedResult),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([]));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache },
    );

    expect(result.rows[0]?.id).toMatch(/^competitor-contract:v1:contract-no:[a-f0-9]{64}$/);
    expect(result.rows[0]?.id).not.toBe("legacy-index-based-id");
    expect(result.summary).toEqual({
      contractCount: 1,
      totalAmount: 1_001,
      noticeLinkedCount: 1,
      latestContractDate: "2025-01-15",
    });
    expect(queryCache.set).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves an optional contract type from a valid cache-hit row", async () => {
    const cachedResult = {
      rows: [mappedContractRow({ contractType: "제3자단가계약" })],
      summary: {
        contractCount: 1,
        totalAmount: 1_001,
        noticeLinkedCount: 1,
        latestContractDate: "2025-01-15",
      },
    };
    const queryCache = {
      get: vi.fn(() => cachedResult),
      set: vi.fn(),
    };

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl: vi.fn(), queryCache },
    );

    expect(result.rows[0]).toMatchObject({ contractType: "제3자단가계약" });
  });

  it("exports cache-hit validation with defensive property access", () => {
    const contractNameAccess = vi.fn(() => {
      throw new Error("invalid cached property");
    });
    const cachedRow = mappedContractRow();
    Object.defineProperty(cachedRow, "contractName", {
      enumerable: true,
      get: contractNameAccess,
    });

    expect(
      normalizeCachedCompetitorContractSearchResult(
        {
          rows: [cachedRow],
          summary: {
            contractCount: 1,
            totalAmount: 1_001,
            noticeLinkedCount: 1,
            latestContractDate: "2025-01-15",
          },
        },
        new Set(["1234567890"]),
      ),
    ).toBeNull();
    expect(contractNameAccess).toHaveBeenCalledOnce();
  });

  it("rejects invalid legacy cache-hit rows and replaces them after a complete scan", async () => {
    const queryCache = {
      get: vi.fn(() => ({
        rows: [mappedContractRow({ contractDate: "not-a-date" })],
        summary: {
          contractCount: 1,
          totalAmount: 1_001,
          noticeLinkedCount: 1,
          latestContractDate: "not-a-date",
        },
      })),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([contractRow(2)]));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache },
    );

    expect(result.rows.map((row) => row.contractNo)).toEqual(["C-2"]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(queryCache.set).toHaveBeenCalledOnce();
  });

  it("caches only after a successful complete upstream scan", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([contractRow(1)]));

    const result = await searchCompetitorContracts(
      { bizNo: "123-45-67890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache },
    );

    expect(queryCache.set).toHaveBeenCalledTimes(1);
    expect(queryCache.set).toHaveBeenCalledWith(
      {
        bizNoNormalized: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-07",
      },
      result,
    );
  });

  it("does not cache a scan rejected by the per-window safety cap", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => standardResponse([contractRow(1)], 999 * 100 + 1));

    await expect(
      searchCompetitorContracts(
        { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
        { serviceKey: "test-key", fetchImpl, queryCache },
      ),
    ).rejects.toMatchObject({ kind: "incomplete" });

    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("does not cache an upstream error", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));

    await expect(
      searchCompetitorContracts(
        { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
        { serviceKey: "test-key", fetchImpl, queryCache },
      ),
    ).rejects.toMatchObject({ kind: "response" });

    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("extends the tail when totalCount increases, deduplicates shifted rows, and caches once", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      if (pageNo === 1) return standardResponse([contractRow(1)], 1_000);
      if (pageNo === 2) return standardResponse([contractRow(1), contractRow(2)], 2_000);
      return standardResponse([contractRow(3)], 2_000);
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache },
    );

    expect(fetchImpl.mock.calls.map(([input]) =>
      new URL(String(input)).searchParams.get("pageNo")
    )).toEqual(["1", "2", "3"]);
    expect(result.rows.map((row) => row.contractNo).sort()).toEqual(["C-1", "C-2", "C-3"]);
    expect(queryCache.set).toHaveBeenCalledTimes(1);
    expect(queryCache.set).toHaveBeenCalledWith(expect.any(Object), result);
  });

  it("accepts decreasing totalCount and short tail pages", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      if (pageNo === 1) return standardResponse([contractRow(1)], 2_000);
      if (pageNo === 2) return standardResponse([], 500);
      return standardResponse([contractRow(2)], 500);
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.rows.map((row) => row.contractNo).sort()).toEqual(["C-1", "C-2"]);
  });

  it("terminates continuously increasing pagination at the bounded window cap", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      return standardResponse([contractRow(pageNo)], pageNo * 999 + 1);
    });

    await expect(
      searchCompetitorContracts(
        { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
        { serviceKey: "test-key", fetchImpl, queryCache },
      ),
    ).rejects.toMatchObject({
      name: "CompetitorContractUpstreamError",
      kind: "incomplete",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(100);
    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("aborts a dynamically extended scan without caching partial results", async () => {
    const controller = new AbortController();
    const abortError = new Error("search cancelled");
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      if (pageNo === 1) return standardResponse([contractRow(1)], 1_000);
      controller.abort(abortError);
      throw abortError;
    });

    await expect(
      searchCompetitorContracts(
        { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
        { serviceKey: "test-key", fetchImpl, queryCache, signal: controller.signal },
      ),
    ).rejects.toBe(abortError);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("does not cache an unrelated upstream error", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
    };
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));

    await expect(
      searchCompetitorContracts(
        { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
        { serviceKey: "test-key", fetchImpl, queryCache, sleep },
      ),
    ).rejects.toMatchObject({ kind: "response" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("matches business numbers embedded in G2B corpList strings", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "OK" },
            body: {
              totalCount: 1,
              items: [
                {
                  corpList: "[A^B^C^코프 경쟁사^대표자^1234567890]",
                  cntrctCnclsDate: "20250210",
                  cntrctNm: "학교 냉난방 개선",
                  cntrctAmt: "35,000,000",
                  dmndInsttNm: "경기도교육청",
                  cntrctCnclsMthdNm: "수의계약",
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-02-01",
        dateTo: "2025-02-07",
      },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows[0]).toMatchObject({
      businessName: "코프 경쟁사",
      contractName: "학교 냉난방 개선",
      demandAgencyName: "경기도교육청",
      contractMethod: "수의계약",
      totalContractAmount: 35000000,
    });
  });

  it("matches the requested business number when it is a non-representative corpList member", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([
        contractRow(1, {
          corpList:
            "[A^B^C^Representative Corp^1111111111][A^B^C^Requested Corp^1234567890]",
          cntrctCorpBizno: "111-11-11111",
          cntrctCorpNm: "Representative Corp",
        }),
      ]),
    );

    const result = await searchCompetitorContracts(
      { bizNo: "123-45-67890", dateFrom: "2025-02-01", dateTo: "2025-02-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      bizNoNormalized: "1234567890",
      bizNoDisplay: "123-45-67890",
      businessName: "Requested Corp",
    });
  });

  it.each(directBusinessNumberFields)(
    "retains rows that expose the requested business number only in %s",
    async (field) => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([
        contractRow(1, {
          corpList: "",
          cntrctCorpBizno: field === "cntrctCorpBizno" ? "123-45-67890" : "111-11-11111",
          [field]: "123-45-67890",
          cntrctCorpNm: "Direct Field Corp",
        }),
      ]),
    );

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-01" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      bizNoNormalized: "1234567890",
      businessName: "Direct Field Corp",
    });
    },
  );

  it("splits an inclusive three-month range into consecutive windows of at most seven days", async () => {
    const fetchImpl = vi.fn(async () => standardResponse([]));

    await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-03-31",
      },
      {
        serviceKey: "test-key",
        fetchImpl,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    const windows = fetchImpl.mock.calls.map((_, index) => {
      const url = requestedUrl(fetchImpl, index);
      return {
        from: url.searchParams.get("cntrctCnclsBgnDate"),
        to: url.searchParams.get("cntrctCnclsEndDate"),
        pageNo: url.searchParams.get("pageNo"),
        numOfRows: url.searchParams.get("numOfRows"),
      };
    });
    expect(windows).toHaveLength(13);
    expect(windows.slice(0, 3)).toEqual([
      { from: "20250101", to: "20250107", pageNo: "1", numOfRows: "999" },
      { from: "20250108", to: "20250114", pageNo: "1", numOfRows: "999" },
      { from: "20250115", to: "20250121", pageNo: "1", numOfRows: "999" },
    ]);
    expect(windows.at(-1)).toEqual({
      from: "20250326",
      to: "20250331",
      pageNo: "1",
      numOfRows: "999",
    });
  });

  it("fetches every page derived from totalCount when a window contains more than 2,000 rows", async () => {
    const totalCount = 2001;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const pageNo = Number(url.searchParams.get("pageNo"));
      const numOfRows = Number(url.searchParams.get("numOfRows"));
      const start = (pageNo - 1) * numOfRows;
      const count = Math.max(0, Math.min(numOfRows, totalCount - start));
      const items = Array.from({ length: count }, (_, offset) => contractRow(start + offset));
      return standardResponse(items, totalCount);
    });

    const result = await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-07",
      },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(totalCount);
    expect(result.summary.contractCount).toBe(totalCount);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map((_, index) => requestedUrl(fetchImpl, index).searchParams.get("pageNo"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(requestedUrl(fetchImpl, 0).searchParams.get("numOfRows")).toBe("999");
  });

  it("processes a fetched page before requesting the next page", async () => {
    const events: string[] = [];
    const firstPageItems = Array.from({ length: 999 }, (_, index) => {
      const row = contractRow(index, {
        cntrctCorpBizno: "111-11-11111",
        cntrctCorpNm: "Unrelated Corp",
      });
      Object.defineProperty(row, "corpList", {
        enumerable: true,
        get() {
          if (index === 0) {
            events.push("inspect-page-1");
          }
          return "[A^B^C^Unrelated Corp^1111111111]";
        },
      });
      return row;
    });
    const rawResponse = (items: Record<string, unknown>[]) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            header: { resultCode: "00", resultMsg: "OK" },
            body: { totalCount: 1_000, items },
          },
        }),
      }) as Response;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      events.push(`fetch-page-${pageNo}`);
      return pageNo === 1
        ? rawResponse(firstPageItems)
        : rawResponse([
            contractRow(1_000, {
              corpList: "",
              cntrctCorpBizno: "111-11-11111",
              rprsntCorpBizrno: "123-45-67890",
            }),
          ]);
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(1);
    expect(events.indexOf("inspect-page-1")).toBeGreaterThan(-1);
    expect(events.indexOf("inspect-page-1")).toBeLessThan(events.indexOf("fetch-page-2"));
  });

  it("does not retain candidate groups for unrelated contracts", () => {
    const collector = competitorContractTestHooks.createLatestRequestedSourceContractCollector(
      new Set(["1234567890"]),
    );
    collector.add(Array.from({ length: 5_000 }, (_, index) => contractRow(index, {
      cntrctCorpBizno: "111-11-11111",
      cntrctCorpNm: "Unrelated Corp",
      corpList: "[A^B^C^Unrelated Corp^1111111111]",
    })));

    expect(collector.retainedGroupCount()).toBe(0);
  });

  it("keeps the latest amendment when window responses complete in reverse order", async () => {
    const oldTargetVersion = contractRow(10_000, {
      dcsnCntrctNo: "CROSS-WINDOW-CONTRACT",
      cntrctOrd: "1",
      cntrctCnclsDate: "20250106",
      corpList: "[A^B^C^Target Competitor^1234567890]",
      cntrctCorpBizno: "123-45-67890",
      cntrctCorpNm: "Target Competitor",
      totCntrctAmt: "1000",
    });
    const latestWithoutTarget = contractRow(10_001, {
      dcsnCntrctNo: "CROSS-WINDOW-CONTRACT",
      cntrctOrd: "2",
      cntrctCnclsDate: "20250110",
      corpList: "[A^B^C^Remaining Supplier^2222222222]",
      cntrctCorpBizno: "222-22-22222",
      cntrctCorpNm: "Remaining Supplier",
      totCntrctAmt: "800",
    });
    const completionOrder: string[] = [];
    let releaseEarlierWindow!: () => void;
    const earlierWindowGate = new Promise<void>((resolve) => {
      releaseEarlierWindow = resolve;
    });
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const dateFrom = url.searchParams.get("cntrctCnclsBgnDate");
      if (dateFrom === "20250108") {
        completionOrder.push("later-window");
        releaseEarlierWindow();
        return standardResponse([latestWithoutTarget]);
      }
      await earlierWindowGate;
      completionOrder.push("earlier-window");
      return standardResponse(
        [oldTargetVersion, ...Array.from({ length: 998 }, (_, index) => contractRow(index, {
          cntrctCorpBizno: "111-11-11111",
          cntrctCorpNm: "Unrelated Corp",
          corpList: "[A^B^C^Unrelated Corp^1111111111]",
        }))],
        999,
      );
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-14" },
      {
        serviceKey: "test-key",
        fetchImpl,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    expect(completionOrder).toEqual(["later-window", "earlier-window"]);
    expect(result.rows).toEqual([]);
    expect(result.summary.totalAmount).toBe(0);
  });

  it("uses one-day windows for the trailing fourteen Seoul calendar days only", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL) => standardResponse([]));

    await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-03-01",
        dateTo: "2025-04-01",
      },
      {
        serviceKey: "test-key",
        fetchImpl,
        // 2025-04-01 00:30 in Seoul.
        now: () => new Date("2025-03-31T15:30:00.000Z"),
      },
    );

    const windows = fetchImpl.mock.calls.map(([input]) => {
      const url = new URL(String(input));
      return {
        from: url.searchParams.get("cntrctCnclsBgnDate"),
        to: url.searchParams.get("cntrctCnclsEndDate"),
      };
    });
    expect(windows.slice(0, 3)).toEqual([
      { from: "20250301", to: "20250307" },
      { from: "20250308", to: "20250314" },
      { from: "20250315", to: "20250318" },
    ]);
    expect(windows.slice(3)).toEqual(
      Array.from({ length: 14 }, (_, index) => {
        const date = new Date(Date.UTC(2025, 2, 19 + index));
        const compact = date.toISOString().slice(0, 10).replaceAll("-", "");
        return { from: compact, to: compact };
      }),
    );
  });

  it("keeps the latest amendment when later pages complete before earlier pages", async () => {
    const oldTargetVersion = contractRow(20_000, {
      dcsnCntrctNo: "REVERSED-PAGE-CONTRACT",
      cntrctOrd: "1",
      cntrctCnclsDate: "20250102",
      corpList: "[A^B^C^Target Competitor^1234567890]",
      cntrctCorpBizno: "123-45-67890",
      cntrctCorpNm: "Target Competitor",
    });
    const latestWithoutTarget = contractRow(20_001, {
      dcsnCntrctNo: "REVERSED-PAGE-CONTRACT",
      cntrctOrd: "2",
      cntrctCnclsDate: "20250107",
      corpList: "[A^B^C^Remaining Supplier^2222222222]",
      cntrctCorpBizno: "222-22-22222",
      cntrctCorpNm: "Remaining Supplier",
    });
    const unrelatedRows = (start: number, count: number) => Array.from({ length: count }, (_, index) =>
      contractRow(start + index, {
        cntrctCorpBizno: "111-11-11111",
        cntrctCorpNm: "Unrelated Corp",
        corpList: "[A^B^C^Unrelated Corp^1111111111]",
      }));
    const completionOrder: string[] = [];
    let releasePageTwo!: () => void;
    const pageTwoGate = new Promise<void>((resolve) => {
      releasePageTwo = resolve;
    });
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      if (pageNo === 1) {
        return standardResponse([oldTargetVersion, ...unrelatedRows(0, 998)], 1_999);
      }
      if (pageNo === 3) {
        completionOrder.push("page-3");
        releasePageTwo();
        return standardResponse([latestWithoutTarget], 1_999);
      }
      await pageTwoGate;
      completionOrder.push("page-2");
      return standardResponse(unrelatedRows(1_000, 999), 1_999);
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      {
        serviceKey: "test-key",
        fetchImpl,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    expect(completionOrder).toEqual(["page-3", "page-2"]);
    expect(result.rows).toEqual([]);
    expect(result.summary.totalAmount).toBe(0);
  });

  it("accepts normal weekly volumes above twenty pages without returning an incomplete error", async () => {
    const totalCount = 19_981;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const pageNo = Number(url.searchParams.get("pageNo"));
      const numOfRows = Number(url.searchParams.get("numOfRows"));
      const start = (pageNo - 1) * numOfRows;
      const count = Math.max(0, Math.min(numOfRows, totalCount - start));
      return standardResponse(Array.from({ length: count }, (_, offset) => contractRow(start + offset)), totalCount);
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-08", dateTo: "2025-01-14" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(totalCount);
    expect(fetchImpl).toHaveBeenCalledTimes(21);
  }, 20_000);

  it("accepts an estimated full-year scan of about fifteen hundred pages", async () => {
    const weeklyTotalCount = 27_500;
    const unrelated = contractRow(99_001, {
      corpList: "[A^B^C^Unrelated Corp^1111111111]",
      cntrctCorpBizno: "111-11-11111",
      cntrctCorpNm: "Unrelated Corp",
    });
    const fetchImpl = vi.fn(async () => standardResponse([unrelated], weeklyTotalCount));

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-12-31" },
      {
        serviceKey: "test-key",
        fetchImpl,
        now: () => new Date("2027-01-01T00:00:00.000Z"),
      },
    );

    expect(result.rows).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1_484);
    expect(fetchImpl.mock.calls.length).toBeLessThan(2_500);
  }, 20_000);

  it("enforces the two thousand five hundred page cap across date windows", async () => {
    const unrelated = contractRow(99_002, {
      corpList: "[A^B^C^Unrelated Corp^1111111111]",
      cntrctCorpBizno: "111-11-11111",
      cntrctCorpNm: "Unrelated Corp",
    });
    const fetchImpl = vi.fn(async () => standardResponse([unrelated], 99_900));

    await expect(
      searchCompetitorContracts(
        { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-07-01" },
        {
          serviceKey: "test-key",
          fetchImpl,
          now: () => new Date("2027-01-01T00:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      name: "CompetitorContractUpstreamError",
      kind: "incomplete",
      message: expect.stringContaining("2500 pages"),
    });

    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2_500);
  }, 20_000);

  it("retries transient HTTP responses up to three attempts using injected sleep", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("limited", { status: 429 }))
      .mockResolvedValueOnce(standardResponse([contractRow(1)]));
    const sleep = vi.fn(async () => undefined);

    const result = await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-01",
      },
      { serviceKey: "test-key", fetchImpl, sleep },
    );

    expect(result.rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries transient upstream result codes 02 and 05", async () => {
    const errorResponse = (resultCode: string) =>
      new Response(
        JSON.stringify({
          response: { header: { resultCode, resultMsg: "Temporary upstream failure" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse("02"))
      .mockResolvedValueOnce(errorResponse("05"))
      .mockResolvedValueOnce(standardResponse([contractRow(1)]));
    const sleep = vi.fn(async () => undefined);

    const result = await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-01",
      },
      { serviceKey: "test-key", fetchImpl, sleep },
    );

    expect(result.rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("surfaces nkoneps error envelopes without retrying validation or range errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "nkoneps.com.response.ResponseError": {
            header: { resultCode: "07", resultMsg: "Input range exceeded" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const sleep = vi.fn(async () => undefined);

    await expect(
      searchCompetitorContracts(
        {
          bizNo: "1234567890",
          dateFrom: "2025-01-01",
          dateTo: "2025-01-07",
        },
        { serviceKey: "test-key", fetchImpl, sleep },
      ),
    ).rejects.toMatchObject({
      name: "CompetitorContractUpstreamError",
      kind: "response",
      upstreamCode: "07",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("surfaces OpenAPI service error envelopes without retrying authentication errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          OpenAPI_ServiceResponse: {
            cmmMsgHeader: {
              returnReasonCode: "30",
              returnAuthMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
              errMsg: "SERVICE ERROR",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const sleep = vi.fn(async () => undefined);

    await expect(
      searchCompetitorContracts(
        {
          bizNo: "1234567890",
          dateFrom: "2025-01-01",
          dateTo: "2025-01-07",
        },
        { serviceKey: "test-key", fetchImpl, sleep },
      ),
    ).rejects.toMatchObject({
      name: "CompetitorContractUpstreamError",
      kind: "response",
      upstreamCode: "30",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns an explicit incomplete error when totalCount exceeds the defensive page cap", async () => {
    const fetchImpl = vi.fn(async () => standardResponse([contractRow(1)], 999 * 100 + 1));

    await expect(
      searchCompetitorContracts(
        {
          bizNo: "1234567890",
          dateFrom: "2025-01-01",
          dateTo: "2025-01-07",
        },
        { serviceKey: "test-key", fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: "CompetitorContractUpstreamError",
      kind: "incomplete",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects more than two thousand five hundred date windows before fetching their first pages", async () => {
    const fetchImpl = vi.fn(async () => standardResponse([]));
    const dateFrom = new Date(Date.UTC(2000, 0, 1));
    const dateTo = new Date(dateFrom.getTime() + 2_500 * 7 * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);

    await expect(
      searchCompetitorContracts(
        { bizNo: "1234567890", dateFrom: "2000-01-01", dateTo },
        { serviceKey: "test-key", fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: "CompetitorContractUpstreamError",
      kind: "incomplete",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deduplicates identical contract rows", async () => {
    const duplicate = contractRow(1);
    const fetchImpl = vi.fn(async () => standardResponse([duplicate, duplicate], 2));

    const result = await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-07",
      },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.summary.contractCount).toBe(1);
  });

  it("attributes one joint contract to every requested supplier without inflating the source amount", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([
        contractRow(1, {
          corpList: [
            { corpNm: "First Competitor", bizno: "123-45-67890", cntrctAmt: "600" },
            { corpNm: "Second Competitor", bizno: "222-22-22222", cntrctAmt: "400" },
          ],
          cntrctCorpBizno: "123-45-67890",
          cntrctCorpNm: "First Competitor",
          totCntrctAmt: "1000",
          bidNtceNo: "NOTICE-JOINT",
        }),
      ]),
    );

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890,2222222222", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => ({
      bizNo: row.bizNoNormalized,
      amount: row.totalContractAmount,
      contractTotalAmount: row.contractTotalAmount,
      attribution: row.amountAttribution,
    }))).toEqual([
      { bizNo: "1234567890", amount: 600, contractTotalAmount: 1000, attribution: "supplier-reported" },
      { bizNo: "2222222222", amount: 400, contractTotalAmount: 1000, attribution: "supplier-reported" },
    ]);
    expect(result.summary).toMatchObject({
      contractCount: 1,
      totalAmount: 1000,
      noticeLinkedCount: 1,
    });
  });

  it("drops a requested supplier that is absent from the latest contract amendment", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([
        contractRow(1, {
          cntrctOrd: "1",
          cntrctCnclsDate: "20250110",
          corpList: "[A^B^C^Target Competitor^1234567890]",
          cntrctCorpBizno: "123-45-67890",
          cntrctCorpNm: "Target Competitor",
          totCntrctAmt: "1000",
        }),
        contractRow(1, {
          cntrctOrd: "2",
          cntrctCnclsDate: "20250115",
          corpList: "[A^B^C^Remaining Supplier^2222222222]",
          cntrctCorpBizno: "222-22-22222",
          cntrctCorpNm: "Remaining Supplier",
          totCntrctAmt: "800",
        }),
      ], 2),
    );

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toEqual([]);
    expect(result.summary).toEqual({
      contractCount: 0,
      totalAmount: 0,
      noticeLinkedCount: 0,
      latestContractDate: null,
    });
  });

  it("groups fallback amendments by original contract date before expanding suppliers", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([
        contractRow(1, {
          dcsnCntrctNo: "",
          bidNtceNo: "",
          cntrctDtlInfoUrl: "",
          frstCntrctDate: "20250105",
          cntrctOrd: "1",
          cntrctCnclsDate: "20250110",
          corpList: "[A^B^C^Target Competitor^1234567890]",
          cntrctCorpBizno: "123-45-67890",
          cntrctCorpNm: "Target Competitor",
          totCntrctAmt: "1000",
        }),
        contractRow(1, {
          dcsnCntrctNo: "",
          bidNtceNo: "",
          cntrctDtlInfoUrl: "",
          frstCntrctDate: "20250105",
          cntrctOrd: "2",
          cntrctCnclsDate: "20250115",
          corpList: "[A^B^C^Remaining Supplier^2222222222]",
          cntrctCorpBizno: "222-22-22222",
          cntrctCorpNm: "Remaining Supplier",
          totCntrctAmt: "800",
        }),
      ], 2),
    );

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toEqual([]);
    expect(result.summary.totalAmount).toBe(0);
  });

  it("uses an equal share when a joint contract has no supplier participation amounts", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([
        contractRow(1, {
          corpList:
            "[A^B^C^First Competitor^1234567890][A^B^C^Second Competitor^2222222222]",
          totCntrctAmt: "1001",
        }),
      ]),
    );

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890,2222222222", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows.map((row) => row.totalContractAmount).sort((left, right) => left - right)).toEqual([500, 501]);
    expect(result.rows.every((row) => row.amountAttribution === "equal-share")).toBe(true);
    expect(result.summary.totalAmount).toBe(1001);
  });

  it("uses supplier participation rates when every joint supplier rate is available", async () => {
    const fetchImpl = vi.fn(async () =>
      standardResponse([
        contractRow(1, {
          corpList: [
            { corpNm: "First Competitor", bizno: "123-45-67890", shareRate: "70" },
            { corpNm: "Second Competitor", bizno: "222-22-22222", shareRate: "30" },
          ],
          totCntrctAmt: "1000",
        }),
      ]),
    );

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890,2222222222", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows.map((row) => ({ amount: row.totalContractAmount, attribution: row.amountAttribution }))).toEqual([
      { amount: 700, attribution: "supplier-rate" },
      { amount: 300, attribution: "supplier-rate" },
    ]);
  });

  it("preserves joint-contract attribution metadata in cached rows", () => {
    const cachedResult = normalizeCachedCompetitorContractSearchResult(
      {
        rows: [mappedContractRow({
          totalContractAmount: 600,
          contractTotalAmount: 1000,
          amountAttribution: "supplier-reported",
        })],
      },
      new Set(["1234567890"]),
    );

    expect(cachedResult?.rows[0]).toMatchObject({
      totalContractAmount: 600,
      contractTotalAmount: 1000,
      amountAttribution: "supplier-reported",
    });
  });

  it("preserves source observations that differ only by normalized item codes", async () => {
    const source = contractRow(1);
    const fetchImpl = vi.fn(async () =>
      standardResponse(
        [
          { ...source, dtilPrdctClsfcNo: "39121801-01" },
          { ...source, dtilPrdctClsfcNo: "3912180199" },
        ],
        2,
      ),
    );

    const result = await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-07",
      },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.itemCodes)).toEqual([["3912180101"], ["3912180199"]]);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
  });

  it("keeps meaningful identifier punctuation distinct", async () => {
    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      {
        serviceKey: "test-key",
        fetchImpl: vi.fn(async () =>
          standardResponse([
            contractRow(1, { dcsnCntrctNo: "AB-12" }),
            contractRow(1, { dcsnCntrctNo: "A-B12" }),
          ]),
        ),
      },
    );

    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
  });

  it("preserves distinct payload observations that share a contract number", async () => {
    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      {
        serviceKey: "test-key",
        fetchImpl: vi.fn(async () =>
          standardResponse([
            contractRow(1, {
              dcsnCntrctNo: "SHARED-1",
              cntrctNm: "Initial contract observation",
              totCntrctAmt: "1000",
            }),
            contractRow(1, {
              dcsnCntrctNo: "SHARED-1",
              cntrctNm: "Corrected contract observation",
              totCntrctAmt: "2000",
            }),
          ]),
        ),
      },
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.contractNo === "SHARED-1")).toBe(true);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
  });

  it("preserves uncertain notice-only corrections as separate observations", async () => {
    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      {
        serviceKey: "test-key",
        fetchImpl: vi.fn(async () =>
          standardResponse([
            contractRow(1, { dcsnCntrctNo: "", bidNtceNo: "NOTICE-1", totCntrctAmt: "1000" }),
            contractRow(1, { dcsnCntrctNo: "", bidNtceNo: "NOTICE-1", totCntrctAmt: "2000" }),
          ]),
        ),
      },
    );

    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
  });

  it("preserves multiple awards under one notice using contract detail discriminators", async () => {
    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      {
        serviceKey: "test-key",
        fetchImpl: vi.fn(async () =>
          standardResponse([
            contractRow(1, {
              dcsnCntrctNo: "",
              bidNtceNo: "NOTICE-1",
              cntrctDtlInfoUrl: "https://example.test/contracts/award-1",
            }),
            contractRow(1, {
              dcsnCntrctNo: "",
              bidNtceNo: "NOTICE-1",
              cntrctDtlInfoUrl: "https://example.test/contracts/award-2",
            }),
          ]),
        ),
      },
    );

    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
  });

  it("coalesces exact fallback duplicates with a stable recomputed ID", async () => {
    const observation = contractRow(1, {
      dcsnCntrctNo: "",
      bidNtceNo: "",
      prodNm: "DDC controller",
      prdlstNm: "BEMS gateway",
    });
    const duplicateResult = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl: vi.fn(async () => standardResponse([observation, observation], 2)) },
    );
    const singleResult = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl: vi.fn(async () => standardResponse([observation])) },
    );

    expect(duplicateResult.rows).toHaveLength(1);
    expect(duplicateResult.rows[0]?.itemNames).toEqual(["DDC controller", "BEMS gateway"]);
    expect(duplicateResult.rows[0]?.id).toBe(singleResult.rows[0]?.id);
  });

  it("assigns the same stable ID to a source row regardless of its result index", async () => {
    const target = contractRow(7);
    const atIndexZero = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl: vi.fn(async () => standardResponse([target])) },
    );
    const atIndexOne = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl: vi.fn(async () => standardResponse([contractRow(8), target])) },
    );

    expect(atIndexZero.rows[0]?.id).toBeTruthy();
    expect(atIndexOne.rows.find((row) => row.contractNo === "C-7")?.id).toBe(atIndexZero.rows[0]?.id);
  });

  it("assigns the same stable ID when a source row appears in different date windows", async () => {
    const target = contractRow(7, { cntrctCnclsDate: "20250108" });
    const narrow = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-08", dateTo: "2025-01-08" },
      { serviceKey: "test-key", fetchImpl: vi.fn(async () => standardResponse([target])) },
    );
    const wideFetch = vi.fn(async (input: string | URL) => {
      const from = new URL(String(input)).searchParams.get("cntrctCnclsBgnDate");
      return from === "20250101"
        ? standardResponse([contractRow(8, { cntrctCnclsDate: "20250102" })])
        : standardResponse([target]);
    });
    const wide = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-08" },
      { serviceKey: "test-key", fetchImpl: wideFetch },
    );

    expect(wide.rows.find((row) => row.contractNo === "C-7")?.id).toBe(narrow.rows[0]?.id);
  });

  it("distinguishes genuinely different contracts without contract or notice numbers", async () => {
    const first = contractRow(1, { dcsnCntrctNo: "", bidNtceNo: "", cntrctNm: "First no-ID contract" });
    const second = contractRow(1, { dcsnCntrctNo: "", bidNtceNo: "", cntrctNm: "Second no-ID contract" });
    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl: vi.fn(async () => standardResponse([first, second])) },
    );

    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
  });

  it("bounds concurrent window requests at four", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetchImpl = vi.fn(async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;
      return standardResponse([]);
    });

    await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-02-04",
      },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(maxActiveRequests).toBe(4);
  });

  it("bounds concurrent derived page requests at four", async () => {
    const totalCount = 3997;
    let activePageRequests = 0;
    let maxActivePageRequests = 0;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const pageNo = Number(url.searchParams.get("pageNo"));
      const start = (pageNo - 1) * 999;
      const count = Math.max(0, Math.min(999, totalCount - start));
      if (pageNo > 1) {
        activePageRequests += 1;
        maxActivePageRequests = Math.max(maxActivePageRequests, activePageRequests);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activePageRequests -= 1;
      }
      return standardResponse(
        Array.from({ length: count }, (_, offset) => contractRow(start + offset)),
        totalCount,
      );
    });

    const result = await searchCompetitorContracts(
      {
        bizNo: "1234567890",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-07",
      },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(result.rows).toHaveLength(totalCount);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(maxActivePageRequests).toBe(4);
  });

  it("drops a target-only historical amendment when the API returns its latest non-target amendment first", async () => {
    const latestWithoutTarget = contractRow(30_001, {
      dcsnCntrctNo: "LATEST-FIRST-REMOVAL",
      cntrctOrd: "2",
      cntrctCnclsDate: "20250115",
      corpList: "[A^B^C^Remaining Supplier^2222222222]",
      cntrctCorpBizno: "222-22-22222",
      cntrctCorpNm: "Remaining Supplier",
    });
    const historicalTarget = contractRow(30_000, {
      dcsnCntrctNo: "LATEST-FIRST-REMOVAL",
      cntrctOrd: "1",
      cntrctCnclsDate: "20250110",
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl: vi.fn(async () => standardResponse([latestWithoutTarget, historicalTarget])) },
    );

    expect(result.rows).toEqual([]);
  });

  it("uses fallback agency names to reconcile a cached row with a coded source amendment", async () => {
    const cachedResult = {
      rows: [mappedContractRow({
        contractNo: "",
        noticeNo: "",
        contractDetailUrl: "",
        originalContractDate: "2025-01-03",
        amendmentOrder: 1,
        contractDate: "2025-01-03",
      })],
      summary: { contractCount: 1, totalAmount: 1_001, noticeLinkedCount: 1, latestContractDate: "2025-01-03" },
    };
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => [{ dateFrom: "2025-01-01", dateTo: "2025-01-07", result: cachedResult }]),
      setInterval: vi.fn(),
    };
    const latestWithoutTarget = contractRow(30_002, {
      dcsnCntrctNo: "",
      bidNtceNo: "",
      cntrctDtlInfoUrl: "",
      frstCntrctDate: "20250103",
      cntrctOrd: "2",
      cntrctCnclsDate: "20250110",
      cntrctNm: "Legacy cached contract",
      dminsttNm: "Demand agency",
      cntrctInsttNm: "Contract agency",
      dminsttCd: "D-001",
      cntrctInsttCd: "C-001",
      corpList: "[A^B^C^Replacement Supplier^2222222222]",
      cntrctCorpBizno: "222-22-22222",
      cntrctCorpNm: "Replacement Supplier",
    });

    const result = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-14" },
      { serviceKey: "test-key", fetchImpl: vi.fn(async () => standardResponse([latestWithoutTarget])), queryCache },
    );

    expect(result.rows).toEqual([]);
  });

  it("rejects a required empty middle page after bounded retries without caching", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      return pageNo === 1 ? standardResponse([contractRow(1)], 1_500) : standardResponse([], 1_500);
    });

    await expect(searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache },
    )).rejects.toMatchObject({ kind: "incomplete" });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(queryCache.set).not.toHaveBeenCalled();
    expect(queryCache.setInterval).not.toHaveBeenCalled();
  });

  it("persists each completed split window before a later window fails without caching the exact range", async () => {
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn(() => []),
      setInterval: vi.fn(),
    };
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const from = new URL(String(input)).searchParams.get("cntrctCnclsBgnDate");
      return from === "20250101" ? standardResponse([contractRow(1)]) : new Response("bad request", { status: 400 });
    });

    await expect(searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-14" },
      { serviceKey: "test-key", fetchImpl, queryCache, now: () => new Date("2026-07-22T00:00:00.000Z") },
    )).rejects.toMatchObject({ kind: "response" });

    expect(queryCache.setInterval).toHaveBeenCalledWith(
      { bizNoNormalized: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      expect.objectContaining({ rows: [expect.objectContaining({ contractNo: "C-1" })] }),
    );
    expect(queryCache.set).not.toHaveBeenCalled();
  });

  it("refetches a supplier-removal window so overlapping interval composition cannot revive a stale target", async () => {
    const intervals: Array<{ dateFrom: string; dateTo: string; result: CompetitorContractSearchResult }> = [];
    const queryCache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      getFreshIntervals: vi.fn((key: { dateFrom: string; dateTo: string }) =>
        intervals.filter((interval) => interval.dateFrom <= key.dateTo && interval.dateTo >= key.dateFrom)),
      setInterval: vi.fn((key: { dateFrom: string; dateTo: string }, result: CompetitorContractSearchResult) => {
        intervals.push({ dateFrom: key.dateFrom, dateTo: key.dateTo, result });
      }),
    };
    const historicalTarget = contractRow(30_003, {
      dcsnCntrctNo: "REFETCH-REMOVAL-WINDOW",
      cntrctOrd: "1",
      cntrctCnclsDate: "20250103",
    });
    const latestWithoutTarget = contractRow(30_004, {
      dcsnCntrctNo: "REFETCH-REMOVAL-WINDOW",
      cntrctOrd: "2",
      cntrctCnclsDate: "20250110",
      corpList: "[A^B^C^Replacement Supplier^2222222222]",
      cntrctCorpBizno: "222-22-22222",
      cntrctCorpNm: "Replacement Supplier",
    });
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const from = new URL(String(input)).searchParams.get("cntrctCnclsBgnDate");
      if (from === "20250101") return standardResponse([historicalTarget]);
      if (from === "20250108") return standardResponse([latestWithoutTarget]);
      return standardResponse([]);
    });

    const first = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-14" },
      { serviceKey: "test-key", fetchImpl, queryCache, now: () => new Date("2026-07-22T00:00:00.000Z") },
    );
    const overlapping = await searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-21" },
      { serviceKey: "test-key", fetchImpl, queryCache, now: () => new Date("2026-07-22T00:00:00.000Z") },
    );

    expect(first.rows).toEqual([]);
    expect(overlapping.rows).toEqual([]);
    expect(fetchImpl.mock.calls.map(([input]) =>
      new URL(String(input)).searchParams.get("cntrctCnclsBgnDate")
    ).filter((from) => from === "20250108")).toHaveLength(2);
  });

  it("rejects a nonzero totalCount with an empty first page after bounded retries", async () => {
    const queryCache = { get: vi.fn(() => null), set: vi.fn(), setInterval: vi.fn() };
    const fetchImpl = vi.fn(async () => standardResponse([], 1));

    await expect(searchCompetitorContracts(
      { bizNo: "1234567890", dateFrom: "2025-01-01", dateTo: "2025-01-07" },
      { serviceKey: "test-key", fetchImpl, queryCache },
    )).rejects.toMatchObject({ kind: "incomplete" });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(queryCache.set).not.toHaveBeenCalled();
    expect(queryCache.setInterval).not.toHaveBeenCalled();
  });
});
