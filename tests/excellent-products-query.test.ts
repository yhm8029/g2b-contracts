import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import {
  businesses,
  companyIndustries,
  excellentProducts,
  factoryLocations,
} from "@/lib/db/schema";
import {
  EXCELLENT_PRODUCTS_API_SOURCE_NAME,
  EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
  EXCELLENT_PRODUCTS_SOURCE_DATASET,
  TARGET_PRODUCT_CLASSIFICATION_PREFIX,
} from "@/lib/excellent-products/constants";
import { getBuildingControlExcellentProducts } from "@/lib/excellent-products/repository";

type ProductSeed = {
  bizNoNormalized?: string;
  designationNo?: string;
  companyNameCsv?: string;
  representativeNameCsv?: string | null;
  phoneCsv?: string | null;
  addressCsv?: string | null;
  productName?: string;
  productSpec?: string | null;
  productClassificationNo?: string;
  productClassificationNormalized?: string;
  productClassificationName?: string | null;
  designationStartDate?: string | null;
  designationEndDate?: string | null;
  certificationDetailsRaw?: string | null;
  sourceRowHash?: string;
  sourceDataset?: string;
};

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "g2b-excellent-products-query-"));
  const connection = createDb(join(dir, "query.sqlite"));
  initializeSqliteSchema(connection.sqlite);
  return connection;
}

/** Keep an explicit `null` override distinct from an omitted field. */
function orDefault<T>(value: T | null | undefined, fallback: T | null): T | null {
  return value === undefined ? fallback : value;
}

let hashCounter = 0;

function seedProduct(db: ReturnType<typeof createTempDb>["db"], seed: ProductSeed = {}) {
  hashCounter += 1;
  db.insert(excellentProducts)
    .values({
      bizNoNormalized: seed.bizNoNormalized ?? "1234567890",
      designationNo: seed.designationNo ?? "EQ-2024-001",
      companyNameCsv: seed.companyNameCsv ?? "스마트빌딩",
      representativeNameCsv: orDefault(seed.representativeNameCsv, "홍길동"),
      phoneCsv: orDefault(seed.phoneCsv, "02-1234-5678"),
      addressCsv: orDefault(seed.addressCsv, "서울특별시 강남구 테헤란로 123"),
      productName: seed.productName ?? "빌딩자동제어장치",
      productSpec: orDefault(seed.productSpec, "BCU-100"),
      productClassificationNo: seed.productClassificationNo ?? "39121801-01",
      productClassificationNormalized: seed.productClassificationNormalized ?? "3912180101",
      productClassificationName: orDefault(seed.productClassificationName, "빌딩자동제어장치"),
      designationStartDate: orDefault(seed.designationStartDate, "2024-01-15"),
      designationEndDate: orDefault(seed.designationEndDate, "2027-01-14"),
      certificationDetailsRaw: orDefault(seed.certificationDetailsRaw, "K마크"),
      sanctionType: null,
      sourceDataset: seed.sourceDataset ?? EXCELLENT_PRODUCTS_SOURCE_DATASET,
      sourceRowHash: seed.sourceRowHash ?? `hash-${hashCounter}`,
      sourceFileName: "test.csv",
      sourceImportedAt: "2026-08-10T00:00:00.000Z",
      rawJson: "{}",
    })
    .run();
}

function seedFactory(
  db: ReturnType<typeof createTempDb>["db"],
  bizNoNormalized: string,
  location: string,
  source = "shopping-mall",
) {
  db.insert(factoryLocations)
    .values({ bizNoNormalized, location, source })
    .run();
}

function seedIndustry(
  db: ReturnType<typeof createTempDb>["db"],
  bizNoNormalized: string,
  industryCode: string,
  industryName: string,
  source = "user-info",
) {
  db.insert(companyIndustries)
    .values({ bizNoNormalized, industryCode, industryName, status: "정상", source })
    .run();
}

describe("getBuildingControlExcellentProducts", () => {
  it("keeps every designation as its own item and counts companies and designations", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, { designationNo: "EQ-2024-002", productSpec: "BCU-200" });
    seedProduct(db, { designationNo: "EQ-2024-001", productSpec: "BCU-100" });
    seedProduct(db, {
      bizNoNormalized: "2233445566",
      designationNo: "EQ-2024-003",
      companyNameCsv: "제어기술",
    });

    const result = getBuildingControlExcellentProducts(db);

    expect(result.classification).toBe(TARGET_PRODUCT_CLASSIFICATION_PREFIX);
    expect(result.items).toHaveLength(3);
    expect(result.designationCount).toBe(3);
    expect(result.companyCount).toBe(2);
    expect(result.items.map((item) => item.designationNo)).toEqual([
      "EQ-2024-001",
      "EQ-2024-002",
      "EQ-2024-003",
    ]);

    sqlite.close();
  });

  it("deduplicates child rows and never multiplies products by factories or industries", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, { designationNo: "EQ-2024-001" });
    seedProduct(db, { designationNo: "EQ-2024-002", productSpec: "BCU-200" });

    seedFactory(db, "1234567890", "경기도 화성시 공장로 10");
    seedFactory(db, "1234567890", "경기도 화성시 공장로 10", "user-info");
    seedFactory(db, "1234567890", "충청북도 청주시 산단로 5");

    seedIndustry(db, "1234567890", "C2811", "전동기 제조업");
    seedIndustry(db, "1234567890", "C2811", "전동기 제조업", "shopping-mall");
    seedIndustry(db, "1234567890", "F4211", "전기 공사업");

    const result = getBuildingControlExcellentProducts(db);

    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.factoryLocations).toEqual([
        "경기도 화성시 공장로 10",
        "충청북도 청주시 산단로 5",
      ]);
      expect(item.industries).toEqual(["전기 공사업", "전동기 제조업"]);
    }

    sqlite.close();
  });

  it("never leaks an unrelated classification even when inserted manually", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, { designationNo: "EQ-2024-001" });
    seedProduct(db, {
      bizNoNormalized: "9988776655",
      designationNo: "EQ-2024-999",
      companyNameCsv: "무관업체",
      productClassificationNo: "44103103",
      productClassificationNormalized: "44103103",
      productClassificationName: "복사기",
    });
    // A normalized value can be tampered with independently of the raw token.
    seedProduct(db, {
      bizNoNormalized: "9988776655",
      designationNo: "EQ-2024-998",
      companyNameCsv: "무관업체",
      productClassificationNo: "44103103",
      productClassificationNormalized: "3912180101",
    });

    const result = getBuildingControlExcellentProducts(db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].designationNo).toBe("EQ-2024-001");
    expect(result.companyCount).toBe(1);
    expect(result.designationCount).toBe(1);

    sqlite.close();
  });

  it("prefers the managed business profile over the CSV fallback", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, { designationNo: "EQ-2024-001" });
    db.insert(businesses)
      .values({
        bizNoNormalized: "1234567890",
        bizNoDisplay: "1234567890",
        businessName: "주식회사 스마트빌딩",
        representativeName: "김대표",
        address: "서울특별시 서초구 API로 1",
        phone: "02-9999-0000",
        profileSource: EXCELLENT_PRODUCTS_API_SOURCE_NAME,
        lastSyncedAt: "2026-08-10T00:00:00.000Z",
      })
      .run();

    const [item] = getBuildingControlExcellentProducts(db).items;

    expect(item.companyName).toBe("주식회사 스마트빌딩");
    expect(item.representativeName).toBe("김대표");
    expect(item.address).toBe("서울특별시 서초구 API로 1");
    expect(item.phone).toBe("02-9999-0000");

    sqlite.close();
  });

  it("falls back to the exact CSV values for fields the profile does not provide", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, { designationNo: "EQ-2024-001" });
    db.insert(businesses)
      .values({
        bizNoNormalized: "1234567890",
        bizNoDisplay: "1234567890",
        businessName: "주식회사 스마트빌딩",
        representativeName: null,
        address: null,
        phone: null,
        profileSource: EXCELLENT_PRODUCTS_IMPORT_SOURCE_NAME,
      })
      .run();

    const [item] = getBuildingControlExcellentProducts(db).items;

    expect(item.companyName).toBe("주식회사 스마트빌딩");
    expect(item.representativeName).toBe("홍길동");
    expect(item.address).toBe("서울특별시 강남구 테헤란로 123");
    expect(item.phone).toBe("02-1234-5678");

    sqlite.close();
  });

  it("reports missing data as null instead of substituting another source", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, {
      designationNo: "EQ-2024-001",
      phoneCsv: null,
      addressCsv: null,
      representativeNameCsv: null,
    });

    const [item] = getBuildingControlExcellentProducts(db).items;

    expect(item.phone).toBeNull();
    expect(item.address).toBeNull();
    expect(item.representativeName).toBeNull();
    expect(item.factoryLocations).toEqual([]);
    expect(item.industries).toEqual([]);

    sqlite.close();
  });

  it("orders deterministically by designation number with stable tie-breaks", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, { designationNo: "EQ-2024-010", productSpec: "BCU-300" });
    seedProduct(db, { designationNo: "EQ-2024-010", productSpec: "BCU-100" });
    seedProduct(db, { designationNo: "EQ-2024-010", productSpec: "BCU-200" });
    seedProduct(db, { designationNo: "EQ-2024-002" });

    const result = getBuildingControlExcellentProducts(db);

    expect(result.items.map((item) => `${item.designationNo}/${item.productSpec}`)).toEqual([
      "EQ-2024-002/BCU-100",
      "EQ-2024-010/BCU-100",
      "EQ-2024-010/BCU-200",
      "EQ-2024-010/BCU-300",
    ]);
    expect(result.companyCount).toBe(1);
    expect(result.designationCount).toBe(4);

    sqlite.close();
  });

  it("attaches child rows only to the owning business", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, { designationNo: "EQ-2024-001" });
    seedProduct(db, {
      bizNoNormalized: "2233445566",
      designationNo: "EQ-2024-002",
      companyNameCsv: "제어기술",
    });

    seedFactory(db, "1234567890", "경기도 화성시 공장로 10");
    seedFactory(db, "2233445566", "부산광역시 사하구 공단로 7");
    seedFactory(db, "5555555555", "무관업체 공장");
    seedIndustry(db, "2233445566", "F4211", "전기 공사업");

    const items = getBuildingControlExcellentProducts(db).items;

    expect(items[0].factoryLocations).toEqual(["경기도 화성시 공장로 10"]);
    expect(items[0].industries).toEqual([]);
    expect(items[1].factoryLocations).toEqual(["부산광역시 사하구 공단로 7"]);
    expect(items[1].industries).toEqual(["전기 공사업"]);

    sqlite.close();
  });

  it("excludes target-prefixed rows whose source_dataset is not the excellent-products dataset", () => {
    const { db, sqlite } = createTempDb();

    seedProduct(db, { designationNo: "EQ-2024-001" });
    seedProduct(db, {
      bizNoNormalized: "5566778899",
      designationNo: "EQ-FOREIGN-001",
      companyNameCsv: "외부데이터회사",
      sourceDataset: "legacy-manual-import",
    });

    const result = getBuildingControlExcellentProducts(db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].designationNo).toBe("EQ-2024-001");
    expect(result.companyCount).toBe(1);
    expect(result.designationCount).toBe(1);

    sqlite.close();
  });
});
