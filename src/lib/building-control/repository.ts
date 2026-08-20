import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export type ExpectedRequestRole =
  | "notice-publication-bulk"
  | "award-registration-bulk"
  | "notice-identity-lookup"
  | "designation-list-all"
  | "designation-detail";

export type CollectorPlanRecord = {
  planId: string;
  name: string;
  description: string;
  requestSetHash: string;
  createdAt: string;
};

export type ExpectedRequestInput = {
  source: CoverageSource;
  role: ExpectedRequestRole;
  requestKey: string;
  dependencyRequestKey: string | null;
  collectorPlanId: string;
  canonicalQueryJson: string;
  now: string;
};

export type ExpectedRequestRecord = {
  id: number;
  syncRunId: number;
  source: CoverageSource;
  role: ExpectedRequestRole;
  requestKey: string;
  dependencyRequestId: number | null;
  collectorPlanId: string;
  canonicalQueryJson: string;
  state: "pending" | "sealed";
  sealedAt: string | null;
  createdAt: string;
};

export type SyncCheckpoint = {
  checkpointId: number;
  runId: number;
  source: CoverageSource;
  expectedRequestId: number;
  requestKey: string;
  cursorKind: "page" | "detail";
  nextCursor: number;
  pageSize: number;
  totalCount: number | null;
  observedCount: number;
  state: "collecting" | "complete";
  updatedAt: string;
  createdAt: string;
};

export type SyncCheckpointChunk = {
  checkpointId: number;
  cursor: number;
  pageSize: number;
  totalCount: number;
  factJson: string;
  identityHash: string;
  sourceHash: string;
  createdAt: string;
};

export type ResumeValidatedChunk = {
  source: CoverageSource;
  requestKey: string;
  cursorKind: "page" | "detail";
  cursor: number;
  pageSize: number;
  totalCount: number;
  facts: readonly unknown[];
  identityHashes: readonly string[];
  sourceHashes: Readonly<Record<string, string>>;
};

export type CheckpointPageInput = {
  source: CoverageSource;
  requestKey: string;
  cursorKind?: "page" | "detail";
  cursor: number;
  pageSize: number;
  totalCount: number;
  factJson: string;
  identityHash: string;
  sourceHash: string;
  now: string;
};

export type AwardQuarantineInput = {
  noticeNo: string | null;
  noticeOrder: string | null;
  bidClassNo: string | null;
  rbidNo: string | null;
  providerResultIdentity: string;
  registeredAt: string | null;
  finalAwardDate: string | null;
  rawJson: string;
  sourceHash: string;
  reason:
    | "missing_final_award_date"
    | "invalid_award_row"
    | "product_correlation_blocked";
  pageNo: number;
  pageIndex: number;
  now: string;
};

export type StageNoticeSnapshotInput = {
  runId: number;
  source: "notice-publication";
  dateFrom: string;
  dateTo: string;
  expectedCount: number;
  pageCount: number;
  notices: Array<{
    noticeNo: string;
    noticeOrder: string;
    noticeName: string;
    publicationDate: string;
    demandAgencyCode: string | null;
    demandAgencyName: string | null;
    noticeUrl: string | null;
    status: string;
    targetParentProductCode: string | null;
    targetDetailProductCode: string | null;
    rawJson: string;
    sourceHash: string;
  }>;
};

export type StageNoticeProductSnapshotInput = {
  runId: number;
  source: "notice-product";
  dateFrom: string;
  dateTo: string;
  expectedCount: number;
  pageCount: number;
  products: Array<{
    noticeNo: string;
    noticeOrder: string;
    bidClassNo: string;
    parentProductCode: string | null;
    detailProductCode: string | null;
    providerRowIdentity: string;
    exactMatch: 0 | 1;
    rawJson: string;
    sourceHash: string;
  }>;
};

export type StageAwardSnapshotInput = {
  runId: number;
  source: "award-registration";
  dateFrom: string;
  dateTo: string;
  expectedCount: number;
  pageCount: number;
  awards: Array<{
    noticeNo: string;
    noticeOrder: string;
    bidClassNo: string;
    rbidNo: string;
    providerResultIdentity: string;
    finalAwardDate: string;
    winnerBizNo: string;
    winnerName: string;
    sourceStatus: string;
    winnerRowsJson: string;
    rawJson: string;
    sourceHash: string;
    canonicalAward: {
      finalAwardDate: string;
      winnerBizNo: string;
      winnerName: string;
      awardAmount: number | null;
      awardRate: string | null;
      finalResultIdentity: string | null;
      rawJson: string | null;
    };
  }>;
  quarantines: AwardQuarantineInput[];
};

export type StageDesignationSnapshotInput = {
  runId: number;
  source: "designation-history";
  dateFrom: string;
  dateTo: string;
  expectedCount: number;
  pageCount: number;
  designations: Array<{
    certificateNo: string;
    demandNo: string;
    changeOrder: string;
    sequenceNo: string;
    designationNo: string | null;
    bizNoNormalized: string | null;
    observation: {
      bizNoNormalized: string;
      companyName: string;
      startDate: string;
      originalEndDate: string | null;
      extensionEndDate: string | null;
      effectiveEndDate: string | null;
      status: string;
      productName: string;
      classificationCodesJson: string;
      terminationState: string;
      terminationEvidenceHash: string | null;
      cancellationDate: string | null;
      revocationDate: string | null;
      listIdentity: string | null;
      detailIdentity: string | null;
      listRawJson: string;
      detailRawJson: string;
      sourceHash: string;
    };
  }>;
};

export type StagedSourceIds = {
  generationId: number;
  idsBySourceIdentity: Record<string, number>;
};

export type StageAwardSnapshotResult = StagedSourceIds & {
  canonicalAwardIdsByNotice: Record<string, number>;
  canonicalRevisionIdsByNotice: Record<string, number>;
  promotionBlocked: boolean;
  promotionBlockReasons: readonly string[];
};

export type StageDesignationSnapshotResult = StagedSourceIds & {
  observationIdsBySourceIdentity: Record<string, number>;
};

export type ResumeSeed = {
  checkpointId: number;
  expectedRequestId: number;
  requestKey: string;
  source: CoverageSource;
  cursorKind: "page" | "detail";
  nextCursor: number;
  pageSize: number;
  totalCount: number | null;
  observedCount: number;
  collectedIdentities: readonly string[];
  persistedChunks: readonly ResumeValidatedChunk[];
};

export type AdoptResumableRunInput = {
  owner: string;
  dateFrom: string;
  dateTo: string;
  seoulDate: string;
  collectorPlanId: string;
  now: string;
  ttlSeconds: number;
};

export type AdoptResumableRunResult = {
  runId: number;
  fence: number;
  resumed: boolean;
  previousTrigger: "startup" | "manual" | "resume" | null;
};

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
  registerCollectorPlan(plan: CollectorPlanRecord): void;
  registerExpectedRequests(
    runId: number,
    requests: readonly ExpectedRequestInput[],
    owner: string,
    fence: number,
  ): readonly number[];
  sealExpectedRequestSet(
    runId: number,
    collectorPlanId: string,
    owner: string,
    fence: number,
    now: string,
  ): { sealed: readonly number[] };
  readExpectedRequests(runId: number): readonly ExpectedRequestRecord[];
  readCheckpoint(
    runId: number,
    source: CoverageSource,
    requestKey: string,
  ): SyncCheckpoint | null;
  readCheckpointChunks(
    runId: number,
    source: CoverageSource,
    requestKey: string,
  ): readonly SyncCheckpointChunk[];
  stageCheckpointPage(
    input: CheckpointPageInput,
    runId: number,
    owner: string,
    fence: number,
  ): SyncCheckpoint;
  completeCheckpoint(
    runId: number,
    source: CoverageSource,
    requestKey: string,
    owner: string,
    fence: number,
    now: string,
  ): SyncCheckpoint;
  adoptResumableRun(input: AdoptResumableRunInput): AdoptResumableRunResult;
  resetDriftedCheckpoint(
    runId: number,
    source: CoverageSource,
    requestKey: string,
    owner: string,
    fence: number,
  ): "reset" | "restart-run";
  clearCompletedCheckpoints(runId: number, owner: string, fence: number): void;
  readResumeSeed(
    runId: number,
    source: CoverageSource,
    requestKey: string,
  ): ResumeSeed | null;
  stageNoticeSnapshot(
    input: StageNoticeSnapshotInput,
    owner: string,
    fence: number,
  ): StagedSourceIds;
  stageNoticeProductSnapshot(
    input: StageNoticeProductSnapshotInput,
    owner: string,
    fence: number,
  ): StagedSourceIds;
  stageAwardSnapshot(
    input: StageAwardSnapshotInput,
    owner: string,
    fence: number,
  ): StageAwardSnapshotResult;
  stageDesignationSnapshot(
    input: StageDesignationSnapshotInput,
    owner: string,
    fence: number,
  ): StageDesignationSnapshotResult;
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

const FORBIDDEN_FACT_KEYS: ReadonlySet<string> = new Set([
  "servicekey",
  "service_key",
  "service-key",
  "apikey",
  "api_key",
  "api-key",
  "authorization",
  "cookie",
  "setcookie",
  "set_cookie",
  "set-cookie",
  "sessionid",
  "session_id",
  "session-id",
  "token",
  "accesstoken",
  "access_token",
  "access-token",
  "refreshtoken",
  "refresh_token",
  "refresh-token",
  "secret",
  "password",
  "jsessionid",
  "requesturl",
  "request_url",
  "request-url",
  "requestidentity",
  "request_identity",
  "request-identity",
]);

const CREDENTIAL_URL_PATTERN: RegExp =
  /(?:[?&](?:serviceKey|apiKey|token|secret|password|sessionId|accessToken)=[^&\s]+)/i;
const BEARER_AUTH_PATTERN: RegExp = /Bearer\s+[A-Za-z0-9._\-]+/;
const COOKIE_ASSIGNMENT_PATTERN: RegExp =
  /(?:^|[;,\s])(?:session|cookie|jsessionid)\s*=\s*[^;,\s]+/i;
const SECRET_SENTINEL_PATTERN: RegExp = /secret_sentinel/i;

const CHECKPOINT_FACT_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "facts",
  "identityHashes",
  "sourceHashes",
]);

type CheckpointFactPayload = {
  readonly schemaVersion: 1;
  readonly facts: readonly unknown[];
  readonly identityHashes: readonly string[];
  readonly sourceHashes: Readonly<Record<string, string>>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeKeyName(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function collectForbiddenKeys(
  value: unknown,
  found: string[],
  seen: WeakSet<object>,
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) {
      collectForbiddenKeys(item, found, seen);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FACT_KEYS.has(normalizeKeyName(key))) {
      found.push(key);
    }
    collectForbiddenKeys(child, found, seen);
  }
}

function findCredentialPattern(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match ? match[0] : null;
}

function assertCheckpointPayloadAllowed(factJson: string): unknown {
  if (typeof factJson !== "string" || factJson.length === 0) {
    throw new Error("checkpoint factJson must be a non-empty JSON string");
  }
  const forbiddenKeys: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(factJson) as unknown;
    collectForbiddenKeys(parsed, forbiddenKeys, new WeakSet());
  } catch (error) {
    throw new Error(
      `checkpoint factJson is not valid JSON: ${(error as Error).message}`,
    );
  }
  if (forbiddenKeys.length > 0) {
    throw new Error(
      `checkpoint payload contains forbidden key: ${forbiddenKeys[0]}`,
    );
  }
  const credentialInUrl = findCredentialPattern(
    factJson,
    CREDENTIAL_URL_PATTERN,
  );
  if (credentialInUrl) {
    throw new Error(
      `checkpoint payload contains request URL with credentials: ${credentialInUrl}`,
    );
  }
  const bearerAuth = findCredentialPattern(factJson, BEARER_AUTH_PATTERN);
  if (bearerAuth) {
    throw new Error(
      `checkpoint payload contains authorization header: ${bearerAuth}`,
    );
  }
  const cookieAssignment = findCredentialPattern(
    factJson,
    COOKIE_ASSIGNMENT_PATTERN,
  );
  if (cookieAssignment) {
    throw new Error(
      `checkpoint payload contains cookie assignment: ${cookieAssignment}`,
    );
  }
  if (SECRET_SENTINEL_PATTERN.test(factJson)) {
    throw new Error("checkpoint payload contains secret sentinel value");
  }
  return parsed;
}

function parseCheckpointFactPayload(factJson: string): CheckpointFactPayload {
  const parsed = assertCheckpointPayloadAllowed(factJson);
  if (!isPlainRecord(parsed)) {
    throw new Error("checkpoint payload must be a JSON object");
  }
  const keys = Object.keys(parsed);
  if (
    keys.length !== CHECKPOINT_FACT_PAYLOAD_KEYS.size ||
    !keys.every((key) => CHECKPOINT_FACT_PAYLOAD_KEYS.has(key))
  ) {
    throw new Error(
      "checkpoint payload must contain exactly schemaVersion, facts, identityHashes, and sourceHashes",
    );
  }
  const { schemaVersion, facts, identityHashes, sourceHashes } = parsed;
  if (schemaVersion !== 1) {
    throw new Error("checkpoint payload schemaVersion must be 1");
  }
  if (!Array.isArray(facts)) {
    throw new Error("checkpoint payload facts must be an array");
  }
  if (!Array.isArray(identityHashes)) {
    throw new Error("checkpoint payload identityHashes must be an array");
  }
  if (!isPlainRecord(sourceHashes)) {
    throw new Error("checkpoint payload sourceHashes must be an object");
  }
  if (facts.length !== identityHashes.length) {
    throw new Error(
      "checkpoint payload facts length must equal identityHashes length",
    );
  }
  const seenIdentityHashes = new Set<string>();
  for (const identityHash of identityHashes) {
    if (typeof identityHash !== "string" || !HEX_64.test(identityHash)) {
      throw new Error(
        "checkpoint payload identityHashes must be lowercase SHA-256 strings",
      );
    }
    if (seenIdentityHashes.has(identityHash)) {
      throw new Error("checkpoint payload identityHashes must be unique");
    }
    seenIdentityHashes.add(identityHash);
  }
  const sourceHashKeys = Object.keys(sourceHashes);
  if (!sameStrings(sourceHashKeys, [...seenIdentityHashes])) {
    throw new Error(
      "checkpoint payload sourceHashes keys must exactly match identityHashes",
    );
  }
  for (const sourceHash of Object.values(sourceHashes)) {
    if (typeof sourceHash !== "string" || !HEX_64.test(sourceHash)) {
      throw new Error(
        "checkpoint payload sourceHashes values must be lowercase SHA-256 strings",
      );
    }
  }
  return {
    schemaVersion: 1,
    facts,
    identityHashes: [...seenIdentityHashes],
    sourceHashes: sourceHashes as Record<string, string>,
  };
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
    if (input.source !== "award-classification") {
      throw new Error(
        "non-classification generations require a typed checkpoint-bound snapshot writer",
      );
    }
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
      {
        entityType: string;
        partCount: number;
        sql: string;
        bindings?: readonly unknown[];
      }
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
        entityType: "award-observation",
        partCount: 4,
        sql: `with award_observations as (
                select revision.id as id, revision.source_hash as source_hash,
                       revision.provider_result_identity as provider_result_identity,
                       notice.notice_no as notice_no, notice.notice_order as notice_order,
                       revision.bid_clsfc_no as bid_clsfc_no, revision.rbid_no as rbid_no
                from building_control_award_revisions revision
                join building_control_notices notice on notice.id = revision.notice_id
                where revision.generation_id = ?
                union all
                select quarantine.id as id, quarantine.source_hash as source_hash,
                       quarantine.provider_result_identity as provider_result_identity,
                       case
                         when trim(coalesce(quarantine.notice_no, '')) <> ''
                          and trim(coalesce(quarantine.notice_order, '')) <> ''
                          and trim(coalesce(quarantine.bid_clsfc_no, '')) <> ''
                          and trim(coalesce(quarantine.rbid_no, '')) <> ''
                         then quarantine.notice_no
                         else 'quarantine:' || quarantine.page_no || ':' || quarantine.page_index || ':' || quarantine.source_hash
                       end as notice_no,
                       case
                         when trim(coalesce(quarantine.notice_no, '')) <> ''
                          and trim(coalesce(quarantine.notice_order, '')) <> ''
                          and trim(coalesce(quarantine.bid_clsfc_no, '')) <> ''
                          and trim(coalesce(quarantine.rbid_no, '')) <> ''
                         then quarantine.notice_order else ''
                       end as notice_order,
                       case
                         when trim(coalesce(quarantine.notice_no, '')) <> ''
                          and trim(coalesce(quarantine.notice_order, '')) <> ''
                          and trim(coalesce(quarantine.bid_clsfc_no, '')) <> ''
                          and trim(coalesce(quarantine.rbid_no, '')) <> ''
                         then quarantine.bid_clsfc_no else ''
                       end as bid_clsfc_no,
                       case
                         when trim(coalesce(quarantine.notice_no, '')) <> ''
                          and trim(coalesce(quarantine.notice_order, '')) <> ''
                          and trim(coalesce(quarantine.bid_clsfc_no, '')) <> ''
                          and trim(coalesce(quarantine.rbid_no, '')) <> ''
                         then quarantine.rbid_no else ''
                       end as rbid_no
                from building_control_award_quarantine quarantine
                where quarantine.generation_id = ?
              )
              select id, source_hash,
                     coalesce(notice_no, '') as p1,
                     coalesce(notice_order, '') as p2,
                     coalesce(bid_clsfc_no, '') as p3,
                     coalesce(rbid_no, '') as p4,
                     provider_result_identity as p5,
                     '' as p6
              from award_observations
              order by id`,
        bindings: [generationId, generationId],
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
    const bindings = contract.bindings ?? [generationId];
    const rawRows = db.prepare(contract.sql).all(...bindings) as Array<{
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

    const blockedGeneration = db
      .prepare(
        `select generation_id, reason from building_control_generation_blocks
         where generation_id in (?, ?, ?, ?, ?) limit 1`,
      )
      .get(
        noticeGeneration,
        productGeneration,
        awardGeneration,
        designationGeneration,
        classificationGeneration,
      ) as { generation_id: number; reason: string } | undefined;
    if (blockedGeneration) {
      throw new Error(
        `manifest provenance blocked: ${blockedGeneration.reason}`,
      );
    }

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
      if (input.source !== "award-classification") {
        assertSealedRequestSetForSource(input.runId, input.source);
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
        const promotionBlockRow = db
          .prepare(
            `select reason from building_control_generation_blocks
             where generation_id = ?`,
          )
          .get(input.generationId) as { reason: string } | undefined;
        if (promotionBlockRow) {
          throw new Error(
            `award generation promotion blocked: ${promotionBlockRow.reason}`,
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

  const buildRequestSetSeal = (
    runId: number,
    source: CoverageSource,
    collectorPlanId: string,
  ): { requestCount: number; requestSetHash: string } => {
    const rows = db
      .prepare(
        `
        select er.source, er.role, er.request_key,
               dependency.request_key as dependency_request_key,
               er.collector_plan_id, er.canonical_query_json
        from building_control_sync_expected_requests er
        left join building_control_sync_expected_requests dependency
          on dependency.id = er.dependency_request_id
        where er.sync_run_id = ? and er.source = ?
        order by er.request_key
        `,
      )
      .all(runId, source) as Array<{
      source: string;
      role: string;
      request_key: string;
      dependency_request_key: string | null;
      collector_plan_id: string;
      canonical_query_json: string;
    }>;
    if (rows.length === 0) {
      throw new Error(`no expected requests found for source ${source}`);
    }
    if (rows.some((row) => row.collector_plan_id !== collectorPlanId)) {
      throw new Error(
        `source ${source} contains requests from multiple collector plans`,
      );
    }
    const stableRows = rows.map((row) => ({
      source: row.source,
      role: row.role,
      requestKey: row.request_key,
      dependencyRequestKey: row.dependency_request_key,
      collectorPlanId: row.collector_plan_id,
      canonicalQueryJson: row.canonical_query_json,
    }));
    return {
      requestCount: rows.length,
      requestSetHash: createHash("sha256")
        .update(JSON.stringify(stableRows))
        .digest("hex"),
    };
  };

  const registerCollectorPlan = (plan: CollectorPlanRecord): void => {
    requireIso(plan.createdAt, "createdAt");
    requireHash(plan.requestSetHash, "requestSetHash");
    if (!plan.planId.trim()) {
      throw new Error("collector plan id is required");
    }
    db.transaction(() => {
      const existing = db
        .prepare(
          `
          select name, description, request_set_hash, created_at
          from building_control_collector_plans
          where plan_id = ?
          `,
        )
        .get(plan.planId) as
        | {
            name: string;
            description: string;
            request_set_hash: string;
            created_at: string;
          }
        | undefined;
      if (existing) {
        if (
          existing.name === plan.name &&
          existing.description === plan.description &&
          existing.request_set_hash === plan.requestSetHash &&
          existing.created_at === plan.createdAt
        ) {
          return;
        }
        throw new Error(
          "collector plan id already exists with different definition",
        );
      }
      db.prepare(
        `
        insert into building_control_collector_plans
          (plan_id, name, description, request_set_hash, created_at)
        values (?, ?, ?, ?, ?)
        `,
      ).run(
        plan.planId,
        plan.name,
        plan.description,
        plan.requestSetHash,
        plan.createdAt,
      );
    }).immediate();
  };

  const registerExpectedRequests = (
    runId: number,
    requests: readonly ExpectedRequestInput[],
    owner: string,
    fence: number,
  ): readonly number[] =>
    db
      .transaction((): number[] => {
        requireLease(owner, fence);
        const run = requireRun(runId, owner, fence);
        if (run.status !== "running") {
          throw new Error("expected requests require a running sync run");
        }
        const ids: number[] = [];
        const seenKeys = new Set<string>();
        const keyToId = new Map<string, number>();
        for (const input of requests) {
          if (!SOURCES.includes(input.source)) {
            throw new Error(`unknown coverage source: ${input.source}`);
          }
          if (!input.requestKey.trim()) {
            throw new Error("expected request key is required");
          }
          if (seenKeys.has(input.requestKey)) {
            throw new Error(
              `duplicate expected request key: ${input.requestKey}`,
            );
          }
          seenKeys.add(input.requestKey);
          const sealedForSource = db
            .prepare(
              `
              select count(*) as count
              from building_control_sync_expected_requests
              where sync_run_id = ? and source = ? and state = 'sealed'
              `,
            )
            .get(runId, input.source) as { count: number };
          if (sealedForSource.count > 0) {
            throw new Error(
              `cannot register request for sealed source: ${input.source}`,
            );
          }
          let dependencyId: number | null = null;
          if (input.dependencyRequestKey !== null) {
            const depRow = db
              .prepare(
                `select id from building_control_sync_expected_requests
                 where sync_run_id = ? and request_key = ?`,
              )
              .get(runId, input.dependencyRequestKey) as
              { id: number } | undefined;
            if (!depRow) {
              throw new Error(
                `dependency request not registered yet: ${input.dependencyRequestKey}`,
              );
            }
            dependencyId = depRow.id;
          }
          const result = db
            .prepare(
              `
              insert into building_control_sync_expected_requests
                (sync_run_id, source, role, request_key, dependency_request_id,
                 collector_plan_id, canonical_query_json, state, sealed_at, created_at)
              values (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)
              `,
            )
            .run(
              runId,
              input.source,
              input.role,
              input.requestKey,
              dependencyId,
              input.collectorPlanId,
              input.canonicalQueryJson,
              input.now,
            );
          const newId = Number(result.lastInsertRowid);
          ids.push(newId);
          keyToId.set(input.requestKey, newId);
        }
        return ids;
      })
      .immediate();

  const sealExpectedRequestSet = (
    runId: number,
    collectorPlanId: string,
    owner: string,
    fence: number,
    now: string,
  ): { sealed: readonly number[] } =>
    db
      .transaction(() => {
        requireLease(owner, fence);
        const run = requireRun(runId, owner, fence);
        if (run.status !== "running") {
          throw new Error("sealing requires a running sync run");
        }
        const rows = db
          .prepare(
            `
            select id, source, dependency_request_id, state, sealed_at
            from building_control_sync_expected_requests
            where sync_run_id = ? and collector_plan_id = ?
            order by id
            `,
          )
          .all(runId, collectorPlanId) as Array<{
          id: number;
          source: CoverageSource;
          dependency_request_id: number | null;
          state: string;
          sealed_at: string | null;
        }>;
        if (rows.length === 0) {
          throw new Error("no expected requests found for the run/plan");
        }
        const sealedSoFar = new Set<number>();
        for (const row of rows) {
          if (row.state === "sealed") {
            sealedSoFar.add(row.id);
            continue;
          }
          if (row.dependency_request_id !== null) {
            if (!sealedSoFar.has(row.dependency_request_id)) {
              throw new Error(
                `cannot seal ${row.id}: dependency ${row.dependency_request_id} is not sealed`,
              );
            }
          }
          db.prepare(
            `
            update building_control_sync_expected_requests
            set state = 'sealed', sealed_at = ?
            where id = ? and state = 'pending'
            `,
          ).run(now, row.id);
          sealedSoFar.add(row.id);
        }
        const sources = [...new Set(rows.map((row) => row.source))];
        for (const source of sources) {
          const descriptor = buildRequestSetSeal(
            runId,
            source,
            collectorPlanId,
          );
          const existing = db
            .prepare(
              `
              select collector_plan_id, request_count, request_set_hash
              from building_control_sync_request_sets
              where sync_run_id = ? and source = ?
              `,
            )
            .get(runId, source) as
            | {
                collector_plan_id: string;
                request_count: number;
                request_set_hash: string;
              }
            | undefined;
          if (existing) {
            if (
              existing.collector_plan_id !== collectorPlanId ||
              existing.request_count !== descriptor.requestCount ||
              existing.request_set_hash !== descriptor.requestSetHash
            ) {
              throw new Error(`sealed request set changed for source ${source}`);
            }
            continue;
          }
          db.prepare(
            `
            insert into building_control_sync_request_sets
              (sync_run_id, source, collector_plan_id, request_count,
               request_set_hash, sealed_at)
            values (?, ?, ?, ?, ?, ?)
            `,
          ).run(
            runId,
            source,
            collectorPlanId,
            descriptor.requestCount,
            descriptor.requestSetHash,
            now,
          );
        }
        return { sealed: [...sealedSoFar].sort((a, b) => a - b) };
      })
      .immediate();

  const readExpectedRequests = (
    runId: number,
  ): readonly ExpectedRequestRecord[] => {
    const rows = db
      .prepare(
        `
        select id, sync_run_id, source, role, request_key, dependency_request_id,
               collector_plan_id, canonical_query_json, state, sealed_at, created_at
        from building_control_sync_expected_requests
        where sync_run_id = ?
        order by id
        `,
      )
      .all(runId) as Array<{
      id: number;
      sync_run_id: number;
      source: string;
      role: string;
      request_key: string;
      dependency_request_id: number | null;
      collector_plan_id: string;
      canonical_query_json: string;
      state: string;
      sealed_at: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      syncRunId: row.sync_run_id,
      source: row.source as CoverageSource,
      role: row.role as ExpectedRequestRole,
      requestKey: row.request_key,
      dependencyRequestId: row.dependency_request_id,
      collectorPlanId: row.collector_plan_id,
      canonicalQueryJson: row.canonical_query_json,
      state: row.state as "pending" | "sealed",
      sealedAt: row.sealed_at,
      createdAt: row.created_at,
    }));
  };

  const findExpectedRequestId = (
    runId: number,
    source: CoverageSource,
    requestKey: string,
  ): {
    id: number;
    state: "pending" | "sealed";
    role: ExpectedRequestRole;
  } => {
    const row = db
      .prepare(
        `
        select id, state, role from building_control_sync_expected_requests
        where sync_run_id = ? and source = ? and request_key = ?
        `,
      )
      .get(runId, source, requestKey) as
      { id: number; state: string; role: string } | undefined;
    if (!row) {
      throw new Error(
        `no expected request for source ${source} key ${requestKey}`,
      );
    }
    if (row.state !== "sealed") {
      throw new Error(`expected request ${row.id} is not sealed yet`);
    }
    return {
      id: row.id,
      state: "sealed",
      role: row.role as ExpectedRequestRole,
    };
  };

  const readCheckpoint = (
    runId: number,
    source: CoverageSource,
    requestKey: string,
  ): SyncCheckpoint | null => {
    const row = db
      .prepare(
        `
        select id, sync_run_id, source, expected_request_id, request_key,
               cursor_kind, next_cursor, page_size, total_count,
               observed_count, state, updated_at, created_at
        from building_control_sync_checkpoints
        where sync_run_id = ? and source = ? and request_key = ?
        `,
      )
      .get(runId, source, requestKey) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      checkpointId: Number(row.id),
      runId: Number(row.sync_run_id),
      source: row.source as CoverageSource,
      expectedRequestId: Number(row.expected_request_id),
      requestKey: String(row.request_key),
      cursorKind: row.cursor_kind as "page" | "detail",
      nextCursor: Number(row.next_cursor),
      pageSize: Number(row.page_size),
      totalCount: row.total_count === null ? null : Number(row.total_count),
      observedCount: Number(row.observed_count),
      state: row.state as "collecting" | "complete",
      updatedAt: String(row.updated_at),
      createdAt: String(row.created_at),
    };
  };

  const readCheckpointChunks = (
    runId: number,
    source: CoverageSource,
    requestKey: string,
  ): readonly SyncCheckpointChunk[] => {
    const checkpoint = readCheckpoint(runId, source, requestKey);
    if (!checkpoint) return [];
    const rows = db
      .prepare(
        `
        select id, checkpoint_id, cursor, page_size, total_count, fact_json,
               identity_hash, source_hash, created_at
        from building_control_sync_checkpoint_pages
        where checkpoint_id = ?
        order by cursor
        `,
      )
      .all(checkpoint.checkpointId) as Array<{
      id: number;
      checkpoint_id: number;
      cursor: number;
      page_size: number;
      total_count: number;
      fact_json: string;
      identity_hash: string;
      source_hash: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      checkpointId: row.checkpoint_id,
      cursor: row.cursor,
      pageSize: row.page_size,
      totalCount: row.total_count,
      factJson: row.fact_json,
      identityHash: row.identity_hash,
      sourceHash: row.source_hash,
      createdAt: row.created_at,
    }));
  };

  const validateCheckpointEvidence = (
    checkpoint: SyncCheckpoint,
  ): readonly ResumeValidatedChunk[] => {
    const chunks = [...readCheckpointChunks(
      checkpoint.runId,
      checkpoint.source,
      checkpoint.requestKey,
    )].sort((left, right) => left.cursor - right.cursor);
    if (checkpoint.totalCount === null) {
      if (
        checkpoint.state === "collecting" &&
        checkpoint.observedCount === 0 &&
        checkpoint.nextCursor === 1 &&
        chunks.length === 0
      ) {
        return [];
      }
      throw new Error(
        "checkpoint page coverage is incomplete: totalCount is missing",
      );
    }
    const totalCount = checkpoint.totalCount;
    const expectedPageCount = Math.max(
      1,
      Math.ceil(totalCount / checkpoint.pageSize),
    );
    if (
      checkpoint.state === "complete" &&
      chunks.length !== expectedPageCount
    ) {
      throw new Error(
        `checkpoint page coverage is incomplete: expected ${expectedPageCount} pages, got ${chunks.length}`,
      );
    }
    if (chunks.length !== checkpoint.observedCount) {
      throw new Error(
        `checkpoint page coverage is incomplete: observedCount ${checkpoint.observedCount} does not match chunk count ${chunks.length}`,
      );
    }
    if (checkpoint.nextCursor !== chunks.length + 1) {
      throw new Error(
        `checkpoint page coverage is incomplete: nextCursor ${checkpoint.nextCursor} does not advance to ${chunks.length + 1}`,
      );
    }
    const seenIdentityHashes = new Map<string, string>();
    const validated: ResumeValidatedChunk[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const expectedCursor = index + 1;
      if (chunk.cursor !== expectedCursor) {
        throw new Error(
          `checkpoint page coverage is incomplete: expected cursor ${expectedCursor}, got ${chunk.cursor}`,
        );
      }
      if (chunk.cursor > expectedPageCount) {
        throw new Error(
          `checkpoint page coverage is incomplete: cursor ${chunk.cursor} exceeds expected page count ${expectedPageCount}`,
        );
      }
      if (chunk.pageSize !== checkpoint.pageSize) {
        throw new Error(
          `checkpoint page ${chunk.cursor} has inconsistent pageSize: expected ${checkpoint.pageSize}, got ${chunk.pageSize}`,
        );
      }
      if (chunk.totalCount !== totalCount) {
        throw new Error(
          `checkpoint page ${chunk.cursor} has inconsistent totalCount: expected ${totalCount}, got ${chunk.totalCount}`,
        );
      }
      const payload = parseCheckpointFactPayload(chunk.factJson);
      const expectedFactCount =
        chunk.cursor === expectedPageCount
          ? Math.max(
              0,
              totalCount - (expectedPageCount - 1) * checkpoint.pageSize,
            )
          : checkpoint.pageSize;
      if (payload.facts.length !== expectedFactCount) {
        throw new Error(
          `checkpoint payload must contain exactly ${expectedFactCount} facts for page ${chunk.cursor}`,
        );
      }
      if (
        chunk.identityHash !==
        computeIdentitySetHash([...payload.identityHashes])
      ) {
        throw new Error(
          `checkpoint page ${chunk.cursor} identity hash does not match payload`,
        );
      }
      const recomputedSourceHash = createHash("sha256")
        .update(chunk.factJson)
        .digest("hex");
      if (chunk.sourceHash !== recomputedSourceHash) {
        throw new Error(
          `checkpoint page ${chunk.cursor} source hash does not match payload`,
        );
      }
      for (const identityHash of payload.identityHashes) {
        const mappedSourceHash = payload.sourceHashes[identityHash];
        if (seenIdentityHashes.has(identityHash)) {
          throw new Error(
            `checkpoint page coverage is incomplete: duplicate identity hash ${identityHash}`,
          );
        }
        seenIdentityHashes.set(identityHash, mappedSourceHash);
      }
      validated.push({
        source: checkpoint.source,
        requestKey: checkpoint.requestKey,
        cursorKind: checkpoint.cursorKind,
        cursor: chunk.cursor,
        pageSize: chunk.pageSize,
        totalCount: chunk.totalCount,
        facts: payload.facts,
        identityHashes: payload.identityHashes,
        sourceHashes: payload.sourceHashes,
      });
    }
    return validated;
  };

  const stageCheckpointPage = (
    input: CheckpointPageInput,
    runId: number,
    owner: string,
    fence: number,
  ): SyncCheckpoint =>
    db
      .transaction((): SyncCheckpoint => {
        requireLease(owner, fence);
        const run = requireRun(runId, owner, fence);
        if (run.status !== "running") {
          throw new Error("checkpoint page requires a running sync run");
        }
        requireIso(input.now, "now");
        requireHash(input.identityHash, "identityHash");
        requireHash(input.sourceHash, "sourceHash");
        assertCheckpointPayloadAllowed(input.factJson);
        if (!Number.isInteger(input.cursor) || input.cursor < 1) {
          throw new Error("checkpoint cursor must be a positive integer");
        }
        if (!Number.isInteger(input.pageSize) || input.pageSize < 1) {
          throw new Error("checkpoint pageSize must be a positive integer");
        }
        if (!Number.isInteger(input.totalCount) || input.totalCount < 0) {
          throw new Error(
            "checkpoint totalCount must be a non-negative integer",
          );
        }
        const payload = parseCheckpointFactPayload(input.factJson);
        const expectedPages = Math.max(
          1,
          Math.ceil(input.totalCount / input.pageSize),
        );
        if (input.cursor > expectedPages) {
          throw new Error(
            "checkpoint cursor drift: cursor cannot exceed the expected page count",
          );
        }
        const expectedFactCount =
          input.cursor === expectedPages
            ? Math.max(
                0,
                input.totalCount - (expectedPages - 1) * input.pageSize,
              )
            : input.pageSize;
        if (payload.facts.length !== expectedFactCount) {
          throw new Error(
            `checkpoint payload must contain exactly ${expectedFactCount} facts for page ${input.cursor}`,
          );
        }
        const derivedIdentityHash = computeIdentitySetHash([
          ...payload.identityHashes,
        ]);
        if (derivedIdentityHash !== input.identityHash) {
          throw new Error(
            "checkpoint identity hash does not match payload identityHashes",
          );
        }
        const derivedSourceHash = createHash("sha256")
          .update(input.factJson)
          .digest("hex");
        if (derivedSourceHash !== input.sourceHash) {
          throw new Error(
            "checkpoint source hash does not match payload sourceHash",
          );
        }
        const expected = findExpectedRequestId(
          runId,
          input.source,
          input.requestKey,
        );
        const requiredCursorKind =
          expected.role === "designation-detail" ? "detail" : "page";
        const cursorKind = input.cursorKind ?? requiredCursorKind;
        if (cursorKind !== requiredCursorKind) {
          throw new Error(
            `checkpoint cursor kind must be ${requiredCursorKind} for ${expected.role}`,
          );
        }
        const existing = readCheckpoint(runId, input.source, input.requestKey);
        if (existing) {
          if (existing.state === "complete") {
            throw new Error(
              "checkpoint is already complete: cannot stage additional pages",
            );
          }
          if (existing.nextCursor !== input.cursor) {
            throw new Error(
              `checkpoint cursor drift: expected ${existing.nextCursor}, got ${input.cursor}`,
            );
          }
          if (existing.cursorKind !== cursorKind) {
            throw new Error(
              `checkpoint cursor kind drift: expected ${existing.cursorKind}, got ${cursorKind}`,
            );
          }
          if (
            existing.totalCount !== null &&
            existing.totalCount !== input.totalCount
          ) {
            throw new Error(
              `checkpoint totalCount drift: expected ${existing.totalCount}, got ${input.totalCount}`,
            );
          }
          db.prepare(
            `
            insert into building_control_sync_checkpoint_pages
              (checkpoint_id, cursor, page_size, total_count, fact_json,
               identity_hash, source_hash, created_at)
            values (?, ?, ?, ?, ?, ?, ?, ?)
            `,
          ).run(
            existing.checkpointId,
            input.cursor,
            input.pageSize,
            input.totalCount,
            input.factJson,
            input.identityHash,
            input.sourceHash,
            input.now,
          );
          db.prepare(
            `
            update building_control_sync_checkpoints
            set next_cursor = next_cursor + 1,
                observed_count = observed_count + 1,
                total_count = ?,
                updated_at = ?
            where id = ?
            `,
          ).run(input.totalCount, input.now, existing.checkpointId);
          const refreshed = readCheckpoint(
            runId,
            input.source,
            input.requestKey,
          );
          if (!refreshed) {
            throw new Error("checkpoint disappeared after staging page");
          }
          return refreshed;
        }
        const insert = db
          .prepare(
            `
            insert into building_control_sync_checkpoints
              (sync_run_id, source, expected_request_id, request_key,
               cursor_kind, next_cursor, page_size, total_count,
               observed_count, state, updated_at, created_at)
            values (?, ?, ?, ?, ?, 2, ?, ?, 1, 'collecting', ?, ?)
            `,
          )
          .run(
            runId,
            input.source,
            expected.id,
            input.requestKey,
            cursorKind,
            input.pageSize,
            input.totalCount,
            input.now,
            input.now,
          );
        const checkpointId = Number(insert.lastInsertRowid);
        db.prepare(
          `
          insert into building_control_sync_checkpoint_pages
            (checkpoint_id, cursor, page_size, total_count, fact_json,
             identity_hash, source_hash, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          checkpointId,
          input.cursor,
          input.pageSize,
          input.totalCount,
          input.factJson,
          input.identityHash,
          input.sourceHash,
          input.now,
        );
        const refreshed = readCheckpoint(runId, input.source, input.requestKey);
        if (!refreshed) {
          throw new Error("checkpoint disappeared after staging first page");
        }
        return refreshed;
      })
      .immediate();

  const completeCheckpoint = (
    runId: number,
    source: CoverageSource,
    requestKey: string,
    owner: string,
    fence: number,
    now: string,
  ): SyncCheckpoint =>
    db
      .transaction((): SyncCheckpoint => {
        requireLease(owner, fence);
        requireRun(runId, owner, fence);
        requireIso(now, "now");
        const checkpoint = readCheckpoint(runId, source, requestKey);
        if (!checkpoint) {
          throw new Error("checkpoint not found for completion");
        }
        validateCheckpointEvidence(checkpoint);
        db.prepare(
          `
          update building_control_sync_checkpoints
          set state = 'complete', updated_at = ?
          where id = ? and state = 'collecting'
          `,
        ).run(now, checkpoint.checkpointId);
        const refreshed = readCheckpoint(runId, source, requestKey);
        if (!refreshed) {
          throw new Error("checkpoint disappeared after completion");
        }
        validateCheckpointEvidence(refreshed);
        return refreshed;
      })
      .immediate();

  const adoptResumableRun = (
    input: AdoptResumableRunInput,
  ): AdoptResumableRunResult => {
    requireIso(input.now, "now");
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
      throw new Error("lease TTL must be a positive integer");
    }
    return db
      .transaction((): AdoptResumableRunResult => {
        const candidate = db
          .prepare(
            `
            select r.id, r.trigger, r.date_from, r.date_to, r.seoul_date,
                   r.status, r.lease_owner, r.lease_fence,
                   (select count(distinct collector_plan_id)
                    from building_control_sync_expected_requests
                    where sync_run_id = r.id) as plan_count,
                   lease.expires_at as lease_expires_at
            from building_control_sync_runs r
            join building_control_sync_leases lease
              on lease.owner = r.lease_owner
             and lease.fence = r.lease_fence
            where r.status = 'running'
              and r.date_from = ?
              and r.date_to = ?
              and r.seoul_date = ?
              and exists (
                select 1
                from building_control_sync_expected_requests expected
                where expected.sync_run_id = r.id
                  and expected.collector_plan_id = ?
              )
              and not exists (
                select 1
                from building_control_sync_expected_requests expected
                where expected.sync_run_id = r.id
                  and expected.collector_plan_id <> ?
              )
              and r.lease_owner <> ''
              and lease.expires_at <= ?
            order by r.id desc
            `,
          )
          .get(
            input.dateFrom,
            input.dateTo,
            input.seoulDate,
            input.collectorPlanId,
            input.collectorPlanId,
            input.now,
          ) as
          | {
              id: number;
              trigger: string;
              date_from: string;
              date_to: string;
              seoul_date: string;
              status: string;
              lease_owner: string;
              lease_fence: number;
              plan_count: number;
              lease_expires_at: string;
            }
          | undefined;
        let fence: number;
        let runId: number;
        let resumed = false;
        let previousTrigger: "startup" | "manual" | "resume" | null = null;
        if (
          candidate &&
          candidate.plan_count === 1 &&
          candidate.lease_owner !== input.owner
        ) {
          const lease = leaseRow();
          if (
            !lease ||
            lease.fence !== candidate.lease_fence ||
            lease.owner !== candidate.lease_owner
          ) {
            throw new Error("resumable run lease row is missing");
          }
          const nextFence = candidate.lease_fence + 1;
          db.prepare(
            `
            update building_control_sync_leases
            set owner = ?, fence = ?, expires_at = ?, updated_at = ?
            where lock_name = 'building-control-sync' and fence = ?
            `,
          ).run(
            input.owner,
            nextFence,
            addSeconds(input.now, input.ttlSeconds),
            input.now,
            candidate.lease_fence,
          );
          db.prepare(
            `
            update building_control_sync_runs
            set lease_owner = ?, lease_fence = ?, trigger = 'resume'
            where id = ?
            `,
          ).run(input.owner, nextFence, candidate.id);
          fence = nextFence;
          runId = candidate.id;
          resumed = true;
          previousTrigger = candidate.trigger as
            "startup" | "manual" | "resume";
        } else {
          fence = acquireLease(input.owner, input.now, input.ttlSeconds) ?? 0;
          if (fence === 0) {
            throw new Error("unable to acquire lease for new run");
          }
          runId = beginRun(
            {
              trigger: "resume",
              dateFrom: input.dateFrom,
              dateTo: input.dateTo,
              seoulDate: input.seoulDate,
            },
            input.owner,
            fence,
          );
        }
        return {
          runId,
          fence,
          resumed,
          previousTrigger,
        };
      })
      .immediate();
  };

  const resetDriftedCheckpoint = (
    runId: number,
    source: CoverageSource,
    requestKey: string,
    owner: string,
    fence: number,
  ): "reset" | "restart-run" =>
    db
      .transaction((): "reset" | "restart-run" => {
        requireLease(owner, fence);
        requireRun(runId, owner, fence);
        const checkpoint = readCheckpoint(runId, source, requestKey);
        if (!checkpoint) return "reset";
        if (checkpoint.state === "complete") return "restart-run";
        db.prepare(
          `delete from building_control_sync_checkpoint_pages where checkpoint_id = ?`,
        ).run(checkpoint.checkpointId);
        db.prepare(
          `
          update building_control_sync_checkpoints
          set next_cursor = 1, observed_count = 0, total_count = NULL,
              state = 'collecting', updated_at = ?
          where id = ?
          `,
        ).run(new Date().toISOString(), checkpoint.checkpointId);
        return "reset";
      })
      .immediate();

  const clearCompletedCheckpoints = (
    runId: number,
    owner: string,
    fence: number,
  ): void =>
    db
      .transaction(() => {
        requireLease(owner, fence);
        requireRun(runId, owner, fence);
        // Completed checkpoint evidence must be preserved; no deletes performed.
      })
      .immediate();

  const readResumeSeed = (
    runId: number,
    source: CoverageSource,
    requestKey: string,
  ): ResumeSeed | null => {
    const checkpoint = readCheckpoint(runId, source, requestKey);
    if (!checkpoint) return null;
    const persistedChunks = validateCheckpointEvidence(checkpoint);
    const collectedIdentities = persistedChunks.flatMap(
      (chunk) => chunk.identityHashes,
    );
    return {
      checkpointId: checkpoint.checkpointId,
      expectedRequestId: checkpoint.expectedRequestId,
      requestKey: checkpoint.requestKey,
      source: checkpoint.source,
      cursorKind: checkpoint.cursorKind,
      nextCursor: checkpoint.nextCursor,
      pageSize: checkpoint.pageSize,
      totalCount: checkpoint.totalCount,
      observedCount: checkpoint.observedCount,
      collectedIdentities,
      persistedChunks,
    };
  };

  const assertSealedRequestSetForSource = (
    runId: number,
    source: CoverageSource,
  ): void => {
    const total = db
      .prepare(
        `
        select count(*) as count
        from building_control_sync_expected_requests
        where sync_run_id = ? and source = ?
        `,
      )
      .get(runId, source) as { count: number };
    if (total.count === 0) {
      throw new Error(
        `snapshot cannot be staged: no expected request registered for ${source}`,
      );
    }
    const seal = db
      .prepare(
        `
        select collector_plan_id, request_count, request_set_hash
        from building_control_sync_request_sets
        where sync_run_id = ? and source = ?
        `,
      )
      .get(runId, source) as
      | {
          collector_plan_id: string;
          request_count: number;
          request_set_hash: string;
        }
      | undefined;
    if (!seal) {
      throw new Error(
        `snapshot cannot be staged: request set is not sealed for ${source}`,
      );
    }
    const computedSeal = buildRequestSetSeal(
      runId,
      source,
      seal.collector_plan_id,
    );
    if (
      seal.request_count !== computedSeal.requestCount ||
      seal.request_set_hash !== computedSeal.requestSetHash
    ) {
      throw new Error(
        `snapshot cannot be staged: request set seal mismatch for ${source}`,
      );
    }
    const unsealed = db
      .prepare(
        `
        select count(*) as count
        from building_control_sync_expected_requests
        where sync_run_id = ? and source = ? and state <> 'sealed'
        `,
      )
      .get(runId, source) as { count: number };
    if (unsealed.count > 0) {
      throw new Error(
        `snapshot cannot be staged: ${unsealed.count} ${source} expected request(s) are not sealed`,
      );
    }
    const checkpointRows = db
      .prepare(
        `
        select
          er.request_key as request_key,
          er.id as expected_request_id,
          ck.id as checkpoint_id,
          ck.state as checkpoint_state
        from building_control_sync_expected_requests er
        left join building_control_sync_checkpoints ck
          on ck.expected_request_id = er.id
         and ck.sync_run_id = er.sync_run_id
         and ck.source = er.source
         and ck.request_key = er.request_key
        where er.sync_run_id = ? and er.source = ?
        `,
      )
      .all(runId, source) as Array<{
        request_key: string;
        expected_request_id: number;
        checkpoint_id: number | null;
        checkpoint_state: string | null;
      }>;
    if (checkpointRows.length !== total.count) {
      throw new Error(
        `snapshot cannot be staged: missing checkpoint rows for sealed expected requests on ${source}`,
      );
    }
    const checkpointIdsByRequest = new Map<number, number[]>();
    for (const row of checkpointRows) {
      if (row.checkpoint_id === null) {
        throw new Error(
          `snapshot cannot be staged: expected request ${row.request_key} has no checkpoint`,
        );
      }
      const ids = checkpointIdsByRequest.get(row.expected_request_id) ?? [];
      ids.push(row.checkpoint_id);
      checkpointIdsByRequest.set(row.expected_request_id, ids);
    }
    for (const [, ids] of checkpointIdsByRequest) {
      if (ids.length !== 1) {
        throw new Error(
          `snapshot cannot be staged: duplicate checkpoint rows found for a sealed expected request on ${source}`,
        );
      }
    }
    for (const row of checkpointRows) {
      if (row.checkpoint_state !== "complete") {
        throw new Error(
          `snapshot cannot be staged: checkpoint for request ${row.request_key} on ${source} is not complete`,
        );
      }
    }
    for (const row of checkpointRows) {
      const checkpoint = readCheckpoint(runId, source, row.request_key);
      if (!checkpoint) {
        throw new Error(
          `snapshot cannot be staged: checkpoint for request ${row.request_key} on ${source} is missing`,
        );
      }
      validateCheckpointEvidence(checkpoint);
    }
  };

  const readCompletedCheckpointEvidence = (
    runId: number,
    source: CoverageSource,
  ): {
    facts: unknown[];
    identityHashes: string[];
    sourceHashes: Record<string, string>;
    pageCount: number;
  } => {
    const requests = readExpectedRequests(runId)
      .filter((request) => request.source === source)
      .sort((left, right) => left.id - right.id);
    const facts: unknown[] = [];
    const identityHashes: string[] = [];
    const sourceHashes: Record<string, string> = {};
    const seenIdentityHashes = new Set<string>();
    let pageCount = 0;
    for (const request of requests) {
      const checkpoint = readCheckpoint(runId, source, request.requestKey);
      if (!checkpoint || checkpoint.state !== "complete") {
        throw new Error(
          "snapshot cannot be staged: checkpoint for request " +
            request.requestKey +
            " on " +
            source +
            " is not complete",
        );
      }
      const chunks = validateCheckpointEvidence(checkpoint);
      for (const chunk of chunks) {
        facts.push(...chunk.facts);
        for (const identityHash of chunk.identityHashes) {
          if (seenIdentityHashes.has(identityHash)) {
            throw new Error(
              "snapshot cannot be staged: duplicate checkpoint identity hash " +
                identityHash +
                " on " +
                source,
            );
          }
          seenIdentityHashes.add(identityHash);
          identityHashes.push(identityHash);
          sourceHashes[identityHash] = chunk.sourceHashes[identityHash];
        }
        pageCount += 1;
      }
    }
    return { facts, identityHashes, sourceHashes, pageCount };
  };

  const assertCheckpointSnapshotMatches = (
    runId: number,
    source: CoverageSource,
    facts: readonly unknown[],
    identityToHash: ReadonlyMap<string, string>,
    pageCount: number,
  ): void => {
    const evidence = readCompletedCheckpointEvidence(runId, source);
    if (evidence.pageCount !== pageCount) {
      throw new Error(
        "snapshot cannot be staged: checkpoint page count mismatch for " +
          source,
      );
    }
    if (
      evidence.facts.length !== facts.length ||
      JSON.stringify(evidence.facts) !== JSON.stringify(facts)
    ) {
      throw new Error(
        "snapshot cannot be staged: checkpoint facts mismatch for " + source,
      );
    }
    const inputIdentityHashes = [...identityToHash.keys()];
    if (!sameStrings(evidence.identityHashes, inputIdentityHashes)) {
      throw new Error(
        "snapshot cannot be staged: checkpoint identity hash set mismatch for " +
          source,
      );
    }
    for (const identityHash of inputIdentityHashes) {
      if (
        evidence.sourceHashes[identityHash] !==
        identityToHash.get(identityHash)
      ) {
        throw new Error(
          "snapshot cannot be staged: checkpoint source hash mismatch for " +
            source,
        );
      }
    }
  };

  const stageNoticeSnapshot = (
    input: StageNoticeSnapshotInput,
    owner: string,
    fence: number,
  ): StagedSourceIds =>
    db
      .transaction((): StagedSourceIds => {
        requireLease(owner, fence);
        const run = requireRun(input.runId, owner, fence);
        if (run.status !== "running") {
          throw new Error("snapshot writers require a running sync run");
        }
        if (input.dateFrom !== run.date_from || input.dateTo !== run.date_to) {
          throw new Error("snapshot date range must match parent run");
        }
        assertSealedRequestSetForSource(input.runId, "notice-publication");
        if (input.notices.length !== input.expectedCount) {
          throw new Error(
            "snapshot expectedCount does not match notices length",
          );
        }
        const seenIdentity = new Set<string>();
        const identityToHash = new Map<string, string>();
        const seenHashes = new Set<string>();
        const rows = input.notices.map((notice) => {
          const identity = `${notice.noticeNo}|${notice.noticeOrder}`;
          if (seenIdentity.has(identity)) {
            throw new Error(`duplicate notice identity: ${identity}`);
          }
          seenIdentity.add(identity);
          if (seenHashes.has(notice.sourceHash)) {
            throw new Error(
              `duplicate notice source hash: ${notice.sourceHash}`,
            );
          }
          seenHashes.add(notice.sourceHash);
          const identityHash = computeSourceIdentityHash("notice-publication", [
            notice.noticeNo,
            notice.noticeOrder,
          ]);
          identityToHash.set(identityHash, notice.sourceHash);
          return notice;
        });
        assertCheckpointSnapshotMatches(
          input.runId,
          "notice-publication",
          rows,
          identityToHash,
          input.pageCount,
        );
        const identityHashes = [...identityToHash.keys()].sort();
        const identitySetHash = computeIdentitySetHash(identityHashes);
        const sourceHashes: Record<string, string> = {};
        for (const identityHash of identityHashes) {
          sourceHashes[identityHash] = identityToHash.get(identityHash)!;
        }
        const generationInsert = db
          .prepare(
            `
            insert into building_control_source_generations
              (sync_run_id, source, state, date_from, date_to, expected_count, observed_count,
               page_count, identity_set_hash, source_hashes_json, created_at)
            values (?, 'notice-publication', 'staging', ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            input.runId,
            input.dateFrom,
            input.dateTo,
            identityHashes.length,
            identityHashes.length,
            input.pageCount,
            identitySetHash,
            JSON.stringify(sourceHashes),
            new Date().toISOString(),
          );
        const generationId = Number(generationInsert.lastInsertRowid);
        const noticeInsert = db.prepare(`
          insert into building_control_notices
            (generation_id, notice_no, notice_order, notice_name, publication_date,
             demand_agency_code, demand_agency_name, notice_url, status,
             target_parent_product_code, target_detail_product_code,
             raw_json, source_hash)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const idsBySourceIdentity: Record<string, number> = {};
        for (const notice of rows) {
          const result = noticeInsert.run(
            generationId,
            notice.noticeNo,
            notice.noticeOrder,
            notice.noticeName,
            notice.publicationDate,
            notice.demandAgencyCode,
            notice.demandAgencyName,
            notice.noticeUrl,
            notice.status,
            notice.targetParentProductCode,
            notice.targetDetailProductCode,
            notice.rawJson,
            notice.sourceHash,
          );
          idsBySourceIdentity[`${notice.noticeNo}|${notice.noticeOrder}`] =
            Number(result.lastInsertRowid);
        }
        return { generationId, idsBySourceIdentity };
      })
      .immediate();

  const stageNoticeProductSnapshot = (
    input: StageNoticeProductSnapshotInput,
    owner: string,
    fence: number,
  ): StagedSourceIds =>
    db
      .transaction((): StagedSourceIds => {
        requireLease(owner, fence);
        const run = requireRun(input.runId, owner, fence);
        if (run.status !== "running") {
          throw new Error("snapshot writers require a running sync run");
        }
        if (input.dateFrom !== run.date_from || input.dateTo !== run.date_to) {
          throw new Error("snapshot date range must match parent run");
        }
        assertSealedRequestSetForSource(input.runId, "notice-product");
        if (input.products.length !== input.expectedCount) {
          throw new Error(
            "snapshot expectedCount does not match products length",
          );
        }
        const seenIdentity = new Set<string>();
        const seenHashes = new Set<string>();
        const noticeIdByKey = new Map<string, number>();
        const identityToHash = new Map<string, string>();
        const productRows = input.products.map((product) => {
          const identity = `${product.noticeNo}|${product.noticeOrder}|${product.bidClassNo}|${product.providerRowIdentity}`;
          if (seenIdentity.has(identity)) {
            throw new Error(`duplicate notice-product identity: ${identity}`);
          }
          seenIdentity.add(identity);
          if (seenHashes.has(product.sourceHash)) {
            throw new Error(
              `duplicate notice-product source hash: ${product.sourceHash}`,
            );
          }
          seenHashes.add(product.sourceHash);
          const identityHash = computeSourceIdentityHash("notice-product", [
            product.noticeNo,
            product.noticeOrder,
            product.bidClassNo,
            product.providerRowIdentity,
          ]);
          identityToHash.set(identityHash, product.sourceHash);
          noticeIdByKey.set(`${product.noticeNo}|${product.noticeOrder}`, 0);
          return product;
        });
        assertCheckpointSnapshotMatches(
          input.runId,
          "notice-product",
          productRows,
          identityToHash,
          input.pageCount,
        );
        const distinctNotices = [...noticeIdByKey.keys()];
        const placeholders = distinctNotices.map(() => "?").join(",");
        let found: Array<{
          id: number;
          notice_no: string;
          notice_order: string;
        }> = [];
        if (distinctNotices.length > 0) {
          found = db
            .prepare(
              `
            select id, notice_no, notice_order
            from building_control_notices
            where generation_id = (
              select id from building_control_source_generations
              where sync_run_id = ? and source = 'notice-publication'
            )
              and (notice_no || '|' || notice_order) in (${placeholders})
            `,
            )
            .all(input.runId, ...distinctNotices) as typeof found;
        }
        if (found.length !== distinctNotices.length) {
          throw new Error(
            "notice-product references missing notices in the same run",
          );
        }
        for (const row of found) {
          noticeIdByKey.set(`${row.notice_no}|${row.notice_order}`, row.id);
        }
        const identityHashes = [...identityToHash.keys()].sort();
        const identitySetHash = computeIdentitySetHash(identityHashes);
        const sourceHashes: Record<string, string> = {};
        for (const identityHash of identityHashes) {
          sourceHashes[identityHash] = identityToHash.get(identityHash)!;
        }
        const generationInsert = db
          .prepare(
            `
            insert into building_control_source_generations
              (sync_run_id, source, state, date_from, date_to, expected_count, observed_count,
               page_count, identity_set_hash, source_hashes_json, created_at)
            values (?, 'notice-product', 'staging', ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            input.runId,
            input.dateFrom,
            input.dateTo,
            identityHashes.length,
            identityHashes.length,
            input.pageCount,
            identitySetHash,
            JSON.stringify(sourceHashes),
            new Date().toISOString(),
          );
        const generationId = Number(generationInsert.lastInsertRowid);
        const insertProduct = db.prepare(`
          insert into building_control_notice_products
            (generation_id, notice_id, bid_clsfc_no, parent_product_code,
             detail_product_code, provider_row_identity, exact_match,
             raw_json, source_hash)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const idsBySourceIdentity: Record<string, number> = {};
        for (const product of productRows) {
          const noticeId = noticeIdByKey.get(
            `${product.noticeNo}|${product.noticeOrder}`,
          );
          if (noticeId === undefined || noticeId === 0) {
            throw new Error(
              `notice-product references missing notice: ${product.noticeNo}|${product.noticeOrder}`,
            );
          }
          const result = insertProduct.run(
            generationId,
            noticeId,
            product.bidClassNo,
            product.parentProductCode,
            product.detailProductCode,
            product.providerRowIdentity,
            product.exactMatch,
            product.rawJson,
            product.sourceHash,
          );
          idsBySourceIdentity[
            `${product.noticeNo}|${product.noticeOrder}|${product.bidClassNo}|${product.providerRowIdentity}`
          ] = Number(result.lastInsertRowid);
        }
        return { generationId, idsBySourceIdentity };
      })
      .immediate();

  const stageAwardSnapshot = (
    input: StageAwardSnapshotInput,
    owner: string,
    fence: number,
  ): StageAwardSnapshotResult =>
    db
      .transaction((): StageAwardSnapshotResult => {
        requireLease(owner, fence);
        const run = requireRun(input.runId, owner, fence);
        if (run.status !== "running") {
          throw new Error("snapshot writers require a running sync run");
        }
        if (input.dateFrom !== run.date_from || input.dateTo !== run.date_to) {
          throw new Error("snapshot date range must match parent run");
        }
        assertSealedRequestSetForSource(input.runId, "award-registration");
        const promotionBlockedReasons: string[] = [];
        const totalExpected = input.expectedCount + input.quarantines.length;
        if (input.awards.length !== input.expectedCount) {
          throw new Error(
            "snapshot expectedCount does not match awards length",
          );
        }
        const noticeIdByKey = new Map<string, number>();
        const seenIdentity = new Set<string>();
        const seenHashes = new Set<string>();
        const observationIdentityToHash = new Map<string, string>();
        const canonicalAwardIdsByNotice: Record<string, number> = {};
        const canonicalRevisionIdsByNotice: Record<string, number> = {};
        const idsBySourceIdentity: Record<string, number> = {};
        const addPromotionBlockedReason = (reason: string) => {
          if (!promotionBlockedReasons.includes(reason)) {
            promotionBlockedReasons.push(reason);
          }
        };
        const awardSeed = input.awards.map((award) => {
          const identity = `${award.noticeNo}|${award.noticeOrder}|${award.bidClassNo}|${award.rbidNo}`;
          if (seenIdentity.has(identity)) {
            throw new Error(`duplicate award identity: ${identity}`);
          }
          seenIdentity.add(identity);
          if (seenHashes.has(award.sourceHash)) {
            throw new Error(`duplicate award source hash: ${award.sourceHash}`);
          }
          seenHashes.add(award.sourceHash);
          noticeIdByKey.set(`${award.noticeNo}|${award.noticeOrder}`, 0);
          const identityHash = computeSourceIdentityHash("award-registration", [
            award.noticeNo,
            award.noticeOrder,
            award.bidClassNo,
            award.rbidNo,
          ]);
          if (observationIdentityToHash.has(identityHash)) {
            throw new Error(`duplicate award identity hash: ${identity}`);
          }
          observationIdentityToHash.set(identityHash, award.sourceHash);
          return award;
        });
        for (const quarantine of input.quarantines) {
          if (seenHashes.has(quarantine.sourceHash)) {
            throw new Error(
              `duplicate award source hash: ${quarantine.sourceHash}`,
            );
          }
          seenHashes.add(quarantine.sourceHash);
          const recoverableParts = [
            quarantine.noticeNo,
            quarantine.noticeOrder,
            quarantine.bidClassNo,
            quarantine.rbidNo,
          ];
          const hasRecoverableIdentity = recoverableParts.every(
            (part) => typeof part === "string" && part.trim().length > 0,
          );
          if (hasRecoverableIdentity) {
            noticeIdByKey.set(
              `${quarantine.noticeNo}|${quarantine.noticeOrder}`,
              0,
            );
          }
          const identityParts = hasRecoverableIdentity
            ? (recoverableParts as string[])
            : [
                `quarantine:${quarantine.pageNo}:${quarantine.pageIndex}:${quarantine.sourceHash}`,
                "",
                "",
                "",
              ];
          const identityHash = computeSourceIdentityHash(
            "award-registration",
            identityParts,
          );
          if (observationIdentityToHash.has(identityHash)) {
            throw new Error(
              `duplicate award quarantine identity: ${quarantine.providerResultIdentity}`,
            );
          }
          observationIdentityToHash.set(identityHash, quarantine.sourceHash);
        }
        assertCheckpointSnapshotMatches(
          input.runId,
          "award-registration",
          [...awardSeed, ...input.quarantines],
          observationIdentityToHash,
          input.pageCount,
        );
        const distinctNotices = [...noticeIdByKey.keys()];
        const placeholders = distinctNotices.map(() => "?").join(",");
        let found: Array<{
          id: number;
          notice_no: string;
          notice_order: string;
        }> = [];
        if (distinctNotices.length > 0) {
          found = db
            .prepare(
              `
            select id, notice_no, notice_order
            from building_control_notices
            where generation_id = (
              select id from building_control_source_generations
              where sync_run_id = ? and source = 'notice-publication'
            )
              and (notice_no || '|' || notice_order) in (${placeholders})
            `,
            )
            .all(input.runId, ...distinctNotices) as typeof found;
        }
        if (found.length !== distinctNotices.length) {
          throw new Error("award references missing notices in the same run");
        }
        for (const row of found) {
          noticeIdByKey.set(`${row.notice_no}|${row.notice_order}`, row.id);
        }
        const productGeneration = db
          .prepare(
            `
            select id from building_control_source_generations
            where sync_run_id = ? and source = 'notice-product'
            `,
          )
          .get(input.runId) as { id: number } | undefined;
        if (!productGeneration) {
          throw new Error(
            "award snapshot requires a notice-product generation in the same run",
          );
        }
        const productRows = db
          .prepare(
            `
            select notice_id, bid_clsfc_no, exact_match
            from building_control_notice_products
            where generation_id = ?
            `,
          )
          .all(productGeneration.id) as Array<{
          notice_id: number;
          bid_clsfc_no: string;
          exact_match: number;
        }>;
        const productByNotice = new Map<
          string,
          Array<{ bidClsfcNo: string; exactMatch: number }>
        >();
        for (const row of productRows) {
          const noticeKey = `${row.notice_id}|${row.bid_clsfc_no}`;
          const list = productByNotice.get(noticeKey) ?? [];
          list.push({
            bidClsfcNo: row.bid_clsfc_no,
            exactMatch: row.exact_match,
          });
          productByNotice.set(noticeKey, list);
        }
        for (const quarantine of input.quarantines) {
          const recoverableParts = [
            quarantine.noticeNo,
            quarantine.noticeOrder,
            quarantine.bidClassNo,
            quarantine.rbidNo,
          ];
          const hasRecoverableIdentity = recoverableParts.every(
            (part) => typeof part === "string" && part.trim().length > 0,
          );
          if (quarantine.reason === "product_correlation_blocked") {
            addPromotionBlockedReason(
              `award quarantine promotion blocked: ${quarantine.providerResultIdentity}`,
            );
          }
          if (!hasRecoverableIdentity) {
            addPromotionBlockedReason(
              `award quarantine identity is unrecoverable: ${quarantine.providerResultIdentity}`,
            );
            continue;
          }
          const registeredAt = quarantine.registeredAt;
          if (
            typeof registeredAt !== "string" ||
            !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
              registeredAt,
            ) ||
            registeredAt.slice(0, 10) < input.dateFrom ||
            registeredAt.slice(0, 10) > input.dateTo
          ) {
            addPromotionBlockedReason(
              `award quarantine registration timestamp is incomplete: ${quarantine.providerResultIdentity}`,
            );
          }
          const noticeKey = `${quarantine.noticeNo}|${quarantine.noticeOrder}`;
          const noticeId = noticeIdByKey.get(noticeKey);
          const products =
            noticeId === undefined || noticeId === 0
              ? undefined
              : productByNotice.get(
                  `${noticeId}|${quarantine.bidClassNo}`,
                );
          if (!products || products.length === 0) {
            addPromotionBlockedReason(
              `award quarantine product correlation is missing: ${noticeKey}|${quarantine.bidClassNo}`,
            );
          } else if (products.some((product) => product.exactMatch === 1)) {
            addPromotionBlockedReason(
              `exact target award is quarantined: ${noticeKey}|${quarantine.bidClassNo}|${quarantine.rbidNo}`,
            );
          }
        }
        const observationIdentityHashes = [
          ...observationIdentityToHash.keys(),
        ].sort();
        const identitySetHash = computeIdentitySetHash(
          observationIdentityHashes,
        );
        const sourceHashes: Record<string, string> = {};
        for (const identityHash of observationIdentityHashes) {
          sourceHashes[identityHash] =
            observationIdentityToHash.get(identityHash)!;
        }
        const generationInsert = db
          .prepare(
            `
            insert into building_control_source_generations
              (sync_run_id, source, state, date_from, date_to, expected_count, observed_count,
               page_count, identity_set_hash, source_hashes_json, created_at)
            values (?, 'award-registration', 'staging', ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            input.runId,
            input.dateFrom,
            input.dateTo,
            totalExpected,
            totalExpected,
            input.pageCount,
            identitySetHash,
            JSON.stringify(sourceHashes),
            new Date().toISOString(),
          );
        const generationId = Number(generationInsert.lastInsertRowid);
        const insertRevision = db.prepare(`
          insert into building_control_award_revisions
            (generation_id, notice_id, bid_clsfc_no, rbid_no,
             provider_result_identity, final_award_date, winner_biz_no,
             winner_name, source_status, winner_rows_json, raw_json, source_hash)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertCanonical = db.prepare(`
          insert into building_control_awards
            (generation_id, notice_id, selected_revision_id, final_award_date,
             winner_biz_no, winner_name, award_amount, award_rate,
             final_result_identity, raw_json)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertQuarantine = db.prepare(`
          insert into building_control_award_quarantine
            (generation_id, notice_no, notice_order, bid_clsfc_no, rbid_no,
             provider_result_identity, registered_at, final_award_date,
             raw_json, source_hash, reason, page_no, page_index, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const exactCandidatesByNotice = new Map<
          string,
          Array<{
            award: (typeof awardSeed)[number];
            revisionId: number;
            noticeId: number;
          }>
        >();
        for (const award of awardSeed) {
          const noticeId = noticeIdByKey.get(
            `${award.noticeNo}|${award.noticeOrder}`,
          );
          if (noticeId === undefined || noticeId === 0) {
            throw new Error(
              `award references missing notice: ${award.noticeNo}|${award.noticeOrder}`,
            );
          }
          const products = productByNotice.get(
            `${noticeId}|${award.bidClassNo}`,
          );
          if (!products || products.length === 0) {
            promotionBlockedReasons.push(
              `award product correlation is missing: ${award.noticeNo}|${award.noticeOrder}|${award.bidClassNo}`,
            );
          }
          const exact = products?.some((p) => p.exactMatch === 1) ?? false;
          const revisionId = Number(
            insertRevision.run(
              generationId,
              noticeId,
              award.bidClassNo,
              award.rbidNo,
              award.providerResultIdentity,
              award.finalAwardDate,
              award.winnerBizNo,
              award.winnerName,
              award.sourceStatus,
              award.winnerRowsJson,
              award.rawJson,
              award.sourceHash,
            ).lastInsertRowid,
          );
          idsBySourceIdentity[
            `${award.noticeNo}|${award.noticeOrder}|${award.bidClassNo}|${award.rbidNo}`
          ] = revisionId;
          if (exact) {
            const noticeKey = `${award.noticeNo}|${award.noticeOrder}`;
            const candidates = exactCandidatesByNotice.get(noticeKey) ?? [];
            candidates.push({ award, revisionId, noticeId });
            exactCandidatesByNotice.set(noticeKey, candidates);
          }
        }
        for (const [noticeKey, candidates] of exactCandidatesByNotice) {
          const sorted = [...candidates].sort((left, right) =>
            left.award.bidClassNo.localeCompare(right.award.bidClassNo) ||
            left.award.rbidNo.localeCompare(right.award.rbidNo) ||
            left.award.providerResultIdentity.localeCompare(
              right.award.providerResultIdentity,
            ),
          );
          const first = sorted[0]!;
          const conflict = sorted.some(
            ({ award }) =>
              award.winnerBizNo !== first.award.winnerBizNo ||
              award.finalAwardDate !== first.award.finalAwardDate ||
              award.canonicalAward.winnerBizNo !== award.winnerBizNo ||
              award.canonicalAward.finalAwardDate !== award.finalAwardDate,
          );
          if (conflict) {
            promotionBlockedReasons.push(
              `conflicting exact target lot awards: ${noticeKey}`,
            );
            continue;
          }
          const award = first.award;
          const canonicalId = Number(
            insertCanonical.run(
              generationId,
              first.noticeId,
              first.revisionId,
              award.canonicalAward.finalAwardDate,
              award.canonicalAward.winnerBizNo,
              award.canonicalAward.winnerName,
              award.canonicalAward.awardAmount,
              award.canonicalAward.awardRate,
              award.canonicalAward.finalResultIdentity,
              award.canonicalAward.rawJson,
            ).lastInsertRowid,
          );
          canonicalAwardIdsByNotice[noticeKey] = canonicalId;
          canonicalRevisionIdsByNotice[noticeKey] = first.revisionId;
        }
        for (const quarantine of input.quarantines) {
          insertQuarantine.run(
            generationId,
            quarantine.noticeNo,
            quarantine.noticeOrder,
            quarantine.bidClassNo,
            quarantine.rbidNo,
            quarantine.providerResultIdentity,
            quarantine.registeredAt,
            quarantine.finalAwardDate,
            quarantine.rawJson,
            quarantine.sourceHash,
            quarantine.reason,
            quarantine.pageNo,
            quarantine.pageIndex,
            quarantine.now,
          );
        }
        if (promotionBlockedReasons.length > 0) {
          db.prepare(
            `insert into building_control_generation_blocks
               (generation_id, reason, created_at)
             values (?, ?, ?)`,
          ).run(
            generationId,
            promotionBlockedReasons.join("\n"),
            new Date().toISOString(),
          );
        }
        return {
          generationId,
          idsBySourceIdentity,
          canonicalAwardIdsByNotice,
          canonicalRevisionIdsByNotice,
          promotionBlocked: promotionBlockedReasons.length > 0,
          promotionBlockReasons: promotionBlockedReasons,
        };
      })
      .immediate();

  const stageDesignationSnapshot = (
    input: StageDesignationSnapshotInput,
    owner: string,
    fence: number,
  ): StageDesignationSnapshotResult =>
    db
      .transaction((): StageDesignationSnapshotResult => {
        requireLease(owner, fence);
        const run = requireRun(input.runId, owner, fence);
        if (run.status !== "running") {
          throw new Error("snapshot writers require a running sync run");
        }
        if (input.dateFrom !== run.date_from || input.dateTo !== run.date_to) {
          throw new Error("snapshot date range must match parent run");
        }
        assertSealedRequestSetForSource(input.runId, "designation-history");
        if (input.designations.length !== input.expectedCount) {
          throw new Error(
            "snapshot expectedCount does not match designations length",
          );
        }
        const seenIdentity = new Set<string>();
        const seenHashes = new Set<string>();
        const identityToHash = new Map<string, string>();
        for (const designation of input.designations) {
          const identity = `${designation.certificateNo}|${designation.demandNo}|${designation.changeOrder}|${designation.sequenceNo}`;
          if (seenIdentity.has(identity)) {
            throw new Error(`duplicate designation identity: ${identity}`);
          }
          seenIdentity.add(identity);
          if (seenHashes.has(designation.observation.sourceHash)) {
            throw new Error(
              `duplicate designation source hash: ${designation.observation.sourceHash}`,
            );
          }
          seenHashes.add(designation.observation.sourceHash);
          const identityHash = computeSourceIdentityHash(
            "designation-history",
            [
              designation.certificateNo,
              designation.demandNo,
              designation.changeOrder,
              designation.sequenceNo,
            ],
          );
          identityToHash.set(identityHash, designation.observation.sourceHash);
        }
        assertCheckpointSnapshotMatches(
          input.runId,
          "designation-history",
          input.designations,
          identityToHash,
          input.pageCount,
        );
        const identityHashes = [...identityToHash.keys()].sort();
        const identitySetHash = computeIdentitySetHash(identityHashes);
        const sourceHashes: Record<string, string> = {};
        for (const identityHash of identityHashes) {
          sourceHashes[identityHash] = identityToHash.get(identityHash)!;
        }
        const generationInsert = db
          .prepare(
            `
            insert into building_control_source_generations
              (sync_run_id, source, state, date_from, date_to, expected_count, observed_count,
               page_count, identity_set_hash, source_hashes_json, created_at)
            values (?, 'designation-history', 'staging', ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            input.runId,
            input.dateFrom,
            input.dateTo,
            identityHashes.length,
            identityHashes.length,
            input.pageCount,
            identitySetHash,
            JSON.stringify(sourceHashes),
            new Date().toISOString(),
          );
        const generationId = Number(generationInsert.lastInsertRowid);
        const designationInsert = db.prepare(`
          insert into excellent_designations
            (etpm_dsgn_crfc_no, etpm_dsgn_dmnd_no, dsgn_dmnd_chg_ord,
             etps_sqno, designation_no, biz_no_normalized)
          values (?, ?, ?, ?, ?, ?)
        `);
        const findDesignation = db.prepare(`
          select id from excellent_designations
          where etpm_dsgn_crfc_no = ? and etpm_dsgn_dmnd_no = ?
            and dsgn_dmnd_chg_ord = ? and etps_sqno = ?
        `);
        const insertObservation = db.prepare(`
          insert into excellent_designation_observations
            (generation_id, designation_id, biz_no_normalized, company_name,
             start_date, original_end_date, extension_end_date, effective_end_date,
             status, product_name, classification_codes_json, termination_state,
             termination_evidence_hash, cancellation_date, revocation_date,
             list_identity, detail_identity, list_raw_json, detail_raw_json,
             source_hash)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const observationIdsBySourceIdentity: Record<string, number> = {};
        for (const designation of input.designations) {
          const identity = `${designation.certificateNo}|${designation.demandNo}|${designation.changeOrder}|${designation.sequenceNo}`;
          const existing = findDesignation.get(
            designation.certificateNo,
            designation.demandNo,
            designation.changeOrder,
            designation.sequenceNo,
          ) as { id: number } | undefined;
          let designationId: number;
          if (existing) {
            designationId = existing.id;
          } else {
            const inserted = designationInsert.run(
              designation.certificateNo,
              designation.demandNo,
              designation.changeOrder,
              designation.sequenceNo,
              designation.designationNo,
              designation.bizNoNormalized,
            );
            designationId = Number(inserted.lastInsertRowid);
          }
          const observationInserted = insertObservation.run(
            generationId,
            designationId,
            designation.observation.bizNoNormalized,
            designation.observation.companyName,
            designation.observation.startDate,
            designation.observation.originalEndDate,
            designation.observation.extensionEndDate,
            designation.observation.effectiveEndDate,
            designation.observation.status,
            designation.observation.productName,
            designation.observation.classificationCodesJson,
            designation.observation.terminationState,
            designation.observation.terminationEvidenceHash,
            designation.observation.cancellationDate,
            designation.observation.revocationDate,
            designation.observation.listIdentity,
            designation.observation.detailIdentity,
            designation.observation.listRawJson,
            designation.observation.detailRawJson,
            designation.observation.sourceHash,
          );
          observationIdsBySourceIdentity[identity] = Number(
            observationInserted.lastInsertRowid,
          );
        }
        return {
          generationId,
          idsBySourceIdentity: observationIdsBySourceIdentity,
          observationIdsBySourceIdentity,
        };
      })
      .immediate();

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
    registerCollectorPlan,
    registerExpectedRequests,
    sealExpectedRequestSet,
    readExpectedRequests,
    readCheckpoint,
    readCheckpointChunks,
    stageCheckpointPage,
    completeCheckpoint,
    adoptResumableRun,
    resetDriftedCheckpoint,
    clearCompletedCheckpoints,
    readResumeSeed,
    stageNoticeSnapshot,
    stageNoticeProductSnapshot,
    stageAwardSnapshot,
    stageDesignationSnapshot,
  };
}
