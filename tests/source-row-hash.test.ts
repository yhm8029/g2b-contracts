import { describe, expect, it } from "vitest";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";

describe("createSourceRowHash", () => {
  it("is stable regardless of object key order", () => {
    const a = createSourceRowHash({ biz_no: "123", contract_no: "A", amount: "1000" });
    const b = createSourceRowHash({ amount: "1000", contract_no: "A", biz_no: "123" });
    expect(a).toBe(b);
  });
});
