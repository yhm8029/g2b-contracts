import { describe, expect, it } from "vitest";

import { excellentProductsToCsv } from "@/lib/excellent-products/export";
import type { ExcellentProductViewItem } from "@/lib/excellent-products/types";

const EXPECTED_HEADERS = [
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

/** Minimal RFC 4180 reader used to verify the produced CSV independently. */
function parseCsvRecords(content: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === '"') {
      if (inQuotes && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && content[index + 1] === "\n") {
        index += 1;
      }
      fields.push(field);
      records.push(fields);
      fields = [];
      field = "";
      continue;
    }

    if (!inQuotes && character === ",") {
      fields.push(field);
      field = "";
      continue;
    }

    field += character;
  }

  if (field.length > 0 || fields.length > 0) {
    fields.push(field);
    records.push(fields);
  }

  return records;
}

function buildItem(overrides: Partial<ExcellentProductViewItem> = {}): ExcellentProductViewItem {
  const base: ExcellentProductViewItem = {
    designationNo: "EQ-2024-001",
    bizNoNormalized: "1234567890",
    companyName: "스마트빌딩",
    representativeName: "홍길동",
    phone: "02-1234-5678",
    address: "서울특별시 강남구 테헤란로 123",
    productName: "빌딩자동제어장치",
    productSpec: "BCU-100",
    productClassificationNo: "39121801-01",
    productClassificationNormalized: "3912180101",
    productClassificationName: "빌딩자동제어장치",
    designationStartDate: "2024-01-15",
    designationEndDate: "2027-01-14",
    certificationDetailsRaw: "K마크",
    factoryLocations: ["경기도 화성시 공장로 10"],
    industries: ["전기 공사업 (F4211)"],
  };

  return { ...base, ...overrides };
}

describe("excellentProductsToCsv", () => {
  it("starts with a UTF-8 BOM and the exact 16 headers in order", () => {
    const csv = excellentProductsToCsv([buildItem()]);

    expect(csv.startsWith("\ufeff")).toBe(true);

    const records = parseCsvRecords(csv.slice(1));
    expect(records[0]).toEqual(EXPECTED_HEADERS);
    expect(records[0]).toHaveLength(16);
  });

  it("writes 1-based row numbers and exactly 16 fields for every record", () => {
    const csv = excellentProductsToCsv([
      buildItem({ designationNo: "EQ-2024-001" }),
      buildItem({ designationNo: "EQ-2024-002" }),
      buildItem({ designationNo: "EQ-2024-003" }),
    ]);

    const records = parseCsvRecords(csv.slice(1));

    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(record).toHaveLength(16);
    }
    expect(records.slice(1).map((record) => record[0])).toEqual(["1", "2", "3"]);
  });

  it("maps every column to its source value", () => {
    const csv = excellentProductsToCsv([buildItem()]);
    const [, record] = parseCsvRecords(csv.slice(1));

    expect(record).toEqual([
      "1",
      "EQ-2024-001",
      "빌딩자동제어장치",
      "2024-01-15",
      "2027-01-14",
      "스마트빌딩",
      "1234567890",
      "홍길동",
      "02-1234-5678",
      "서울특별시 강남구 테헤란로 123",
      "39121801-01",
      "빌딩자동제어장치",
      "BCU-100",
      "K마크",
      "경기도 화성시 공장로 10",
      "전기 공사업 (F4211)",
    ]);
  });

  it("joins multiple factories and licenses with a semicolon and a space", () => {
    const csv = excellentProductsToCsv([
      buildItem({
        factoryLocations: ["경기도 화성시 공장로 10", "충청북도 청주시 산단로 5"],
        industries: ["전기 공사업 (F4211)", "전동기 제조업 (C2811)"],
      }),
    ]);
    const [, record] = parseCsvRecords(csv.slice(1));

    expect(record[14]).toBe("경기도 화성시 공장로 10; 충청북도 청주시 산단로 5");
    expect(record[15]).toBe("전기 공사업 (F4211); 전동기 제조업 (C2811)");
  });

  it("labels missing phone, factory, and license data explicitly", () => {
    const csv = excellentProductsToCsv([
      buildItem({
        phone: null,
        address: null,
        representativeName: null,
        productSpec: null,
        productClassificationName: null,
        certificationDetailsRaw: null,
        designationStartDate: null,
        designationEndDate: null,
        factoryLocations: [],
        industries: [],
      }),
    ]);
    const [, record] = parseCsvRecords(csv.slice(1));

    expect(record[8]).toBe("전화번호 정보 없음");
    expect(record[14]).toBe("공장소재지 정보 없음");
    expect(record[15]).toBe("면허정보 없음");
    expect(record[3]).toBe("");
    expect(record[4]).toBe("");
    expect(record[7]).toBe("");
    expect(record[9]).toBe("");
    expect(record[11]).toBe("");
    expect(record[12]).toBe("");
    expect(record[13]).toBe("");
  });

  it("round-trips Korean text, commas, quotes, and CR/LF inside a field", () => {
    const certification = 'K마크,"A"\r\nGS인증, 성능인증\n조달우수';
    const csv = excellentProductsToCsv([
      buildItem({
        certificationDetailsRaw: certification,
        companyName: '스마트"빌딩", 주식회사',
        address: "서울특별시 강남구\r\n테헤란로 123",
      }),
    ]);

    expect(csv).toContain('"K마크,""A""');

    const records = parseCsvRecords(csv.slice(1));
    expect(records).toHaveLength(2);
    expect(records[1]).toHaveLength(16);
    expect(records[1][13]).toBe(certification);
    expect(records[1][5]).toBe('스마트"빌딩", 주식회사');
    expect(records[1][9]).toBe("서울특별시 강남구\r\n테헤란로 123");
  });

  it("returns the header record alone for an empty result set", () => {
    const csv = excellentProductsToCsv([]);
    const records = parseCsvRecords(csv.slice(1));

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(EXPECTED_HEADERS);
  });
});