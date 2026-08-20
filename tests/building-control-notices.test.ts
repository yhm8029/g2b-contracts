import { describe, expect, it } from "vitest";
import {
  collectNoticeInventory,
  collectNoticeInventoryByIdentity,
  parseNoticePage,
  parseNoticeProductPage,
  type G2bFetchJson,
} from "@/lib/building-control/g2b/notice-client";

const baseNotice = {
  bidNtceNo: "N1",
  bidNtceOrd: "001",
  bidNtceNm: "Notice One",
  bidNtceDt: "2025-01-10 10:00:00",
  bidNtceSttusNm: "active",
  dmndInsttNm: "Agency One",
  bidNtceDtlUrl: "https://example.com/n1",
};

const baseProduct = {
  bidNtceNo: "N1",
  bidNtceOrd: "001",
  bidClsfcNo: "39121801",
  prdctSno: "10",
  prdctClsfcNo: null,
  dtilPrdctClsfcNo: null,
};

function envelope(body: {
  pageNo: number;
  numOfRows: number;
  totalCount: number;
  items: unknown;
}) {
  return { response: { header: { resultCode: "00", resultMsg: "OK" }, body } };
}

describe("building-control-notices", () => {
  it("parseNoticePage maps fields and preserves rawJson", () => {
    const payload = envelope({
      pageNo: 2,
      numOfRows: 10,
      totalCount: 3,
      items: {
        item: [
          {
            ...baseNotice,
            bidNtceNo: "N2",
            bidNtceOrd: "002",
            bidNtceNm: "Second",
            bidNtceSttusNm: "cancelled",
          },
        ],
      },
    });
    const page = parseNoticePage(payload);
    expect(page.pageNo).toBe(2);
    expect(page.pageSize).toBe(10);
    expect(page.totalCount).toBe(3);
    expect(page.items.length).toBe(1);
    const item = page.items[0];
    expect(item.noticeNo).toBe("N2");
    expect(item.noticeOrder).toBe("002");
    expect(item.noticeName).toBe("Second");
    expect(item.publishedAt).toBe("2025-01-10 10:00:00");
    expect(item.status).toBe("cancelled");
    expect(item.demandAgencyName).toBe("Agency One");
    expect(item.sourceUrl).toBe("https://example.com/n1");
    expect(typeof item.rawJson).toBe("string");
    expect(JSON.parse(item.rawJson!).bidNtceNo).toBe("N2");
  });

  it("parseNoticePage supports singleton, blank status, and throws on nonzero result", () => {
    const payload = envelope({
      pageNo: 1,
      numOfRows: 1,
      totalCount: 1,
      items: { item: { ...baseNotice, bidNtceSttusNm: "" } },
    });
    const page = parseNoticePage(payload);
    expect(page.items.length).toBe(1);
    expect(page.items[0].noticeNo).toBe("N1");
    expect(page.items[0].status).toBe("");
    const bad = {
      response: {
        header: { resultCode: "99", resultMsg: "ERR" },
        body: { pageNo: 1, numOfRows: 1, totalCount: 0, items: { item: [] } },
      },
    };
    expect(() => parseNoticePage(bad)).toThrow();
  });

  it("parseNoticeProductPage preserves parent-only, exact detail, sibling targetCodes, and malformed detail rows", () => {
    const raw = [
      {
        ...baseProduct,
        bidNtceNo: "N1",
        bidNtceOrd: "001",
        prdctSno: "10",
        prdctClsfcNo: "39121801",
        dtilPrdctClsfcNo: "3912180101",
      },
      {
        ...baseProduct,
        bidNtceNo: "N2",
        bidNtceOrd: "002",
        prdctSno: "20",
        prdctClsfcNo: "39121801",
        dtilPrdctClsfcNo: "3912180102",
      },
      {
        ...baseProduct,
        bidNtceNo: "N3",
        bidNtceOrd: "003",
        prdctSno: "30",
        prdctClsfcNo: "39121801",
        dtilPrdctClsfcNo: null,
      },
      {
        ...baseProduct,
        bidNtceNo: "N4",
        bidNtceOrd: "004",
        prdctSno: "40",
        prdctClsfcNo: "39121801",
        dtilPrdctClsfcNo: "bad-code",
      },
    ];
    const payload = envelope({
      pageNo: 1,
      numOfRows: 10,
      totalCount: 4,
      items: { item: raw },
    });
    const productPage = parseNoticeProductPage(payload);
    expect(productPage.items.length).toBe(4);
    const [d1, d2, d3, d4] = productPage.items;
    expect(d1.targetCode).toBe("3912180101");
    expect(d2.targetCode).toBeNull();
    expect(d3.targetCode).toBe("39121801");
    expect(d4.targetCode).toBeNull();
    expect(d1.noticeNo).toBe("N1");
    expect(d1.noticeOrder).toBe("001");
    expect(d1.bidClassNo).toBe("39121801");
    expect(d1.parentCode).toBe("39121801");
    expect(d1.detailCode).toBe("3912180101");
    expect(d1.productSerial).toBe("10");
    expect(d4.noticeNo).toBe("N4");
    expect(d4.noticeOrder).toBe("004");
    expect(d4.parentCode).toBe("39121801");
    expect(d4.detailCode).toBeNull();
    expect(d4.targetCode).toBeNull();
    const identities = productPage.items.map((p) => p.providerRowIdentity);
    expect(new Set(identities).size).toBe(identities.length);
    const hashes = productPage.items.map((p) => p.sourceHash);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const p of productPage.items) {
      expect(p.providerRowIdentity).toBeTruthy();
      expect(p.sourceIdentity).toEqual(p.providerRowIdentity);
      expect(p.sourceIdentity).not.toEqual(p.noticeNo);
      expect(p.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    }
    const reparsed = parseNoticeProductPage(payload);
    expect(reparsed.items.map((p) => p.providerRowIdentity)).toEqual(
      productPage.items.map((p) => p.providerRowIdentity),
    );
    expect(reparsed.items.map((p) => p.sourceHash)).toEqual(
      productPage.items.map((p) => p.sourceHash),
    );
  });

  it("collectNoticeInventory paginates, filters, and preserves failures", async () => {
    const not1 = { ...baseNotice };
    const not2 = {
      ...baseNotice,
      bidNtceNo: "N2",
      bidNtceOrd: "002",
      bidNtceSttusNm: "cancelled",
    };
    const not3 = {
      ...baseNotice,
      bidNtceNo: "N3",
      bidNtceOrd: "003",
      bidNtceSttusNm: "failed",
    };
    const prod1 = {
      ...baseProduct,
      bidNtceNo: "N1",
      bidNtceOrd: "001",
      prdctSno: "10",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: "3912180101",
    };
    const prod2 = {
      ...baseProduct,
      bidNtceNo: "N2",
      bidNtceOrd: "002",
      prdctSno: "20",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: "3912180102",
    };
    const prod3 = {
      ...baseProduct,
      bidNtceNo: "N3",
      bidNtceOrd: "003",
      prdctSno: "30",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: null,
    };
    const calls: Array<{ operation: string; params: Record<string, unknown> }> =
      [];
    const fetchJson: G2bFetchJson = async (operation, params) => {
      calls.push({ operation, params });
      if (operation === "getBidPblancListInfoThng") {
        if (params.pageNo === 1)
          return envelope({
            pageNo: 1,
            numOfRows: 2,
            totalCount: 3,
            items: { item: [not1, not2] },
          });
        return envelope({
          pageNo: 2,
          numOfRows: 2,
          totalCount: 3,
          items: { item: [not3] },
        });
      }
      if (operation === "getBidPblancListInfoThngPurchsObjPrdct") {
        if (params.pageNo === 1)
          return envelope({
            pageNo: 1,
            numOfRows: 2,
            totalCount: 3,
            items: { item: [prod1, prod2] },
          });
        return envelope({
          pageNo: 2,
          numOfRows: 2,
          totalCount: 3,
          items: { item: [prod3] },
        });
      }
      throw new Error("unexpected operation");
    };
    const result = await collectNoticeInventory({
      dateFrom: "202501010000",
      dateTo: "202501312359",
      pageSize: 2,
      maxPages: 5,
      fetchJson,
    });
    expect(calls.length).toBe(4);
    expect(calls.map((c) => c.operation).sort()).toEqual([
      "getBidPblancListInfoThng",
      "getBidPblancListInfoThng",
      "getBidPblancListInfoThngPurchsObjPrdct",
      "getBidPblancListInfoThngPurchsObjPrdct",
    ]);
    for (const c of calls) {
      expect(c.params.inqryDiv).toBe("1");
      expect(c.params.inqryBgnDt).toBe("202501010000");
      expect(c.params.inqryEndDt).toBe("202501312359");
      expect(c.params.numOfRows).toBe(2);
      expect(c.params.pageNo).toBeGreaterThanOrEqual(1);
      expect(c.params.pageNo).toBeLessThanOrEqual(2);
    }
    const noticeOps = calls.filter(
      (c) => c.operation === "getBidPblancListInfoThng",
    );
    expect(noticeOps.map((c) => c.params.pageNo).sort()).toEqual([1, 2]);
    const productOps = calls.filter(
      (c) => c.operation === "getBidPblancListInfoThngPurchsObjPrdct",
    );
    expect(productOps.map((c) => c.params.pageNo).sort()).toEqual([1, 2]);
    expect(result.notices.length).toBe(2);
    expect(result.notices.map((n) => n.noticeNo).sort()).toEqual(["N1", "N3"]);
    expect(result.notices.find((n) => n.noticeNo === "N3")!.status).toBe(
      "failed",
    );
    expect(result.products.length).toBe(2);
    expect(result.products.map((p) => p.noticeNo).sort()).toEqual(["N1", "N3"]);
    expect(result.products.find((p) => p.noticeNo === "N1")!.targetCode).toBe(
      "3912180101",
    );
    expect(result.products.find((p) => p.noticeNo === "N3")!.targetCode).toBe(
      "39121801",
    );
    expect(result.totalCount).toBe(3);
  });

  it("collectNoticeInventoryByIdentity returns the target notice and target product across pages", async () => {
    const oldNotice = {
      ...baseNotice,
      bidNtceNo: "OLD-1",
      bidNtceOrd: "00",
      bidNtceDt: "2024-06-15 09:00:00",
    };
    const sibling = {
      ...baseProduct,
      bidNtceNo: "OLD-1",
      bidNtceOrd: "00",
      prdctSno: "10",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: "3912180102",
    };
    const target = {
      ...baseProduct,
      bidNtceNo: "OLD-1",
      bidNtceOrd: "00",
      prdctSno: "20",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: "3912180101",
    };
    const calls: Array<{ operation: string; params: Record<string, unknown> }> =
      [];
    const fetchJson: G2bFetchJson = async (operation, params) => {
      calls.push({ operation, params });
      if (operation === "getBidPblancListInfoThng") {
        expect(params.inqryDiv).toBe("2");
        expect(params.bidNtceNo).toBe("OLD-1");
        expect(params.pageNo).toBe(1);
        expect(params.numOfRows).toBe(1);
        return envelope({
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: { item: oldNotice },
        });
      }
      if (operation === "getBidPblancListInfoThngPurchsObjPrdct") {
        expect(params.inqryDiv).toBe("2");
        expect(params.bidNtceNo).toBe("OLD-1");
        expect(params.bidNtceOrd).toBe("00");
        expect(params.numOfRows).toBe(1);
        if (params.pageNo === 1)
          return envelope({
            pageNo: 1,
            numOfRows: 1,
            totalCount: 2,
            items: { item: sibling },
          });
        if (params.pageNo === 2)
          return envelope({
            pageNo: 2,
            numOfRows: 1,
            totalCount: 2,
            items: { item: target },
          });
        throw new Error("unexpected product page");
      }
      throw new Error("unexpected operation");
    };
    const result = await collectNoticeInventoryByIdentity({
      noticeNo: "OLD-1",
      noticeOrder: "00",
      pageSize: 1,
      maxPages: 5,
      fetchJson,
    });
    expect(calls.length).toBe(3);
    const noticeCall = calls.filter(
      (c) => c.operation === "getBidPblancListInfoThng",
    );
    expect(noticeCall.length).toBe(1);
    expect(noticeCall[0].params.inqryDiv).toBe("2");
    expect(noticeCall[0].params.bidNtceNo).toBe("OLD-1");
    expect(noticeCall[0].params.pageNo).toBe(1);
    expect(noticeCall[0].params.numOfRows).toBe(1);
    const productCalls = calls.filter(
      (c) => c.operation === "getBidPblancListInfoThngPurchsObjPrdct",
    );
    expect(productCalls.length).toBe(2);
    expect(productCalls.map((c) => c.params.pageNo).sort()).toEqual([1, 2]);
    for (const c of productCalls) {
      expect(c.params.inqryDiv).toBe("2");
      expect(c.params.bidNtceNo).toBe("OLD-1");
      expect(c.params.bidNtceOrd).toBe("00");
      expect(c.params.numOfRows).toBe(1);
    }
    expect(productCalls.find((c) => c.params.pageNo === 1)).toBeDefined();
    expect(productCalls.find((c) => c.params.pageNo === 2)).toBeDefined();
    expect(result.notices.length).toBe(1);
    expect(result.notices[0].noticeNo).toBe("OLD-1");
    expect(result.notices[0].noticeOrder).toBe("00");
    expect(result.notices[0].publishedAt).toBe("2024-06-15 09:00:00");
    expect(result.products.length).toBe(1);
    expect(result.products[0].noticeNo).toBe("OLD-1");
    expect(result.products[0].noticeOrder).toBe("00");
    expect(result.products[0].productSerial).toBe("20");
    expect(result.products[0].targetCode).toBe("3912180101");
    expect(result.products[0].parentCode).toBe("39121801");
    expect(result.products[0].detailCode).toBe("3912180101");
    expect(result.totalCount).toBe(1);
  });

  it("collectNoticeInventory rejects empty product page when totalCount exceeds cardinality", async () => {
    const fetchJson: G2bFetchJson = async (operation, params) => {
      if (operation === "getBidPblancListInfoThng") {
        if (params.pageNo === 1 && params.numOfRows === 1)
          return envelope({
            pageNo: 1,
            numOfRows: 1,
            totalCount: 1,
            items: { item: [{ ...baseNotice }] },
          });
        throw new Error("unexpected notice page");
      }
      if (operation === "getBidPblancListInfoThngPurchsObjPrdct") {
        if (params.pageNo === 1)
          return envelope({
            pageNo: 1,
            numOfRows: 1,
            totalCount: 2,
            items: {
              item: [
                {
                  ...baseProduct,
                  bidNtceNo: "N1",
                  bidNtceOrd: "001",
                  prdctSno: "10",
                  prdctClsfcNo: "39121801",
                  dtilPrdctClsfcNo: "3912180101",
                },
              ],
            },
          });
        return envelope({
          pageNo: 2,
          numOfRows: 1,
          totalCount: 2,
          items: { item: [] },
        });
      }
      throw new Error("unexpected operation");
    };
    await expect(
      collectNoticeInventory({
        dateFrom: "202501010000",
        dateTo: "202501312359",
        pageSize: 1,
        maxPages: 5,
        fetchJson,
      }),
    ).rejects.toThrow(/cardinality|items count|complete/i);
  });

  it("collectNoticeInventory rejects a target product orphaned from the complete notice set", async () => {
    const orphanProduct = {
      ...baseProduct,
      bidNtceNo: "ORPHAN-1",
      bidNtceOrd: "00",
      prdctSno: "10",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: "3912180101",
    };
    const fetchJson: G2bFetchJson = async (operation) => {
      if (operation === "getBidPblancListInfoThng") {
        return envelope({
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: {
            item: [{ ...baseNotice, bidNtceNo: "N1", bidNtceOrd: "001" }],
          },
        });
      }
      if (operation === "getBidPblancListInfoThngPurchsObjPrdct") {
        return envelope({
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: { item: [orphanProduct] },
        });
      }
      throw new Error("unexpected operation");
    };
    await expect(
      collectNoticeInventory({
        dateFrom: "202501010000",
        dateTo: "202501312359",
        pageSize: 1,
        maxPages: 5,
        fetchJson,
      }),
    ).rejects.toThrow(/identity|orphan|mismatch/i);
  });

  it("collectNoticeInventoryByIdentity rejects notice and product rows with a different identity", async () => {
    const requestedNotice = {
      ...baseNotice,
      bidNtceNo: "OLD-1",
      bidNtceOrd: "00",
    };
    const mismatchedNotice = { ...requestedNotice, bidNtceNo: "OTHER-1" };
    const mismatchedProduct = {
      ...baseProduct,
      bidNtceNo: "OTHER-1",
      bidNtceOrd: "00",
      prdctSno: "10",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: "3912180101",
    };
    const noticeFetch: G2bFetchJson = async (operation) => {
      if (operation === "getBidPblancListInfoThng") {
        return envelope({
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: { item: [mismatchedNotice] },
        });
      }
      throw new Error("unexpected operation");
    };
    await expect(
      collectNoticeInventoryByIdentity({
        noticeNo: "OLD-1",
        noticeOrder: "00",
        pageSize: 1,
        maxPages: 1,
        fetchJson: noticeFetch,
      }),
    ).rejects.toThrow(/identity|orphan|mismatch/i);

    const productFetch: G2bFetchJson = async (operation) => {
      if (operation === "getBidPblancListInfoThng") {
        return envelope({
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: { item: [requestedNotice] },
        });
      }
      if (operation === "getBidPblancListInfoThngPurchsObjPrdct") {
        return envelope({
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: { item: [mismatchedProduct] },
        });
      }
      throw new Error("unexpected operation");
    };
    await expect(
      collectNoticeInventoryByIdentity({
        noticeNo: "OLD-1",
        noticeOrder: "00",
        pageSize: 1,
        maxPages: 1,
        fetchJson: productFetch,
      }),
    ).rejects.toThrow(/identity|orphan|mismatch/i);
  });
});
