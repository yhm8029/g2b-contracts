// src/lib/building-control/g2b/paging.ts
// Generic, deterministic, ASCII-only pagination collector with transient retry.
// TypeScript 5.7. No network/global state. Sleep is injected.

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
