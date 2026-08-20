import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

import { publishFixtureGeneration } from "@/lib/building-control/live-api-contract-probe";
import { loadActiveFixtureGeneration } from "@/lib/building-control/fixture-generation";

const FIXTURE_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/building-control",
);

const EXPECTED_FILES = [
  "notice-page.json",
  "purchase-target-page.json",
  "award-page.json",
  "designation-list-valid.json",
  "designation-list-expired.json",
  "designation-list-extended.json",
  "designation-detail.json",
] as const;

type NoticeBundle = {
  page: { items: Array<Record<string, unknown>> };
};

let tempRoot = "";

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

async function loadBundle(): Promise<Record<string, unknown>> {
  const generation = await loadActiveFixtureGeneration(FIXTURE_DIR);
  return { ...generation.bundle };
}

function sha256Lower(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("publishFixtureGeneration", () => {
  it("publishes seven sanitized fixtures and writes an immutable active pointer", async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "building-control-fixtures-"),
    );

    const bundle = await loadBundle();
    const generatedAt = "2026-01-01T00:00:00.000Z";

    const result = await publishFixtureGeneration({
      committedRoot: tempRoot,
      bundle,
      generatedAt,
    });

    expect(result.version).toBe(1);
    expect(result.fixtureSchemaVersion).toBe(1);
    expect(typeof result.generationId).toBe("string");
    expect(result.generationId.length).toBeGreaterThan(0);

    const fixtureHashes: Record<string, string> = result.fixtureHashes;
    expect(Object.keys(fixtureHashes).sort()).toEqual(
      [...EXPECTED_FILES].sort(),
    );

    for (const name of EXPECTED_FILES) {
      expect(fixtureHashes[name]).toMatch(/^[0-9a-f]{64}$/);
    }

    const genDir = path.join(tempRoot, "generations", result.generationId);
    const writtenNames = await fs.readdir(genDir);
    expect(writtenNames.sort()).toEqual([...EXPECTED_FILES].sort());

    for (const name of EXPECTED_FILES) {
      const onDiskPath = path.join(genDir, name);
      const onDiskRaw = await fs.readFile(onDiskPath, "utf8");
      const onDisk = JSON.parse(onDiskRaw);
      expect(onDisk).toEqual(bundle[name]);
      const onDiskHash = sha256Lower(Buffer.from(onDiskRaw, "utf8"));
      expect(fixtureHashes[name]).toBe(onDiskHash);
    }

    const pointerRaw = await fs.readFile(
      path.join(tempRoot, "active-generation.json"),
      "utf8",
    );
    const pointer = JSON.parse(pointerRaw);
    expect(pointer).toEqual(result);
  });

  it("rejects when the generations directory cannot be created and leaves the active pointer untouched", async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "building-control-fixtures-"),
    );

    const sentinel = JSON.stringify({ sentinel: true, v: 1 });
    const activePath = path.join(tempRoot, "active-generation.json");
    await fs.writeFile(activePath, sentinel, "utf8");
    await fs.writeFile(
      path.join(tempRoot, "generations"),
      "not-a-directory",
      "utf8",
    );

    const bundle = await loadBundle();

    await expect(
      publishFixtureGeneration({
        committedRoot: tempRoot,
        bundle,
        generatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow();

    const after = await fs.readFile(activePath, "utf8");
    expect(after).toBe(sentinel);
  });

  it("rejects a corrupted notice-page.json before creating committedRoot", async () => {
    tempRoot = path.join(
      os.tmpdir(),
      "building-control-fixtures-" + randomUUID(),
    );

    const bundle = await loadBundle();
    const notice = bundle["notice-page.json"] as NoticeBundle;
    notice.page.items[0]["contactEmail"] = "leak@example.invalid";

    await expect(
      publishFixtureGeneration({
        committedRoot: tempRoot,
        bundle,
        generatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/allow|sensitive|key|email|shaped/i);

    await expect(fs.stat(tempRoot)).rejects.toThrow();
  });

  it("rejects tampered notice-page.json with hash mismatch", async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "building-control-fixtures-"),
    );
    const bundle = await loadBundle();
    const result = await publishFixtureGeneration({
      committedRoot: tempRoot,
      bundle,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const tamperedPath = path.join(
      tempRoot,
      "generations",
      result.generationId,
      "notice-page.json",
    );
    await fs.appendFile(tamperedPath, "\n");
    expect(() => loadActiveFixtureGeneration(tempRoot)).toThrow(
      /hash.*mismatch/i,
    );
  });
});
