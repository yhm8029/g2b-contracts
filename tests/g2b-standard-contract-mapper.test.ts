import { describe, expect, it, vi } from "vitest";

import { fetchStandardContractPage, G2bStandardContractError } from "@/lib/g2b/standard-contract-client";
import {
  mapStandardContractRow,
  rowMatchesBusinessNumber,
  type StandardContractRow,
} from "@/lib/g2b/standard-contract-mapper";

const BIZ_NO = "1138190302";
const BUSINESS_NAME = "\uc6b0\ub9ac\uc820";
const REPRESENTATIVE_KEY = "\ub300\ud45c\uc790\uba85";
const REPRESENTATIVE_NAME = "\uace0\uc0c1\uc6d0";
const CONTRACT_NAME =
  "\ubd80\uc5ec\uc5ec\uc790\uace0\ub4f1\ud559\uad50\uc774\uc804\uc2e0\ucd95\uacf5\uc0ac\ube4c\ub529\uc790\ub3d9\uc81c\uc5b4\uc7a5\uce58\uad6c\uc785\uc124\uce58";

function baseRow(overrides: StandardContractRow = {}): StandardContractRow {
  return {
    bidwinnrBizrno: "113-81-90302",
    cntrctCorpNm: BUSINESS_NAME,
    cntrctCnclsDate: "2026/06/26",
    cntrctNm: CONTRACT_NAME,
    ...overrides,
  };
}

function expectMapped(overrides: StandardContractRow = {}) {
  const result = mapStandardContractRow(baseRow(overrides), BIZ_NO);
  expect(result.success).toBe(true);

  if (!result.success) {
    throw new Error(result.reason);
  }

  return result.row;
}

function mockProviderResponse(body: Record<string, unknown>, header: Record<string, unknown> = { resultCode: "00" }) {
  return mockRawProviderJson({
    response: {
      header,
      body,
    },
  });
}

function mockRawProviderJson(responseJson: unknown) {
  const previous = process.env.DATA_GO_KR_SERVICE_KEY;
  const fetchMock = vi.fn(async (_url: URL) => ({
    ok: true,
    json: async () => responseJson,
  }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.DATA_GO_KR_SERVICE_KEY = "TEST_KEY";

  return {
    fetchMock,
    restore: () => {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    },
  };
}

describe("G2B standard contract mapper", () => {
  it.each([
    ["bizno", "1138190302"],
    ["bizrno", "113 81 90302"],
    ["cntrctCorpBizno", "113.81.90302"],
    ["cntrctEntrpsBizno", "113/81/90302"],
    ["bidwinnrBizrno", "113-81-90302"],
    ["corpBizno", "113_81_90302"],
    ["corpList", "[1^주계약업체^단독^주식회사 우리젠^고상원^대한민국^100^주식회사 우리젠^^1138190302]"],
    [`\uc0ac\uc5c5\uc790\ub4f1\ub85d\ubc88\ud638(\uc218\uc815)`, "113-81 90302"],
  ])("matches business number candidate field %s", (fieldName, value) => {
    expect(rowMatchesBusinessNumber({ [fieldName]: value }, BIZ_NO)).toBe(true);
  });

  it("maps approved contract info service rows that carry businesses in corpList", () => {
    const row = mapStandardContractRow(
      {
        untyCntrctNo: "R26TE15385756",
        bsnsDivNm: "물품",
        dcsnCntrctNo: "",
        cntrctRefNo: "R26TA0191846500",
        cntrctNm: "488nm 레이저 시스템 구매",
        cntrctCnclsDate: "",
        cntrctDate: "2026-06-01",
        totCntrctAmt: "0",
        thtmCntrctAmt: "14,840,100",
        ntceNo: "R26BK01601178",
        cntrctInsttCd: "Z031485",
        cntrctInsttNm: "연세대학교 미래산학협력단",
        dminsttList: "[1^Z031485^연세대학교 미래산학협력단^기타기관^^김훈직^0337605237]",
        corpList: "[1^주계약업체^단독^주식회사 우리젠^고상원^대한민국^100^주식회사 우리젠^^1138190302]",
        cntrctDtlInfoUrl: "https://www.g2b.go.kr/link/FIUA027_01/single/?ctrtNo=R26TA01918465",
        cntrctCnclsMthdNm: "수의계약",
      },
      BIZ_NO,
    );

    expect(row.success).toBe(true);
    if (!row.success) {
      throw new Error(row.reason);
    }
    expect(row.row).toMatchObject({
      sourceDataset: "g2b-contract-info-service",
      bizNoNormalized: BIZ_NO,
      businessName: "주식회사 우리젠",
      representativeName: "고상원",
      businessCategory: "goods",
      noticeNo: "R26BK01601178",
      contractNo: "R26TA0191846500",
      unifiedContractNo: "R26TE15385756",
      contractName: "488nm 레이저 시스템 구매",
      contractDate: "2026-06-01",
      currentContractAmount: 14840100,
      totalContractAmount: 0,
      demandAgencyCode: "Z031485",
      demandAgencyName: "연세대학교 미래산학협력단",
      contractAgencyCode: "Z031485",
      contractAgencyName: "연세대학교 미래산학협력단",
      contractMethod: "수의계약",
      businessNameAtContract: "주식회사 우리젠",
      rawSourceUrl: "https://www.g2b.go.kr/link/FIUA027_01/single/?ctrtNo=R26TA01918465",
    });
  });

  it("maps standard contract rows into parsed contract rows", () => {
    const row = expectMapped({
      [REPRESENTATIVE_KEY]: REPRESENTATIVE_NAME,
      bidNtceNo: "R26BK01601178",
      bidNtceOrd: "000",
      bidNtceNm: CONTRACT_NAME,
      cntrctAmt: "180,529,000\uc6d0",
      cntrctMthdNm: "\uc81c\ud55c\uacbd\uc7c1",
      bidwinrDcsnMthdNm: "\uacc4\uc57d\uc774\ud589\ub2a5\ub825\uc2ec\uc0ac",
      dminsttNm: "\ucda9\uccad\ub0a8\ub3c4\uad50\uc721\uccad",
      cntrctInsttNm: "\uc870\ub2ec\uccad",
      cntrctDtlInfoUrl: "https://www.g2b.go.kr/contract/detail",
    });

    expect(row).toMatchObject({
      sourceDataset: "g2b-contract-info-service",
      bizNoNormalized: BIZ_NO,
      bizNoDisplay: "113-81-90302",
      businessName: BUSINESS_NAME,
      representativeName: REPRESENTATIVE_NAME,
      noticeNo: "R26BK01601178",
      noticeOrder: "000",
      noticeName: CONTRACT_NAME,
      contractName: CONTRACT_NAME,
      contractDate: "2026-06-26",
      currentContractAmount: 180529000,
      totalContractAmount: 180529000,
      demandAgencyName: "\ucda9\uccad\ub0a8\ub3c4\uad50\uc721\uccad",
      contractAgencyName: "\uc870\ub2ec\uccad",
      contractMethod: "\uc81c\ud55c\uacbd\uc7c1",
      winningMethod: "\uacc4\uc57d\uc774\ud589\ub2a5\ub825\uc2ec\uc0ac",
      businessNameAtContract: BUSINESS_NAME,
      contractDetailUrl: "https://www.g2b.go.kr/contract/detail",
      rawSourceUrl: "https://www.g2b.go.kr/contract/detail",
    });
    expect(row.sourceRowHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not match rows for a different business", () => {
    expect(rowMatchesBusinessNumber({ cntrctEntrpsBizno: "220-81-62517" }, BIZ_NO)).toBe(false);
  });

  it("fails with a reason when required mapped fields are missing", () => {
    const result = mapStandardContractRow({ bidwinnrBizrno: "113-81-90302", cntrctCorpNm: BUSINESS_NAME }, BIZ_NO);

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.reason).toContain("contract_date");
    expect(result.reason).toContain("contract_name");
  });

  it.each([
    ["YYYYMMDD", "20260626"],
    ["YYYY-MM-DD", "2026-06-26"],
    ["YYYY/MM/DD", "2026/06/26"],
  ])("normalizes contract date variant %s", (_variant, dateValue) => {
    expect(expectMapped({ cntrctCnclsDate: dateValue }).contractDate).toBe("2026-06-26");
  });

  it("fails when required contract date cannot be normalized", () => {
    const result = mapStandardContractRow(baseRow({ cntrctCnclsDate: "2026.06.26" }), BIZ_NO);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("contract_date");
    }
  });

  it.each([
    ["comma amount", "180,529,000", 180529000],
    ["currency amount", "180,529,000\uc6d0", 180529000],
    ["blank amount", "", null],
    ["null amount", null, null],
    ["non-numeric amount", "not available", null],
    ["letter-substituted amount", "18O,529,000\uc6d0", null],
    ["text with trailing zero", "not available 0", null],
    ["Korean approximate eok amount", "\uc57d 1\uc5b5\uc6d0", null],
  ])("maps %s to a nullable amount", (_variant, value, expected) => {
    const row = expectMapped({ cntrctAmt: value });

    expect(row.currentContractAmount).toBe(expected);
    expect(row.totalContractAmount).toBe(expected);
  });

  it("maps alternate provider field variants across optional contract fields", () => {
    const row = expectMapped({
      cntrctCorpNm: undefined,
      bidwinnrNm: "alternate business",
      cntrctCnclsDate: undefined,
      cntrctDt: "20260626",
      cntrctNm: undefined,
      prdlstNm: "alternate contract",
      dcsnCntrctNo: "CN-ALT-1",
      untyCntrctNo: "UN-ALT-1",
      bidNtceNo: "NTCE-ALT-1",
      bidNtceOrd: "001",
      bidNtceNm: "alternate notice",
      totCntrctAmt: "200,000\uc6d0",
      dminsttNm: "demand agency",
      cntrctInsttNm: "contract agency",
      cntrctCnclsMthdNm: "alternate method",
      bidwinrDcsnMthdNm: "alternate winning method",
      cntrctDtlInfoUrl: "https://www.g2b.go.kr/contract/alternate",
      bidNtceDtlUrl: "https://www.g2b.go.kr/notice/alternate",
      [REPRESENTATIVE_KEY]: REPRESENTATIVE_NAME,
    });

    expect(row).toMatchObject({
      businessName: "alternate business",
      representativeName: REPRESENTATIVE_NAME,
      contractDate: "2026-06-26",
      contractName: "alternate contract",
      contractNo: "CN-ALT-1",
      unifiedContractNo: "UN-ALT-1",
      noticeNo: "NTCE-ALT-1",
      noticeOrder: "001",
      noticeName: "alternate notice",
      totalContractAmount: 200000,
      demandAgencyName: "demand agency",
      contractAgencyName: "contract agency",
      contractMethod: "alternate method",
      winningMethod: "alternate winning method",
      contractDetailUrl: "https://www.g2b.go.kr/contract/alternate",
      noticeDetailUrl: "https://www.g2b.go.kr/notice/alternate",
      rawSourceUrl: "https://www.g2b.go.kr/contract/alternate",
    });
  });

  it("maps Korean fallback field variants where provider labels are localized", () => {
    const row = expectMapped({
      cntrctCorpNm: undefined,
      "\uc5c5\uccb4\uba85": "localized business",
      cntrctCnclsDate: undefined,
      "\uacc4\uc57d\uccb4\uacb0\uc77c\uc790": "2026/06/26",
      cntrctNm: undefined,
      "\uacc4\uc57d\uba85": "localized contract",
      cntrctAmt: undefined,
      "\ucd1d\uacc4\uc57d\uae08\uc561": "300,000\uc6d0",
      "\uc8fc\uc18c": "localized address",
      "\uc5c5\uc885": "localized category",
    });

    expect(row).toMatchObject({
      businessName: "localized business",
      contractDate: "2026-06-26",
      contractName: "localized contract",
      totalContractAmount: 300000,
      address: "localized address",
      businessCategory: null,
    });
  });
});

describe("G2B standard contract client", () => {
  it("sends contract close dates as YYYYMMDD and normalizes nested items with total count", async () => {
    const { fetchMock, restore } = mockProviderResponse({
      totalCount: "2",
      pageNo: "1",
      numOfRows: "100",
      items: {
        item: [{ cntrctNo: "CN-1" }, { cntrctNo: "CN-2" }],
      },
    });

    try {
      const page = await fetchStandardContractPage({ dateFrom: "2026-06-01", dateTo: "2026-06-30" }, 1);

      expect(page).toEqual({
        items: [{ cntrctNo: "CN-1" }, { cntrctNo: "CN-2" }],
        totalCount: 2,
        pageNo: 1,
        numOfRows: 100,
      });

      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.origin + url.pathname).toBe(
        "https://apis.data.go.kr/1230000/ao/CntrctInfoService/getCntrctInfoListThng",
      );
      expect(url.searchParams.get("inqryDiv")).toBe("1");
      expect(url.searchParams.get("inqryBgnDt")).toBe("202606010000");
      expect(url.searchParams.get("inqryEndDt")).toBe("202606302359");
      expect(url.searchParams.get("pageNo")).toBe("1");
      expect(url.searchParams.get("numOfRows")).toBe("100");
    } finally {
      restore();
    }
  });

  it.each([
    ["items array", { items: [{ cntrctNo: "CN-1" }, { cntrctNo: "CN-2" }] }, [{ cntrctNo: "CN-1" }, { cntrctNo: "CN-2" }]],
    ["items object", { items: { cntrctNo: "CN-1" } }, [{ cntrctNo: "CN-1" }]],
    ["nested items.item", { items: { item: { cntrctNo: "CN-1" } } }, [{ cntrctNo: "CN-1" }]],
    ["body-level item", { item: { cntrctNo: "CN-1" } }, [{ cntrctNo: "CN-1" }]],
  ])("normalizes provider response shape: %s", async (_shape, body, expectedItems) => {
    const { restore } = mockProviderResponse({ totalCount: "1", ...body });

    try {
      const page = await fetchStandardContractPage({ dateFrom: "2026-06-01", dateTo: "2026-06-01" }, 1, 10);

      expect(page.items).toEqual(expectedItems);
      expect(page.totalCount).toBe(1);
      expect(page.pageNo).toBe(1);
      expect(page.numOfRows).toBe(10);
    } finally {
      restore();
    }
  });

  it("classifies 403 responses as unauthorized service keys", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({}),
      })),
    );
    process.env.DATA_GO_KR_SERVICE_KEY = "TEST_KEY";

    try {
      await expect(fetchStandardContractPage({ dateFrom: "2026-06-01", dateTo: "2026-06-01" }, 1)).rejects.toMatchObject(
        {
          code: "unauthorized_service_key",
        },
      );
      await expect(fetchStandardContractPage({ dateFrom: "2026-06-01", dateTo: "2026-06-01" }, 1)).rejects.toBeInstanceOf(
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

  it("classifies provider date range errors", async () => {
    const { restore } = mockProviderResponse({}, { resultCode: "99", resultMsg: "DATE RANGE TOO LARGE" });

    try {
      await expect(fetchStandardContractPage({ dateFrom: "2026-01-01", dateTo: "2026-12-31" }, 1)).rejects.toMatchObject(
        {
          code: "date_range_too_large",
        },
      );
    } finally {
      restore();
    }
  });

  it.each([
    ["missing response envelope", {}],
    ["missing response header", { response: { body: { totalCount: "0", items: [] } } }],
    ["missing response body", { response: { header: { resultCode: "00" } } }],
  ])("classifies malformed provider envelope: %s", async (_caseName, responseJson) => {
    const { restore } = mockRawProviderJson(responseJson);

    try {
      await expect(fetchStandardContractPage({ dateFrom: "2026-06-01", dateTo: "2026-06-01" }, 1)).rejects.toMatchObject(
        {
          code: "provider_error",
        },
      );
    } finally {
      restore();
    }
  });

  it("classifies invalid provider totalCount as provider_error", async () => {
    const { restore } = mockProviderResponse({ totalCount: "not-a-number", items: [] });

    try {
      await expect(fetchStandardContractPage({ dateFrom: "2026-06-01", dateTo: "2026-06-01" }, 1)).rejects.toMatchObject(
        {
          code: "provider_error",
        },
      );
    } finally {
      restore();
    }
  });

  it("classifies Korean provider date range errors", async () => {
    const { restore } = mockProviderResponse({}, { resultCode: "99", resultMsg: "\uc870\ud68c\uae30\uac04 \ucd08\uacfc" });

    try {
      await expect(fetchStandardContractPage({ dateFrom: "2026-01-01", dateTo: "2026-12-31" }, 1)).rejects.toMatchObject(
        {
          code: "date_range_too_large",
        },
      );
    } finally {
      restore();
    }
  });

  it("classifies generic provider errors", async () => {
    const { restore } = mockProviderResponse({}, { resultCode: "30", resultMsg: "SERVICE TEMPORARILY UNAVAILABLE" });

    try {
      await expect(fetchStandardContractPage({ dateFrom: "2026-06-01", dateTo: "2026-06-01" }, 1)).rejects.toMatchObject(
        {
          code: "provider_error",
          message: "G2B standard contract provider error 30: SERVICE TEMPORARILY UNAVAILABLE",
        },
      );
    } finally {
      restore();
    }
  });
});
