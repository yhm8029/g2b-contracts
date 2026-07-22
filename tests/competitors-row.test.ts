import { describe, expect, it } from "vitest";
import {
  contractKeyForG2bPublicStandardContractRow,
  mapG2bPublicStandardContractRow,
  observationHashForG2bPublicStandardContractRow,
  suppliersForG2bPublicStandardContractRow,
} from "@/lib/competitors/standard-contract-row";

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    corpList: "[A^B^C^Representative Corp^1111111111][A^B^C^Requested Corp^1234567890]",
    cntrctCorpBizno: "111-11-11111",
    cntrctCorpNm: "Representative Corp",
    cntrctCnclsDate: "20250115",
    cntrctNm: "Building automation installation",
    prodNm: "DDC controller",
    prdlstNm: "BEMS gateway",
    totCntrctAmt: "1,200,000",
    thtmCntrctAmt: "600,000",
    dminsttNm: "Demand Agency",
    cntrctInsttNm: "Contract Agency",
    cntrctMthdNm: "Limited competition",
    dcsnCntrctNo: "C-2025-001",
    bidNtceNo: "N-2025-001",
    cntrctDtlInfoUrl: "https://example.test/contracts/1",
    bidNtceDtlUrl: "https://example.test/notices/1",
    ...overrides,
  };
}

describe("G2B public standard contract row mapper", () => {
  it.each(["총액계약", "일반단가계약", "제3자단가계약"])(
    "preserves the official contract type %s verbatim",
    (contractType) => {
      expect(
        mapG2bPublicStandardContractRow(
          sourceRow({ cntrctCnclsSttusNm: contractType }),
        ).contractType,
      ).toBe(contractType);
    },
  );

  it("keeps contract type optional for legacy rows", () => {
    expect(mapG2bPublicStandardContractRow(sourceRow())).not.toHaveProperty("contractType");
  });

  it("extracts supplier projections from corpList string entries", () => {
    expect(suppliersForG2bPublicStandardContractRow(sourceRow())).toEqual([
      { businessName: "Representative Corp", businessNumber: "1111111111", raw: {} },
      { businessName: "Requested Corp", businessNumber: "1234567890", raw: {} },
    ]);
  });

  it("extracts supplier projections from corpList array entries", () => {
    expect(
      suppliersForG2bPublicStandardContractRow(
        sourceRow({
          corpList: [
            { corpNm: "Array Corp", bizno: "222-22-22222" },
            { rprsntCorpNm: "Second Array Corp", rprsntCorpBizrno: "3333333333" },
          ],
        }),
      ),
    ).toEqual([
      {
        businessName: "Array Corp",
        businessNumber: "2222222222",
        raw: { corpNm: "Array Corp", bizno: "222-22-22222" },
      },
      {
        businessName: "Second Array Corp",
        businessNumber: "3333333333",
        raw: { rprsntCorpNm: "Second Array Corp", rprsntCorpBizrno: "3333333333" },
      },
      {
        businessName: "Representative Corp",
        businessNumber: "1111111111",
        raw: {
          businessNameField: "cntrctCorpNm",
          businessNumberField: "cntrctCorpBizno",
        },
      },
    ]);
  });

  it("falls back to direct supplier fields when corpList is missing", () => {
    expect(
      suppliersForG2bPublicStandardContractRow(
        sourceRow({
          corpList: "",
          cntrctCorpBizno: "444-44-44444",
          cntrctCorpNm: "Direct Supplier Corp",
        }),
      ),
    ).toEqual([
      {
        businessName: "Direct Supplier Corp",
        businessNumber: "4444444444",
        raw: {
          businessNameField: "cntrctCorpNm",
          businessNumberField: "cntrctCorpBizno",
        },
      },
    ]);
  });

  it("normalizes analysis fields and unique item names without embedding supplier selection", () => {
    const rawRow = sourceRow({
      prdlstNm: "DDC controller",
      dminsttCd: "D-001",
      cntrctInsttCd: "C-001",
      cntrctCnclsSttusNm: "제3자단가계약",
    });
    const mapped = mapG2bPublicStandardContractRow(rawRow);

    expect(mapped).toMatchObject({
      sourceDataset: "g2b-public-standard-contract",
      rawRow,
      contractDate: "2025-01-15",
      contractName: "Building automation installation",
      itemNames: ["DDC controller"],
      currentContractAmount: 600000,
      totalContractAmount: 1200000,
      demandAgencyName: "Demand Agency",
      demandAgencyCode: "D-001",
      contractAgencyName: "Contract Agency",
      contractAgencyCode: "C-001",
      contractMethod: "Limited competition",
      contractType: "제3자단가계약",
      contractNo: "C-2025-001",
      noticeNo: "N-2025-001",
      contractDetailUrl: "https://example.test/contracts/1",
      noticeDetailUrl: "https://example.test/notices/1",
    });
    expect(mapped.suppliers.map((supplier) => supplier.businessNumber)).toEqual([
      "1111111111",
      "1234567890",
    ]);
  });

  it("preserves known detailed item codes as normalized ten-digit values", () => {
    expect(
      mapG2bPublicStandardContractRow(
        sourceRow({ dtilPrdctClsfcNo: "39121801-01", prdctClsfcNo: "39121801" }),
      ).itemCodes,
    ).toEqual(["3912180101"]);
  });

  it("preserves explicit original-contract dates and amendment orders when supplied", () => {
    expect(
      mapG2bPublicStandardContractRow(
        sourceRow({ frstCntrctDate: "20250105", cntrctOrd: "2" }),
      ),
    ).toMatchObject({
      originalContractDate: "2025-01-05",
      amendmentOrder: 2,
    });
  });

  it("uses supplier-independent contract keys for repeated supplier observations", () => {
    const representative = sourceRow({
      corpList: "[A^B^C^Representative Corp^1111111111]",
      cntrctCorpBizno: "111-11-11111",
      cntrctCorpNm: "Representative Corp",
    });
    const requested = sourceRow({
      corpList: "[A^B^C^Requested Corp^1234567890]",
      cntrctCorpBizno: "123-45-67890",
      cntrctCorpNm: "Requested Corp",
    });

    expect(contractKeyForG2bPublicStandardContractRow(representative)).toBe(
      contractKeyForG2bPublicStandardContractRow(requested),
    );
  });

  it("uses a stable fallback contract key across reordered item names", () => {
    const first = sourceRow({
      dcsnCntrctNo: "",
      bidNtceNo: "",
      cntrctDtlInfoUrl: "",
      prodNm: "BEMS gateway",
      prdlstNm: "DDC controller",
    });
    const second = sourceRow({
      dcsnCntrctNo: "",
      bidNtceNo: "",
      cntrctDtlInfoUrl: "",
      prodNm: "DDC controller",
      prdlstNm: "BEMS gateway",
    });

    expect(contractKeyForG2bPublicStandardContractRow(first)).toBe(
      contractKeyForG2bPublicStandardContractRow(second),
    );
  });

  it("keeps observation hashes separate from supplier-independent contract keys", () => {
    const first = sourceRow({
      corpList: "[A^B^C^Representative Corp^1111111111]",
      cntrctCorpBizno: "111-11-11111",
    });
    const second = sourceRow({
      corpList: "[A^B^C^Requested Corp^1234567890]",
      cntrctCorpBizno: "123-45-67890",
    });

    expect(contractKeyForG2bPublicStandardContractRow(first)).toBe(
      contractKeyForG2bPublicStandardContractRow(second),
    );
    expect(observationHashForG2bPublicStandardContractRow(first)).not.toBe(
      observationHashForG2bPublicStandardContractRow(second),
    );
  });
});
