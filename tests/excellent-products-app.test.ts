import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildExcellentProductRowKey,
  deriveExcellentProductsSyncWarning,
  filterBuildingControlProducts,
  sortBuildingControlProducts,
} from "@/components/ExcellentProductsApp";

const componentSource = readFileSync(
  new URL("../src/components/ExcellentProductsApp.tsx", import.meta.url),
  "utf8",
);

const headers = [
  "No.",
  "지정번호",
  "품명",
  "발급일자",
  "인정(연장)기간",
  "상호명",
  "사업자등록번호",
  "대표자명",
  "전화번호",
  "주소",
  "물품분류번호",
  "물품분류명",
  "규격모델",
  "인증내역",
  "생산지 (공장소재지)",
  "면허 현황",
];

const item = (overrides: Partial<Parameters<typeof filterBuildingControlProducts>[0][number]>) => ({
  designationNo: "2",
  bizNoNormalized: "1234567890",
  companyName: "가나다",
  representativeName: null,
  phone: null,
  address: null,
  productName: "자동제어장치",
  productSpec: null,
  productClassificationNo: "39121801",
  productClassificationNormalized: "39121801",
  productClassificationName: "빌딩자동제어장치",
  designationStartDate: "2025-01-01",
  designationEndDate: "2028-01-01",
  certificationDetailsRaw: null,
  factoryLocations: [],
  industries: [],
  ...overrides,
});

describe("building-control excellent-products UI contract", () => {
  it("uses the fixed lookup purpose and has no classification input", () => {
    expect(componentSource).toContain("빌딩자동제어장치 조달우수업체 현황");
    expect(componentSource).toContain("39121801");
    expect(componentSource).toContain("조달우수업체 전체 조회");
    expect(componentSource).toContain("최신 정보 갱신");
    expect(componentSource).toContain("CSV 다운로드");
    expect(componentSource).toContain("companyCount");
    expect(componentSource).toContain("designationCount");
    expect(componentSource).not.toMatch(/name=["'](?:classification|productClassification)/i);
    expect(componentSource).not.toMatch(/물품분류번호[^<]*(?:input|select)/s);
  });

  it("declares the exact sixteen-column table order and sort controls", () => {
    const headerOrder = headers.map((header) => componentSource.indexOf(`"${header}"`));
    expect(headerOrder.every((index) => index >= 0)).toBe(true);
    expect(headerOrder).toEqual([...headerOrder].sort((left, right) => left - right));
    expect(componentSource).toContain("회사명으로 결과 필터");
    expect(componentSource).toContain("companyName");
    expect(componentSource).toContain("designationNo");
    expect(componentSource).toContain("designationStartDate");
    expect(componentSource).toContain("designationEndDate");
    expect(componentSource).toContain("sortBuildingControlProducts");
  });

  it("uses the dedicated endpoints and preserves explicit missing-data rendering", () => {
    expect(componentSource).toContain("/api/excellent-products/building-control");
    expect(componentSource).toContain("/api/excellent-products/building-control/sync");
    expect(componentSource).toContain("/api/excellent-products/building-control/export");
    expect(componentSource).toContain("전화번호 정보 없음");
    expect(componentSource).toContain("공장소재지 정보 없음");
    expect(componentSource).toContain("면허정보 없음");
    expect(componentSource).toContain("excellent-products-certification");
    expect(componentSource).toContain("factoryLocations");
    expect(componentSource).toContain("industries");
    expect(componentSource).toContain("?bizNo=");
  });

  it("filters only the displayed company name and sorts without mutating source items", () => {
    const source = [
      item({ companyName: "가나다", designationNo: "20" }),
      item({ companyName: "라마바", designationNo: "10" }),
      item({ companyName: "라마바", designationNo: "2" }),
    ];
    const filtered = filterBuildingControlProducts(source, "라마");
    expect(filtered).toHaveLength(2);
    expect(filterBuildingControlProducts(source, "1234567890")).toHaveLength(0);

    const sorted = sortBuildingControlProducts(source, "companyName");
    expect(sorted.map((entry) => entry.designationNo)).toEqual(["20", "2", "10"]);
    expect(source.map((entry) => entry.designationNo)).toEqual(["20", "10", "2"]);
  });

  it("uses bizNo/designation/classification/productSpec for stable unique React keys", () => {
    const shared = {
      designationNo: "EQ-2026-001",
      bizNoNormalized: "1234567890",
      productClassificationNo: "39121801-01",
      productClassificationNormalized: "3912180101",
    } as const;

    const left = item({ ...shared, productSpec: "BC-1" });
    const right = item({ ...shared, productSpec: "BC-2" });
    const fallback = item({ ...shared, productSpec: null });

    expect(buildExcellentProductRowKey(left)).not.toBe(buildExcellentProductRowKey(right));
    expect(buildExcellentProductRowKey(left)).not.toBe(buildExcellentProductRowKey(fallback));
    expect(buildExcellentProductRowKey(right)).not.toBe(buildExcellentProductRowKey(fallback));

    const leftCopy = { ...left };
    const rightCopy = { ...right };
    const fallbackCopy = { ...fallback };
    const keySet = new Set([buildExcellentProductRowKey(left), buildExcellentProductRowKey(right), buildExcellentProductRowKey(fallback)]);

    expect(keySet.size).toBe(3);
    expect(left).toEqual(leftCopy);
    expect(right).toEqual(rightCopy);
    expect(fallback).toEqual(fallbackCopy);
  });

  it("derives a generic count-only warning for partial sync results", () => {
    expect(deriveExcellentProductsSyncWarning({ errors: [] })).toBeNull();
    expect(deriveExcellentProductsSyncWarning({ errors: [{ message: "SECRET_API_KEY=do-not-show" }] }))
      .toContain("1");
    expect(deriveExcellentProductsSyncWarning({ errors: [{ message: "SECRET_API_KEY=do-not-show" }] }))
      .not.toContain("SECRET_API_KEY");
    expect(deriveExcellentProductsSyncWarning({ errors: [{}, {}, {}] }))
      .toContain("3");
  });
});
