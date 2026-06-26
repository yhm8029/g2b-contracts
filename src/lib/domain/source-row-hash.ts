import { createHash } from "node:crypto";

type HashableRecord = Record<string, string | number | null | undefined>;

export function createSourceRowHash(row: HashableRecord): string {
  const canonical = Object.keys(row)
    .sort()
    .map((key) => [key, row[key] ?? ""])
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("|");

  return createHash("sha256").update(canonical).digest("hex");
}
