import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchThirdPartyProducts,
  GET_THIRD_PARTY_PRODUCT_OPERATION,
  SHOPPING_MALL_PRODUCT_SERVICE_BASE_URL,
} from "@/lib/g2b/shopping-mall-product-client";
import { G2bStandardContractError } from "@/lib/g2b/standard-contract-client";

const SERVICE_KEY = "TEST_KEY";
const COMPANY_NAME = "주식회사 스마트빌딩";

function productProviderItem(overrides: Record<string, unknown> = {}) {
  return {
    prdctClsfcNo: "39121801",
    dtilPrdctClsfcNo: "3912180101",
    prdctNm: "빌딩자동제어장치",
    prdctIdntNoNm: "BAC-A100",
    cntrctCorpNm: COMPANY_NAME,
    hdoffceLocplc: "서울특별시 강남구 테헤란로 123",
    fctryLocplc: "경기도 화성시 공장로 10",
    ...overrides,
  };
}

function envelopeBody(items: unknown, totalCount?: number | string) {
  const body: Record<string, unknown> = { items };
  if (totalCount !== undefined) {
    body.totalCount = totalCount;
  }
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body,
    },
  };
}

function setupServiceKey() {
  const previous = process.env.DATA_GO_KR_SERVICE_KEY;
  process.env.DATA_GO_KR_SERVICE_KEY = SERVICE_KEY;
  return () => {
    if (previous === undefined) {
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previous;
    }
  };
}

function mockFetchSequence(responses: Array<() => unknown>) {
  const calls: URL[] = [];
  const fetchMock = vi.fn(async (url: URL) => {
    const index = calls.length;
    if (index >= responses.length) {
      throw new Error(
        `Unexpected extra fetch call #${index + 1} to ${url.toString()}`,
      );
    }
    const body = responses[index]();
    calls.push(url);
    return {
      ok: true,
      json: async () => body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("G2B shopping-mall third-party product service URLs", () => {
  it("exposes the official base URL and operation name", () => {
    expect(SHOPPING_MALL_PRODUCT_SERVICE_BASE_URL).toBe(
      "https://apis.data.go.kr/1230000/ao/ShoppingMallPrdctInfoService",
    );
    expect(GET_THIRD_PARTY_PRODUCT_OPERATION).toBe(
      "getThptyUcntrctPrdctInfoList",
    );
  });
});

describe("fetchThirdPartyProducts", () => {
  it("calls the third-party product endpoint with inqryDiv=1 and cntrctCorpNm", async () => {
    const restore = setupServiceKey();
    const { calls, fetchMock } = mockFetchSequence([
      () => envelopeBody([productProviderItem()], 1),
    ]);

    try {
      const products = await fetchThirdPartyProducts("주식회사 스마트빌딩");
      expect(products).toHaveLength(1);
      expect(products[0]).toMatchObject({
        prdctClsfcNo: "39121801",
        dtilPrdctClsfcNo: "3912180101",
        prdctNm: "빌딩자동제어장치",
        prdctIdntNoNm: "BAC-A100",
        cntrctCorpNm: COMPANY_NAME,
        headOfficeLocation: "서울특별시 강남구 테헤란로 123",
        factoryLocation: "경기도 화성시 공장로 10",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = calls;
      expect(url.origin + url.pathname).toBe(
        "https://apis.data.go.kr/1230000/ao/ShoppingMallPrdctInfoService/getThptyUcntrctPrdctInfoList",
      );
      expect(url.searchParams.get("type")).toBe("json");
      expect(url.searchParams.get("inqryDiv")).toBe("1");
      expect(url.searchParams.get("cntrctCorpNm")).toBe(COMPANY_NAME);
      expect(url.searchParams.get("pageNo")).toBe("1");
      expect(url.searchParams.get("numOfRows")).toBe("100");
    } finally {
      restore();
    }
  });

  it("rejects an empty company name with a clear error", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([]);

    try {
      await expect(fetchThirdPartyProducts("   ")).rejects.toThrow(
        "Company name is required for shopping-mall product lookup.",
      );
    } finally {
      restore();
    }
  });

  it.each([
    ["items array", [productProviderItem()]],
    ["items.item array", { item: [productProviderItem()] }],
    ["items.item single object", { item: productProviderItem() }],
    ["items single object", productProviderItem()],
  ])("normalizes provider envelope shape: %s", async (_name, items) => {
    const restore = setupServiceKey();
    mockFetchSequence([() => envelopeBody(items, 1)]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products).toHaveLength(1);
      expect(products[0].prdctNm).toBe("빌딩자동제어장치");
      expect(products[0].headOfficeLocation).toBe(
        "서울특별시 강남구 테헤란로 123",
      );
      expect(products[0].factoryLocation).toBe("경기도 화성시 공장로 10");
    } finally {
      restore();
    }
  });

  it("returns an empty list when the body has no items", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([() => envelopeBody([], 0)]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products).toEqual([]);
    } finally {
      restore();
    }
  });

  it("keeps headOfficeLocation and factoryLocation as independent nullable fields", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          [
            productProviderItem({
              hdoffceLocplc: "서울특별시 강남구 테헤란로 123",
              fctryLocplc: "경기도 화성시 공장로 10",
            }),
            productProviderItem({
              hdoffceLocplc: "부산광역시 사하구 다대로 1",
              fctryLocplc: "충청북도 청주시 산단로 5",
            }),
          ],
          2,
        ),
    ]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products).toHaveLength(2);
      expect(products[0].headOfficeLocation).toBe(
        "서울특별시 강남구 테헤란로 123",
      );
      expect(products[0].factoryLocation).toBe("경기도 화성시 공장로 10");
      expect(products[1].headOfficeLocation).toBe(
        "부산광역시 사하구 다대로 1",
      );
      expect(products[1].factoryLocation).toBe("충청북도 청주시 산단로 5");
    } finally {
      restore();
    }
  });

  it("produces a null factoryLocation when the response only has a head office", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          [
            productProviderItem({
              hdoffceLocplc: "서울특별시 강남구 테헤란로 123",
              fctryLocplc: "",
            }),
          ],
          1,
        ),
    ]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products).toHaveLength(1);
      expect(products[0].headOfficeLocation).toBe(
        "서울특별시 강남구 테헤란로 123",
      );
      expect(products[0].factoryLocation).toBeNull();
    } finally {
      restore();
    }
  });

  it("produces a null headOfficeLocation when the response only has a factory", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          [
            productProviderItem({
              hdoffceLocplc: "",
              fctryLocplc: "경기도 화성시 공장로 10",
            }),
          ],
          1,
        ),
    ]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products).toHaveLength(1);
      expect(products[0].headOfficeLocation).toBeNull();
      expect(products[0].factoryLocation).toBe("경기도 화성시 공장로 10");
    } finally {
      restore();
    }
  });

  it("never copies the head office into the factory location", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          [
            productProviderItem({
              hdoffceLocplc: "서울특별시 강남구 테헤란로 123",
              fctryLocplc: undefined,
            }),
          ],
          1,
        ),
    ]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products).toHaveLength(1);
      expect(products[0].headOfficeLocation).toBe(
        "서울특별시 강남구 테헤란로 123",
      );
      expect(products[0].factoryLocation).toBeNull();
    } finally {
      restore();
    }
  });

  it("preserves classification, detail, spec and company fields", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          [
            productProviderItem({
              prdctClsfcNo: "39121801",
              dtilPrdctClsfcNo: "3912180101",
              prdctNm: "빌딩자동제어장치",
              prdctIdntNoNm: "BAC-A100",
              prdctSpec: "AC 220V, RS-485",
              cntrctCorpNm: COMPANY_NAME,
            }),
          ],
          1,
        ),
    ]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products[0]).toMatchObject({
        prdctClsfcNo: "39121801",
        dtilPrdctClsfcNo: "3912180101",
        prdctNm: "빌딩자동제어장치",
        prdctIdntNoNm: "BAC-A100",
        prdctSpec: "AC 220V, RS-485",
        cntrctCorpNm: COMPANY_NAME,
      });
    } finally {
      restore();
    }
  });

  it("paginates by fetching page 1, reading totalCount, then the remaining pages", async () => {
    const restore = setupServiceKey();
    const firstPage = Array.from({ length: 100 }, (_, i) =>
      productProviderItem({ prdctNm: `제품${i + 1}` }),
    );
    const secondPage = Array.from({ length: 30 }, (_, i) =>
      productProviderItem({ prdctNm: `제품${i + 101}` }),
    );

    const { calls, fetchMock } = mockFetchSequence([
      () => envelopeBody({ item: firstPage }, "130"),
      () => envelopeBody({ item: secondPage }, "130"),
    ]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products).toHaveLength(130);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url1, url2] = [calls[0], calls[1]];
      expect(url1.searchParams.get("pageNo")).toBe("1");
      expect(url1.searchParams.get("numOfRows")).toBe("100");
      expect(url2.searchParams.get("pageNo")).toBe("2");
      expect(url2.searchParams.get("numOfRows")).toBe("100");
    } finally {
      restore();
    }
  });

  it("does not call fetch again when the first page covers totalCount exactly", async () => {
    const restore = setupServiceKey();
    const exactPage = Array.from({ length: 100 }, (_, i) =>
      productProviderItem({ prdctNm: `제품${i + 1}` }),
    );
    const { fetchMock } = mockFetchSequence([
      () => envelopeBody({ item: exactPage }, "100"),
    ]);

    try {
      const products = await fetchThirdPartyProducts(COMPANY_NAME);
      expect(products).toHaveLength(100);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("redacts the service key from provider errors", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    process.env.DATA_GO_KR_SERVICE_KEY = "SECRET_KEY";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({}),
      })),
    );

    try {
      await expect(fetchThirdPartyProducts(COMPANY_NAME)).rejects.toMatchObject(
        {
          code: "unauthorized_service_key",
        },
      );
      await expect(
        fetchThirdPartyProducts(COMPANY_NAME),
      ).rejects.toBeInstanceOf(G2bStandardContractError);
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });

  it("classifies provider error envelopes with a non-00 result code", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () => ({
        response: {
          header: { resultCode: "30", resultMsg: "PROVIDER ERROR" },
        },
      }),
    ]);

    try {
      await expect(fetchThirdPartyProducts(COMPANY_NAME)).rejects.toMatchObject(
        {
          code: "provider_error",
          message: expect.stringContaining(
            "G2B shopping-mall product provider error 30: PROVIDER ERROR",
          ),
        },
      );
    } finally {
      restore();
    }
  });
});