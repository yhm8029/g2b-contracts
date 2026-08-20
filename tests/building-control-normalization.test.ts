import { describe, expect, it } from "vitest";
import {
  buildAwardSourceKey,
  matchesTargetProduct,
  normalizeProductCode,
} from "@/lib/building-control/normalization";

describe("building control product normalization", () => {
  it("normalizes full-width product codes", () => {
    expect(
      normalizeProductCode("\uFF13\uFF19\uFF11\uFF12\uFF11\uFF18\uFF10\uFF11"),
    ).toBe("39121801");
  });

  it("normalizes hyphenated product code", () => {
    expect(normalizeProductCode("3912-1801-01")).toBe("3912180101");
  });

  it("normalizes whitespace-padded parent code", () => {
    expect(normalizeProductCode(" 3912 1801 ")).toBe("39121801");
  });

  it("normalizes 10-digit detail code", () => {
    expect(normalizeProductCode("3912180102")).toBe("3912180102");
  });

  it("rejects invalid suffixes", () => {
    expect(normalizeProductCode("39121801abc")).toBeNull();
    expect(normalizeProductCode("39121801.0")).toBeNull();
  });

  it("matches target parent code without detail", () => {
    expect(
      matchesTargetProduct({ parentCode: "39121801", detailCode: null }),
    ).toBe(true);
  });

  it("matches target parent when detail is whitespace-only", () => {
    expect(
      matchesTargetProduct({ parentCode: "39121801", detailCode: "   \t\n" }),
    ).toBe(true);
  });

  it("matches target parent code with target detail", () => {
    expect(
      matchesTargetProduct({
        parentCode: "39121801",
        detailCode: "3912180101",
      }),
    ).toBe(true);
  });

  it("matches by detail even when parent code is wrong", () => {
    expect(
      matchesTargetProduct({
        parentCode: "00000000",
        detailCode: "3912180101",
      }),
    ).toBe(true);
  });

  it("does not match when parent matches but detail is non-target", () => {
    expect(
      matchesTargetProduct({
        parentCode: "39121801",
        detailCode: "3912180102",
      }),
    ).toBe(false);
  });

  it("does not match wrong parent code even with null detail", () => {
    expect(
      matchesTargetProduct({ parentCode: "39129999", detailCode: null }),
    ).toBe(false);
  });

  it("builds award source key", () => {
    expect(
      buildAwardSourceKey({
        noticeNo: "R25",
        noticeOrder: "000",
        bidClassNo: "1",
        rebidNo: "2",
      }),
    ).toBe("R25|000|1|2");
  });

  it("throws for blank award identity field", () => {
    expect(() =>
      buildAwardSourceKey({
        noticeNo: "R25",
        noticeOrder: "",
        bidClassNo: "1",
        rebidNo: "2",
      }),
    ).toThrow();
  });
});
