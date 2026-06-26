import { describe, expect, it } from "vitest";

import { apiStatusLabels, exportHrefForLastSearch } from "@/components/ContractLookupApp";

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
