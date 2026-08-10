import type Database from "better-sqlite3";

const BUSINESSES_LEGACY_COLUMNS: ReadonlyArray<{
  column: string;
  definition: string;
}> = [
  { column: "phone", definition: "ALTER TABLE businesses ADD COLUMN phone TEXT" },
  {
    column: "profile_source",
    definition: "ALTER TABLE businesses ADD COLUMN profile_source TEXT",
  },
  {
    column: "last_synced_at",
    definition: "ALTER TABLE businesses ADD COLUMN last_synced_at TEXT",
  },
];

function ensureBusinessProfileColumns(db: Database.Database): void {
  const existingColumns = new Set(
    (db.prepare("pragma table_info(businesses)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );

  for (const { column, definition } of BUSINESSES_LEGACY_COLUMNS) {
    if (existingColumns.has(column)) {
      continue;
    }
    try {
      db.exec(definition);
      existingColumns.add(column);
    } catch (error) {
      // The ALTER may have raced with a concurrent migration. Re-read the
      // column list and only swallow the error when the column is in fact
      // present now; otherwise rethrow so callers do not silently keep an
      // outdated schema.
      const refreshedColumns = new Set(
        (db.prepare("pragma table_info(businesses)").all() as { name: string }[]).map(
          (entry) => entry.name,
        ),
      );
      if (!refreshedColumns.has(column)) {
        throw error;
      }
    }
  }
}

export function initializeSqliteSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY,
      biz_no_normalized TEXT NOT NULL,
      biz_no_display TEXT,
      business_name TEXT,
      representative_name TEXT,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS businesses_biz_no_unique
      ON businesses (biz_no_normalized);
    CREATE INDEX IF NOT EXISTS businesses_business_name_idx
      ON businesses (business_name);

    CREATE TABLE IF NOT EXISTS contract_records (
      id INTEGER PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id),
      source_dataset TEXT NOT NULL,
      source_row_hash TEXT NOT NULL,
      business_category TEXT NOT NULL DEFAULT 'unknown',
      notice_no TEXT,
      notice_order TEXT,
      notice_name TEXT,
      contract_no TEXT,
      unified_contract_no TEXT,
      contract_name TEXT NOT NULL,
      contract_date TEXT NOT NULL,
      current_contract_amount INTEGER,
      total_contract_amount INTEGER,
      demand_agency_code TEXT,
      demand_agency_name TEXT,
      contract_agency_code TEXT,
      contract_agency_name TEXT,
      contract_method TEXT,
      winning_method TEXT,
      business_name_at_contract TEXT,
      biz_no_normalized TEXT NOT NULL,
      contract_detail_url TEXT,
      notice_detail_url TEXT,
      raw_source_url TEXT,
      source_status TEXT NOT NULL DEFAULT 'local_only',
      last_imported_at TEXT NOT NULL,
      last_enriched_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS contract_records_biz_no_idx
      ON contract_records (biz_no_normalized);
    CREATE INDEX IF NOT EXISTS contract_records_contract_date_idx
      ON contract_records (contract_date);
    CREATE INDEX IF NOT EXISTS contract_records_notice_no_idx
      ON contract_records (notice_no);
    CREATE INDEX IF NOT EXISTS contract_records_contract_no_idx
      ON contract_records (contract_no);
    CREATE INDEX IF NOT EXISTS contract_records_unified_contract_no_idx
      ON contract_records (unified_contract_no);
    CREATE INDEX IF NOT EXISTS contract_records_biz_no_contract_date_idx
      ON contract_records (biz_no_normalized, contract_date);
    CREATE UNIQUE INDEX IF NOT EXISTS contract_records_source_dataset_row_hash_unique
      ON contract_records (source_dataset, source_row_hash);

    CREATE TABLE IF NOT EXISTS api_enrichment_logs (
      id INTEGER PRIMARY KEY,
      contract_record_id INTEGER REFERENCES contract_records(id),
      provider TEXT NOT NULL,
      operation TEXT NOT NULL,
      request_params_json TEXT,
      response_status TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS import_runs (
      id INTEGER PRIMARY KEY,
      source_name TEXT NOT NULL,
      source_file_name TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      status TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS shopping_mall_delivery_request_info_cache_chunks (
      id INTEGER PRIMARY KEY,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      cached_row_count INTEGER NOT NULL DEFAULT 0,
      refreshed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS shopping_delivery_cache_chunk_unique
      ON shopping_mall_delivery_request_info_cache_chunks (date_from, date_to);

    CREATE TABLE IF NOT EXISTS shopping_mall_delivery_request_info_cache (
      id INTEGER PRIMARY KEY,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      source_row_hash TEXT NOT NULL,
      delivery_request_no TEXT,
      delivery_request_change_order TEXT,
      receipt_date TEXT,
      corp_bizno TEXT,
      corp_name TEXT,
      contract_method TEXT,
      delivery_request_name TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS shopping_delivery_cache_chunk_idx
      ON shopping_mall_delivery_request_info_cache (date_from, date_to);
    CREATE INDEX IF NOT EXISTS shopping_delivery_cache_chunk_biz_idx
      ON shopping_mall_delivery_request_info_cache (date_from, date_to, corp_bizno);
    CREATE UNIQUE INDEX IF NOT EXISTS shopping_delivery_cache_request_unique
      ON shopping_mall_delivery_request_info_cache (date_from, date_to, source_row_hash);

    CREATE TABLE IF NOT EXISTS competitor_contract_query_cache (
      biz_no_normalized TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      result_json TEXT NOT NULL,
      cached_at_ms INTEGER NOT NULL,
      result_version TEXT NOT NULL,
      PRIMARY KEY (biz_no_normalized, date_from, date_to)
    );

    CREATE INDEX IF NOT EXISTS competitor_contract_query_cache_expiry_idx
      ON competitor_contract_query_cache (cached_at_ms);

    CREATE TABLE IF NOT EXISTS competitor_contract_interval_cache (
      biz_no_normalized TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      result_json TEXT NOT NULL,
      cached_at_ms INTEGER NOT NULL,
      result_version TEXT NOT NULL,
      PRIMARY KEY (biz_no_normalized, date_from, date_to)
    );

    CREATE INDEX IF NOT EXISTS competitor_contract_interval_cache_lookup_idx
      ON competitor_contract_interval_cache (biz_no_normalized, date_from, date_to);
    CREATE INDEX IF NOT EXISTS competitor_contract_interval_cache_expiry_idx
      ON competitor_contract_interval_cache (cached_at_ms);

    CREATE TABLE IF NOT EXISTS competitor_third_party_delivery_monthly_cache (
      registry_key TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      result_json TEXT NOT NULL,
      cached_at_ms INTEGER NOT NULL,
      result_version TEXT NOT NULL,
      PRIMARY KEY (registry_key, date_from, date_to)
    );

    CREATE INDEX IF NOT EXISTS competitor_third_party_delivery_monthly_cache_expiry_idx
      ON competitor_third_party_delivery_monthly_cache (cached_at_ms);

    CREATE TABLE IF NOT EXISTS excellent_products (
      id INTEGER PRIMARY KEY,
      biz_no_normalized TEXT NOT NULL,
      designation_no TEXT NOT NULL,
      company_name_csv TEXT NOT NULL,
      representative_name_csv TEXT,
      phone_csv TEXT,
      address_csv TEXT,
      product_name TEXT NOT NULL,
      product_spec TEXT,
      product_classification_no TEXT NOT NULL,
      product_classification_normalized TEXT NOT NULL,
      product_classification_name TEXT,
      designation_start_date TEXT,
      designation_end_date TEXT,
      certification_details_raw TEXT,
      sanction_type TEXT,
      source_dataset TEXT NOT NULL,
      source_row_hash TEXT NOT NULL,
      source_file_name TEXT,
      source_imported_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS excellent_products_biz_no_idx
      ON excellent_products (biz_no_normalized);
    CREATE INDEX IF NOT EXISTS excellent_products_classification_idx
      ON excellent_products (product_classification_normalized);
    CREATE UNIQUE INDEX IF NOT EXISTS excellent_products_source_dataset_row_hash_unique
      ON excellent_products (source_dataset, source_row_hash);

    CREATE TABLE IF NOT EXISTS factory_locations (
      id INTEGER PRIMARY KEY,
      biz_no_normalized TEXT NOT NULL,
      location TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS factory_locations_biz_no_idx
      ON factory_locations (biz_no_normalized);
    CREATE UNIQUE INDEX IF NOT EXISTS factory_locations_unique
      ON factory_locations (biz_no_normalized, location, source);

    CREATE TABLE IF NOT EXISTS company_industries (
      id INTEGER PRIMARY KEY,
      biz_no_normalized TEXT NOT NULL,
      industry_code TEXT NOT NULL,
      industry_name TEXT NOT NULL,
      status TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS company_industries_biz_no_idx
      ON company_industries (biz_no_normalized);
    CREATE UNIQUE INDEX IF NOT EXISTS company_industries_unique
      ON company_industries (biz_no_normalized, industry_code, industry_name, source);
  `);

  ensureBusinessProfileColumns(db);
}
