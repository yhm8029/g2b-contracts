import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectCompletePagesResumable } from "@/lib/building-control/g2b/paging";
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
      identity: (item) => item.id,
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
      identity: (item) => item.id,
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
              sourceHashes: { [sha256("a")]: sha256("a") },
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
    expect(fetchCallCount).toBe(1);
    expect(fetchedPages).toEqual([2]);
  });
});
