const THIRD_PARTY_UNIT_PRICE_CONTRACT = "제3자단가계약";

export function isExcludedMarketFrameworkName(value: string | null | undefined): boolean {
  return normalizeName(value).includes(THIRD_PARTY_UNIT_PRICE_CONTRACT);
}

function normalizeName(value: string | null | undefined): string {
  return value?.normalize("NFKC").replace(/\s+/g, "") ?? "";
}

