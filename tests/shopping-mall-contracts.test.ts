import { describe, expect, it, vi } from "vitest";

import { fetchShoppingMallThirdPartyProductPage } from "@/lib/g2b/shopping-mall-client";
import {
  SHOPPING_THIRD_PARTY_SOURCE_DATASET,
  mapShoppingMallThirdPartyProductRow,
} from "@/lib/g2b/shopping-mall-mapper";

const BIZ_NO = "2048145651";

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    cntrctCorpNo: "204-81-45651",
    cntrctCorpNm: "샘플시스템(주)",
    cntrctMthdNm: "3자단가계약",
    prdctSpecNm: "빌딩자동제어장치, 샘플 모델",
    cntrctPrceAmt: "334200000",
    shopngCntrctNo: "00236180600",
    shopngCntrctSno: "1",
    cntrctDate: "20260626",
    cntrctBgnDate: "20260626",
    cntrctEndDate: "20270625",
    cntrctDeptNm: "쇼핑몰계약팀",
    prdctDtlInfo: "https://shop.g2b.go.kr/detail",
    ...overrides,
  };
}

describe("shopping mall third-party product mapper", () => {
  it("maps third-party unit-price rows into searchable contract records", () => {
    const result = mapShoppingMallThirdPartyProductRow(providerRow(), BIZ_NO);

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
      contractNo: "00236180600",
      unifiedContractNo: "00236180600-1",
      contractName: "빌딩자동제어장치, 샘플 모델",
      contractDate: "2026-06-26",
      currentContractAmount: 334200000,
      totalContractAmount: 334200000,
      contractAgencyName: "쇼핑몰계약팀",
      contractMethod: "3자단가계약",
      businessNameAtContract: "샘플시스템(주)",
      contractDetailUrl: "https://shop.g2b.go.kr/detail",
      rawSourceUrl: "https://shop.g2b.go.kr/detail",
    });
    expect(result.row.sourceRowHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not match rows for another contractor business number", () => {
    const result = mapShoppingMallThirdPartyProductRow(providerRow({ cntrctCorpNo: "1112233333" }), BIZ_NO);

    expect(result).toEqual({ success: false, reason: "biz_no does not match shopping mall row." });
  });
});

describe("shopping mall third-party product client", () => {
  it("calls the third-party unit-price endpoint with JSON output", async () => {
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
      const page = await fetchShoppingMallThirdPartyProductPage(2, 50);

      expect(page).toEqual({
        items: [providerRow()],
        totalCount: 1,
        pageNo: 2,
        numOfRows: 50,
      });

      const [url] = fetchMock.mock.calls[0];
      expect(url.origin + url.pathname).toBe(
        "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getThptyUcntrctPrdctInfoList",
      );
      expect(url.searchParams.get("type")).toBe("json");
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
});
