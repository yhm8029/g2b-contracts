import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  new URL("../src/components/ExcellentProductsApp.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/app/excellent-products/page.tsx", import.meta.url),
  "utf8",
);
const homeSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("building-control excellent-products frontend behavior", () => {
  it("does not fetch on render and fetches only after the lookup click", () => {
    expect(componentSource).toContain('type LoadStatus = "idle" | "loading" | "loaded" | "error"');
    expect(componentSource).toContain("onClick={handleLookup}");
    expect(componentSource).toContain("fetch(EXCELLENT_PRODUCTS_ENDPOINT");
    expect(componentSource).not.toMatch(/useEffect\([\s\S]*?fetch\(EXCELLENT_PRODUCTS_ENDPOINT/s);
  });

  it("sorts copied client-side results with a designation tie-break", () => {
    expect(componentSource).toContain("[...items]");
    expect(componentSource).toContain("designationNo");
    expect(componentSource).toContain("localeCompare");
    expect(componentSource).toContain("sortBuildingControlProducts");
  });

  it("keeps CSV disabled until loaded and disables duplicate sync clicks", () => {
    expect(componentSource).toMatch(/syncLoading|isSyncing/);
    expect(componentSource).toContain("disabled={isBusy}");
    expect(componentSource).toContain("resultsLoaded");
    expect(componentSource).toContain("최신 정보 갱신");
  });

  it("sequences lookup and sync/reload requests so stale results cannot win", () => {
    expect(componentSource).toContain("requestGeneration");
    expect(componentSource).toContain("generation !== requestGeneration.current");
    expect(componentSource).toContain("await result.json()");
    expect(componentSource).toContain("deriveExcellentProductsSyncWarning");
    expect(componentSource).toContain("await loadProducts");
  });

  it("keeps the existing contract lookup on the home page and links to the dedicated page", () => {
    expect(homeSource).toContain("ContractLookupApp");
    expect(homeSource).toContain("/excellent-products");
    expect(pageSource).toContain("ExcellentProductsApp");
  });

  it("provides a scrollable responsive sixteen-column table", () => {
    expect(cssSource).toMatch(/\.excellent-products-table-frame\s*{[^}]*overflow-x:\s*auto/s);
    expect(cssSource).toMatch(/\.excellent-products-table\s*{[^}]*min-width:\s*1600px/s);
  });
});
