import Database from "better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { initializeSqliteSchema } from "@/lib/db/init";
import * as schema from "@/lib/db/schema";

const REQUIRED_TABLES = [
  "building_control_notices",
  "building_control_notice_products",
  "building_control_award_revisions",
  "building_control_awards",
  "excellent_designations",
  "excellent_designation_observations",
  "award_classifications",
  "building_control_schema_migrations",
  "building_control_source_generations",
  "building_control_generation_memberships",
  "building_control_manifest_sources",
  "building_control_sync_runs",
  "building_control_sync_leases",
  "building_control_coverage",
  "building_control_market_manifests",
  "building_control_active_manifest",
  "building_control_sync_expected_requests",
  "building_control_sync_checkpoints",
  "building_control_sync_checkpoint_pages",
  "building_control_award_quarantine",
  "building_control_collector_plans",
] as const;

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "select name from sqlite_master where type = 'table' order by name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function foreignKeys(db: Database.Database, table: string) {
  return db.prepare(`pragma foreign_key_list(${table})`).all() as Array<{
    from: string;
    table: string;
    to: string;
  }>;
}

describe("building-control versioned schema", () => {
  it("upgrades a populated legacy database twice without losing data", () => {
    const db = new Database(":memory:");
    db.exec(`
      create table businesses (
        id integer primary key,
        biz_no_normalized text not null,
        biz_no_display text,
        business_name text,
        representative_name text,
        address text,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      );
      insert into businesses (biz_no_normalized, business_name)
      values ('1234567890', 'Legacy Co');
    `);

    initializeSqliteSchema(db);
    initializeSqliteSchema(db);

    expect(tableNames(db)).toEqual(
      expect.arrayContaining([...REQUIRED_TABLES]),
    );
    expect(
      db
        .prepare(
          "select business_name from businesses where biz_no_normalized = ?",
        )
        .get("1234567890"),
    ).toEqual({ business_name: "Legacy Co" });

    const migration = db
      .prepare(
        "select version, name, checksum from building_control_schema_migrations order by version",
      )
      .all() as Array<{ version: number; name: string; checksum: string }>;
    expect(migration).toHaveLength(2);
    expect(migration.map((m) => m.version)).toEqual([1, 2]);
    expect(migration[0]).toMatchObject({
      version: 1,
      name: "building-control-versioned-market-data",
    });
    expect(migration[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(migration[1]).toMatchObject({
      version: 2,
      name: "building-control-sync-checkpoints",
    });
    expect(migration[1]?.checksum).toMatch(/^[0-9a-f]{64}$/);

    expect(
      db
        .prepare(
          "select singleton, manifest_id, version from building_control_active_manifest",
        )
        .get(),
    ).toEqual({ singleton: 1, manifest_id: null, version: 0 });
    db.close();
  });

  it("declares source, state, category, foreign-key, and append-only constraints", () => {
    const db = new Database(":memory:");
    initializeSqliteSchema(db);

    const sourceSql = (
      db
        .prepare(
          "select sql from sqlite_master where type = 'table' and name = ?",
        )
        .get("building_control_source_generations") as { sql: string }
    ).sql;
    for (const source of [
      "notice-publication",
      "award-registration",
      "notice-product",
      "designation-history",
      "award-classification",
    ]) {
      expect(sourceSql).toContain(`'${source}'`);
    }
    for (const state of ["staging", "complete", "failed"]) {
      expect(sourceSql).toContain(`'${state}'`);
    }
    expect(sourceSql).toContain("observed_count <= expected_count");

    const classificationSql = (
      db
        .prepare(
          "select sql from sqlite_master where type = 'table' and name = ?",
        )
        .get("award_classifications") as { sql: string }
    ).sql;
    for (const category of [
      "cooperative",
      "excellent",
      "non_excellent",
      "incomplete",
    ]) {
      expect(classificationSql).toContain(`'${category}'`);
    }
    const observationSql = (
      db
        .prepare(
          "select sql from sqlite_master where type = 'table' and name = ?",
        )
        .get("excellent_designation_observations") as { sql: string }
    ).sql;
    for (const status of ["", "유효", "만료", "효력정지"]) {
      expect(observationSql).toContain(`'${status}'`);
    }

    expect(foreignKeys(db, "building_control_source_generations")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "sync_run_id",
          table: "building_control_sync_runs",
        }),
      ]),
    );
    expect(foreignKeys(db, "building_control_manifest_sources")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "manifest_id",
          table: "building_control_market_manifests",
        }),
        expect.objectContaining({
          from: "generation_id",
          table: "building_control_source_generations",
        }),
        expect.objectContaining({
          from: "coverage_id",
          table: "building_control_coverage",
        }),
      ]),
    );
    expect(foreignKeys(db, "building_control_awards")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "selected_revision_id",
          table: "building_control_award_revisions",
        }),
      ]),
    );

    const indexes = tableNames(db);
    expect(indexes).toContain("building_control_source_generations");
    const indexNames = (
      db
        .prepare("select name from sqlite_master where type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        "building_control_award_revisions_identity_unique",
        "building_control_awards_notice_unique",
        "excellent_designation_observations_version_unique",
        "award_classifications_evidence_unique",
        "building_control_sync_runs_startup_success_unique",
      ]),
    );
    db.close();
  });

  it("rejects a ledger-present schema whose CHECK contract was stripped", () => {
    const db = new Database(":memory:");
    initializeSqliteSchema(db);
    db.pragma("foreign_keys = OFF");
    db.exec(`
      drop table building_control_active_manifest;
      create table building_control_active_manifest (
        singleton integer primary key,
        manifest_id integer,
        version integer not null
      );
      insert into building_control_active_manifest values (1, null, 0);
    `);

    expect(() => initializeSqliteSchema(db)).toThrow(/incompatible|schema/i);
    db.close();
  });

  it("rejects a same-named trigger whose immutable body was replaced", () => {
    const db = new Database(":memory:");
    initializeSqliteSchema(db);
    db.exec(`
      drop trigger building_control_notices_staging_update_guard;
      create trigger building_control_notices_staging_update_guard
      before update on building_control_notices
      begin
        select 1;
      end;
    `);

    expect(() => initializeSqliteSchema(db)).toThrow(
      /trigger|incompatible|schema/i,
    );
    db.close();
  });

  it("rejects invalid and internally inconsistent source generations", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initializeSqliteSchema(db);
    db.prepare(
      `
      insert into building_control_sync_runs
        (trigger, date_from, date_to, seoul_date, status, lease_owner, lease_fence, started_at)
      values ('manual', '2025-01-01', '2025-12-31', '2026-08-21', 'running', 'owner-a', 1, '2026-08-21T00:00:00Z')
    `,
    ).run();

    const insert = db.prepare(`
      insert into building_control_source_generations
        (sync_run_id, source, state, date_from, date_to, expected_count, observed_count,
         page_count, identity_set_hash, source_hashes_json, created_at)
      values (1, ?, ?, '2025-01-01', '2025-12-31', ?, ?, 1, ?, '{}', '2026-08-21T00:00:00Z')
    `);
    const hash = "a".repeat(64);
    expect(() => insert.run("unknown", "staging", 1, 1, hash)).toThrow();
    expect(() =>
      insert.run("notice-publication", "unknown", 1, 1, hash),
    ).toThrow();
    expect(() =>
      insert.run("notice-publication", "staging", 1, 2, hash),
    ).toThrow();
    db.close();
  });

  it("rolls back an incompatible partial Task 3 schema and succeeds after repair", () => {
    const db = new Database(":memory:");
    db.exec(`
      create table businesses (
        id integer primary key,
        biz_no_normalized text not null,
        biz_no_display text,
        business_name text,
        representative_name text,
        address text,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      );
      insert into businesses (biz_no_normalized, business_name)
      values ('9999999999', 'Keep Me');
      create table building_control_sync_runs (id text);
    `);

    expect(() => initializeSqliteSchema(db)).toThrow(/incompatible|schema/i);
    expect(db.prepare("select business_name from businesses").get()).toEqual({
      business_name: "Keep Me",
    });
    expect(tableNames(db)).not.toContain("building_control_source_generations");

    db.exec("drop table building_control_sync_runs");
    expect(() => initializeSqliteSchema(db)).not.toThrow();
    expect(tableNames(db)).toContain("building_control_source_generations");
    db.close();
  });

  it("uses composite membership and manifest-source primary keys", () => {
    const db = new Database(":memory:");
    initializeSqliteSchema(db);

    const primaryKey = (table: string) =>
      (
        db.prepare(`pragma table_info(${table})`).all() as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);

    expect(primaryKey("building_control_generation_memberships")).toEqual([
      "generation_id",
      "entity_type",
      "entity_id",
      "source_hash",
    ]);
    expect(primaryKey("building_control_manifest_sources")).toEqual([
      "manifest_id",
      "source",
    ]);
    db.close();
  });

  it("keeps Drizzle CHECK declarations aligned with the authoritative DDL", () => {
    const checkNames = [
      schema.buildingControlSchemaMigrations,
      schema.buildingControlSyncRuns,
      schema.buildingControlSyncLeases,
      schema.buildingControlSourceGenerations,
      schema.buildingControlGenerationMemberships,
      schema.buildingControlNotices,
      schema.buildingControlNoticeProducts,
      schema.buildingControlAwardRevisions,
      schema.excellentDesignationObservations,
      schema.awardClassifications,
      schema.buildingControlCoverage,
      schema.buildingControlManifestSources,
      schema.buildingControlActiveManifest,
    ].flatMap((table) =>
      getTableConfig(table).checks.map((check) => check.name),
    );

    expect(checkNames).toEqual(
      expect.arrayContaining([
        "building_control_schema_migrations_checksum_check",
        "building_control_sync_runs_fence_check",
        "building_control_sync_leases_name_check",
        "building_control_source_generations_completion_check",
        "building_control_generation_memberships_identity_hash_check",
        "building_control_notice_products_exact_match_check",
        "excellent_designation_observations_status_check",
        "award_classifications_category_check",
        "building_control_coverage_hash_check",
        "building_control_manifest_sources_source_check",
        "building_control_active_manifest_singleton_check",
      ]),
    );
  });
});
