import { describe, expect, it, vi } from "vitest";

import {
  fetchShoppingMallDeliveryRequestDetailPage,
  fetchShoppingMallDeliveryRequestInfoPage,
} from "@/lib/g2b/shopping-mall-client";
import {
  SHOPPING_THIRD_PARTY_SOURCE_DATASET,
  mapShoppingMallThirdPartyDeliveryRow,
} from "@/lib/g2b/shopping-mall-mapper";

const BIZ_NO = "2048145651";

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    dlvrReqNo: "R26TB02063727",
    dlvrReqChgOrd: "01",
    dlvrReqRcptDate: "2026-06-26",
    prdctSno: "1",
    prdctClsfcNoNm: "화물트럭",
    dtilPrdctClsfcNoNm: "화물트럭",
    prdctIdntNo: "26272005",
    prdctIdntNoNm: "화물트럭, 현대자동차, 군용 파비스 5.5톤 카고",
    prdctUprc: "95860000",
    prdctQty: "6",
    prdctAmt: "575160000",
    dminsttCd: "ZD00291",
    dminsttNm: "해군군수사령부",
    corpNm: "샘플시스템(주)",
    cntrctCorpBizno: "204-81-45651",
    dlvrReqNm: "해군 5톤 화물트럭 구매",
    cntrctNo: "R26TA01979782",
    cntrctChgOrd: "00",
    cntrctCnclsStleNm: "제3자단가계약",
    brnofceNm: "경남지방조달청",
    ...overrides,
  };
}

describe("shopping mall third-party delivery mapper", () => {
  it("maps third-party unit-price delivery request rows into searchable sales records", () => {
    const result = mapShoppingMallThirdPartyDeliveryRow(providerRow(), BIZ_NO);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.reason);
    }

    expect(result.row).toMatchObject({
      sourceDataset: SHOPPING_THIRD_PARTY_SOURCE_DATASET,
      bizNoNormalized: BIZ_NO,
      bizNoDisplay: "204-81-45651",
      businessName: "샘플시스템(주)",
      businessCategory: "shopping_third_party",
      noticeName: "해군 5톤 화물트럭 구매",
      contractNo: "R26TB02063727",
      unifiedContractNo: "R26TB02063727-01-1",
      contractName: "화물트럭, 현대자동차, 군용 파비스 5.5톤 카고",
      contractDate: "2026-06-26",
      currentContractAmount: 575160000,
      totalContractAmount: 575160000,
      demandAgencyCode: "ZD00291",
      demandAgencyName: "해군군수사령부",
      contractAgencyName: "경남지방조달청",
      contractMethod: "제3자단가계약",
      businessNameAtContract: "샘플시스템(주)",
    });
    expect(result.row.sourceRowHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not match rows for another contractor business number", () => {
    const result = mapShoppingMallThirdPartyDeliveryRow(providerRow({ cntrctCorpBizno: "1112233333" }), BIZ_NO);

    expect(result).toEqual({ success: false, reason: "biz_no does not match shopping mall delivery row." });
  });

  it("does not assume rows with missing contract type are third-party unit-price sales", () => {
    const result = mapShoppingMallThirdPartyDeliveryRow(providerRow({ cntrctCnclsStleNm: undefined }), BIZ_NO);

    expect(result).toEqual({
      success: false,
      reason: "shopping mall delivery row is not third-party unit-price.",
    });
  });
});

describe("shopping mall third-party delivery client", () => {
  it("calls the delivery request info endpoint with date chunk parameters", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    const fetchMock = vi.fn(async (_url: URL) => ({
      ok: true,
      json: async () => ({
        response: {
          header: { resultCode: "00" },
          body: {
            totalCount: "1",
            items: { item: providerRow() },
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.DATA_GO_KR_SERVICE_KEY = "TEST_KEY";

    try {
      const page = await fetchShoppingMallDeliveryRequestInfoPage(
        { dateFrom: "2026-06-01", dateTo: "2026-06-29", granularity: "month" },
        2,
        50,
      );

      expect(page).toEqual({
        items: [providerRow()],
        totalCount: 1,
        pageNo: 2,
        numOfRows: 50,
      });

      const [url] = fetchMock.mock.calls[0] as [URL];
      expect(url.origin + url.pathname).toBe(
        "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getDlvrReqInfoList",
      );
      expect(url.searchParams.get("type")).toBe("json");
      expect(url.searchParams.get("inqryDiv")).toBe("1");
      expect(url.searchParams.get("inqryBgnDate")).toBe("20260601");
      expect(url.searchParams.get("inqryEndDate")).toBe("20260629");
      expect(url.searchParams.get("pageNo")).toBe("2");
      expect(url.searchParams.get("numOfRows")).toBe("50");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });

  it("calls the delivery request detail endpoint for one matched delivery request", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    const fetchMock = vi.fn(async (_url: URL) => ({
      ok: true,
      json: async () => ({
        response: {
          header: { resultCode: "00" },
          body: {
            totalCount: "1",
            items: { item: providerRow() },
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.DATA_GO_KR_SERVICE_KEY = "TEST_KEY";

    try {
      const page = await fetchShoppingMallDeliveryRequestDetailPage(
        { dateFrom: "2026-06-01", dateTo: "2026-06-29", granularity: "month" },
        "R26TB02063727",
        3,
        25,
      );

      expect(page.totalCount).toBe(1);

      const [url] = fetchMock.mock.calls[0] as [URL];
      expect(url.origin + url.pathname).toBe(
        "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getDlvrReqDtlInfoList",
      );
      expect(url.searchParams.get("inqryDiv")).toBe("2");
      expect(url.searchParams.get("inqryBgnDate")).toBe("20260601");
      expect(url.searchParams.get("inqryEndDate")).toBe("20260629");
      expect(url.searchParams.get("dlvrReqNo")).toBe("R26TB02063727");
      expect(url.searchParams.get("pageNo")).toBe("3");
      expect(url.searchParams.get("numOfRows")).toBe("25");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });
});
