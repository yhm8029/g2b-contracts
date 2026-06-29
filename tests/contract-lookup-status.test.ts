import { describe, expect, it } from "vitest";

import {
  apiStatusLabels,
  exportHrefForLastSearch,
  syncStatusMessage,
} from "@/components/ContractLookupApp";

describe("apiStatusLabels", () => {
  it("uses neutral labels before server health is available", () => {
    expect(apiStatusLabels(null)).toEqual({
      apiKey: "unknown",
      enrichment: "unknown",
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
      apiKey: "configured",
      enrichment: "disabled",
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
    ).toBe("G2B sync completed: matched 12, inserted 11, updated 1.");
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
    ).toBe("G2B sync completed with 2 errors: matched 12, inserted 11, updated 1.");
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
    ).toBe("G2B sync completed: no matching G2B contracts found.");
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
    ).toBe("G2B sync failed: 1 error.");
  });
});
