import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export type CoverageSource =
  | "notice-publication"
  | "award-registration"
  | "notice-product"
  | "designation-history"
  | "award-classification";

export type SyncRunInput = {
  trigger: "startup" | "manual" | "resume";
  dateFrom: string;
  dateTo: string;
  seoulDate: string;
};

export type StagedGeneration = {
  runId: number;
  source: CoverageSource;
  dateFrom: string;
  dateTo: string;
  sourceIdentityHashes: string[];
  expectedCount: number;
  observedCount: number;
  pageCount: number;
  identitySetHash: string;
  sourceHashes: Record<string, string>;
};

export type PromotionInput = Pick<
  StagedGeneration,
  "runId" | "source" | "dateFrom" | "dateTo" | "sourceIdentityHashes"
> & {
  generationId: number;
  completedAt: string;
};

export type ClassificationFactInput = {
  generationId: number;
  awardRevisionId: number;
  designationGenerationId: number;
  rulesVersion: string;
  evaluatedAwardDate: string;
  category: "cooperative" | "excellent" | "non_excellent" | "incomplete";
  matchedObservationId: number | null;
  reason: string;
  evidenceHash: string;
  createdAt: string;
};

export type CoverageSnapshot = {
  coverageId: number;
  generationId: number;
  expectedCount: number;
  observedCount: number;
  identitySetHash: string;
  complete: boolean;
};

export type MarketManifest = {
  manifestId: number;
  runId: number;
  version: number;
  generations: Record<CoverageSource, number>;
  coverage: Record<CoverageSource, CoverageSnapshot>;
};

export interface BuildingControlRepository {
  acquireLease(owner: string, now: string, ttlSeconds: number): number | null;
  renewLease(
    owner: string,
    fence: number,
    now: string,
    ttlSeconds: number,
  ): boolean;
  releaseLease(owner: string, fence: number): boolean;
  beginRun(input: SyncRunInput, owner: string, fence: number): number;
  stageGeneration(
    input: StagedGeneration,
    owner: string,
    fence: number,
  ): number;
  completeGeneration(
    input: PromotionInput,
    owner: string,
    fence: number,
  ): number;
  stageClassificationFacts(
    input: ClassificationFactInput[],
    owner: string,
    fence: number,
  ): number;
  createManifest(
    generationIds: Record<CoverageSource, number>,
    owner: string,
    fence: number,
  ): number;
  completeRunAndActivate(input: {
    runId: number;
    manifestId: number;
    expectedActiveManifestId: number | null;
    owner: string;
    fence: number;
    completedAt: string;
  }): boolean;
  readActiveManifest(): MarketManifest | null;
  failRun(
    runId: number,
    redactedMessage: string,
    owner: string,
    fence: number,
  ): void;
  hasSuccessfulStartupSync(seoulDate: string): boolean;
}

const SOURCES: CoverageSource[] = [
  "notice-publication",
  "award-registration",
  "notice-product",
  "designation-history",
  "award-classification",
];
const HEX_64 = /^[0-9a-f]{64}$/;

function requireIso(value: string, label: string): void {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date`);
  }
}

function addSeconds(value: string, seconds: number): string {
  requireIso(value, "now");
  return new Date(Date.parse(value) + seconds * 1_000).toISOString();
}

function computeIdentitySetHash(hashes: string[]): string {
  return createHash("sha256")
    .update([...hashes].sort().join("\n"))
    .digest("hex");
}

export function computeSourceIdentityHash(
  source: CoverageSource,
  parts: readonly string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([source, ...parts]))
    .digest("hex");
}

function requireHash(value: string, label: string): void {
  if (!HEX_64.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export function createBuildingControlRepository(
  db: Database.Database,
): BuildingControlRepository {
  const leaseRow = () =>
    db
      .prepare(
        `
        select owner, fence, expires_at
        from building_control_sync_leases
        where lock_name = 'building-control-sync'
      `,
      )
      .get() as
      { owner: string; fence: number; expires_at: string } | undefined;

  const hasLease = (
    owner: string,
    fence: number,
    at = new Date().toISOString(),
  ) => {
    const lease = leaseRow();
    return Boolean(
      lease &&
      lease.owner === owner &&
      lease.fence === fence &&
      Date.parse(lease.expires_at) > Date.parse(at),
    );
  };

  const requireLease = (owner: string, fence: number) => {
    if (!hasLease(owner, fence)) {
      throw new Error("lease owner or fencing token is stale");
    }
  };

  const requireRun = (runId: number, owner: string, fence: number) => {
    const run = db
      .prepare(
        `
        select id, status, lease_owner, lease_fence, date_from, date_to
        from building_control_sync_runs where id = ?
      `,
      )
      .get(runId) as
      | {
          id: number;
          status: string;
          lease_owner: string;
          lease_fence: number;
          date_from: string;
          date_to: string;
        }
      | undefined;
    if (
      !run ||
      run.status !== "running" ||
      run.lease_owner !== owner ||
      run.lease_fence !== fence
    ) {
      throw new Error("sync run is not running under the current lease fence");
    }
    return run;
  };

  const acquireLease = (owner: string, now: string, ttlSeconds: number) => {
    if (!owner.trim()) throw new Error("lease owner is required");
    requireIso(now, "now");
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error("lease TTL must be a positive integer");
    }
    return db
      .transaction((): number | null => {
        const current = leaseRow();
        const expiresAt = addSeconds(now, ttlSeconds);
        if (!current) {
          db.prepare(
            `
          insert into building_control_sync_leases
            (lock_name, owner, fence, expires_at, updated_at)
          values ('building-control-sync', ?, 1, ?, ?)
        `,
          ).run(owner, expiresAt, now);
          return 1;
        }
        if (
          current.owner === owner &&
          Date.parse(current.expires_at) > Date.parse(now)
        ) {
          db.prepare(
            `
          update building_control_sync_leases
          set expires_at = ?, updated_at = ?
          where lock_name = 'building-control-sync' and owner = ? and fence = ?
        `,
          ).run(expiresAt, now, owner, current.fence);
          return current.fence;
        }
        if (Date.parse(current.expires_at) > Date.parse(now)) return null;

        const nextFence = current.fence + 1;
        const updated = db
          .prepare(
            `
        update building_control_sync_leases
        set owner = ?, fence = ?, expires_at = ?, updated_at = ?
        where lock_name = 'building-control-sync' and fence = ?
      `,
          )
          .run(owner, nextFence, expiresAt, now, current.fence);
        return updated.changes === 1 ? nextFence : null;
      })
      .immediate();
  };

  const renewLease = (
    owner: string,
    fence: number,
    now: string,
    ttlSeconds: number,
  ) => {
    requireIso(now, "now");
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error("lease TTL must be a positive integer");
    }
    const result = db
      .prepare(
        `
      update building_control_sync_leases
      set expires_at = ?, updated_at = ?
      where lock_name = 'building-control-sync'
        and owner = ? and fence = ? and expires_at > ?
    `,
      )
      .run(addSeconds(now, ttlSeconds), now, owner, fence, now);
    return result.changes === 1;
  };

  const releaseLease = (owner: string, fence: number) => {
    const result = db
      .prepare(
        `
      update building_control_sync_leases
      set owner = '', expires_at = '1970-01-01T00:00:00.000Z', updated_at = ?
      where lock_name = 'building-control-sync' and owner = ? and fence = ?
    `,
      )
      .run(new Date().toISOString(), owner, fence);
    return result.changes === 1;
  };

  const beginRun = (input: SyncRunInput, owner: string, fence: number) =>
    db.transaction(() => {
      requireLease(owner, fence);
      requireIso(input.dateFrom, "dateFrom");
      requireIso(input.dateTo, "dateTo");
      requireIso(input.seoulDate, "seoulDate");
      const result = db
        .prepare(
          `
        insert into building_control_sync_runs
          (trigger, date_from, date_to, seoul_date, status, lease_owner, lease_fence, started_at)
        values (?, ?, ?, ?, 'running', ?, ?, ?)
      `,
        )
        .run(
          input.trigger,
          input.dateFrom,
          input.dateTo,
          input.seoulDate,
          owner,
          fence,
          new Date().toISOString(),
        );
      return Number(result.lastInsertRowid);
    })();

  const stageGeneration = (
    input: StagedGeneration,
    owner: string,
    fence: number,
  ) => {
    requireIso(input.dateFrom, "dateFrom");
    requireIso(input.dateTo, "dateTo");
    if (Date.parse(input.dateFrom) > Date.parse(input.dateTo)) {
      throw new Error("generation date range is inverted");
    }
    const unique = new Set(input.sourceIdentityHashes);
    input.sourceIdentityHashes.forEach((value) =>
      requireHash(value, "source identity"),
    );
    requireHash(input.identitySetHash, "identitySetHash");
    if (
      unique.size !== input.sourceIdentityHashes.length ||
      input.observedCount !== unique.size ||
      input.expectedCount !== input.observedCount
    ) {
      throw new Error(
        "generation count/cardinality does not match unique source identities",
      );
    }
    if (
      computeIdentitySetHash(input.sourceIdentityHashes) !==
      input.identitySetHash
    ) {
      throw new Error(
        "generation identitySetHash does not match source identities",
      );
    }
    const sourceHashKeys = Object.keys(input.sourceHashes);
    if (!sameStrings(sourceHashKeys, input.sourceIdentityHashes)) {
      throw new Error("sourceHashes keys must exactly match source identities");
    }
    Object.values(input.sourceHashes).forEach((value) =>
      requireHash(value, "source hash"),
    );

    return db.transaction(() => {
      requireLease(owner, fence);
      const run = requireRun(input.runId, owner, fence);
      if (input.dateFrom !== run.date_from || input.dateTo !== run.date_to) {
        throw new Error("generation date range must match its parent run");
      }
      const result = db
        .prepare(
          `
        insert into building_control_source_generations
          (sync_run_id, source, state, date_from, date_to, expected_count, observed_count,
           page_count, identity_set_hash, source_hashes_json, created_at)
        values (?, ?, 'staging', ?, ?, ?, ?, ?, ?, ?, ?)
      `,
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
          new Date().toISOString(),
        );
      return Number(result.lastInsertRowid);
    })();
  };

  const sourceFacts = (generationId: number, source: CoverageSource) => {
    const contracts: Record<
      CoverageSource,
      { entityType: string; partCount: number; sql: string }
    > = {
      "notice-publication": {
        entityType: "notice",
        partCount: 2,
        sql: `select id, source_hash, notice_no as p1, notice_order as p2,
                     '' as p3, '' as p4, '' as p5, '' as p6
              from building_control_notices where generation_id = ? order by id`,
      },
      "notice-product": {
        entityType: "notice-product",
        partCount: 4,
        sql: `select product.id, product.source_hash, notice.notice_no as p1,
                     notice.notice_order as p2, product.bid_clsfc_no as p3,
                     product.provider_row_identity as p4, '' as p5, '' as p6
              from building_control_notice_products product
              join building_control_notices notice on notice.id = product.notice_id
              where product.generation_id = ? order by product.id`,
      },
      "award-registration": {
        entityType: "award-revision",
        partCount: 4,
        sql: `select revision.id, revision.source_hash, notice.notice_no as p1,
                     notice.notice_order as p2, revision.bid_clsfc_no as p3,
                     revision.rbid_no as p4, revision.provider_result_identity as p5,
                     '' as p6
              from building_control_award_revisions revision
              join building_control_notices notice on notice.id = revision.notice_id
              where revision.generation_id = ? order by revision.id`,
      },
      "designation-history": {
        entityType: "designation-observation",
        partCount: 4,
        sql: `select observation.id, observation.source_hash,
                     designation.etpm_dsgn_crfc_no as p1,
                     designation.etpm_dsgn_dmnd_no as p2,
                     designation.dsgn_dmnd_chg_ord as p3,
                     designation.etps_sqno as p4, '' as p5, '' as p6
              from excellent_designation_observations observation
              join excellent_designations designation on designation.id = observation.designation_id
              where observation.generation_id = ? order by observation.id`,
      },
      "award-classification": {
        entityType: "award-classification",
        partCount: 5,
        sql: `select classification.id, classification.evidence_hash as source_hash,
                     notice.notice_no as p1, notice.notice_order as p2,
                     revision.bid_clsfc_no as p3, revision.rbid_no as p4,
                     classification.rules_version as p5, '' as p6
              from award_classifications classification
              join building_control_award_revisions revision
                on revision.id = classification.award_revision_id
              join building_control_notices notice on notice.id = revision.notice_id
              where classification.generation_id = ? order by classification.id`,
      },
    };
    const contract = contracts[source];
    const rawRows = db.prepare(contract.sql).all(generationId) as Array<{
      id: number;
      source_hash: string;
      p1: string;
      p2: string;
      p3: string;
      p4: string;
      p5: string;
      p6: string;
    }>;
    const rows = rawRows.map((row) => ({
      id: row.id,
      source_hash: row.source_hash,
      identity_hash: computeSourceIdentityHash(
        source,
        [row.p1, row.p2, row.p3, row.p4, row.p5, row.p6].slice(
          0,
          contract.partCount,
        ),
      ),
    }));
    return { entityType: contract.entityType, rows };
  };

  const validateGenerationProvenance = (
    generations: Record<CoverageSource, number>,
  ): void => {
    const scalar = (sql: string, ...params: unknown[]) =>
      (
        db.prepare(sql).get(...params) as {
          count: number;
        }
      ).count;
    const noticeGeneration = generations["notice-publication"];
    const productGeneration = generations["notice-product"];
    const awardGeneration = generations["award-registration"];
    const designationGeneration = generations["designation-history"];
    const classificationGeneration = generations["award-classification"];

    const invalidProductNotices = scalar(
      `select count(*) as count
       from building_control_notice_products product
       join building_control_notices notice on notice.id = product.notice_id
       where product.generation_id = ? and notice.generation_id <> ?`,
      productGeneration,
      noticeGeneration,
    );
    const invalidAwardNotices = scalar(
      `select count(*) as count
       from building_control_award_revisions revision
       join building_control_notices notice on notice.id = revision.notice_id
       where revision.generation_id = ? and notice.generation_id <> ?`,
      awardGeneration,
      noticeGeneration,
    );
    const invalidCanonicalAwards = scalar(
      `select count(*) as count
       from building_control_awards award
       join building_control_award_revisions revision on revision.id = award.selected_revision_id
       where award.generation_id = ?
         and (revision.generation_id <> ? or revision.notice_id <> award.notice_id)`,
      awardGeneration,
      awardGeneration,
    );
    const invalidClassifications = scalar(
      `select count(*) as count
       from award_classifications classification
       join building_control_award_revisions revision
         on revision.id = classification.award_revision_id
       left join building_control_awards canonical_award
         on canonical_award.selected_revision_id = classification.award_revision_id
         and canonical_award.generation_id = ?
       left join excellent_designation_observations observation
         on observation.id = classification.matched_observation_id
       where classification.generation_id = ?
         and (
           canonical_award.id is null
           or
           revision.generation_id <> ?
           or classification.designation_generation_id <> ?
           or (classification.matched_observation_id is not null
               and observation.generation_id <> ?)
         )`,
      awardGeneration,
      classificationGeneration,
      awardGeneration,
      designationGeneration,
      designationGeneration,
    );
    const canonicalAwardCount = scalar(
      `select count(*) as count from building_control_awards where generation_id = ?`,
      awardGeneration,
    );
    const classificationCount = scalar(
      `select count(*) as count from award_classifications where generation_id = ?`,
      classificationGeneration,
    );
    if (
      invalidProductNotices +
        invalidAwardNotices +
        invalidCanonicalAwards +
        invalidClassifications >
        0 ||
      canonicalAwardCount !== classificationCount
    ) {
      throw new Error(
        "manifest generations contain cross-generation provenance",
      );
    }

    const canonicalNoticesMissingTargetLot = scalar(
      `select count(*) as count
       from building_control_awards canonical_award
       where canonical_award.generation_id = ?
         and not exists (
           select 1
           from building_control_notice_products product
           where product.generation_id = ?
             and product.notice_id = canonical_award.notice_id
             and product.exact_match = 1
         )`,
      awardGeneration,
      productGeneration,
    );
    if (canonicalNoticesMissingTargetLot > 0) {
      throw new Error(
        "missing target result for canonical building-control award",
      );
    }

    const invalidSelectedNonTarget = scalar(
      `select count(*) as count
       from building_control_awards canonical_award
       join building_control_award_revisions selected_revision
         on selected_revision.id = canonical_award.selected_revision_id
        and selected_revision.generation_id = ?
        and selected_revision.notice_id = canonical_award.notice_id
       where canonical_award.generation_id = ?
         and not exists (
           select 1
           from building_control_notice_products product
           where product.generation_id = ?
             and product.notice_id = canonical_award.notice_id
             and product.bid_clsfc_no = selected_revision.bid_clsfc_no
             and product.exact_match = 1
         )`,
      awardGeneration,
      awardGeneration,
      productGeneration,
    );
    if (invalidSelectedNonTarget > 0) {
      throw new Error("selected canonical revision is not an exact target lot");
    }

    const conflictingTargetWinners = scalar(
      `select count(*) as count
       from (
         select distinct product.notice_id as notice_id, product.bid_clsfc_no as bid_clsfc_no
         from building_control_notice_products product
         where product.generation_id = ?
           and product.exact_match = 1
       ) target_lot
       join building_control_awards canonical_award
         on canonical_award.generation_id = ?
        and canonical_award.notice_id = target_lot.notice_id
       join building_control_award_revisions revision
         on revision.generation_id = ?
        and revision.notice_id = target_lot.notice_id
        and revision.bid_clsfc_no = target_lot.bid_clsfc_no
       where revision.winner_biz_no <> canonical_award.winner_biz_no`,
      productGeneration,
      awardGeneration,
      awardGeneration,
    );
    if (conflictingTargetWinners > 0) {
      throw new Error(
        "target winner conflicts with canonical building-control award",
      );
    }

    const missingTargetRevisionCount = scalar(
      `select count(*) as count
       from (
         select distinct product.notice_id as notice_id, product.bid_clsfc_no as bid_clsfc_no
         from building_control_notice_products product
         join building_control_awards canonical_award
           on canonical_award.generation_id = ?
          and canonical_award.notice_id = product.notice_id
         where product.generation_id = ?
           and product.exact_match = 1
       ) target_lot
       left join building_control_award_revisions revision
         on revision.generation_id = ?
        and revision.notice_id = target_lot.notice_id
        and revision.bid_clsfc_no = target_lot.bid_clsfc_no
       where revision.id is null`,
      awardGeneration,
      productGeneration,
      awardGeneration,
    );
    if (missingTargetRevisionCount > 0) {
      throw new Error(
        "missing target result for canonical building-control award",
      );
    }

    const missingCanonicalForTarget = scalar(
      `select count(*) as count
       from (
         select distinct product.notice_id as notice_id
         from building_control_notice_products product
         join building_control_award_revisions revision
           on revision.generation_id = ?
          and revision.notice_id = product.notice_id
          and revision.bid_clsfc_no = product.bid_clsfc_no
         where product.generation_id = ?
           and product.exact_match = 1
       ) target_notice
       left join building_control_awards canonical_award
         on canonical_award.generation_id = ?
        and canonical_award.notice_id = target_notice.notice_id
       where canonical_award.id is null`,
      awardGeneration,
      productGeneration,
      awardGeneration,
    );
    if (missingCanonicalForTarget > 0) {
      throw new Error(
        "target result is missing canonical building-control award",
      );
    }
  };

  const completeGeneration = (
    input: PromotionInput,
    owner: string,
    fence: number,
  ) => {
    requireIso(input.completedAt, "completedAt");
    return db.transaction(() => {
      requireLease(owner, fence);
      requireRun(input.runId, owner, fence);
      const generation = db
        .prepare(
          `select * from building_control_source_generations where id = ?`,
        )
        .get(input.generationId) as Record<string, unknown> | undefined;
      if (
        !generation ||
        generation.state !== "staging" ||
        generation.sync_run_id !== input.runId ||
        generation.source !== input.source ||
        generation.date_from !== input.dateFrom ||
        generation.date_to !== input.dateTo
      ) {
        throw new Error(
          "staged generation identity does not match promotion input",
        );
      }
      const declaredSourceHashes = JSON.parse(
        String(generation.source_hashes_json),
      ) as Record<string, string>;
      const declaredIdentities = Object.keys(declaredSourceHashes);
      if (!sameStrings(declaredIdentities, input.sourceIdentityHashes)) {
        throw new Error(
          "generation identity/cardinality does not match staged source hashes",
        );
      }
      const computed = computeIdentitySetHash(declaredIdentities);
      if (
        computed !== generation.identity_set_hash ||
        declaredIdentities.length !== generation.expected_count ||
        declaredIdentities.length !== generation.observed_count
      ) {
        throw new Error("generation stored coverage is incomplete");
      }
      const facts = sourceFacts(input.generationId, input.source);
      if (input.source === "award-registration") {
        const duplicateFinalGrain = db
          .prepare(
            `
            select notice.notice_no, notice.notice_order, revision.bid_clsfc_no
            from building_control_award_revisions revision
            join building_control_notices notice on notice.id = revision.notice_id
            where revision.generation_id = ?
            group by notice.notice_no, notice.notice_order, revision.bid_clsfc_no
            having count(*) <> 1
            limit 1
          `,
          )
          .get(input.generationId);
        if (duplicateFinalGrain) {
          throw new Error(
            "duplicate final award grain in successful-result generation",
          );
        }
      }
      const actualIdentityMap = Object.fromEntries(
        facts.rows.map((row) => [row.identity_hash, row.source_hash]),
      );
      if (
        Object.keys(actualIdentityMap).length !== facts.rows.length ||
        JSON.stringify(
          Object.entries(actualIdentityMap).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ) !==
          JSON.stringify(
            Object.entries(declaredSourceHashes).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          )
      ) {
        throw new Error(
          "generation provider identities do not match declared source facts",
        );
      }
      const insertMembership = db.prepare(`
        insert into building_control_generation_memberships
          (generation_id, entity_type, entity_id, identity_hash, source_hash)
        values (?, ?, ?, ?, ?)
      `);
      facts.rows.forEach((fact) =>
        insertMembership.run(
          input.generationId,
          facts.entityType,
          fact.id,
          fact.identity_hash,
          fact.source_hash,
        ),
      );
      db.prepare(
        `
        update building_control_source_generations
        set state = 'complete', completed_at = ?
        where id = ? and state = 'staging'
      `,
      ).run(input.completedAt, input.generationId);
      const coverage = db
        .prepare(
          `
        insert into building_control_coverage
          (generation_id, source, date_from, date_to, watermark, complete,
           expected_count, observed_count, identity_set_hash, completed_at)
        values (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `,
        )
        .run(
          input.generationId,
          input.source,
          input.dateFrom,
          input.dateTo,
          input.dateTo,
          declaredIdentities.length,
          facts.rows.length,
          computed,
          input.completedAt,
        );
      return Number(coverage.lastInsertRowid);
    })();
  };

  const stageClassificationFacts = (
    inputs: ClassificationFactInput[],
    owner: string,
    fence: number,
  ) =>
    db.transaction(() => {
      requireLease(owner, fence);
      const insert = db.prepare(`
        insert into award_classifications
          (generation_id, award_revision_id, designation_generation_id, rules_version,
           evaluated_award_date, category, matched_observation_id, reason, evidence_hash, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let count = 0;
      for (const input of inputs) {
        requireHash(input.evidenceHash, "classification evidence hash");
        requireIso(input.evaluatedAwardDate, "evaluatedAwardDate");
        requireIso(input.createdAt, "createdAt");
        const generation = db
          .prepare(
            `
            select sync_run_id, source, state from building_control_source_generations where id = ?
          `,
          )
          .get(input.generationId) as
          { sync_run_id: number; source: string; state: string } | undefined;
        if (
          !generation ||
          generation.source !== "award-classification" ||
          generation.state !== "staging"
        ) {
          throw new Error(
            "classification fact requires a staging award-classification generation",
          );
        }
        requireRun(generation.sync_run_id, owner, fence);
        const award = db
          .prepare(
            `
            select ag.sync_run_id, ag.source, revision.final_award_date
            from building_control_award_revisions revision
            join building_control_source_generations ag on ag.id = revision.generation_id
            where revision.id = ?
          `,
          )
          .get(input.awardRevisionId) as
          | { sync_run_id: number; source: string; final_award_date: string }
          | undefined;
        const designation = db
          .prepare(
            `
            select sync_run_id, source
            from building_control_source_generations where id = ?
          `,
          )
          .get(input.designationGenerationId) as
          { sync_run_id: number; source: string } | undefined;
        if (
          award?.source !== "award-registration" ||
          award.sync_run_id !== generation.sync_run_id ||
          award.final_award_date !== input.evaluatedAwardDate ||
          designation?.source !== "designation-history" ||
          designation.sync_run_id !== generation.sync_run_id
        ) {
          throw new Error(
            "classification award/designation provenance must match the current run",
          );
        }
        if (input.matchedObservationId !== null) {
          const observation = db
            .prepare(
              `
              select 1 from excellent_designation_observations
              where id = ? and generation_id = ?
            `,
            )
            .get(input.matchedObservationId, input.designationGenerationId);
          if (!observation) {
            throw new Error(
              "matched observation must belong to designation generation",
            );
          }
        }
        insert.run(
          input.generationId,
          input.awardRevisionId,
          input.designationGenerationId,
          input.rulesVersion,
          input.evaluatedAwardDate,
          input.category,
          input.matchedObservationId,
          input.reason,
          input.evidenceHash,
          input.createdAt,
        );
        count += 1;
      }
      return count;
    })();

  const createManifest = (
    generationIds: Record<CoverageSource, number>,
    owner: string,
    fence: number,
  ) =>
    db.transaction(() => {
      requireLease(owner, fence);
      const keys = Object.keys(generationIds);
      if (!sameStrings(keys, SOURCES))
        throw new Error("manifest requires exactly five sources");

      let runId: number | null = null;
      const rows: Array<{
        source: CoverageSource;
        generationId: number;
        coverageId: number;
      }> = [];
      for (const source of SOURCES) {
        const row = db
          .prepare(
            `
            select g.sync_run_id, g.source, g.state, g.date_from, g.date_to,
                   g.expected_count, g.observed_count, g.identity_set_hash,
                   c.id as coverage_id, c.generation_id as coverage_generation_id,
                   c.source as coverage_source, c.date_from as coverage_date_from,
                   c.date_to as coverage_date_to, c.watermark, c.complete,
                   c.expected_count as coverage_expected, c.observed_count as coverage_observed,
                   c.identity_set_hash as coverage_hash,
                   (select count(*) from building_control_generation_memberships membership
                    where membership.generation_id = g.id) as membership_count
            from building_control_source_generations g
            join building_control_coverage c on c.generation_id = g.id
            where g.id = ?
          `,
          )
          .get(generationIds[source]) as Record<string, unknown> | undefined;
        if (
          !row ||
          row.source !== source ||
          row.state !== "complete" ||
          row.complete !== 1 ||
          row.coverage_generation_id !== generationIds[source] ||
          row.coverage_source !== source ||
          row.date_from !== row.coverage_date_from ||
          row.date_to !== row.coverage_date_to ||
          row.watermark !== row.date_to ||
          row.expected_count !== row.observed_count ||
          row.expected_count !== row.coverage_expected ||
          row.observed_count !== row.coverage_observed ||
          row.observed_count !== row.membership_count ||
          row.identity_set_hash !== row.coverage_hash
        ) {
          throw new Error(`generation coverage for ${source} is not complete`);
        }
        if (runId === null) runId = Number(row.sync_run_id);
        if (runId !== Number(row.sync_run_id)) {
          throw new Error("manifest generations must belong to the same run");
        }
        rows.push({
          source,
          generationId: generationIds[source],
          coverageId: Number(row.coverage_id),
        });
      }
      const run = requireRun(runId!, owner, fence);
      if (
        rows.some((row) => {
          const generation = db
            .prepare(
              `
              select date_from, date_to from building_control_source_generations where id = ?
            `,
            )
            .get(row.generationId) as { date_from: string; date_to: string };
          return (
            generation.date_from !== run.date_from ||
            generation.date_to !== run.date_to
          );
        })
      ) {
        throw new Error(
          "manifest generation coverage range must match its run",
        );
      }
      validateGenerationProvenance(generationIds);
      const manifest = db
        .prepare(
          `
        insert into building_control_market_manifests (sync_run_id, created_at)
        values (?, ?)
      `,
        )
        .run(runId, new Date().toISOString());
      const manifestId = Number(manifest.lastInsertRowid);
      const insertSource = db.prepare(`
        insert into building_control_manifest_sources
          (manifest_id, source, generation_id, coverage_id)
        values (?, ?, ?, ?)
      `);
      rows.forEach((row) =>
        insertSource.run(
          manifestId,
          row.source,
          row.generationId,
          row.coverageId,
        ),
      );
      return manifestId;
    })();

  const completeRunAndActivate: BuildingControlRepository["completeRunAndActivate"] =
    (input) => {
      requireIso(input.completedAt, "completedAt");
      return db.transaction(() => {
        requireLease(input.owner, input.fence);
        requireRun(input.runId, input.owner, input.fence);
        const manifest = db
          .prepare(
            `select sync_run_id from building_control_market_manifests where id = ?`,
          )
          .get(input.manifestId) as { sync_run_id: number } | undefined;
        const children = db
          .prepare(
            `
          select ms.source, ms.generation_id, g.sync_run_id, g.state, g.date_from, g.date_to,
                 g.expected_count, g.observed_count, g.identity_set_hash,
                 c.source as coverage_source, c.generation_id as coverage_generation_id,
                 c.date_from as coverage_date_from, c.date_to as coverage_date_to,
                 c.watermark, c.complete, c.expected_count as coverage_expected,
                 c.observed_count as coverage_observed, c.identity_set_hash as coverage_hash
          from building_control_manifest_sources ms
          join building_control_source_generations g on g.id = ms.generation_id
          join building_control_coverage c on c.id = ms.coverage_id
          where ms.manifest_id = ?
        `,
          )
          .all(input.manifestId) as Array<
          Record<string, unknown> & {
            source: CoverageSource;
            generation_id: number;
          }
        >;
        if (
          manifest?.sync_run_id !== input.runId ||
          !sameStrings(
            children.map((child) => child.source),
            SOURCES,
          )
        ) {
          throw new Error(
            "candidate manifest is not a complete five-source manifest for this run",
          );
        }
        if (
          children.some(
            (child) =>
              child.state !== "complete" ||
              child.sync_run_id !== input.runId ||
              child.complete !== 1 ||
              child.coverage_source !== child.source ||
              child.coverage_generation_id !== child.generation_id ||
              child.coverage_date_from !== child.date_from ||
              child.coverage_date_to !== child.date_to ||
              child.watermark !== child.date_to ||
              child.coverage_expected !== child.expected_count ||
              child.coverage_observed !== child.observed_count ||
              child.coverage_hash !== child.identity_set_hash,
          )
        ) {
          throw new Error("candidate manifest coverage changed after creation");
        }
        validateGenerationProvenance(
          Object.fromEntries(
            children.map((child) => [child.source, child.generation_id]),
          ) as Record<CoverageSource, number>,
        );

        const active = db
          .prepare(
            `select manifest_id, version from building_control_active_manifest where singleton = 1`,
          )
          .get() as { manifest_id: number | null; version: number };
        if (active.manifest_id !== input.expectedActiveManifestId) return false;
        const update = db
          .prepare(
            `
        update building_control_active_manifest
        set manifest_id = ?, version = version + 1
        where singleton = 1 and version = ?
      `,
          )
          .run(input.manifestId, active.version);
        if (update.changes !== 1) return false;
        const completed = db
          .prepare(
            `
        update building_control_sync_runs
        set status = 'completed', completed_at = ?
        where id = ? and status = 'running' and lease_owner = ? and lease_fence = ?
      `,
          )
          .run(input.completedAt, input.runId, input.owner, input.fence);
        if (completed.changes !== 1)
          throw new Error("sync run completion lost its lease fence");
        return true;
      })();
    };

  const readActiveManifest = (): MarketManifest | null => {
    const active = db
      .prepare(
        `
        select a.manifest_id, a.version, m.sync_run_id
        from building_control_active_manifest a
        left join building_control_market_manifests m on m.id = a.manifest_id
        where a.singleton = 1
      `,
      )
      .get() as {
      manifest_id: number | null;
      version: number;
      sync_run_id: number | null;
    };
    if (active.manifest_id === null || active.sync_run_id === null) return null;
    const rows = db
      .prepare(
        `
        select ms.source, ms.generation_id, c.id as coverage_id, c.complete,
               c.expected_count, c.observed_count, c.identity_set_hash
        from building_control_manifest_sources ms
        join building_control_coverage c on c.id = ms.coverage_id
        where ms.manifest_id = ?
      `,
      )
      .all(active.manifest_id) as Array<{
      source: CoverageSource;
      generation_id: number;
      coverage_id: number;
      complete: number;
      expected_count: number;
      observed_count: number;
      identity_set_hash: string;
    }>;
    if (
      !sameStrings(
        rows.map((row) => row.source),
        SOURCES,
      )
    ) {
      throw new Error("active manifest does not contain exactly five sources");
    }
    return {
      manifestId: active.manifest_id,
      runId: active.sync_run_id,
      version: active.version,
      generations: Object.fromEntries(
        rows.map((row) => [row.source, row.generation_id]),
      ) as Record<CoverageSource, number>,
      coverage: Object.fromEntries(
        rows.map((row) => [
          row.source,
          {
            coverageId: row.coverage_id,
            generationId: row.generation_id,
            expectedCount: row.expected_count,
            observedCount: row.observed_count,
            identitySetHash: row.identity_set_hash,
            complete: row.complete === 1,
          },
        ]),
      ) as Record<CoverageSource, CoverageSnapshot>,
    };
  };

  const failRun = (
    runId: number,
    redactedMessage: string,
    owner: string,
    fence: number,
  ) => {
    db.transaction(() => {
      requireLease(owner, fence);
      requireRun(runId, owner, fence);
      db.prepare(
        `
        update building_control_sync_runs
        set status = 'failed', completed_at = ?, redacted_error = ? where id = ?
      `,
      ).run(new Date().toISOString(), redactedMessage, runId);
      db.prepare(
        `
        update building_control_source_generations
        set state = 'failed'
        where sync_run_id = ? and state = 'staging'
      `,
      ).run(runId);
    })();
  };

  const hasSuccessfulStartupSync = (seoulDate: string) =>
    Boolean(
      db
        .prepare(
          `
          select 1 from building_control_sync_runs
          where trigger = 'startup' and status = 'completed' and seoul_date = ?
        `,
        )
        .get(seoulDate),
    );

  return {
    acquireLease,
    renewLease,
    releaseLease,
    beginRun,
    stageGeneration,
    completeGeneration,
    stageClassificationFacts,
    createManifest,
    completeRunAndActivate,
    readActiveManifest,
    failRun,
    hasSuccessfulStartupSync,
  };
}
