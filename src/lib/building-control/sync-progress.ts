import type { CoverageSource } from "./repository";

export type SyncResumeSeed = {
  cursorKind: "page" | "detail";
  nextCursor: number;
  pageSize: number;
  totalCount: number | null;
  seenIdentityHashes: readonly string[];
  persistedChunks: readonly ValidatedSyncChunk<unknown>[];
};

export type ValidatedSyncChunk<T> = {
  source: CoverageSource;
  requestKey: string;
  cursorKind: "page" | "detail";
  cursor: number;
  pageSize: number;
  totalCount: number;
  facts: readonly T[];
  identityHashes: readonly string[];
  sourceHashes: Readonly<Record<string, string>>;
};

export type SyncProgressHooks<T> = {
  readResumeSeed(requestKey: string): Promise<SyncResumeSeed | null>;
  onValidatedChunk(chunk: ValidatedSyncChunk<T>): Promise<void>;
  resetAfterDrift?(
    requestKey: string,
  ): Promise<void | "reset" | "restart-run">;
};

export function isResumeSeed(value: unknown): value is SyncResumeSeed {
  if (value === null || typeof value !== "object") return false;
  const seed = value as Record<string, unknown>;
  if (seed.cursorKind !== "page" && seed.cursorKind !== "detail") return false;
  if (typeof seed.nextCursor !== "number" || seed.nextCursor < 1) return false;
  if (typeof seed.pageSize !== "number" || seed.pageSize < 1) return false;
  if (
    seed.totalCount !== null &&
    (typeof seed.totalCount !== "number" || seed.totalCount < 0)
  ) {
    return false;
  }
  if (
    !Array.isArray(seed.seenIdentityHashes) ||
    !seed.seenIdentityHashes.every((v) => typeof v === "string")
  ) {
    return false;
  }
  if (
    !Array.isArray(seed.persistedChunks) ||
    !seed.persistedChunks.every(
      (chunk) =>
        chunk !== null &&
        typeof chunk === "object" &&
        typeof (chunk as { source?: unknown }).source === "string" &&
        typeof (chunk as { requestKey?: unknown }).requestKey === "string" &&
        ((chunk as { cursorKind?: unknown }).cursorKind === "page" ||
          (chunk as { cursorKind?: unknown }).cursorKind === "detail") &&
        typeof (chunk as { cursor?: unknown }).cursor === "number" &&
        typeof (chunk as { pageSize?: unknown }).pageSize === "number" &&
        typeof (chunk as { totalCount?: unknown }).totalCount === "number" &&
        Array.isArray((chunk as { identityHashes?: unknown }).identityHashes),
    )
  ) {
    return false;
  }
  return true;
}
