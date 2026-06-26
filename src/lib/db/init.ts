import type Database from "better-sqlite3";

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
      contract_name TEXT,
      contract_date TEXT,
      current_contract_amount INTEGER,
      total_contract_amount INTEGER,
      demand_agency_code TEXT,
      demand_agency_name TEXT,
      contract_agency_code TEXT,
      contract_agency_name TEXT,
      contract_method TEXT,
      winning_method TEXT,
      business_name_at_contract TEXT,
      biz_no_normalized TEXT,
      contract_detail_url TEXT,
      notice_detail_url TEXT,
      raw_source_url TEXT,
      source_status TEXT NOT NULL DEFAULT 'local_only',
      last_imported_at TEXT,
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
      response_status INTEGER,
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
  `);
}
