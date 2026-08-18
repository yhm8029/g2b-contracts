import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  new URL("../src/components/CompetitorSalesApp.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("competitor sales loading state", () => {
  it("clears stale overview and disclosure before starting each selection request", () => {
    const effectStart = componentSource.indexOf("useEffect(() => {");
    const requestStart = componentSource.indexOf("void loadOverview(selection", effectStart);
    const loadingSetup = componentSource.slice(effectStart, requestStart);

    expect(loadingSetup).toContain("setOverview(null);");
    expect(loadingSetup).toContain("setOpenCompanyId(null);");
    expect(componentSource).toContain("Array.from({ length: 22 }");
    expect(componentSource).toMatch(
      /function CompanySkeleton[\s\S]*?<article[\s\S]*?<span \/><span \/><span \/><span \/><span \/>/,
    );
    expect(cssSource).toMatch(
      /\.competitor-sales-skeleton span:last-child\s*{[^}]*width:\s*36px/s,
    );
  });

  it("shows cached results first and fetches the complete result only when cache coverage is incomplete", () => {
    expect(componentSource).toMatch(
      /loadOverview\(selection, controller\.signal, \{ cacheOnly: true \}\)[\s\S]*?setOverview\(cachedOverview\)/,
    );
    expect(componentSource).toMatch(/if \(cachedOverview\.coverage\.complete && cachedOverview\.coverage\.fresh\) \{/);
    expect(componentSource).toMatch(
      /loadOverview\(selection, controller\.signal\)[\s\S]*?setOverview\(completeOverview\)/,
    );
    expect(componentSource).toContain("cacheCollectionStatus(overview?.coverage)");
    expect(componentSource).toContain('label={partialCache ? "저장된 결과 기준 계약금액" : "전체 계약금액"}');
  });
});

describe("competitor sales Excel export control", () => {
  it("renders an active export as a link and an incomplete export as a focusable disabled button", () => {
    expect(componentSource).toContain('import { ChevronDown, Download, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";');
    expect(componentSource).toContain("const exportHref = canExportCompetitorOverview(overview, isLoading, selection)");
    expect(componentSource).toContain("buildCompetitorExportUrl(selection)");
    expect(componentSource).toMatch(/exportHref \? \([\s\S]*?<a[\s\S]*?href=\{exportHref\}[\s\S]*?aria-label=\{exportLabel\}[\s\S]*?title=\{exportLabel\}/);
    expect(componentSource).toMatch(/: \([\s\S]*?<button[\s\S]*?aria-disabled="true"[\s\S]*?aria-label=\{exportLabel\}[\s\S]*?title=\{exportLabel\}[\s\S]*?type="button"/);
    const disabledExportButton = componentSource.match(/<button\b(?=[^>]*\bclassName="competitor-sales-export is-disabled")[^>]*>/)?.[0];
    expect(disabledExportButton).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });

  it("explains why the disabled export command cannot be used", () => {
    expect(componentSource).toContain(
      'const exportLabel = exportHref ? "엑셀 내보내기" : "전체 집계 완료 후 엑셀을 내보낼 수 있습니다.";',
    );
    expect(componentSource).toMatch(/<a[\s\S]*?aria-label=\{exportLabel\}[\s\S]*?title=\{exportLabel\}/);
  });

  it("keeps the export command compact and non-overflowing on mobile", () => {
    expect(cssSource).toMatch(/\.competitor-sales-export\s*\{[\s\S]*?appearance:\s*none[\s\S]*?font:\s*inherit[\s\S]*?min-height:\s*28px/);
    const mobileRules = cssSource.slice(cssSource.indexOf("@media (max-width: 720px)"));
    expect(mobileRules).toMatch(/\.competitor-sales-export\s*\{[\s\S]*?max-width:\s*100%/);
  });
});

describe("competitor sales mobile layout", () => {
  it("keeps every company metric visible without page-level horizontal overflow", () => {
    const mobileRules = cssSource.slice(cssSource.indexOf("@media (max-width: 720px)"));

    expect(mobileRules).not.toMatch(/competitor-sales-company-metric[^}]*display:\s*none/s);
    expect(mobileRules).toMatch(
      /competitor-sales-company-toggle[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.45fr\)\s+minmax\(0,\s*0\.55fr\)\s+minmax\(0,\s*1fr\)\s+auto/,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-company-name\s*{[^}]*grid-column:\s*1\s*\/\s*4[^}]*grid-row:\s*1/s,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-company-metric\s*{[^}]*grid-row:\s*2/s,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-company-metric:nth-of-type\(2\)\s*{[^}]*grid-column:\s*1[^}]*overflow:\s*hidden/s,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-company-metric:nth-of-type\(3\)\s*{[^}]*grid-column:\s*2/s,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-company-metric:nth-of-type\(4\)\s*{[^}]*grid-column:\s*3/s,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-view\s*{[^}]*grid-column:\s*4[^}]*grid-row:\s*1/s,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-company-name strong,[\s\S]*?\.competitor-sales-company-metric strong\s*{[^}]*font-size:\s*0\.74rem/s,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-company-metric small\s*{[^}]*font-size:\s*0\.65rem/s,
    );
    expect(mobileRules).toMatch(
      /\.competitor-sales-company-metric:nth-of-type\(2\) strong\s*{[^}]*white-space:\s*nowrap/s,
    );
    expect(cssSource).toMatch(/\.competitor-sales-page\s*{[^}]*overflow-x:\s*clip/s);
    expect(cssSource).toMatch(
      /\.competitor-sales-contract-wrap\s*{[^}]*overflow-x:\s*auto/s,
    );
  });
});
