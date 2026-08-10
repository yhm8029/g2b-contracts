import { describe, expect, it } from "vitest";
import {
  TARGET_PRODUCT_CLASSIFICATION_PREFIX,
  isTargetProductClassification,
  normalizeProductClassificationNo,
  parseExcellentProductsCsv,
} from "@/lib/excellent-products/csv";
import type { ExcellentProductCsvParseResult } from "@/lib/excellent-products/types";
import { EXCELLENT_PRODUCTS_SOURCE_DATASET } from "@/lib/excellent-products/constants";

const OFFICIAL_HEADERS = [
  "물품규격내용",
  "물품분류",
  "업체대표자명",
  "업체명",
  "업체사업자번호",
  "업체전화번호",
  "업체주소",
  "우수조달지정요청분야",
  "우수조달지정증서번호",
  "인증내역",
  "제제유형",
  "지정시작일자",
  "지정연장일자",
] as const;

function buildOfficialHeaderRow(): string {
  return OFFICIAL_HEADERS.join(",");
}

function buildBaseRow(overrides: Partial<Record<(typeof OFFICIAL_HEADERS)[number], string>>): string {
  const defaults: Record<(typeof OFFICIAL_HEADERS)[number], string> = {
    물품규격내용: "표준규격",
    물품분류: "39121801-01 빌딩자동제어장치",
    업체대표자명: "홍길동",
    업체명: "스마트빌딩",
    업체사업자번호: "123-45-67890",
    업체전화번호: "02-1234-5678",
    업체주소: "서울특별시 강남구 테헤란로 123",
    우수조달지정요청분야: "빌딩자동제어장치",
    우수조달지정증서번호: "EQ-2024-001",
    인증내역: "K마크",
    제제유형: "없음",
    지정시작일자: "2024-01-15",
    지정연장일자: "2026-01-14",
  };

  const merged = { ...defaults, ...overrides };
  return OFFICIAL_HEADERS.map((header) => {
    const value = merged[header] ?? "";
    return value.includes(",") || value.includes('"') || value.includes("\n")
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  }).join(",");
}

function buildTargetRow(index: number, suffix: string): string {
  return buildBaseRow({
    물품규격내용: `규격-${index}`,
    업체사업자번호: `123-45-6789${suffix}`,
    우수조달지정증서번호: `EQ-2024-${String(index).padStart(3, "0")}`,
    업체명: `회사${index}`,
  });
}

function buildNonTargetRow(): string {
  return buildBaseRow({
    물품분류: "44103103 네트워크장비",
    업체사업자번호: "999-88-77777",
    우수조달지정증서번호: "EQ-OTHER-001",
    업체명: "비대상회사",
  });
}

function buildHundredRowCsv(): string {
  const lines: string[] = [buildOfficialHeaderRow()];
  // 4 target rows (indices 10, 25, 50, 75)
  lines.push(buildTargetRow(10, "0"));
  lines.push(buildTargetRow(25, "1"));
  lines.push(buildTargetRow(50, "2"));
  lines.push(buildTargetRow(75, "3"));
  for (let i = 0; i < 96; i += 1) {
    // Generate unique valid 10-digit business numbers for the non-target rows.
    const digits = String(7000000000 + i).padStart(10, "0");
    const bizNo = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    lines.push(buildNonTargetRow().replace("999-88-77777", bizNo));
  }
  return lines.join("\n");
}

describe("constants and normalization", () => {
  it("exposes the fixed target prefix constant", () => {
    expect(TARGET_PRODUCT_CLASSIFICATION_PREFIX).toBe("39121801");
  });

  it("normalizes classification numbers by stripping non-digits", () => {
    expect(normalizeProductClassificationNo("39121801-01")).toBe("3912180101");
    expect(normalizeProductClassificationNo(" 39121,801 ")).toBe("39121801");
    expect(normalizeProductClassificationNo(44103103)).toBe("44103103");
  });

  it("returns empty string for non-string or empty values", () => {
    expect(normalizeProductClassificationNo(null)).toBe("");
    expect(normalizeProductClassificationNo(undefined)).toBe("");
    expect(normalizeProductClassificationNo("")).toBe("");
  });

  it("matches the target prefix variant set", () => {
    expect(isTargetProductClassification("39121801")).toBe(true);
    expect(isTargetProductClassification("3912180101")).toBe(true);
    expect(isTargetProductClassification("39121801-01")).toBe(true);
    expect(isTargetProductClassification("3912180102")).toBe(true);
  });

  it("rejects other classification numbers", () => {
    expect(isTargetProductClassification("44103103")).toBe(false);
    expect(isTargetProductClassification("3912180")).toBe(false);
    expect(isTargetProductClassification("")).toBe(false);
    expect(isTargetProductClassification(null)).toBe(false);
  });
});

describe("parseExcellentProductsCsv - header validation", () => {
  it("rejects missing required headers", () => {
    const csv = ["업체명,업체사업자번호", "스마트빌딩,123-45-67890"].join("\n");
    const result = parseExcellentProductsCsv(csv, "missing.csv");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toMatch(/Missing required CSV headers/);
  });

  it("rejects duplicate headers", () => {
    const csv = [
      `물품규격내용,물품분류,업체대표자명,업체명,업체사업자번호,업체전화번호,업체주소,우수조달지정요청분야,우수조달지정증서번호,인증내역,제제유형,지정시작일자,지정연장일자,업체명`,
      "x,39121801,x,Smart,1234567890,02,x,item,EQ-1,,,2024-01-15,2026-01-14,x",
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "dup.csv");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toMatch(/Duplicate CSV headers/);
    expect(result.errors[0]).toContain("업체명");
  });

  it("returns an empty-result error for empty CSV", () => {
    const result = parseExcellentProductsCsv("   \n\n", "empty.csv");
    expect(result.rows).toEqual([]);
    expect(result.errors).toContain("CSV file is empty.");
  });
});

describe("parseExcellentProductsCsv - alias header mapping", () => {
  it("maps alias headers to logical fields", () => {
    const aliases = [
      "규격",
      "물품분류",
      "대표자명",
      "상호명",
      "사업자등록번호",
      "전화번호",
      "주소",
      "품명",
      "지정번호",
      "인증내역",
      "제제유형",
      "발급일자",
      "인정(연장)기간",
    ];

    const row = [
      "표준규격",
      "39121801-01 빌딩자동제어장치",
      "홍길동",
      "스마트빌딩",
      "123-45-67890",
      "02-1234-5678",
      "서울특별시 강남구 테헤란로 123",
      "빌딩자동제어장치",
      "EQ-2024-001",
      "K마크",
      "없음",
      "2024-01-15",
      "2026-01-14",
    ];

    const csv = [aliases.join(","), row.join(",")].join("\n");
    const result = parseExcellentProductsCsv(csv, "alias.csv");

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      designationNo: "EQ-2024-001",
      bizNoNormalized: "1234567890",
      companyNameCsv: "스마트빌딩",
      representativeNameCsv: "홍길동",
      phoneCsv: "02-1234-5678",
      addressCsv: "서울특별시 강남구 테헤란로 123",
      productName: "빌딩자동제어장치",
      productSpec: "표준규격",
      productClassificationNo: "39121801-01",
      productClassificationNormalized: "3912180101",
      productClassificationName: "빌딩자동제어장치",
      sanctionType: "없음",
    });
  });

  it("maps separate 물품분류번호 and 물품분류명 columns", () => {
    const headers = [
      "물품규격내용",
      "물품분류번호",
      "물품분류명",
      "업체대표자명",
      "업체명",
      "업체사업자번호",
      "업체전화번호",
      "업체주소",
      "우수조달지정요청분야",
      "우수조달지정증서번호",
      "인증내역",
      "제제유형",
      "지정시작일자",
      "지정연장일자",
    ];
    const row = [
      "표준규격",
      "39121801",
      "빌딩자동제어장치",
      "홍길동",
      "스마트빌딩",
      "123-45-67890",
      "02-1234-5678",
      "서울특별시 강남구",
      "빌딩자동제어장치",
      "EQ-2024-001",
      "K마크",
      "없음",
      "2024-01-15",
      "2026-01-14",
    ];
    const csv = [headers.join(","), row.join(",")].join("\n");
    const result = parseExcellentProductsCsv(csv, "split.csv");

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      productClassificationNo: "39121801",
      productClassificationNormalized: "39121801",
      productClassificationName: "빌딩자동제어장치",
    });
  });

  it("maps 규격모델 alias to productSpec", () => {
    const aliases = [
      "규격모델",
      "물품분류",
      "업체대표자명",
      "업체명",
      "업체사업자번호",
      "업체전화번호",
      "업체주소",
      "우수조달지정요청분야",
      "우수조달지정증서번호",
      "인증내역",
      "제제유형",
      "지정시작일자",
      "지정연장일자",
    ];
    const row = [
      "BAC-A100",
      "39121801-01 빌딩자동제어장치",
      "홍길동",
      "스마트빌딩",
      "123-45-67890",
      "02-1234-5678",
      "서울",
      "빌딩자동제어장치",
      "EQ-2024-001",
      "K마크",
      "없음",
      "2024-01-15",
      "2026-01-14",
    ];
    const csv = [aliases.join(","), row.join(",")].join("\n");
    const result = parseExcellentProductsCsv(csv, "alias-spec.csv");

    expect(result.errors).toEqual([]);
    expect(result.rows[0].productSpec).toBe("BAC-A100");
  });
});

describe("parseExcellentProductsCsv - row filtering and target matching", () => {
  it("stores only target rows and skips non-target rows", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildTargetRow(1, "0"),
      buildNonTargetRow(),
      buildTargetRow(2, "1"),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "mixed.csv");

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.designationNo).sort()).toEqual([
      "EQ-2024-001",
      "EQ-2024-002",
    ]);
    expect(result.totalRowCount).toBe(3);
    expect(result.skippedCount).toBe(1);
  });

  it("processes 100 rows and only keeps target matches", () => {
    const csv = buildHundredRowCsv();
    const result = parseExcellentProductsCsv(csv, "hundred.csv");

    expect(result.totalRowCount).toBe(100);
    expect(result.rows).toHaveLength(4);
    expect(result.skippedCount).toBe(96);
    expect(result.rows.every((r) => r.productClassificationNormalized.startsWith("39121801"))).toBe(true);
  });

  it("skips duplicate rows based on stable source hash", () => {
    const row = buildTargetRow(7, "7");
    const csv = [
      buildOfficialHeaderRow(),
      row,
      row,
      row,
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "dup-rows.csv");

    expect(result.rows).toHaveLength(1);
    expect(result.totalRowCount).toBe(3);
    expect(result.skippedCount).toBe(2);
  });
});

describe("parseExcellentProductsCsv - quoted fields and BOM", () => {
  it("preserves quoted CSV with commas, doubles quotes, and CR/LF inside certification", () => {
    const headers = buildOfficialHeaderRow();
    const row = [
      "표준규격",
      "39121801-01 빌딩자동제어장치",
      "홍길동",
      "스마트빌딩",
      "123-45-67890",
      "02-1234-5678",
      "서울",
      "빌딩자동제어장치",
      "EQ-2024-001",
      `K마크,"A"\r\nGS,특허`,
      "없음",
      "2024-01-15",
      "2026-01-14",
    ];

    const certColumn = `"${row[9].replace(/"/g, '""')}"`;
    const rebuilt = [headers, row.map((v, i) => (i === 9 ? certColumn : v)).join(",")].join("\n");

    const result = parseExcellentProductsCsv("\uFEFF" + rebuilt, "quoted.csv");

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].certificationDetailsRaw).toBe('K마크,"A"\r\nGS,특허');
    expect(result.rows[0].rawData["인증내역"]).toBe('K마크,"A"\r\nGS,특허');
  });

  it("maps blank optional fields to null and trims", () => {
    const csv = [
      buildOfficialHeaderRow(),
      [
        "표준규격",
        "39121801-01 빌딩자동제어장치",
        "",
        "스마트빌딩",
        "123-45-67890",
        "  ",
        "  ",
        "빌딩자동제어장치",
        "EQ-2024-001",
        "",
        "  ",
        "2024-01-15",
        "2026-01-14",
      ].join(","),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "blanks.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      representativeNameCsv: null,
      phoneCsv: null,
      addressCsv: null,
      certificationDetailsRaw: null,
      sanctionType: null,
    });
  });

  it("rejects rows with column-count mismatches including physical row number", () => {
    const csv = [
      buildOfficialHeaderRow(),
      "표준규격,39121801-01,홍길동,스마트빌딩,123-45-67890,02-1234-5678,서울,품명,EQ-2024-001,,,2024-01-15",
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "short.csv");

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Row 2: Expected 13 columns but found 12\./);
  });

  it("reports the physical start row of a malformed second row when followed by a trailing newline", () => {
    const csv = [
      buildOfficialHeaderRow(),
      "표준규격,39121801-01,홍길동,스마트빌딩,123-45-67890,02-1234-5678,서울,품명,EQ-2024-001,,,2024-01-15",
      "",
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "short-trailing.csv");

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Row 2: Expected 13 columns but found 12\./);
  });

  it("reports the physical start row of a malformed row that follows a blank physical line", () => {
    const csv = [
      buildOfficialHeaderRow(),
      "",
      "표준규격,39121801-01,홍길동,스마트빌딩,123-45-67890,02-1234-5678,서울,품명,EQ-2024-001,,,2024-01-15",
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "short-blank-prefix.csv");

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Row 3: Expected 13 columns but found 12\./);
  });

  it("reports the correct physical line for errors after a multi-line quoted field", () => {
    const headers = buildOfficialHeaderRow();
    const goodRow = [
      "표준규격",
      "39121801-01 빌딩자동제어장치",
      "홍길동",
      "스마트빌딩",
      "123-45-67890",
      "02-1234-5678",
      "서울",
      "빌딩자동제어장치",
      "EQ-2024-001",
      "K마크\n상세",
      "없음",
      "2024-01-15",
      "2026-01-14",
    ];
    const certColumn = `"${goodRow[9].replace(/"/g, '""')}"`;
    const goodRowStr = goodRow
      .map((v, i) => (i === 9 ? certColumn : v))
      .join(",");

    const badRow =
      "표준규격,39121801-01,홍길동,스마트빌딩,123-45-67890,02-1234-5678,서울,품명,EQ-2024-002,,,2024-01-15";

    const csv = [headers, goodRowStr, badRow].join("\n");

    const result = parseExcellentProductsCsv(csv, "multiline.csv");

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Row 4: Expected 13 columns but found 12\./);
  });

  it("preserves exact leading/trailing whitespace and line breaks in certificationDetailsRaw", () => {
    const headers = buildOfficialHeaderRow();
    const row = [
      "표준규격",
      "39121801-01 빌딩자동제어장치",
      "홍길동",
      "스마트빌딩",
      "123-45-67890",
      "02-1234-5678",
      "서울",
      "빌딩자동제어장치",
      "EQ-2024-001",
      "  K마크\n상세  ",
      "없음",
      "2024-01-15",
      "2026-01-14",
    ];
    const certColumn = `"${row[9].replace(/"/g, '""')}"`;
    const rebuilt = [
      headers,
      row.map((v, i) => (i === 9 ? certColumn : v)).join(","),
    ].join("\n");

    const result = parseExcellentProductsCsv(rebuilt, "cert-ws.csv");

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].certificationDetailsRaw).toBe("  K마크\n상세  ");
  });

  it("returns null for certificationDetailsRaw when the unquoted value is all whitespace", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        우수조달지정증서번호: "EQ-CERT-BLANK-001",
        인증내역: "   \n  ",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "cert-blank.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].certificationDetailsRaw).toBe(null);
  });

  it("returns a clear parse error for an unclosed quoted field", () => {
    const csv = [
      buildOfficialHeaderRow(),
      '"표준규격,39121801-01,홍길동,스마트빌딩,123-45-67890,02-1234-5678,서울,품명,EQ-2024-001,K마크,특허,2024-01-15,2026-01-14',
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "unclosed.csv");

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Unterminated quoted field/);
  });
});

describe("parseExcellentProductsCsv - business number and date normalization", () => {
  it("rejects invalid business numbers and reports row number", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        업체사업자번호: "12-345",
        우수조달지정증서번호: "EQ-BAD-001",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "bad-biz.csv");

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      "Row 2: Business registration number must contain 10 digits.",
    ]);
  });

  it("normalizes valid YYYYMMDD / YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD dates", () => {
    const variants: Array<{ start: string; end: string }> = [
      { start: "20240115", end: "2026-01-14" },
      { start: "2024-01-15", end: "2026.01.14" },
      { start: "2024.01.15", end: "2026/01/14" },
      { start: "2024/01/15", end: "20260114" },
    ];

    const lines = [buildOfficialHeaderRow()];
    variants.forEach((v, i) => {
      lines.push(
        buildBaseRow({
          업체사업자번호: `123-45-6789${i}`,
          우수조달지정증서번호: `EQ-DATE-${i}`,
          지정시작일자: v.start,
          지정연장일자: v.end,
        }),
      );
    });

    const result = parseExcellentProductsCsv(lines.join("\n"), "dates.csv");

    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((r) => r.designationStartDate).sort()).toEqual([
      "2024-01-15",
      "2024-01-15",
      "2024-01-15",
      "2024-01-15",
    ]);
    expect(result.rows.map((r) => r.designationEndDate).sort()).toEqual([
      "2026-01-14",
      "2026-01-14",
      "2026-01-14",
      "2026-01-14",
    ]);
    expect(result.errors).toEqual([]);
  });

  it("retains invalid non-blank dates as raw", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        업체사업자번호: "123-45-67890",
        우수조달지정증서번호: "EQ-DATE-BAD-001",
        지정시작일자: "2024-13-15",
        지정연장일자: "not-a-date",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "bad-dates.csv");

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].designationStartDate).toBe("2024-13-15");
    expect(result.rows[0].designationEndDate).toBe("not-a-date");
  });
});

describe("parseExcellentProductsCsv - row metadata", () => {
  it("populates source metadata, rawData, and a stable sourceRowHash", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildTargetRow(42, "0"),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "metadata.csv");
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.sourceDataset).toBe(EXCELLENT_PRODUCTS_SOURCE_DATASET);
    expect(row.sourceFileName).toBe("metadata.csv");
    expect(typeof row.sourceImportedAt).toBe("string");
    expect(new Date(row.sourceImportedAt).toString()).not.toBe("Invalid Date");

    expect(row.sourceRowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rawData["업체명"]).toBe("회사42");
    expect(row.rawData["업체사업자번호"]).toBe("123-45-67890");
    expect(row.rawData["우수조달지정증서번호"]).toBe("EQ-2024-042");

    // Stable hash: identical input => identical hash
    const second = parseExcellentProductsCsv(csv, "metadata.csv");
    expect(second.rows[0].sourceRowHash).toBe(row.sourceRowHash);
  });
});

describe("parseExcellentProductsCsv - combined classification parsing", () => {
  it("extracts raw code token from combined classification cell", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        물품분류: " 39121801-01 : 빌딩자동제어장치 ",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "combined.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productClassificationNo).toBe("39121801-01");
    expect(result.rows[0].productClassificationNormalized).toBe("3912180101");
    expect(result.rows[0].productClassificationName).toBe("빌딩자동제어장치");
  });

  it("extracts 8-digit classification code when the name contains 모델20", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        물품분류: "39121801 빌딩자동제어장치 모델20",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "model20.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productClassificationNo).toBe("39121801");
    expect(result.rows[0].productClassificationNormalized).toBe("39121801");
    expect(result.rows[0].productClassificationName).toBe("빌딩자동제어장치 모델20");
  });

  it("extracts 39121801-01 from a classification cell with 모델20 in the name", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        물품분류: "39121801-01 빌딩자동제어장치 모델20",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "model20b.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productClassificationNo).toBe("39121801-01");
    expect(result.rows[0].productClassificationNormalized).toBe("3912180101");
    expect(result.rows[0].productClassificationName).toBe("빌딩자동제어장치 모델20");
  });

  it("accepts 3912180101 (10 digits, no separator) with name digits later in the cell", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        물품분류: "3912180101 빌딩자동제어장치 모델20",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "model20c.csv");
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productClassificationNo).toBe("3912180101");
    expect(result.rows[0].productClassificationNormalized).toBe("3912180101");
    expect(result.rows[0].productClassificationName).toBe("빌딩자동제어장치 모델20");
  });

  it("accepts 3912180101 (no separator) without any name suffix", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        물품분류: "3912180101",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "plain10.csv");
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productClassificationNo).toBe("3912180101");
    expect(result.rows[0].productClassificationNormalized).toBe("3912180101");
    // No name text appears in the cell, so the derived name is null.
    expect(result.rows[0].productClassificationName).toBe(null);
  });

  it("errors when a row has no classification code", () => {
    const csv = [
      buildOfficialHeaderRow(),
      buildBaseRow({
        물품분류: "알수없음",
        우수조달지정증서번호: "EQ-NOCLS-001",
      }),
    ].join("\n");

    const result = parseExcellentProductsCsv(csv, "no-class.csv");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      "Row 2: Missing product classification number.",
    ]);
  });
});

describe("parseExcellentProductsCsv - result shape", () => {
  it("returns the documented result shape", () => {
    const result: ExcellentProductCsvParseResult = parseExcellentProductsCsv(
      [buildOfficialHeaderRow()].join("\n"),
      "shape.csv",
    );
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("totalRowCount");
    expect(result).toHaveProperty("skippedCount");
    expect(Array.isArray(result.rows)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.totalRowCount).toBe(0);
    expect(result.skippedCount).toBe(0);
  });
});
