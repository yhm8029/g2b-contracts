// src/lib/building-control/g2b/paging.ts
// Generic, deterministic, ASCII-only pagination collector with transient retry.
// TypeScript 5.7. No network/global state. Sleep is injected.

import type { CoverageSource } from "@/lib/building-control/repository";
import {
  isResumeSeed,
  type SyncProgressHooks,
  type SyncResumeSeed,
  type ValidatedSyncChunk,
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

const SHA256_HEX = /^[0-9a-f]{64}$/;

function sameOrderedStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isCompatibleResumeSeed<T>(
  value: unknown,
  options: ResumableCollectOptions<T>,
): boolean {
  if (!isResumeSeed(value)) return false;
  if (
    value.cursorKind !== "page" ||
    value.pageSize !== options.pageSize ||
    value.totalCount === null ||
    !Number.isInteger(value.totalCount)
  ) {
    return false;
  }
  const expectedPages = Math.max(
    1,
    Math.ceil(value.totalCount / options.pageSize),
  );
  const chunks = [...value.persistedChunks].sort(
    (left, right) => left.cursor - right.cursor,
  );
  if (
    chunks.length === 0 ||
    chunks.length > expectedPages ||
    value.nextCursor !== chunks.length + 1
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const expectedCursor = index + 1;
    const expectedFacts =
      expectedCursor === expectedPages
        ? value.totalCount - (expectedPages - 1) * options.pageSize
        : options.pageSize;
    if (
      chunk.source !== options.source ||
      chunk.requestKey !== options.requestKey ||
      chunk.cursorKind !== "page" ||
      chunk.cursor !== expectedCursor ||
      chunk.pageSize !== options.pageSize ||
      chunk.totalCount !== value.totalCount ||
      !Array.isArray(chunk.facts) ||
      !Array.isArray(chunk.identityHashes) ||
      chunk.facts.length !== expectedFacts ||
      chunk.identityHashes.length !== expectedFacts ||
      chunk.sourceHashes === null ||
      typeof chunk.sourceHashes !== "object" ||
      Array.isArray(chunk.sourceHashes)
    ) {
      return false;
    }
    const sourceHashKeys = Object.keys(chunk.sourceHashes);
    if (
      sourceHashKeys.length !== chunk.identityHashes.length ||
      !sourceHashKeys.every((key) => chunk.identityHashes.includes(key))
    ) {
      return false;
    }
    for (const identityHash of chunk.identityHashes) {
      const sourceHash = chunk.sourceHashes[identityHash];
      if (
        !SHA256_HEX.test(identityHash) ||
        typeof sourceHash !== "string" ||
        !SHA256_HEX.test(sourceHash) ||
        seen.has(identityHash)
      ) {
        return false;
      }
      seen.add(identityHash);
    }
  }
  return sameOrderedStrings(
    [...seen].sort(),
    [...value.seenIdentityHashes].sort(),
  );
}

export class ResumeRunRestartRequiredError extends Error {
  constructor(readonly requestKey: string) {
    super(`resumable request requires a new sync run: ${requestKey}`);
    this.name = "ResumeRunRestartRequiredError";
  }
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

  const restartFromPageOne = async (): Promise<
    ResumableCollectResult<T>
  > => {
    if (!options.progress?.resetAfterDrift) {
      throw new Error(
        "collectCompletePagesResumable: resume drift requires a reset hook",
      );
    }
    const reset = await options.progress.resetAfterDrift(options.requestKey);
    if (reset === "restart-run") {
      throw new ResumeRunRestartRequiredError(options.requestKey);
    }
    return collectCompletePagesResumable({
      ...options,
      progress: {
        ...options.progress,
        readResumeSeed: async () => null,
      },
    });
  };

  let seed: SyncResumeSeed | null = null;
  if (options.progress) {
    const rawSeed: unknown = await options.progress.readResumeSeed(
      options.requestKey,
    );
    if (rawSeed !== null) {
      if (isCompatibleResumeSeed(rawSeed, options)) {
        seed = rawSeed as SyncResumeSeed;
      } else {
        const emptyResetSeed =
          isResumeSeed(rawSeed) &&
          rawSeed.cursorKind === "page" &&
          rawSeed.pageSize === options.pageSize &&
          rawSeed.totalCount === null &&
          rawSeed.nextCursor === 1 &&
          rawSeed.seenIdentityHashes.length === 0 &&
          rawSeed.persistedChunks.length === 0;
        if (!emptyResetSeed) {
          return restartFromPageOne();
        }
      }
    }
  }

  const persistedChunks: ValidatedSyncChunk<unknown>[] = [];
  const seenIdentityHashes = new Set<string>();
  const items: T[] = [];
  const rawPages: string[] = [];

  if (seed) {
    const orderedChunks = [...seed.persistedChunks].sort(
      (left, right) => left.cursor - right.cursor,
    );
    for (const chunk of orderedChunks) {
      for (const hash of chunk.identityHashes) {
        if (seenIdentityHashes.has(hash)) {
          throw new Error(
            "collectCompletePagesResumable: duplicate persisted identity",
          );
        }
        seenIdentityHashes.add(hash);
      }
      const facts = chunk.facts as readonly T[];
      for (const fact of facts) {
        items.push(options.normalizeItem(fact));
      }
      rawPages.push("");
      persistedChunks.push(chunk);
    }
  }
  const persistedPrefixChunks = persistedChunks.slice();

  let nextCursor = seed?.nextCursor ?? 1;
  let totalCount = seed?.totalCount ?? -1;
  let resumed = seed !== null;
  let lastPage: CompletePage<T> | null = null;

  while (true) {
    if (totalCount !== -1) {
      const expectedPages = Math.max(
        1,
        Math.ceil(totalCount / options.pageSize),
      );
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
      if (resumed) return restartFromPageOne();
      throw new Error(
        "collectCompletePagesResumable: page.pageNo does not match requested cursor",
      );
    }
    if (page.pageSize !== options.pageSize) {
      if (resumed) return restartFromPageOne();
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
      if (resumed) return restartFromPageOne();
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
      if (resumed) return restartFromPageOne();
      throw new Error(
        "collectCompletePagesResumable: page items count does not match expected cardinality",
      );
    }
    const identityHashes: string[] = [];
    const sourceHashes: Record<string, string> = {};
    const newFacts: T[] = [];
    for (const item of page.items) {
      const id = options.identity(item);
      if (typeof id !== "string" || !SHA256_HEX.test(id)) {
        throw new Error(
          "collectCompletePagesResumable: identity must be a lowercase SHA-256 hash",
        );
      }
      if (seenIdentityHashes.has(id)) {
        if (resumed) return restartFromPageOne();
        throw new Error(
          "collectCompletePagesResumable: duplicate identity across pages",
        );
      }
      seenIdentityHashes.add(id);
      const itemHash = options.hashItem(item, page.rawJson);
      if (typeof itemHash !== "string" || !SHA256_HEX.test(itemHash)) {
        throw new Error(
          "collectCompletePagesResumable: source hash must be a lowercase SHA-256 hash",
        );
      }
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

  let prefixDrift = false;
  for (const persisted of persistedPrefixChunks) {
    const page = await options.fetchPage(persisted.cursor, options.pageSize);
    const expectedPages =
      totalCount < 0
        ? -1
        : Math.max(1, Math.ceil(totalCount / options.pageSize));
    const expectedItems =
      expectedPages < 0
        ? -1
        : persisted.cursor === expectedPages
          ? totalCount - (expectedPages - 1) * options.pageSize
          : options.pageSize;
    if (
      !page ||
      typeof page !== "object" ||
      page.pageNo !== persisted.cursor ||
      page.pageSize !== options.pageSize ||
      page.totalCount !== totalCount ||
      !Array.isArray(page.items) ||
      page.items.length !== expectedItems ||
      typeof page.rawJson !== "string" ||
      page.rawJson.length === 0
    ) {
      prefixDrift = true;
      break;
    }

    const identityHashes: string[] = [];
    const sourceHashes: Record<string, string> = {};
    const normalizedFacts: T[] = [];
    for (const item of page.items) {
      const identityHash = options.identity(item);
      const sourceHash = options.hashItem(item, page.rawJson);
      if (
        typeof identityHash !== "string" ||
        !SHA256_HEX.test(identityHash) ||
        typeof sourceHash !== "string" ||
        !SHA256_HEX.test(sourceHash) ||
        sourceHashes[identityHash] !== undefined
      ) {
        prefixDrift = true;
        break;
      }
      identityHashes.push(identityHash);
      sourceHashes[identityHash] = sourceHash;
      normalizedFacts.push(options.normalizeItem(item));
    }
    if (prefixDrift) break;
    if (
      JSON.stringify(identityHashes) !==
        JSON.stringify(persisted.identityHashes) ||
      Object.keys(sourceHashes).some(
        (identityHash) =>
          sourceHashes[identityHash] !==
          persisted.sourceHashes[identityHash],
      ) ||
      Object.keys(sourceHashes).length !==
        Object.keys(persisted.sourceHashes).length
    ) {
      prefixDrift = true;
      break;
    }
    const refreshedChunk: ValidatedSyncChunk<T> = {
      source: options.source,
      requestKey: options.requestKey,
      cursorKind: "page",
      cursor: page.pageNo,
      pageSize: page.pageSize,
      totalCount: page.totalCount,
      facts: Object.freeze(normalizedFacts) as readonly T[],
      identityHashes: Object.freeze(identityHashes) as readonly string[],
      sourceHashes,
    };
    if (
      options.revalidateChunk !== undefined &&
      !(await options.revalidateChunk(refreshedChunk))
    ) {
      prefixDrift = true;
      break;
    }
    rawPages[persisted.cursor - 1] = page.rawJson;
    lastPage = page;
  }

  if (prefixDrift) {
    return restartFromPageOne();
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
