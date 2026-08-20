import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("unused excellent-products feature removal", () => {
  it("does not ship the disconnected UI, API, CLI, or domain module", () => {
    const removedPaths = [
      "src/components/ExcellentProductsApp.tsx",
      "src/app/excellent-products/page.tsx",
      "src/app/api/excellent-products",
      "src/lib/excellent-products",
      "scripts/import-excellent-products.ts",
      "scripts/sync-excellent-products.ts",
    ];
    expect(removedPaths.filter((path) => existsSync(resolve(root, path)))).toEqual([]);
  });

  it("does not expose obsolete package scripts or navigation", () => {
    const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["excellent-products:import"]).toBeUndefined();
    expect(packageJson.scripts["excellent-products:sync"]).toBeUndefined();
    expect(source("src/app/page.tsx")).not.toContain("/excellent-products");
  });

  it("keeps the competitor sales startup route", () => {
    expect(source("src-tauri/src/main.rs")).toContain("/competitors");
    expect(source("src/lib/competitors/overview.ts")).toContain('const TARGET_ITEM_CODE = "3912180101"');
  });
});
