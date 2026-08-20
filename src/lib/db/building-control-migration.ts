import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

const MIGRATION_VERSION = 1;
const MIGRATION_NAME = "building-control-versioned-market-data";

const REQUIRED_TABLES = [
  "building_control_schema_migrations",
  "building_control_sync_runs",
  "building_control_sync_leases",
  "building_control_source_generations",
  "building_control_generation_memberships",
  "building_control_notices",
  "building_control_notice_products",
  "building_control_award_revisions",
  "building_control_awards",
  "excellent_designations",
  "excellent_designation_observations",
  "award_classifications",
  "building_control_coverage",
  "building_control_market_manifests",
  "building_control_manifest_sources",
  "building_control_active_manifest",
] as const;

const REQUIRED_INDEXES = [
  "building_control_sync_runs_startup_success_unique",
  "building_control_award_revisions_identity_unique",
  "building_control_awards_notice_unique",
  "building_control_awards_date_winner_idx",
  "excellent_designation_observations_version_unique",
  "excellent_designation_observations_biz_interval_idx",
  "award_classifications_evidence_unique",
  "building_control_source_generations_run_source_unique",
  "building_control_notices_identity_unique",
  "building_control_notice_products_identity_unique",
  "excellent_designations_identity_unique",
  "building_control_manifest_sources_generation_unique",
  "building_control_generation_memberships_identity_unique",
] as const;

const SOURCE_FACT_TABLES = [
  ["building_control_notices", "notice-publication", "notice"],
  ["building_control_notice_products", "notice-product", "notice-product"],
  ["building_control_award_revisions", "award-registration", "award-revision"],
  ["building_control_awards", "award-registration", "award"],
  [
    "excellent_designation_observations",
    "designation-history",
    "designation-observation",
  ],
  ["award_classifications", "award-classification", "award-classification"],
] as const;

const TASK3_DDL = `
  CREATE TABLE building_control_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL CHECK (length(checksum) = 64),
    applied_at TEXT NOT NULL
  );

  CREATE TABLE building_control_sync_runs (
    id INTEGER PRIMARY KEY,
    trigger TEXT NOT NULL CHECK (trigger IN ('startup', 'manual', 'resume')),
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    seoul_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    lease_owner TEXT NOT NULL,
    lease_fence INTEGER NOT NULL CHECK (lease_fence >= 1),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    redacted_error TEXT
  );
  CREATE UNIQUE INDEX building_control_sync_runs_startup_success_unique
    ON building_control_sync_runs (seoul_date)
    WHERE trigger = 'startup' AND status = 'completed';

  CREATE TABLE building_control_sync_leases (
    lock_name TEXT PRIMARY KEY CHECK (lock_name = 'building-control-sync'),
    owner TEXT NOT NULL,
    fence INTEGER NOT NULL CHECK (fence >= 1),
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE building_control_source_generations (
    id INTEGER PRIMARY KEY,
    sync_run_id INTEGER NOT NULL REFERENCES building_control_sync_runs(id),
    source TEXT NOT NULL CHECK (source IN (
      'notice-publication', 'award-registration', 'notice-product',
      'designation-history', 'award-classification'
    )),
    state TEXT NOT NULL CHECK (state IN ('staging', 'complete', 'failed')),
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
    observed_count INTEGER NOT NULL CHECK (
      observed_count >= 0 AND observed_count <= expected_count
    ),
    page_count INTEGER NOT NULL CHECK (page_count >= 0),
    identity_set_hash TEXT NOT NULL CHECK (length(identity_set_hash) = 64),
    source_hashes_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    CHECK ((state = 'complete') = (completed_at IS NOT NULL))
  );
  CREATE UNIQUE INDEX building_control_source_generations_run_source_unique
    ON building_control_source_generations (sync_run_id, source);

  CREATE TABLE building_control_generation_memberships (
    generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64),
    source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
    PRIMARY KEY (generation_id, entity_type, entity_id, source_hash)
  );
  CREATE UNIQUE INDEX building_control_generation_memberships_identity_unique
    ON building_control_generation_memberships (generation_id, identity_hash);

  CREATE TABLE building_control_notices (
    id INTEGER PRIMARY KEY,
    generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    notice_no TEXT NOT NULL,
    notice_order TEXT NOT NULL,
    notice_name TEXT NOT NULL,
    publication_date TEXT NOT NULL,
    demand_agency_code TEXT,
    demand_agency_name TEXT,
    notice_url TEXT,
    status TEXT NOT NULL DEFAULT 'unknown',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    target_parent_product_code TEXT,
    target_detail_product_code TEXT,
    raw_json TEXT NOT NULL,
    source_hash TEXT NOT NULL CHECK (length(source_hash) = 64)
  );
  CREATE UNIQUE INDEX building_control_notices_identity_unique
    ON building_control_notices (generation_id, notice_no, notice_order, source_hash);

  CREATE TABLE building_control_notice_products (
    id INTEGER PRIMARY KEY,
    generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    notice_id INTEGER NOT NULL REFERENCES building_control_notices(id),
    bid_clsfc_no TEXT NOT NULL,
    parent_product_code TEXT,
    detail_product_code TEXT,
    provider_row_identity TEXT NOT NULL,
    provider_row_order INTEGER,
    exact_match INTEGER NOT NULL DEFAULT 0 CHECK (exact_match IN (0, 1)),
    raw_json TEXT NOT NULL,
    source_hash TEXT NOT NULL CHECK (length(source_hash) = 64)
  );
  CREATE UNIQUE INDEX building_control_notice_products_identity_unique
    ON building_control_notice_products (
      generation_id, notice_id, bid_clsfc_no, provider_row_identity, source_hash
    );

  CREATE TABLE building_control_award_revisions (
    id INTEGER PRIMARY KEY,
    generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    notice_id INTEGER NOT NULL REFERENCES building_control_notices(id),
    bid_clsfc_no TEXT NOT NULL,
    rbid_no TEXT NOT NULL,
    provider_result_identity TEXT NOT NULL,
    final_award_date TEXT NOT NULL,
    winner_biz_no TEXT NOT NULL,
    winner_name TEXT NOT NULL,
    source_status TEXT NOT NULL DEFAULT 'final',
    winner_rows_json TEXT NOT NULL DEFAULT '[]',
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    raw_json TEXT NOT NULL,
    source_hash TEXT NOT NULL CHECK (length(source_hash) = 64)
  );
  CREATE UNIQUE INDEX building_control_award_revisions_identity_unique
    ON building_control_award_revisions (
      generation_id, notice_id, bid_clsfc_no, rbid_no,
      provider_result_identity, source_hash
    );

  CREATE TABLE building_control_awards (
    id INTEGER PRIMARY KEY,
    generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    notice_id INTEGER NOT NULL REFERENCES building_control_notices(id),
    selected_revision_id INTEGER NOT NULL REFERENCES building_control_award_revisions(id),
    final_award_date TEXT NOT NULL,
    winner_biz_no TEXT NOT NULL,
    winner_name TEXT NOT NULL,
    award_amount INTEGER,
    award_rate TEXT,
    final_result_identity TEXT,
    raw_json TEXT
  );
  CREATE UNIQUE INDEX building_control_awards_notice_unique
    ON building_control_awards (generation_id, notice_id);
  CREATE INDEX building_control_awards_date_winner_idx
    ON building_control_awards (final_award_date, winner_biz_no);

  CREATE TABLE excellent_designations (
    id INTEGER PRIMARY KEY,
    etpm_dsgn_crfc_no TEXT NOT NULL,
    etpm_dsgn_dmnd_no TEXT NOT NULL,
    dsgn_dmnd_chg_ord TEXT NOT NULL,
    etps_sqno TEXT NOT NULL,
    designation_no TEXT,
    biz_no_normalized TEXT
  );
  CREATE UNIQUE INDEX excellent_designations_identity_unique
    ON excellent_designations (
      etpm_dsgn_crfc_no, etpm_dsgn_dmnd_no, dsgn_dmnd_chg_ord, etps_sqno
    );

  CREATE TABLE excellent_designation_observations (
    id INTEGER PRIMARY KEY,
    generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    designation_id INTEGER NOT NULL REFERENCES excellent_designations(id),
    biz_no_normalized TEXT NOT NULL,
    company_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    original_end_date TEXT,
    extension_end_date TEXT,
    effective_end_date TEXT,
    status TEXT NOT NULL CHECK (status IN ('', '유효', '만료', '효력정지')),
    product_name TEXT NOT NULL,
    classification_codes_json TEXT NOT NULL,
    termination_state TEXT NOT NULL DEFAULT 'unverified',
    termination_evidence_hash TEXT,
    cancellation_date TEXT,
    revocation_date TEXT,
    list_identity TEXT,
    detail_identity TEXT,
    list_raw_json TEXT NOT NULL,
    detail_raw_json TEXT NOT NULL,
    source_hash TEXT NOT NULL CHECK (length(source_hash) = 64)
  );
  CREATE UNIQUE INDEX excellent_designation_observations_version_unique
    ON excellent_designation_observations (designation_id, generation_id, source_hash);
  CREATE INDEX excellent_designation_observations_biz_interval_idx
    ON excellent_designation_observations (
      biz_no_normalized, start_date, effective_end_date
    );

  CREATE TABLE award_classifications (
    id INTEGER PRIMARY KEY,
    generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    award_revision_id INTEGER NOT NULL REFERENCES building_control_award_revisions(id),
    designation_generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    rules_version TEXT NOT NULL,
    evaluated_award_date TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
      'cooperative', 'excellent', 'non_excellent', 'incomplete'
    )),
    matched_observation_id INTEGER REFERENCES excellent_designation_observations(id),
    reason TEXT NOT NULL,
    evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX award_classifications_evidence_unique
    ON award_classifications (
      generation_id, award_revision_id
    );

  CREATE TABLE building_control_coverage (
    id INTEGER PRIMARY KEY,
    generation_id INTEGER NOT NULL UNIQUE REFERENCES building_control_source_generations(id),
    source TEXT NOT NULL CHECK (source IN (
      'notice-publication', 'award-registration', 'notice-product',
      'designation-history', 'award-classification'
    )),
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    watermark TEXT,
    complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
    expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
    observed_count INTEGER NOT NULL CHECK (observed_count >= 0),
    identity_set_hash TEXT NOT NULL CHECK (length(identity_set_hash) = 64),
    completed_at TEXT NOT NULL
  );

  CREATE TABLE building_control_market_manifests (
    id INTEGER PRIMARY KEY,
    sync_run_id INTEGER NOT NULL REFERENCES building_control_sync_runs(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE building_control_manifest_sources (
    manifest_id INTEGER NOT NULL
      REFERENCES building_control_market_manifests(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN (
      'notice-publication', 'award-registration', 'notice-product',
      'designation-history', 'award-classification'
    )),
    generation_id INTEGER NOT NULL REFERENCES building_control_source_generations(id),
    coverage_id INTEGER NOT NULL REFERENCES building_control_coverage(id),
    PRIMARY KEY (manifest_id, source)
  );
  CREATE UNIQUE INDEX building_control_manifest_sources_generation_unique
    ON building_control_manifest_sources (manifest_id, generation_id);

  CREATE TABLE building_control_active_manifest (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    manifest_id INTEGER REFERENCES building_control_market_manifests(id),
    version INTEGER NOT NULL CHECK (version >= 0)
  );
  INSERT INTO building_control_active_manifest (singleton, manifest_id, version)
    VALUES (1, NULL, 0);
`;

const FACT_GUARD_DDL = SOURCE_FACT_TABLES.map(
  ([table, source]) => `
    CREATE TRIGGER ${table}_staging_insert_guard
    BEFORE INSERT ON ${table}
    WHEN NOT EXISTS (
      SELECT 1 FROM building_control_source_generations g
      WHERE g.id = NEW.generation_id AND g.source = '${source}' AND g.state = 'staging'
    )
    BEGIN
      SELECT RAISE(ABORT, 'immutable generation: fact writes require matching staging source');
    END;
    CREATE TRIGGER ${table}_staging_update_guard
    BEFORE UPDATE ON ${table}
    BEGIN
      SELECT RAISE(ABORT, 'immutable generation: source facts are append-only');
    END;
    CREATE TRIGGER ${table}_staging_delete_guard
    BEFORE DELETE ON ${table}
    BEGIN
      SELECT RAISE(ABORT, 'immutable generation: source facts are append-only');
    END;
  `,
).join("\n");

const PROVENANCE_TRIGGER_DDL = `
  CREATE TRIGGER building_control_generation_memberships_staging_insert_guard
  BEFORE INSERT ON building_control_generation_memberships
  WHEN NOT EXISTS (
    SELECT 1 FROM building_control_source_generations g
    WHERE g.id = NEW.generation_id AND g.state = 'staging'
  )
  BEGIN
    SELECT RAISE(ABORT, 'immutable generation: membership writes require staging');
  END;
  CREATE TRIGGER building_control_generation_memberships_staging_update_guard
  BEFORE UPDATE ON building_control_generation_memberships
  BEGIN
    SELECT RAISE(ABORT, 'immutable generation: memberships are append-only');
  END;
  CREATE TRIGGER building_control_generation_memberships_staging_delete_guard
  BEFORE DELETE ON building_control_generation_memberships
  BEGIN
    SELECT RAISE(ABORT, 'immutable generation: memberships are append-only');
  END;

  CREATE TRIGGER building_control_awards_revision_guard
  BEFORE INSERT ON building_control_awards
  WHEN NOT EXISTS (
    SELECT 1 FROM building_control_award_revisions r
    WHERE r.id = NEW.selected_revision_id
      AND r.generation_id = NEW.generation_id
      AND r.notice_id = NEW.notice_id
      AND r.final_award_date = NEW.final_award_date
      AND r.winner_biz_no = NEW.winner_biz_no
      AND r.winner_name = NEW.winner_name
  )
  BEGIN
    SELECT RAISE(ABORT, 'award revision must match award generation and notice');
  END;

  CREATE TRIGGER award_classifications_provenance_guard
  BEFORE INSERT ON award_classifications
  WHEN NOT EXISTS (
    SELECT 1
    FROM building_control_source_generations cg
    JOIN building_control_award_revisions ar ON ar.id = NEW.award_revision_id
    JOIN building_control_source_generations ag ON ag.id = ar.generation_id
    JOIN building_control_awards canonical_award
      ON canonical_award.selected_revision_id = ar.id
      AND canonical_award.generation_id = ag.id
    JOIN building_control_source_generations dg ON dg.id = NEW.designation_generation_id
    WHERE cg.id = NEW.generation_id
      AND cg.source = 'award-classification'
      AND cg.state = 'staging'
      AND NEW.evaluated_award_date = ar.final_award_date
      AND ag.source = 'award-registration'
      AND ag.sync_run_id = cg.sync_run_id
      AND dg.source = 'designation-history'
      AND dg.sync_run_id = cg.sync_run_id
      AND (
        NEW.matched_observation_id IS NULL OR EXISTS (
          SELECT 1 FROM excellent_designation_observations observation
          WHERE observation.id = NEW.matched_observation_id
            AND observation.generation_id = NEW.designation_generation_id
        )
      )
  )
  BEGIN
    SELECT RAISE(ABORT, 'classification provenance must match run and designation generation');
  END;

  CREATE TRIGGER building_control_manifest_sources_coverage_guard
  BEFORE INSERT ON building_control_manifest_sources
  WHEN NOT EXISTS (
    SELECT 1
    FROM building_control_source_generations g
    JOIN building_control_coverage c ON c.id = NEW.coverage_id
    JOIN building_control_market_manifests m ON m.id = NEW.manifest_id
    WHERE g.id = NEW.generation_id
      AND g.source = NEW.source
      AND g.state = 'complete'
      AND c.generation_id = NEW.generation_id
      AND c.source = NEW.source
      AND c.complete = 1
      AND m.sync_run_id = g.sync_run_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'manifest source must match complete generation coverage');
  END;

  CREATE TRIGGER building_control_source_generations_transition_guard
  BEFORE UPDATE ON building_control_source_generations
  WHEN NOT (
    OLD.state = 'staging'
    AND NEW.state IN ('complete', 'failed')
    AND NEW.id = OLD.id
    AND NEW.sync_run_id = OLD.sync_run_id
    AND NEW.source = OLD.source
    AND NEW.date_from = OLD.date_from
    AND NEW.date_to = OLD.date_to
    AND NEW.expected_count = OLD.expected_count
    AND NEW.observed_count = OLD.observed_count
    AND NEW.page_count = OLD.page_count
    AND NEW.identity_set_hash = OLD.identity_set_hash
    AND NEW.source_hashes_json = OLD.source_hashes_json
    AND NEW.created_at = OLD.created_at
    AND ((NEW.state = 'complete' AND NEW.completed_at IS NOT NULL)
      OR (NEW.state = 'failed' AND NEW.completed_at IS NULL))
  )
  BEGIN
    SELECT RAISE(ABORT, 'immutable generation: only staging transition is allowed');
  END;
  CREATE TRIGGER building_control_source_generations_delete_guard
  BEFORE DELETE ON building_control_source_generations
  BEGIN
    SELECT RAISE(ABORT, 'immutable generation: deletion is forbidden');
  END;

  CREATE TRIGGER building_control_coverage_update_guard
  BEFORE UPDATE ON building_control_coverage
  BEGIN
    SELECT RAISE(ABORT, 'immutable coverage');
  END;
  CREATE TRIGGER building_control_coverage_delete_guard
  BEFORE DELETE ON building_control_coverage
  BEGIN
    SELECT RAISE(ABORT, 'immutable coverage');
  END;
  CREATE TRIGGER building_control_manifest_sources_update_guard
  BEFORE UPDATE ON building_control_manifest_sources
  BEGIN
    SELECT RAISE(ABORT, 'immutable manifest sources');
  END;
  CREATE TRIGGER building_control_manifest_sources_delete_guard
  BEFORE DELETE ON building_control_manifest_sources
  BEGIN
    SELECT RAISE(ABORT, 'immutable manifest sources');
  END;
  CREATE TRIGGER building_control_market_manifests_update_guard
  BEFORE UPDATE ON building_control_market_manifests
  BEGIN
    SELECT RAISE(ABORT, 'immutable market manifest');
  END;
  CREATE TRIGGER building_control_market_manifests_delete_guard
  BEFORE DELETE ON building_control_market_manifests
  BEGIN
    SELECT RAISE(ABORT, 'immutable market manifest');
  END;

  CREATE TRIGGER excellent_designations_immutable_update_guard
  BEFORE UPDATE ON excellent_designations
  BEGIN
    SELECT RAISE(ABORT, 'immutable designation identity');
  END;
  CREATE TRIGGER excellent_designations_immutable_delete_guard
  BEFORE DELETE ON excellent_designations
  BEGIN
    SELECT RAISE(ABORT, 'immutable designation identity');
  END;
`;

const REQUIRED_TRIGGERS = [
  ...SOURCE_FACT_TABLES.flatMap(([table]) => [
    `${table}_staging_insert_guard`,
    `${table}_staging_update_guard`,
    `${table}_staging_delete_guard`,
  ]),
  "building_control_generation_memberships_staging_insert_guard",
  "building_control_generation_memberships_staging_update_guard",
  "building_control_generation_memberships_staging_delete_guard",
  "building_control_awards_revision_guard",
  "award_classifications_provenance_guard",
  "building_control_manifest_sources_coverage_guard",
  "building_control_source_generations_transition_guard",
  "building_control_source_generations_delete_guard",
  "building_control_coverage_update_guard",
  "building_control_coverage_delete_guard",
  "building_control_manifest_sources_update_guard",
  "building_control_manifest_sources_delete_guard",
  "building_control_market_manifests_update_guard",
  "building_control_market_manifests_delete_guard",
  "excellent_designations_immutable_update_guard",
  "excellent_designations_immutable_delete_guard",
] as const;

const MIGRATION_CHECKSUM = createHash("sha256")
  .update(TASK3_DDL)
  .update(FACT_GUARD_DDL)
  .update(PROVENANCE_TRIGGER_DDL)
  .digest("hex");

function normalizeSchemaSql(value: string): string {
  return value.trim().replace(/;\s*$/, "").replace(/\s+/g, " ").toLowerCase();
}

function expectedTriggerDefinitions(): Map<string, string> {
  const definitions = new Map<string, string>();
  const source = `${FACT_GUARD_DDL}\n${PROVENANCE_TRIGGER_DDL}`;
  const pattern = /create\s+trigger\s+([a-z0-9_]+)[\s\S]*?\bend\s*;/gi;
  for (const match of source.matchAll(pattern)) {
    definitions.set(match[1]!, normalizeSchemaSql(match[0]));
  }
  return definitions;
}

function expectedSchemaDefinitions(): Map<string, string> {
  const definitions = new Map<string, string>();
  const tablePattern = /create\s+table\s+([a-z0-9_]+)\s*\([\s\S]*?\n\s*\);/gi;
  const indexPattern = /create\s+(?:unique\s+)?index\s+([a-z0-9_]+)[\s\S]*?;/gi;
  for (const pattern of [tablePattern, indexPattern]) {
    for (const match of TASK3_DDL.matchAll(pattern)) {
      definitions.set(match[1]!, normalizeSchemaSql(match[0]));
    }
  }
  return definitions;
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(name),
  );
}

function indexExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare("select 1 from sqlite_master where type = 'index' and name = ?")
      .get(name),
  );
}

function triggerExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare(
        "select 1 from sqlite_master where type = 'trigger' and name = ?",
      )
      .get(name),
  );
}

function columnNames(db: Database.Database, table: string): Set<string> {
  return new Set(
    (
      db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>
    ).map((column) => column.name),
  );
}

function validateExistingSchema(db: Database.Database): void {
  const ledger = db
    .prepare(
      `
      select version, name, checksum
      from building_control_schema_migrations
      where version = ?
    `,
    )
    .get(MIGRATION_VERSION) as
    { version: number; name: string; checksum: string } | undefined;
  if (
    ledger?.name !== MIGRATION_NAME ||
    ledger.checksum !== MIGRATION_CHECKSUM
  ) {
    throw new Error(
      "incompatible schema: building-control migration ledger mismatch",
    );
  }

  const missingTables = REQUIRED_TABLES.filter(
    (table) => !tableExists(db, table),
  );
  const missingIndexes = REQUIRED_INDEXES.filter(
    (index) => !indexExists(db, index),
  );
  const missingTriggers = REQUIRED_TRIGGERS.filter(
    (trigger) => !triggerExists(db, trigger),
  );
  if (missingTables.length || missingIndexes.length || missingTriggers.length) {
    throw new Error(
      `incompatible schema: missing ${[
        ...missingTables,
        ...missingIndexes,
        ...missingTriggers,
      ].join(", ")}`,
    );
  }
  const expectedSchema = expectedSchemaDefinitions();
  for (const [name, expected] of expectedSchema) {
    const actual = db
      .prepare(
        "select sql from sqlite_master where name = ? and type in ('table', 'index')",
      )
      .get(name) as { sql: string } | undefined;
    if (!actual || normalizeSchemaSql(actual.sql) !== expected) {
      throw new Error(
        `incompatible schema: ${name} definition does not match migration`,
      );
    }
  }
  const expectedTriggers = expectedTriggerDefinitions();
  for (const trigger of REQUIRED_TRIGGERS) {
    const actual = db
      .prepare(
        "select sql from sqlite_master where type = 'trigger' and name = ?",
      )
      .get(trigger) as { sql: string } | undefined;
    if (
      !actual ||
      expectedTriggers.get(trigger) !== normalizeSchemaSql(actual.sql)
    ) {
      throw new Error(
        `incompatible schema: ${trigger} body does not match migration`,
      );
    }
  }

  const essentialColumns: Record<string, string[]> = {
    building_control_source_generations: [
      "sync_run_id",
      "source",
      "state",
      "expected_count",
      "observed_count",
      "identity_set_hash",
      "source_hashes_json",
    ],
    building_control_active_manifest: ["singleton", "manifest_id", "version"],
    building_control_manifest_sources: [
      "manifest_id",
      "source",
      "generation_id",
      "coverage_id",
    ],
  };
  for (const [table, required] of Object.entries(essentialColumns)) {
    const present = columnNames(db, table);
    if (required.some((column) => !present.has(column))) {
      throw new Error(
        `incompatible schema: ${table} columns do not match migration`,
      );
    }
  }

  const normalizedSql = (name: string) => {
    const row = db
      .prepare(
        "select sql from sqlite_master where type = 'table' and name = ?",
      )
      .get(name) as { sql: string } | undefined;
    return row?.sql.toLowerCase().replace(/\s+/g, " ") ?? "";
  };
  const requiredSqlFragments: Record<string, string[]> = {
    building_control_active_manifest: [
      "check (singleton = 1)",
      "check (version >= 0)",
    ],
    building_control_source_generations: [
      "'notice-publication'",
      "'award-classification'",
      "'staging'",
      "'complete'",
      "observed_count <= expected_count",
    ],
    excellent_designation_observations: ["'유효'", "'만료'", "'효력정지'"],
    award_classifications: ["'cooperative'", "'excellent'", "'non_excellent'"],
  };
  for (const [table, fragments] of Object.entries(requiredSqlFragments)) {
    const sql = normalizedSql(table);
    if (fragments.some((fragment) => !sql.includes(fragment))) {
      throw new Error(
        `incompatible schema: ${table} CHECK contract does not match migration`,
      );
    }
  }

  const requiredForeignKeys: Record<string, Array<[string, string, string]>> = {
    building_control_source_generations: [
      ["sync_run_id", "building_control_sync_runs", "id"],
    ],
    building_control_generation_memberships: [
      ["generation_id", "building_control_source_generations", "id"],
    ],
    building_control_notices: [
      ["generation_id", "building_control_source_generations", "id"],
    ],
    building_control_notice_products: [
      ["generation_id", "building_control_source_generations", "id"],
      ["notice_id", "building_control_notices", "id"],
    ],
    building_control_award_revisions: [
      ["generation_id", "building_control_source_generations", "id"],
      ["notice_id", "building_control_notices", "id"],
    ],
    building_control_awards: [
      ["generation_id", "building_control_source_generations", "id"],
      ["notice_id", "building_control_notices", "id"],
      ["selected_revision_id", "building_control_award_revisions", "id"],
    ],
    excellent_designation_observations: [
      ["generation_id", "building_control_source_generations", "id"],
      ["designation_id", "excellent_designations", "id"],
    ],
    award_classifications: [
      ["generation_id", "building_control_source_generations", "id"],
      ["award_revision_id", "building_control_award_revisions", "id"],
      [
        "designation_generation_id",
        "building_control_source_generations",
        "id",
      ],
      ["matched_observation_id", "excellent_designation_observations", "id"],
    ],
    building_control_coverage: [
      ["generation_id", "building_control_source_generations", "id"],
    ],
    building_control_market_manifests: [
      ["sync_run_id", "building_control_sync_runs", "id"],
    ],
    building_control_manifest_sources: [
      ["manifest_id", "building_control_market_manifests", "id"],
      ["generation_id", "building_control_source_generations", "id"],
      ["coverage_id", "building_control_coverage", "id"],
    ],
    building_control_active_manifest: [
      ["manifest_id", "building_control_market_manifests", "id"],
    ],
  };
  for (const [table, expected] of Object.entries(requiredForeignKeys)) {
    const actual = db
      .prepare(`pragma foreign_key_list(${table})`)
      .all() as Array<{
      from: string;
      table: string;
      to: string;
    }>;
    if (
      expected.some(
        ([from, target, to]) =>
          !actual.some(
            (foreignKey) =>
              foreignKey.from === from &&
              foreignKey.table === target &&
              foreignKey.to === to,
          ),
      )
    ) {
      throw new Error(
        `incompatible schema: ${table} foreign keys do not match migration`,
      );
    }
  }
}

export function applyBuildingControlMigration(db: Database.Database): void {
  const existingTaskTables = REQUIRED_TABLES.filter((table) =>
    tableExists(db, table),
  );
  if (existingTaskTables.length > 0) {
    if (!tableExists(db, "building_control_schema_migrations")) {
      throw new Error(
        "incompatible schema: partial building-control tables without ledger",
      );
    }
    validateExistingSchema(db);
    return;
  }

  db.exec(TASK3_DDL);
  db.exec(FACT_GUARD_DDL);
  db.exec(PROVENANCE_TRIGGER_DDL);
  db.prepare(
    `
    insert into building_control_schema_migrations (version, name, checksum, applied_at)
    values (?, ?, ?, ?)
  `,
  ).run(
    MIGRATION_VERSION,
    MIGRATION_NAME,
    MIGRATION_CHECKSUM,
    new Date().toISOString(),
  );
  validateExistingSchema(db);
}
