import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSqliteConnection, getDatabasePath } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";

function withDatabaseUrl<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.DATABASE_URL;
  if (value === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = value;
  }

  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
  }
}

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
      "company_industries",
      "competitor_contract_interval_cache",
      "competitor_contract_query_cache",
      "competitor_third_party_delivery_monthly_cache",
      "contract_records",
      "excellent_products",
      "factory_locations",
      "import_runs",
      "shopping_mall_delivery_request_info_cache",
      "shopping_mall_delivery_request_info_cache_chunks",
    ]);

    const indexes = db
      .prepare("select name from sqlite_master where type = 'index' order by name")
      .all() as { name: string }[];
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "businesses_biz_no_unique",
        "businesses_business_name_idx",
        "competitor_contract_query_cache_expiry_idx",
        "competitor_contract_interval_cache_lookup_idx",
        "competitor_contract_interval_cache_expiry_idx",
        "competitor_third_party_delivery_monthly_cache_expiry_idx",
        "contract_records_biz_no_idx",
        "contract_records_contract_date_idx",
        "contract_records_notice_no_idx",
        "contract_records_contract_no_idx",
        "contract_records_unified_contract_no_idx",
        "contract_records_biz_no_contract_date_idx",
        "contract_records_source_dataset_row_hash_unique",
        "company_industries_biz_no_idx",
        "company_industries_unique",
        "excellent_products_biz_no_idx",
        "excellent_products_classification_idx",
        "excellent_products_source_dataset_row_hash_unique",
        "factory_locations_biz_no_idx",
        "factory_locations_unique",
        "shopping_delivery_cache_chunk_unique",
        "shopping_delivery_cache_chunk_biz_idx",
        "shopping_delivery_cache_chunk_idx",
        "shopping_delivery_cache_request_unique",
      ]),
    );
  });

  it("marks import and search contract fields as required", () => {
    const dir = mkdtempSync(join(tmpdir(), "g2b-db-"));
    const db = new Database(join(dir, "test.sqlite"));

    initializeSqliteSchema(db);

    const columns = db.prepare("pragma table_info(contract_records)").all() as {
      name: string;
      notnull: number;
    }[];
    const notNullByName = new Map(columns.map((column) => [column.name, column.notnull]));

    expect(notNullByName.get("source_dataset")).toBe(1);
    expect(notNullByName.get("source_row_hash")).toBe(1);
    expect(notNullByName.get("business_category")).toBe(1);
    expect(notNullByName.get("contract_name")).toBe(1);
    expect(notNullByName.get("contract_date")).toBe(1);
    expect(notNullByName.get("biz_no_normalized")).toBe(1);
    expect(notNullByName.get("source_status")).toBe(1);
    expect(notNullByName.get("last_imported_at")).toBe(1);
    expect(notNullByName.get("created_at")).toBe(1);
    expect(notNullByName.get("updated_at")).toBe(1);
  });

  it("uses text response statuses for enrichment logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "g2b-db-"));
    const db = new Database(join(dir, "test.sqlite"));

    initializeSqliteSchema(db);

    const columns = db.prepare("pragma table_info(api_enrichment_logs)").all() as {
      name: string;
      type: string;
    }[];
    const responseStatus = columns.find((column) => column.name === "response_status");

    expect(responseStatus?.type.toLowerCase()).toBe("text");
  });

  it("declares foreign keys between related tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "g2b-db-"));
    const db = new Database(join(dir, "test.sqlite"));

    initializeSqliteSchema(db);

    const contractForeignKeys = db.prepare("pragma foreign_key_list(contract_records)").all() as {
      from: string;
      table: string;
      to: string;
    }[];
    const enrichmentForeignKeys = db
      .prepare("pragma foreign_key_list(api_enrichment_logs)")
      .all() as { from: string; table: string; to: string }[];

    expect(contractForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "business_id", table: "businesses", to: "id" }),
      ]),
    );
    expect(enrichmentForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "contract_record_id",
          table: "contract_records",
          to: "id",
        }),
      ]),
    );
  });
});

describe("createSqliteConnection", () => {
  it("enables foreign key enforcement for each connection", () => {
    const dir = mkdtempSync(join(tmpdir(), "g2b-db-"));
    const sqlite = createSqliteConnection(join(dir, "test.sqlite"));

    const foreignKeys = sqlite.pragma("foreign_keys", { simple: true });

    expect(foreignKeys).toBe(1);
    sqlite.close();
  });
});

describe("getDatabasePath", () => {
  it("resolves plain paths to absolute paths", () => {
    withDatabaseUrl("./data/g2b-contracts.sqlite", () => {
      expect(getDatabasePath()).toBe(resolve("./data/g2b-contracts.sqlite"));
    });
  });

  it("resolves file URLs to absolute paths", () => {
    withDatabaseUrl("file:./data/g2b-contracts.sqlite", () => {
      expect(getDatabasePath()).toBe(resolve("./data/g2b-contracts.sqlite"));
    });
  });

  it("rejects unsupported URL schemes", () => {
    for (const value of [
      "postgres://localhost/db",
      "postgresql://localhost/db",
      "libsql://example.turso.io",
      "sqlite://data/g2b-contracts.sqlite",
    ]) {
      withDatabaseUrl(value, () => {
        expect(() => getDatabasePath()).toThrow(/SQLite local filesystem path/);
      });
    }
  });
});
