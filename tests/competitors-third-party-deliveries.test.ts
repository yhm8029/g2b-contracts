import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

import { searchCompetitorThirdPartyDeliveries } from "@/lib/competitors/third-party-deliveries";
import { initializeSqliteSchema } from "@/lib/db/init";

function providerResponse(items: Record<string, unknown>[], totalCount = items.length) {
  return new Response(JSON.stringify({
    response: {
      header: { resultCode: "00", resultMsg: "OK" },
      body: { totalCount: String(totalCount), items: { item: items } },
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    bizno: "123-45-67890",
    corpNm: "테스트 경쟁사",
    cntrctDlvrReqDate: "20260615",
    cntrctDlvrReqNo: "R26TB000001",
    cntrctDlvrReqChgOrd: "00",
    fnlCntrctDlvrReqChgOrdYn: "Y",
    prdctAmt: "125000000",
    dtilPrdctClsfcNo: "3912180101",
    cntrctDivNm: "제3자단가계약",
    cntrctDlvrDivNm: "납품요구",
    cntrctMthdNm: "수의계약",
    dminsttNm: "수요기관",
    cntrctDlvrReqNm: "빌딩자동제어장치 납품요구",
    uprcCntrctNo: "R26TA000001",
    prdctIdntNo: "12345678",
    ...overrides,
  };
}

describe("competitor third-party delivery search", () => {
  it("fetches the filtered product API and maps only final registered third-party delivery requests", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL) => providerResponse([
      deliveryRow(),
      deliveryRow({ cntrctDlvrReqNo: "R26TB000002", bizno: "999-99-99999" }),
      deliveryRow({ cntrctDlvrReqNo: "R26TB000003", cntrctDivNm: "수의계약" }),
      deliveryRow({ cntrctDlvrReqNo: "R26TB000004", cntrctDlvrDivNm: "계약" }),
      deliveryRow({ cntrctDlvrReqNo: "R26TB000005", fnlCntrctDlvrReqChgOrdYn: "N" }),
      deliveryRow({ cntrctDlvrReqNo: "R26TB000006", dtilPrdctClsfcNo: "3912180102" }),
    ]));

    const result = await searchCompetitorThirdPartyDeliveries(
      { bizNos: ["1234567890"], dateFrom: "2026-06-01", dateTo: "2026-06-30" },
      { serviceKey: "encoded%2Ftest%2Bkey", fetchImpl },
    );

    expect(result.rows).toEqual([expect.objectContaining({
      sourceDataset: "g2b-shopping-mall-third-party-delivery",
      bizNoNormalized: "1234567890",
      contractDate: "2026-06-15",
      totalContractAmount: 125000000,
      contractMethod: "제3자단가계약",
      contractNo: "R26TB000001",
      itemCodes: ["3912180101"],
    })]);
    expect(result.coverage).toEqual({ complete: true, fresh: true, missingRanges: [] });

    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe(
      "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getSpcifyPrdlstPrcureInfoList",
    );
    expect(Object.fromEntries(url.searchParams.entries())).toMatchObject({
      serviceKey: "encoded/test+key",
      type: "json",
      pageNo: "1",
      numOfRows: "999",
      inqryDiv: "1",
      inqryBgnDate: "20260601",
      inqryEndDate: "20260630",
      inqryPrdctDiv: "2",
      dtilPrdctClsfcNo: "3912180101",
      fnlCntrctDlvrReqChgOrdYn: "Y",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("serviceKey=encoded%2Ftest%2Bkey");
  });

  it("continues paging by received provider rows until totalCount is reached", async () => {
    const pageRows = [10, 10, 5].map((count, pageIndex) =>
      Array.from({ length: count }, (_value, rowIndex) => deliveryRow({
        cntrctDlvrReqNo: `R26TB${pageIndex}${String(rowIndex).padStart(3, "0")}`,
        cntrctDlvrReqDate: "20260615",
      })),
    );
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      return providerResponse(pageRows[pageNo - 1] ?? [], 25);
    });

    const result = await searchCompetitorThirdPartyDeliveries(
      { bizNos: ["1234567890"], dateFrom: "2026-06-01", dateTo: "2026-06-30" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("pageNo"))).toEqual(["1", "2", "3"]);
    expect(result.rows).toHaveLength(25);
    expect(result.rows.map((row) => row.contractNo)).toHaveLength(25);
  });

  it("continues beyond one hundred short provider pages", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      const count = pageNo <= 100 ? 10 : 5;
      return providerResponse(
        Array.from({ length: count }, (_value, index) => deliveryRow({
          cntrctDlvrReqNo: `R26TB${String(pageNo).padStart(3, "0")}${String(index).padStart(2, "0")}`,
        })),
        1_005,
      );
    });

    const result = await searchCompetitorThirdPartyDeliveries(
      { bizNos: ["1234567890"], dateFrom: "2026-06-01", dateTo: "2026-06-30" },
      { serviceKey: "test-key", fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(101);
    expect(result.rows).toHaveLength(1_005);
  });

  it("stops at the one-thousand-page safety limit", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
      return providerResponse([deliveryRow({ cntrctDlvrReqNo: `R-${pageNo}` })], 1_001);
    });

    await expect(searchCompetitorThirdPartyDeliveries(
      { bizNos: ["1234567890"], dateFrom: "2026-06-01", dateTo: "2026-06-30" },
      { serviceKey: "test-key", fetchImpl },
    )).rejects.toMatchObject({
      name: "CompetitorContractUpstreamError",
      kind: "response",
      message: expect.stringContaining("1,000-page safety limit"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1_000);
  });

  it("excludes provider rows whose contract dates fall outside the requested range", async () => {
    const result = await searchCompetitorThirdPartyDeliveries(
      { bizNos: ["1234567890"], dateFrom: "2026-06-10", dateTo: "2026-06-20" },
      {
        serviceKey: "test-key",
        fetchImpl: async () => providerResponse([
          deliveryRow({ cntrctDlvrReqNo: "BEFORE", cntrctDlvrReqDate: "20260609" }),
          deliveryRow({ cntrctDlvrReqNo: "INSIDE", cntrctDlvrReqDate: "20260615" }),
          deliveryRow({ cntrctDlvrReqNo: "AFTER", cntrctDlvrReqDate: "20260621" }),
        ]),
      },
    );

    expect(result.rows.map((row) => row.contractNo)).toEqual(["INSIDE"]);
  });

  it("extends a fresh in-progress month cache by fetching only the missing suffix", async () => {
    const sqlite = new Database(":memory:");
    initializeSqliteSchema(sqlite);
    const now = () => new Date("2026-07-23T00:00:00.000Z");

    try {
      await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-22" },
        {
          serviceKey: "test-key",
          sqlite,
          now,
          fetchImpl: async () => providerResponse([deliveryRow({
            cntrctDlvrReqDate: "20260722",
            cntrctDlvrReqNo: "R-20260722",
          })]),
        },
      );

      const partial = await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-23" },
        { serviceKey: "", sqlite, now, cacheOnly: true },
      );
      expect(partial.rows.map((row) => row.contractDate)).toEqual(["2026-07-22"]);
      expect(partial.coverage).toEqual({
        complete: false,
        fresh: true,
        missingRanges: [{ dateFrom: "2026-07-23", dateTo: "2026-07-23" }],
      });

      const fetchImpl = vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("inqryBgnDate")).toBe("20260723");
        expect(url.searchParams.get("inqryEndDate")).toBe("20260723");
        return providerResponse([deliveryRow({
          cntrctDlvrReqDate: "20260723",
          cntrctDlvrReqNo: "R-20260723",
        })]);
      });
      const extended = await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-23" },
        { serviceKey: "test-key", sqlite, now, fetchImpl },
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(extended.rows.map((row) => row.contractDate)).toEqual(["2026-07-22", "2026-07-23"]);
      expect(extended.coverage).toEqual({ complete: true, fresh: true, missingRanges: [] });
      expect(sqlite.prepare(`
        SELECT date_from AS dateFrom, date_to AS dateTo, result_version AS resultVersion
        FROM competitor_third_party_delivery_monthly_cache
      `).all()).toEqual([{ dateFrom: "2026-07-01", dateTo: "2026-07-23", resultVersion: "v3" }]);
    } finally {
      sqlite.close();
    }
  });

  it("refetches the full requested month when the available prefix is stale", async () => {
    const sqlite = new Database(":memory:");
    initializeSqliteSchema(sqlite);
    let current = new Date("2026-07-23T00:00:00.000Z");
    const now = () => current;

    try {
      await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-22" },
        { serviceKey: "test-key", sqlite, now, fetchImpl: async () => providerResponse([deliveryRow()]) },
      );
      current = new Date("2026-07-24T00:00:00.000Z");

      const cached = await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-23" },
        { serviceKey: "", sqlite, now, cacheOnly: true },
      );
      expect(cached.coverage).toEqual({
        complete: false,
        fresh: false,
        missingRanges: [{ dateFrom: "2026-07-23", dateTo: "2026-07-23" }],
      });

      const fetchImpl = vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("inqryBgnDate")).toBe("20260701");
        expect(url.searchParams.get("inqryEndDate")).toBe("20260723");
        return providerResponse([]);
      });
      await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-23" },
        { serviceKey: "test-key", sqlite, now, fetchImpl },
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      sqlite.close();
    }
  });

  it("keeps the original prefix TTL after incremental cache extensions", async () => {
    const sqlite = new Database(":memory:");
    initializeSqliteSchema(sqlite);
    let current = new Date("2026-07-23T00:00:00.000Z");
    const now = () => current;

    try {
      await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-21" },
        {
          serviceKey: "test-key",
          sqlite,
          now,
          fetchImpl: async () => providerResponse([deliveryRow({
            cntrctDlvrReqDate: "20260721",
            cntrctDlvrReqNo: "R-20260721",
          })]),
        },
      );

      current = new Date("2026-07-23T23:00:00.000Z");
      await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-22" },
        {
          serviceKey: "test-key",
          sqlite,
          now,
          fetchImpl: async () => providerResponse([deliveryRow({
            cntrctDlvrReqDate: "20260722",
            cntrctDlvrReqNo: "R-20260722",
          })]),
        },
      );

      current = new Date("2026-07-24T01:00:00.000Z");
      const cached = await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-07-01", dateTo: "2026-07-22" },
        { serviceKey: "", sqlite, now, cacheOnly: true },
      );

      expect(cached.rows.map((row) => row.contractDate)).toEqual(["2026-07-21", "2026-07-22"]);
      expect(cached.coverage).toEqual({ complete: true, fresh: false, missingRanges: [] });
    } finally {
      sqlite.close();
    }
  });

  it("fetches missing months with concurrency three while preserving month order", async () => {
    const sqlite = new Database(":memory:");
    initializeSqliteSchema(sqlite);
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const date = new URL(String(input)).searchParams.get("inqryBgnDate") ?? "";
      return providerResponse([deliveryRow({ cntrctDlvrReqDate: date, cntrctDlvrReqNo: `R-${date}` })]);
    });

    try {
      const result = await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-01-01", dateTo: "2026-04-30" },
        { serviceKey: "test-key", sqlite, fetchImpl, now: () => new Date("2026-05-01T00:00:00.000Z") },
      );

      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(maxActive).toBe(3);
      expect(result.rows.map((row) => row.contractDate)).toEqual([
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("stores monthly chunks and composes quarter cache-only reads without fetching", async () => {
    const sqlite = new Database(":memory:");
    initializeSqliteSchema(sqlite);
    const now = () => new Date("2026-07-23T00:00:00.000Z");
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const date = url.searchParams.get("inqryBgnDate") ?? "20260401";
      return providerResponse([deliveryRow({
        cntrctDlvrReqNo: `R-${date}`,
        cntrctDlvrReqDate: date,
      })]);
    });

    try {
      const live = await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-04-01", dateTo: "2026-06-30" },
        { serviceKey: "test-key", fetchImpl, sqlite, now },
      );
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(live.rows.map((row) => row.contractDate)).toEqual(["2026-04-01", "2026-05-01", "2026-06-01"]);

      const cached = await searchCompetitorThirdPartyDeliveries(
        { bizNos: ["1234567890"], dateFrom: "2026-04-01", dateTo: "2026-06-30" },
        {
          serviceKey: "",
          fetchImpl: vi.fn(async () => {
            throw new Error("cache-only must not fetch");
          }),
          sqlite,
          now,
          cacheOnly: true,
        },
      );

      expect(cached.rows.map((row) => row.contractDate)).toEqual(["2026-04-01", "2026-05-01", "2026-06-01"]);
      expect(cached.coverage).toEqual({ complete: true, fresh: true, missingRanges: [] });
    } finally {
      sqlite.close();
    }
  });

  it("reports the requested monthly range as missing for cache-only reads without SQLite", async () => {
    const result = await searchCompetitorThirdPartyDeliveries(
      { bizNos: ["1234567890"], dateFrom: "2026-06-01", dateTo: "2026-06-30" },
      { serviceKey: "", cacheOnly: true },
    );

    expect(result).toMatchObject({
      rows: [],
      coverage: {
        complete: false,
        fresh: false,
        missingRanges: [{ dateFrom: "2026-06-01", dateTo: "2026-06-30" }],
      },
    });
  });
});
