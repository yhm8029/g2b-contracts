import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  collectCompletePagesResumable,
  ResumeRunRestartRequiredError,
} from "@/lib/building-control/g2b/paging";
import type { ValidatedSyncChunk } from "@/lib/building-control/sync-progress";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildPage(pageNo: number, items: Array<{ id: string; name: string }>) {
  return {
    pageNo,
    pageSize: 2,
    totalCount: 3,
    items,
    rawJson: JSON.stringify({ items }),
  };
}

describe("collectCompletePagesResumable", () => {
  it("emits validated chunks via progress hooks and aggregates results", async () => {
    const collected: ValidatedSyncChunk<{ id: string; name: string }>[] = [];
    const result = await collectCompletePagesResumable<{
      id: string;
      name: string;
    }>({
      source: "notice-publication",
      requestKey: "notice-bulk-1",
      pageSize: 2,
      maxPages: 10,
      identity: (item) => sha256(item.id),
      fetchPage: async (pageNo) =>
        buildPage(
          pageNo,
          pageNo === 1
            ? [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ]
            : [{ id: "c", name: "Gamma" }],
        ),
      hashItem: (item) => sha256(item.id),
      hashPageJson: (rawJson) => sha256(rawJson),
      normalizeItem: (item) => ({ ...item }),
      progress: {
        readResumeSeed: async () => null,
        onValidatedChunk: async (chunk) => {
          collected.push(chunk);
        },
      },
    });
    expect(result.items.length).toBe(3);
    expect(result.totalCount).toBe(3);
    expect(result.pageCount).toBe(2);
    expect(result.resumed).toBe(false);
    expect(collected).toHaveLength(2);
    expect(collected[0]!.cursor).toBe(1);
    expect(collected[1]!.cursor).toBe(2);
  });

  it("resumes from persisted chunks when readResumeSeed returns a seed", async () => {
    let fetchCallCount = 0;
    const fetchedPages: number[] = [];
    const result = await collectCompletePagesResumable<{
      id: string;
      name: string;
    }>({
      source: "notice-publication",
      requestKey: "notice-bulk-2",
      pageSize: 2,
      maxPages: 10,
      identity: (item) => sha256(item.id),
      fetchPage: async (pageNo) => {
        fetchCallCount += 1;
        fetchedPages.push(pageNo);
        return buildPage(
          pageNo,
          pageNo === 1
            ? [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ]
            : [{ id: "c", name: "Gamma" }],
        );
      },
      hashItem: (item) => sha256(item.id),
      hashPageJson: (rawJson) => sha256(rawJson),
      normalizeItem: (item) => ({ ...item }),
      progress: {
        readResumeSeed: async () => ({
          cursorKind: "page",
          nextCursor: 2,
          pageSize: 2,
          totalCount: 3,
          seenIdentityHashes: [sha256("a"), sha256("b")],
          persistedChunks: [
            {
              source: "notice-publication",
              requestKey: "notice-bulk-2",
              cursorKind: "page",
              cursor: 1,
              pageSize: 2,
              totalCount: 3,
              facts: [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ],
              identityHashes: [sha256("a"), sha256("b")],
              sourceHashes: {
                [sha256("a")]: sha256("a"),
                [sha256("b")]: sha256("b"),
              },
            },
          ],
        }),
        onValidatedChunk: async () => undefined,
      },
    });
    expect(result.items.length).toBe(3);
    expect(result.totalCount).toBe(3);
    expect(result.pageCount).toBe(2);
    expect(result.resumed).toBe(true);
    expect(fetchCallCount).toBe(2);
    expect(fetchedPages).toEqual([2, 1]);
  });

  it("revalidates the persisted prefix and restarts from page one on drift", async () => {
    const fetchedPages: number[] = [];
    let resetCount = 0;
    const result = await collectCompletePagesResumable<{
      id: string;
      name: string;
    }>({
      source: "notice-publication",
      requestKey: "notice-bulk-drift",
      pageSize: 2,
      maxPages: 10,
      identity: (item) => sha256(item.id),
      fetchPage: async (pageNo) => {
        fetchedPages.push(pageNo);
        if (pageNo === 2) {
          return buildPage(2, [{ id: "c", name: "Gamma" }]);
        }
        return buildPage(1, [
          { id: "x", name: "Replacement" },
          { id: "b", name: "Beta" },
        ]);
      },
      hashItem: (item) => sha256(item.id),
      hashPageJson: (rawJson) => sha256(rawJson),
      normalizeItem: (item) => ({ ...item }),
      progress: {
        readResumeSeed: async () => ({
          cursorKind: "page",
          nextCursor: 2,
          pageSize: 2,
          totalCount: 3,
          seenIdentityHashes: [sha256("a"), sha256("b")],
          persistedChunks: [
            {
              source: "notice-publication",
              requestKey: "notice-bulk-drift",
              cursorKind: "page",
              cursor: 1,
              pageSize: 2,
              totalCount: 3,
              facts: [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ],
              identityHashes: [sha256("a"), sha256("b")],
              sourceHashes: {
                [sha256("a")]: sha256("a"),
                [sha256("b")]: sha256("b"),
              },
            },
          ],
        }),
        onValidatedChunk: async () => undefined,
        resetAfterDrift: async () => {
          resetCount += 1;
        },
      },
    });

    expect(fetchedPages).toEqual([2, 1, 1, 2]);
    expect(resetCount).toBe(1);
    expect(result.resumed).toBe(false);
    expect(result.items.map((item) => item.id)).toEqual(["x", "b", "c"]);
  });

  it("resets a malformed seed before making any provider request", async () => {
    const fetchedPages: number[] = [];
    let resetCount = 0;
    const result = await collectCompletePagesResumable<{
      id: string;
      name: string;
    }>({
      source: "notice-publication",
      requestKey: "notice-bulk-malformed-seed",
      pageSize: 2,
      maxPages: 10,
      identity: (item) => sha256(item.id),
      fetchPage: async (pageNo) => {
        fetchedPages.push(pageNo);
        return buildPage(
          pageNo,
          pageNo === 1
            ? [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ]
            : [{ id: "c", name: "Gamma" }],
        );
      },
      hashItem: (item) => sha256(item.id),
      hashPageJson: (rawJson) => sha256(rawJson),
      normalizeItem: (item) => ({ ...item }),
      progress: {
        readResumeSeed: async () => ({
          cursorKind: "page",
          nextCursor: 2,
          pageSize: 2,
          totalCount: 3,
          seenIdentityHashes: [sha256("a"), sha256("b")],
          persistedChunks: [
            {
              source: "award-registration",
              requestKey: "notice-bulk-malformed-seed",
              cursorKind: "page",
              cursor: 1,
              pageSize: 2,
              totalCount: 3,
              facts: [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ],
              identityHashes: [sha256("a"), sha256("b")],
              sourceHashes: {
                [sha256("a")]: sha256("a"),
                [sha256("b")]: sha256("b"),
              },
            },
          ],
        }),
        onValidatedChunk: async () => undefined,
        resetAfterDrift: async () => {
          resetCount += 1;
        },
      },
    });

    expect(resetCount).toBe(1);
    expect(fetchedPages).toEqual([1, 2]);
    expect(result.resumed).toBe(false);
  });

  it("resets when the first resumed suffix page changes totalCount", async () => {
    const fetchedPages: number[] = [];
    let resetCount = 0;
    const result = await collectCompletePagesResumable<{
      id: string;
      name: string;
    }>({
      source: "notice-publication",
      requestKey: "notice-bulk-total-drift",
      pageSize: 2,
      maxPages: 10,
      identity: (item) => sha256(item.id),
      fetchPage: async (pageNo) => {
        fetchedPages.push(pageNo);
        return {
          pageNo,
          pageSize: 2,
          totalCount: 4,
          items:
            pageNo === 1
              ? [
                  { id: "a", name: "Alpha" },
                  { id: "b", name: "Beta" },
                ]
              : [
                  { id: "c", name: "Gamma" },
                  { id: "d", name: "Delta" },
                ],
          rawJson: JSON.stringify({ pageNo, totalCount: 4 }),
        };
      },
      hashItem: (item) => sha256(item.id),
      hashPageJson: (rawJson) => sha256(rawJson),
      normalizeItem: (item) => ({ ...item }),
      progress: {
        readResumeSeed: async () => ({
          cursorKind: "page",
          nextCursor: 2,
          pageSize: 2,
          totalCount: 3,
          seenIdentityHashes: [sha256("a"), sha256("b")],
          persistedChunks: [
            {
              source: "notice-publication",
              requestKey: "notice-bulk-total-drift",
              cursorKind: "page",
              cursor: 1,
              pageSize: 2,
              totalCount: 3,
              facts: [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ],
              identityHashes: [sha256("a"), sha256("b")],
              sourceHashes: {
                [sha256("a")]: sha256("a"),
                [sha256("b")]: sha256("b"),
              },
            },
          ],
        }),
        onValidatedChunk: async () => undefined,
        resetAfterDrift: async () => {
          resetCount += 1;
        },
      },
    });

    expect(resetCount).toBe(1);
    expect(fetchedPages).toEqual([2, 1, 2]);
    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.resumed).toBe(false);
  });

  it("requires a new run when immutable completed evidence drifts", async () => {
    const fetchedPages: number[] = [];
    let resetCount = 0;
    const promise = collectCompletePagesResumable<{
      id: string;
      name: string;
    }>({
      source: "notice-publication",
      requestKey: "notice-bulk-complete-drift",
      pageSize: 2,
      maxPages: 10,
      identity: (item) => sha256(item.id),
      fetchPage: async (pageNo) => {
        fetchedPages.push(pageNo);
        if (pageNo === 2) {
          return buildPage(2, [{ id: "c", name: "Gamma" }]);
        }
        return buildPage(1, [
          { id: "x", name: "Replacement" },
          { id: "b", name: "Beta" },
        ]);
      },
      hashItem: (item) => sha256(item.id),
      hashPageJson: (rawJson) => sha256(rawJson),
      normalizeItem: (item) => ({ ...item }),
      progress: {
        readResumeSeed: async () => ({
          cursorKind: "page",
          nextCursor: 2,
          pageSize: 2,
          totalCount: 3,
          seenIdentityHashes: [sha256("a"), sha256("b")],
          persistedChunks: [
            {
              source: "notice-publication",
              requestKey: "notice-bulk-complete-drift",
              cursorKind: "page",
              cursor: 1,
              pageSize: 2,
              totalCount: 3,
              facts: [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ],
              identityHashes: [sha256("a"), sha256("b")],
              sourceHashes: {
                [sha256("a")]: sha256("a"),
                [sha256("b")]: sha256("b"),
              },
            },
          ],
        }),
        onValidatedChunk: async () => undefined,
        resetAfterDrift: async () => {
          resetCount += 1;
          return "restart-run";
        },
      },
    });

    await expect(promise).rejects.toBeInstanceOf(
      ResumeRunRestartRequiredError,
    );
    expect(fetchedPages).toEqual([2, 1]);
    expect(resetCount).toBe(1);
  });

  it("resets a zero-count seed that has no persisted empty page", async () => {
    const fetchedPages: number[] = [];
    let resetCount = 0;
    const result = await collectCompletePagesResumable<{
      id: string;
      name: string;
    }>({
      source: "notice-publication",
      requestKey: "notice-bulk-empty-malformed",
      pageSize: 2,
      maxPages: 10,
      identity: (item) => sha256(item.id),
      fetchPage: async (pageNo) => {
        fetchedPages.push(pageNo);
        return {
          pageNo,
          pageSize: 2,
          totalCount: 0,
          items: [],
          rawJson: JSON.stringify({ pageNo, totalCount: 0, items: [] }),
        };
      },
      hashItem: (item) => sha256(item.id),
      hashPageJson: (rawJson) => sha256(rawJson),
      normalizeItem: (item) => ({ ...item }),
      progress: {
        readResumeSeed: async () => ({
          cursorKind: "page",
          nextCursor: 1,
          pageSize: 2,
          totalCount: 0,
          seenIdentityHashes: [],
          persistedChunks: [],
        }),
        onValidatedChunk: async () => undefined,
        resetAfterDrift: async () => {
          resetCount += 1;
          return "reset";
        },
      },
    });

    expect(resetCount).toBe(1);
    expect(fetchedPages).toEqual([1]);
    expect(result).toMatchObject({
      pageCount: 1,
      totalCount: 0,
      items: [],
      resumed: false,
    });
  });

  it("resets a structurally invalid seed before reading its fields", async () => {
    const fetchedPages: number[] = [];
    let resetCount = 0;
    const result = await collectCompletePagesResumable<{
      id: string;
      name: string;
    }>({
      source: "notice-publication",
      requestKey: "notice-bulk-invalid-shape",
      pageSize: 2,
      maxPages: 10,
      identity: (item) => sha256(item.id),
      fetchPage: async (pageNo) => {
        fetchedPages.push(pageNo);
        return buildPage(
          pageNo,
          pageNo === 1
            ? [
                { id: "a", name: "Alpha" },
                { id: "b", name: "Beta" },
              ]
            : [{ id: "c", name: "Gamma" }],
        );
      },
      hashItem: (item) => sha256(item.id),
      hashPageJson: (rawJson) => sha256(rawJson),
      normalizeItem: (item) => ({ ...item }),
      progress: {
        readResumeSeed: async () =>
          ({
            cursorKind: "page",
            pageSize: 2,
            totalCount: null,
            nextCursor: 1,
          }) as never,
        onValidatedChunk: async () => undefined,
        resetAfterDrift: async () => {
          resetCount += 1;
          return "reset";
        },
      },
    });

    expect(resetCount).toBe(1);
    expect(fetchedPages).toEqual([1, 2]);
    expect(result.resumed).toBe(false);
  });
});
