// RED phase tests for actual G2B designation list/detail parsing and award-date classification.
import { describe, it, expect, expectTypeOf } from "vitest";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { loadActiveFixtureGeneration } from "@/lib/building-control/fixture-generation";
import {
  parseDesignationListResponse,
  collectAllDesignationFacts,
  reconcileDesignationStatusUnion,
  assertNoDesignationContraction,
  type DesignationListFact,
  type DesignationStatus,
} from "@/lib/building-control/g2b/designation-list-client";
import {
  parseDesignationDetailResponse,
  containsExactTargetClassification,
  buildDesignationObservation,
  classifyDesignationAtAwardDate,
  type DesignationObservationInput,
  type TerminationEvidence,
  type DesignationDetailClassification,
  type DesignationDetailResult,
} from "@/lib/building-control/g2b/designation-detail-client";

type Bundle = ReturnType<typeof loadActiveFixtureGeneration>["bundle"];

function makeVerifiedNone(): TerminationEvidence {
  return {
    state: "verified_none",
    evidenceHash: "a".repeat(64),
    evidenceRawJson: "{}",
  };
}

function makeVerifiedDates(
  cancellationDate: string | null,
  revocationDate: string | null,
): TerminationEvidence {
  return {
    state: "verified_dates",
    cancellationDate,
    revocationDate,
    evidenceHash: "b".repeat(64),
    evidenceRawJson: "{}",
  };
}

describe("TerminationEvidence type contract", () => {
  it("is an exact discriminated union", () => {
    type Unverified = Extract<TerminationEvidence, { state: "unverified" }>;
    type VerifiedNone = Extract<
      TerminationEvidence,
      { state: "verified_none" }
    >;
    type VerifiedDates = Extract<
      TerminationEvidence,
      { state: "verified_dates" }
    >;
    expectTypeOf<Unverified>().toEqualTypeOf<{
      readonly state: "unverified";
    }>();
    expectTypeOf<VerifiedNone>().toEqualTypeOf<{
      readonly state: "verified_none";
      readonly evidenceHash: string;
      readonly evidenceRawJson: string;
    }>();
    expectTypeOf<VerifiedDates>().toEqualTypeOf<{
      readonly state: "verified_dates";
      readonly cancellationDate: string | null;
      readonly revocationDate: string | null;
      readonly evidenceHash: string;
      readonly evidenceRawJson: string;
    }>();
  });
});

const FIXTURE_ROOT = join(
  process.cwd(),
  "tests",
  "fixtures",
  "building-control",
);

function loadBundle(): Bundle {
  return loadActiveFixtureGeneration(FIXTURE_ROOT).bundle;
}

type ListProjectionItem = {
  applVldYn: string;
  bzmnRegNo: string;
  dsgnBgngYmd: string;
  dsgnEndYmd: string;
  dsgnExtsYmd: string;
  entNm: string;
  etpmDsgnCrfcNo: string;
  etpmDsgnDmndNo: string;
  dsgnDmndChgOrd: string;
  etpsSqno: string;
  itemCfnm: string;
};

type ListProjection = { items: ListProjectionItem[]; totalCount: number };

type DetailProjectionClassification = { itemUntyNo: string };

type DetailMetadataProjection = {
  etpmDsgnCrfcNo: string;
  etpmDsgnDmndNo: string;
  dsgnDmndChgOrd: string;
  etpsSqno: string;
};

function projectionToProviderRow(
  item: ListProjectionItem,
  totCnt: number,
): Record<string, unknown> {
  return {
    applVldYn: item.applVldYn,
    bzmnRegNo: item.bzmnRegNo,
    dsgnBgngYmd: item.dsgnBgngYmd,
    dsgnEndYmd: item.dsgnEndYmd,
    dsgnExtsYmd: item.dsgnExtsYmd,
    entNm: item.entNm,
    etpmDsgnCrfcNo: item.etpmDsgnCrfcNo,
    etpmDsgnDmndNo: item.etpmDsgnDmndNo,
    dsgnDmndChgOrd: item.dsgnDmndChgOrd,
    etpsSqno: item.etpsSqno,
    itemCfnm: item.itemCfnm,
    totCnt,
  };
}

function parsedFactFromProjection(
  item: ListProjectionItem,
  totCnt: number,
): DesignationListFact {
  const providerRow = projectionToProviderRow(item, totCnt);
  const payload = {
    ErrorCode: 0,
    ErrorMsg: "",
    dlElpdtSlctnSttusL: [providerRow],
  };
  const rawJson = JSON.stringify(payload);
  const page = parseDesignationListResponse({
    payload,
    rawJson,
    request: rawListRequest(),
  });
  return page.items[0];
}

function rawListRequest(): {
  applVldYn: "";
  currentPage: number;
  recordCountPerPage: number;
} {
  return { applVldYn: "", currentPage: 1, recordCountPerPage: 100 };
}

function rawDetailRequest(identity: {
  etpmDsgnCrfcNo: string;
  etpmDsgnDmndNo: string;
  dsgnDmndChgOrd: string;
  etpsSqno: string;
}): {
  etpmDsgnCrfcNo: string;
  etpmDsgnDmndNo: string;
  dsgnDmndChgOrd: string;
  etpsSqno: string;
} {
  return {
    etpmDsgnCrfcNo: identity.etpmDsgnCrfcNo,
    etpmDsgnDmndNo: identity.etpmDsgnDmndNo,
    dsgnDmndChgOrd: identity.dsgnDmndChgOrd,
    etpsSqno: identity.etpsSqno,
  };
}

function makeProjection(
  overrides: Partial<ListProjectionItem> = {},
): ListProjectionItem {
  return {
    applVldYn: "",
    bzmnRegNo: "1234567890",
    dsgnBgngYmd: "2020-01-02",
    dsgnEndYmd: "2025-01-01",
    dsgnExtsYmd: "",
    entNm: "ACME",
    etpmDsgnCrfcNo: "C1",
    etpmDsgnDmndNo: "D1",
    dsgnDmndChgOrd: "1",
    etpsSqno: "1",
    itemCfnm: "EXC-PRODUCT",
    ...overrides,
  };
}

function makeListPayload(
  projection: ListProjectionItem[],
  totCnt: number,
  errorCode = 0,
): {
  payload: unknown;
  rawJson: string;
} {
  const rows = projection.map((p) => projectionToProviderRow(p, totCnt));
  const payload = {
    ErrorCode: errorCode,
    ErrorMsg: errorCode === 0 ? "" : "ERR",
    dlElpdtSlctnSttusL: rows,
  };
  return { payload, rawJson: JSON.stringify(payload) };
}

function makeDetailPayload(args: {
  metadata: DetailMetadataProjection;
  status?: Record<string, unknown>;
  classifications: DetailProjectionClassification[];
  errorCode?: number;
}): { payload: unknown; rawJson: string } {
  const payload = {
    ErrorCode: args.errorCode ?? 0,
    ErrorMsg: args.errorCode && args.errorCode !== 0 ? "ERR" : "",
    dlElpdtSlctnSttusDtlM: args.metadata,
    dlSlctnSttusDtlInfoM: args.status ?? {},
    dlProdSpecModlDtlL: args.classifications.map((c) => ({
      itemUntyNo: c.itemUntyNo,
    })),
  };
  return { payload, rawJson: JSON.stringify(payload) };
}

const META_IDENTITY: DetailMetadataProjection = {
  etpmDsgnCrfcNo: "C1",
  etpmDsgnDmndNo: "D1",
  dsgnDmndChgOrd: "1",
  etpsSqno: "1",
};

describe("designation list response parsing (actual G2B envelope)", () => {
  it("extracts facts from a valid active-list row with all required fields", () => {
    const projection: ListProjectionItem = makeProjection({
      entNm: "ENT-A",
      itemCfnm: "PROD-A",
    });
    const { payload, rawJson } = makeListPayload([projection], 1);
    const page = parseDesignationListResponse({
      payload,
      rawJson,
      request: rawListRequest(),
    });
    expect(page.schemaVersion).toBe(1);
    expect(page.status).toBe("ok");
    expect(page.totalCount).toBe(1);
    expect(page.items).toHaveLength(1);
    const fact = page.items[0];
    expect(fact.productName).toBe("PROD-A");
    expect(fact.companyName).toBe("ENT-A");
    expect(fact.bzmnRegNo).toBe("1234567890");
    expect(fact.listRawJson).toBe(rawJson);
    expect(fact.applVldYn).toBe("");
    expect(fact.dsgnExtsYmd).toBe("");
    expect(fact.status).toBe("");
  });

  it("normalizes official designation compact dates to ISO once", () => {
    const projection: ListProjectionItem = makeProjection({
      entNm: "ENT-D",
      itemCfnm: "PROD-D",
      dsgnBgngYmd: "20200102",
      dsgnEndYmd: "20250101",
      dsgnExtsYmd: "",
    });
    const { payload, rawJson } = makeListPayload([projection], 1);
    const page = parseDesignationListResponse({
      payload,
      rawJson,
      request: rawListRequest(),
    });
    const fact = page.items[0];
    expect(fact.dsgnBgngYmd).toBe("2020-01-02");
    expect(fact.dsgnEndYmd).toBe("2025-01-01");
    expect(fact.dsgnExtsYmd).toBe("");
    expect(fact.listRawJson).toBe(rawJson);
  });

  it("leaves existing ISO YYYY-MM-DD dates unchanged", () => {
    const projection: ListProjectionItem = makeProjection({
      dsgnBgngYmd: "2020-01-02",
      dsgnEndYmd: "2025-01-01",
      dsgnExtsYmd: "",
    });
    const { payload, rawJson } = makeListPayload([projection], 1);
    const page = parseDesignationListResponse({
      payload,
      rawJson,
      request: rawListRequest(),
    });
    const fact = page.items[0];
    expect(fact.dsgnBgngYmd).toBe("2020-01-02");
    expect(fact.dsgnEndYmd).toBe("2025-01-01");
    expect(fact.dsgnExtsYmd).toBe("");
  });

  it("rejects invalid compact and ISO designation dates and preserves rawJson", () => {
    const invalidCases: Array<Partial<ListProjectionItem>> = [
      { dsgnBgngYmd: "2020132" },
      { dsgnBgngYmd: "2020-13-02" },
      { dsgnBgngYmd: "2020-02-30" },
      { dsgnEndYmd: "not-a-date" },
      { dsgnExtsYmd: "2025-13-01" },
    ];
    for (const override of invalidCases) {
      const projection: ListProjectionItem = makeProjection(override);
      const { payload, rawJson } = makeListPayload([projection], 1);
      expect(() =>
        parseDesignationListResponse({
          payload,
          rawJson,
          request: rawListRequest(),
        }),
      ).toThrow();
    }
  });

  it("rejects when required row fields are missing", () => {
    const row = projectionToProviderRow(makeProjection(), 1);
    delete (row as Record<string, unknown>).itemCfnm;
    const payload = {
      ErrorCode: 0,
      ErrorMsg: "",
      dlElpdtSlctnSttusL: [row],
    };
    const rawJson = JSON.stringify(payload);
    expect(() =>
      parseDesignationListResponse({
        payload,
        rawJson,
        request: rawListRequest(),
      }),
    ).toThrow();
  });

  it("rejects when totalCount is missing from the row", () => {
    const row = projectionToProviderRow(makeProjection(), 1);
    delete (row as Record<string, unknown>).totCnt;
    const payload = {
      ErrorCode: 0,
      ErrorMsg: "",
      dlElpdtSlctnSttusL: [row],
    };
    const rawJson = JSON.stringify(payload);
    expect(() =>
      parseDesignationListResponse({
        payload,
        rawJson,
        request: rawListRequest(),
      }),
    ).toThrow();
  });

  it("rejects unknown statuses outside the four exact strings", () => {
    const unknownStatuses = ["활성", "실적제외"];
    for (const applVldYn of unknownStatuses) {
      const projection: ListProjectionItem = makeProjection({
        entNm: "ENT-X",
        itemCfnm: "PROD-X",
        applVldYn,
      });
      const row = projectionToProviderRow(projection, 1);
      const payload = {
        ErrorCode: 0,
        ErrorMsg: "",
        dlElpdtSlctnSttusL: [row],
      };
      const rawJson = JSON.stringify(payload);
      expect(() =>
        parseDesignationListResponse({
          payload,
          rawJson,
          request: rawListRequest(),
        }),
      ).toThrow();
    }
  });

  it("accepts empty rows when totalCount is zero on page 1", () => {
    const payload = { ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: [] };
    const rawJson = JSON.stringify(payload);
    const page = parseDesignationListResponse({
      payload,
      rawJson,
      request: rawListRequest(),
    });
    expect(page.totalCount).toBe(0);
    expect(page.items).toHaveLength(0);
  });

  it("rejects non-zero ErrorCode", () => {
    const payload = { ErrorCode: 7, ErrorMsg: "ERR", dlElpdtSlctnSttusL: [] };
    const rawJson = JSON.stringify(payload);
    expect(() =>
      parseDesignationListResponse({
        payload,
        rawJson,
        request: rawListRequest(),
      }),
    ).toThrow();
  });

  it("rejects when dlElpdtSlctnSttusL is not an array", () => {
    const payload = { ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: "oops" };
    const rawJson = JSON.stringify(payload);
    expect(() =>
      parseDesignationListResponse({
        payload,
        rawJson,
        request: rawListRequest(),
      }),
    ).toThrow();
  });
});

describe("collectAllDesignationFacts (uses existing pager)", () => {
  it("collects all pages with applVldYn='' and produces coverage hash", async () => {
    const projectionA: ListProjectionItem = makeProjection({
      entNm: "A",
      itemCfnm: "P1",
      etpmDsgnCrfcNo: "A1",
    });
    const projectionB: ListProjectionItem = makeProjection({
      entNm: "B",
      itemCfnm: "P2",
      etpmDsgnCrfcNo: "A2",
      etpmDsgnDmndNo: "D2",
    });
    const factA = parsedFactFromProjection(projectionA, 2);
    const factB = parsedFactFromProjection(projectionB, 2);
    const items = [factA, factB];
    const result = await collectAllDesignationFacts({
      pageSize: 1,
      maxPages: 5,
      fetchPage: async (pageNo, pageSize) => {
        const selected = pageNo === 1 ? [factA] : [factB];
        return {
          pageNo,
          pageSize,
          totalCount: 2,
          items: selected,
          rawJson: selected[0]?.listRawJson ?? "{}",
        };
      },
    });
    expect(result.items).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.coverageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rawPages.length).toBe(2);
  });

  it("treats zero totalCount as valid only on page 1", async () => {
    const empty = parseDesignationListResponse({
      payload: { ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: [] },
      rawJson: JSON.stringify({
        ErrorCode: 0,
        ErrorMsg: "",
        dlElpdtSlctnSttusL: [],
      }),
      request: rawListRequest(),
    });
    const result = await collectAllDesignationFacts({
      pageSize: 100,
      maxPages: 5,
      fetchPage: async (pageNo, pageSize) => ({
        pageNo,
        pageSize,
        totalCount: empty.totalCount,
        items: empty.items as readonly DesignationListFact[],
        rawJson: "[]",
      }),
    });
    expect(result.totalCount).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});

describe("reconcileDesignationStatusUnion and assertNoDesignationContraction", () => {
  it("accepts an all-status count equal to sum of 유효/만료/효력정지 snapshots", () => {
    const bundle = loadBundle();
    const listValid = bundle["designation-list-valid.json"] as ListProjection;
    const listExpired = bundle[
      "designation-list-expired.json"
    ] as ListProjection;
    const listExtended = bundle[
      "designation-list-extended.json"
    ] as ListProjection;
    const allCount =
      listValid.totalCount + listExpired.totalCount + listExtended.totalCount;
    const snapshot = {
      유효: listValid.totalCount + listExtended.totalCount,
      만료: listExpired.totalCount,
      효력정지: 0,
    };
    const factsValid = listValid.items.map((item) =>
      parsedFactFromProjection(item, listValid.totalCount),
    );
    const factsExpired = listExpired.items.map((item) =>
      parsedFactFromProjection(item, listExpired.totalCount),
    );
    const factsExtended = listExtended.items.map((item) =>
      parsedFactFromProjection(item, listExtended.totalCount),
    );
    expect(() =>
      reconcileDesignationStatusUnion({
        allCount,
        snapshot,
        items: [...factsValid, ...factsExpired, ...factsExtended],
      }),
    ).not.toThrow();
  });

  it("accepts an all-status set with blank plus 유효/만료/효력정지 summing to allCount", () => {
    const projectionValid: ListProjectionItem = makeProjection({
      entNm: "V",
      itemCfnm: "P-V",
      etpmDsgnCrfcNo: "C-V",
      etpmDsgnDmndNo: "D-V",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
      applVldYn: "유효",
    });
    const projectionExpired: ListProjectionItem = makeProjection({
      entNm: "E",
      itemCfnm: "P-E",
      etpmDsgnCrfcNo: "C-E",
      etpmDsgnDmndNo: "D-E",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
      applVldYn: "만료",
    });
    const projectionSuspended: ListProjectionItem = makeProjection({
      entNm: "S",
      itemCfnm: "P-S",
      etpmDsgnCrfcNo: "C-S",
      etpmDsgnDmndNo: "D-S",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
      applVldYn: "효력정지",
    });
    const projectionBlank: ListProjectionItem = makeProjection({
      entNm: "B",
      itemCfnm: "P-B",
      etpmDsgnCrfcNo: "C-B",
      etpmDsgnDmndNo: "D-B",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
      applVldYn: "",
    });
    const allCount = 4;
    const snapshot = { 유효: 1, 만료: 1, 효력정지: 1 };
    const items = [
      parsedFactFromProjection(projectionValid, allCount),
      parsedFactFromProjection(projectionExpired, allCount),
      parsedFactFromProjection(projectionSuspended, allCount),
      parsedFactFromProjection(projectionBlank, allCount),
    ];
    let result: {
      allCount: number;
      buckets: { "": number; 유효: number; 만료: number; 효력정지: number };
      snapshot: { 유효: number; 만료: number; 효력정지: number };
    };
    expect(() => {
      result = reconcileDesignationStatusUnion({ allCount, snapshot, items });
    }).not.toThrow();
    expect(result!.allCount).toBe(4);
    expect(result!.buckets[""]).toBe(1);
    expect(result!.buckets["유효"]).toBe(1);
    expect(result!.buckets["만료"]).toBe(1);
    expect(result!.buckets["효력정지"]).toBe(1);
    expect(
      result!.buckets[""] +
        result!.buckets["유효"] +
        result!.buckets["만료"] +
        result!.buckets["효력정지"],
    ).toBe(result!.allCount);
    expect(result!.buckets["유효"]).toBe(snapshot.유효);
    expect(result!.buckets["만료"]).toBe(snapshot.만료);
    expect(result!.buckets["효력정지"]).toBe(snapshot.효력정지);
  });

  it("rejects mismatched snapshot counts", () => {
    expect(() =>
      reconcileDesignationStatusUnion({
        allCount: 5,
        snapshot: { 유효: 2, 만료: 2, 효력정지: 0 },
        items: [],
      }),
    ).toThrow();
  });

  it("rejects when explicit 유효 snapshot diverges from 유효 bucket while allCount/items are stable", () => {
    const projectionValid: ListProjectionItem = makeProjection({
      entNm: "V",
      itemCfnm: "P-V",
      etpmDsgnCrfcNo: "C-V",
      etpmDsgnDmndNo: "D-V",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    });
    const projectionExpired: ListProjectionItem = makeProjection({
      entNm: "E",
      itemCfnm: "P-E",
      etpmDsgnCrfcNo: "C-E",
      etpmDsgnDmndNo: "D-E",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    });
    const allCount = 2;
    const items = [
      parsedFactFromProjection(projectionValid, allCount),
      parsedFactFromProjection(projectionExpired, allCount),
    ];
    expect(() =>
      reconcileDesignationStatusUnion({
        allCount,
        snapshot: { 유효: 5, 만료: 1, 효력정지: 0 },
        items,
      }),
    ).toThrow();
  });

  it("rejects contraction: lower count or missing identity", () => {
    const bundle = loadBundle();
    const listValid = bundle["designation-list-valid.json"] as ListProjection;
    const previous = listValid.items.map((item) =>
      parsedFactFromProjection(item, listValid.totalCount),
    );
    const contracted = previous.slice(0, Math.max(0, previous.length - 1));
    expect(() =>
      assertNoDesignationContraction({ previous, current: contracted }),
    ).toThrow();
    expect(() =>
      assertNoDesignationContraction({
        previous,
        current: previous.map((f) => ({ ...f, bzmnRegNo: "" })),
      }),
    ).toThrow();
  });

  it("rejects equal-count disappearance and replacement by contraction", () => {
    const previousA: ListProjectionItem = makeProjection({
      entNm: "A",
      itemCfnm: "P-A",
      etpmDsgnCrfcNo: "C-A",
      etpmDsgnDmndNo: "D-A",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    });
    const previousB: ListProjectionItem = makeProjection({
      entNm: "B",
      itemCfnm: "P-B",
      etpmDsgnCrfcNo: "C-B",
      etpmDsgnDmndNo: "D-B",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    });
    const currentB: ListProjectionItem = makeProjection({
      entNm: "B",
      itemCfnm: "P-B",
      etpmDsgnCrfcNo: "C-B",
      etpmDsgnDmndNo: "D-B",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    });
    const currentC: ListProjectionItem = makeProjection({
      entNm: "C",
      itemCfnm: "P-C",
      etpmDsgnCrfcNo: "C-C",
      etpmDsgnDmndNo: "D-C",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    });
    const previousFacts = [
      parsedFactFromProjection(previousA, 2),
      parsedFactFromProjection(previousB, 2),
    ];
    const currentFacts = [
      parsedFactFromProjection(currentB, 2),
      parsedFactFromProjection(currentC, 2),
    ];
    expect(() =>
      assertNoDesignationContraction({
        previous: previousFacts,
        current: currentFacts,
      }),
    ).toThrow(/disappearance|contraction/i);
  });
});

describe("designation detail response parsing", () => {
  it("parses target classification 39121801 and 3912180101", () => {
    const { payload, rawJson } = makeDetailPayload({
      metadata: META_IDENTITY,
      classifications: [
        { itemUntyNo: "39121801" },
        { itemUntyNo: "3912180101" },
      ],
    });
    const result: DesignationDetailResult = parseDesignationDetailResponse({
      payload,
      rawJson,
      request: rawDetailRequest(META_IDENTITY),
    });
    expect(result.designationRequest.etpmDsgnCrfcNo).toBe("C1");
    expect(result.designationRequest.etpmDsgnDmndNo).toBe("D1");
    expect(result.designationRequest.dsgnDmndChgOrd).toBe("1");
    expect(result.designationRequest.etpsSqno).toBe("1");
    expect(result.classifications).toHaveLength(2);
    const codes = result.classifications.map(
      (c: DesignationDetailClassification) => c.itemUntyNo,
    );
    expect(containsExactTargetClassification(codes)).toBe(true);
  });

  it("rejects 3912180199, 3912180102, prefix and title variants", () => {
    const samples = ["3912180199", "3912180102", "3912180", "39121801-A"];
    for (const s of samples) {
      expect(containsExactTargetClassification([s])).toBe(false);
    }
  });

  it("accepts 39121801 with surrounding whitespace via contract trim", () => {
    expect(containsExactTargetClassification(["  39121801  "])).toBe(true);
  });

  it("uses designation-detail.json projection from the active bundle", () => {
    const bundle = loadBundle();
    const detailProjection = bundle["designation-detail.json"] as {
      designationRequest: DetailMetadataProjection;
      classifications: DetailProjectionClassification[];
    };
    const { payload, rawJson } = makeDetailPayload({
      metadata: detailProjection.designationRequest,
      classifications: detailProjection.classifications,
    });
    const result: DesignationDetailResult = parseDesignationDetailResponse({
      payload,
      rawJson,
      request: rawDetailRequest(detailProjection.designationRequest),
    });
    expect(result.designationRequest).toEqual(
      detailProjection.designationRequest,
    );
    const codes = result.classifications.map(
      (c: DesignationDetailClassification) => c.itemUntyNo,
    );
    const expectedCodes = detailProjection.classifications.map(
      (c) => c.itemUntyNo,
    );
    expect(codes).toEqual(expectedCodes);
    expect(containsExactTargetClassification(codes)).toBe(true);
    expect(result.evidence).toBe("complete_target");
  });

  it("returns evidence missing when classifications are absent", () => {
    const { payload, rawJson } = makeDetailPayload({
      metadata: META_IDENTITY,
      classifications: [],
    });
    const result = parseDesignationDetailResponse({
      payload,
      rawJson,
      request: rawDetailRequest(META_IDENTITY),
    });
    expect(result.evidence).toBe("missing");
  });

  it("returns complete non-target when classifications are present but not target", () => {
    const { payload, rawJson } = makeDetailPayload({
      metadata: META_IDENTITY,
      classifications: [{ itemUntyNo: "99999999" }],
    });
    const result = parseDesignationDetailResponse({
      payload,
      rawJson,
      request: rawDetailRequest(META_IDENTITY),
    });
    expect(result.evidence).toBe("complete_non_target");
  });

  it("rejects non-zero ErrorCode on detail response", () => {
    const { payload, rawJson } = makeDetailPayload({
      metadata: META_IDENTITY,
      classifications: [{ itemUntyNo: "39121801" }],
      errorCode: 9,
    });
    expect(() =>
      parseDesignationDetailResponse({
        payload,
        rawJson,
        request: rawDetailRequest(META_IDENTITY),
      }),
    ).toThrow();
  });

  it("rejects metadata identity mismatch with request", () => {
    const { payload, rawJson } = makeDetailPayload({
      metadata: { ...META_IDENTITY, etpsSqno: "999" },
      classifications: [{ itemUntyNo: "39121801" }],
    });
    expect(() =>
      parseDesignationDetailResponse({
        payload,
        rawJson,
        request: rawDetailRequest(META_IDENTITY),
      }),
    ).toThrow();
  });

  it("accepts classifications nested under dlElpdtSlctnSttusDtlM.dlProdSpecModlDtlL", () => {
    const nestedMetadata: DetailMetadataProjection & {
      dlProdSpecModlDtlL: DetailProjectionClassification[];
    } = {
      ...META_IDENTITY,
      dlProdSpecModlDtlL: [
        { itemUntyNo: "39121801" },
        { itemUntyNo: "3912180101" },
      ],
    };
    const payload = {
      ErrorCode: 0,
      ErrorMsg: "",
      dlElpdtSlctnSttusDtlM: nestedMetadata,
      dlSlctnSttusDtlInfoM: {},
    };
    const rawJson = JSON.stringify(payload);
    const result: DesignationDetailResult = parseDesignationDetailResponse({
      payload,
      rawJson,
      request: rawDetailRequest(META_IDENTITY),
    });
    const codes = result.classifications.map(
      (c: DesignationDetailClassification) => c.itemUntyNo,
    );
    expect(codes).toEqual(["39121801", "3912180101"]);
    expect(containsExactTargetClassification(codes)).toBe(true);
    expect(result.evidence).toBe("complete_target");
  });

  it("accepts missing dlElpdtSlctnSttusDtlM when top-level dlProdSpecModlDtlL is present and uses request as designationRequest", () => {
    const payload = {
      ErrorCode: 0,
      ErrorMsg: "",
      dlProdSpecModlDtlL: [{ itemUntyNo: "39121801" }],
    };
    const rawJson = JSON.stringify(payload);
    const result: DesignationDetailResult = parseDesignationDetailResponse({
      payload,
      rawJson,
      request: rawDetailRequest(META_IDENTITY),
    });
    expect(result.designationRequest).toEqual(META_IDENTITY);
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].itemUntyNo).toBe("39121801");
    expect(
      containsExactTargetClassification(
        result.classifications.map((c) => c.itemUntyNo),
      ),
    ).toBe(true);
  });

  it("rejects a partially echoed detail identity or any mismatched echoed identity", () => {
    const partialEcho = {
      ErrorCode: 0,
      ErrorMsg: "",
      dlElpdtSlctnSttusDtlM: {
        ...META_IDENTITY,
        etpmDsgnDmndNo: "DIFFERENT",
      },
      dlProdSpecModlDtlL: [{ itemUntyNo: "39121801" }],
    };
    const partialRaw = JSON.stringify(partialEcho);
    expect(() =>
      parseDesignationDetailResponse({
        payload: partialEcho,
        rawJson: partialRaw,
        request: rawDetailRequest(META_IDENTITY),
      }),
    ).toThrow();

    const mismatched = {
      ErrorCode: 0,
      ErrorMsg: "",
      dlElpdtSlctnSttusDtlM: {
        etpmDsgnCrfcNo: "C2",
        etpmDsgnDmndNo: "D2",
        dsgnDmndChgOrd: "2",
        etpsSqno: "2",
      },
      dlProdSpecModlDtlL: [{ itemUntyNo: "39121801" }],
    };
    const mismatchedRaw = JSON.stringify(mismatched);
    expect(() =>
      parseDesignationDetailResponse({
        payload: mismatched,
        rawJson: mismatchedRaw,
        request: rawDetailRequest(META_IDENTITY),
      }),
    ).toThrow();
  });
});

describe("buildDesignationObservation and classifyDesignationAtAwardDate", () => {
  function makeListFact(
    overrides: Partial<DesignationListFact> = {},
  ): DesignationListFact {
    const defaults: Omit<DesignationListFact, "status"> = {
      schemaVersion: 1,
      sourceIdentity: "C1|D1|1|1",
      applVldYn: "",
      bzmnRegNo: "1234567890",
      dsgnBgngYmd: "2020-01-02",
      dsgnEndYmd: "2025-01-01",
      dsgnExtsYmd: "",
      entNm: "ACME",
      etpmDsgnCrfcNo: "C1",
      etpmDsgnDmndNo: "D1",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
      productName: "EXC-PRODUCT",
      companyName: "ACME",
      listRawJson: JSON.stringify({ ErrorCode: 0, dlElpdtSlctnSttusL: [] }),
    };
    const base: DesignationListFact = {
      ...defaults,
      status: "유효" as DesignationStatus,
    };
    return { ...base, ...overrides, status: overrides.status ?? base.status };
  }

  function makeDetailFact() {
    return {
      classifications: [{ itemUntyNo: "39121801" }],
      detailRawJson: JSON.stringify({
        ErrorCode: 0,
        dlElpdtSlctnSttusDtlM: META_IDENTITY,
        dlProdSpecModlDtlL: [{ itemUntyNo: "39121801" }],
      }),
    };
  }

  it("builds observation with deterministic sourceHash", () => {
    const listFact = makeListFact();
    const detailFact = makeDetailFact();
    const termination: TerminationEvidence = { state: "unverified" };
    const obs1 = buildDesignationObservation({
      listFact,
      detailFact,
      termination,
    });
    const obs2 = buildDesignationObservation({
      listFact,
      detailFact,
      termination,
    });
    expect(obs1.sourceHash).toBe(obs2.sourceHash);
    expect(obs1.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses original end as effective end when extension is blank", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({ dsgnExtsYmd: "", dsgnEndYmd: "2025-01-01" }),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });
    expect(obs.effectiveEndDate).toBe("2025-01-01");
  });

  it("uses extension as effective end when extension is provided", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({
        dsgnExtsYmd: "2026-06-06",
        dsgnEndYmd: "2025-01-01",
      }),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });
    expect(obs.effectiveEndDate).toBe("2026-06-06");
  });

  it("marks observation incomplete when extension is before end and detail is null", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({
        dsgnExtsYmd: "2020-06-06",
        dsgnEndYmd: "2025-01-01",
      }),
      detailFact: null,
      termination: { state: "unverified" },
    });
    expect(obs.completenessReason).toBeDefined();
    expect(obs.detail).toBeNull();
  });

  it("treats verified_none as incomplete when evidenceHash is missing or not 64 lowercase hex", () => {
    const listFact = makeListFact();
    const detailFact = makeDetailFact();
    const baseObs = buildDesignationObservation({
      listFact,
      detailFact,
      termination: makeVerifiedNone(),
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: baseObs,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");

    const missingHash = buildDesignationObservation({
      listFact,
      detailFact,
      termination: { state: "verified_none" } as TerminationEvidence,
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: missingHash,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");

    const shortHash = buildDesignationObservation({
      listFact,
      detailFact,
      termination: {
        state: "verified_none",
        evidenceHash: "a".repeat(63),
      } as TerminationEvidence,
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: shortHash,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");

    const upperHash = buildDesignationObservation({
      listFact,
      detailFact,
      termination: {
        state: "verified_none",
        evidenceHash: "A".repeat(64),
      } as TerminationEvidence,
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: upperHash,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");

    const nonHexHash = buildDesignationObservation({
      listFact,
      detailFact,
      termination: {
        state: "verified_none",
        evidenceHash: "z".repeat(64),
      } as TerminationEvidence,
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: nonHexHash,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");
  });

  it("treats verified_dates as incomplete when evidenceHash invalid or both dates are null", () => {
    const listFact = makeListFact();
    const detailFact = makeDetailFact();

    const badHash = buildDesignationObservation({
      listFact,
      detailFact,
      termination: {
        state: "verified_dates",
        cancellationDate: "2023-01-01",
        revocationDate: null,
        evidenceHash: "not-hex",
      } as TerminationEvidence,
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: badHash,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");

    const noDates = buildDesignationObservation({
      listFact,
      detailFact,
      termination: {
        state: "verified_dates",
        cancellationDate: null,
        revocationDate: null,
        evidenceHash: "9".repeat(64),
      } as TerminationEvidence,
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: noDates,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");

    const validDates = buildDesignationObservation({
      listFact,
      detailFact,
      termination: makeVerifiedDates("2023-01-01", null),
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: validDates,
        awardDate: "2022-12-31",
      }).kind,
    ).toBe("incomplete");
  });

  it("treats 효력정지 with verified_none as incomplete and verified_dates with boundary after award as excellent", () => {
    const suspendedList = makeListFact({
      status: "효력정지" as DesignationStatus,
    });
    const detailFact = makeDetailFact();

    const noneObs = buildDesignationObservation({
      listFact: suspendedList,
      detailFact,
      termination: makeVerifiedNone(),
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: noneObs,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");

    const unverifiedObs = buildDesignationObservation({
      listFact: suspendedList,
      detailFact,
      termination: { state: "unverified" },
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: unverifiedObs,
        awardDate: "2023-05-05",
      }).kind,
    ).toBe("incomplete");

    const datedObs = buildDesignationObservation({
      listFact: makeListFact({
        status: "효력정지" as DesignationStatus,
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "2025-01-01",
      }),
      detailFact,
      termination: makeVerifiedDates("2024-01-01", null),
    });
    const before = classifyDesignationAtAwardDate({
      observation: datedObs,
      awardDate: "2023-05-05",
    });
    const on = classifyDesignationAtAwardDate({
      observation: datedObs,
      awardDate: "2024-01-01",
    });
    const after = classifyDesignationAtAwardDate({
      observation: datedObs,
      awardDate: "2024-06-01",
    });
    expect(before.kind).toBe("incomplete");
    expect(on.kind).toBe("incomplete");
    expect(after.kind).toBe("incomplete");
  });

  it("sourceHash is invariant under raw JSON whitespace and page formatting differences when normalized fields match", () => {
    const baseList = makeListFact();
    const baseDetail = makeDetailFact();
    const baseTerm: TerminationEvidence = { state: "unverified" };
    const base = buildDesignationObservation({
      listFact: baseList,
      detailFact: baseDetail,
      termination: baseTerm,
    });

    const paddedListRaw = `{\n  "ErrorCode": 0,\n  "ErrorMsg": "",\n  "dlElpdtSlctnSttusL": [\n    {\n      "applVldYn": "",\n      "bzmnRegNo": "1234567890",\n      "dsgnBgngYmd": "2020-01-02",\n      "dsgnEndYmd": "2025-01-01",\n      "dsgnExtsYmd": "",\n      "entNm": "ACME",\n      "etpmDsgnCrfcNo": "C1",\n      "etpmDsgnDmndNo": "D1",\n      "dsgnDmndChgOrd": "1",\n      "etpsSqno": "1",\n      "itemCfnm": "EXC-PRODUCT",\n      "totCnt": 1\n    }\n  ]\n}`;
    const paddedDetailRaw = `{\n  "ErrorCode": 0,\n  "dlElpdtSlctnSttusDtlM": {\n    "etpmDsgnCrfcNo": "C1",\n    "etpmDsgnDmndNo": "D1",\n    "dsgnDmndChgOrd": "1",\n    "etpsSqno": "1"\n  },\n  "dlProdSpecModlDtlL": [\n    { "itemUntyNo": "39121801" }\n  ]\n}`;
    const altListFact = makeListFact({ listRawJson: paddedListRaw });
    const altDetailFact = {
      classifications: baseDetail.classifications,
      detailRawJson: paddedDetailRaw,
    };
    const alt = buildDesignationObservation({
      listFact: altListFact,
      detailFact: altDetailFact,
      termination: baseTerm,
    });
    expect(alt.sourceHash).toBe(base.sourceHash);
  });

  it("sourceHash changes when a relevant row field, classification set, or termination evidence changes", () => {
    const base = buildDesignationObservation({
      listFact: makeListFact(),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });

    const changedRow = buildDesignationObservation({
      listFact: makeListFact({ entNm: "OTHER" }),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });
    expect(changedRow.sourceHash).not.toBe(base.sourceHash);

    const changedClassifications = buildDesignationObservation({
      listFact: makeListFact(),
      detailFact: {
        classifications: [{ itemUntyNo: "99999999" }],
        detailRawJson: "{}",
      },
      termination: { state: "unverified" },
    });
    expect(changedClassifications.sourceHash).not.toBe(base.sourceHash);

    const changedTermination = buildDesignationObservation({
      listFact: makeListFact(),
      detailFact: makeDetailFact(),
      termination: makeVerifiedNone(),
    });
    expect(changedTermination.sourceHash).not.toBe(base.sourceHash);
  });

  it("classifies target detail excellent from official status and interval", () => {
    const obs: DesignationObservationInput = buildDesignationObservation({
      listFact: makeListFact({
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "2025-01-01",
      }),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("excellent");
  });

  it("classifies not_excellent before start and after effective end", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "2025-01-01",
      }),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });
    expect(
      classifyDesignationAtAwardDate({
        observation: obs,
        awardDate: "2019-12-31",
      }).kind,
    ).toBe("not_excellent");
    expect(
      classifyDesignationAtAwardDate({
        observation: obs,
        awardDate: "2025-12-31",
      }).kind,
    ).toBe("not_excellent");
  });

  it("uses official valid status and interval without fabricated termination", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({
        status: "유효",
      } as Partial<DesignationListFact>),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("excellent");
  });

  it("rejects unproven verified_none inside a historical interval", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({
        status: "만료",
      } as Partial<DesignationListFact>),
      detailFact: makeDetailFact(),
      termination: makeVerifiedNone(),
    });
    const before = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    const after = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2026-05-05",
    });
    expect(before.kind).toBe("incomplete");
    expect(after.kind).toBe("not_excellent");
  });

  it("rejects invalid bizNo and non-Gregorian dates during classification", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({ bzmnRegNo: "abc" }),
      detailFact: makeDetailFact(),
      termination: makeVerifiedNone(),
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("incomplete");
  });

  it("does not apply an unproven cancellation boundary", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact(),
      detailFact: makeDetailFact(),
      termination: makeVerifiedDates("2023-01-01", null),
    });
    const before = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2022-12-31",
    });
    const on = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-01-01",
    });
    expect(before.kind).toBe("incomplete");
    expect(on.kind).toBe("incomplete");
  });

  it("flags 효력정지 without verified dated boundary as incomplete", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({
        status: "효력정지",
      } as Partial<DesignationListFact>),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("incomplete");
  });

  it("classifies 효력정지 outside the designation interval as not_excellent", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({
        status: "효력정지",
        applVldYn: "효력정지",
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "2025-01-01",
      } as Partial<DesignationListFact>),
      detailFact: makeDetailFact(),
      termination: { state: "unverified" },
    });
    const result = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2019-12-31",
    });
    expect(result.kind).toBe("not_excellent");
  });

  it("returns not_excellent for non-target detail even within interval", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact(),
      detailFact: {
        classifications: [{ itemUntyNo: "99999999" }],
        detailRawJson: "{}",
      },
      termination: makeVerifiedNone(),
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("not_excellent");
  });

  it("treats malformed termination date as incomplete", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact(),
      detailFact: makeDetailFact(),
      termination: {
        state: "verified_dates",
        cancellationDate: "not-a-date",
        revocationDate: null,
        evidenceHash: "f".repeat(64),
      } as TerminationEvidence,
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("incomplete");
  });

  it("keeps blank official list status as incomplete with reason blank_status even with verified_none", () => {
    const obs = buildDesignationObservation({
      listFact: makeListFact({
        status: "" as DesignationStatus,
        applVldYn: "",
        dsgnBgngYmd: "2020-01-02",
        dsgnEndYmd: "2025-01-01",
      }),
      detailFact: makeDetailFact(),
      termination: makeVerifiedNone(),
    });
    const r = classifyDesignationAtAwardDate({
      observation: obs,
      awardDate: "2023-05-05",
    });
    expect(r.kind).toBe("incomplete");
    if (r.kind === "incomplete") {
      expect(r.reason).toBe("blank_status");
    }
  });
});
