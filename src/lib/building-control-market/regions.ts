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

const CITY_REGION_MARKERS: ReadonlyArray<readonly [ClassifiedMarketRegion, readonly string[]]> = [
  ["capital", ["수원", "성남", "고양", "용인", "부천", "안산", "안양", "남양주", "화성", "평택", "의정부", "시흥", "파주", "김포", "광명", "광주시", "군포", "하남", "오산", "이천", "양주", "구리", "안성", "포천", "의왕", "여주", "동두천", "과천"]],
  ["chungnam", ["천안", "공주", "보령", "아산", "서산", "논산", "계룡", "당진", "금산", "부여", "서천", "청양", "홍성", "예산", "태안"]],
  ["chungbuk", ["청주", "충주", "제천", "보은", "옥천", "영동", "증평", "진천", "괴산", "음성", "단양"]],
  ["jeonnam", ["목포", "여수", "순천", "나주", "광양", "담양", "곡성", "구례", "고흥", "보성", "화순", "장흥", "강진", "해남", "영암", "무안", "함평", "영광", "장성", "완도", "진도", "신안"]],
  ["jeonbuk", ["전주", "군산", "익산", "정읍", "남원", "김제", "완주", "진안", "무주", "장수", "임실", "순창", "고창", "부안"]],
  ["gyeongnam", ["창원", "진주", "통영", "사천", "김해", "밀양", "거제", "양산", "의령", "함안", "창녕", "남해", "하동", "산청", "함양", "거창", "합천"]],
  ["gyeongbuk", ["포항", "경주", "김천", "안동", "구미", "영주", "영천", "상주", "문경", "경산", "의성", "청송", "영양", "영덕", "청도", "고령", "성주", "칠곡", "예천", "봉화", "울진", "울릉"]],
  ["gangwon", ["춘천", "원주", "강릉", "동해", "태백", "속초", "삼척", "홍천", "횡성", "영월", "평창", "정선", "철원", "화천", "양구", "인제", "양양"]],
];

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
  for (const [region, markers] of CITY_REGION_MARKERS) {
    if (markers.some((marker) => name.includes(marker))) return region;
  }
  return "other";
}

export function matchesMarketRegion(
  demandAgencyName: string | null | undefined,
  region: ReportRegion,
  subjectName?: string | null,
): boolean {
  return region === "all" || resolveMarketRegion(demandAgencyName, subjectName) === region;
}

export function resolveMarketRegion(
  demandAgencyName: string | null | undefined,
  subjectName?: string | null,
): ClassifiedMarketRegion {
  const agencyRegion = classifyMarketRegion(demandAgencyName);
  return agencyRegion === "other" ? classifyMarketRegion(subjectName) : agencyRegion;
}

function normalizeAgency(value: string | null | undefined): string {
  return value?.normalize("NFKC").toLowerCase().replace(/\s+/g, "") ?? "";
}
