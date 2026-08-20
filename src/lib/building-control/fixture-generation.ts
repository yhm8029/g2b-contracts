import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { assertProbeFixtureSafe } from "./api-contract-probe";
import { assertBuildingControlFixtureProjection } from "./probe-contract-guards";

export const ACTIVE_FIXTURE_FILES = [
  "notice-page.json",
  "purchase-target-page.json",
  "award-page.json",
  "designation-list-valid.json",
  "designation-list-expired.json",
  "designation-list-extended.json",
  "designation-detail.json",
] as const;

export type ActiveFixtureName = (typeof ACTIVE_FIXTURE_FILES)[number];

export type ActiveFixtureGenerationManifest = {
  readonly version: 1;
  readonly generationId: string;
  readonly fixtureSchemaVersion: 1;
  readonly fixtureHashes: Readonly<Record<ActiveFixtureName, string>>;
};

const HEX_64 = /^[0-9a-f]{64}$/;

function fail(message: string): never {
  throw new Error(`active fixture generation: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateHashes(value: unknown): Record<ActiveFixtureName, string> {
  if (!isPlainObject(value)) {
    fail("fixtureHashes must be an object");
  }
  const seen = new Set<string>();
  for (const name of ACTIVE_FIXTURE_FILES) {
    seen.add(name);
    if (!(name in value)) {
      fail(`fixtureHashes missing key ${name}`);
    }
    const entry = value[name];
    if (typeof entry !== "string" || !HEX_64.test(entry)) {
      fail(`fixtureHashes.${name} must be lowercase 64-char hex`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!seen.has(key)) {
      fail(`fixtureHashes has unexpected key ${key}`);
    }
  }
  const result = {} as Record<ActiveFixtureName, string>;
  for (const name of ACTIVE_FIXTURE_FILES) {
    result[name] = value[name] as string;
  }
  return result;
}

function validateManifest(raw: unknown): ActiveFixtureGenerationManifest {
  if (!isPlainObject(raw)) {
    fail("manifest must be a plain object");
  }
  const allowed = new Set([
    "version",
    "generationId",
    "fixtureSchemaVersion",
    "fixtureHashes",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      fail(`manifest has unexpected key ${key}`);
    }
  }
  if (raw.version !== 1) {
    fail("version must be 1");
  }
  if (typeof raw.generationId !== "string" || !HEX_64.test(raw.generationId)) {
    fail("generationId must be lowercase 64-char hex");
  }
  if (raw.fixtureSchemaVersion !== 1) {
    fail("fixtureSchemaVersion must be 1");
  }
  const hashes = validateHashes(raw.fixtureHashes);
  return Object.freeze({
    version: 1,
    generationId: raw.generationId,
    fixtureSchemaVersion: 1,
    fixtureHashes: Object.freeze(hashes),
  });
}

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function loadActiveFixtureGeneration(committedRoot: string): {
  manifest: ActiveFixtureGenerationManifest;
  bundle: Record<ActiveFixtureName, unknown>;
} {
  const manifestPath = join(committedRoot, "active-generation.json");
  const manifestRaw = readFileSync(manifestPath, "utf8");
  const manifestParsed: unknown = JSON.parse(manifestRaw);
  const manifest = validateManifest(manifestParsed);

  const generationDir = join(
    committedRoot,
    "generations",
    manifest.generationId,
  );
  const entries = readdirSync(generationDir, { withFileTypes: true });
  if (entries.length !== ACTIVE_FIXTURE_FILES.length) {
    fail(
      `generation directory must contain exactly ${ACTIVE_FIXTURE_FILES.length} entries`,
    );
  }
  const allowedNames = new Set<string>(ACTIVE_FIXTURE_FILES);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile()) {
      fail(`generation directory entry ${entry.name} is not a regular file`);
    }
    if (!allowedNames.has(entry.name)) {
      fail(`generation directory has unexpected entry ${entry.name}`);
    }
    if (seen.has(entry.name)) {
      fail(`generation directory has duplicate entry ${entry.name}`);
    }
    seen.add(entry.name);
  }
  for (const required of ACTIVE_FIXTURE_FILES) {
    if (!seen.has(required)) {
      fail(`generation directory missing file ${required}`);
    }
  }

  const bundle: Record<ActiveFixtureName, unknown> = {} as Record<
    ActiveFixtureName,
    unknown
  >;
  for (const name of ACTIVE_FIXTURE_FILES) {
    const filePath = join(generationDir, name);
    const buffer = readFileSync(filePath);
    const computed = sha256Hex(buffer);
    const expected = manifest.fixtureHashes[name];
    if (computed !== expected) {
      fail(
        `hash mismatch for ${name}: expected ${expected}, computed ${computed}`,
      );
    }
    const text = buffer.toString("utf8");
    const data: unknown = JSON.parse(text);
    assertProbeFixtureSafe(data);
    assertBuildingControlFixtureProjection(name, data);
    bundle[name] = data;
  }

  return { manifest, bundle };
}
