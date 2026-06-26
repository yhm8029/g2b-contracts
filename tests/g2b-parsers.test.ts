import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import bidNoticeResponse from "./fixtures/bid-notice-response.json";
import contractInfoResponse from "./fixtures/contract-info-response.json";

import { GET_CONTRACT_INFO_OPERATION, parseContractInfoResponse } from "@/lib/g2b/contract-info-client";
import { parseBidNoticeResponse } from "@/lib/g2b/bid-notice-client";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { enrichContractRecord } from "@/lib/g2b/enrichment";
import { buildG2bUrl, fetchG2bJson, getServiceKey } from "@/lib/g2b/http";

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
