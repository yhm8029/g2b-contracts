const MAX_BUSINESS_NUMBER_LIST_SIZE = 20;

export function normalizeBusinessNumber(input: string): string {
  return input.replace(/\D/g, "");
}

export function parseBusinessNumber(input: string): string {
  const normalized = normalizeBusinessNumber(input);
  if (!/^\d{10}$/.test(normalized)) {
    throw new Error("Business registration number must contain 10 digits.");
  }
  return normalized;
}

export function parseBusinessNumberList(input: string): string[] {
  const parsedValues = input
    .split(/[,\r\n]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(parseBusinessNumber);

  if (parsedValues.length === 0) {
    throw new Error("Business registration number must contain 10 digits.");
  }

  const uniqueValues = [...new Set(parsedValues)];

  if (uniqueValues.length > MAX_BUSINESS_NUMBER_LIST_SIZE) {
    throw new Error("Business registration number list can contain up to 20 entries.");
  }

  return uniqueValues;
}

export function formatBusinessNumber(normalized: string): string {
  const value = parseBusinessNumber(normalized);
  return `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}`;
}
