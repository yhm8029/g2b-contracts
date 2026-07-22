import type { CompetitorContractRow } from "./contracts";

const COMPETITOR_TUPLES = [
  ["덕산메카시스(주)", "2208104763", "2026058"],
  ["(주)우리젠", "1138190302", "2025208"],
  ["이에스콘트롤스(주)", "1108175113", "2025205"],
  ["주식회사 비엘아이앤씨", "7708700599", "2025140"],
  ["(주)파노텍", "2048145651", "2025135"],
  ["중앙아이엔티 주식회사", "1268144518", "2025074"],
  ["성한 주식회사", "3148146957", "2025073"],
  ["한경기전(주)", "1138111990", "2024064"],
  ["한국디지탈콘트롤 주식회사", "1238122892", "2024063"],
  ["주식회사 나라컨트롤", "2118138895", "2024150"],
  ["주식회사 삼원씨앤지", "2048169430", "2024018"],
  ["주식회사 신영정보기술", "2068117262", "2024004"],
  ["주식회사일렉콤", "1338128627", "2023197"],
  ["(주)헤리트", "3148130305", "2022241"],
  ["(주)케이디티", "1078171028", "2022186"],
  ["로지시스템(주)", "1098182104", "2022061"],
  ["주식회사 엠알바스", "2148143121", "2021037"],
  ["주식회사 주인정보시스템", "2208658565", "2020239"],
  ["서전엔지니어링(주)", "2208165402", "2020220"],
  ["(주)동양이엔씨", "1068133832", "2020111"],
  ["(주)신아시스템", "1238180252", "2020101"],
  ["화인시스템(주)", "5028142086", "2020059"],
] as const;

export type CompetitorRegistryItem = {
  competitorId: string;
  companyName: string;
  bizNo: string;
  designationNo: string;
  displayOrder: number;
};

export const COMPETITOR_REGISTRY: readonly CompetitorRegistryItem[] = COMPETITOR_TUPLES.map(
  ([companyName, bizNo, designationNo], index) => ({
    competitorId: `excellent-${designationNo}`,
    companyName,
    bizNo,
    designationNo,
    displayOrder: index + 1,
  }),
);

export function classifyAutomaticControlBemsContract(row: Pick<CompetitorContractRow, "contractName">) {
  const text = normalize(row.contractName);
  const positiveSignals = collect(text, [
    ["빌딩자동제어", "빌딩자동제어"],
    ["건물자동제어", "건물자동제어"],
    ["bems", "BEMS"],
    ["빌딩에너지관리", "빌딩에너지관리"],
    ["건물에너지관리", "건물에너지관리"],
  ]);
  const conflictingSignals = collect(text, [
    ["정수장", "정수장"], ["상수", "상수"], ["하수", "하수"], ["오수", "오수"],
    ["계장제어", "계장제어"], ["공정제어", "공정제어"], ["취수장", "취수장"],
    ["배수지", "배수지"], ["펌프장", "펌프장"],
  ]);
  if (positiveSignals.length === 0 && text.includes("자동제어") && [
    "빌딩", "건물", "청사", "학교", "교사동", "공조", "냉난방", "기계설비", "중앙감시",
    "체육관", "도서관", "병원",
  ].some((term) => text.includes(term))) {
    positiveSignals.push("건물시설 자동제어");
  }
  return {
    related: positiveSignals.length > 0 && conflictingSignals.length === 0,
    positiveSignals,
    conflictingSignals,
  };
}

function collect(text: string, signals: ReadonlyArray<readonly [string, string]>) {
  return signals.filter(([needle]) => text.includes(needle)).map(([, label]) => label);
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();
}
