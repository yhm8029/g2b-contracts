import { describe, it, expect, vi } from "vitest";
import {
  collectCompletePages,
  retryTransient,
  type CompletePage,
  type RetryPolicy,
} from "@/lib/building-control/g2b/paging";

type Item = { id: string; seq: number };

function makeItem(id: string, seq: number): Item {
  return { id, seq };
}

function makeCompletePage<T>(
  pageNo: number,
  pageSize: number,
  totalCount: number,
  items: readonly T[],
): CompletePage<T> {
  return {
    pageNo,
    pageSize,
    totalCount,
    items,
    rawJson: JSON.stringify({ pageNo, pageSize, totalCount, items }),
  };
}

describe("CompletePage<T> contract", () => {
  it("exposes the exact required public shape", () => {
    const sample: CompletePage<Item> = makeCompletePage<Item>(1, 10, 0, []);
    expect(sample).toEqual({
      pageNo: 1,
      pageSize: 10,
      totalCount: 0,
      items: [],
      rawJson: expect.any(String),
    });
    expect(Object.isFrozen(sample.items) || Array.isArray(sample.items)).toBe(
      true,
    );
  });

  it("rawJson is a non-empty string for every page", () => {
    const empty: CompletePage<Item> = makeCompletePage<Item>(1, 5, 0, []);
    const full: CompletePage<Item> = makeCompletePage<Item>(2, 3, 9, [
      makeItem("a", 0),
      makeItem("b", 1),
      makeItem("c", 2),
    ]);
    expect(typeof empty.rawJson).toBe("string");
    expect(empty.rawJson.length).toBeGreaterThan(0);
    expect(typeof full.rawJson).toBe("string");
    expect(full.rawJson.length).toBeGreaterThan(0);
  });
});

describe("collectCompletePages happy path", () => {
  it("fetches exact sequential page numbers 1..ceil(totalCount/pageSize)", async () => {
    const calls: Array<{ pageNo: number; pageSize: number }> = [];
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        calls.push({ pageNo, pageSize });
        const totalCount = 25;
        const start = (pageNo - 1) * pageSize;
        const items: Item[] = [];
        for (let i = start; i < Math.min(start + pageSize, totalCount); i++) {
          items.push(makeItem(`id-${i}`, i));
        }
        return makeCompletePage<Item>(pageNo, pageSize, totalCount, items);
      },
    );

    const result = await collectCompletePages<Item>({
      pageSize: 10,
      maxPages: 10,
      fetchPage,
      identity: (it) => it.id,
    });

    expect(calls.map((c) => c.pageNo)).toEqual([1, 2, 3]);
    expect(calls.every((c) => c.pageSize === 10)).toBe(true);
    expect(result.pageCount).toBe(3);
    expect(result.totalCount).toBe(25);
    expect(result.items).toHaveLength(25);
    expect(result.items[0]?.id).toBe("id-0");
    expect(result.items[24]?.id).toBe("id-24");
    expect(result.rawPages).toHaveLength(3);
    expect(result.rawPages[0]?.startsWith("{")).toBe(true);
  });

  it("returns rawPages strictly in page order", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        const totalCount = 3;
        const items: Item[] =
          pageNo === 1
            ? [makeItem("a", 0), makeItem("b", 1)]
            : pageNo === 2
              ? [makeItem("c", 2)]
              : [];
        return makeCompletePage<Item>(pageNo, pageSize, totalCount, items);
      },
    );

    const result = await collectCompletePages<Item>({
      pageSize: 2,
      maxPages: 5,
      fetchPage,
      identity: (it) => it.id,
    });

    expect(result.rawPages).toHaveLength(2);
    expect(result.rawPages[0]).toContain('"a"');
    expect(result.rawPages[1]).toContain('"c"');
  });

  it("handles totalCount=0 on page 1 with zero items and one raw page", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> =>
        makeCompletePage<Item>(pageNo, pageSize, 0, []),
    );

    const result = await collectCompletePages<Item>({
      pageSize: 20,
      maxPages: 5,
      fetchPage,
      identity: (it) => it.id,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(1, 20);
    expect(result.totalCount).toBe(0);
    expect(result.pageCount).toBe(1);
    expect(result.items).toEqual([]);
    expect(result.rawPages).toHaveLength(1);
  });

  it("passes requested pageNo and pageSize into fetchPage exactly", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        const totalCount = 7;
        const start = (pageNo - 1) * pageSize;
        const items: Item[] = [];
        for (let i = start; i < Math.min(start + pageSize, totalCount); i++) {
          items.push(makeItem(`k-${i}`, i));
        }
        return makeCompletePage<Item>(pageNo, pageSize, totalCount, items);
      },
    );

    await collectCompletePages<Item>({
      pageSize: 4,
      maxPages: 3,
      fetchPage,
      identity: (it) => it.id,
    });

    expect(fetchPage.mock.calls).toEqual([
      [1, 4],
      [2, 4],
    ]);
  });

  it("enforces exact expected cardinality for every full and last page", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        const totalCount = 10;
        const start = (pageNo - 1) * pageSize;
        const remain = Math.max(0, totalCount - start);
        const take = Math.min(pageSize, remain);
        const items: Item[] = [];
        for (let i = 0; i < take; i++) {
          items.push(makeItem(`p${pageNo}-${i}`, start + i));
        }
        return makeCompletePage<Item>(pageNo, pageSize, totalCount, items);
      },
    );

    const result = await collectCompletePages<Item>({
      pageSize: 4,
      maxPages: 10,
      fetchPage,
      identity: (it) => it.id,
    });

    expect(fetchPage.mock.calls).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
    ]);
    expect(result.items).toHaveLength(10);
    expect(result.items.slice(0, 4).map((x) => x.id)).toEqual([
      "p1-0",
      "p1-1",
      "p1-2",
      "p1-3",
    ]);
    expect(result.items.slice(4, 8).map((x) => x.id)).toEqual([
      "p2-0",
      "p2-1",
      "p2-2",
      "p2-3",
    ]);
    expect(result.items.slice(8, 10).map((x) => x.id)).toEqual([
      "p3-0",
      "p3-1",
    ]);
  });

  it("keeps totalCount stable across pages", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        const start = (pageNo - 1) * pageSize;
        return makeCompletePage<Item>(pageNo, pageSize, 6, [
          makeItem(`s-${start}`, start),
          makeItem(`s-${start + 1}`, start + 1),
        ]);
      },
    );

    const result = await collectCompletePages<Item>({
      pageSize: 2,
      maxPages: 5,
      fetchPage,
      identity: (it) => it.id,
    });

    expect(result.totalCount).toBe(6);
    expect(result.pageCount).toBe(3);
  });
});

describe("collectCompletePages validation", () => {
  it("rejects non-positive integer pageSize", async () => {
    const fetchPage = vi.fn();
    await expect(
      collectCompletePages<Item>({
        pageSize: 0,
        maxPages: 3,
        fetchPage: fetchPage as unknown as (
          pageNo: number,
          pageSize: number,
        ) => Promise<CompletePage<Item>>,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("rejects non-positive integer maxPages", async () => {
    const fetchPage = vi.fn();
    await expect(
      collectCompletePages<Item>({
        pageSize: 10,
        maxPages: 0,
        fetchPage: fetchPage as unknown as (
          pageNo: number,
          pageSize: number,
        ) => Promise<CompletePage<Item>>,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("rejects duplicate identities across pages", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        const totalCount = 4;
        const items: Item[] =
          pageNo === 1
            ? [makeItem("dup", 0), makeItem("b", 1)]
            : [makeItem("dup", 2), makeItem("d", 3)];
        return makeCompletePage<Item>(pageNo, pageSize, totalCount, items);
      },
    );

    await expect(
      collectCompletePages<Item>({
        pageSize: 2,
        maxPages: 5,
        fetchPage,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects missing/empty identities", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> =>
        makeCompletePage<Item>(pageNo, pageSize, 2, [makeItem("", 0)]),
    );

    await expect(
      collectCompletePages<Item>({
        pageSize: 2,
        maxPages: 5,
        fetchPage,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects page count above maxPages before fetching page 2", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        const totalCount = 30;
        const start = (pageNo - 1) * pageSize;
        const items: Item[] = [];
        for (let i = start; i < Math.min(start + pageSize, totalCount); i++) {
          items.push(makeItem(`x-${i}`, i));
        }
        return makeCompletePage<Item>(pageNo, pageSize, totalCount, items);
      },
    );

    await expect(
      collectCompletePages<Item>({
        pageSize: 10,
        maxPages: 2,
        fetchPage,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("fails when a later page is empty but totalCount requires more", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        const totalCount = 6;
        const items: Item[] =
          pageNo === 1 ? [makeItem("a", 0), makeItem("b", 1)] : [];
        return makeCompletePage<Item>(pageNo, pageSize, totalCount, items);
      },
    );

    await expect(
      collectCompletePages<Item>({
        pageSize: 2,
        maxPages: 5,
        fetchPage,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
  });

  it("fails when a later page is truncated (short of pageSize with remaining total)", async () => {
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        const totalCount = 5;
        const items: Item[] =
          pageNo === 1
            ? [makeItem("a", 0), makeItem("b", 1), makeItem("c", 2)]
            : [makeItem("d", 3)];
        return makeCompletePage<Item>(pageNo, pageSize, totalCount, items);
      },
    );

    await expect(
      collectCompletePages<Item>({
        pageSize: 3,
        maxPages: 5,
        fetchPage,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects a page whose returned pageNo/pageSize do not match the request", async () => {
    const fetchPage = vi.fn(
      async (_pageNo: number, _pageSize: number): Promise<CompletePage<Item>> =>
        makeCompletePage<Item>(2, 10, 5, [makeItem("a", 0)]),
    );

    await expect(
      collectCompletePages<Item>({
        pageSize: 10,
        maxPages: 5,
        fetchPage,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
  });

  it("never marks a partially visited collection complete", async () => {
    let calls = 0;
    const fetchPage = vi.fn(
      async (pageNo: number, pageSize: number): Promise<CompletePage<Item>> => {
        calls += 1;
        if (calls === 1) {
          return makeCompletePage<Item>(1, 4, 12, [
            makeItem("a", 0),
            makeItem("b", 1),
            makeItem("c", 2),
            makeItem("d", 3),
          ]);
        }
        throw new Error("network down");
      },
    );

    await expect(
      collectCompletePages<Item>({
        pageSize: 4,
        maxPages: 5,
        fetchPage,
        identity: (it) => it.id,
      }),
    ).rejects.toThrow();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("retryTransient", () => {
  function mkError(opts: {
    status?: number;
    code?: string;
    message?: string;
  }): Error {
    const e = new Error(opts.message ?? "boom") as Error & {
      status?: number;
      code?: string;
    };
    if (opts.status !== undefined) e.status = opts.status;
    if (opts.code !== undefined) e.code = opts.code;
    return e;
  }

  it("returns the first successful result without retrying", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await retryTransient<string>(op, {
      maxRetries: 3,
      baseDelayMs: 0,
      sleep,
    });
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries 429 and 5xx, then succeeds within budget", async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(mkError({ status: 429 }))
      .mockRejectedValueOnce(mkError({ status: 503 }))
      .mockResolvedValue("finally");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await retryTransient<string>(op, {
      maxRetries: 3,
      baseDelayMs: 0,
      sleep,
    });

    expect(result).toBe("finally");
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries network codes ETIMEDOUT, ECONNRESET, ABORT_ERR", async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(mkError({ code: "ETIMEDOUT" }))
      .mockRejectedValueOnce(mkError({ code: "ECONNRESET" }))
      .mockRejectedValueOnce(mkError({ code: "ABORT_ERR" }))
      .mockResolvedValue("done");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await retryTransient<string>(op, {
      maxRetries: 5,
      baseDelayMs: 0,
      sleep,
    });

    expect(result).toBe("done");
    expect(op).toHaveBeenCalledTimes(4);
  });

  it("does not retry non-retryable 4xx errors", async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(mkError({ status: 400, message: "bad request" }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryTransient<string>(op, {
        maxRetries: 3,
        baseDelayMs: 0,
        sleep,
      }),
    ).rejects.toThrow("bad request");
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry malformed/contract errors lacking retry signals", async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("malformed payload"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryTransient<string>(op, {
        maxRetries: 3,
        baseDelayMs: 0,
        sleep,
      }),
    ).rejects.toThrow("malformed payload");
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("makes at most maxRetries+1 total attempts before giving up", async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(mkError({ status: 500 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryTransient<string>(op, {
        maxRetries: 2,
        baseDelayMs: 0,
        sleep,
      }),
    ).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("rejects non-integer or negative maxRetries/baseDelayMs", async () => {
    const op = vi.fn().mockResolvedValue("x");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      retryTransient<string>(op, {
        maxRetries: -1,
        baseDelayMs: 0,
        sleep,
      }),
    ).rejects.toThrow();
    await expect(
      retryTransient<string>(op, {
        maxRetries: 1.5,
        baseDelayMs: 0,
        sleep,
      } as RetryPolicy),
    ).rejects.toThrow();
    await expect(
      retryTransient<string>(op, {
        maxRetries: 1,
        baseDelayMs: -1,
        sleep,
      }),
    ).rejects.toThrow();
    expect(op).not.toHaveBeenCalled();
  });

  it("uses baseDelayMs as the argument to injected sleep (no real timers)", async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(mkError({ status: 503 }))
      .mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await retryTransient<string>(op, {
      maxRetries: 1,
      baseDelayMs: 7,
      sleep,
    });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(7);
  });
});
