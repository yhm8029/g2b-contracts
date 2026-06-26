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

export function formatBusinessNumber(normalized: string): string {
  const value = parseBusinessNumber(normalized);
  return `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}`;
}
