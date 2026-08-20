import { describe, it, expect } from "vitest";
import { createDesignationSession } from "@/lib/building-control/g2b/designation-session";

describe("RED: session option validation (timeout, redirects, retry)", () => {
  function silentFetch(): Parameters<
    typeof createDesignationSession
  >[0]["fetch"] {
    return async () =>
      new Response(null, {
        status: 200,
        headers: { "set-cookie": "sid=1" },
      });
  }

  it("rejects non-finite timeoutMs (Infinity)", () => {
    expect(() =>
      createDesignationSession({
        fetch: silentFetch(),
        retryPolicy: { maxRetries: 0, baseDelayMs: 1, sleep: async () => {} },
        timeoutMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/timeout|finite|invalid/i);
  });

  it("rejects non-positive timeoutMs (0 or negative)", () => {
    expect(() =>
      createDesignationSession({
        fetch: silentFetch(),
        retryPolicy: { maxRetries: 0, baseDelayMs: 1, sleep: async () => {} },
        timeoutMs: 0,
      }),
    ).toThrow(/timeout/i);
    expect(() =>
      createDesignationSession({
        fetch: silentFetch(),
        retryPolicy: { maxRetries: 0, baseDelayMs: 1, sleep: async () => {} },
        timeoutMs: -5,
      }),
    ).toThrow(/timeout/i);
  });

  it("rejects negative or non-integer maxRedirects", () => {
    expect(() =>
      createDesignationSession({
        fetch: silentFetch(),
        retryPolicy: { maxRetries: 0, baseDelayMs: 1, sleep: async () => {} },
        maxRedirects: -1,
      }),
    ).toThrow(/redirect/i);
    expect(() =>
      createDesignationSession({
        fetch: silentFetch(),
        retryPolicy: { maxRetries: 0, baseDelayMs: 1, sleep: async () => {} },
        maxRedirects: 1.5,
      }),
    ).toThrow(/redirect/i);
  });

  it("rejects unbounded maxRedirects as invalid", () => {
    expect(() =>
      createDesignationSession({
        fetch: silentFetch(),
        retryPolicy: { maxRetries: 0, baseDelayMs: 1, sleep: async () => {} },
        maxRedirects: Number.POSITIVE_INFINITY as unknown as number,
      }),
    ).toThrow(/redirect|finite|bound/i);
  });

  it("rejects non-integer retry limits", () => {
    expect(() =>
      createDesignationSession({
        fetch: silentFetch(),
        retryPolicy: {
          maxRetries: 1.5,
          baseDelayMs: 1,
          sleep: async () => {},
        },
      }),
    ).toThrow(/retry|maxRetries/i);
    expect(() =>
      createDesignationSession({
        fetch: silentFetch(),
        retryPolicy: {
          maxRetries: -3,
          baseDelayMs: 1,
          sleep: async () => {},
        },
      }),
    ).toThrow(/retry|maxRetries/i);
  });
});
