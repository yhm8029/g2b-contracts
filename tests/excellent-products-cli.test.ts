import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { EXCELLENT_PRODUCT_HEADER_ALIASES } from "@/lib/excellent-products/constants";

const CSV = [
  [
    EXCELLENT_PRODUCT_HEADER_ALIASES.company[0],
    EXCELLENT_PRODUCT_HEADER_ALIASES.business[0],
    EXCELLENT_PRODUCT_HEADER_ALIASES.product[0],
    EXCELLENT_PRODUCT_HEADER_ALIASES.designation[0],
    EXCELLENT_PRODUCT_HEADER_ALIASES.classificationNumber[0],
  ].join(","),
  "Example Co,123-45-67890,Building control,EQ-1,39121801-01",
].join("\n");

function runImport(args: string[], databaseUrl: string) {
  try {
    return {
      status: 0,
      output: execFileSync(
        process.execPath,
        [
          join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
          "scripts/import-excellent-products.ts",
          ...args,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, DATABASE_URL: databaseUrl },
          encoding: "utf8",
          stdio: "pipe",
        },
      ),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("excellent product CLI workflows", () => {
  it("imports a target CSV repeatably with stable counts", () => {
    const directory = mkdtempSync(join(tmpdir(), "excellent-products-cli-"));
    const csvPath = join(directory, "products.csv");
    const databaseUrl = join(directory, "products.sqlite");
    writeFileSync(csvPath, CSV, "utf8");

    const first = runImport([csvPath], databaseUrl);

    expect(first.status).toBe(0);
    expect(first.output).toContain("inserted=1");

    const countRows = () => {
      const verification = createDb(databaseUrl);
      try {
        return (verification.sqlite.prepare("select count(*) as count from excellent_products").get() as { count: number })
          .count;
      } finally {
        verification.sqlite.close();
      }
    };
    expect(countRows()).toBe(1);

    const second = runImport([csvPath], databaseUrl);
    expect(second.status).toBe(0);
    expect(second.output).toContain("updated=1");
    expect(countRows()).toBe(1);
  });

  it.each([
    ["missing argument", []],
    ["missing file", ["does-not-exist.csv"]],
    ["invalid CSV", ["invalid.csv"]],
    ["zero target rows", ["other.csv"]],
  ])("returns nonzero for %s", (name, args) => {
    const directory = mkdtempSync(join(tmpdir(), "excellent-products-cli-error-"));
    const databaseUrl = join(directory, "products.sqlite");
    if (name === "invalid CSV") writeFileSync(join(directory, "invalid.csv"), "not,a,valid,header\n", "utf8");
    if (name === "zero target rows") {
      writeFileSync(
        join(directory, "other.csv"),
        CSV.replace("39121801-01", "12345678-01"),
        "utf8",
      );
    }

    expect(runImport(args, databaseUrl).status).not.toBe(0);
  });
});
