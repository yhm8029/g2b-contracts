export const BUILDING_CONTROL_REQUIRED_CHECKS = [
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

export type BuildingControlRequiredCheckName =
  (typeof BUILDING_CONTROL_REQUIRED_CHECKS)[number];

export const BUILDING_CONTROL_PRODUCT_DISCOVERY_STRATEGIES = [
  "server_exact",
  "exhaustive_fallback",
] as const;

export type BuildingControlProductDiscoveryStrategy =
  (typeof BUILDING_CONTROL_PRODUCT_DISCOVERY_STRATEGIES)[number];

export type BuildingControlApiContractChecks = Readonly<
  Record<BuildingControlRequiredCheckName, boolean> & Record<string, boolean>
>;

export type BuildingControlApiContractReport = {
  readonly version: 1;
  readonly generatedAt: string;
  readonly passed: boolean;
  readonly productDiscoveryStrategy: BuildingControlProductDiscoveryStrategy;
  readonly checks: BuildingControlApiContractChecks;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrictBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return false;
  }
  const isoPattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
  return isoPattern.test(value);
}

export function parseApiContractReport(
  input: unknown,
): BuildingControlApiContractReport {
  if (!isPlainObject(input)) {
    throw new TypeError("API contract report must be an object");
  }

  if (input["version"] !== 1) {
    throw new TypeError("API contract report version must be exactly 1");
  }

  const generatedAt = input["generatedAt"];
  if (!isIsoTimestamp(generatedAt)) {
    throw new TypeError(
      "API contract report generatedAt must be an ISO timestamp string",
    );
  }

  const passedRaw = input["passed"];
  if (!isStrictBoolean(passedRaw)) {
    throw new TypeError("API contract report passed must be a boolean");
  }

  const strategyRaw = input["productDiscoveryStrategy"];
  if (typeof strategyRaw !== "string") {
    throw new TypeError(
      "API contract report productDiscoveryStrategy must be a string",
    );
  }
  if (
    !BUILDING_CONTROL_PRODUCT_DISCOVERY_STRATEGIES.includes(
      strategyRaw as BuildingControlProductDiscoveryStrategy,
    )
  ) {
    throw new TypeError(`Unsupported productDiscoveryStrategy: ${strategyRaw}`);
  }
  const strategy = strategyRaw as BuildingControlProductDiscoveryStrategy;

  const checksRaw = input["checks"];
  if (!isPlainObject(checksRaw)) {
    throw new TypeError("API contract report checks must be an object");
  }

  const normalizedChecks: Record<string, boolean> = {};
  let allRequiredPass = true;
  for (const check of BUILDING_CONTROL_REQUIRED_CHECKS) {
    const raw = checksRaw[check];
    const normalized = isStrictBoolean(raw) ? raw : false;
    normalizedChecks[check] = normalized;
    if (!normalized) {
      allRequiredPass = false;
    }
  }

  for (const [key, value] of Object.entries(checksRaw)) {
    if ((BUILDING_CONTROL_REQUIRED_CHECKS as readonly string[]).includes(key)) {
      continue;
    }
    if (isStrictBoolean(value)) {
      normalizedChecks[key] = value;
    }
  }

  const derivedPassed = allRequiredPass;

  void passedRaw;

  return Object.freeze({
    version: 1,
    generatedAt,
    passed: derivedPassed,
    productDiscoveryStrategy: strategy,
    checks: Object.freeze(normalizedChecks) as BuildingControlApiContractChecks,
  });
}
