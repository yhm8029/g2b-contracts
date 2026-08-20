import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { loadActiveFixtureGeneration } from "@/lib/building-control/fixture-generation";
import {
  isAwardRegistrationTimestampInWindow,
  hasExactDesignationStatusUnion,
  assertBuildingControlFixtureProjection,
  hasDesignationExtensionEvidence,
  hasRepresentativeWinnerIdentity,
  hasResolvedFinalAwardDate,
  hasTerminalAwardFeedEvidence,
  normalizeDesignationDate,
  parseDesignationDetailPayload,
  resolveAllowedDesignationRedirect,
  shouldPromoteProbeFixtures,
} from "@/lib/building-control/live-api-contract-probe";
import { assertProbeFixtureSafe } from "@/lib/building-control/api-contract-probe";
import { matchesTargetProduct } from "@/lib/building-control/normalization";
import {
  TARGET_DETAIL_CODE,
  TARGET_PARENT_CODE,
} from "@/lib/building-control/constants";
import { BUILDING_CONTROL_REQUIRED_CHECKS } from "@/lib/building-control/api-contract";

const FIXTURE_DIR = join(
  process.cwd(),
  "tests",
  "fixtures",
  "building-control",
);
const SAFE_FIXTURE_FILES = [
  "notice-page.json",
  "purchase-target-page.json",
  "award-page.json",
  "designation-list-valid.json",
  "designation-list-expired.json",
  "designation-list-extended.json",
  "designation-detail.json",
] as const;

const REPORT_VERSION = 1;
const REPORT_GENERATED_AT = "2026-08-20T00:00:00.000Z";
const REPORT_STRATEGY = "exhaustive_fallback";

const AWARD_BEGIN = "202608190000";
const AWARD_END = "202608192359";

const VALID_STATUS = "\uC720\uD6A8";
const EXPIRED_STATUS = "\uB9CC\uB8CC";
const SUSPENDED_STATUS = "\uD6A8\uB825\uC815\uC9C0";

const ACTIVE_GENERATION = loadActiveFixtureGeneration(FIXTURE_DIR);

function loadFixture(name: (typeof SAFE_FIXTURE_FILES)[number]): unknown {
  return ACTIVE_GENERATION.bundle[name];
}

function makePassingChecks(): Record<string, boolean> {
  const checks: Record<string, boolean> = {};
  for (const key of BUILDING_CONTROL_REQUIRED_CHECKS) checks[key] = true;
  return checks;
}

function makeFixtureHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of SAFE_FIXTURE_FILES) {
    hashes[name] = "a".repeat(64);
  }
  return hashes;
}

describe("resolveAllowedDesignationRedirect", () => {
  it("resolves a relative redirect on the allowed origin", () => {
    expect(
      resolveAllowedDesignationRedirect(
        "https://shop.g2b.go.kr/start",
        "/next",
      ),
    ).toBe("https://shop.g2b.go.kr/next");
  });

  it("accepts an absolute redirect on the allowed origin", () => {
    expect(
      resolveAllowedDesignationRedirect(
        "https://shop.g2b.go.kr/start",
        "https://shop.g2b.go.kr/next",
      ),
    ).toBe("https://shop.g2b.go.kr/next");
  });

  it("accepts the official anonymous SSO redirect origin", () => {
    expect(
      resolveAllowedDesignationRedirect(
        "https://shop.g2b.go.kr/start",
        "https://sso.g2b.go.kr/anonymous",
      ),
    ).toBe("https://sso.g2b.go.kr/anonymous");
  });

  it("rejects another origin", () => {
    expect(() =>
      resolveAllowedDesignationRedirect(
        "https://shop.g2b.go.kr/start",
        "https://evil.example/next",
      ),
    ).toThrow();
  });

  it("rejects HTTP on the allowed host", () => {
    expect(() =>
      resolveAllowedDesignationRedirect(
        "https://shop.g2b.go.kr/start",
        "http://shop.g2b.go.kr/next",
      ),
    ).toThrow();
  });

  it("rejects a suffix-confusion host", () => {
    expect(() =>
      resolveAllowedDesignationRedirect(
        "https://shop.g2b.go.kr/start",
        "https://shop.g2b.go.kr.evil.example/next",
      ),
    ).toThrow();
  });

  it("rejects credentials on the allowed host", () => {
    expect(() =>
      resolveAllowedDesignationRedirect(
        "https://shop.g2b.go.kr/start",
        "https://user:pass@shop.g2b.go.kr/next",
      ),
    ).toThrow();
  });
});

describe("normalizeDesignationDate", () => {
  it("converts compact dates to ISO dates", () => {
    expect(normalizeDesignationDate("20260713")).toBe("2026-07-13");
  });

  it("preserves ISO dates", () => {
    expect(normalizeDesignationDate("2026-07-13")).toBe("2026-07-13");
  });

  it("returns null for blank input", () => {
    expect(normalizeDesignationDate("")).toBeNull();
  });

  it("rejects invalid calendar dates", () => {
    expect(() => normalizeDesignationDate("20260230")).toThrow();
  });
});

describe("parseDesignationDetailPayload", () => {
  it("preserves request provenance when the official response omits identity", () => {
    const payload = {
      ErrorCode: 0,
      dlSlctnSttusDtlInfoM: { itemCfnm: "sample" },
      dlProdSpecModlDtlL: [{ itemUntyNo: "3912180101" }],
    };
    const request = {
      etpmDsgnCrfcNo: "2026058",
      etpmDsgnDmndNo: "REQ-1",
      dsgnDmndChgOrd: "002",
      etpsSqno: "1",
    };

    expect(parseDesignationDetailPayload(payload, request)).toEqual({
      request,
      rows: [{ itemUntyNo: "3912180101" }],
      status: "",
    });
  });
});

describe("hasRepresentativeWinnerIdentity", () => {
  type OfficialRow = {
    bidNtceNo: string;
    bidNtceOrd: string;
    bidClsfcNo: string;
    rbidNo: string;
    rgstDt: string;
    fnlSucsfDate: string;
    bidwinnrBizno: string;
    bidwinnrNm: string;
  };

  const makeRow = (overrides: Partial<OfficialRow> = {}): OfficialRow => ({
    bidNtceNo: "20240123-001",
    bidNtceOrd: "001",
    bidClsfcNo: "01",
    rbidNo: "000",
    rgstDt: "2024-01-23 10:30:00",
    fnlSucsfDate: "",
    bidwinnrBizno: "1234567890",
    bidwinnrNm: "Acme Co Ltd",
    ...overrides,
  });

  it("returns true when fnlSucsfDate is blank but rgstDt is a valid nonblank timestamp and other required fields are present", () => {
    const rows: OfficialRow[] = [
      makeRow({
        rbidNo: "000",
        fnlSucsfDate: "",
        rgstDt: "2024-01-23 10:30:00",
        bidClsfcNo: "01",
        bidwinnrBizno: "1234567890",
        bidwinnrNm: "Acme Co Ltd",
      }),
    ];
    expect(hasRepresentativeWinnerIdentity(rows)).toBe(true);
  });

  it("returns false when two rows share the same bidNtceNo, bidNtceOrd, and bidClsfcNo even if rbidNo differs", () => {
    const rows: OfficialRow[] = [
      makeRow({ rbidNo: "000" }),
      makeRow({ rbidNo: "001" }),
    ];
    expect(hasRepresentativeWinnerIdentity(rows)).toBe(false);
  });

  it.each([
    { label: "blank bidwinnrNm", overrides: { bidwinnrNm: "" } },
    { label: "short bidwinnrBizno", overrides: { bidwinnrBizno: "12345" } },
    {
      label: "non-digit bidwinnrBizno",
      overrides: { bidwinnrBizno: "123456789a" },
    },
  ])("returns false for $label", ({ overrides }) => {
    const rows: OfficialRow[] = [makeRow(overrides)];
    expect(hasRepresentativeWinnerIdentity(rows)).toBe(false);
  });
});

describe("hasTerminalAwardFeedEvidence", () => {
  const makeRow = (
    overrides: Partial<{
      bidNtceNo: string;
      bidNtceOrd: string;
      bidClsfcNo: string;
      rbidNo: string;
    }> = {},
  ) => ({
    bidNtceNo: "2024-001",
    bidNtceOrd: "00",
    bidClsfcNo: "1",
    rbidNo: "000",
    ...overrides,
  });

  it('returns true for two unique grains with rbidNo "000" and "001"', () => {
    const rows = [
      makeRow({ bidClsfcNo: "1", rbidNo: "000" }),
      makeRow({ bidClsfcNo: "2", rbidNo: "001" }),
    ];
    expect(hasTerminalAwardFeedEvidence(rows)).toBe(true);
  });

  it("returns false for duplicate three-part grain even if rbidNo differs", () => {
    const rows = [
      makeRow({
        bidNtceNo: "2024-001",
        bidNtceOrd: "00",
        bidClsfcNo: "1",
        rbidNo: "000",
      }),
      makeRow({
        bidNtceNo: "2024-001",
        bidNtceOrd: "00",
        bidClsfcNo: "1",
        rbidNo: "001",
      }),
    ];
    expect(hasTerminalAwardFeedEvidence(rows)).toBe(false);
  });

  it('returns false when all rows have rbidNo "000" (no observed rebid example)', () => {
    const rows = [
      makeRow({ bidClsfcNo: "1", rbidNo: "000" }),
      makeRow({ bidClsfcNo: "2", rbidNo: "000" }),
    ];
    expect(hasTerminalAwardFeedEvidence(rows)).toBe(false);
  });

  it('returns false for malformed rbidNo "A01"', () => {
    const rows = [
      makeRow({ bidClsfcNo: "1", rbidNo: "000" }),
      makeRow({ bidClsfcNo: "2", rbidNo: "A01" }),
    ];
    expect(hasTerminalAwardFeedEvidence(rows)).toBe(false);
  });
});

describe("hasResolvedFinalAwardDate (live API contract)", () => {
  it("returns true when fnlSucsfDate is a valid YYYY-MM-DD string", () => {
    const row: Record<string, unknown> = { fnlSucsfDate: "2026-08-19" };
    expect(hasResolvedFinalAwardDate(row)).toBe(true);
  });

  it("returns false when fnlSucsfDate is blank even if rgstDt is valid", () => {
    const row: Record<string, unknown> = {
      fnlSucsfDate: "",
      rgstDt: "2026-08-19",
    };
    expect(hasResolvedFinalAwardDate(row)).toBe(false);
  });

  it("returns false when fnlSucsfDate is an invalid calendar date", () => {
    const row: Record<string, unknown> = { fnlSucsfDate: "2026-02-30" };
    expect(hasResolvedFinalAwardDate(row)).toBe(false);
  });
});

describe("hasDesignationExtensionEvidence", () => {
  it("returns true when endDate and extensionDate are equal valid ISO dates", () => {
    expect(
      hasDesignationExtensionEvidence({
        endDate: "2024-05-01",
        extensionDate: "2024-05-01",
      }),
    ).toBe(true);
  });

  it("returns true when extensionDate is a later valid ISO date", () => {
    expect(
      hasDesignationExtensionEvidence({
        endDate: "2024-05-01",
        extensionDate: "2024-06-15",
      }),
    ).toBe(true);
  });

  it("returns false when extensionDate is blank", () => {
    expect(
      hasDesignationExtensionEvidence({
        endDate: "2024-05-01",
        extensionDate: "",
      }),
    ).toBe(false);
  });

  it("returns false when extensionDate is earlier than endDate", () => {
    expect(
      hasDesignationExtensionEvidence({
        endDate: "2024-05-01",
        extensionDate: "2024-04-15",
      }),
    ).toBe(false);
  });
});

describe("building control live api contract", () => {
  describe("committed fixture files", () => {
    for (const name of SAFE_FIXTURE_FILES) {
      it(`loads ${name} as valid JSON`, () => {
        expect(() => loadFixture(name)).not.toThrow();
      });

      it(`${name} passes sanitizer safety check`, () => {
        const data = loadFixture(name);
        expect(() => assertProbeFixtureSafe(data)).not.toThrow();
      });
    }
  });

  describe("notice-page fixture", () => {
    it("matches the public page envelope", () => {
      const data = loadFixture("notice-page.json") as {
        schemaVersion: number;
        page: {
          pageNo: number;
          numOfRows: number;
          totalCount: number;
          items: unknown[];
        };
      };
      expect(data.schemaVersion).toBe(1);
      expect(data.page.pageNo).toBe(1);
      expect(typeof data.page.numOfRows).toBe("number");
      expect(data.page.numOfRows).toBeGreaterThan(0);
      expect(data.page.totalCount).toBeGreaterThan(0);
      expect(data.page.items.length).toBe(
        Math.min(data.page.numOfRows, data.page.totalCount),
      );
    });

    it("projects through the building control allowlist", () => {
      const data = loadFixture("notice-page.json");
      expect(() =>
        assertBuildingControlFixtureProjection("notice-page.json", data),
      ).not.toThrow();
    });
  });

  describe("purchase-target-page fixture", () => {
    it("uses only official item fields", () => {
      const data = loadFixture("purchase-target-page.json") as {
        page: { items: Record<string, unknown>[] };
      };
      const allowed = new Set([
        "bidNtceNo",
        "bidNtceOrd",
        "bidClsfcNo",
        "prdctSno",
        "prdctClsfcNo",
        "dtilPrdctClsfcNo",
      ]);
      expect(data.page.items.length).toBeGreaterThan(0);
      for (const item of data.page.items) {
        for (const key of Object.keys(item)) {
          expect(allowed.has(key)).toBe(true);
        }
      }
    });

    it("qualifies items through matchesTargetProduct with exact detail", () => {
      const data = loadFixture("purchase-target-page.json") as {
        page: {
          items: {
            prdctClsfcNo: string;
            dtilPrdctClsfcNo: string;
          }[];
        };
      };
      expect(data.page.items.length).toBeGreaterThan(0);
      const atLeastOne = data.page.items.some(
        (row) =>
          matchesTargetProduct({
            parentCode: row.prdctClsfcNo,
            detailCode: row.dtilPrdctClsfcNo,
          }) && row.dtilPrdctClsfcNo === TARGET_DETAIL_CODE,
      );
      expect(atLeastOne).toBe(true);
    });

    it("projects through the building control allowlist", () => {
      const data = loadFixture("purchase-target-page.json");
      expect(() =>
        assertBuildingControlFixtureProjection(
          "purchase-target-page.json",
          data,
        ),
      ).not.toThrow();
    });
  });

  describe("award-page fixture", () => {
    it("flags unresolved vs resolved winners using fnlSucsfDate only (no rgstDt fallback)", () => {
      const data = loadFixture("award-page.json") as {
        page: { items: Record<string, unknown>[] };
      };
      const items = data.page.items;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);

      const unresolved = items.find(
        (r) =>
          typeof r.fnlSucsfDate !== "string" ||
          (r.fnlSucsfDate as string).trim() === "",
      );
      expect(unresolved).toBeDefined();
      if (!unresolved) throw new Error("unresolved award fixture missing");

      expect(typeof unresolved.bidNtceNo).toBe("string");
      expect((unresolved.bidNtceNo as string).length).toBeGreaterThan(0);
      expect(typeof unresolved.bidNtceOrd).toBe("string");
      expect((unresolved.bidNtceOrd as string).length).toBeGreaterThan(0);
      expect(typeof unresolved.bidClsfcNo).toBe("string");
      expect((unresolved.bidClsfcNo as string).length).toBeGreaterThan(0);
      expect(typeof unresolved.rbidNo).toBe("string");
      expect((unresolved.rbidNo as string).length).toBeGreaterThan(0);
      expect(typeof unresolved.rgstDt).toBe("string");
      expect((unresolved.rgstDt as string).length).toBeGreaterThan(0);
      expect(typeof unresolved.bidwinnrBizno).toBe("string");
      expect((unresolved.bidwinnrBizno as string).length).toBeGreaterThan(0);
      expect(typeof unresolved.bidwinnrNm).toBe("string");
      expect((unresolved.bidwinnrNm as string).length).toBeGreaterThan(0);

      expect(hasRepresentativeWinnerIdentity([unresolved])).toBe(true);
      expect(hasResolvedFinalAwardDate(unresolved)).toBe(false);

      const resolved = items.find((r) => hasResolvedFinalAwardDate(r));
      expect(resolved).toBeDefined();
    });

    it("exposes only the official award fields", () => {
      const data = loadFixture("award-page.json") as {
        page: { items: Record<string, unknown>[] };
      };
      const allowed = new Set([
        "bidNtceNo",
        "bidNtceOrd",
        "bidClsfcNo",
        "rbidNo",
        "rgstDt",
        "fnlSucsfDate",
        "bidwinnrBizno",
        "bidwinnrNm",
      ]);
      expect(data.page.items.length).toBeGreaterThan(0);
      for (const item of data.page.items) {
        for (const key of Object.keys(item)) {
          expect(allowed.has(key)).toBe(true);
        }
      }
    });

    it("contains items inside the award window", () => {
      const data = loadFixture("award-page.json") as {
        page: { items: { rgstDt: string }[] };
      };
      expect(data.page.items.length).toBeGreaterThan(0);
      for (const it of data.page.items) {
        expect(
          isAwardRegistrationTimestampInWindow(
            it.rgstDt,
            AWARD_BEGIN,
            AWARD_END,
          ),
        ).toBe(true);
      }
    });

    it("projects through the building control allowlist", () => {
      const data = loadFixture("award-page.json");
      expect(() =>
        assertBuildingControlFixtureProjection("award-page.json", data),
      ).not.toThrow();
    });
  });

  describe("award timestamp window pure tests", () => {
    it("accepts an official valid timestamp inside the window", () => {
      expect(
        isAwardRegistrationTimestampInWindow(
          "2026-08-19 12:34:56",
          AWARD_BEGIN,
          AWARD_END,
        ),
      ).toBe(true);
    });

    it("rejects a previous day timestamp", () => {
      expect(
        isAwardRegistrationTimestampInWindow(
          "2026-08-18 23:59:59",
          AWARD_BEGIN,
          AWARD_END,
        ),
      ).toBe(false);
    });

    it("rejects an invalid calendar date 2026-02-30", () => {
      expect(
        isAwardRegistrationTimestampInWindow(
          "2026-02-30 00:00:00",
          AWARD_BEGIN,
          AWARD_END,
        ),
      ).toBe(false);
    });
  });

  describe("designation list fixtures", () => {
    it("valid fixture uses the list envelope (not page)", () => {
      const data = loadFixture("designation-list-valid.json") as {
        schemaVersion: number;
        status: string;
        totalCount: number;
        items: unknown[];
      };
      expect(data.schemaVersion).toBe(1);
      expect(data.totalCount).toBe(data.items.length);
      expect(data.items.length).toBeGreaterThan(0);
    });

    it("valid status equals VALID constant", () => {
      const data = loadFixture("designation-list-valid.json") as {
        status: string;
      };
      expect(data.status).toBe(VALID_STATUS);
    });

    it("expired status equals EXPIRED constant", () => {
      const data = loadFixture("designation-list-expired.json") as {
        status: string;
      };
      expect(data.status).toBe(EXPIRED_STATUS);
    });

    it("extended fixture extends past the original end date", () => {
      const data = loadFixture("designation-list-extended.json") as {
        schemaVersion: number;
        status: string;
        totalCount: number;
        items: { dsgnEndYmd: string; dsgnExtsYmd: string }[];
      };
      expect(data.schemaVersion).toBe(1);
      expect([VALID_STATUS, EXPIRED_STATUS]).toContain(data.status);
      expect(data.totalCount).toBe(data.items.length);
      expect(data.items.length).toBe(1);
      const item = data.items[0];
      expect(item.dsgnEndYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.dsgnExtsYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        hasDesignationExtensionEvidence({
          endDate: item.dsgnEndYmd,
          extensionDate: item.dsgnExtsYmd,
        }),
      ).toBe(true);
    });

    it("each list fixture projects through the allowlist", () => {
      for (const name of [
        "designation-list-valid.json",
        "designation-list-expired.json",
        "designation-list-extended.json",
      ] as const) {
        const data = loadFixture(name);
        expect(() =>
          assertBuildingControlFixtureProjection(name, data),
        ).not.toThrow();
      }
    });
  });

  describe("designation status union pure tests", () => {
    it("accepts the exact status union", () => {
      const statuses = [
        "",
        VALID_STATUS,
        EXPIRED_STATUS,
        SUSPENDED_STATUS,
      ] as const;
      expect(hasExactDesignationStatusUnion(statuses)).toBe(true);
    });

    it("rejects when an extra status is present", () => {
      const statuses = [
        "",
        VALID_STATUS,
        EXPIRED_STATUS,
        SUSPENDED_STATUS,
        "PENDING",
      ] as const;
      expect(hasExactDesignationStatusUnion(statuses)).toBe(false);
    });

    it("rejects when a required status is missing", () => {
      const statuses = [
        VALID_STATUS,
        EXPIRED_STATUS,
        SUSPENDED_STATUS,
      ] as const;
      expect(hasExactDesignationStatusUnion(statuses)).toBe(false);
    });
  });

  describe("designation-detail fixture", () => {
    it("passes sanitizer safety check", () => {
      const data = loadFixture("designation-detail.json");
      expect(() => assertProbeFixtureSafe(data)).not.toThrow();
    });
  });

  describe("shouldPromoteProbeFixtures report shape", () => {
    it("passes when every required check is true", () => {
      const report = {
        version: REPORT_VERSION,
        generatedAt: REPORT_GENERATED_AT,
        passed: true,
        productDiscoveryStrategy: REPORT_STRATEGY,
        checks: makePassingChecks(),
        fixtureSchemaVersion: 1,
        fixtureHashes: makeFixtureHashes(),
      };
      expect(shouldPromoteProbeFixtures(report)).toBe(true);
    });

    it("rejects a report missing fixtureHashes when schema version is set", () => {
      const report = {
        version: REPORT_VERSION,
        generatedAt: REPORT_GENERATED_AT,
        passed: true,
        productDiscoveryStrategy: REPORT_STRATEGY,
        checks: makePassingChecks(),
        fixtureSchemaVersion: 1,
      };
      expect(shouldPromoteProbeFixtures(report)).toBe(false);
    });

    it("rejects a report missing one required fixture hash", () => {
      const fixtureHashes = makeFixtureHashes();
      delete fixtureHashes[SAFE_FIXTURE_FILES[0]];
      const report = {
        version: REPORT_VERSION,
        generatedAt: REPORT_GENERATED_AT,
        passed: true,
        productDiscoveryStrategy: REPORT_STRATEGY,
        checks: makePassingChecks(),
        fixtureSchemaVersion: 1,
        fixtureHashes,
      };
      expect(shouldPromoteProbeFixtures(report)).toBe(false);
    });

    it("fails when a required check is false", () => {
      const checks = makePassingChecks();
      const firstKey = BUILDING_CONTROL_REQUIRED_CHECKS[0];
      checks[firstKey] = false;
      const report = {
        version: REPORT_VERSION,
        generatedAt: REPORT_GENERATED_AT,
        passed: true,
        productDiscoveryStrategy: REPORT_STRATEGY,
        checks,
      };
      expect(shouldPromoteProbeFixtures(report)).toBe(false);
    });

    it("fails when a required check is missing", () => {
      const checks = makePassingChecks();
      delete checks[BUILDING_CONTROL_REQUIRED_CHECKS[1]];
      const report = {
        version: REPORT_VERSION,
        generatedAt: REPORT_GENERATED_AT,
        passed: true,
        productDiscoveryStrategy: REPORT_STRATEGY,
        checks,
      };
      expect(shouldPromoteProbeFixtures(report)).toBe(false);
    });

    it("fails when passed is false", () => {
      const report = {
        version: REPORT_VERSION,
        generatedAt: REPORT_GENERATED_AT,
        passed: false,
        productDiscoveryStrategy: REPORT_STRATEGY,
        checks: makePassingChecks(),
      };
      expect(shouldPromoteProbeFixtures(report)).toBe(false);
    });

    it("fails when productDiscoveryStrategy is not exhaustive_fallback", () => {
      const report = {
        version: REPORT_VERSION,
        generatedAt: REPORT_GENERATED_AT,
        passed: true,
        productDiscoveryStrategy: "server_exact",
        checks: makePassingChecks(),
      };
      expect(shouldPromoteProbeFixtures(report)).toBe(false);
    });

    it("fails on malformed version", () => {
      const report = {
        version: 2,
        generatedAt: REPORT_GENERATED_AT,
        passed: true,
        productDiscoveryStrategy: REPORT_STRATEGY,
        checks: makePassingChecks(),
      };
      expect(shouldPromoteProbeFixtures(report)).toBe(false);
    });
  });

  describe("synthetic projection accept/reject", () => {
    it("accepts award synthetic payload", () => {
      const payload = {
        schemaVersion: 1,
        page: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: [
            {
              bidNtceNo: "n1",
              bidNtceOrd: "1",
              bidClsfcNo: "c1",
              rbidNo: "r1",
              rgstDt: "2026-08-19T10:00:00+09:00",
              fnlSucsfDate: "2026-08-19",
              bidwinnrBizno: "123",
              bidwinnrNm: "x",
            },
          ],
        },
      };
      expect(() =>
        assertBuildingControlFixtureProjection("award-page.json", payload),
      ).not.toThrow();
    });

    it("rejects award payload with unknown keys", () => {
      const payload = {
        schemaVersion: 1,
        page: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: [
            {
              bidNtceNo: "n1",
              bidNtceOrd: "1",
              bidClsfcNo: "c1",
              rbidNo: "r1",
              rgstDt: "2026-08-19T10:00:00+09:00",
              fnlSucsfDate: "2026-08-19",
              bidwinnrBizno: "123",
              bidwinnrNm: "x",
              rogue: "no",
            },
          ],
        },
      };
      expect(() =>
        assertBuildingControlFixtureProjection("award-page.json", payload),
      ).toThrow();
    });

    it("rejects award payload with wrong item cardinality", () => {
      const payload = {
        schemaVersion: 1,
        page: {
          pageNo: 1,
          numOfRows: 2,
          totalCount: 2,
          items: [
            {
              bidNtceNo: "n1",
              bidNtceOrd: "1",
              bidClsfcNo: "c1",
              rbidNo: "r1",
              rgstDt: "2026-08-19T10:00:00+09:00",
              fnlSucsfDate: "2026-08-19",
              bidwinnrBizno: "123",
              bidwinnrNm: "x",
            },
          ],
        },
      };
      expect(() =>
        assertBuildingControlFixtureProjection("award-page.json", payload),
      ).toThrow();
    });

    it("accepts purchase synthetic payload", () => {
      const payload = {
        schemaVersion: 1,
        page: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: [
            {
              bidNtceNo: "n1",
              bidNtceOrd: "1",
              bidClsfcNo: "c1",
              prdctSno: "p1",
              prdctClsfcNo: TARGET_PARENT_CODE,
              dtilPrdctClsfcNo: TARGET_DETAIL_CODE,
            },
          ],
        },
      };
      expect(() =>
        assertBuildingControlFixtureProjection(
          "purchase-target-page.json",
          payload,
        ),
      ).not.toThrow();
    });

    it("rejects purchase payload with unknown keys", () => {
      const payload = {
        schemaVersion: 1,
        page: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: [
            {
              bidNtceNo: "n1",
              bidNtceOrd: "1",
              bidClsfcNo: "c1",
              prdctSno: "p1",
              prdctClsfcNo: TARGET_PARENT_CODE,
              dtilPrdctClsfcNo: TARGET_DETAIL_CODE,
              rogue: "no",
            },
          ],
        },
      };
      expect(() =>
        assertBuildingControlFixtureProjection(
          "purchase-target-page.json",
          payload,
        ),
      ).toThrow();
    });

    it("rejects purchase payload with wrong item cardinality", () => {
      const payload = {
        schemaVersion: 1,
        page: {
          pageNo: 1,
          numOfRows: 1,
          totalCount: 1,
          items: [],
        },
      };
      expect(() =>
        assertBuildingControlFixtureProjection(
          "purchase-target-page.json",
          payload,
        ),
      ).toThrow();
    });
  });

  describe("sanitizer guards", () => {
    it("rejects payloads with credential shapes", () => {
      expect(() => assertProbeFixtureSafe({ apiKey: "secret" })).toThrow();
    });

    it("rejects payloads containing PII shapes", () => {
      expect(() =>
        assertProbeFixtureSafe({
          schemaVersion: 1,
          page: {
            pageNo: 1,
            numOfRows: 1,
            totalCount: 1,
            items: [{ email: "x@y.z" }],
          },
        }),
      ).toThrow();
    });
  });
});
