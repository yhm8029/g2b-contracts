export function parseAmountToWon(input: string | null | undefined): number | null {
  const value = String(input ?? "").replace(/[,\s]/g, "");
  if (value.length === 0) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}
