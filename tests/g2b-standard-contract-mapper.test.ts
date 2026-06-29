import { describe, expect, it, vi } from "vitest";

import { fetchStandardContractPage, G2bStandardContractError } from "@/lib/g2b/standard-contract-client";
import { mapStandardContractRow, rowMatchesBusinessNumber } from "@/lib/g2b/standard-contract-mapper";

describe("G2B standard contract mapper", () => {
  it("matches bid winner business number values against normalized input", () => {
    expect(rowMatchesBusinessNumber({ bidwinnrBizrno: "113-81-90302" }, "1138190302")).toBe(true);
  });

  it("maps standard contract rows into parsed contract rows", () => {
    const result = mapStandardContractRow(
      {
        bidwinnrBizrno: "113-81-90302",
        cntrctCorpNm: "우리젠",
        "대표자명": "고상원",
        bidNtceNo: "R26BK01601178",
        bidNtceOrd: "000",
        bidNtceNm: "부여여자고등학교이전신축공사빌딩자동제어장치구입설치",
        cntrctNm: "부여여자고등학교이전신축공사빌딩자동제어장치구입설치",
        cntrctCnclsDate: "2026/06/26",
        cntrctAmt: "180,529,000원",
        cntrctMthdNm: "제한경쟁",
        bidwinrDcsnMthdNm: "계약이행능력심사",
        dminsttNm: "충청남도교육청",
        cntrctInsttNm: "조달청",
        cntrctDtlInfoUrl: "https://www.g2b.go.kr/contract/detail",
      },
      "1138190302",
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.row).toMatchObject({
      sourceDataset: "g2b-public-standard-contract",
      bizNoNormalized: "1138190302",
      bizNoDisplay: "113-81-90302",
      businessName: "우리젠",
      representativeName: "고상원",
      noticeNo: "R26BK01601178",
      noticeOrder: "000",
      noticeName: "부여여자고등학교이전신축공사빌딩자동제어장치구입설치",
      contractName: "부여여자고등학교이전신축공사빌딩자동제어장치구입설치",
      contractDate: "2026-06-26",
      currentContractAmount: 180529000,
      totalContractAmount: 180529000,
      demandAgencyName: "충청남도교육청",
      contractAgencyName: "조달청",
      contractMethod: "제한경쟁",
      winningMethod: "계약이행능력심사",
      businessNameAtContract: "우리젠",
      contractDetailUrl: "https://www.g2b.go.kr/contract/detail",
      rawSourceUrl: "https://www.g2b.go.kr/contract/detail",
    });
    expect(result.row.sourceRowHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not match rows for a different business", () => {
    expect(rowMatchesBusinessNumber({ cntrctEntrpsBizno: "220-81-62517" }, "1138190302")).toBe(false);
  });

  it("fails with a reason when required mapped fields are missing", () => {
    const result = mapStandardContractRow({ bidwinnrBizrno: "113-81-90302", cntrctCorpNm: "우리젠" }, "1138190302");

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.reason).toContain("contract_date");
    expect(result.reason).toContain("contract_name");
  });
});

describe("G2B standard contract client", () => {
  it("sends contract close dates as YYYYMMDD and normalizes nested items with total count", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    const fetchMock = vi.fn(async (_url: URL) => ({
      ok: true,
      json: async () => ({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: {
            totalCount: "2",
            pageNo: "1",
            numOfRows: "100",
            items: {
              item: [{ cntrctNo: "CN-1" }, { cntrctNo: "CN-2" }],
            },
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.DATA_GO_KR_SERVICE_KEY = "TEST_KEY";

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
        "https://apis.data.go.kr/1230000/ao/PubDataOpnStdService/getDataSetOpnStdCntrctInfo",
      );
      expect(url.searchParams.get("cntrctCnclsBgnDate")).toBe("20260601");
      expect(url.searchParams.get("cntrctCnclsEndDate")).toBe("20260630");
      expect(url.searchParams.get("pageNo")).toBe("1");
      expect(url.searchParams.get("numOfRows")).toBe("100");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
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
});
