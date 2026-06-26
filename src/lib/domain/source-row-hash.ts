import { createHash } from "node:crypto";

type HashableRecord = Record<string, string | number | null | undefined>;

export function createSourceRowHash(row: HashableRecord): string {
  const entries = Object.keys(row)
    .sort()
    .map((key) => [key, row[key] ?? ""]);
  const canonical = JSON.stringify(entries);

  return createHash("sha256").update(canonical).digest("hex");
}
