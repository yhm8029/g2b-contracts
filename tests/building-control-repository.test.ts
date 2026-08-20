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
  type CoverageSource,
  type StagedGeneration,
} from "@/lib/building-control/repository";
import { initializeSqliteSchema } from "@/lib/db/init";

const SOURCES: CoverageSource[] = [
  "notice-publication",
  "award-registration",
  "notice-product",
  "designation-history",
  "award-classification",
];

const paths: string[] = [];
const repositoryDatabases = new WeakMap<
  BuildingControlRepository,
  Database.Database
>();

afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function openFilePair() {
  const directory = mkdtempSync(join(tmpdir(), "building-control-repository-"));
  paths.push(directory);
  const file = join(directory, "market.sqlite");
  const first = new Database(file);
  initializeSqliteSchema(first);
  first.pragma("foreign_keys = ON");
  first.pragma("busy_timeout = 5000");
  const second = new Database(file);
  second.pragma("foreign_keys = ON");
  second.pragma("busy_timeout = 5000");
  const firstRepository = createBuildingControlRepository(first);
  const secondRepository = createBuildingControlRepository(second);
  repositoryDatabases.set(firstRepository, first);
  repositoryDatabases.set(secondRepository, second);
  return {
    first,
    second,
    firstRepository,
    secondRepository,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function identitySetHash(hashes: string[]): string {
  return sha256([...hashes].sort().join("\n"));
}

function hash(seed: string): string {
  return sha256(seed);
}

function stageRawGeneration(
  repository: BuildingControlRepository,
  input: StagedGeneration,
  _owner: string,
  _fence: number,
): number {
  const db = repositoryDatabases.get(repository);
  if (!db) throw new Error("test repository database is missing");
  const result = db
    .prepare(
      `insert into building_control_source_generations
         (sync_run_id, source, state, date_from, date_to, expected_count,
          observed_count, page_count, identity_set_hash, source_hashes_json,
          created_at)
       values (?, ?, 'staging', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.runId,
      input.source,
      input.dateFrom,
      input.dateTo,
      input.expectedCount,
      input.observedCount,
      input.pageCount,
      input.identitySetHash,
      JSON.stringify(input.sourceHashes),
      "2026-08-21T00:00:00.000Z",
    );
  return Number(result.lastInsertRowid);
}

function seedRequestSeals(
  repository: BuildingControlRepository,
  run: { owner: string; fence: number; runId: number },
  now: string,
) {
  repository.registerCollectorPlan({
    planId: "repository-test-plan",
    name: "Repository test plan",
    description: "provider request seal fixture",
    requestSetHash: sha256("repository-test-plan"),
    createdAt: "2026-08-21T00:00:00.000Z",
  });
  const requests = [
    ["notice-publication", "notice-publication-bulk"],
    ["award-registration", "award-registration-bulk"],
    ["notice-product", "notice-identity-lookup"],
    ["designation-history", "designation-list-all"],
  ] as const;
  repository.registerExpectedRequests(
    run.runId,
    requests.map(([source, role]) => ({
      source,
      role,
      requestKey: `repository-test-${source}`,
      dependencyRequestKey: null,
      collectorPlanId: "repository-test-plan",
      canonicalQueryJson: "{}",
      now,
    })),
    run.owner,
    run.fence,
  );
  repository.sealExpectedRequestSet(
    run.runId,
    "repository-test-plan",
    run.owner,
    run.fence,
    now,
  );
  for (const [source] of requests) {
    const factJson = JSON.stringify({
      schemaVersion: 1,
      facts: [],
      identityHashes: [],
      sourceHashes: {},
    });
    repository.stageCheckpointPage(
      {
        source,
        requestKey: `repository-test-${source}`,
        cursor: 1,
        pageSize: 1,
        totalCount: 0,
        factJson,
        identityHash: sha256(""),
        sourceHash: sha256(factJson),
        now,
      },
      run.runId,
      run.owner,
      run.fence,
    );
    repository.completeCheckpoint(
      run.runId,
      source,
      `repository-test-${source}`,
      run.owner,
      run.fence,
      now,
    );
  }
}

function beginRun(
  repository: BuildingControlRepository,
  owner = "worker-a",
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
  const run = { owner, fence: fence!, runId };
  seedRequestSeals(repository, run, now);
  return run;
}

function stageAndComplete(
  repository: BuildingControlRepository,
  run: ReturnType<typeof beginRun>,
  source: CoverageSource,
  seed = source,
) {
  const identities: string[] = [];
  const input: StagedGeneration = {
    runId: run.runId,
    source,
    dateFrom: "2025-01-01",
    dateTo: "2026-08-21",
    sourceIdentityHashes: identities,
    expectedCount: 0,
    observedCount: 0,
    pageCount: 0,
    identitySetHash: identitySetHash(identities),
    sourceHashes: {},
  };
  const generationId =
    source === "award-classification"
      ? repository.stageGeneration(input, run.owner, run.fence)
      : stageRawGeneration(repository, input, run.owner, run.fence);
  const coverageId = repository.completeGeneration(
    {
      runId: run.runId,
      source,
      dateFrom: "2025-01-01",
      dateTo: "2026-08-21",
      sourceIdentityHashes: identities,
      generationId,
      completedAt: "2026-08-21T00:01:00.000Z",
    },
    run.owner,
    run.fence,
  );
  return { generationId, coverageId };
}

function completeAllSources(
  repository: BuildingControlRepository,
  run: ReturnType<typeof beginRun>,
) {
  return Object.fromEntries(
    SOURCES.map((source) => [
      source,
      stageAndComplete(repository, run, source).generationId,
    ]),
  ) as Record<CoverageSource, number>;
}

describe("building-control repository", () => {
  it("excludes a live lease, increments fencing tokens, and rejects a stale worker", () => {
    const { first, second, firstRepository, secondRepository } = openFilePair();
    const firstFence = firstRepository.acquireLease(
      "worker-a",
      "2026-08-21T00:00:00.000Z",
      10,
    );
    expect(firstFence).toBe(1);
    expect(
      secondRepository.acquireLease("worker-b", "2026-08-21T00:00:05.000Z", 60),
    ).toBeNull();

    const secondFence = secondRepository.acquireLease(
      "worker-b",
      "2026-08-21T00:00:11.000Z",
      60,
    );
    expect(secondFence).toBe(2);
    expect(
      firstRepository.renewLease(
        "worker-a",
        firstFence!,
        "2026-08-21T00:00:12.000Z",
        60,
      ),
    ).toBe(false);
    expect(() =>
      firstRepository.beginRun(
        {
          trigger: "manual",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          seoulDate: "2026-08-21",
        },
        "worker-a",
        firstFence!,
      ),
    ).toThrow(/lease|fence/i);
    expect(firstRepository.releaseLease("worker-a", firstFence!)).toBe(false);
    expect(secondRepository.releaseLease("worker-b", secondFence!)).toBe(true);
    first.close();
    second.close();
  });

  it("validates generation cardinality and identity hashes before completion", () => {
    const { first, second, firstRepository } = openFilePair();
    const run = beginRun(firstRepository);
    const identities = [hash("first"), hash("second")];

    expect(() =>
      firstRepository.stageGeneration(
        {
          runId: run.runId,
          source: "award-classification",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          sourceIdentityHashes: identities,
          expectedCount: 3,
          observedCount: 2,
          pageCount: 1,
          identitySetHash: identitySetHash(identities),
          sourceHashes: {},
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/count|cardinality/i);

    const generationId = stageRawGeneration(
      firstRepository,
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: identities,
        expectedCount: 2,
        observedCount: 2,
        pageCount: 1,
        identitySetHash: identitySetHash(identities),
        sourceHashes: Object.fromEntries(
          identities.map((identity) => [identity, hash(identity)]),
        ),
      },
      run.owner,
      run.fence,
    );

    expect(() =>
      firstRepository.completeGeneration(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          sourceIdentityHashes: [identities[0]!],
          generationId,
          completedAt: "2026-08-21T00:01:00.000Z",
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/identity|cardinality/i);
    first.close();
    second.close();
  });

  it("ties completion to real source facts and freezes them after completion", () => {
    const { first, second, firstRepository } = openFilePair();
    const run = beginRun(firstRepository);
    const identity = computeSourceIdentityHash("notice-publication", [
      "20250821001",
      "00",
    ]);
    const rawHash = hash("notice-raw");
    const generationId = stageRawGeneration(
      firstRepository,
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: [identity],
        expectedCount: 1,
        observedCount: 1,
        pageCount: 1,
        identitySetHash: identitySetHash([identity]),
        sourceHashes: { [identity]: rawHash },
      },
      run.owner,
      run.fence,
    );
    const promotion = {
      runId: run.runId,
      source: "notice-publication" as const,
      dateFrom: "2025-01-01",
      dateTo: "2026-08-21",
      sourceIdentityHashes: [identity],
      generationId,
      completedAt: "2026-08-21T00:01:00.000Z",
    };

    expect(() =>
      firstRepository.completeGeneration(promotion, run.owner, run.fence),
    ).toThrow(/fact|source hash|coverage/i);
    const noticeId = Number(
      first
        .prepare(
          `
          insert into building_control_notices
            (generation_id, notice_no, notice_order, notice_name, publication_date,
             raw_json, source_hash)
          values (?, '20250821001', '00', 'Control', '2025-08-21', 'notice-raw', ?)
        `,
        )
        .run(generationId, rawHash).lastInsertRowid,
    );
    firstRepository.completeGeneration(promotion, run.owner, run.fence);

    expect(
      first
        .prepare(
          `
          select entity_type, entity_id, source_hash
          from building_control_generation_memberships where generation_id = ?
        `,
        )
        .get(generationId),
    ).toEqual({
      entity_type: "notice",
      entity_id: noticeId,
      source_hash: rawHash,
    });
    expect(() =>
      first
        .prepare(
          `
          insert into building_control_notices
            (generation_id, notice_no, notice_order, notice_name, publication_date,
             raw_json, source_hash)
          values (?, '20250821002', '00', 'Late', '2025-08-21', '{}', ?)
        `,
        )
        .run(generationId, hash("late")),
    ).toThrow(/immutable|staging/i);
    expect(() =>
      first
        .prepare(
          "update building_control_notices set notice_name = 'Changed' where id = ?",
        )
        .run(noticeId),
    ).toThrow(/immutable|staging/i);
    expect(() =>
      first
        .prepare("delete from building_control_notices where id = ?")
        .run(noticeId),
    ).toThrow(/immutable|staging/i);
    expect(() =>
      first
        .prepare(
          `
          insert into building_control_generation_memberships
            (generation_id, entity_type, entity_id, source_hash)
          values (?, 'notice', 999, ?)
        `,
        )
        .run(generationId, hash("late-membership")),
    ).toThrow(/immutable|staging/i);
    first.close();
    second.close();
  });

  it("derives coverage identities from provider keys instead of trusting caller aliases", () => {
    const { first, second, firstRepository } = openFilePair();
    const run = beginRun(firstRepository);
    const forgedIdentity = hash("forged-provider-identity");
    const rawHash = hash("provider-row");
    const generationId = stageRawGeneration(
      firstRepository,
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: [forgedIdentity],
        expectedCount: 1,
        observedCount: 1,
        pageCount: 1,
        identitySetHash: identitySetHash([forgedIdentity]),
        sourceHashes: { [forgedIdentity]: rawHash },
      },
      run.owner,
      run.fence,
    );
    first
      .prepare(
        `
        insert into building_control_notices
          (generation_id, notice_no, notice_order, notice_name, publication_date,
           raw_json, source_hash)
        values (?, '20250821999', '00', 'Control', '2025-08-21', 'provider-row', ?)
      `,
      )
      .run(generationId, rawHash);

    expect(() =>
      firstRepository.completeGeneration(
        {
          runId: run.runId,
          source: "notice-publication",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          sourceIdentityHashes: [forgedIdentity],
          generationId,
          completedAt: "2026-08-21T00:01:00.000Z",
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/provider identities/i);
    first.close();
    second.close();
  });

  it("fails closed when a final-result generation repeats a three-part award grain", () => {
    const { first, second, firstRepository } = openFilePair();
    const run = beginRun(firstRepository);
    const noticeIdentity = computeSourceIdentityHash("notice-publication", [
      "20250821888",
      "00",
    ]);
    const noticeHash = hash("duplicate-grain-notice");
    const noticeGeneration = stageRawGeneration(
      firstRepository,
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: [noticeIdentity],
        expectedCount: 1,
        observedCount: 1,
        pageCount: 1,
        identitySetHash: identitySetHash([noticeIdentity]),
        sourceHashes: { [noticeIdentity]: noticeHash },
      },
      run.owner,
      run.fence,
    );
    const noticeId = Number(
      first
        .prepare(
          `
          insert into building_control_notices
            (generation_id, notice_no, notice_order, notice_name, publication_date,
             raw_json, source_hash)
          values (?, '20250821888', '00', 'Control', '2025-08-21', '{}', ?)
        `,
        )
        .run(noticeGeneration, noticeHash).lastInsertRowid,
    );
    firstRepository.completeGeneration(
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: [noticeIdentity],
        generationId: noticeGeneration,
        completedAt: "2026-08-21T00:00:30.000Z",
      },
      run.owner,
      run.fence,
    );

    const identities = [
      computeSourceIdentityHash("award-registration", [
        "20250821888",
        "00",
        "01",
        "000",
      ]),
      computeSourceIdentityHash("award-registration", [
        "20250821888",
        "00",
        "01",
        "001",
      ]),
    ];
    const rawHashes = [
      hash("duplicate-grain-000"),
      hash("duplicate-grain-001"),
    ];
    const awardGeneration = stageRawGeneration(
      firstRepository,
      {
        runId: run.runId,
        source: "award-registration",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: identities,
        expectedCount: 2,
        observedCount: 2,
        pageCount: 1,
        identitySetHash: identitySetHash(identities),
        sourceHashes: {
          [identities[0]!]: rawHashes[0]!,
          [identities[1]!]: rawHashes[1]!,
        },
      },
      run.owner,
      run.fence,
    );
    const insert = first.prepare(`
      insert into building_control_award_revisions
        (generation_id, notice_id, bid_clsfc_no, rbid_no, provider_result_identity,
         final_award_date, winner_biz_no, winner_name, raw_json, source_hash)
      values (?, ?, '01', ?, ?, '2025-08-22', '1234567890', ?, '{}', ?)
    `);
    insert.run(
      awardGeneration,
      noticeId,
      "000",
      "result-000",
      "First",
      rawHashes[0],
    );
    insert.run(
      awardGeneration,
      noticeId,
      "001",
      "result-001",
      "Second",
      rawHashes[1],
    );

    expect(() =>
      firstRepository.completeGeneration(
        {
          runId: run.runId,
          source: "award-registration",
          dateFrom: "2025-01-01",
          dateTo: "2026-08-21",
          sourceIdentityHashes: identities,
          generationId: awardGeneration,
          completedAt: "2026-08-21T00:01:00.000Z",
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/duplicate final award grain/i);
    first.close();
    second.close();
  });

  it("does not let staging or failed generations enter a manifest", () => {
    const { first, second, firstRepository } = openFilePair();
    const run = beginRun(firstRepository);
    const complete = completeAllSources(firstRepository, run);
    const stagingRunId = firstRepository.beginRun(
      {
        trigger: "manual",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        seoulDate: "2026-08-21",
      },
      run.owner,
      run.fence,
    );
    const stagingIdentities = [hash("staging")];
    const stagingId = stageRawGeneration(
      firstRepository,
      {
        runId: stagingRunId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: stagingIdentities,
        expectedCount: 1,
        observedCount: 1,
        pageCount: 1,
        identitySetHash: identitySetHash(stagingIdentities),
        sourceHashes: { [stagingIdentities[0]!]: hash("staging-raw") },
      },
      run.owner,
      run.fence,
    );
    expect(() =>
      firstRepository.createManifest(
        { ...complete, "notice-publication": stagingId },
        run.owner,
        run.fence,
      ),
    ).toThrow(/complete|coverage/i);
    first.close();
    second.close();
  });

  it("requires generation and coverage windows to match the parent run", () => {
    const { first, second, firstRepository } = openFilePair();
    const run = beginRun(firstRepository);
    expect(() =>
      firstRepository.stageGeneration(
        {
          runId: run.runId,
          source: "award-classification",
          dateFrom: "2024-12-31",
          dateTo: "2026-08-21",
          sourceIdentityHashes: [],
          expectedCount: 0,
          observedCount: 0,
          pageCount: 0,
          identitySetHash: identitySetHash([]),
          sourceHashes: {},
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/range|date/i);

    const generations = completeAllSources(firstRepository, run);
    expect(() =>
      first
        .prepare(
          `
          update building_control_coverage
          set source = 'award-registration'
          where generation_id = ?
        `,
        )
        .run(generations["notice-publication"]),
    ).toThrow(/immutable coverage/i);
    first.close();
    second.close();
  });

  it("retains append-only corrections distinguished by source hash", () => {
    const { first, second, firstRepository } = openFilePair();
    const run = beginRun(firstRepository);
    const noticeIdentity = computeSourceIdentityHash("notice-publication", [
      "20250821001",
      "00",
    ]);
    const noticeRawHash = hash("notice-raw");
    const noticeGeneration = stageRawGeneration(
      firstRepository,
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: [noticeIdentity],
        expectedCount: 1,
        observedCount: 1,
        pageCount: 1,
        identitySetHash: identitySetHash([noticeIdentity]),
        sourceHashes: { [noticeIdentity]: noticeRawHash },
      },
      run.owner,
      run.fence,
    );
    const noticeId = Number(
      first
        .prepare(
          `
          insert into building_control_notices
            (generation_id, notice_no, notice_order, notice_name, publication_date, raw_json, source_hash)
          values (?, '20250821001', '00', 'Control', '2025-08-21', 'notice-raw', ?)
        `,
        )
        .run(noticeGeneration, noticeRawHash).lastInsertRowid,
    );
    firstRepository.completeGeneration(
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: [noticeIdentity],
        generationId: noticeGeneration,
        completedAt: "2026-08-21T00:00:30.000Z",
      },
      run.owner,
      run.fence,
    );
    const revisionOneHash = hash("revision-v1");
    const revisionTwoHash = hash("revision-v2");
    const revisionIdentities = [
      computeSourceIdentityHash("award-registration", [
        "20250821001",
        "00",
        "01",
        "000",
      ]),
      computeSourceIdentityHash("award-registration", [
        "20250821001",
        "00",
        "02",
        "001",
      ]),
    ];
    const generation = stageRawGeneration(
      firstRepository,
      {
        runId: run.runId,
        source: "award-registration",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: revisionIdentities,
        expectedCount: 2,
        observedCount: 2,
        pageCount: 1,
        identitySetHash: identitySetHash(revisionIdentities),
        sourceHashes: {
          [revisionIdentities[0]!]: revisionOneHash,
          [revisionIdentities[1]!]: revisionTwoHash,
        },
      },
      run.owner,
      run.fence,
    );
    const insertRevision = first.prepare(`
      insert into building_control_award_revisions
        (generation_id, notice_id, bid_clsfc_no, rbid_no, provider_result_identity,
         final_award_date, winner_biz_no, winner_name, raw_json, source_hash)
      values (?, ?, ?, ?, ?, '2025-08-22', '1234567890', ?, ?, ?)
    `);
    const firstRevision = Number(
      insertRevision.run(
        generation,
        noticeId,
        "01",
        "000",
        "result-1",
        "First Name",
        "revision-v1",
        revisionOneHash,
      ).lastInsertRowid,
    );
    const correctedRevision = Number(
      insertRevision.run(
        generation,
        noticeId,
        "02",
        "001",
        "result-2",
        "Corrected Name",
        "revision-v2",
        revisionTwoHash,
      ).lastInsertRowid,
    );
    expect(correctedRevision).not.toBe(firstRevision);
    expect(
      (
        first
          .prepare(
            "select count(*) as count from building_control_award_revisions",
          )
          .get() as {
          count: number;
        }
      ).count,
    ).toBe(2);
    expect(() =>
      insertRevision.run(
        generation,
        noticeId,
        "02",
        "001",
        "result-2",
        "Duplicate",
        "revision-v2",
        hash("revision-v2"),
      ),
    ).toThrow();
    expect(() =>
      first
        .prepare(
          `
          insert into building_control_awards
            (generation_id, notice_id, selected_revision_id, final_award_date,
             winner_biz_no, winner_name)
          values (?, ?, ?, '2025-08-22', '1234567890', 'Wrong Name')
        `,
        )
        .run(generation, noticeId, correctedRevision),
    ).toThrow(/award revision/i);
    first
      .prepare(
        `
        insert into building_control_awards
          (generation_id, notice_id, selected_revision_id, final_award_date,
           winner_biz_no, winner_name)
        values (?, ?, ?, '2025-08-22', '1234567890', 'Corrected Name')
      `,
      )
      .run(generation, noticeId, correctedRevision);
    firstRepository.completeGeneration(
      {
        runId: run.runId,
        source: "award-registration",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        sourceIdentityHashes: revisionIdentities,
        generationId: generation,
        completedAt: "2026-08-21T00:01:00.000Z",
      },
      run.owner,
      run.fence,
    );
    const productGeneration = stageAndComplete(
      firstRepository,
      run,
      "notice-product",
    ).generationId;
    const designationGeneration = stageAndComplete(
      firstRepository,
      run,
      "designation-history",
    ).generationId;
    const classificationGeneration = stageAndComplete(
      firstRepository,
      run,
      "award-classification",
    ).generationId;
    expect(() =>
      firstRepository.createManifest(
        {
          "notice-publication": noticeGeneration,
          "notice-product": productGeneration,
          "award-registration": generation,
          "designation-history": designationGeneration,
          "award-classification": classificationGeneration,
        },
        run.owner,
        run.fence,
      ),
    ).toThrow(/provenance/i);
    first.close();
    second.close();
  });

  it("pins five complete generations and activates with compare-and-swap", () => {
    const { first, second, firstRepository } = openFilePair();
    const run = beginRun(firstRepository);
    const generations = completeAllSources(firstRepository, run);
    const manifestId = firstRepository.createManifest(
      generations,
      run.owner,
      run.fence,
    );
    expect(
      (
        first
          .prepare(
            "select count(*) as count from building_control_manifest_sources where manifest_id = ?",
          )
          .get(manifestId) as { count: number }
      ).count,
    ).toBe(5);
    expect(
      firstRepository.completeRunAndActivate({
        runId: run.runId,
        manifestId,
        expectedActiveManifestId: null,
        owner: run.owner,
        fence: run.fence,
        completedAt: "2026-08-21T00:02:00.000Z",
      }),
    ).toBe(true);

    const active = firstRepository.readActiveManifest();
    expect(active?.manifestId).toBe(manifestId);
    expect(active?.generations).toEqual(generations);
    expect(() =>
      first
        .prepare(
          "update building_control_source_generations set state = 'staging' where id = ?",
        )
        .run(generations["notice-publication"]),
    ).toThrow(/immutable generation/i);
    expect(() =>
      first
        .prepare(
          `
          update building_control_manifest_sources
          set generation_id = ? where manifest_id = ? and source = 'notice-publication'
        `,
        )
        .run(generations["notice-publication"], manifestId),
    ).toThrow(/immutable manifest sources/i);
    expect(() =>
      first
        .prepare(
          `
          delete from building_control_manifest_sources
          where manifest_id = ? and source = 'notice-publication'
        `,
        )
        .run(manifestId),
    ).toThrow(/immutable manifest sources/i);

    const nextRun = firstRepository.beginRun(
      {
        trigger: "manual",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        seoulDate: "2026-08-21",
      },
      run.owner,
      run.fence,
    );
    const next = { ...run, runId: nextRun };
    seedRequestSeals(
      firstRepository,
      next,
      "2026-08-21T00:02:30.000Z",
    );
    const nextManifestId = firstRepository.createManifest(
      completeAllSources(firstRepository, next),
      next.owner,
      next.fence,
    );
    expect(
      firstRepository.completeRunAndActivate({
        runId: next.runId,
        manifestId: nextManifestId,
        expectedActiveManifestId: 999999,
        owner: next.owner,
        fence: next.fence,
        completedAt: "2026-08-21T00:03:00.000Z",
      }),
    ).toBe(false);
    expect(firstRepository.readActiveManifest()?.manifestId).toBe(manifestId);
    first.close();
    second.close();
  });

  it("records startup success only in the atomic activation transaction", () => {
    const { first, second, firstRepository } = openFilePair();
    const fence = firstRepository.acquireLease(
      "startup",
      "2026-08-21T00:00:00.000Z",
      60,
    )!;
    const runId = firstRepository.beginRun(
      {
        trigger: "startup",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        seoulDate: "2026-08-21",
      },
      "startup",
      fence,
    );
    const run = { owner: "startup", fence, runId };
    seedRequestSeals(
      firstRepository,
      run,
      "2026-08-21T00:00:00.000Z",
    );
    const manifestId = firstRepository.createManifest(
      completeAllSources(firstRepository, run),
      run.owner,
      run.fence,
    );
    expect(firstRepository.hasSuccessfulStartupSync("2026-08-21")).toBe(false);
    expect(
      firstRepository.completeRunAndActivate({
        runId,
        manifestId,
        expectedActiveManifestId: null,
        owner: run.owner,
        fence: run.fence,
        completedAt: "2026-08-21T00:02:00.000Z",
      }),
    ).toBe(true);
    expect(firstRepository.hasSuccessfulStartupSync("2026-08-21")).toBe(true);

    const secondRunId = firstRepository.beginRun(
      {
        trigger: "startup",
        dateFrom: "2025-01-01",
        dateTo: "2026-08-21",
        seoulDate: "2026-08-21",
      },
      run.owner,
      run.fence,
    );
    const secondRun = { ...run, runId: secondRunId };
    seedRequestSeals(
      firstRepository,
      secondRun,
      "2026-08-21T00:02:30.000Z",
    );
    const secondManifestId = firstRepository.createManifest(
      completeAllSources(firstRepository, secondRun),
      secondRun.owner,
      secondRun.fence,
    );
    expect(() =>
      firstRepository.completeRunAndActivate({
        runId: secondRunId,
        manifestId: secondManifestId,
        expectedActiveManifestId: manifestId,
        owner: secondRun.owner,
        fence: secondRun.fence,
        completedAt: "2026-08-21T00:03:00.000Z",
      }),
    ).toThrow();
    expect(firstRepository.readActiveManifest()?.manifestId).toBe(manifestId);
    expect(
      first
        .prepare("select status from building_control_sync_runs where id = ?")
        .get(secondRunId),
    ).toEqual({ status: "running" });
    first.close();
    second.close();
  });

  function createExactLot02ConflictScenario(
    repository: BuildingControlRepository,
    db: Database.Database,
    params: {
      lot02ExactMatch: 0 | 1;
      includeLot02Revision: boolean;
      lot01WinnerBizNo: string;
      lot02WinnerBizNo: string | null;
      canonicalLot: "01" | "02" | null;
      lot01FinalAwardDate: string;
      lot02FinalAwardDate: string;
    },
  ) {
    const run = beginRun(repository);
    const dateFrom = "2025-01-01";
    const dateTo = "2026-08-21";
    const completedAt = "2026-08-21T00:01:00.000Z";
    const evaluatedAwardDate = "2025-08-22";

    const noticeNo = "20250821001";
    const noticeOrder = "00";
    const noticeIdentity = computeSourceIdentityHash("notice-publication", [
      noticeNo,
      noticeOrder,
    ]);
    const noticeRawHash = hash("conflict-notice-raw");

    const noticeGenerationId = stageRawGeneration(
      repository,
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom,
        dateTo,
        sourceIdentityHashes: [noticeIdentity],
        expectedCount: 1,
        observedCount: 1,
        pageCount: 1,
        identitySetHash: identitySetHash([noticeIdentity]),
        sourceHashes: { [noticeIdentity]: noticeRawHash },
      },
      run.owner,
      run.fence,
    );
    const noticeId = Number(
      db
        .prepare(
          `insert into building_control_notices
             (generation_id, notice_no, notice_order, notice_name, publication_date,
              raw_json, source_hash)
           values (?, ?, ?, 'Control', '2025-08-21', ?, ?)`,
        )
        .run(
          noticeGenerationId,
          noticeNo,
          noticeOrder,
          "notice-raw",
          noticeRawHash,
        ).lastInsertRowid,
    );
    repository.completeGeneration(
      {
        runId: run.runId,
        source: "notice-publication",
        dateFrom,
        dateTo,
        sourceIdentityHashes: [noticeIdentity],
        generationId: noticeGenerationId,
        completedAt,
      },
      run.owner,
      run.fence,
    );

    const lot01Identity = computeSourceIdentityHash("notice-product", [
      noticeNo,
      noticeOrder,
      "01",
      "row-lot-01",
    ]);
    const lot01RawHash = hash("conflict-lot-01-raw");
    const lot02Identity = computeSourceIdentityHash("notice-product", [
      noticeNo,
      noticeOrder,
      "02",
      "row-lot-02",
    ]);
    const lot02RawHash = hash("conflict-lot-02-raw");

    const productGenerationId = stageRawGeneration(
      repository,
      {
        runId: run.runId,
        source: "notice-product",
        dateFrom,
        dateTo,
        sourceIdentityHashes: [lot01Identity, lot02Identity],
        expectedCount: 2,
        observedCount: 2,
        pageCount: 1,
        identitySetHash: identitySetHash([lot01Identity, lot02Identity]),
        sourceHashes: {
          [lot01Identity]: lot01RawHash,
          [lot02Identity]: lot02RawHash,
        },
      },
      run.owner,
      run.fence,
    );
    db.prepare(
      `insert into building_control_notice_products
         (generation_id, notice_id, bid_clsfc_no, provider_row_identity, exact_match,
          raw_json, source_hash)
       values (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      productGenerationId,
      noticeId,
      "01",
      "row-lot-01",
      1,
      "lot-01-raw",
      lot01RawHash,
    );
    db.prepare(
      `insert into building_control_notice_products
         (generation_id, notice_id, bid_clsfc_no, provider_row_identity, exact_match,
          raw_json, source_hash)
       values (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      productGenerationId,
      noticeId,
      "02",
      "row-lot-02",
      params.lot02ExactMatch,
      "lot-02-raw",
      lot02RawHash,
    );
    repository.completeGeneration(
      {
        runId: run.runId,
        source: "notice-product",
        dateFrom,
        dateTo,
        sourceIdentityHashes: [lot01Identity, lot02Identity],
        generationId: productGenerationId,
        completedAt,
      },
      run.owner,
      run.fence,
    );

    const lot01AwardIdentity = computeSourceIdentityHash("award-registration", [
      noticeNo,
      noticeOrder,
      "01",
      "000",
    ]);
    const lot01AwardRawHash = hash("conflict-award-lot-01");
    const awardIdentities: string[] = [lot01AwardIdentity];
    const awardRawHashes: string[] = [lot01AwardRawHash];
    if (params.includeLot02Revision) {
      const lot02AwardIdentity = computeSourceIdentityHash(
        "award-registration",
        [noticeNo, noticeOrder, "02", "000"],
      );
      const lot02AwardRawHash = hash("conflict-award-lot-02");
      awardIdentities.push(lot02AwardIdentity);
      awardRawHashes.push(lot02AwardRawHash);
    }

    const awardGenerationId = stageRawGeneration(
      repository,
      {
        runId: run.runId,
        source: "award-registration",
        dateFrom,
        dateTo,
        sourceIdentityHashes: awardIdentities,
        expectedCount: awardIdentities.length,
        observedCount: awardIdentities.length,
        pageCount: 1,
        identitySetHash: identitySetHash(awardIdentities),
        sourceHashes: Object.fromEntries(
          awardIdentities.map((identity, index) => [
            identity,
            awardRawHashes[index]!,
          ]),
        ),
      },
      run.owner,
      run.fence,
    );
    const insertAwardRevision = db.prepare(
      `insert into building_control_award_revisions
         (generation_id, notice_id, bid_clsfc_no, rbid_no, provider_result_identity,
          final_award_date, winner_biz_no, winner_name, raw_json, source_hash)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const lot01RevisionId = Number(
      insertAwardRevision.run(
        awardGenerationId,
        noticeId,
        "01",
        "000",
        "result-lot-01",
        params.lot01FinalAwardDate,
        params.lot01WinnerBizNo,
        "Winner Name",
        "lot-01-award-raw",
        lot01AwardRawHash,
      ).lastInsertRowid,
    );
    let lot02RevisionId: number | null = null;
    if (params.includeLot02Revision) {
      lot02RevisionId = Number(
        insertAwardRevision.run(
          awardGenerationId,
          noticeId,
          "02",
          "000",
          "result-lot-02",
          params.lot02FinalAwardDate,
          params.lot02WinnerBizNo!,
          "Winner Name",
          "lot-02-award-raw",
          awardRawHashes[1]!,
        ).lastInsertRowid,
      );
    }

    if (params.canonicalLot !== null) {
      const selectedLot = params.canonicalLot;
      const selectedRevisionId =
        selectedLot === "01" ? lot01RevisionId : lot02RevisionId;
      if (selectedRevisionId === null) {
        throw new Error(
          `fixture: canonicalLot=${selectedLot} requested but revision for that lot was not inserted`,
        );
      }
      const selectedFinalAwardDate =
        selectedLot === "01"
          ? params.lot01FinalAwardDate
          : params.lot02FinalAwardDate;
      const selectedWinnerBizNo =
        selectedLot === "01"
          ? params.lot01WinnerBizNo
          : params.lot02WinnerBizNo!;
      db.prepare(
        `insert into building_control_awards
           (generation_id, notice_id, selected_revision_id, final_award_date,
            winner_biz_no, winner_name)
         values (?, ?, ?, ?, ?, ?)`,
      ).run(
        awardGenerationId,
        noticeId,
        selectedRevisionId,
        selectedFinalAwardDate,
        selectedWinnerBizNo,
        "Winner Name",
      );
    }

    repository.completeGeneration(
      {
        runId: run.runId,
        source: "award-registration",
        dateFrom,
        dateTo,
        sourceIdentityHashes: awardIdentities,
        generationId: awardGenerationId,
        completedAt,
      },
      run.owner,
      run.fence,
    );

    const designationGenerationId = stageAndComplete(
      repository,
      run,
      "designation-history",
    ).generationId;

    let classificationGenerationId: number;
    if (params.canonicalLot !== null) {
      const selectedLot = params.canonicalLot;
      const selectedRevisionId =
        selectedLot === "01" ? lot01RevisionId : lot02RevisionId!;
      const selectedFinalAwardDate =
        selectedLot === "01"
          ? params.lot01FinalAwardDate
          : params.lot02FinalAwardDate;
      const classificationIdentity = computeSourceIdentityHash(
        "award-classification",
        [noticeNo, noticeOrder, selectedLot, "000", "rules-v1"],
      );
      const classificationEvidenceHash = hash(
        `classification-evidence-lot-${selectedLot}`,
      );
      classificationGenerationId = repository.stageGeneration(
        {
          runId: run.runId,
          source: "award-classification",
          dateFrom,
          dateTo,
          sourceIdentityHashes: [classificationIdentity],
          expectedCount: 1,
          observedCount: 1,
          pageCount: 1,
          identitySetHash: identitySetHash([classificationIdentity]),
          sourceHashes: {
            [classificationIdentity]: classificationEvidenceHash,
          },
        },
        run.owner,
        run.fence,
      );
      repository.stageClassificationFacts(
        [
          {
            generationId: classificationGenerationId,
            awardRevisionId: selectedRevisionId,
            designationGenerationId,
            rulesVersion: "rules-v1",
            evaluatedAwardDate: selectedFinalAwardDate,
            category: "non_excellent",
            matchedObservationId: null,
            reason: `no designation match for lot ${selectedLot} canonical award`,
            evidenceHash: classificationEvidenceHash,
            createdAt: completedAt,
          },
        ],
        run.owner,
        run.fence,
      );
      repository.completeGeneration(
        {
          runId: run.runId,
          source: "award-classification",
          dateFrom,
          dateTo,
          sourceIdentityHashes: [classificationIdentity],
          generationId: classificationGenerationId,
          completedAt,
        },
        run.owner,
        run.fence,
      );
    } else {
      classificationGenerationId = stageAndComplete(
        repository,
        run,
        "award-classification",
      ).generationId;
    }

    return {
      run,
      noticeGenerationId,
      productGenerationId,
      awardGenerationId,
      designationGenerationId,
      classificationGenerationId,
    };
  }

  it("createManifest enforces a single canonical winner across exact lots and rejects cross-lot conflicts", () => {
    const lot01Winner = "1111111111";

    const {
      first: firstA,
      second: secondA,
      firstRepository: repoA,
    } = openFilePair();
    try {
      const scenarioA = createExactLot02ConflictScenario(repoA, firstA, {
        lot02ExactMatch: 1,
        includeLot02Revision: true,
        lot01WinnerBizNo: lot01Winner,
        lot02WinnerBizNo: lot01Winner,
        canonicalLot: "01",
        lot01FinalAwardDate: "2025-08-22",
        lot02FinalAwardDate: "2025-08-22",
      });
      const manifestA = repoA.createManifest(
        {
          "notice-publication": scenarioA.noticeGenerationId,
          "notice-product": scenarioA.productGenerationId,
          "award-registration": scenarioA.awardGenerationId,
          "designation-history": scenarioA.designationGenerationId,
          "award-classification": scenarioA.classificationGenerationId,
        },
        scenarioA.run.owner,
        scenarioA.run.fence,
      );
      expect(typeof manifestA).toBe("number");
      expect(manifestA).toBeGreaterThan(0);
    } finally {
      firstA.close();
      secondA.close();
    }

    const {
      first: firstB,
      second: secondB,
      firstRepository: repoB,
    } = openFilePair();
    try {
      const scenarioB = createExactLot02ConflictScenario(repoB, firstB, {
        lot02ExactMatch: 1,
        includeLot02Revision: true,
        lot01WinnerBizNo: lot01Winner,
        lot02WinnerBizNo: "2222222222",
        canonicalLot: "01",
        lot01FinalAwardDate: "2025-08-22",
        lot02FinalAwardDate: "2025-08-22",
      });
      expect(() =>
        repoB.createManifest(
          {
            "notice-publication": scenarioB.noticeGenerationId,
            "notice-product": scenarioB.productGenerationId,
            "award-registration": scenarioB.awardGenerationId,
            "designation-history": scenarioB.designationGenerationId,
            "award-classification": scenarioB.classificationGenerationId,
          },
          scenarioB.run.owner,
          scenarioB.run.fence,
        ),
      ).toThrow(/target.*winner|winner.*target|conflict/i);
    } finally {
      firstB.close();
      secondB.close();
    }

    const {
      first: firstC,
      second: secondC,
      firstRepository: repoC,
    } = openFilePair();
    try {
      const scenarioC = createExactLot02ConflictScenario(repoC, firstC, {
        lot02ExactMatch: 1,
        includeLot02Revision: false,
        lot01WinnerBizNo: lot01Winner,
        lot02WinnerBizNo: null,
        canonicalLot: "01",
        lot01FinalAwardDate: "2025-08-22",
        lot02FinalAwardDate: "2025-08-22",
      });
      expect(() =>
        repoC.createManifest(
          {
            "notice-publication": scenarioC.noticeGenerationId,
            "notice-product": scenarioC.productGenerationId,
            "award-registration": scenarioC.awardGenerationId,
            "designation-history": scenarioC.designationGenerationId,
            "award-classification": scenarioC.classificationGenerationId,
          },
          scenarioC.run.owner,
          scenarioC.run.fence,
        ),
      ).toThrow(
        /target.*missing|missing.*target|target.*result|result.*target/i,
      );
    } finally {
      firstC.close();
      secondC.close();
    }

    const {
      first: firstD,
      second: secondD,
      firstRepository: repoD,
    } = openFilePair();
    try {
      const scenarioD = createExactLot02ConflictScenario(repoD, firstD, {
        lot02ExactMatch: 0,
        includeLot02Revision: false,
        lot01WinnerBizNo: lot01Winner,
        lot02WinnerBizNo: null,
        canonicalLot: "01",
        lot01FinalAwardDate: "2025-08-22",
        lot02FinalAwardDate: "2025-08-22",
      });
      const manifestD = repoD.createManifest(
        {
          "notice-publication": scenarioD.noticeGenerationId,
          "notice-product": scenarioD.productGenerationId,
          "award-registration": scenarioD.awardGenerationId,
          "designation-history": scenarioD.designationGenerationId,
          "award-classification": scenarioD.classificationGenerationId,
        },
        scenarioD.run.owner,
        scenarioD.run.fence,
      );
      expect(typeof manifestD).toBe("number");
      expect(manifestD).toBeGreaterThan(0);
    } finally {
      firstD.close();
      secondD.close();
    }

    const {
      first: firstE,
      second: secondE,
      firstRepository: repoE,
    } = openFilePair();
    try {
      const scenarioE = createExactLot02ConflictScenario(repoE, firstE, {
        lot02ExactMatch: 0,
        includeLot02Revision: true,
        lot01WinnerBizNo: "1111111111",
        lot02WinnerBizNo: "1111111111",
        canonicalLot: "02",
        lot01FinalAwardDate: "2025-01-10",
        lot02FinalAwardDate: "2025-12-10",
      });
      expect(() =>
        repoE.createManifest(
          {
            "notice-publication": scenarioE.noticeGenerationId,
            "notice-product": scenarioE.productGenerationId,
            "award-registration": scenarioE.awardGenerationId,
            "designation-history": scenarioE.designationGenerationId,
            "award-classification": scenarioE.classificationGenerationId,
          },
          scenarioE.run.owner,
          scenarioE.run.fence,
        ),
      ).toThrow(/selected.*target|target.*selected|non-target|provenance/i);
    } finally {
      firstE.close();
      secondE.close();
    }

    const {
      first: firstF,
      second: secondF,
      firstRepository: repoF,
    } = openFilePair();
    try {
      const scenarioF = createExactLot02ConflictScenario(repoF, firstF, {
        lot02ExactMatch: 1,
        includeLot02Revision: false,
        lot01WinnerBizNo: lot01Winner,
        lot02WinnerBizNo: null,
        canonicalLot: null,
        lot01FinalAwardDate: "2025-08-22",
        lot02FinalAwardDate: "2025-08-22",
      });
      expect(() =>
        repoF.createManifest(
          {
            "notice-publication": scenarioF.noticeGenerationId,
            "notice-product": scenarioF.productGenerationId,
            "award-registration": scenarioF.awardGenerationId,
            "designation-history": scenarioF.designationGenerationId,
            "award-classification": scenarioF.classificationGenerationId,
          },
          scenarioF.run.owner,
          scenarioF.run.fence,
        ),
      ).toThrow(
        /target.*canonical|canonical.*target|target.*result|result.*target/i,
      );
    } finally {
      firstF.close();
      secondF.close();
    }
  });
});
