import { describe, expect, it } from "vitest";

import {
  apiStatusLabels,
  buildSyncProgressView,
  compactDateToIsoDate,
  exportHrefForLastSearch,
  localizeClientError,
  normalizeCompactDateInput,
  syncStatusMessage,
} from "@/components/ContractLookupApp";

describe("apiStatusLabels", () => {
  it("uses neutral labels before server health is available", () => {
    expect(apiStatusLabels(null)).toEqual({
      apiKey: "확인 전",
      enrichment: "확인 전",
    });
  });

  it("uses server-backed labels after health is available", () => {
    expect(
      apiStatusLabels({
        contractCount: 1,
        latestImportAt: null,
        apiKeyConfigured: true,
        enrichmentEnabled: false,
      }),
    ).toEqual({
      apiKey: "설정됨",
      enrichment: "비활성",
    });
  });
});

describe("exportHrefForLastSearch", () => {
  it("is disabled before a successful search", () => {
    expect(exportHrefForLastSearch(null, 0)).toBeNull();
  });

  it("uses the last successful search params instead of live form edits", () => {
    const lastSearchParams = {
      bizNo: "123-45-67890",
      dateFrom: "2026-01-01",
      dateTo: "",
      businessCategory: "goods",
    };

    expect(exportHrefForLastSearch(lastSearchParams, 2)).toBe(
      "/api/export?bizNo=123-45-67890&dateFrom=2026-01-01&businessCategory=goods",
    );
  });

  it("is disabled when stale search params no longer have visible rows", () => {
    const lastSearchParams = {
      bizNo: "123-45-67890",
      dateFrom: "",
      dateTo: "",
      businessCategory: "all",
    };

    expect(exportHrefForLastSearch(lastSearchParams, 0)).toBeNull();
  });
});

describe("date input helpers", () => {
  it("normalizes pasted date text into compact YYYYMMDD display text", () => {
    expect(normalizeCompactDateInput("2025-01-31")).toBe("20250131");
    expect(normalizeCompactDateInput("20250131")).toBe("20250131");
    expect(normalizeCompactDateInput("202501312359")).toBe("20250131");
  });

  it("converts compact display dates into ISO request dates", () => {
    expect(compactDateToIsoDate("20250131")).toBe("2025-01-31");
    expect(compactDateToIsoDate("")).toBe("");
    expect(compactDateToIsoDate("202501")).toBe("202501");
  });
});

describe("localizeClientError", () => {
  it("translates known search validation errors", () => {
    expect(localizeClientError("Business registration number must contain 10 digits.", "search")).toBe(
      "사업자등록번호는 숫자 10자리여야 합니다.",
    );
  });

  it("translates known sync setup errors", () => {
    expect(localizeClientError("DATA_GO_KR_SERVICE_KEY is required for G2B sync.", "sync")).toBe(
      "나라장터 동기화를 위해 공공데이터포털 API 키가 필요합니다.",
    );
  });

  it("keeps unknown provider errors but adds Korean context", () => {
    expect(localizeClientError("Provider timeout", "sync")).toBe("나라장터 동기화 실패: Provider timeout");
  });
});

describe("buildSyncProgressView", () => {
  it("estimates combined standard and third-party work for all categories", () => {
    expect(
      buildSyncProgressView({
        bizNo: "2048145651",
        dateFrom: "20250101",
        dateTo: "20250331",
        businessCategory: "all",
        elapsedSeconds: 71,
      }),
    ).toEqual({
      title: "동기화 진행 중",
      elapsedLabel: "1분 11초",
      scopeLabel: "3개월 범위 계약정보 + 3자단가 품목 전체 스캔",
      phaseLabel: "사업자번호로 결과 필터링 중",
    });
  });

  it("describes third-party-only syncs separately", () => {
    expect(
      buildSyncProgressView({
        bizNo: "2048145651",
        dateFrom: "20250101",
        dateTo: "20251231",
        businessCategory: "shopping_third_party",
        elapsedSeconds: 4,
      }).scopeLabel,
    ).toBe("3자단가 품목 전체 스캔");
  });
});

describe("syncStatusMessage", () => {
  it("summarizes successful sync counts", () => {
    expect(
      syncStatusMessage({
        status: "completed",
        rowsMatched: 12,
        insertedCount: 11,
        updatedCount: 1,
        errorCount: 0,
      }),
    ).toBe("나라장터 동기화 완료: 매칭 12건, 신규 11건, 갱신 1건.");
  });

  it("includes error count for completed syncs with errors", () => {
    expect(
      syncStatusMessage({
        status: "completed_with_errors",
        rowsMatched: 12,
        insertedCount: 11,
        updatedCount: 1,
        errorCount: 2,
      }),
    ).toBe("나라장터 동기화 일부 완료(오류 2건): 매칭 12건, 신규 11건, 갱신 1건.");
  });

  it("uses a zero-match label for completed syncs without matched rows", () => {
    expect(
      syncStatusMessage({
        status: "completed",
        rowsMatched: 0,
        insertedCount: 0,
        updatedCount: 0,
        errorCount: 0,
      }),
    ).toBe("나라장터 동기화 완료: 매칭 계약 없음.");
  });

  it("uses a failed label with error count", () => {
    expect(
      syncStatusMessage({
        status: "failed",
        rowsMatched: 0,
        insertedCount: 0,
        updatedCount: 0,
        errorCount: 1,
      }),
    ).toBe("나라장터 동기화 실패: 오류 1건.");
  });
});
