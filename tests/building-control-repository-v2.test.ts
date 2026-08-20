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
      "notice-product-v2",
      [productFact],
      { [productIdentityHash]: productRawHash },
    );
    const productIds = repository.stageNoticeProductSnapshot(
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
      [awardFact, quarantineFact],
      {
        [awardIdentityHash]: awardFact.sourceHash,
        [quarantineIdentityHash]: quarantineFact.sourceHash,
      },
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
        quarantines: [quarantineFact],
      },
      run.owner,
      run.fence,
    );
    expect(result.promotionBlocked).toBe(false);
    expect(result.canonicalAwardIdsByNotice["20250821001|00"]).toBeTypeOf(
      "number",
    );

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

  it("flags promotionBlocked when an award lacks an exact target product", () => {
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
      bidClassNo: "39121801",
      parentProductCode: "39121801",
      detailProductCode: null,
      providerRowIdentity: "row-1",
      exactMatch: 0 as const,
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
    completeCheckpointForFacts(
      repository,
      run,
      "award-registration",
      "award-bulk-blocked",
      [awardFact],
      { [awardIdentityHash]: awardFact.sourceHash },
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
        quarantines: [],
      },
      run.owner,
      run.fence,
    );
    expect(result.promotionBlocked).toBe(true);
    expect(result.promotionBlockReasons.length).toBeGreaterThan(0);
  });
});

describe("building_control_sync_checkpoints clearCompletedCheckpoints", () => {
  it("removes only completed checkpoints and their pages", () => {
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
    const remaining = db
      .prepare(
        `select count(*) as count from building_control_sync_checkpoints`,
      )
      .get() as { count: number };
    expect(remaining.count).toBe(0);
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
