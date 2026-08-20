import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initializeSqliteSchema } from "@/lib/db/init";
import {
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
        ]),
      );

      const migrations = db
        .prepare(
          "SELECT version FROM building_control_schema_migrations ORDER BY version",
        )
        .all()
        .map((row) => (row as { version: number }).version);

      expect(migrations).toEqual([1, 2]);
    } finally {
      db.close();
    }
  });

  it("upgrades a v1 database to v2 with new checkpoint and quarantine tables", () => {
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
      expect(before).toEqual([1, 2]);

      db.exec(`
        drop table building_control_sync_expected_requests;
        drop table building_control_sync_checkpoints;
        drop table building_control_sync_checkpoint_pages;
        drop table building_control_award_quarantine;
        drop table building_control_collector_plans;
        delete from building_control_schema_migrations where version = 2;
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
      expect(after).toEqual([1, 2]);

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
        ]),
      );
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
        drop table building_control_sync_expected_requests;
        drop table building_control_sync_checkpoints;
        drop table building_control_sync_checkpoint_pages;
        drop table building_control_award_quarantine;
        drop table building_control_collector_plans;
        delete from building_control_schema_migrations where version = 2;
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
      expect(recovered).toEqual([1, 2]);
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
        factJson: JSON.stringify({
          items: [
            { bidNtceNo: "20250821001", bidNtceOrd: "00", bidNtceNm: "Test" },
          ],
        }),
        identityHash: sha256("page-clean"),
        sourceHash: sha256("page-clean-source"),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    expect(result.nextCursor).toBe(2);
  });
});

describe("building_control_sync_checkpoints snapshot writer guards", () => {
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
        factJson: '{"items":[]}',
        identityHash: sha256("page1-resume"),
        sourceHash: sha256("page1-resume-source"),
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
        factJson: '{"items":[]}',
        identityHash: sha256("page2-resume"),
        sourceHash: sha256("page2-resume-source"),
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
        factJson: '{"items":[]}',
        identityHash: sha256("page1-drift"),
        sourceHash: sha256("page1-drift-source"),
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
          factJson: '{"items":[]}',
          identityHash: sha256("page5-drift"),
          sourceHash: sha256("page5-drift-source"),
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
        factJson: '{"items":[]}',
        identityHash: sha256("page1-reset"),
        sourceHash: sha256("page1-reset-source"),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    repository.resetDriftedCheckpoint(
      run.runId,
      "notice-publication",
      "notice-bulk-reset",
      run.owner,
      run.fence,
    );
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
