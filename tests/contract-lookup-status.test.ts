import { describe, expect, it } from "vitest";

import { apiStatusLabels } from "@/components/ContractLookupApp";

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
