import { describe, it, expect, vi } from "vitest";
import type { DesignationSession } from "@/lib/building-control/g2b/designation-session";
import type { DesignationListFact } from "@/lib/building-control/g2b/designation-list-client";
import {
  collectCompleteDesignationHistory,
  fetchDesignationDetailForFact,
} from "@/lib/building-control/g2b/designation-history-client";

type RowStatus = "" | "유효" | "만료" | "효력정지";

const makeRow = (
  id: string,
  status: RowStatus,
  totCnt: number,
): {
  applVldYn: RowStatus;
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
  totCnt: number;
} => ({
  applVldYn: status,
  bzmnRegNo: (id.replace(/\D/g, "") || "0").padStart(10, "0").slice(-10),
  dsgnBgngYmd: "20240115",
  dsgnEndYmd: "20250115",
  dsgnExtsYmd: "",
  entNm: `ENT-${id}`,
  etpmDsgnCrfcNo: `${id}C`,
  etpmDsgnDmndNo: `${id}D`,
  dsgnDmndChgOrd: "1",
  etpsSqno: "1",
  itemCfnm: `ITEM-${id}`,
  totCnt,
});

const listJson = (rows: ReturnType<typeof makeRow>[]): string =>
  JSON.stringify({ ErrorCode: 0, ErrorMsg: "", dlElpdtSlctnSttusL: rows });

const buildSession = (
  responses: Record<string, { rawJson: string; payload: unknown }>,
) => {
  const bootstrap = vi.fn(async () => ({
    referer: "https://shop.g2b.go.kr/final",
  }));
  const postList = vi.fn(
    async (req: Parameters<DesignationSession["postList"]>[0]) => {
      const key = `${req.applVldYn}|${req.currentPage}`;
      const resp = responses[key];
      if (!resp) throw new Error(`Unexpected postList call ${key}`);
      return resp;
    },
  );
  const postDetail = vi.fn(
    async (_req: Parameters<DesignationSession["postDetail"]>[0]) => {
      throw new Error("postDetail should not be called in this test");
    },
  );
  const session: DesignationSession = { bootstrap, postList, postDetail };
  return { session, bootstrap, postList, postDetail };
};

describe("building-control designation-history", () => {
  it("aggregates statuses, reconciliation and explicit totals", async () => {
    const allRows = [
      makeRow("A1", "", 4),
      makeRow("B2", "유효", 4),
      makeRow("C3", "만료", 4),
      makeRow("D4", "효력정지", 4),
    ];
    const responses: Record<string, { rawJson: string; payload: unknown }> = {
      "|1": {
        rawJson: listJson(allRows),
        payload: JSON.parse(listJson(allRows)),
      },
      "유효|1": {
        rawJson: listJson([makeRow("B2", "유효", 1)]),
        payload: null,
      },
      "만료|1": {
        rawJson: listJson([makeRow("C3", "만료", 1)]),
        payload: null,
      },
      "효력정지|1": {
        rawJson: listJson([makeRow("D4", "효력정지", 1)]),
        payload: null,
      },
    };
    responses["유효|1"].payload = JSON.parse(responses["유효|1"].rawJson);
    responses["만료|1"].payload = JSON.parse(responses["만료|1"].rawJson);
    responses["효력정지|1"].payload = JSON.parse(
      responses["효력정지|1"].rawJson,
    );

    const { session, bootstrap, postList, postDetail } =
      buildSession(responses);
    const result = await collectCompleteDesignationHistory({
      session,
      pageSize: 10,
      maxPages: 5,
    });

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(postList).toHaveBeenCalledTimes(4);
    expect(postDetail).toHaveBeenCalledTimes(0);

    const statuses = postList.mock.calls.map((c) => c[0].applVldYn);
    expect(statuses).toEqual(["", "유효", "만료", "효력정지"]);

    expect(result.all.items).toHaveLength(4);
    const first = result.all.items[0];
    expect(first.dsgnBgngYmd).toBe("2024-01-15");
    expect(result.all.pageCount).toBe(1);
    expect(result.all.totalCount).toBeGreaterThan(0);
    expect(Array.isArray(result.all.rawPages)).toBe(true);
    expect(typeof result.all.coverageHash).toBe("string");

    const buckets = result.reconciliation.buckets;
    expect(buckets[""]).toBe(1);
    expect(buckets["유효"]).toBe(1);
    expect(buckets["만료"]).toBe(1);
    expect(buckets["효력정지"]).toBe(1);

    const explicit = result.explicitStatusTotals;
    expect(explicit["유효"]).toBe(1);
    expect(explicit["만료"]).toBe(1);
    expect(explicit["효력정지"]).toBe(1);

    expect(result.bootstrapReferer).toBe("https://shop.g2b.go.kr/final");
  });

  it("rejects when explicit 유효 does not match all-response reconciliation", async () => {
    const allRows = [makeRow("E1", "유효", 1)];
    const explicitValidRows = [
      makeRow("F1", "유효", 2),
      makeRow("F2", "유효", 2),
    ];
    const responses: Record<string, { rawJson: string; payload: unknown }> = {
      "|1": {
        rawJson: listJson(allRows),
        payload: JSON.parse(listJson(allRows)),
      },
      "유효|1": {
        rawJson: listJson(explicitValidRows),
        payload: JSON.parse(listJson(explicitValidRows)),
      },
      "만료|1": { rawJson: listJson([]), payload: JSON.parse(listJson([])) },
      "효력정지|1": {
        rawJson: listJson([]),
        payload: JSON.parse(listJson([])),
      },
    };
    const { session } = buildSession(responses);
    await expect(
      collectCompleteDesignationHistory({ session, pageSize: 10, maxPages: 5 }),
    ).rejects.toThrow(/snapshot|bucket|mismatch/i);
  });

  it("fetchDesignationDetailForFact passes exact identity and parses nested payload", async () => {
    const bootstrap = vi.fn(async () => ({
      referer: "https://shop.g2b.go.kr/final",
    }));
    const detailRaw = JSON.stringify({
      ErrorCode: 0,
      ErrorMsg: "",
      dlElpdtSlctnSttusDtlM: {
        etpmDsgnCrfcNo: "XC",
        etpmDsgnDmndNo: "XD",
        dsgnDmndChgOrd: "1",
        etpsSqno: "1",
        dlProdSpecModlDtlL: [{ itemUntyNo: "39121801" }],
      },
    });
    const postDetail: DesignationSession["postDetail"] = vi.fn(async () => ({
      rawJson: detailRaw,
      payload: JSON.parse(detailRaw),
    }));
    const session: DesignationSession = {
      bootstrap,
      postList: vi.fn(),
      postDetail,
    };

    const fact: DesignationListFact = {
      schemaVersion: 1,
      sourceIdentity: "XC|XD|1|1",
      applVldYn: "유효",
      status: "유효",
      bzmnRegNo: "1234567890",
      dsgnBgngYmd: "2024-01-15",
      dsgnEndYmd: "2025-01-15",
      dsgnExtsYmd: "",
      entNm: "ENT-XC",
      companyName: "ENT-XC",
      etpmDsgnCrfcNo: "XC",
      etpmDsgnDmndNo: "XD",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
      productName: "P1",
      listRawJson: listJson([makeRow("X0", "유효", 1)]),
    };

    const result = await fetchDesignationDetailForFact({ session, fact });
    expect(postDetail).toHaveBeenCalledTimes(1);
    expect(postDetail).toHaveBeenCalledWith({
      etpmDsgnCrfcNo: "XC",
      etpmDsgnDmndNo: "XD",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    });
    expect(result.classifications).toBeDefined();
    expect(result.rawJson).toBe(detailRaw);
    expect(result.designationRequest).toEqual({
      etpmDsgnCrfcNo: "XC",
      etpmDsgnDmndNo: "XD",
      dsgnDmndChgOrd: "1",
      etpsSqno: "1",
    });
  });
});
