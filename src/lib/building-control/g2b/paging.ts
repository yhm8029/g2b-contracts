// src/lib/building-control/g2b/paging.ts
// Generic, deterministic, ASCII-only pagination collector with transient retry.
// TypeScript 5.7. No network/global state. Sleep is injected.

import type { CoverageSource } from "@/lib/building-control/repository";
import type {
  SyncProgressHooks,
  SyncResumeSeed,
  ValidatedSyncChunk,
} from "@/lib/building-control/sync-progress";

export type { ValidatedSyncChunk, SyncProgressHooks, SyncResumeSeed };

export interface CompletePage<T> {
  readonly pageNo: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly items: readonly T[];
  readonly rawJson: string;
}

export interface CollectOptions<T> {
  readonly pageSize: number;
  readonly maxPages: number;
  readonly fetchPage: (
    pageNo: number,
    pageSize: number,
  ) => Promise<CompletePage<T>>;
  readonly identity: (item: T) => string;
}

export interface CollectResult<T> {
  readonly pageCount: number;
  readonly totalCount: number;
  readonly items: readonly T[];
  readonly rawPages: readonly string[];
}

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs?: number;
  readonly sleep: (ms: number) => Promise<void>;
}

function isPositiveInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!isNonNegativeInteger(policy.maxRetries)) {
    throw new Error(
      "retryTransient: maxRetries must be a non-negative integer",
    );
  }
  if (!isNonNegativeInteger(policy.baseDelayMs)) {
    throw new Error(
      "retryTransient: baseDelayMs must be a non-negative integer",
    );
  }
  if (policy.maxDelayMs !== undefined) {
    if (
      !isNonNegativeInteger(policy.maxDelayMs) ||
      !isFiniteNumber(policy.maxDelayMs)
    ) {
      throw new Error(
        "retryTransient: maxDelayMs must be a finite non-negative integer",
      );
    }
  }
  if (typeof policy.sleep !== "function") {
    throw new Error("retryTransient: sleep must be a function");
  }
}

function isRetryableError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as { status?: unknown; code?: unknown; name?: unknown };
  if (typeof e.status === "number") {
    if (e.status === 429) return true;
    if (e.status >= 500 && e.status <= 599) return true;
    return false;
  }
  if (typeof e.code === "string") {
    if (e.code === "ETIMEDOUT") return true;
    if (e.code === "ECONNRESET") return true;
    if (e.code === "ABORT_ERR") return true;
    return false;
  }
  if (typeof e.name === "string" && e.name === "AbortError") {
    return true;
  }
  return false;
}

export async function retryTransient<T>(
  op: () => Promise<T>,
  policy: RetryPolicy,
): Promise<T> {
  validateRetryPolicy(policy);
  const { maxRetries, baseDelayMs, sleep } = policy;
  const maxDelayMs =
    policy.maxDelayMs !== undefined && Number.isFinite(policy.maxDelayMs)
      ? policy.maxDelayMs
      : undefined;
  let attempt = 0;
  // total attempts = maxRetries + 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await op();
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      if (!isRetryableError(err)) {
        throw err;
      }
      const rawDelay = baseDelayMs * 2 ** attempt;
      const delay =
        maxDelayMs !== undefined && rawDelay > maxDelayMs
          ? maxDelayMs
          : rawDelay;
      await sleep(delay);
      attempt += 1;
    }
  }
}

function validateCollectOptions<T>(opts: CollectOptions<T>): void {
  if (!isPositiveInteger(opts.pageSize)) {
    throw new Error(
      "collectCompletePages: pageSize must be a positive integer",
    );
  }
  if (!isPositiveInteger(opts.maxPages)) {
    throw new Error(
      "collectCompletePages: maxPages must be a positive integer",
    );
  }
  if (typeof opts.fetchPage !== "function") {
    throw new Error("collectCompletePages: fetchPage must be a function");
  }
  if (typeof opts.identity !== "function") {
    throw new Error("collectCompletePages: identity must be a function");
  }
}

function expectedPageCount(totalCount: number, pageSize: number): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

export async function collectCompletePages<T>(
  options: CollectOptions<T>,
): Promise<CollectResult<T>> {
  validateCollectOptions(options);
  const { pageSize, maxPages, fetchPage, identity } = options;

  const seenIds = new Set<string>();
  const items: T[] = [];
  const rawPages: string[] = [];

  let totalCount = -1;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const page: CompletePage<T> = await fetchPage(pageNo, pageSize);

    if (!page || typeof page !== "object") {
      throw new Error("collectCompletePages: fetchPage returned non-object");
    }
    if (page.pageNo !== pageNo) {
      throw new Error(
        "collectCompletePages: page.pageNo does not match requested pageNo",
      );
    }
    if (page.pageSize !== pageSize) {
      throw new Error(
        "collectCompletePages: page.pageSize does not match requested pageSize",
      );
    }
    if (
      typeof page.totalCount !== "number" ||
      !Number.isInteger(page.totalCount) ||
      page.totalCount < 0
    ) {
      throw new Error(
        "collectCompletePages: page.totalCount must be a non-negative integer",
      );
    }
    if (!Array.isArray(page.items)) {
      throw new Error("collectCompletePages: page.items must be an array");
    }
    if (typeof page.rawJson !== "string" || page.rawJson.length === 0) {
      throw new Error(
        "collectCompletePages: page.rawJson must be a non-empty string",
      );
    }

    if (totalCount === -1) {
      totalCount = page.totalCount;
      const pagesNeeded = expectedPageCount(totalCount, pageSize);
      if (pagesNeeded > maxPages) {
        throw new Error(
          "collectCompletePages: required page count exceeds maxPages",
        );
      }
    } else if (page.totalCount !== totalCount) {
      throw new Error(
        "collectCompletePages: totalCount must be stable across pages",
      );
    }

    const expectedPages = expectedPageCount(totalCount, pageSize);
    const isLastPage = pageNo === expectedPages;
    const expectedItemsOnThisPage = isLastPage
      ? totalCount - (expectedPages - 1) * pageSize
      : pageSize;

    if (page.items.length !== expectedItemsOnThisPage) {
      throw new Error(
        "collectCompletePages: page items count does not match expected cardinality",
      );
    }

    for (const item of page.items) {
      const id = identity(item);
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(
          "collectCompletePages: identity must be a non-empty string",
        );
      }
      if (seenIds.has(id)) {
        throw new Error(
          "collectCompletePages: duplicate identity across pages",
        );
      }
      seenIds.add(id);
      items.push(item);
    }

    rawPages.push(page.rawJson);

    if (pageNo >= expectedPages) {
      break;
    }
  }

  if (totalCount === -1) {
    // Should be unreachable: we always fetch at least page 1.
    throw new Error("collectCompletePages: no pages were fetched");
  }

  const pagesCollected = rawPages.length;
  const expectedPages = expectedPageCount(totalCount, pageSize);
  if (pagesCollected !== expectedPages) {
    throw new Error("collectCompletePages: incomplete page set");
  }
  if (items.length !== totalCount) {
    throw new Error(
      "collectCompletePages: items length does not equal totalCount",
    );
  }

  return {
    pageCount: pagesCollected,
    totalCount,
    items: Object.freeze(items.slice()) as readonly T[],
    rawPages: Object.freeze(rawPages.slice()) as readonly string[],
  };
}

export interface ResumableCollectOptions<T> {
  readonly source: CoverageSource;
  readonly requestKey: string;
  readonly pageSize: number;
  readonly maxPages: number;
  readonly identity: (item: T) => string;
  readonly fetchPage: (
    pageNo: number,
    pageSize: number,
  ) => Promise<CompletePage<T>>;
  readonly progress?: SyncProgressHooks<T>;
  readonly hashItem: (item: T, rawJson: string) => string;
  readonly hashPageJson: (rawJson: string) => string;
  readonly normalizeItem: (item: T) => T;
  readonly revalidateChunk?: (
    chunk: ValidatedSyncChunk<T>,
  ) => Promise<boolean> | boolean;
}

export interface ResumableCollectResult<T> {
  readonly pageCount: number;
  readonly totalCount: number;
  readonly items: readonly T[];
  readonly rawPages: readonly string[];
  readonly resumed: boolean;
}

export async function collectCompletePagesResumable<T>(
  options: ResumableCollectOptions<T>,
): Promise<ResumableCollectResult<T>> {
  if (options === null || typeof options !== "object") {
    throw new Error("collectCompletePagesResumable: options is required");
  }
  if (!Number.isInteger(options.pageSize) || options.pageSize <= 0) {
    throw new Error(
      "collectCompletePagesResumable: pageSize must be a positive integer",
    );
  }
  if (!Number.isInteger(options.maxPages) || options.maxPages <= 0) {
    throw new Error(
      "collectCompletePagesResumable: maxPages must be a positive integer",
    );
  }

  let seed: SyncResumeSeed | null = null;
  if (options.progress) {
    seed = await options.progress.readResumeSeed(options.requestKey);
  }

  const persistedChunks: ValidatedSyncChunk<unknown>[] = [];
  const seenIdentityHashes = new Set<string>();
  const items: T[] = [];
  const rawPages: string[] = [];

  if (seed) {
    if (seed.pageSize !== options.pageSize || seed.cursorKind !== "page") {
      seed = null;
      persistedChunks.length = 0;
    } else {
      for (const chunk of seed.persistedChunks) {
        if (chunk.cursorKind !== "page") continue;
        if (chunk.pageSize !== options.pageSize) continue;
        const identityEntries: string[] = [];
        for (const hash of chunk.identityHashes) {
          if (seenIdentityHashes.has(hash)) {
            throw new Error(
              "collectCompletePagesResumable: duplicate persisted identity",
            );
          }
          seenIdentityHashes.add(hash);
          identityEntries.push(hash);
        }
        const facts = chunk.facts as readonly T[];
        for (const fact of facts) {
          items.push(options.normalizeItem(fact));
        }
        rawPages.push("");
        persistedChunks.push(chunk);
      }
    }
  }

  let nextCursor = seed?.nextCursor ?? 1;
  let totalCount = seed?.totalCount ?? -1;
  let resumed = seed !== null;
  let lastPage: CompletePage<T> | null = null;

  while (true) {
    if (totalCount !== -1) {
      const expectedPages = Math.ceil(totalCount / options.pageSize);
      if (nextCursor > expectedPages) break;
    }
    if (nextCursor > options.maxPages) {
      throw new Error(
        "collectCompletePagesResumable: required page count exceeds maxPages",
      );
    }
    const page = await options.fetchPage(nextCursor, options.pageSize);
    if (!page || typeof page !== "object") {
      throw new Error(
        "collectCompletePagesResumable: fetchPage returned non-object",
      );
    }
    if (page.pageNo !== nextCursor) {
      throw new Error(
        "collectCompletePagesResumable: page.pageNo does not match requested cursor",
      );
    }
    if (page.pageSize !== options.pageSize) {
      throw new Error(
        "collectCompletePagesResumable: page.pageSize does not match requested pageSize",
      );
    }
    if (
      typeof page.totalCount !== "number" ||
      !Number.isInteger(page.totalCount) ||
      page.totalCount < 0
    ) {
      throw new Error(
        "collectCompletePagesResumable: page.totalCount must be a non-negative integer",
      );
    }
    if (!Array.isArray(page.items)) {
      throw new Error(
        "collectCompletePagesResumable: page.items must be an array",
      );
    }
    if (typeof page.rawJson !== "string" || page.rawJson.length === 0) {
      throw new Error(
        "collectCompletePagesResumable: page.rawJson must be a non-empty string",
      );
    }
    if (totalCount === -1) {
      totalCount = page.totalCount;
      const pagesNeeded = Math.max(1, Math.ceil(totalCount / options.pageSize));
      if (pagesNeeded > options.maxPages) {
        throw new Error(
          "collectCompletePagesResumable: required page count exceeds maxPages",
        );
      }
    } else if (page.totalCount !== totalCount) {
      throw new Error(
        "collectCompletePagesResumable: totalCount must be stable across pages",
      );
    }
    const expectedPages = Math.max(1, Math.ceil(totalCount / options.pageSize));
    const isLastPage = nextCursor === expectedPages;
    const expectedItems = isLastPage
      ? totalCount - (expectedPages - 1) * options.pageSize
      : options.pageSize;
    if (page.items.length !== expectedItems) {
      throw new Error(
        "collectCompletePagesResumable: page items count does not match expected cardinality",
      );
    }
    const identityHashes: string[] = [];
    const sourceHashes: Record<string, string> = {};
    const newFacts: T[] = [];
    for (const item of page.items) {
      const id = options.identity(item);
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(
          "collectCompletePagesResumable: identity must be a non-empty string",
        );
      }
      if (seenIdentityHashes.has(id)) {
        throw new Error(
          "collectCompletePagesResumable: duplicate identity across pages",
        );
      }
      seenIdentityHashes.add(id);
      const itemHash = options.hashItem(item, "");
      identityHashes.push(id);
      sourceHashes[id] = itemHash;
      newFacts.push(options.normalizeItem(item));
    }
    if (options.progress) {
      const chunk: ValidatedSyncChunk<T> = {
        source: options.source,
        requestKey: options.requestKey,
        cursorKind: "page",
        cursor: nextCursor,
        pageSize: options.pageSize,
        totalCount,
        facts: Object.freeze(newFacts) as readonly T[],
        identityHashes: Object.freeze(identityHashes) as readonly string[],
        sourceHashes,
      };
      const ok =
        options.revalidateChunk === undefined
          ? true
          : await options.revalidateChunk(chunk);
      if (!ok) {
        seenIdentityHashes.clear();
        items.length = 0;
        rawPages.length = 0;
        persistedChunks.length = 0;
        nextCursor = 1;
        totalCount = -1;
        resumed = false;
        if (options.progress) {
          // Persist a fresh seed so callers can drop persisted prefix
          await options.progress.onValidatedChunk({
            source: options.source,
            requestKey: options.requestKey,
            cursorKind: "page",
            cursor: 1,
            pageSize: options.pageSize,
            totalCount: -1,
            facts: Object.freeze([]) as readonly T[],
            identityHashes: Object.freeze([]) as readonly string[],
            sourceHashes: {},
          });
        }
        continue;
      }
      await options.progress.onValidatedChunk(chunk);
      persistedChunks.push(chunk as ValidatedSyncChunk<unknown>);
    }
    for (const fact of newFacts) items.push(fact);
    rawPages.push(page.rawJson);
    lastPage = page;
    nextCursor += 1;
    if (totalCount === 0) break;
    if (nextCursor > expectedPages) break;
  }

  if (totalCount === -1) {
    throw new Error("collectCompletePagesResumable: no pages were fetched");
  }

  if (lastPage === null && totalCount > 0) {
    throw new Error("collectCompletePagesResumable: no items collected");
  }

  if (items.length !== totalCount) {
    throw new Error(
      "collectCompletePagesResumable: items length does not equal totalCount",
    );
  }

  return {
    pageCount: rawPages.length,
    totalCount,
    items: Object.freeze(items.slice()) as readonly T[],
    rawPages: Object.freeze(rawPages.slice()) as readonly string[],
    resumed,
  };
}
