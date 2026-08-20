// src/lib/building-control/g2b/designation-history-client.ts
// G2B designation history client. No network, no global state.
// TypeScript 5.7. Pure functions. Deterministic ordering. ASCII only.

import type { DesignationSession } from "@/lib/building-control/g2b/designation-session";
import {
  parseDesignationListResponse,
  collectAllDesignationFacts,
  reconcileDesignationStatusUnion,
  assertNoDesignationContraction,
  type DesignationListRequest,
  type DesignationListFact,
  type CollectAllDesignationFactsResult,
  type ReconcileDesignationStatusUnionResult,
} from "@/lib/building-control/g2b/designation-list-client";
import {
  buildDesignationObservation,
  parseDesignationDetailResponse,
  type DesignationObservationInput,
  type DesignationDetailRequest,
  type DesignationDetailResult,
  type TerminationEvidence,
} from "@/lib/building-control/g2b/designation-detail-client";

// ----------------------------- Types -----------------------------------------

export type DesignationHistoryStatus =
  "" | "\uC720\uD6A8" | "\uB9CC\uB8CC" | "\uD6A8\uB825\uC815\uC9C0";

export interface CollectCompleteDesignationHistoryInput {
  readonly session: DesignationSession;
  readonly pageSize: number;
  readonly maxPages: number;
  readonly previousComplete?: readonly DesignationListFact[];
}

export interface CollectCompleteDesignationHistoryResult {
  readonly schemaVersion: 1;
  readonly bootstrapReferer: string;
  readonly all: CollectAllDesignationFactsResult;
  readonly reconciliation: ReconcileDesignationStatusUnionResult;
  readonly explicitStatusTotals: {
    readonly "\uC720\uD6A8": number;
    readonly "\uB9CC\uB8CC": number;
    readonly "\uD6A8\uB825\uC815\uC9C0": number;
  };
}

export interface FetchDesignationDetailForFactInput {
  readonly session: DesignationSession;
  readonly fact: DesignationListFact;
}

// ----------------------- Internal collector ---------------------------------

interface CollectStatusResult extends CollectAllDesignationFactsResult {
  readonly status: DesignationHistoryStatus;
}

function assertExactStatusIdentitySets(
  authoritative: readonly DesignationListFact[],
  explicitByStatus: Readonly<
    Record<
      Exclude<DesignationHistoryStatus, "">,
      readonly DesignationListFact[]
    >
  >,
): void {
  const statuses: Array<Exclude<DesignationHistoryStatus, "">> = [
    "\uC720\uD6A8",
    "\uB9CC\uB8CC",
    "\uD6A8\uB825\uC815\uC9C0",
  ];

  for (const status of statuses) {
    const bucket = authoritative.filter((item) => item.status === status);
    const explicit = explicitByStatus[status];
    const authoritativeIds = new Set<string>();
    for (const item of bucket) {
      if (authoritativeIds.has(item.sourceIdentity)) {
        throw new Error(
          `designation-history-client: identity mismatch (duplicate in authoritative): ${status}`,
        );
      }
      authoritativeIds.add(item.sourceIdentity);
    }
    const explicitIds = new Set<string>();
    for (const item of explicit) {
      if (explicitIds.has(item.sourceIdentity)) {
        throw new Error(
          `designation-history-client: identity mismatch (duplicate in explicit): ${status}`,
        );
      }
      explicitIds.add(item.sourceIdentity);
    }
    const sortedAuthoritative = [...authoritativeIds].sort();
    const sortedExplicit = [...explicitIds].sort();
    if (
      sortedAuthoritative.length !== sortedExplicit.length ||
      sortedAuthoritative.some((id, index) => id !== sortedExplicit[index])
    ) {
      throw new Error(
        `designation-history-client: identity mismatch (set differs): ${status}`,
      );
    }
  }
}

async function collectStatus(
  session: DesignationSession,
  status: DesignationHistoryStatus,
  pageSize: number,
  maxPages: number,
): Promise<CollectStatusResult> {
  const result = await collectAllDesignationFacts({
    pageSize,
    maxPages,
    fetchPage: async (pageNo: number, ps: number) => {
      const request: DesignationListRequest = {
        applVldYn: status,
        currentPage: pageNo,
        recordCountPerPage: ps,
      };
      const res = await session.postList(request);
      const parsed = parseDesignationListResponse({
        payload: res.payload,
        rawJson: res.rawJson,
        request,
      });
      return {
        pageNo: parsed.pageNo,
        pageSize: parsed.pageSize,
        totalCount: parsed.totalCount,
        items: parsed.items,
        rawJson: parsed.rawJson,
      };
    },
  });
  return { ...result, status };
}

// ----------------------- Main collection entry ------------------------------

export async function collectCompleteDesignationHistory(
  input: CollectCompleteDesignationHistoryInput,
): Promise<CollectCompleteDesignationHistoryResult> {
  if (input === null || typeof input !== "object") {
    throw new Error("designation-history-client: input must be an object");
  }
  if (!Number.isInteger(input.pageSize) || input.pageSize <= 0) {
    throw new Error(
      "designation-history-client: pageSize must be a positive integer",
    );
  }
  if (!Number.isInteger(input.maxPages) || input.maxPages <= 0) {
    throw new Error(
      "designation-history-client: maxPages must be a positive integer",
    );
  }

  // Bootstrap exactly once.
  const bootstrapResult = await input.session.bootstrap();

  // Status "" first; this is the only authoritative "all" result.
  const allCollect = await collectStatus(
    input.session,
    "",
    input.pageSize,
    input.maxPages,
  );

  // Then sequentially collect each explicit status with complete paging.
  const validCollect = await collectStatus(
    input.session,
    "\uC720\uD6A8",
    input.pageSize,
    input.maxPages,
  );
  const expiredCollect = await collectStatus(
    input.session,
    "\uB9CC\uB8CC",
    input.pageSize,
    input.maxPages,
  );
  const suspendedCollect = await collectStatus(
    input.session,
    "\uD6A8\uB825\uC815\uC9C0",
    input.pageSize,
    input.maxPages,
  );

  // Explicit totals are each result.totalCount.
  const explicitStatusTotals = Object.freeze({
    "\uC720\uD6A8": validCollect.totalCount,
    "\uB9CC\uB8CC": expiredCollect.totalCount,
    "\uD6A8\uB825\uC815\uC9C0": suspendedCollect.totalCount,
  });

  assertExactStatusIdentitySets(allCollect.items, {
    "\uC720\uD6A8": validCollect.items,
    "\uB9CC\uB8CC": expiredCollect.items,
    "\uD6A8\uB825\uC815\uC9C0": suspendedCollect.items,
  });

  // Reconcile using the authoritative all.totalCount, all.items, and explicit
  // snapshot.
  const reconciliation = reconcileDesignationStatusUnion({
    allCount: allCollect.totalCount,
    snapshot: {
      "\uC720\uD6A8": explicitStatusTotals["\uC720\uD6A8"],
      "\uB9CC\uB8CC": explicitStatusTotals["\uB9CC\uB8CC"],
      "\uD6A8\uB825\uC815\uC9C0":
        explicitStatusTotals["\uD6A8\uB825\uC815\uC9C0"],
    },
    items: allCollect.items,
  });

  if (input.previousComplete !== undefined) {
    assertNoDesignationContraction({
      previous: input.previousComplete,
      current: allCollect.items,
    });
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    bootstrapReferer: bootstrapResult.referer,
    all: allCollect,
    reconciliation,
    explicitStatusTotals,
  });
}

// ----------------------- Detail entry ---------------------------------------

export async function fetchDesignationDetailForFact(
  input: FetchDesignationDetailForFactInput,
): Promise<DesignationDetailResult> {
  if (input === null || typeof input !== "object") {
    throw new Error("designation-history-client: input must be an object");
  }
  if (input.fact === null || typeof input.fact !== "object") {
    throw new Error("designation-history-client: fact must be an object");
  }

  const request: DesignationDetailRequest = {
    etpmDsgnCrfcNo: input.fact.etpmDsgnCrfcNo,
    etpmDsgnDmndNo: input.fact.etpmDsgnDmndNo,
    dsgnDmndChgOrd: input.fact.dsgnDmndChgOrd,
    etpsSqno: input.fact.etpsSqno,
  };

  const res = await input.session.postDetail(request);
  return parseDesignationDetailResponse({
    payload: res.payload,
    rawJson: res.rawJson,
    request,
  });
}
export type CollectObservationsForCompleteHistoryInput =
  CollectCompleteDesignationHistoryInput;

export interface CollectObservationsForCompleteHistoryOutput {
  readonly schemaVersion: 1;
  readonly history: CollectCompleteDesignationHistoryResult;
  readonly observations: readonly DesignationObservationInput[];
  readonly complete: boolean;
  readonly incompleteReasons: readonly string[];
}

const SCHEMA_VERSION = 1 as const;
const DESIGNATION_SESSION_CONCURRENCY = 1;

const DEFAULT_TERMINATION: TerminationEvidence = { state: "unverified" };

async function mapBoundedOrdered<T, U>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<U>,
  errorMessage: string,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (true) {
      if (firstError !== undefined) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index]!, index);
      } catch (error) {
        if (firstError === undefined) firstError = error;
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  if (firstError !== undefined) {
    throw new AggregateError([firstError], errorMessage);
  }
  return results;
}

export async function collectObservationsForCompleteHistory(
  input: CollectObservationsForCompleteHistoryInput,
): Promise<CollectObservationsForCompleteHistoryOutput> {
  const history: CollectCompleteDesignationHistoryResult =
    await collectCompleteDesignationHistory(input);

  const items: readonly DesignationListFact[] = history.all.items;

  const fulfilledDetails = await mapBoundedOrdered(
    items,
    DESIGNATION_SESSION_CONCURRENCY,
    async (fact) =>
      fetchDesignationDetailForFact({
        session: input.session as DesignationSession,
        fact,
      }),
    "Some designation detail fetches failed",
  );

  const observations: DesignationObservationInput[] = [];
  const incompleteReasonsSet = new Set<string>();
  let complete = true;

  for (let i = 0; i < items.length; i++) {
    const fact = items[i]!;
    const detail = fulfilledDetails[i]!;
    const termination = DEFAULT_TERMINATION;

    const detailFact = {
      classifications: detail.classifications,
      detailRawJson: detail.rawJson,
    } as const;

    const observation = buildDesignationObservation({
      listFact: fact,
      detailFact,
      termination,
    });

    observations.push(observation);

    const completenessReason = (
      observation as { completenessReason?: string | null | undefined }
    ).completenessReason;

    if (completenessReason) {
      complete = false;
      incompleteReasonsSet.add(
        `identity#${i}:observation:incomplete:${completenessReason}`,
      );
    }
  }

  const incompleteReasons: readonly string[] =
    Array.from(incompleteReasonsSet).sort();

  const output: CollectObservationsForCompleteHistoryOutput = {
    schemaVersion: SCHEMA_VERSION,
    history,
    observations,
    complete,
    incompleteReasons,
  };

  return Object.freeze(output);
}
