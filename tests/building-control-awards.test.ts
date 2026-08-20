import { describe, expect, it } from "vitest";
import {
  collectAwardRegistration,
  collapseNoticeWinner,
  isFinalAwardOnOrAfter,
  joinAwardObservationToTargetProduct,
  joinAwardToTargetProduct,
  parseAwardPage,
  parseFinalAwardRows,
  type G2bFetchJson,
} from "@/lib/building-control/g2b/award-client";
import type { NoticeProductRow } from "@/lib/building-control/g2b/notice-client";

const op = "getScsbidListSttusThng";

function makeRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    bidNtceNo: "NTCE-001",
    bidNtceOrd: "0001",
    bidClsfcNo: "1",
    rbidNo: "001",
    rgstDt: "2025-01-15 09:30:00",
    fnlSucsfDate: "2025-02-01",
    bidwinnrBizno: "214-82-04708",
    bidwinnrNm: "Acme Corp",
    sucsfbidAmt: "1234567890",
    sucsfbidRate: "95.5",
    ...overrides,
  };
}

function makeEnvelope(
  items: Record<string, string>[],
  pageNo = 1,
  numOfRows = items.length,
  totalCount = items.length,
) {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "OK" },
      body: { pageNo, numOfRows, totalCount, items },
    },
  };
}

describe("building-control awards", () => {
  it("maps official raw fields to normalized AwardResultRow", () => {
    const rows = parseFinalAwardRows([makeRow()]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.noticeNo).toBe("NTCE-001");
    expect(r.noticeOrder).toBe("0001");
    expect(r.bidClassNo).toBe("1");
    expect(r.rebidNo).toBe("001");
    expect(r.registeredAt).toBe("2025-01-15 09:30:00");
    expect(r.finalAwardDate).toBe("2025-02-01");
    expect(r.status).toBe("final");
    expect(r.winnerBizNo).toBe("2148204708");
    expect(r.winnerName).toBe("Acme Corp");
    expect(r.amount).toBe(1234567890);
    expect(r.rate).toBe(95.5);
    expect(typeof r.providerResultIdentity).toBe("string");
    expect((r.providerResultIdentity as string).length).toBeGreaterThan(0);
    expect(typeof r.rawJson).toBe("string");
    expect(/^[0-9a-f]{64}$/.test(r.sourceHash)).toBe(true);
    expect(Object.keys(r).sort()).toEqual(
      [
        "amount",
        "bidClassNo",
        "finalAwardDate",
        "providerResultIdentity",
        "rate",
        "rawJson",
        "rebidNo",
        "registeredAt",
        "sourceHash",
        "status",
        "winnerBizNo",
        "winnerName",
        "noticeNo",
        "noticeOrder",
      ].sort(),
    );
  });

  it("rejects malformed numeric amount/rate", () => {
    expect(() =>
      parseFinalAwardRows([makeRow({ sucsfbidAmt: "not-a-number" })]),
    ).toThrow();
    expect(() =>
      parseFinalAwardRows([makeRow({ sucsfbidRate: "abc%" })]),
    ).toThrow();
    const valid = parseFinalAwardRows([makeRow()]);
    expect(valid[0].amount).toBe(1234567890);
    expect(valid[0].rate).toBe(95.5);
  });

  it("computes planned award keys deterministically", () => {
    const rows = parseFinalAwardRows([
      makeRow({ bidClsfcNo: "1", rbidNo: "002" }),
      makeRow({ bidClsfcNo: "2", rbidNo: "003" }),
    ]);
    expect(rows.map((r) => [r.bidClassNo, r.rebidNo])).toEqual([
      ["1", "002"],
      ["2", "003"],
    ]);
  });

  it("rejects same notice/order/bidClass with different rebidNo as duplicate grain", () => {
    expect(() =>
      parseFinalAwardRows([
        makeRow({ rbidNo: "002" }),
        makeRow({ rbidNo: "003" }),
      ]),
    ).toThrow(/duplicate final award grain/i);
  });

  it("rejects negative and non-numeric rebidNo but preserves leading zeros", () => {
    expect(() => parseFinalAwardRows([makeRow({ rbidNo: "-1" })])).toThrow();
    expect(() => parseFinalAwardRows([makeRow({ rbidNo: "abc" })])).toThrow();
    const preserved = parseFinalAwardRows([makeRow({ rbidNo: "001" })]);
    expect(preserved[0].rebidNo).toBe("001");
  });

  it("enforces exact registeredAt format YYYY-MM-DD HH:mm:ss", () => {
    expect(() =>
      parseFinalAwardRows([makeRow({ rgstDt: "2025-01-15T09:30:00" })]),
    ).toThrow();
    expect(() =>
      parseFinalAwardRows([makeRow({ rgstDt: "2025/01/15 09:30" })]),
    ).toThrow();
    const ok = parseFinalAwardRows([
      makeRow({ rgstDt: "2025-01-15 09:30:00" }),
    ]);
    expect(ok[0].registeredAt).toBe("2025-01-15 09:30:00");
  });

  it("parseFinalAwardRows remains strict: blank fnlSucsfDate throws", () => {
    expect(() =>
      parseFinalAwardRows([makeRow({ fnlSucsfDate: "" })]),
    ).toThrow();
  });

  it("parseFinalAwardRows rejects junk suffixes and canonicalizes exact compact and datetime dates", () => {
    expect(() =>
      parseFinalAwardRows([makeRow({ fnlSucsfDate: "2025-01-01junk" })]),
    ).toThrow();

    const compact = parseFinalAwardRows([
      makeRow({ fnlSucsfDate: "20250101" }),
    ]);
    expect(compact).toHaveLength(1);
    expect(compact[0].finalAwardDate).toBe("2025-01-01");
    expect(isFinalAwardOnOrAfter(compact[0], "2025-01-01")).toBe(true);

    const datetime = parseFinalAwardRows([
      makeRow({ fnlSucsfDate: "2025-01-01 23:59:59" }),
    ]);
    expect(datetime[0].finalAwardDate).toBe("2025-01-01");
  });

  it("parseAwardPage surfaces unresolved row for blank fnlSucsfDate while keeping source/winner/hash/raw fields", () => {
    const validRow = makeRow({ bidClsfcNo: "1" });
    const blankDateRow = makeRow({ bidClsfcNo: "2", fnlSucsfDate: "" });
    const envelope = makeEnvelope([validRow, blankDateRow], 1, 2, 2);
    const page = parseAwardPage(envelope);
    expect(page.totalCount).toBe(2);
    expect(page.items).toHaveLength(2);
    const finalItem = page.items.find((it) => it.status === "final");
    expect(finalItem).toBeDefined();
    expect(finalItem!.bidClassNo).toBe("1");
    const unresolvedItem = page.items.find((it) => it.status === "unresolved");
    expect(unresolvedItem).toBeDefined();
    if (unresolvedItem && unresolvedItem.status === "unresolved") {
      expect(unresolvedItem.finalAwardDate).toBeNull();
      expect(unresolvedItem.unresolvedReason).toBe("missing_final_award_date");
      expect(unresolvedItem.winnerBizNo).toBe("2148204708");
      expect(unresolvedItem.winnerName).toBe("Acme Corp");
      expect(unresolvedItem.amount).toBe(1234567890);
      expect(unresolvedItem.rate).toBe(95.5);
      expect(unresolvedItem.registeredAt).toBe("2025-01-15 09:30:00");
      expect(typeof unresolvedItem.rawJson).toBe("string");
      expect(/^[0-9a-f]{64}$/.test(unresolvedItem.sourceHash)).toBe(true);
    }
  });

  it("quarantines blank winner identities while preserving raw evidence", () => {
    const page = parseAwardPage(
      makeEnvelope(
        [
          makeRow({ bidClsfcNo: "1", bidwinnrBizno: "" }),
          makeRow({ bidClsfcNo: "2", bidwinnrNm: "", fnlSucsfDate: "" }),
        ],
        1,
        2,
        2,
      ),
    );
    expect(page.items.every((item) => item.status === "unresolved")).toBe(true);
    const blankBiz = page.items[0];
    const blankName = page.items[1];
    if (blankBiz.status !== "unresolved" || blankName.status !== "unresolved") {
      throw new Error("expected unresolved observations");
    }
    expect(blankBiz.unresolvedReason).toBe("invalid_award_row");
    expect(blankBiz.winnerBizNo).toBeNull();
    expect(blankBiz.winnerName).toBe("Acme Corp");
    expect(blankBiz.finalAwardDate).toBe("2025-02-01");
    expect(blankName.unresolvedReason).toBe("invalid_award_row");
    expect(blankName.winnerBizNo).toBe("2148204708");
    expect(blankName.winnerName).toBeNull();
    expect(blankName.finalAwardDate).toBeNull();
    for (const item of page.items) {
      expect(item.rawJson).toBeTruthy();
      expect(item.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("quarantines malformed row fields instead of dropping the page", () => {
    const page = parseAwardPage(
      makeEnvelope(
        [
          makeRow({ bidClsfcNo: "1", rbidNo: "abc" }),
          makeRow({ bidClsfcNo: "2", rgstDt: "2025/01/15 09:30" }),
          makeRow({ bidClsfcNo: "3", fnlSucsfDate: "2025-01-01junk" }),
        ],
        1,
        3,
        3,
      ),
    );
    expect(page.items).toHaveLength(3);
    for (const item of page.items) {
      expect(item.status).toBe("unresolved");
      if (item.status !== "unresolved") throw new Error("expected unresolved");
      expect(item.unresolvedReason).toBe("invalid_award_row");
      expect(item.rawJson).toBeTruthy();
      expect(item.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("collects both pages with exact official params inside collector window", async () => {
    const rawPageNos: Array<string | number> = [];
    const requestedPages: number[] = [];
    const fetchJson: G2bFetchJson = (async (
      operation: string,
      params: Record<string, string | number>,
    ) => {
      if (operation !== op) throw new Error("bad op");
      expect(params.inqryDiv).toBe("1");
      expect(params.inqryBgnDt).toBe("202501010000");
      expect(params.inqryEndDt).toBe("202501312359");
      expect(params.numOfRows).toBe(1);
      rawPageNos.push(params.pageNo);
      const pageNo = Number(params.pageNo);
      requestedPages.push(pageNo);
      const items =
        pageNo === 1
          ? [makeRow({ bidNtceOrd: "0001" })]
          : [makeRow({ bidNtceOrd: "0002" })];
      return {
        response: {
          header: { resultCode: "00", resultMsg: "OK" },
          body: { pageNo, numOfRows: 1, totalCount: 2, items },
        },
      };
    }) as G2bFetchJson;

    const result = await collectAwardRegistration({
      dateFrom: "202501010000",
      dateTo: "202501312359",
      pageSize: 1,
      maxPages: 5,
      fetchJson,
    });
    expect(rawPageNos).toEqual([1, 2]);
    expect(rawPageNos.every((pageNo) => typeof pageNo === "number")).toBe(true);
    expect(requestedPages).toEqual([1, 2]);
    expect(requestedPages.every((p) => typeof p === "number")).toBe(true);
    expect(typeof requestedPages[0]).toBe("number");
    expect(typeof requestedPages[1]).toBe("number");
    expect(result.dateFrom).toBe("202501010000");
    expect(result.dateTo).toBe("202501312359");
    expect(result.totalCount).toBe(2);
    expect(result.awards).toHaveLength(2);
    expect(result.unresolvedAwards).toHaveLength(0);
    expect(result.registrationWindowComplete).toBe(true);
  });

  it("collector partitions resolved and blank-final-date rows without conflating target coverage", async () => {
    const fetchJson: G2bFetchJson = (async (
      operation: string,
      params: Record<string, string | number>,
    ) => {
      if (operation !== op) throw new Error("bad op");
      const pageNo = Number(params.pageNo);
      const items =
        pageNo === 1
          ? [makeRow({ bidNtceOrd: "0001", bidClsfcNo: "1" })]
          : [
              makeRow({
                bidNtceOrd: "0002",
                bidClsfcNo: "2",
                fnlSucsfDate: "",
              }),
            ];
      return {
        response: {
          header: { resultCode: "00", resultMsg: "OK" },
          body: { pageNo, numOfRows: 1, totalCount: 2, items },
        },
      };
    }) as G2bFetchJson;

    const result = await collectAwardRegistration({
      dateFrom: "202501010000",
      dateTo: "202501312359",
      pageSize: 1,
      maxPages: 5,
      fetchJson,
    });
    expect(result.totalCount).toBe(2);
    expect(result.awards).toHaveLength(1);
    expect(result.unresolvedAwards).toHaveLength(1);
    expect(result.unresolvedAwards[0].unresolvedReason).toBe(
      "missing_final_award_date",
    );
    expect(result.unresolvedAwards[0].finalAwardDate).toBeNull();
    expect(result.registrationWindowComplete).toBe(true);
  });

  it("keeps page provenance in fallback quarantine identities", async () => {
    const fetchJson: G2bFetchJson = async (_operation, params) => {
      const pageNo = Number(params.pageNo);
      return makeEnvelope([makeRow({ bidNtceNo: "" })], pageNo, 1, 2);
    };
    const result = await collectAwardRegistration({
      dateFrom: "202501010000",
      dateTo: "202501312359",
      pageSize: 1,
      maxPages: 2,
      fetchJson,
    });
    expect(result.awards).toHaveLength(0);
    expect(result.unresolvedAwards).toHaveLength(2);
    expect(result.unresolvedAwards.map((row) => row.unresolvedReason)).toEqual([
      "invalid_award_row",
      "invalid_award_row",
    ]);
    expect(result.registrationWindowComplete).toBe(true);
    expect(result.unresolvedAwards[0].providerResultIdentity).toMatch(
      /^quarantine:1:0:/,
    );
    expect(result.unresolvedAwards[1].providerResultIdentity).toMatch(
      /^quarantine:2:0:/,
    );
  });

  it("collector total2/pageSize1 with duplicate notice/order/bidClass across pages and differing rbidNo rejects as duplicate final award grain", async () => {
    const fetchJson: G2bFetchJson = (async (
      operation: string,
      params: Record<string, string | number>,
    ) => {
      if (operation !== op) throw new Error("bad op");
      const pageNo = Number(params.pageNo);
      const items =
        pageNo === 1
          ? [makeRow({ bidNtceOrd: "0001", bidClsfcNo: "1", rbidNo: "001" })]
          : [
              makeRow({
                bidNtceOrd: "0001",
                bidClsfcNo: "1",
                rbidNo: "002",
                fnlSucsfDate: "",
              }),
            ];
      return {
        response: {
          header: { resultCode: "00", resultMsg: "OK" },
          body: { pageNo, numOfRows: 1, totalCount: 2, items },
        },
      };
    }) as G2bFetchJson;

    await expect(
      collectAwardRegistration({
        dateFrom: "202501010000",
        dateTo: "202501312359",
        pageSize: 1,
        maxPages: 5,
        fetchJson,
      }),
    ).rejects.toThrow(/duplicate final award grain/i);
  });

  it("marks the registration window incomplete when rgstDt is malformed", async () => {
    const fetchJson: G2bFetchJson = async () =>
      makeEnvelope([makeRow({ rgstDt: "not-a-date" })], 1, 1, 1);
    const result = await collectAwardRegistration({
      dateFrom: "202501010000",
      dateTo: "202501312359",
      pageSize: 1,
      maxPages: 1,
      fetchJson,
    });
    expect(result.unresolvedAwards).toHaveLength(1);
    expect(result.unresolvedAwards[0].unresolvedReason).toBe(
      "invalid_award_row",
    );
    expect(result.registrationWindowComplete).toBe(false);
  });

  it("collector rejects out-of-window rgstDt", async () => {
    const fetchJson: G2bFetchJson = (async () => ({
      response: {
        header: { resultCode: "00", resultMsg: "OK" },
        body: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: [makeRow({ rgstDt: "2024-12-31 23:59:59" })],
        },
      },
    })) as G2bFetchJson;
    await expect(
      collectAwardRegistration({
        dateFrom: "202501010000",
        dateTo: "202501312359",
        pageSize: 1,
        maxPages: 5,
        fetchJson,
      }),
    ).rejects.toThrow(/registered.*window|out.?of.?window/i);
  });

  it("rejects cardinality mismatch and nonzero result codes", async () => {
    const emptyPage2: G2bFetchJson = (async (
      operation: string,
      params: Record<string, string | number>,
    ) => {
      if (operation !== op) throw new Error("bad op");
      const pageNo = Number(params.pageNo);
      const items = pageNo === 1 ? [makeRow()] : [];
      return {
        response: {
          header: { resultCode: "00", resultMsg: "OK" },
          body: { pageNo, numOfRows: 1, totalCount: 2, items },
        },
      };
    }) as G2bFetchJson;
    await expect(
      collectAwardRegistration({
        dateFrom: "202501010000",
        dateTo: "202501312359",
        pageSize: 1,
        maxPages: 5,
        fetchJson: emptyPage2,
      }),
    ).rejects.toThrow(/cardinality/i);

    const badCode: G2bFetchJson = (async () => ({
      response: {
        header: { resultCode: "99", resultMsg: "ERR" },
        body: { pageNo: 1, numOfRows: 1, totalCount: 0, items: [] },
      },
    })) as G2bFetchJson;
    const payload = await badCode(op, {});
    expect(() => parseAwardPage(payload)).toThrow();
  });

  it("joins award to the target product by exact notice/order/bidClass", () => {
    const products: NoticeProductRow[] = [
      {
        noticeNo: "NTCE-001",
        noticeOrder: "0001",
        bidClassNo: "1",
        parentCode: "P-001",
        detailCode: "D-001",
        targetCode: "3912180101",
        productSerial: "S-001",
        providerRowIdentity: "PRI-001",
        sourceIdentity: "SI-001",
        sourceHash: "h".repeat(64),
        rawJson: "{}",
      },
      {
        noticeNo: "NTCE-001",
        noticeOrder: "0001",
        bidClassNo: "2",
        parentCode: "P-002",
        detailCode: "D-002",
        targetCode: null,
        productSerial: "S-002",
        providerRowIdentity: "PRI-002",
        sourceIdentity: "SI-002",
        sourceHash: "i".repeat(64),
        rawJson: "{}",
      },
    ];
    const award = parseFinalAwardRows([makeRow({ bidClsfcNo: "1" })])[0];
    const joined = joinAwardToTargetProduct(products, award);
    expect(joined.bidClassNo).toBe("1");

    const otherLot = parseFinalAwardRows([makeRow({ bidClsfcNo: "2" })])[0];
    expect(() => joinAwardToTargetProduct(products, otherLot)).toThrow();
  });

  it("joins unresolved observations only after exact target-product correlation", () => {
    const products: NoticeProductRow[] = [
      {
        noticeNo: "NTCE-001",
        noticeOrder: "0001",
        bidClassNo: "1",
        parentCode: "39121801",
        detailCode: "3912180101",
        targetCode: "3912180101",
        productSerial: "S-001",
        providerRowIdentity: "PRI-001",
        sourceIdentity: "PRI-001",
        sourceHash: "h".repeat(64),
        rawJson: "{}",
      },
      {
        noticeNo: "NTCE-001",
        noticeOrder: "0001",
        bidClassNo: "2",
        parentCode: "39121801",
        detailCode: "3912180102",
        targetCode: null,
        productSerial: "S-002",
        providerRowIdentity: "PRI-002",
        sourceIdentity: "PRI-002",
        sourceHash: "i".repeat(64),
        rawJson: "{}",
      },
    ];
    const target = parseAwardPage(
      makeEnvelope([makeRow({ bidClsfcNo: "1", fnlSucsfDate: "" })]),
    ).items[0];
    const sibling = parseAwardPage(
      makeEnvelope([makeRow({ bidClsfcNo: "2", fnlSucsfDate: "" })]),
    ).items[0];
    expect(joinAwardObservationToTargetProduct(products, target)).toBe(target);
    expect(() =>
      joinAwardObservationToTargetProduct(products, sibling),
    ).toThrow();
  });

  it("collapses winners by business number only and enforces boundary date helper", () => {
    const matched = parseFinalAwardRows([
      makeRow({
        bidClsfcNo: "1",
        bidwinnrBizno: "214-82-04708",
        bidwinnrNm: "Acme Corp",
        fnlSucsfDate: "2025-02-01",
      }),
      makeRow({
        bidClsfcNo: "2",
        bidwinnrBizno: "214-82-04708",
        bidwinnrNm: "Acme Corp. Updated",
        fnlSucsfDate: "2025-02-01",
      }),
    ]);
    const collapsed = collapseNoticeWinner(matched);
    expect(collapsed.bidClassNo).toBe("1");

    const conflictingBiz = parseFinalAwardRows([
      makeRow({
        bidClsfcNo: "1",
        bidwinnrBizno: "111-22-33333",
        bidwinnrNm: "Alpha",
      }),
      makeRow({
        bidClsfcNo: "2",
        bidwinnrBizno: "444-55-66666",
        bidwinnrNm: "Beta",
      }),
    ]);
    expect(() => collapseNoticeWinner(conflictingBiz)).toThrow(
      /different target-lot winners/i,
    );

    const conflictingDate = parseFinalAwardRows([
      makeRow({
        bidClsfcNo: "1",
        bidwinnrBizno: "214-82-04708",
        bidwinnrNm: "Acme Corp",
        fnlSucsfDate: "2025-02-01",
      }),
      makeRow({
        bidClsfcNo: "2",
        bidwinnrBizno: "214-82-04708",
        bidwinnrNm: "Acme Corp",
        fnlSucsfDate: "2025-02-02",
      }),
    ]);
    expect(() => collapseNoticeWinner(conflictingDate)).toThrow(
      /different target-lot final dates/i,
    );

    const award = parseFinalAwardRows([
      makeRow({ fnlSucsfDate: "2025-01-01" }),
    ])[0];
    expect(isFinalAwardOnOrAfter(award, "2025-01-01")).toBe(true);
    const awardPrev = parseFinalAwardRows([
      makeRow({ fnlSucsfDate: "2024-12-31" }),
    ])[0];
    expect(isFinalAwardOnOrAfter(awardPrev, "2025-01-01")).toBe(false);
  });

  it("provider envelope body stays inside response and exposes three-part identity", () => {
    const env = makeEnvelope([makeRow()]);
    expect(env).toHaveProperty("response");
    expect(env.response).toHaveProperty("body");
    expect(env.response.body).toHaveProperty("items");
    expect(env.response.body.items).toHaveLength(1);
    const rows = parseFinalAwardRows(env.response.body.items);
    const seen = new Set<string>();
    const triple: string[] = [];
    for (const r of rows) {
      const key = `${r.noticeNo}|${r.noticeOrder}|${r.bidClassNo}|${r.rebidNo}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      triple.push(r.providerResultIdentity);
    }
    expect(triple).toHaveLength(1);
    expect(typeof triple[0]).toBe("string");
    expect((triple[0] as string).length).toBeGreaterThan(0);
  });
});
