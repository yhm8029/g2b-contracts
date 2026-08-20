import { describe, expect, it } from "vitest";

import {
  BUILDING_CONTROL_REQUIRED_CHECKS,
  parseApiContractReport,
} from "@/lib/building-control/api-contract";
import {
  parseG2bPage,
  validateCollectedPages,
  compareIdentitySets,
  sanitizeProbeFixture,
  assertProbeFixtureSafe,
} from "@/lib/building-control/api-contract-probe";

const REQUIRED_CHECKS = [
  "noticePagination",
  "purchaseTargetPagination",
  "productFieldPrecedence",
  "productDiscoveryStrategyProven",
  "awardRegistrationWindow",
  "awardFourPartIdentity",
  "terminalRebid",
  "representativeWinner",
  "designationValid",
  "designationExpired",
  "designationExtended",
  "designationStatusUnion",
] as const;

type RawApiContractInput = {
  version: 1;
  generatedAt: string;
  passed: boolean;
  productDiscoveryStrategy: "server_exact" | "exhaustive_fallback";
  checks: Record<string, boolean>;
};

function requiredChecks(
  overrides: Partial<Record<string, boolean>> = {},
): Record<string, boolean> {
  const checks: Record<string, boolean> = {};
  for (const check of REQUIRED_CHECKS) {
    checks[check] = true;
  }
  for (const [check, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      checks[check] = value;
    }
  }
  return checks;
}

function makeReport(
  overrides: Partial<RawApiContractInput> = {},
): RawApiContractInput {
  return {
    version: 1,
    generatedAt: "2026-08-20T00:00:00.000Z",
    passed: true,
    productDiscoveryStrategy: "server_exact",
    ...overrides,
    checks: overrides.checks ?? requiredChecks(),
  };
}

function makeRawReport(
  overrides: {
    version?: unknown;
    generatedAt?: unknown;
    passed?: unknown;
    productDiscoveryStrategy?: unknown;
    checks?: unknown;
  } = {},
): Record<string, unknown> {
  return {
    version: 1,
    generatedAt: "2026-08-20T00:00:00.000Z",
    passed: true,
    productDiscoveryStrategy: "server_exact",
    checks: requiredChecks(),
    ...overrides,
  };
}

describe("building control API contract report parser", () => {
  it("exports required checks in exact tuple order", () => {
    expect(BUILDING_CONTROL_REQUIRED_CHECKS).toEqual(REQUIRED_CHECKS);
  });

  it("accepts all required checks as true with server_exact strategy", () => {
    const parsed = parseApiContractReport(makeReport());
    expect(parsed.passed).toBe(true);
  });

  it("accepts all required checks as true with exhaustive_fallback strategy", () => {
    const parsed = parseApiContractReport(
      makeReport({ productDiscoveryStrategy: "exhaustive_fallback" }),
    );
    expect(parsed.passed).toBe(true);
  });

  it.each(REQUIRED_CHECKS)(
    "sets passed false when required check %s is false",
    (requiredCheck) => {
      const parsed = parseApiContractReport(
        makeReport({ checks: requiredChecks({ [requiredCheck]: false }) }),
      );
      expect(parsed.passed).toBe(false);
      expect(parsed.checks[requiredCheck]).toBe(false);
    },
  );

  it.each(REQUIRED_CHECKS)(
    "normalizes missing required check %s to false and marks passed false",
    (requiredCheck) => {
      const checks = requiredChecks();
      delete checks[requiredCheck];
      const parsed = parseApiContractReport(makeReport({ checks }));
      expect(parsed.passed).toBe(false);
      expect(parsed.checks[requiredCheck]).toBe(false);
    },
  );

  it.each(REQUIRED_CHECKS)(
    "does not pass when required check %s is a truthy non-boolean",
    (requiredCheck) => {
      const checks: Record<string, unknown> = requiredChecks();
      checks[requiredCheck] = "truthy";
      const parsed = parseApiContractReport(makeRawReport({ checks }));
      expect(parsed.passed).toBe(false);
      expect(parsed.checks[requiredCheck]).toBe(false);
    },
  );

  it("throws when strategy is unsupported even if productDiscoveryStrategyProven is true", () => {
    expect(() =>
      parseApiContractReport(
        makeRawReport({
          productDiscoveryStrategy: "unsupported_strategy",
        }),
      ),
    ).toThrow();
  });

  it("forces passed false when productDiscoveryStrategyProven is false", () => {
    const parsed = parseApiContractReport(
      makeReport({
        checks: requiredChecks({ productDiscoveryStrategyProven: false }),
      }),
    );
    expect(parsed.passed).toBe(false);
    expect(parsed.checks.productDiscoveryStrategyProven).toBe(false);
  });

  it("throws for non-object input", () => {
    const nonObjectInput: unknown = "not-an-object";
    expect(() => parseApiContractReport(nonObjectInput)).toThrow();
  });

  it("throws when checks is non-object", () => {
    expect(() =>
      parseApiContractReport(
        makeRawReport({
          checks: "not-an-object-checks",
        }),
      ),
    ).toThrow();
  });
});

describe("building control API contract probe parser", () => {
  it("parses page metadata from a G2B response envelope", () => {
    const parsed = parseG2bPage(
      {
        response: {
          header: {
            resultCode: "00",
            resultMsg: "NORMAL SERVICE.",
          },
          body: {
            pageNo: "3",
            numOfRows: "10",
            totalCount: "21",
            items: [
              {
                bidClsfcNo: "39121801",
                prdctClsfcNo: "39121801",
                dtilPrdctClsfcNo: "3912180101",
              },
            ],
          },
        },
      },
      3,
    );

    expect(parsed.pageNo).toBe(3);
    expect(parsed.numOfRows).toBe(10);
    expect(parsed.totalCount).toBe(21);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      bidClsfcNo: "39121801",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: "3912180101",
    });
  });

  it("parses wrapper item arrays from response.body.items.item", () => {
    const parsed = parseG2bPage(
      {
        response: {
          header: {
            resultCode: "00",
            resultMsg: "NORMAL SERVICE.",
          },
          body: {
            pageNo: "2",
            numOfRows: "2",
            totalCount: "4",
            items: {
              item: [
                {
                  bidNtceNo: "NTCE-100",
                  bidwinnrBizno: "110-11-11111",
                },
                {
                  bidNtceNo: "NTCE-101",
                  bidwinnrBizno: "110-11-22222",
                },
              ],
            },
          },
        },
      },
      2,
    );

    expect(parsed.pageNo).toBe(2);
    expect(parsed.numOfRows).toBe(2);
    expect(parsed.totalCount).toBe(4);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({
      bidNtceNo: "NTCE-100",
      bidwinnrBizno: "110-11-11111",
    });
    expect(parsed.items[1]).toMatchObject({
      bidNtceNo: "NTCE-101",
      bidwinnrBizno: "110-11-22222",
    });
  });

  it("normalizes singleton wrapper item objects at response.body.items.item", () => {
    const parsed = parseG2bPage(
      {
        response: {
          header: {
            resultCode: "00",
            resultMsg: "NORMAL SERVICE.",
          },
          body: {
            pageNo: "1",
            numOfRows: "3",
            totalCount: "1",
            items: {
              item: {
                bidNtceNo: "NTCE-200",
                bidwinnrBizno: "110-11-33333",
                status: "open",
              },
            },
          },
        },
      },
      1,
    );

    expect(parsed.pageNo).toBe(1);
    expect(parsed.numOfRows).toBe(3);
    expect(parsed.totalCount).toBe(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      bidNtceNo: "NTCE-200",
      bidwinnrBizno: "110-11-33333",
      status: "open",
    });
  });

  it("parses wrapper item null as empty list when totalCount is 0", () => {
    const parsed = parseG2bPage(
      {
        response: {
          header: {
            resultCode: "00",
            resultMsg: "NORMAL SERVICE.",
          },
          body: {
            pageNo: "1",
            numOfRows: "10",
            totalCount: "0",
            items: {
              item: null,
            },
          },
        },
      },
      1,
    );

    expect(parsed.pageNo).toBe(1);
    expect(parsed.numOfRows).toBe(10);
    expect(parsed.totalCount).toBe(0);
    expect(parsed.items).toHaveLength(0);
  });

  it("flattens collected pages for a full pagination range", () => {
    const pages = [
      parseG2bPage(
        {
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
            body: {
              pageNo: "1",
              numOfRows: "2",
              totalCount: "5",
              items: [{ identity: "A-01" }, { identity: "A-02" }],
            },
          },
        },
        1,
      ),
      parseG2bPage(
        {
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
            body: {
              pageNo: "2",
              numOfRows: "2",
              totalCount: "5",
              items: [{ identity: "A-03" }, { identity: "A-04" }],
            },
          },
        },
        2,
      ),
      parseG2bPage(
        {
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
            body: {
              pageNo: "3",
              numOfRows: "2",
              totalCount: "5",
              items: [{ identity: "A-05" }],
            },
          },
        },
        3,
      ),
    ] as const;

    expect(validateCollectedPages(pages)).toEqual([
      { identity: "A-01" },
      { identity: "A-02" },
      { identity: "A-03" },
      { identity: "A-04" },
      { identity: "A-05" },
    ]);
  });

  it("rejects collected pages when totalCount drifts", () => {
    expect(() =>
      validateCollectedPages([
        parseG2bPage(
          {
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: {
                pageNo: "1",
                numOfRows: "2",
                totalCount: "5",
                items: [{ identity: "B-01" }, { identity: "B-02" }],
              },
            },
          },
          1,
        ),
        parseG2bPage(
          {
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: {
                pageNo: "2",
                numOfRows: "2",
                totalCount: "4",
                items: [{ identity: "B-03" }, { identity: "B-04" }],
              },
            },
          },
          2,
        ),
      ]),
    ).toThrow();
  });

  it("rejects collected pages when numOfRows drifts", () => {
    expect(() =>
      validateCollectedPages([
        parseG2bPage(
          {
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: {
                pageNo: "1",
                numOfRows: "2",
                totalCount: "4",
                items: [{ identity: "C-01" }, { identity: "C-02" }],
              },
            },
          },
          1,
        ),
        parseG2bPage(
          {
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: {
                pageNo: "2",
                numOfRows: "3",
                totalCount: "4",
                items: [{ identity: "C-03" }, { identity: "C-04" }],
              },
            },
          },
          2,
        ),
      ]),
    ).toThrow();
  });

  it("rejects missing or out-of-sequence collected pages", () => {
    expect(() =>
      validateCollectedPages([
        parseG2bPage(
          {
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: {
                pageNo: "1",
                numOfRows: "2",
                totalCount: "4",
                items: [{ identity: "D-01" }, { identity: "D-02" }],
              },
            },
          },
          1,
        ),
        parseG2bPage(
          {
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: {
                pageNo: "3",
                numOfRows: "2",
                totalCount: "4",
                items: [],
              },
            },
          },
          3,
        ),
      ]),
    ).toThrow();
  });

  it("rejects collected pages when accumulated item count differs from totalCount", () => {
    const thirdPage = parseG2bPage(
      {
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: {
            pageNo: "3",
            numOfRows: "2",
            totalCount: "5",
            items: [{ identity: "E-05" }],
          },
        },
      },
      3,
    );
    const shortThirdPage = { ...thirdPage, items: [] } as typeof thirdPage;

    expect(() =>
      validateCollectedPages([
        parseG2bPage(
          {
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: {
                pageNo: "1",
                numOfRows: "2",
                totalCount: "5",
                items: [{ identity: "E-01" }, { identity: "E-02" }],
              },
            },
          },
          1,
        ),
        parseG2bPage(
          {
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: {
                pageNo: "2",
                numOfRows: "2",
                totalCount: "5",
                items: [{ identity: "E-03" }, { identity: "E-04" }],
              },
            },
          },
          2,
        ),
        shortThirdPage,
      ]),
    ).toThrow();
  });

  it("normalizes singleton item objects and parses pagination metadata", () => {
    const parsed = parseG2bPage(
      {
        response: {
          header: {
            resultCode: "00",
            resultMsg: "NORMAL SERVICE.",
          },
          body: {
            pageNo: "3",
            numOfRows: "10",
            totalCount: "21",
            items: {
              bidNtceNo: "NTCE-001",
              bidNtceOrd: "001",
              bidClsfcNo: "39121801",
              rbidNo: "RB-001",
              prdctClsfcNo: "39121801",
              dtilPrdctClsfcNo: "3912180101",
              status: "open",
              isSuccessfulBid: true,
            },
          },
        },
      },
      3,
    );

    expect(parsed.pageNo).toBe(3);
    expect(parsed.numOfRows).toBe(10);
    expect(parsed.totalCount).toBe(21);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      bidNtceNo: "NTCE-001",
      bidNtceOrd: "001",
      bidClsfcNo: "39121801",
      rbidNo: "RB-001",
      prdctClsfcNo: "39121801",
      dtilPrdctClsfcNo: "3912180101",
      status: "open",
      isSuccessfulBid: true,
    });
  });

  it("parses empty result pages when totalCount is 0", () => {
    const parsed = parseG2bPage(
      {
        response: {
          header: {
            resultCode: "00",
            resultMsg: "NORMAL SERVICE.",
          },
          body: {
            pageNo: "1",
            numOfRows: "20",
            totalCount: "0",
            items: [],
          },
        },
      },
      1,
    );

    expect(parsed.totalCount).toBe(0);
    expect(parsed.items).toHaveLength(0);
  });

  it.each(["01", "ER", "XX"])(
    "rejects non-success resultCode %s",
    (resultCode) => {
      expect(() =>
        parseG2bPage(
          {
            response: {
              header: {
                resultCode,
                resultMsg: "FAILED SERVICE.",
              },
              body: {
                pageNo: "1",
                numOfRows: "10",
                totalCount: "0",
                items: [],
              },
            },
          },
          1,
        ),
      ).toThrow();
    },
  );

  it.each(["-1", "1.5", "not-a-number"])(
    "rejects invalid totalCount %s",
    (totalCount) => {
      expect(() =>
        parseG2bPage(
          {
            response: {
              header: {
                resultCode: "00",
                resultMsg: "NORMAL SERVICE.",
              },
              body: {
                pageNo: "1",
                numOfRows: "10",
                totalCount,
                items: [],
              },
            },
          },
          1,
        ),
      ).toThrow();
    },
  );

  it("rejects page number mismatches from provider payload", () => {
    expect(() =>
      parseG2bPage(
        {
          response: {
            header: {
              resultCode: "00",
              resultMsg: "NORMAL SERVICE.",
            },
            body: {
              pageNo: "2",
              numOfRows: "10",
              totalCount: "1",
              items: [],
            },
          },
        },
        3,
      ),
    ).toThrow();
  });

  it("rejects when items array length exceeds numOfRows", () => {
    expect(() =>
      parseG2bPage(
        {
          response: {
            header: {
              resultCode: "00",
              resultMsg: "NORMAL SERVICE.",
            },
            body: {
              pageNo: "1",
              numOfRows: "1",
              totalCount: "2",
              items: [
                {
                  bidNtceNo: "NTCE-001",
                  bidNtceOrd: "001",
                  bidClsfcNo: "39121801",
                  prdctClsfcNo: "39121801",
                  dtilPrdctClsfcNo: "3912180101",
                },
                {
                  bidNtceNo: "NTCE-002",
                  bidNtceOrd: "001",
                  bidClsfcNo: "39121802",
                  prdctClsfcNo: "39121802",
                  dtilPrdctClsfcNo: "3912180201",
                },
              ],
            },
          },
        },
        1,
      ),
    ).toThrow();
  });
});

describe("building control API contract probe identity helpers", () => {
  it("computes missingFromServer and extraOnServer in the required direction", () => {
    const result = compareIdentitySets([111, 222, 333], [333, 444]);
    expect(result.missingFromServer).toEqual([444]);
    expect(result.extraOnServer).toEqual([111, 222]);
  });

  it("returns empty deltas for equal identity sets", () => {
    const result = compareIdentitySets(["A", "B", "C"], ["A", "B", "C"]);
    expect(result.missingFromServer).toEqual([]);
    expect(result.extraOnServer).toEqual([]);
  });

  it("returns lexically sorted set differences for unordered input", () => {
    const result = compareIdentitySets(
      ["z", "a", "x", "m"],
      ["d", "a", "x", "y"],
    );
    expect(result.missingFromServer).toEqual(["d", "y"]);
    expect(result.extraOnServer).toEqual(["m", "z"]);
  });
});

describe("building control API contract probe fixture sanitizer", () => {
  it("preserves source-grain/product fields and sanitizes real PII consistently", () => {
    const unsafeFixture = {
      response: {
        header: {
          resultCode: "00",
          resultMsg: "NORMAL SERVICE.",
        },
        body: {
          pageNo: 1,
          numOfRows: 2,
          totalCount: 2,
          items: [
            {
              bidClsfcNo: "39121801",
              prdctClsfcNo: "39121801",
              dtilPrdctClsfcNo: "3912180101",
              bidwinnrBizno: "110-11-11111",
              bzmnRegNo: "110-11-11111",
              bidwinnrNm: "Alpha Cooperative",
              entNm: "Alpha Cooperative",
              bidwinnrCeoNm: "Director Alpha",
            },
            {
              bidClsfcNo: "39121802",
              prdctClsfcNo: "39121802",
              dtilPrdctClsfcNo: "3912180201",
              bidwinnrBizno: "222-22-22222",
              bzmnRegNo: "222-22-22222",
              bidwinnrNm: "Beta Limited",
              entNm: "Beta Limited",
              bidwinnrCeoNm: "Director Beta",
            },
          ],
        },
      },
    };

    const sanitizedFixture = sanitizeProbeFixture(unsafeFixture) as {
      response: {
        body: {
          items: Array<Record<string, string>>;
        };
      };
    };

    const first = sanitizedFixture.response.body.items[0];
    const second = sanitizedFixture.response.body.items[1];

    expect(first.bidClsfcNo).toBe("39121801");
    expect(first.prdctClsfcNo).toBe("39121801");
    expect(first.dtilPrdctClsfcNo).toBe("3912180101");
    expect(second.bidClsfcNo).toBe("39121802");
    expect(second.prdctClsfcNo).toBe("39121802");
    expect(second.dtilPrdctClsfcNo).toBe("3912180201");

    expect(first.bidwinnrBizno).toBe(first.bzmnRegNo);
    expect(first.bidwinnrNm).toBe(first.entNm);
    expect(second.bidwinnrBizno).toBe(second.bzmnRegNo);
    expect(second.bidwinnrNm).toBe(second.entNm);

    expect(first.bidwinnrBizno).not.toBe(second.bidwinnrBizno);
    expect(first.bidwinnrNm).not.toBe(second.bidwinnrNm);
    expect(first.bidwinnrCeoNm).not.toBe(second.bidwinnrCeoNm);

    expect(() => assertProbeFixtureSafe(sanitizedFixture)).not.toThrow();
    expect(() => assertProbeFixtureSafe(unsafeFixture)).toThrow();
  });

  it("supports twelve distinct business identities with safe synthetic outputs", () => {
    const unsafeFixture = {
      response: {
        header: {
          resultCode: "00",
          resultMsg: "NORMAL SERVICE.",
        },
        body: {
          pageNo: 1,
          numOfRows: 12,
          totalCount: 12,
          items: Array.from({ length: 12 }, (_item, index) => {
            const id = String(index + 1).padStart(2, "0");
            return {
              bidwinnrBizno: `100-00-${id}111`,
              bzmnRegNo: `100-00-${id}111`,
              bidwinnrNm: `Identity ${id} Co`,
              entNm: `Identity ${id} Co`,
              bidwinnrCeoNm: `Identity ${id} CEO`,
            };
          }),
        },
      },
    };

    const sanitizedFixture = sanitizeProbeFixture(unsafeFixture) as {
      response: {
        body: {
          items: Array<Record<string, string>>;
        };
      };
    };

    const items = sanitizedFixture.response.body.items;
    const businessIds = items.map((item) => item.bidwinnrBizno);
    const companies = items.map((item) => item.bidwinnrNm);
    const people = items.map((item) => item.bidwinnrCeoNm);

    expect(new Set(businessIds).size).toBe(12);
    expect(new Set(companies).size).toBe(12);
    expect(new Set(people).size).toBe(12);

    for (const item of items) {
      expect(item.bidwinnrBizno).toBe(item.bzmnRegNo);
      expect(item.bidwinnrNm).toBe(item.entNm);
    }

    expect(() => assertProbeFixtureSafe(sanitizedFixture)).not.toThrow();
  });

  it("maps shared business identities consistently across child fixtures in one sanitize run", () => {
    const unsafeBundle = {
      childFixtures: [
        {
          response: {
            header: {
              resultCode: "00",
              resultMsg: "NORMAL SERVICE.",
            },
            body: {
              pageNo: 1,
              numOfRows: 1,
              totalCount: 1,
              items: [
                {
                  bidwinnrBizno: "111-11-11111",
                  bzmnRegNo: "111-11-11111",
                  bidwinnrNm: "Alpha Co",
                  entNm: "Alpha Co",
                  bidwinnrCeoNm: "Alice Alpha",
                },
              ],
            },
          },
        },
        {
          response: {
            header: {
              resultCode: "00",
              resultMsg: "NORMAL SERVICE.",
            },
            body: {
              pageNo: 1,
              numOfRows: 1,
              totalCount: 1,
              items: [
                {
                  bidwinnrBizno: "111-11-11111",
                  bzmnRegNo: "111-11-11111",
                  bidwinnrNm: "Alpha Co",
                  entNm: "Alpha Co",
                  bidwinnrCeoNm: "Alice Alpha",
                },
              ],
            },
          },
        },
        {
          response: {
            header: {
              resultCode: "00",
              resultMsg: "NORMAL SERVICE.",
            },
            body: {
              pageNo: 1,
              numOfRows: 1,
              totalCount: 1,
              items: [
                {
                  bidwinnrBizno: "222-22-22222",
                  bzmnRegNo: "222-22-22222",
                  bidwinnrNm: "Beta Co",
                  entNm: "Beta Co",
                  bidwinnrCeoNm: "Ben Beta",
                },
              ],
            },
          },
        },
      ],
    };

    const sanitizedBundle = sanitizeProbeFixture(unsafeBundle) as {
      childFixtures: Array<{
        response: {
          body: {
            items: Array<Record<string, string>>;
          };
        };
      }>;
    };

    const sameBusinessOne =
      sanitizedBundle.childFixtures[0].response.body.items[0];
    const sameBusinessTwo =
      sanitizedBundle.childFixtures[1].response.body.items[0];
    const differentBusiness =
      sanitizedBundle.childFixtures[2].response.body.items[0];

    expect(sameBusinessOne.bidwinnrBizno).toBe(sameBusinessTwo.bidwinnrBizno);
    expect(sameBusinessOne.bidwinnrNm).toBe(sameBusinessTwo.bidwinnrNm);
    expect(sameBusinessOne.bidwinnrCeoNm).toBe(sameBusinessTwo.bidwinnrCeoNm);

    expect(sameBusinessOne.bidwinnrBizno).not.toBe(
      differentBusiness.bidwinnrBizno,
    );
    expect(sameBusinessOne.bidwinnrNm).not.toBe(differentBusiness.bidwinnrNm);
    expect(sameBusinessOne.bidwinnrCeoNm).not.toBe(
      differentBusiness.bidwinnrCeoNm,
    );

    expect(() => assertProbeFixtureSafe(sanitizedBundle)).not.toThrow();
  });

  it("removes credential-bearing request context and sanitizes repeated synthetic identifiers", () => {
    const unsafeFixture = {
      request: {
        serviceKey: "SERVICE_KEY_VALUE",
        authorization: "Bearer SECRET_TOKEN",
        cookie: "SESSION=SECRET_TOKEN",
        setCookie: "COOKIE=SECRET_TOKEN",
        url: "https://example.test/api?serviceKey=SERVICE_KEY_VALUE&authorization=Bearer%20SECRET_TOKEN&etpmDsgnDmndNo=REQ-SYNTHETIC-001",
      },
      rawRequestIdentity: "https://example.test/identity/NTCE-RAW",
      response: {
        header: {
          resultCode: "00",
          resultMsg: "NORMAL SERVICE.",
        },
        body: {
          pageNo: "1",
          numOfRows: "2",
          totalCount: "2",
          items: [
            {
              bidNtceNo: "NTCE-001",
              bidNtceOrd: "001",
              bidClsfcNo: "39121801",
              rbidNo: "RB-001",
              prdctClsfcNo: "39121801",
              dtilPrdctClsfcNo: "3912180101",
              etpmDsgnDmndNo: "REQ-SYNTHETIC-REPEATED",
              status: "OPEN",
              bidNtceDate: "2026-01-01T00:00:00.000Z",
              isActive: true,
              isDomestic: false,
            },
            {
              bidNtceNo: "NTCE-002",
              bidNtceOrd: "002",
              bidClsfcNo: "39121802",
              rbidNo: "RB-002",
              prdctClsfcNo: "39121802",
              dtilPrdctClsfcNo: "3912180201",
              etpmDsgnDmndNo: "REQ-SYNTHETIC-REPEATED",
              status: "CLOSED",
              bidNtceDate: "2026-01-02T00:00:00.000Z",
              isActive: false,
              isDomestic: false,
            },
          ],
        },
      },
    };

    const sanitizedFixture = sanitizeProbeFixture(unsafeFixture) as {
      request?: {
        serviceKey?: string;
        authorization?: string;
        cookie?: string;
        setCookie?: string;
        url?: string;
      };
      response: {
        body: {
          items: Array<Record<string, unknown>>;
        };
      };
    };

    const first = sanitizedFixture.response.body.items[0];
    const second = sanitizedFixture.response.body.items[1];

    expect(sanitizedFixture.request?.serviceKey).toBeUndefined();
    expect(sanitizedFixture.request?.authorization).toBeUndefined();
    expect(sanitizedFixture.request?.cookie).toBeUndefined();
    expect(sanitizedFixture.request?.setCookie).toBeUndefined();
    expect(sanitizedFixture.request?.url).toBeDefined();
    expect(sanitizedFixture.request?.url).not.toMatch(
      /SECRET_TOKEN|SERVICE_KEY_VALUE/,
    );

    expect(first.bidNtceNo).toBe("NTCE-001");
    expect(first.bidNtceOrd).toBe("001");
    expect(first.bidClsfcNo).toBe("39121801");
    expect(first.rbidNo).toBe("RB-001");
    expect(first.prdctClsfcNo).toBe("39121801");
    expect(first.dtilPrdctClsfcNo).toBe("3912180101");
    expect(first.status).toBe("OPEN");
    expect(first.bidNtceDate).toBe("2026-01-01T00:00:00.000Z");
    expect(first.isActive).toBe(true);
    expect(first.isDomestic).toBe(false);

    expect(second.bidNtceNo).toBe("NTCE-002");
    expect(second.bidNtceOrd).toBe("002");
    expect(second.bidClsfcNo).toBe("39121802");
    expect(second.rbidNo).toBe("RB-002");
    expect(second.prdctClsfcNo).toBe("39121802");
    expect(second.dtilPrdctClsfcNo).toBe("3912180201");
    expect(second.status).toBe("CLOSED");
    expect(second.bidNtceDate).toBe("2026-01-02T00:00:00.000Z");
    expect(second.isActive).toBe(false);
    expect(second.isDomestic).toBe(false);

    expect(first.etpmDsgnDmndNo).toBeDefined();
    expect(second.etpmDsgnDmndNo).toBe(first.etpmDsgnDmndNo);
    expect(String(first.etpmDsgnDmndNo)).not.toBe("REQ-SYNTHETIC-REPEATED");

    const rawJson = JSON.stringify(sanitizedFixture);
    expect(rawJson).not.toContain("NTCE-RAW");
    expect(rawJson).not.toContain("rawRequestIdentity");
    expect(rawJson).not.toContain("SECRET_SENTINEL");
    expect(rawJson).not.toContain("SERVICE_KEY_VALUE");
    expect(rawJson).not.toContain("Bearer SECRET_TOKEN");
    expect(rawJson).not.toContain("SESSION=SECRET_TOKEN");
    expect(() => assertProbeFixtureSafe(sanitizedFixture)).not.toThrow();
  });
});

describe("building control API contract probe safety checks", () => {
  it("rejects credential-bearing request key serviceKey", () => {
    expect(() =>
      assertProbeFixtureSafe({
        request: { serviceKey: "SERVICE_KEY_VALUE" },
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: {
            pageNo: 1,
            numOfRows: 1,
            totalCount: 1,
            items: [],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects raw credential URL in request context", () => {
    expect(() =>
      assertProbeFixtureSafe({
        request: {
          url: "https://example.test/api?serviceKey=SERVICE_KEY_VALUE&authorization=SECRET_TOKEN",
        },
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: {
            pageNo: 1,
            numOfRows: 1,
            totalCount: 1,
            items: [],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects fixtures containing SECRET_SENTINEL", () => {
    expect(() =>
      assertProbeFixtureSafe({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: {
            pageNo: 1,
            numOfRows: 1,
            totalCount: 1,
            items: [
              {
                bidNtceNo: "SECRET_SENTINEL",
              },
            ],
          },
        },
      }),
    ).toThrow();
  });
});
