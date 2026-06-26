import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import bidNoticeResponse from "./fixtures/bid-notice-response.json";
import contractInfoResponse from "./fixtures/contract-info-response.json";

import {
  fetchContractInfoByContractIdentifier,
  GET_CONTRACT_INFO_OPERATION,
  parseContractInfoResponse,
} from "@/lib/g2b/contract-info-client";
import { fetchBidNotice, parseBidNoticeResponse } from "@/lib/g2b/bid-notice-client";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { enrichContractRecord } from "@/lib/g2b/enrichment";
import { buildG2bUrl, fetchG2bJson, getServiceKey } from "@/lib/g2b/http";
import { fetchSuccessfulBid } from "@/lib/g2b/successful-bid-client";

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "g2b-enrich-"));
  const connection = createDb(join(dir, "contracts.sqlite"));
  initializeSqliteSchema(connection.sqlite);
  return connection;
}

function insertContractRecord(sqlite: ReturnType<typeof createTempDb>["sqlite"]) {
  sqlite
    .prepare(
      [
        "insert into contract_records",
        "(",
        "source_dataset, source_row_hash, business_category, notice_no, notice_order, notice_name,",
        "contract_no, unified_contract_no, contract_name, contract_date, biz_no_normalized,",
        "notice_detail_url, contract_detail_url, source_status, last_imported_at, updated_at",
        ") values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
    )
    .run(
      "test",
      "hash-1",
      "services",
      "20260100001",
      "00",
      null,
      "CN-2026-0001",
      null,
      "Existing contract name",
      "2026-01-15",
      "1234567890",
      null,
      null,
      "local_only",
      "2026-06-26T00:00:00.000Z",
      "2026-06-26T00:00:00.000Z",
    );
}

describe("G2B response parsers", () => {
  it("normalizes contract info items from Public Data Portal JSON", () => {
    expect(parseContractInfoResponse(contractInfoResponse)).toEqual({
      contractNo: "CN-2026-0001",
      unifiedContractNo: "UN-2026-0001",
      contractName: "Maintenance service",
      contractDetailUrl: "https://www.g2b.go.kr/contract/CN-2026-0001",
    });
  });

  it("normalizes bid notice items from Public Data Portal JSON", () => {
    expect(parseBidNoticeResponse(bidNoticeResponse)).toEqual({
      noticeNo: "20260100001",
      noticeOrder: "00",
      noticeName: "Maintenance bid notice",
      noticeDetailUrl: "https://www.g2b.go.kr/notice/20260100001",
    });
  });
});

describe("G2B HTTP helpers", () => {
  it("builds JSON API URLs without empty parameters", () => {
    const url = buildG2bUrl("https://apis.data.go.kr/1230000/CntrctInfoService", "getCntrct", {
      dcsnCntrctNo: "CN-2026-0001",
      empty: "",
      nil: null,
      missing: undefined,
    });

    expect(url.toString()).toBe(
      "https://apis.data.go.kr/1230000/CntrctInfoService/getCntrct?dcsnCntrctNo=CN-2026-0001&type=json",
    );
  });

  it("trims the service key and returns null for blank values", () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;

    try {
      process.env.DATA_GO_KR_SERVICE_KEY = "  SECRET_KEY  ";
      expect(getServiceKey()).toBe("SECRET_KEY");

      process.env.DATA_GO_KR_SERVICE_KEY = "   ";
      expect(getServiceKey()).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });

  it("requires a service key before fetching without leaking configured values", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;

    try {
      process.env.DATA_GO_KR_SERVICE_KEY = "   ";
      await expect(
        fetchG2bJson("https://apis.data.go.kr/1230000/CntrctInfoService", GET_CONTRACT_INFO_OPERATION, {
          dcsnCntrctNo: "CN-2026-0001",
        }),
      ).rejects.toThrow("DATA_GO_KR_SERVICE_KEY is required for G2B API requests.");
    } finally {
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });
});

describe("G2B client request URLs", () => {
  it("uses planned service paths and inquiry divisions", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    const fetchMock = vi.fn(async (_url: URL) => ({
      ok: true,
      json: async () => ({ response: { body: { items: [] } } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.DATA_GO_KR_SERVICE_KEY = "TEST_KEY";

    try {
      await fetchContractInfoByContractIdentifier({ contractNo: "CN-2026-0001" });
      await fetchBidNotice("20260100001", "00");
      await fetchSuccessfulBid("20260100001", "00");

      const urls = fetchMock.mock.calls.map(([url]) => url as URL);

      expect(urls[0].origin + urls[0].pathname).toBe(
        "https://apis.data.go.kr/1230000/ao/CntrctInfoService/getCntrctInfoListThng",
      );
      expect(urls[0].searchParams.get("dcsnCntrctNo")).toBe("CN-2026-0001");
      expect(urls[0].searchParams.get("untyCntrctNo")).toBeNull();
      expect(urls[0].searchParams.get("inqryDiv")).toBe("2");

      expect(urls[1].origin + urls[1].pathname).toBe(
        "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThng",
      );
      expect(urls[1].searchParams.get("bidNtceNo")).toBe("20260100001");
      expect(urls[1].searchParams.get("bidNtceOrd")).toBe("00");
      expect(urls[1].searchParams.get("inqryDiv")).toBe("2");

      expect(urls[2].origin + urls[2].pathname).toBe(
        "https://apis.data.go.kr/1230000/as/ScsbidInfoService/getScsbidListSttusThng",
      );
      expect(urls[2].searchParams.get("bidNtceNo")).toBe("20260100001");
      expect(urls[2].searchParams.get("bidNtceOrd")).toBe("00");
      expect(urls[2].searchParams.get("inqryDiv")).toBe("3");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.DATA_GO_KR_SERVICE_KEY;
      } else {
        process.env.DATA_GO_KR_SERVICE_KEY = previous;
      }
    }
  });

  it("uses the unified contract number request parameter for unified-only lookups", async () => {
    const previous = process.env.DATA_GO_KR_SERVICE_KEY;
    const fetchMock = vi.fn(async (_url: URL) => ({
      ok: true,
      json: async () => ({ response: { body: { items: [] } } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.DATA_GO_KR_SERVICE_KEY = "TEST_KEY";

    try {
      await fetchContractInfoByContractIdentifier({ unifiedContractNo: "UN-ONLY-2026" });

      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.searchParams.get("untyCntrctNo")).toBe("UN-ONLY-2026");
      expect(url.searchParams.get("dcsnCntrctNo")).toBeNull();
      expect(url.searchParams.get("inqryDiv")).toBe("2");
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

describe("POST /api/enrich", () => {
  it("returns 403 when API enrichment is disabled", async () => {
    vi.resetModules();
    const previous = process.env.ENRICHMENT_ENABLED;
    delete process.env.ENRICHMENT_ENABLED;

    try {
      const { POST } = await import("@/app/api/enrich/route");
      const response = await POST(
        new NextRequest("http://localhost/api/enrich", {
          method: "POST",
          body: JSON.stringify({ recordId: 1 }),
        }),
      );

      await expect(response.json()).resolves.toEqual({ error: "API enrichment disabled." });
      expect(response.status).toBe(403);
    } finally {
      if (previous === undefined) {
        delete process.env.ENRICHMENT_ENABLED;
      } else {
        process.env.ENRICHMENT_ENABLED = previous;
      }
    }
  });
});

describe("enrichContractRecord", () => {
  it("logs not-found enrichment attempts", async () => {
    const { sqlite, db } = createTempDb();

    try {
      const result = await enrichContractRecord(db, 999);

      expect(result).toEqual({ updated: false, message: "Record not found." });

      const log = sqlite
        .prepare(
          [
            "select contract_record_id as contractRecordId, provider, operation,",
            "request_params_json as requestParamsJson, response_status as responseStatus,",
            "error_message as errorMessage",
            "from api_enrichment_logs",
          ].join(" "),
        )
        .get() as {
        contractRecordId: number | null;
        provider: string;
        operation: string;
        requestParamsJson: string;
        responseStatus: string;
        errorMessage: string;
      };

      expect(log).toEqual({
        contractRecordId: null,
        provider: "data.go.kr",
        operation: "enrichContractRecord",
        requestParamsJson: JSON.stringify({ recordId: 999 }),
        responseStatus: "not_found",
        errorMessage: "Record not found.",
      });
    } finally {
      sqlite.close();
    }
  });

  it("updates available API fields, preserves null API values, and writes a success log", async () => {
    const { sqlite, db } = createTempDb();
    insertContractRecord(sqlite);

    try {
      const result = await enrichContractRecord(db, 1, {
        fetchBidNotice: vi.fn(async () => ({
          noticeNo: "20260100001",
          noticeOrder: null,
          noticeName: "Maintenance bid notice",
          noticeDetailUrl: "https://www.g2b.go.kr/notice/20260100001",
        })),
        fetchContractInfo: vi.fn(async () => ({
          contractNo: "CN-2026-0001",
          unifiedContractNo: "UN-2026-0001",
          contractName: null,
          contractDetailUrl: "https://www.g2b.go.kr/contract/CN-2026-0001",
        })),
      });

      expect(result).toEqual({ updated: true, message: "Record enriched." });

      const record = sqlite
        .prepare(
          [
            "select notice_name as noticeName, notice_order as noticeOrder,",
            "notice_detail_url as noticeDetailUrl, unified_contract_no as unifiedContractNo,",
            "contract_name as contractName, contract_detail_url as contractDetailUrl,",
            "source_status as sourceStatus, last_enriched_at as lastEnrichedAt",
            "from contract_records where id = 1",
          ].join(" "),
        )
        .get() as {
        noticeName: string;
        noticeOrder: string;
        noticeDetailUrl: string;
        unifiedContractNo: string;
        contractName: string;
        contractDetailUrl: string;
        sourceStatus: string;
        lastEnrichedAt: string;
      };

      expect(record).toMatchObject({
        noticeName: "Maintenance bid notice",
        noticeOrder: "00",
        noticeDetailUrl: "https://www.g2b.go.kr/notice/20260100001",
        unifiedContractNo: "UN-2026-0001",
        contractName: "Existing contract name",
        contractDetailUrl: "https://www.g2b.go.kr/contract/CN-2026-0001",
        sourceStatus: "api_enriched",
      });
      expect(record.lastEnrichedAt).toEqual(expect.any(String));

      const log = sqlite
        .prepare("select response_status as responseStatus, error_message as errorMessage from api_enrichment_logs")
        .get() as { responseStatus: string; errorMessage: string | null };
      expect(log).toEqual({ responseStatus: "success", errorMessage: null });
    } finally {
      sqlite.close();
    }
  });

  it("uses unified contract number when contract number is missing", async () => {
    const { sqlite, db } = createTempDb();
    insertContractRecord(sqlite);
    sqlite
      .prepare("update contract_records set contract_no = null, unified_contract_no = ? where id = 1")
      .run("UN-ONLY-2026");
    const fetchContractInfo = vi.fn(async () => ({
      matched: true,
      contractNo: null,
      unifiedContractNo: "UN-ONLY-2026",
      contractName: null,
      contractDetailUrl: "https://www.g2b.go.kr/contract/UN-ONLY-2026",
    }));

    try {
      const result = await enrichContractRecord(db, 1, {
        fetchBidNotice: vi.fn(async () => ({
          matched: true,
          noticeNo: "20260100001",
          noticeOrder: "00",
          noticeName: null,
          noticeDetailUrl: null,
        })),
        fetchContractInfo,
      } as Parameters<typeof enrichContractRecord>[2]);

      expect(fetchContractInfo).toHaveBeenCalledWith({ unifiedContractNo: "UN-ONLY-2026" });
      expect(result.updated).toBe(true);

      const record = sqlite
        .prepare(
          [
            "select source_status as sourceStatus, last_enriched_at as lastEnrichedAt,",
            "contract_detail_url as contractDetailUrl",
            "from contract_records where id = 1",
          ].join(" "),
        )
        .get() as { sourceStatus: string; lastEnrichedAt: string; contractDetailUrl: string };
      expect(record).toMatchObject({
        sourceStatus: "api_enriched",
        contractDetailUrl: "https://www.g2b.go.kr/contract/UN-ONLY-2026",
      });
      expect(record.lastEnrichedAt).toEqual(expect.any(String));

      const log = sqlite
        .prepare("select response_status as responseStatus from api_enrichment_logs")
        .get() as { responseStatus: string };
      expect(log.responseStatus).toBe("success");
    } finally {
      sqlite.close();
    }
  });

  it("logs no identifiers without calling APIs", async () => {
    const { sqlite, db } = createTempDb();
    insertContractRecord(sqlite);
    sqlite
      .prepare(
        [
          "update contract_records",
          "set notice_no = null, contract_no = null, unified_contract_no = null",
          "where id = 1",
        ].join(" "),
      )
      .run();
    const fetchBidNoticeMock = vi.fn(async () => ({
      matched: true,
      noticeNo: null,
      noticeOrder: null,
      noticeName: null,
      noticeDetailUrl: null,
    }));
    const fetchContractInfoMock = vi.fn(async () => ({
      matched: true,
      contractNo: null,
      unifiedContractNo: null,
      contractName: null,
      contractDetailUrl: null,
    }));
    const fetchSuccessfulBidMock = vi.fn(async () => ({
      matched: true,
      noticeNo: null,
      noticeOrder: null,
      noticeName: null,
      successfulBidAmount: null,
      successfulBidRate: null,
    }));

    try {
      const result = await enrichContractRecord(db, 1, {
        fetchBidNotice: fetchBidNoticeMock,
        fetchContractInfo: fetchContractInfoMock,
        fetchSuccessfulBid: fetchSuccessfulBidMock,
      } as Parameters<typeof enrichContractRecord>[2]);

      expect(result).toEqual({
        updated: false,
        message: "No enrichment identifiers available.",
      });
      expect(fetchBidNoticeMock).not.toHaveBeenCalled();
      expect(fetchContractInfoMock).not.toHaveBeenCalled();
      expect(fetchSuccessfulBidMock).not.toHaveBeenCalled();

      const record = sqlite
        .prepare("select source_status as sourceStatus from contract_records where id = 1")
        .get() as { sourceStatus: string };
      expect(record.sourceStatus).toBe("local_only");

      const log = sqlite
        .prepare("select response_status as responseStatus, error_message as errorMessage from api_enrichment_logs")
        .get() as { responseStatus: string; errorMessage: string | null };
      expect(log).toEqual({ responseStatus: "no_identifiers", errorMessage: null });
    } finally {
      sqlite.close();
    }
  });

  it("keeps local-only status and logs no-match when attempted APIs return no item", async () => {
    const { sqlite, db } = createTempDb();
    insertContractRecord(sqlite);

    try {
      const result = await enrichContractRecord(db, 1, {
        fetchBidNotice: vi.fn(async () => ({
          matched: false,
          noticeNo: null,
          noticeOrder: null,
          noticeName: null,
          noticeDetailUrl: null,
        })),
        fetchContractInfo: vi.fn(async () => ({
          matched: false,
          contractNo: null,
          unifiedContractNo: null,
          contractName: null,
          contractDetailUrl: null,
        })),
      } as Parameters<typeof enrichContractRecord>[2]);

      expect(result).toEqual({ updated: false, message: "No G2B API match found." });

      const record = sqlite
        .prepare(
          [
            "select source_status as sourceStatus, contract_name as contractName,",
            "last_enriched_at as lastEnrichedAt, updated_at as updatedAt",
            "from contract_records where id = 1",
          ].join(" "),
        )
        .get() as {
        sourceStatus: string;
        contractName: string;
        lastEnrichedAt: string | null;
        updatedAt: string;
      };
      expect(record).toMatchObject({
        sourceStatus: "local_only",
        contractName: "Existing contract name",
      });
      expect(record.lastEnrichedAt).toEqual(expect.any(String));
      expect(record.updatedAt).not.toBe("2026-06-26T00:00:00.000Z");

      const log = sqlite
        .prepare("select response_status as responseStatus, error_message as errorMessage from api_enrichment_logs")
        .get() as { responseStatus: string; errorMessage: string | null };
      expect(log).toEqual({ responseStatus: "no_match", errorMessage: null });
    } finally {
      sqlite.close();
    }
  });

  it("treats matched API items with null fields as successful checks", async () => {
    const { sqlite, db } = createTempDb();
    insertContractRecord(sqlite);

    try {
      const result = await enrichContractRecord(db, 1, {
        fetchBidNotice: vi.fn(async () => ({
          matched: true,
          noticeNo: null,
          noticeOrder: null,
          noticeName: null,
          noticeDetailUrl: null,
        })),
        fetchContractInfo: vi.fn(async () => ({
          matched: true,
          contractNo: null,
          unifiedContractNo: null,
          contractName: null,
          contractDetailUrl: null,
        })),
      } as Parameters<typeof enrichContractRecord>[2]);

      expect(result).toEqual({ updated: true, message: "Record enrichment checked." });

      const record = sqlite
        .prepare(
          [
            "select source_status as sourceStatus, notice_order as noticeOrder,",
            "contract_name as contractName, last_enriched_at as lastEnrichedAt",
            "from contract_records where id = 1",
          ].join(" "),
        )
        .get() as {
        sourceStatus: string;
        noticeOrder: string;
        contractName: string;
        lastEnrichedAt: string;
      };
      expect(record).toMatchObject({
        sourceStatus: "api_enriched",
        noticeOrder: "00",
        contractName: "Existing contract name",
      });
      expect(record.lastEnrichedAt).toEqual(expect.any(String));

      const log = sqlite
        .prepare("select response_status as responseStatus from api_enrichment_logs")
        .get() as { responseStatus: string };
      expect(log.responseStatus).toBe("success");
    } finally {
      sqlite.close();
    }
  });

  it("invokes successful-bid enrichment for records with a notice number", async () => {
    const { sqlite, db } = createTempDb();
    insertContractRecord(sqlite);
    const fetchSuccessfulBid = vi.fn(async () => ({
      matched: true,
      noticeNo: "20260100001",
      noticeOrder: "00",
      noticeName: "Maintenance bid notice",
      successfulBidAmount: "1000000",
      successfulBidRate: "95.5",
    }));

    try {
      await enrichContractRecord(db, 1, {
        fetchBidNotice: vi.fn(async () => ({
          matched: true,
          noticeNo: "20260100001",
          noticeOrder: "00",
          noticeName: null,
          noticeDetailUrl: null,
        })),
        fetchContractInfo: vi.fn(async () => ({
          matched: true,
          contractNo: "CN-2026-0001",
          unifiedContractNo: null,
          contractName: null,
          contractDetailUrl: null,
        })),
        fetchSuccessfulBid,
      } as Parameters<typeof enrichContractRecord>[2]);

      expect(fetchSuccessfulBid).toHaveBeenCalledWith("20260100001", "00");
    } finally {
      sqlite.close();
    }
  });

  it("writes metadata and a success log when API checks succeed without field changes", async () => {
    const { sqlite, db } = createTempDb();
    insertContractRecord(sqlite);
    sqlite
      .prepare(
        [
          "update contract_records",
          "set notice_name = ?, notice_detail_url = ?, unified_contract_no = ?,",
          "contract_detail_url = ?, updated_at = ?",
          "where id = 1",
        ].join(" "),
      )
      .run(
        "Maintenance bid notice",
        "https://www.g2b.go.kr/notice/20260100001",
        "UN-2026-0001",
        "https://www.g2b.go.kr/contract/CN-2026-0001",
        "2026-06-26T00:00:00.000Z",
      );

    try {
      const result = await enrichContractRecord(db, 1, {
        fetchBidNotice: vi.fn(async () => ({
          noticeNo: "20260100001",
          noticeOrder: "00",
          noticeName: "Maintenance bid notice",
          noticeDetailUrl: null,
        })),
        fetchContractInfo: vi.fn(async () => ({
          contractNo: "CN-2026-0001",
          unifiedContractNo: "UN-2026-0001",
          contractName: null,
          contractDetailUrl: "https://www.g2b.go.kr/contract/CN-2026-0001",
        })),
      });

      expect(result).toEqual({ updated: true, message: "Record enrichment checked." });

      const record = sqlite
        .prepare(
          [
            "select notice_name as noticeName, notice_detail_url as noticeDetailUrl,",
            "unified_contract_no as unifiedContractNo, contract_name as contractName,",
            "contract_detail_url as contractDetailUrl, source_status as sourceStatus,",
            "last_enriched_at as lastEnrichedAt, updated_at as updatedAt",
            "from contract_records where id = 1",
          ].join(" "),
        )
        .get() as {
        noticeName: string;
        noticeDetailUrl: string;
        unifiedContractNo: string;
        contractName: string;
        contractDetailUrl: string;
        sourceStatus: string;
        lastEnrichedAt: string;
        updatedAt: string;
      };

      expect(record).toMatchObject({
        noticeName: "Maintenance bid notice",
        noticeDetailUrl: "https://www.g2b.go.kr/notice/20260100001",
        unifiedContractNo: "UN-2026-0001",
        contractName: "Existing contract name",
        contractDetailUrl: "https://www.g2b.go.kr/contract/CN-2026-0001",
        sourceStatus: "api_enriched",
      });
      expect(record.lastEnrichedAt).toEqual(expect.any(String));
      expect(record.updatedAt).not.toBe("2026-06-26T00:00:00.000Z");

      const log = sqlite
        .prepare("select response_status as responseStatus, error_message as errorMessage from api_enrichment_logs")
        .get() as { responseStatus: string; errorMessage: string | null };
      expect(log).toEqual({ responseStatus: "success", errorMessage: null });
    } finally {
      sqlite.close();
    }
  });

  it("writes an error log when enrichment fetches fail", async () => {
    const { sqlite, db } = createTempDb();
    insertContractRecord(sqlite);

    try {
      const result = await enrichContractRecord(db, 1, {
        fetchBidNotice: vi.fn(async () => {
          throw new Error("DATA_GO_KR_SERVICE_KEY is required for G2B API requests.");
        }),
        fetchContractInfo: vi.fn(async () => ({
          contractNo: null,
          unifiedContractNo: null,
          contractName: null,
          contractDetailUrl: null,
        })),
      });

      expect(result).toEqual({
        updated: false,
        message: "DATA_GO_KR_SERVICE_KEY is required for G2B API requests.",
      });

      const log = sqlite
        .prepare("select response_status as responseStatus, error_message as errorMessage from api_enrichment_logs")
        .get() as { responseStatus: string; errorMessage: string };
      expect(log).toEqual({
        responseStatus: "error",
        errorMessage: "DATA_GO_KR_SERVICE_KEY is required for G2B API requests.",
      });
    } finally {
      sqlite.close();
    }
  });
});
