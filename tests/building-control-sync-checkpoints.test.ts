import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initializeSqliteSchema } from "@/lib/db/init";
import {
  computeSourceIdentityHash,
  createBuildingControlRepository,
  type BuildingControlRepository,
} from "@/lib/building-control/repository";

const databases: Database.Database[] = [];
const paths: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  while (paths.length > 0) {
    const dir = paths.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function checkpointPayload(seed: string, factCount: number) {
  const facts = Array.from({ length: factCount }, (_, index) => ({
    checkpointFact: seed,
    index,
  }));
  const identityHashes = facts.map((_, index) =>
    sha256(`${seed}-identity-${index}`),
  );
  const sourceHashes = Object.fromEntries(
    identityHashes.map((identityHash, index) => [
      identityHash,
      sha256(`${seed}-source-${index}`),
    ]),
  );
  const factJson = JSON.stringify({
    schemaVersion: 1,
    facts,
    identityHashes,
    sourceHashes,
  });
  return {
    factJson,
    identityHash: sha256([...identityHashes].sort().join("\n")),
    sourceHash: sha256(factJson),
  };
}

function openDb() {
  const directory = mkdtempSync(join(tmpdir(), "bc-sync-checkpoints-repo-"));
  paths.push(directory);
  const file = join(directory, "checkpoints.sqlite");
  const db = new Database(file);
  databases.push(db);
  initializeSqliteSchema(db);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return { db, repository: createBuildingControlRepository(db) };
}

function beginRun(
  repository: BuildingControlRepository,
  owner = "worker-checkpoints",
  now = "2026-08-21T00:00:00.000Z",
) {
  const fence = repository.acquireLease(owner, now, 60);
  expect(fence).not.toBeNull();
  const runId = repository.beginRun(
    {
      trigger: "manual",
      dateFrom: "2025-01-01",
      dateTo: "2026-08-21",
      seoulDate: "2026-08-21",
    },
    owner,
    fence!,
  );
  return { owner, fence: fence!, runId };
}

function registerBulkNoticePlan(
  repository: BuildingControlRepository,
  run: ReturnType<typeof beginRun>,
  requestKey: string,
  sealed: boolean,
) {
  repository.registerCollectorPlan({
    planId: "plan-a",
    name: "Plan A",
    description: "test plan",
    requestSetHash: sha256("plan-a-hash"),
    createdAt: "2026-08-21T00:00:00.000Z",
  });
  repository.registerExpectedRequests(
    run.runId,
    [
      {
        source: "notice-publication",
        role: "notice-publication-bulk",
        requestKey,
        dependencyRequestKey: null,
        collectorPlanId: "plan-a",
        canonicalQueryJson: "{}",
        now: "2026-08-21T00:00:00.000Z",
      },
    ],
    run.owner,
    run.fence,
  );
  if (sealed) {
    repository.sealExpectedRequestSet(
      run.runId,
      "plan-a",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );
  }
}

describe("building_control_sync_checkpoints schema", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("initializes schema with building_control_sync tables and migrations", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "bc-sync-checkpoints-"));
    tempDirs.push(tempDir);
    const dbPath = join(tempDir, "schema.sqlite");
    const db = new Database(dbPath);
    try {
      initializeSqliteSchema(db);

      const tableNames = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tableNames).toEqual(
        expect.arrayContaining([
          "building_control_sync_expected_requests",
          "building_control_sync_checkpoints",
          "building_control_sync_checkpoint_pages",
          "building_control_award_quarantine",
          "building_control_sync_request_sets",
          "building_control_generation_blocks",
        ]),
      );

      const migrations = db
        .prepare(
          "SELECT version FROM building_control_schema_migrations ORDER BY version",
        )
        .all()
        .map((row) => (row as { version: number }).version);

      expect(migrations).toEqual([1, 2, 3]);
    } finally {
      db.close();
    }
  });

  it("upgrades a v1 database to v3 with checkpoint and request-set tables", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "bc-sync-checkpoints-"));
    tempDirs.push(tempDir);
    const dbPath = join(tempDir, "upgrade.sqlite");
    const db = new Database(dbPath);
    try {
      initializeSqliteSchema(db);
      const before = db
        .prepare(
          "select version from building_control_schema_migrations order by version",
        )
        .all()
        .map((row) => (row as { version: number }).version);
      expect(before).toEqual([1, 2, 3]);

      db.exec(`
        drop table building_control_generation_blocks;
        drop table building_control_sync_request_sets;
        drop table building_control_sync_expected_requests;
        drop table building_control_sync_checkpoints;
        drop table building_control_sync_checkpoint_pages;
        drop table building_control_award_quarantine;
        drop table building_control_collector_plans;
        delete from building_control_schema_migrations where version in (2, 3);
      `);

      const mid = db
        .prepare(
          "select version from building_control_schema_migrations order by version",
        )
        .all()
        .map((row) => (row as { version: number }).version);
      expect(mid).toEqual([1]);

      initializeSqliteSchema(db);

      const after = db
        .prepare(
          "select version from building_control_schema_migrations order by version",
        )
        .all()
        .map((row) => (row as { version: number }).version);
      expect(after).toEqual([1, 2, 3]);

      const tableNames = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          "building_control_sync_expected_requests",
          "building_control_sync_checkpoints",
          "building_control_sync_checkpoint_pages",
          "building_control_award_quarantine",
          "building_control_collector_plans",
          "building_control_sync_request_sets",
          "building_control_generation_blocks",
        ]),
      );
    } finally {
      db.close();
    }
  });

  it("upgrades an existing v2 database to v3 atomically", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "bc-sync-checkpoints-"));
    tempDirs.push(tempDir);
    const dbPath = join(tempDir, "upgrade-v2.sqlite");
    const db = new Database(dbPath);
    try {
      initializeSqliteSchema(db);
      db.exec(`
        drop trigger building_control_sync_request_sets_update_guard;
        drop trigger building_control_sync_request_sets_delete_guard;
        drop trigger building_control_sync_expected_requests_insert_after_seal_guard;
        drop trigger building_control_sync_checkpoints_completed_update_guard;
        drop trigger building_control_sync_checkpoint_pages_completed_insert_guard;
        drop trigger building_control_sync_checkpoint_pages_completed_delete_guard;
        drop trigger building_control_generation_blocks_update_guard;
        drop trigger building_control_generation_blocks_delete_guard;
        drop table building_control_generation_blocks;
        drop table building_control_sync_request_sets;
        delete from building_control_schema_migrations where version = 3;
      `);
      const before = db
        .prepare(
          "select version from building_control_schema_migrations order by version",
        )
        .all()
        .map((row) => (row as { version: number }).version);
      expect(before).toEqual([1, 2]);

      initializeSqliteSchema(db);

      const after = db
        .prepare(
          "select version from building_control_schema_migrations order by version",
        )
        .all()
        .map((row) => (row as { version: number }).version);
      expect(after).toEqual([1, 2, 3]);
      const v3Tables = db
        .prepare(
          `select name from sqlite_master where type = 'table'
           and name in ('building_control_generation_blocks',
                        'building_control_sync_request_sets') order by name`,
        )
        .all()
        .map((row) => (row as { name: string }).name);
      expect(v3Tables).toEqual([
        "building_control_generation_blocks",
        "building_control_sync_request_sets",
      ]);
    } finally {
      db.close();
    }
  });

  it("rolls back an interrupted v2 migration without recording a v2 ledger row", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "bc-sync-checkpoints-"));
    tempDirs.push(tempDir);
    const dbPath = join(tempDir, "rollback.sqlite");
    const db = new Database(dbPath);
    try {
      initializeSqliteSchema(db);
      db.exec(`
        drop table building_control_generation_blocks;
        drop table building_control_sync_request_sets;
        drop table building_control_sync_expected_requests;
        drop table building_control_sync_checkpoints;
        drop table building_control_sync_checkpoint_pages;
        drop table building_control_award_quarantine;
        drop table building_control_collector_plans;
        delete from building_control_schema_migrations where version in (2, 3);
      `);

      db.exec(`
        create table building_control_sync_expected_requests (
          id integer primary key,
          broken integer
        );
      `);

      expect(() => initializeSqliteSchema(db)).toThrow();

      const version = db
        .prepare(
          "select version from building_control_schema_migrations order by version",
        )
        .all()
        .map((row) => (row as { version: number }).version);
      expect(version).toEqual([1]);

      db.exec(`
        drop table building_control_sync_expected_requests;
      `);

      initializeSqliteSchema(db);
      const recovered = db
        .prepare(
          "select version from building_control_schema_migrations order by version",
        )
        .all()
        .map((row) => (row as { version: number }).version);
      expect(recovered).toEqual([1, 2, 3]);
    } finally {
      db.close();
    }
  });
});

describe("building_control_sync_checkpoints credential rejection", () => {
  it("rejects checkpoint payloads containing service keys", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(repository, run, "notice-bulk-credentials", true);

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-credentials",
          cursor: 1,
          pageSize: 10,
          totalCount: 10,
          factJson: JSON.stringify({
            items: [],
            serviceKey: "secret_sentinel",
          }),
          identityHash: sha256("page-credentials"),
          sourceHash: sha256("page-credentials-source"),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/service.?key|forbidden|credential|secret/i);
  });

  it("rejects checkpoint payloads containing request URLs with credentials", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(
      repository,
      run,
      "notice-bulk-url-credentials",
      true,
    );

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-url-credentials",
          cursor: 1,
          pageSize: 10,
          totalCount: 10,
          factJson: JSON.stringify({
            items: [],
            requestUrl:
              "https://example.invalid/data?serviceKey=secret_sentinel",
          }),
          identityHash: sha256("page-url-credentials"),
          sourceHash: sha256("page-url-credentials-source"),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/credential|forbidden|secret|url|service.?key/i);
  });

  it("rejects checkpoint payloads containing cookies", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(repository, run, "notice-bulk-cookies", true);

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-cookies",
          cursor: 1,
          pageSize: 10,
          totalCount: 10,
          factJson: JSON.stringify({
            items: [],
            cookie: "JSESSIONID=secret_sentinel",
          }),
          identityHash: sha256("page-cookie"),
          sourceHash: sha256("page-cookie-source"),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/cookie|forbidden|credential/i);
  });

  it("rejects checkpoint payloads containing authorization headers", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(repository, run, "notice-bulk-auth", true);

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-auth",
          cursor: 1,
          pageSize: 10,
          totalCount: 10,
          factJson: JSON.stringify({
            items: [],
            authorization: "Bearer secret_sentinel",
          }),
          identityHash: sha256("page-auth"),
          sourceHash: sha256("page-auth-source"),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/authorization|forbidden|credential/i);
  });

  it("rejects checkpoint payloads containing session identifiers", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(repository, run, "notice-bulk-session", true);

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-session",
          cursor: 1,
          pageSize: 10,
          totalCount: 10,
          factJson: JSON.stringify({
            items: [],
            sessionId: "secret_sentinel",
          }),
          identityHash: sha256("page-session"),
          sourceHash: sha256("page-session-source"),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/session|forbidden|credential/i);
  });

  it("accepts checkpoint payloads containing only public source facts and hashes", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(repository, run, "notice-bulk-clean", true);

    const result = repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk-clean",
        cursor: 1,
        pageSize: 10,
        totalCount: 10,
        ...checkpointPayload("page-clean", 10),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    expect(result.nextCursor).toBe(2);
  });

  it("persists detail cursors only for designation-detail requests", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    repository.registerCollectorPlan({
      planId: "plan-detail-cursor",
      name: "Designation detail cursor plan",
      description: "tests detail checkpoint cursor semantics",
      requestSetHash: sha256("plan-detail-cursor"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      run.runId,
      ["designation-detail-ok", "designation-detail-wrong"].map(
        (requestKey) => ({
          source: "designation-history" as const,
          role: "designation-detail" as const,
          requestKey,
          dependencyRequestKey: null,
          collectorPlanId: "plan-detail-cursor",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        }),
      ),
      run.owner,
      run.fence,
    );
    repository.sealExpectedRequestSet(
      run.runId,
      "plan-detail-cursor",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );

    const detail = repository.stageCheckpointPage(
      {
        source: "designation-history",
        requestKey: "designation-detail-ok",
        cursorKind: "detail",
        cursor: 1,
        pageSize: 1,
        totalCount: 1,
        ...checkpointPayload("designation-detail-ok", 1),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    expect(detail.cursorKind).toBe("detail");

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "designation-history",
          requestKey: "designation-detail-wrong",
          cursorKind: "page",
          cursor: 1,
          pageSize: 1,
          totalCount: 1,
          ...checkpointPayload("designation-detail-wrong", 1),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/cursor kind|designation.detail/i);
  });

  it("rejects checkpoint hashes that are not derived from the persisted chunk payload", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(
      repository,
      run,
      "notice-bulk-hash-binding",
      true,
    );

    const identity = sha256("notice:20250821001|00");
    const sourceHash = sha256("notice-source-row");
    const factJson = JSON.stringify({
      schemaVersion: 1,
      facts: [{ noticeNo: "20250821001", noticeOrder: "00" }],
      identityHashes: [identity],
      sourceHashes: { [identity]: sourceHash },
    });

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-hash-binding",
          cursor: 1,
          pageSize: 10,
          totalCount: 1,
          factJson,
          identityHash: sha256("wrong-identity-set"),
          sourceHash: sha256(factJson),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/identity.*hash|hash.*identity|derived|mismatch/i);
  });

  it("rejects a checkpoint payload whose source hash map does not match its identities", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(repository, run, "notice-bulk-source-map", true);
    const identity = sha256("notice:source-map");
    const factJson = JSON.stringify({
      schemaVersion: 1,
      facts: [{ noticeNo: "20250821004", noticeOrder: "00" }],
      identityHashes: [identity],
      sourceHashes: {},
    });

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-source-map",
          cursor: 1,
          pageSize: 10,
          totalCount: 1,
          factJson,
          identityHash: sha256(identity),
          sourceHash: sha256(factJson),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/source.*hash|hash.*map|missing|identity/i);
  });

  it("rejects a checkpoint page whose fact count does not match provider cardinality", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(repository, run, "notice-bulk-cardinality", true);
    const factJson = JSON.stringify({
      schemaVersion: 1,
      facts: [],
      identityHashes: [],
      sourceHashes: {},
    });

    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-cardinality",
          cursor: 1,
          pageSize: 10,
          totalCount: 1,
          factJson,
          identityHash: sha256(""),
          sourceHash: sha256(factJson),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/fact|cardinality|count|page/i);
  });
});

describe("building_control_sync_checkpoints snapshot writer guards", () => {
  it("rejects a snapshot when its persisted request-set seal is tampered", () => {
    const { db, repository } = openDb();
    const run = beginRun(repository);
    const requestKey = "notice-bulk-seal-tamper";
    registerBulkNoticePlan(repository, run, requestKey, true);
    const notice = {
      noticeNo: "20250821997",
      noticeOrder: "00",
      noticeName: "Seal evidence notice",
      publicationDate: "2025-08-21",
      demandAgencyCode: null,
      demandAgencyName: "Agency",
      noticeUrl: null,
      status: "active",
      targetParentProductCode: null,
      targetDetailProductCode: null,
      rawJson: "{}",
      sourceHash: sha256("seal-evidence-notice"),
    };
    const identityHash = computeSourceIdentityHash("notice-publication", [
      notice.noticeNo,
      notice.noticeOrder,
    ]);
    const factJson = JSON.stringify({
      schemaVersion: 1,
      facts: [notice],
      identityHashes: [identityHash],
      sourceHashes: { [identityHash]: notice.sourceHash },
    });
    repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey,
        cursor: 1,
        pageSize: 1,
        totalCount: 1,
        factJson,
        identityHash: sha256(identityHash),
        sourceHash: sha256(factJson),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    repository.completeCheckpoint(
      run.runId,
      "notice-publication",
      requestKey,
      run.owner,
      run.fence,
      "2026-08-21T00:03:00.000Z",
    );
    db.exec("drop trigger building_control_sync_request_sets_update_guard");
    db.prepare(
      "update building_control_sync_request_sets set request_set_hash = ? where sync_run_id = ?",
    ).run(sha256("tampered-request-set"), run.runId);

    expect(() =>
      repository.stageNoticeSnapshot(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          expectedCount: 1,
          pageCount: 1,
          notices: [notice],
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/request.*set|seal|hash/i);
  });

  it("rejects a notice snapshot whose facts differ from its completed checkpoint payload", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(
      repository,
      run,
      "notice-bulk-payload-mismatch",
      true,
    );
    const checkpointNotice = {
      noticeNo: "20250821998",
      noticeOrder: "00",
      noticeName: "Checkpoint Notice",
      publicationDate: "2025-08-21",
      demandAgencyCode: null,
      demandAgencyName: "Agency",
      noticeUrl: null,
      status: "active",
      targetParentProductCode: null,
      targetDetailProductCode: null,
      rawJson: "{}",
      sourceHash: sha256("checkpoint-notice-source"),
    };
    const identityHash = computeSourceIdentityHash("notice-publication", [
      checkpointNotice.noticeNo,
      checkpointNotice.noticeOrder,
    ]);
    const factJson = JSON.stringify({
      schemaVersion: 1,
      facts: [checkpointNotice],
      identityHashes: [identityHash],
      sourceHashes: { [identityHash]: checkpointNotice.sourceHash },
    });
    repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk-payload-mismatch",
        cursor: 1,
        pageSize: 10,
        totalCount: 1,
        factJson,
        identityHash: sha256(identityHash),
        sourceHash: sha256(factJson),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    repository.completeCheckpoint(
      run.runId,
      "notice-publication",
      "notice-bulk-payload-mismatch",
      run.owner,
      run.fence,
      "2026-08-21T00:03:00.000Z",
    );

    expect(() =>
      repository.stageNoticeSnapshot(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          expectedCount: 1,
          pageCount: 1,
          notices: [
            {
              ...checkpointNotice,
              noticeName: "Tampered Notice",
            },
          ],
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/checkpoint|payload|mismatch|fact/i);
  });

  it("rejects stageNoticeSnapshot when a sealed request has no completed checkpoint", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(
      repository,
      run,
      "notice-bulk-no-checkpoint",
      true,
    );

    expect(() =>
      repository.stageNoticeSnapshot(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          expectedCount: 1,
          pageCount: 1,
          notices: [
            {
              noticeNo: "20250821003",
              noticeOrder: "00",
              noticeName: "Notice 3",
              publicationDate: "2025-08-21",
              demandAgencyCode: null,
              demandAgencyName: "Agency",
              noticeUrl: null,
              status: "active",
              targetParentProductCode: null,
              targetDetailProductCode: null,
              rawJson: "{}",
              sourceHash: sha256("notice-no-checkpoint"),
            },
          ],
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/checkpoint|complete|request/i);
  });

  it("rejects stageNoticeSnapshot when the request set is not sealed", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      run.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk-unsealed",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      run.owner,
      run.fence,
    );
    expect(() =>
      repository.stageNoticeSnapshot(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          expectedCount: 1,
          pageCount: 1,
          notices: [
            {
              noticeNo: "20250821001",
              noticeOrder: "00",
              noticeName: "Notice 1",
              publicationDate: "2025-08-21",
              demandAgencyCode: null,
              demandAgencyName: "Agency",
              noticeUrl: null,
              status: "active",
              targetParentProductCode: null,
              targetDetailProductCode: null,
              rawJson: "{}",
              sourceHash: sha256("notice-unsealed"),
            },
          ],
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/sealed|unsealed|request.?set|not.*sealed/i);
  });

  it("rejects stageNoticeSnapshot when the request set has no registered request entry for the source", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      run.runId,
      [
        {
          source: "designation-history",
          role: "designation-list-all",
          requestKey: "designation-list-all-other",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      run.owner,
      run.fence,
    );
    repository.sealExpectedRequestSet(
      run.runId,
      "plan-a",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );
    expect(() =>
      repository.stageNoticeSnapshot(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          expectedCount: 1,
          pageCount: 1,
          notices: [
            {
              noticeNo: "20250821002",
              noticeOrder: "00",
              noticeName: "Notice 2",
              publicationDate: "2025-08-21",
              demandAgencyCode: null,
              demandAgencyName: "Agency",
              noticeUrl: null,
              status: "active",
              targetParentProductCode: null,
              targetDetailProductCode: null,
              rawJson: "{}",
              sourceHash: sha256("notice-missing-req"),
            },
          ],
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/request|missing|absent|required|sealed/i);
  });

  it("rejects duplicate request identities within a single register call", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    expect(() =>
      repository.registerExpectedRequests(
        run.runId,
        [
          {
            source: "notice-publication",
            role: "notice-publication-bulk",
            requestKey: "dup-key",
            dependencyRequestKey: null,
            collectorPlanId: "plan-a",
            canonicalQueryJson: "{}",
            now: "2026-08-21T00:00:00.000Z",
          },
          {
            source: "award-registration",
            role: "award-registration-bulk",
            requestKey: "dup-key",
            dependencyRequestKey: null,
            collectorPlanId: "plan-a",
            canonicalQueryJson: "{}",
            now: "2026-08-21T00:00:00.000Z",
          },
        ],
        run.owner,
        run.fence,
      ),
    ).toThrow(/duplicate/i);
  });
});

describe("building_control_sync_checkpoints resume behavior", () => {
  it("rehydrates validated facts and hashes in persisted resume chunks", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    const requestKey = "notice-bulk-rehydrate";
    registerBulkNoticePlan(repository, run, requestKey, true);
    const payload = checkpointPayload("rehydrate-page1", 2);
    repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey,
        cursor: 1,
        pageSize: 2,
        totalCount: 2,
        ...payload,
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    const seed = repository.readResumeSeed(
      run.runId,
      "notice-publication",
      requestKey,
    );
    const expectedPayload = JSON.parse(payload.factJson) as {
      facts: unknown[];
      identityHashes: string[];
      sourceHashes: Record<string, string>;
    };
    const chunk = seed?.persistedChunks[0];

    expect(seed?.persistedChunks).toHaveLength(1);
    expect(chunk).toMatchObject({
      source: "notice-publication",
      requestKey,
      cursorKind: "page",
      cursor: 1,
      pageSize: 2,
      totalCount: 2,
    });
    expect(chunk?.facts).toEqual(expectedPayload.facts);
    expect(chunk?.identityHashes).toEqual(expectedPayload.identityHashes);
    expect(chunk?.sourceHashes).toEqual(expectedPayload.sourceHashes);
  });

  it("returns the saved next cursor as the first fetched page after resume", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      run.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk-resume",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      run.owner,
      run.fence,
    );
    repository.sealExpectedRequestSet(
      run.runId,
      "plan-a",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );
    repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk-resume",
        cursor: 1,
        pageSize: 10,
        totalCount: 25,
        ...checkpointPayload("page1-resume", 10),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk-resume",
        cursor: 2,
        pageSize: 10,
        totalCount: 25,
        ...checkpointPayload("page2-resume", 10),
        now: "2026-08-21T00:02:30.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    const seed = repository.readResumeSeed(
      run.runId,
      "notice-publication",
      "notice-bulk-resume",
    );
    expect(seed?.nextCursor).toBe(3);
    expect(seed?.persistedChunks.length).toBe(2);
  });

  it("rejects an unexpected page cursor that drifts from the saved cursor", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      run.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk-drift",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      run.owner,
      run.fence,
    );
    repository.sealExpectedRequestSet(
      run.runId,
      "plan-a",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );
    repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk-drift",
        cursor: 1,
        pageSize: 10,
        totalCount: 25,
        ...checkpointPayload("page1-drift", 10),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-drift",
          cursor: 5,
          pageSize: 10,
          totalCount: 25,
          ...checkpointPayload("page5-drift", 0),
          now: "2026-08-21T00:02:30.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/cursor.*drift|drift/i);
  });

  it("resetDriftedCheckpoint returns the next cursor to 1 and clears chunks", () => {
    const { db, repository } = openDb();
    const run = beginRun(repository);
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      run.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk-reset",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      run.owner,
      run.fence,
    );
    repository.sealExpectedRequestSet(
      run.runId,
      "plan-a",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );
    repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk-reset",
        cursor: 1,
        pageSize: 10,
        totalCount: 25,
        ...checkpointPayload("page1-reset", 10),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    const reset = repository.resetDriftedCheckpoint(
      run.runId,
      "notice-publication",
      "notice-bulk-reset",
      run.owner,
      run.fence,
    );
    expect(reset).toBe("reset");
    const seed = repository.readResumeSeed(
      run.runId,
      "notice-publication",
      "notice-bulk-reset",
    );
    expect(seed?.nextCursor).toBe(1);
    expect(seed?.observedCount).toBe(0);
    expect(seed?.collectedIdentities.length).toBe(0);
    const chunksCount = db
      .prepare(
        `select count(*) as count from building_control_sync_checkpoint_pages`,
      )
      .get() as { count: number };
    expect(chunksCount.count).toBe(0);
  });

  it("preserves completed drift evidence and requests a new sync run", () => {
    const { repository } = openDb();
    const run = beginRun(repository);
    registerBulkNoticePlan(repository, run, "notice-bulk-complete-drift", true);
    repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk-complete-drift",
        cursor: 1,
        pageSize: 10,
        totalCount: 1,
        ...checkpointPayload("complete-drift", 1),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    repository.completeCheckpoint(
      run.runId,
      "notice-publication",
      "notice-bulk-complete-drift",
      run.owner,
      run.fence,
      "2026-08-21T00:03:00.000Z",
    );
    const before = repository.readResumeSeed(
      run.runId,
      "notice-publication",
      "notice-bulk-complete-drift",
    );

    expect(
      repository.resetDriftedCheckpoint(
        run.runId,
        "notice-publication",
        "notice-bulk-complete-drift",
        run.owner,
        run.fence,
      ),
    ).toBe("restart-run");
    expect(
      repository.readResumeSeed(
        run.runId,
        "notice-publication",
        "notice-bulk-complete-drift",
      ),
    ).toEqual(before);
  });
});

describe("building_control_sync_checkpoints lease fence guarantees", () => {
  it("a stale worker cannot stage a checkpoint page after the lease expires", () => {
    const { repository } = openDb();
    const run = beginRun(repository, "worker-a");
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      run.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk-stale",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      run.owner,
      run.fence,
    );
    repository.sealExpectedRequestSet(
      run.runId,
      "plan-a",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );
    repository.renewLease(run.owner, run.fence, "2026-08-21T00:00:00.000Z", 1);
    repository.acquireLease("worker-b", "2026-08-21T00:00:30.000Z", 60);
    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk-stale",
          cursor: 1,
          pageSize: 10,
          totalCount: 25,
          factJson: '{"items":[]}',
          identityHash: sha256("page-stale"),
          sourceHash: sha256("page-stale-source"),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/lease|fence/i);
  });

  it("a stale worker cannot stage a notice snapshot after the lease expires", () => {
    const { repository } = openDb();
    const run = beginRun(repository, "worker-a");
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      run.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk-stale-snapshot",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      run.owner,
      run.fence,
    );
    repository.sealExpectedRequestSet(
      run.runId,
      "plan-a",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );
    repository.renewLease(run.owner, run.fence, "2026-08-21T00:00:00.000Z", 1);
    repository.acquireLease("worker-b", "2026-08-21T00:00:30.000Z", 60);
    expect(() =>
      repository.stageNoticeSnapshot(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          expectedCount: 1,
          pageCount: 1,
          notices: [
            {
              noticeNo: "20250821001",
              noticeOrder: "00",
              noticeName: "Notice 1",
              publicationDate: "2025-08-21",
              demandAgencyCode: null,
              demandAgencyName: "Agency",
              noticeUrl: null,
              status: "active",
              targetParentProductCode: null,
              targetDetailProductCode: null,
              rawJson: "{}",
              sourceHash: sha256("notice-stale"),
            },
          ],
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/lease|fence/i);
  });
});
