import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCompanyBasicInfo,
  fetchCompanyIndustries,
  GET_BASIC_INFO_OPERATION,
  GET_INDUSTRY_INFO_OPERATION,
  USER_INFO_SERVICE_BASE_URL,
} from "@/lib/g2b/user-info-client";
import { G2bStandardContractError } from "@/lib/g2b/standard-contract-client";

const BIZ_NO = "1234567890";
const SERVICE_KEY = "TEST_KEY";

function basicProviderItem(overrides: Record<string, unknown> = {}) {
  return {
    corpNm: "주식회사 스마트빌딩",
    ceoNm: "김대표",
    telNo: "02-1234-5678",
    adrs: "서울특별시 강남구 테헤란로 123",
    dtlAdrs: "빌딩 5층",
    ...overrides,
  };
}

function industryProviderItem(overrides: Record<string, unknown> = {}) {
  return {
    indstrytyCd: "C2811",
    indstrytyNm: "전동기 제조업",
    status: "정상",
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

describe("G2B user-info service URLs", () => {
  it("exposes the official base URL and operation names", () => {
    expect(USER_INFO_SERVICE_BASE_URL).toBe(
      "https://apis.data.go.kr/1230000/ao/UsrInfoService02",
    );
    expect(GET_BASIC_INFO_OPERATION).toBe("getPrcrmntCorpBasicInfo02");
    expect(GET_INDUSTRY_INFO_OPERATION).toBe("getPrcrmntCorpIndstrytyInfo02");
  });
});

describe("fetchCompanyBasicInfo", () => {
  it("calls the basic-info endpoint with inqryDiv=1 and the normalized 10-digit business number", async () => {
    const restore = setupServiceKey();
    const { calls, fetchMock } = mockFetchSequence([() => envelopeBody(basicProviderItem(), 1)]);

    try {
      const info = await fetchCompanyBasicInfo("123-45-67890");
      expect(info).toEqual({
        corpNm: "주식회사 스마트빌딩",
        ceoNm: "김대표",
        telNo: "02-1234-5678",
        address: "서울특별시 강남구 테헤란로 123 빌딩 5층",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = calls;
      expect(url.origin + url.pathname).toBe(
        "https://apis.data.go.kr/1230000/ao/UsrInfoService02/getPrcrmntCorpBasicInfo02",
      );
      expect(url.searchParams.get("type")).toBe("json");
      expect(url.searchParams.get("inqryDiv")).toBe("1");
      expect(url.searchParams.get("bizno")).toBe("1234567890");
      expect(url.searchParams.get("pageNo")).toBe("1");
      expect(url.searchParams.get("numOfRows")).toBe("100");
    } finally {
      restore();
    }
  });

  it("rejects a non-10-digit business number with a clear error", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([]);

    try {
      await expect(fetchCompanyBasicInfo("12345")).rejects.toThrow(
        "Business registration number must contain 10 digits.",
      );
    } finally {
      restore();
    }
  });

  it.each([
    ["items array", [basicProviderItem()]],
    ["items.item array", { item: [basicProviderItem()] }],
    ["items.item single object", { item: basicProviderItem() }],
    ["items single object", basicProviderItem()],
  ])("normalizes provider basic-info envelope shape: %s", async (_name, items) => {
    const restore = setupServiceKey();
    mockFetchSequence([() => envelopeBody(items, 1)]);

    try {
      const info = await fetchCompanyBasicInfo(BIZ_NO);
      expect(info).toEqual({
        corpNm: "주식회사 스마트빌딩",
        ceoNm: "김대표",
        telNo: "02-1234-5678",
        address: "서울특별시 강남구 테헤란로 123 빌딩 5층",
      });
    } finally {
      restore();
    }
  });

  it("returns null when the provider body has no items", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([() => envelopeBody([], 0)]);

    try {
      const info = await fetchCompanyBasicInfo(BIZ_NO);
      expect(info).toBeNull();
    } finally {
      restore();
    }
  });

  it("combines adrs and dtlAdrs without duplication when the detail is empty", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () => envelopeBody(basicProviderItem({ dtlAdrs: "" }), 1),
    ]);

    try {
      const info = await fetchCompanyBasicInfo(BIZ_NO);
      expect(info?.address).toBe("서울특별시 강남구 테헤란로 123");
    } finally {
      restore();
    }
  });

  it("combines adrs and dtlAdrs without duplication when the detail repeats the base address", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          basicProviderItem({ dtlAdrs: "서울특별시 강남구 테헤란로 123" }),
          1,
        ),
    ]);

    try {
      const info = await fetchCompanyBasicInfo(BIZ_NO);
      expect(info?.address).toBe("서울특별시 강남구 테헤란로 123");
    } finally {
      restore();
    }
  });

  it("paginates by fetching page 1, reading totalCount, then the remaining pages", async () => {
    const restore = setupServiceKey();
    const firstPage = Array.from({ length: 100 }, (_, i) =>
      basicProviderItem({ corpNm: `회사${i + 1}` }),
    );
    const secondPage = Array.from({ length: 50 }, (_, i) =>
      basicProviderItem({ corpNm: `회사${i + 101}` }),
    );

    const { calls, fetchMock } = mockFetchSequence([
      () => envelopeBody({ item: firstPage }, "150"),
      () => envelopeBody({ item: secondPage }, "150"),
    ]);

    try {
      const info = await fetchCompanyBasicInfo(BIZ_NO);
      expect(info?.corpNm).toBe("회사1");
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
      await expect(fetchCompanyBasicInfo(BIZ_NO)).rejects.toMatchObject({
        code: "unauthorized_service_key",
      });
      await expect(fetchCompanyBasicInfo(BIZ_NO)).rejects.toBeInstanceOf(
        G2bStandardContractError,
      );
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
      await expect(fetchCompanyBasicInfo(BIZ_NO)).rejects.toMatchObject({
        code: "provider_error",
        message: expect.stringContaining(
          "G2B user-info provider error 30: PROVIDER ERROR",
        ),
      });
    } finally {
      restore();
    }
  });

  it("combines adrs and dtlAdrs without duplication when the detail starts with the base address", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          basicProviderItem({
            adrs: "서울특별시 강남구",
            dtlAdrs: "서울특별시 강남구 테헤란로 123",
          }),
          1,
        ),
    ]);

    try {
      const info = await fetchCompanyBasicInfo(BIZ_NO);
      expect(info?.address).toBe("서울특별시 강남구 테헤란로 123");
    } finally {
      restore();
    }
  });

  it("redacts the configured service key from the non-00 resultMsg", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    process.env.DATA_GO_KR_SERVICE_KEY = "FAKE_KEY_BASIC_77777";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        response: {
          header: {
            resultCode: "30",
            resultMsg: "PROVIDER ERROR: FAKE_KEY_BASIC_77777 leaked",
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const caught = await fetchCompanyBasicInfo(BIZ_NO).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(G2bStandardContractError);
      const error = caught as G2bStandardContractError;
      expect(error.message).toContain("[REDACTED]");
      expect(error.message).not.toContain("FAKE_KEY_BASIC_77777");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });

  it("redacts the configured service key from the nkoneps ResponseError envelope and classifies auth messages", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    process.env.DATA_GO_KR_SERVICE_KEY = "FAKE_KEY_BASIC_NK_88888";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        "nkoneps.com.response.ResponseError": {
          header: {
            resultCode: "30",
            resultMsg: "SERVICE KEY UNAUTHORIZED: FAKE_KEY_BASIC_NK_88888",
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const caught = await fetchCompanyBasicInfo(BIZ_NO).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(G2bStandardContractError);
      const error = caught as G2bStandardContractError;
      expect(error.code).toBe("unauthorized_service_key");
      expect(error.message).toContain("[REDACTED]");
      expect(error.message).not.toContain("FAKE_KEY_BASIC_NK_88888");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });

  it("classifies nkoneps ResponseError messages with auth keywords as unauthorized_service_key", async () => {
    const restore = setupServiceKey();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        "nkoneps.com.response.ResponseError": {
          header: {
            resultCode: "30",
            resultMsg: "SERVICE KEY UNAUTHORIZED",
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(fetchCompanyBasicInfo(BIZ_NO)).rejects.toMatchObject({
        code: "unauthorized_service_key",
      });
    } finally {
      vi.unstubAllGlobals();
      restore();
    }
  });

  it("throws provider_error when totalCount indicates more rows but a fetched page is empty", async () => {
    const restore = setupServiceKey();
    const firstPage = [basicProviderItem({ corpNm: "회사1" })];
    mockFetchSequence([
      () => envelopeBody({ item: firstPage }, "5"),
      () => envelopeBody({ item: [] }, "5"),
    ]);

    try {
      await expect(fetchCompanyBasicInfo(BIZ_NO)).rejects.toMatchObject({
        code: "provider_error",
        message: expect.stringContaining("more rows were still expected"),
      });
    } finally {
      restore();
    }
  });});

describe("fetchCompanyIndustries", () => {
  it("maps every industry entry with code, name, and status", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          {
            item: [
              industryProviderItem(),
              {
                indstrytyCd: "F4211",
                indstrytyNm: "전기 공사업",
                status: "정상",
              },
            ],
          },
          2,
        ),
    ]);

    try {
      const industries = await fetchCompanyIndustries(BIZ_NO);
      expect(industries).toEqual([
        { indstrytyCd: "C2811", indstrytyNm: "전동기 제조업", status: "정상" },
        { indstrytyCd: "F4211", indstrytyNm: "전기 공사업", status: "정상" },
      ]);
    } finally {
      restore();
    }
  });

  it("uses the industry endpoint URL with inqryDiv=1 and the normalized 10-digit business number", async () => {
    const restore = setupServiceKey();
    const { calls } = mockFetchSequence([
      () => envelopeBody({ item: [industryProviderItem()] }, 1),
    ]);

    try {
      await fetchCompanyIndustries(BIZ_NO);
      const [url] = calls;
      expect(url.origin + url.pathname).toBe(
        "https://apis.data.go.kr/1230000/ao/UsrInfoService02/getPrcrmntCorpIndstrytyInfo02",
      );
      expect(url.searchParams.get("type")).toBe("json");
      expect(url.searchParams.get("inqryDiv")).toBe("1");
      expect(url.searchParams.get("bizno")).toBe("1234567890");
      expect(url.searchParams.get("pageNo")).toBe("1");
      expect(url.searchParams.get("numOfRows")).toBe("100");
    } finally {
      restore();
    }
  });

  it("returns an empty list when the body has no items", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([() => envelopeBody([], 0)]);

    try {
      const industries = await fetchCompanyIndustries(BIZ_NO);
      expect(industries).toEqual([]);
    } finally {
      restore();
    }
  });

  it("maps an industry even when status is missing", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          [
            {
              indstrytyCd: "C2811",
              indstrytyNm: "전동기 제조업",
            },
          ],
          1,
        ),
    ]);

    try {
      const industries = await fetchCompanyIndustries(BIZ_NO);
      expect(industries).toEqual([
        { indstrytyCd: "C2811", indstrytyNm: "전동기 제조업", status: null },
      ]);
    } finally {
      restore();
    }
  });

  it("paginates until the last page using a 100 row page size", async () => {
    const restore = setupServiceKey();
    const firstPage = Array.from({ length: 100 }, (_, i) =>
      industryProviderItem({ indstrytyCd: `C${i + 1}` }),
    );
    const secondPage = Array.from({ length: 30 }, (_, i) =>
      industryProviderItem({ indstrytyCd: `D${i + 1}` }),
    );

    const { calls, fetchMock } = mockFetchSequence([
      () => envelopeBody({ item: firstPage }, "130"),
      () => envelopeBody({ item: secondPage }, "130"),
    ]);

    try {
      const industries = await fetchCompanyIndustries(BIZ_NO);
      expect(industries).toHaveLength(130);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url1, url2] = [calls[0], calls[1]];
      expect(url1.searchParams.get("pageNo")).toBe("1");
      expect(url2.searchParams.get("pageNo")).toBe("2");
      expect(url1.searchParams.get("numOfRows")).toBe("100");
      expect(url2.searchParams.get("numOfRows")).toBe("100");
    } finally {
      restore();
    }
  });

  it("does not call fetch again when the first page covers totalCount exactly", async () => {
    const restore = setupServiceKey();
    const exactPage = Array.from({ length: 100 }, (_, i) =>
      industryProviderItem({ indstrytyCd: `C${i + 1}` }),
    );
    const { fetchMock } = mockFetchSequence([
      () => envelopeBody({ item: exactPage }, "100"),
    ]);

    try {
      const industries = await fetchCompanyIndustries(BIZ_NO);
      expect(industries).toHaveLength(100);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it.each([
    ["items array", [industryProviderItem()]],
    ["items.item array", { item: [industryProviderItem()] }],
    ["items.item single object", { item: industryProviderItem() }],
    ["items single object", industryProviderItem()],
  ])("normalizes provider industry envelope shape: %s", async (_name, items) => {
    const restore = setupServiceKey();
    mockFetchSequence([() => envelopeBody(items, 1)]);

    try {
      const industries = await fetchCompanyIndustries(BIZ_NO);
      expect(industries).toEqual([
        { indstrytyCd: "C2811", indstrytyNm: "전동기 제조업", status: "정상" },
      ]);
    } finally {
      restore();
    }
  });

  it("accepts the legacy status field as an alias when indstrytyStatsNm is missing", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          [
            {
              indstrytyCd: "C2811",
              indstrytyNm: "전동기 제조업",
              status: "정상",
            },
          ],
          1,
        ),
    ]);

    try {
      const industries = await fetchCompanyIndustries(BIZ_NO);
      expect(industries).toEqual([
        { indstrytyCd: "C2811", indstrytyNm: "전동기 제조업", status: "정상" },
      ]);
    } finally {
      restore();
    }
  });

  it("redacts the configured service key from the non-00 resultMsg", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    process.env.DATA_GO_KR_SERVICE_KEY = "FAKE_KEY_IND_66666";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        response: {
          header: {
            resultCode: "30",
            resultMsg: "PROVIDER ERROR: FAKE_KEY_IND_66666 leaked",
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const caught = await fetchCompanyIndustries(BIZ_NO).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(G2bStandardContractError);
      const error = caught as G2bStandardContractError;
      expect(error.message).toContain("[REDACTED]");
      expect(error.message).not.toContain("FAKE_KEY_IND_66666");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });

  it("redacts the configured service key from the nkoneps ResponseError envelope and classifies auth messages", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    process.env.DATA_GO_KR_SERVICE_KEY = "FAKE_KEY_IND_NK_55555";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        "nkoneps.com.response.ResponseError": {
          header: {
            resultCode: "30",
            resultMsg: "SERVICE KEY UNAUTHORIZED: FAKE_KEY_IND_NK_55555",
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const caught = await fetchCompanyIndustries(BIZ_NO).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(G2bStandardContractError);
      const error = caught as G2bStandardContractError;
      expect(error.code).toBe("unauthorized_service_key");
      expect(error.message).toContain("[REDACTED]");
      expect(error.message).not.toContain("FAKE_KEY_IND_NK_55555");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });

  it("classifies nkoneps ResponseError messages with auth keywords as unauthorized_service_key", async () => {
    const restore = setupServiceKey();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        "nkoneps.com.response.ResponseError": {
          header: {
            resultCode: "30",
            resultMsg: "SERVICE KEY UNAUTHORIZED",
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(fetchCompanyIndustries(BIZ_NO)).rejects.toMatchObject({
        code: "unauthorized_service_key",
      });
    } finally {
      vi.unstubAllGlobals();
      restore();
    }
  });

  it("throws provider_error when totalCount indicates more rows but a fetched page is empty", async () => {
    const restore = setupServiceKey();
    const firstPage = [industryProviderItem({ indstrytyCd: "C1" })];
    mockFetchSequence([
      () => envelopeBody({ item: firstPage }, "5"),
      () => envelopeBody({ item: [] }, "5"),
    ]);

    try {
      await expect(fetchCompanyIndustries(BIZ_NO)).rejects.toMatchObject({
        code: "provider_error",
        message: expect.stringContaining("more rows were still expected"),
      });
    } finally {
      restore();
    }
  });
  it("prefers indstrytyStatsNm over the legacy status alias when both are present", async () => {
    const restore = setupServiceKey();
    mockFetchSequence([
      () =>
        envelopeBody(
          [
            {
              indstrytyCd: "C2811",
              indstrytyNm: "전동기 제조업",
              indstrytyStatsNm: "OFFICIAL STATUS",
              status: "LEGACY STATUS",
            },
          ],
          1,
        ),
    ]);

    try {
      const industries = await fetchCompanyIndustries(BIZ_NO);
      expect(industries).toEqual([
        {
          indstrytyCd: "C2811",
          indstrytyNm: "전동기 제조업",
          status: "OFFICIAL STATUS",
        },
      ]);
    } finally {
      restore();
    }
  });});
