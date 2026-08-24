export const REPORT_REGION_OPTIONS = [
  { value: "all", label: "전국" },
  { value: "capital", label: "수도권(서울·경기)" },
  { value: "busan", label: "부산" },
  { value: "chungnam", label: "충남" },
  { value: "chungbuk", label: "충북" },
  { value: "jeonnam", label: "전남" },
  { value: "jeonbuk", label: "전북" },
  { value: "gyeongnam", label: "경남" },
  { value: "gyeongbuk", label: "경북" },
  { value: "gangwon", label: "강원" },
  { value: "jeju", label: "제주" },
  { value: "incheon", label: "인천" },
  { value: "daegu", label: "대구" },
  { value: "daejeon", label: "대전" },
  { value: "gwangju", label: "광주" },
  { value: "ulsan", label: "울산" },
  { value: "sejong", label: "세종" },
  { value: "other", label: "기타" },
] as const;

export type ReportRegion = (typeof REPORT_REGION_OPTIONS)[number]["value"];
export type ClassifiedMarketRegion = Exclude<ReportRegion, "all">;

const REGION_LABELS: Record<ReportRegion | "other", string> = {
  all: "전국",
  capital: "수도권(서울·경기)",
  busan: "부산",
  chungnam: "충남",
  chungbuk: "충북",
  jeonnam: "전남",
  jeonbuk: "전북",
  gyeongnam: "경남",
  gyeongbuk: "경북",
  gangwon: "강원",
  jeju: "제주",
  incheon: "인천",
  daegu: "대구",
  daejeon: "대전",
  gwangju: "광주",
  ulsan: "울산",
  sejong: "세종",
  other: "기타",
};

export function isReportRegion(value: unknown): value is ReportRegion {
  return REPORT_REGION_OPTIONS.some((option) => option.value === value);
}

export function marketRegionLabel(region: ReportRegion | ClassifiedMarketRegion): string {
  return REGION_LABELS[region];
}

export function classifyMarketRegion(demandAgencyName: string | null | undefined): ClassifiedMarketRegion {
  const name = normalizeAgency(demandAgencyName);
  if (!name) return "other";

  // Capital-area matching runs first so 경기도 광주시 isn't classified as 광주광역시.
  if (name.includes("서울") || name.includes("경기")) return "capital";
  if (name.includes("부산")) return "busan";
  if (name.includes("충청남도") || name.includes("충남")) return "chungnam";
  if (name.includes("충청북도") || name.includes("충북")) return "chungbuk";
  if (name.includes("전라남도") || name.includes("전남")) return "jeonnam";
  if (name.includes("전북특별자치도") || name.includes("전라북도") || name.includes("전북")) return "jeonbuk";
  if (name.includes("경상남도") || name.includes("경남")) return "gyeongnam";
  if (name.includes("경상북도") || name.includes("경북")) return "gyeongbuk";
  if (name.includes("강원")) return "gangwon";
  if (name.includes("제주")) return "jeju";
  if (name.includes("인천")) return "incheon";
  if (name.includes("대구")) return "daegu";
  if (name.includes("대전")) return "daejeon";
  if (name.includes("광주")) return "gwangju";
  if (name.includes("울산")) return "ulsan";
  if (name.includes("세종")) return "sejong";
  return "other";
}

export function matchesMarketRegion(
  demandAgencyName: string | null | undefined,
  region: ReportRegion,
): boolean {
  return region === "all" || classifyMarketRegion(demandAgencyName) === region;
}

function normalizeAgency(value: string | null | undefined): string {
  return value?.normalize("NFKC").toLowerCase().replace(/\s+/g, "") ?? "";
}
