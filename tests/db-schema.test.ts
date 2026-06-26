import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initializeSqliteSchema } from "@/lib/db/init";

describe("initializeSqliteSchema", () => {
  it("creates required tables and indexes", () => {
    const dir = mkdtempSync(join(tmpdir(), "g2b-db-"));
    const db = new Database(join(dir, "test.sqlite"));

    initializeSqliteSchema(db);

    const tables = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual([
      "api_enrichment_logs",
      "businesses",
      "contract_records",
      "import_runs",
    ]);
  });
});
