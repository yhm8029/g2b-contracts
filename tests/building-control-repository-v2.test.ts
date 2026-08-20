import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBuildingControlRepository,
  computeSourceIdentityHash,
  type BuildingControlRepository,
} from "@/lib/building-control/repository";
import { initializeSqliteSchema } from "@/lib/db/init";

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

const databases: Database.Database[] = [];
const paths: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const path of paths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function openDb() {
  const directory = mkdtempSync(join(tmpdir(), "bc-v2-repository-"));
  paths.push(directory);
  const file = join(directory, "v2.sqlite");
  const db = new Database(file);
  databases.push(db);
  initializeSqliteSchema(db);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return { db, repository: createBuildingControlRepository(db) };
}

function beginRun(
  repository: BuildingControlRepository,
  owner = "worker-v2",
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

function completeSinglePageCheckpoint(
  repository: BuildingControlRepository,
  run: { runId: number; owner: string; fence: number },
  source: Parameters<BuildingControlRepository["readCheckpoint"]>[1],
  requestKey: string,
) {
  repository.stageCheckpointPage(
    {
      source,
      requestKey,
      cursor: 1,
      pageSize: 10,
      totalCount: 1,
      ...checkpointPayload(requestKey, 1),
      now: "2026-08-21T00:02:00.000Z",
    },
    run.runId,
    run.owner,
    run.fence,
  );
  repository.completeCheckpoint(
    run.runId,
    source,
    requestKey,
    run.owner,
    run.fence,
    "2026-08-21T00:03:00.000Z",
  );
}

function completeCheckpointForFacts(
  repository: BuildingControlRepository,
  run: { runId: number; owner: string; fence: number },
  source: Parameters<BuildingControlRepository["readCheckpoint"]>[1],
  requestKey: string,
  facts: readonly unknown[],
  sourceHashes: Readonly<Record<string, string>>,
) {
  const identityHashes = Object.keys(sourceHashes);
  const factJson = JSON.stringify({
    schemaVersion: 1,
    facts,
    identityHashes,
    sourceHashes,
  });
  repository.stageCheckpointPage(
    {
      source,
      requestKey,
      cursor: 1,
      pageSize: 10,
      totalCount: facts.length,
      factJson,
      identityHash: sha256(
        [...identityHashes].sort().join(String.fromCharCode(10)),
      ),
      sourceHash: sha256(factJson),
      now: "2026-08-21T00:02:00.000Z",
    },
    run.runId,
    run.owner,
    run.fence,
  );
  repository.completeCheckpoint(
    run.runId,
    source,
    requestKey,
    run.owner,
    run.fence,
    "2026-08-21T00:03:00.000Z",
  );
}

describe("building_control_sync_expected_requests", () => {
  it("registers, seals, and reads expected requests", () => {
    const { db: _db, repository } = openDb();
    const run = beginRun(repository);
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    const ids = repository.registerExpectedRequests(
      run.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk-2025-01-01-2026-08-21",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: '{"window":"1"}',
          now: "2026-08-21T00:00:00.000Z",
        },
        {
          source: "award-registration",
          role: "award-registration-bulk",
          requestKey: "award-bulk-2025-01-01-2026-08-21",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: '{"window":"1"}',
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      run.owner,
      run.fence,
    );
    expect(ids).toHaveLength(2);
    const before = repository.readExpectedRequests(run.runId);
    expect(before).toHaveLength(2);
    expect(before.every((row) => row.state === "pending")).toBe(true);
    const sealed = repository.sealExpectedRequestSet(
      run.runId,
      "plan-a",
      run.owner,
      run.fence,
      "2026-08-21T00:01:00.000Z",
    );
    expect(sealed.sealed).toEqual([...ids].sort((a, b) => a - b));
    const after = repository.readExpectedRequests(run.runId);
    expect(after.every((row) => row.state === "sealed")).toBe(true);
    expect(after.every((row) => row.sealedAt !== null)).toBe(true);
  });

  it("rejects late requests for a source after its request set is sealed", () => {
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
          requestKey: "notice-initial",
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
    const seal = db
      .prepare(
        `
        select source, collector_plan_id, request_count, request_set_hash
        from building_control_sync_request_sets
        where sync_run_id = ?
        `,
      )
      .get(run.runId) as {
      source: string;
      collector_plan_id: string;
      request_count: number;
      request_set_hash: string;
    };
    expect(seal).toMatchObject({
      source: "notice-publication",
      collector_plan_id: "plan-a",
      request_count: 1,
    });
    expect(seal.request_set_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(() =>
      repository.registerExpectedRequests(
        run.runId,
        [
          {
            source: "notice-publication",
            role: "notice-publication-bulk",
            requestKey: "notice-late",
            dependencyRequestKey: null,
            collectorPlanId: "plan-a",
            canonicalQueryJson: "{}",
            now: "2026-08-21T00:02:00.000Z",
          },
        ],
        run.owner,
        run.fence,
      ),
    ).toThrow(/sealed|closed/i);
  });

  it("rejects duplicate request keys within a single register call", () => {
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
            requestKey: "dup",
            dependencyRequestKey: null,
            collectorPlanId: "plan-a",
            canonicalQueryJson: "{}",
            now: "2026-08-21T00:00:00.000Z",
          },
          {
            source: "notice-publication",
            role: "notice-publication-bulk",
            requestKey: "dup",
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

describe("building_control_sync_checkpoints", () => {
  it("stages a validated page and advances the next cursor", () => {
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
          requestKey: "notice-bulk",
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
    const first = repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk",
        cursor: 1,
        pageSize: 10,
        totalCount: 25,
        ...checkpointPayload("page1", 10),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    expect(first.nextCursor).toBe(2);
    expect(first.observedCount).toBe(1);
    const second = repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk",
        cursor: 2,
        pageSize: 10,
        totalCount: 25,
        ...checkpointPayload("page2", 10),
        now: "2026-08-21T00:02:30.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    expect(second.nextCursor).toBe(3);
    expect(second.observedCount).toBe(2);
    const third = repository.stageCheckpointPage(
      {
        source: "notice-publication",
        requestKey: "notice-bulk",
        cursor: 3,
        pageSize: 10,
        totalCount: 25,
        ...checkpointPayload("page3", 5),
        now: "2026-08-21T00:02:45.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    expect(third.nextCursor).toBe(4);
    expect(third.observedCount).toBe(3);
    const chunks = repository.readCheckpointChunks(
      run.runId,
      "notice-publication",
      "notice-bulk",
    );
    expect(chunks).toHaveLength(3);
    const completed = repository.completeCheckpoint(
      run.runId,
      "notice-publication",
      "notice-bulk",
      run.owner,
      run.fence,
      "2026-08-21T00:03:00.000Z",
    );
    expect(completed.state).toBe("complete");
    expect(
      repository.readCheckpoint(run.runId, "notice-publication", "notice-bulk")
        ?.state,
    ).toBe("complete");
  });

  it("rejects a checkpoint page from a stale fence", () => {
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
          requestKey: "notice-bulk",
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
    // expire the lease by moving wall clock past expiry
    repository.renewLease(run.owner, run.fence, "2026-08-21T00:00:00.000Z", 1);
    expect(
      repository.acquireLease("worker-b", "2026-08-21T00:00:30.000Z", 60),
    ).not.toBeNull();
    expect(() =>
      repository.stageCheckpointPage(
        {
          source: "notice-publication",
          requestKey: "notice-bulk",
          cursor: 1,
          pageSize: 10,
          totalCount: 25,
          factJson: "{}",
          identityHash: sha256("page1-identity"),
          sourceHash: sha256("page1-source"),
          now: "2026-08-21T00:02:00.000Z",
        },
        run.runId,
        run.owner,
        run.fence,
      ),
    ).toThrow(/lease|fence/i);
  });

  it("rejects completing a checkpoint before every expected page is staged", () => {
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
          requestKey: "notice-bulk",
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
        requestKey: "notice-bulk",
        cursor: 1,
        pageSize: 10,
        totalCount: 25,
        ...checkpointPayload("page1", 10),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    expect(() =>
      repository.completeCheckpoint(
        run.runId,
        "notice-publication",
        "notice-bulk",
        run.owner,
        run.fence,
        "2026-08-21T00:03:00.000Z",
      ),
    ).toThrow(/incomplete|missing|page/i);
  });
});

describe("building_control_sync_checkpoints adoptResumableRun", () => {
  it("adopts an expired resumable run with one collector plan", () => {
    const { repository } = openDb();
    const first = beginRun(repository, "worker-a", "2026-08-21T00:00:00.000Z");
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      first.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      first.owner,
      first.fence,
    );
    const adopted = repository.adoptResumableRun({
      owner: "worker-b",
      dateFrom: "2025-01-01",
      dateTo: "2026-08-21",
      seoulDate: "2026-08-21",
      collectorPlanId: "plan-a",
      now: "2026-08-21T00:01:30.000Z",
      ttlSeconds: 60,
    });
    expect(adopted.resumed).toBe(true);
    expect(adopted.runId).toBe(first.runId);
    expect(adopted.fence).toBeGreaterThan(first.fence);
  });

  it("refuses to adopt a resumable run whose lease is still active", () => {
    const { repository } = openDb();
    const first = beginRun(repository, "worker-a", "2026-08-21T00:00:00.000Z");
    repository.registerCollectorPlan({
      planId: "plan-a",
      name: "Plan A",
      description: "test plan",
      requestSetHash: sha256("plan-a-hash"),
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    repository.registerExpectedRequests(
      first.runId,
      [
        {
          source: "notice-publication",
          role: "notice-publication-bulk",
          requestKey: "notice-bulk",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
      ],
      first.owner,
      first.fence,
    );
    expect(() =>
      repository.adoptResumableRun({
        owner: "worker-b",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        seoulDate: "2026-08-21",
        collectorPlanId: "plan-a",
        now: "2026-08-21T00:00:10.000Z",
        ttlSeconds: 60,
      }),
    ).toThrow(/lease/i);
  });
});

describe("building_control_award_quarantine staging", () => {
  it("stages a notice snapshot and an award snapshot with quarantined observations", () => {
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
          requestKey: "notice-bulk-v2",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
        {
          source: "notice-product",
          role: "notice-identity-lookup",
          requestKey: "notice-product-v2",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
        {
          source: "award-registration",
          role: "award-registration-bulk",
          requestKey: "award-bulk-v2",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
        {
          source: "designation-history",
          role: "designation-list-all",
          requestKey: "designation-list-all-v2",
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
    const noticeRawHash = sha256("notice-raw");
    const noticeFact = {
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
      sourceHash: noticeRawHash,
    };
    const noticeIdentityHash = computeSourceIdentityHash(
      "notice-publication",
      [noticeFact.noticeNo, noticeFact.noticeOrder],
    );
    completeCheckpointForFacts(
      repository,
      run,
      "notice-publication",
      "notice-bulk-v2",
      [noticeFact],
      { [noticeIdentityHash]: noticeRawHash },
    );
    const noticeIds = repository.stageNoticeSnapshot(
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        expectedCount: 1,
        pageCount: 1,
        notices: [noticeFact],
      },
      run.owner,
      run.fence,
    );
    expect(noticeIds.idsBySourceIdentity["20250821001|00"]).toBeTypeOf(
      "number",
    );

    const productRawHash = sha256("product-raw");
    const productFact = {
      noticeNo: "20250821001",
      noticeOrder: "00",
      bidClassNo: "39121801",
      parentProductCode: "39121801",
      detailProductCode: null,
      providerRowIdentity: "row-1",
      exactMatch: 1 as const,
      rawJson: "{}",
      sourceHash: productRawHash,
    };
    const productFact2 = {
      ...productFact,
      bidClassNo: "3912180101",
      providerRowIdentity: "row-2",
      sourceHash: sha256("product-raw-2"),
    };
    const productFact3 = {
      ...productFact,
      bidClassNo: "39121802",
      providerRowIdentity: "row-3",
      exactMatch: 0 as const,
      sourceHash: sha256("product-raw-3"),
    };
    const productIdentityHash = computeSourceIdentityHash("notice-product", [
      productFact.noticeNo,
      productFact.noticeOrder,
      productFact.bidClassNo,
      productFact.providerRowIdentity,
    ]);
    const productIdentityHash2 = computeSourceIdentityHash("notice-product", [
      productFact2.noticeNo,
      productFact2.noticeOrder,
      productFact2.bidClassNo,
      productFact2.providerRowIdentity,
    ]);
    const productIdentityHash3 = computeSourceIdentityHash("notice-product", [
      productFact3.noticeNo,
      productFact3.noticeOrder,
      productFact3.bidClassNo,
      productFact3.providerRowIdentity,
    ]);
    completeCheckpointForFacts(
      repository,
      run,
      "notice-product",
      "notice-product-v2",
      [productFact, productFact2, productFact3],
      {
        [productIdentityHash]: productRawHash,
        [productIdentityHash2]: productFact2.sourceHash,
        [productIdentityHash3]: productFact3.sourceHash,
      },
    );
    const productIds = repository.stageNoticeProductSnapshot(
      {
        runId: run.runId,
        source: "notice-product",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        expectedCount: 3,
        pageCount: 1,
        products: [productFact, productFact2, productFact3],
      },
      run.owner,
      run.fence,
    );
    expect(
      productIds.idsBySourceIdentity["20250821001|00|39121801|row-1"],
    ).toBeTypeOf("number");

    const awardRawHash = sha256("award-raw");
    const awardFact = {
      noticeNo: "20250821001",
      noticeOrder: "00",
      bidClassNo: "39121801",
      rbidNo: "001",
      providerResultIdentity: "20250821001|00|39121801|001",
      finalAwardDate: "2025-08-22",
      winnerBizNo: "2148204708",
      winnerName: "Cooperative",
      sourceStatus: "final",
      winnerRowsJson: "[]",
      rawJson: "{}",
      sourceHash: awardRawHash,
      canonicalAward: {
        finalAwardDate: "2025-08-22",
        winnerBizNo: "2148204708",
        winnerName: "Cooperative",
        awardAmount: 1234567890,
        awardRate: "95.5",
        finalResultIdentity: "20250821001|00|39121801|001",
        rawJson: "{}",
      },
    };
    const awardFact2 = {
      ...awardFact,
      bidClassNo: "3912180101",
      providerResultIdentity: "20250821001|00|3912180101|001",
      sourceHash: sha256("award-raw-2"),
      canonicalAward: {
        ...awardFact.canonicalAward,
        finalResultIdentity: "20250821001|00|3912180101|001",
      },
    };
    const quarantineFact = {
      noticeNo: "20250821001",
      noticeOrder: "00",
      bidClassNo: "39121802",
      rbidNo: "002",
      providerResultIdentity: "20250821001|00|39121802|002",
      registeredAt: "2025-08-22 09:30:00",
      finalAwardDate: null,
      rawJson: "{}",
      sourceHash: sha256("quarantine-source"),
      reason: "missing_final_award_date" as const,
      pageNo: 1,
      pageIndex: 0,
      now: "2026-08-21T00:05:00.000Z",
    };
    const awardIdentityHash = computeSourceIdentityHash("award-registration", [
      awardFact.noticeNo,
      awardFact.noticeOrder,
      awardFact.bidClassNo,
      awardFact.rbidNo,
    ]);
    const awardIdentityHash2 = computeSourceIdentityHash(
      "award-registration",
      [
        awardFact2.noticeNo,
        awardFact2.noticeOrder,
        awardFact2.bidClassNo,
        awardFact2.rbidNo,
      ],
    );
    const quarantineIdentityHash = computeSourceIdentityHash(
      "award-registration",
      [
        quarantineFact.noticeNo,
        quarantineFact.noticeOrder,
        quarantineFact.bidClassNo,
        quarantineFact.rbidNo,
      ],
    );
    completeCheckpointForFacts(
      repository,
      run,
      "award-registration",
      "award-bulk-v2",
      [awardFact, awardFact2, quarantineFact],
      {
        [awardIdentityHash]: awardFact.sourceHash,
        [awardIdentityHash2]: awardFact2.sourceHash,
        [quarantineIdentityHash]: quarantineFact.sourceHash,
      },
    );
    const result = repository.stageAwardSnapshot(
      {
        runId: run.runId,
        source: "award-registration",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        expectedCount: 2,
        pageCount: 1,
        awards: [awardFact, awardFact2],
        quarantines: [quarantineFact],
      },
      run.owner,
      run.fence,
    );
    expect(result.promotionBlocked).toBe(false);
    expect(result.canonicalAwardIdsByNotice["20250821001|00"]).toBeTypeOf(
      "number",
    );
    const canonicalCount = db
      .prepare(
        "select count(*) as count from building_control_awards where generation_id = ?",
      )
      .get(result.generationId) as { count: number };
    expect(canonicalCount.count).toBe(1);

    const designationFact = {
      certificateNo: "CR-1",
      demandNo: "DM-1",
      changeOrder: "00",
      sequenceNo: "SQ-1",
      designationNo: "DSG-1",
      bizNoNormalized: "2148204708",
      observation: {
        bizNoNormalized: "2148204708",
        companyName: "Cooperative",
        startDate: "2024-01-01",
        originalEndDate: "2027-01-01",
        extensionEndDate: null,
        effectiveEndDate: "2027-01-01",
        status: "\uC720\uD6A8",
        productName: "\uC81C\uC5B4\uAE30",
        classificationCodesJson: '["39121801","3912180101"]',
        terminationState: "unverified",
        terminationEvidenceHash: null,
        cancellationDate: null,
        revocationDate: null,
        listIdentity: "list-1",
        detailIdentity: "detail-1",
        listRawJson: "{}",
        detailRawJson: "{}",
        sourceHash: sha256("designation-source"),
      },
    };
    const designationIdentityHash = computeSourceIdentityHash(
      "designation-history",
      [
        designationFact.certificateNo,
        designationFact.demandNo,
        designationFact.changeOrder,
        designationFact.sequenceNo,
      ],
    );
    completeCheckpointForFacts(
      repository,
      run,
      "designation-history",
      "designation-list-all-v2",
      [designationFact],
      { [designationIdentityHash]: designationFact.observation.sourceHash },
    );
    const designationIds = repository.stageDesignationSnapshot(
      {
        runId: run.runId,
        source: "designation-history",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        expectedCount: 1,
        pageCount: 1,
        designations: [designationFact],
      },
      run.owner,
      run.fence,
    );
    expect(
      designationIds.observationIdsBySourceIdentity["CR-1|DM-1|00|SQ-1"],
    ).toBeTypeOf("number");

    const quarantinedRows = db
      .prepare(
        `select count(*) as count from building_control_award_quarantine`,
      )
      .get() as { count: number };
    expect(quarantinedRows.count).toBe(1);
  });

  it.each([
    [
      "preserves a resolved award proven non-target without blocking promotion",
      "39121801",
      false,
      "none",
    ],
    [
      "blocks a resolved award when product correlation is missing",
      "39121802",
      true,
      "none",
    ],
    [
      "blocks an exact-target award quarantine",
      "39121801",
      true,
      "exact-target",
    ],
    [
      "blocks an award quarantine with an invalid registration timestamp",
      "39121801",
      true,
      "invalid-registration",
    ],
    [
      "blocks an award quarantine with an unrecoverable identity",
      "39121801",
      true,
      "unrecoverable-identity",
    ],
  ] as const)(
    "%s",
    (_name, productBidClassNo, expectedBlocked, quarantineKind) => {
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
          requestKey: "notice-bulk-blocked",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
        {
          source: "notice-product",
          role: "notice-identity-lookup",
          requestKey: "notice-product-blocked",
          dependencyRequestKey: null,
          collectorPlanId: "plan-a",
          canonicalQueryJson: "{}",
          now: "2026-08-21T00:00:00.000Z",
        },
        {
          source: "award-registration",
          role: "award-registration-bulk",
          requestKey: "award-bulk-blocked",
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
    const noticeRawHash = sha256("notice-raw");
    const productRawHash = sha256("product-raw");
    const noticeFact = {
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
      sourceHash: noticeRawHash,
    };
    const noticeIdentityHash = computeSourceIdentityHash(
      "notice-publication",
      [noticeFact.noticeNo, noticeFact.noticeOrder],
    );
    completeCheckpointForFacts(
      repository,
      run,
      "notice-publication",
      "notice-bulk-blocked",
      [noticeFact],
      { [noticeIdentityHash]: noticeRawHash },
    );
    repository.stageNoticeSnapshot(
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        expectedCount: 1,
        pageCount: 1,
        notices: [noticeFact],
      },
      run.owner,
      run.fence,
    );
    const productFact = {
      noticeNo: "20250821001",
      noticeOrder: "00",
      bidClassNo: productBidClassNo,
      parentProductCode: "39121801",
      detailProductCode: null,
      providerRowIdentity: "row-1",
      exactMatch: (quarantineKind === "exact-target" ? 1 : 0) as 0 | 1,
      rawJson: "{}",
      sourceHash: productRawHash,
    };
    const productIdentityHash = computeSourceIdentityHash("notice-product", [
      productFact.noticeNo,
      productFact.noticeOrder,
      productFact.bidClassNo,
      productFact.providerRowIdentity,
    ]);
    completeCheckpointForFacts(
      repository,
      run,
      "notice-product",
      "notice-product-blocked",
      [productFact],
      { [productIdentityHash]: productRawHash },
    );
    repository.stageNoticeProductSnapshot(
      {
        runId: run.runId,
        source: "notice-product",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        expectedCount: 1,
        pageCount: 1,
        products: [productFact],
      },
      run.owner,
      run.fence,
    );
    const awardFact = {
      noticeNo: "20250821001",
      noticeOrder: "00",
      bidClassNo: "39121801",
      rbidNo: "001",
      providerResultIdentity: "20250821001|00|39121801|001",
      finalAwardDate: "2025-08-22",
      winnerBizNo: "2148204708",
      winnerName: "Cooperative",
      sourceStatus: "final",
      winnerRowsJson: "[]",
      rawJson: "{}",
      sourceHash: sha256("award-raw"),
      canonicalAward: {
        finalAwardDate: "2025-08-22",
        winnerBizNo: "2148204708",
        winnerName: "Cooperative",
        awardAmount: null,
        awardRate: null,
        finalResultIdentity: null,
        rawJson: null,
      },
    };
    const awardIdentityHash = computeSourceIdentityHash("award-registration", [
      awardFact.noticeNo,
      awardFact.noticeOrder,
      awardFact.bidClassNo,
      awardFact.rbidNo,
    ]);
    const quarantineFact =
      quarantineKind === "none"
        ? null
        : {
            noticeNo:
              quarantineKind === "unrecoverable-identity"
                ? null
                : awardFact.noticeNo,
            noticeOrder:
              quarantineKind === "unrecoverable-identity"
                ? null
                : awardFact.noticeOrder,
            bidClassNo:
              quarantineKind === "unrecoverable-identity"
                ? null
                : awardFact.bidClassNo,
            rbidNo:
              quarantineKind === "unrecoverable-identity" ? null : "002",
            providerResultIdentity: `quarantine-${quarantineKind}`,
            registeredAt:
              quarantineKind === "invalid-registration"
                ? null
                : "2025-08-22 09:30:00",
            finalAwardDate: null,
            rawJson: "{}",
            sourceHash: sha256(`quarantine-${quarantineKind}`),
            reason: "missing_final_award_date" as const,
            pageNo: 1,
            pageIndex: 1,
            now: "2026-08-21T00:05:00.000Z",
          };
    const quarantineIdentityHash = quarantineFact
      ? computeSourceIdentityHash(
          "award-registration",
          quarantineKind === "unrecoverable-identity"
            ? [
                `quarantine:${quarantineFact.pageNo}:${quarantineFact.pageIndex}:${quarantineFact.sourceHash}`,
                "",
                "",
                "",
              ]
            : [
                quarantineFact.noticeNo!,
                quarantineFact.noticeOrder!,
                quarantineFact.bidClassNo!,
                quarantineFact.rbidNo!,
              ],
        )
      : null;
    const awardSourceIdentityHashes = quarantineIdentityHash
      ? [awardIdentityHash, quarantineIdentityHash]
      : [awardIdentityHash];
    completeCheckpointForFacts(
      repository,
      run,
      "award-registration",
      "award-bulk-blocked",
      quarantineFact ? [awardFact, quarantineFact] : [awardFact],
      quarantineFact && quarantineIdentityHash
        ? {
            [awardIdentityHash]: awardFact.sourceHash,
            [quarantineIdentityHash]: quarantineFact.sourceHash,
          }
        : { [awardIdentityHash]: awardFact.sourceHash },
    );
    const result = repository.stageAwardSnapshot(
      {
        runId: run.runId,
        source: "award-registration",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        expectedCount: 1,
        pageCount: 1,
        awards: [awardFact],
        quarantines: quarantineFact ? [quarantineFact] : [],
      },
      run.owner,
      run.fence,
    );
    expect(result.promotionBlocked).toBe(expectedBlocked);
    const complete = () =>
      repository.completeGeneration(
        {
          runId: run.runId,
          source: "award-registration",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          sourceIdentityHashes: awardSourceIdentityHashes,
          generationId: result.generationId,
          completedAt: "2026-08-21T00:04:00.000Z",
        },
        run.owner,
        run.fence,
      );
    if (expectedBlocked) {
      expect(complete).toThrow(/promotion|correlation|blocked/i);
    } else {
      expect(result.promotionBlockReasons).toEqual([]);
      expect(complete()).toBeTypeOf("number");
    }
    },
  );
});

describe("building_control_sync_checkpoints clearCompletedCheckpoints", () => {
  it("rejects generic non-classification generation staging that bypasses checkpoint facts", () => {
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
          requestKey: "notice-bulk-bypass",
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
    completeSinglePageCheckpoint(
      repository,
      run,
      "notice-publication",
      "notice-bulk-bypass",
    );

    expect(() =>
      repository.stageGeneration(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          sourceIdentityHashes: [],
          expectedCount: 0,
          observedCount: 0,
          pageCount: 0,
          identitySetHash: sha256(""),
          sourceHashes: {},
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/typed|checkpoint|snapshot|classification/i);
  });

  it("preserves completed checkpoints and their pages", () => {
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
          requestKey: "notice-bulk",
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
        requestKey: "notice-bulk",
        cursor: 1,
        pageSize: 10,
        totalCount: 10,
        ...checkpointPayload("clear-page1", 10),
        now: "2026-08-21T00:02:00.000Z",
      },
      run.runId,
      run.owner,
      run.fence,
    );
    repository.completeCheckpoint(
      run.runId,
      "notice-publication",
      "notice-bulk",
      run.owner,
      run.fence,
      "2026-08-21T00:03:00.000Z",
    );
    repository.clearCompletedCheckpoints(run.runId, run.owner, run.fence);
    const remainingCheckpoints = db
      .prepare(
        `select count(*) as count from building_control_sync_checkpoints`,
      )
      .get() as { count: number };
    expect(remainingCheckpoints.count).toBe(1);
    const remainingPages = db
      .prepare(
        `select count(*) as count from building_control_sync_checkpoint_pages`,
      )
      .get() as { count: number };
    expect(remainingPages.count).toBe(1);
  });

  it("freezes completed checkpoint metadata and pages", () => {
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
          requestKey: "notice-bulk",
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
    completeSinglePageCheckpoint(
      repository,
      run,
      "notice-publication",
      "notice-bulk",
    );
    const checkpoint = db
      .prepare(
        `select id from building_control_sync_checkpoints
         where sync_run_id = ? and source = ? and request_key = ?`,
      )
      .get(run.runId, "notice-publication", "notice-bulk") as { id: number };

    expect(() =>
      db
        .prepare(
          `update building_control_sync_checkpoints set updated_at = ? where id = ?`,
        )
        .run("2026-08-21T00:05:00.000Z", checkpoint.id),
    ).toThrow(/immutable|checkpoint/i);

    const latePage = checkpointPayload("late-page", 1);
    expect(() =>
      db
        .prepare(
          `insert into building_control_sync_checkpoint_pages
             (checkpoint_id, cursor, page_size, total_count, fact_json,
              identity_hash, source_hash, created_at)
           values (?, 2, 10, 1, ?, ?, ?, ?)`,
        )
        .run(
          checkpoint.id,
          latePage.factJson,
          latePage.identityHash,
          latePage.sourceHash,
          "2026-08-21T00:05:00.000Z",
        ),
    ).toThrow(/immutable|checkpoint/i);
    expect(() =>
      db
        .prepare(
          `delete from building_control_sync_checkpoint_pages where checkpoint_id = ?`,
        )
        .run(checkpoint.id),
    ).toThrow(/immutable|checkpoint/i);
  });

  it("rejects tampered completed checkpoint evidence when reading a resume seed", () => {
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
          requestKey: "notice-bulk",
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
    completeSinglePageCheckpoint(
      repository,
      run,
      "notice-publication",
      "notice-bulk",
    );
    db.exec(
      `drop trigger building_control_sync_checkpoints_completed_update_guard`,
    );
    db.prepare(
      `update building_control_sync_checkpoints set next_cursor = 99
       where sync_run_id = ? and source = ? and request_key = ?`,
    ).run(run.runId, "notice-publication", "notice-bulk");

    expect(() =>
      repository.readResumeSeed(
        run.runId,
        "notice-publication",
        "notice-bulk",
      ),
    ).toThrow(/checkpoint|evidence|cursor/i);
  });
});

describe("typed snapshot generation completion", () => {
  it("completes a notice generation staged by the typed snapshot writer", () => {
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
          requestKey: "notice-bulk-typed",
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
    const noticeNo = "20250821999";
    const noticeOrder = "00";
    const noticeFact = {
      noticeNo,
      noticeOrder,
      noticeName: "Typed writer notice",
      publicationDate: "2025-08-21",
      demandAgencyCode: null,
      demandAgencyName: "Agency",
      noticeUrl: null,
      status: "active",
      targetParentProductCode: null,
      targetDetailProductCode: null,
      rawJson: "{}",
      sourceHash: sha256("typed-writer-notice"),
    };
    const noticeIdentityHash = computeSourceIdentityHash(
      "notice-publication",
      [noticeNo, noticeOrder],
    );
    completeCheckpointForFacts(
      repository,
      run,
      "notice-publication",
      "notice-bulk-typed",
      [noticeFact],
      { [noticeIdentityHash]: noticeFact.sourceHash },
    );
    const staged = repository.stageNoticeSnapshot(
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        expectedCount: 1,
        pageCount: 1,
        notices: [noticeFact],
      },
      run.owner,
      run.fence,
    );
    expect(staged.idsBySourceIdentity[`${noticeNo}|${noticeOrder}`]).toBeTypeOf(
      "number",
    );
    const identityHash = computeSourceIdentityHash("notice-publication", [
      noticeNo,
      noticeOrder,
    ]);
    const coverageId = repository.completeGeneration(
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: [identityHash],
        generationId: staged.generationId,
        completedAt: "2026-08-21T00:04:00.000Z",
      },
      run.owner,
      run.fence,
    );
    expect(coverageId).toBeTypeOf("number");
  });
});
