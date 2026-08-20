# Remove Unused Excellent Products Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the disconnected excellent-product CSV snapshot feature without changing the competitor sales EXE workflow.

**Architecture:** Keep `/competitors`, the fixed 22-company registry, contract collection, cache, aggregation, Excel export, and Tauri startup unchanged. Remove the separate `/excellent-products` UI/API/CLI/domain path and stop creating its exclusive tables in new databases; never issue destructive SQL against existing user databases.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Drizzle ORM, SQLite, Tauri 2

---

### Task 1: Add a removal boundary regression test

**Files:**
- Create: `tests/unused-excellent-products-removal.test.ts`

- [ ] **Step 1: Write the failing source-boundary test**

```ts
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
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `npm test -- tests/unused-excellent-products-removal.test.ts`

Expected: FAIL because the excellent-products paths and package scripts still exist.

- [ ] **Step 3: Commit the failing regression test**

```powershell
git add tests/unused-excellent-products-removal.test.ts
git commit -m "test: define unused excellent products removal boundary"
```

### Task 2: Remove the disconnected application surface

**Files:**
- Delete: `src/components/ExcellentProductsApp.tsx`
- Delete: `src/app/excellent-products/page.tsx`
- Delete: `src/app/api/excellent-products/building-control/route.ts`
- Delete: `src/app/api/excellent-products/building-control/sync/route.ts`
- Delete: `src/app/api/excellent-products/building-control/export/route.ts`
- Delete: `scripts/import-excellent-products.ts`
- Delete: `scripts/sync-excellent-products.ts`
- Modify: `src/app/page.tsx`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Delete the listed UI, API, and CLI files**

Use repository-native file deletion. Do not touch `src/app/competitors`, `src/components/CompetitorSalesApp.tsx`, or `src-tauri`.

- [ ] **Step 2: Remove obsolete navigation and scripts**

Change `src/app/page.tsx` to render only `ContractLookupApp`. Remove `excellent-products:import` and `excellent-products:sync` from `package.json`. Remove README instructions that claim the CSV import, sync command, or `/excellent-products` page is available.

- [ ] **Step 3: Verify the boundary test still fails only on the domain module**

Run: `npm test -- tests/unused-excellent-products-removal.test.ts`

Expected: FAIL because `src/lib/excellent-products` still exists; UI/API/CLI and package-script assertions pass.

- [ ] **Step 4: Commit the surface removal**

```powershell
git add -A src/app/excellent-products src/app/api/excellent-products src/components/ExcellentProductsApp.tsx scripts package.json README.md src/app/page.tsx
git commit -m "refactor: remove unused excellent products surface"
```

### Task 3: Remove the unused domain module and exclusive schema

**Files:**
- Delete: `src/lib/excellent-products/constants.ts`
- Delete: `src/lib/excellent-products/csv.ts`
- Delete: `src/lib/excellent-products/enrichment.ts`
- Delete: `src/lib/excellent-products/export.ts`
- Delete: `src/lib/excellent-products/profile.ts`
- Delete: `src/lib/excellent-products/repository.ts`
- Delete: `src/lib/excellent-products/types.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/init.ts`
- Modify: `tests/db-schema.test.ts`

- [ ] **Step 1: Confirm shared DB dependencies before editing**

Run:

```powershell
rg -n '\b(businesses|factoryLocations|companyIndustries|excellentProducts)\b' src --glob '!src/lib/excellent-products/**' --glob '!src/lib/db/schema.ts' --glob '!src/lib/db/init.ts'
```

Expected: `businesses` is used by `src/lib/contracts/repository.ts`; keep it. `excellentProducts`, `factoryLocations`, and `companyIndustries` have no active consumers after Task 2.

- [ ] **Step 2: Delete the domain module and remove only exclusive schema declarations**

Delete `src/lib/excellent-products`. Remove `excellentProducts`, `factoryLocations`, and `companyIndustries` table declarations, indexes, and new-database `CREATE TABLE` statements. Keep `businesses`, `contractRecords`, `importRuns`, and `apiEnrichmentLogs`. Do not add `DROP TABLE` or a destructive migration.

- [ ] **Step 3: Update the DB schema test**

Remove expectations for `excellent_products`, `factory_locations`, and `company_industries`. Preserve assertions for all active contract lookup tables and indexes.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests/unused-excellent-products-removal.test.ts tests/db-schema.test.ts tests/contracts-repository.test.ts tests/competitors-overview.test.ts tests/competitors-excel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the domain removal**

```powershell
git add -A src/lib/excellent-products src/lib/db/schema.ts src/lib/db/init.ts tests/db-schema.test.ts
git commit -m "refactor: remove unused excellent products domain"
```

### Task 4: Remove obsolete tests and verify the product

**Files:**
- Delete: `tests/excellent-products-app.test.ts`
- Delete: `tests/excellent-products-cli.test.ts`
- Delete: `tests/excellent-products-csv.test.ts`
- Delete: `tests/excellent-products-enrichment.test.ts`
- Delete: `tests/excellent-products-export.test.ts`
- Delete: `tests/excellent-products-frontend.test.ts`
- Delete: `tests/excellent-products-query.test.ts`
- Delete: `tests/excellent-products-repository.test.ts`
- Delete: `tests/excellent-products-routes.test.ts`

- [ ] **Step 1: Delete tests that only cover removed code**

Keep `tests/unused-excellent-products-removal.test.ts` as the permanent boundary test.

- [ ] **Step 2: Scan for stale references**

Run:

```powershell
rg -n -i 'UI-ADOSAA-005R|excellent-products|ExcellentProductsApp|우수제품 지정 내역' src scripts tests README.md package.json
```

Expected: no obsolete runtime, script, or README reference. The new removal test may contain `excellent-products` path literals by design.

- [ ] **Step 3: Run all automated tests**

Run: `npm test`

Expected: all remaining test files and tests pass.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: build succeeds and the route table contains `/competitors` but not `/excellent-products` or `/api/excellent-products/*`.

- [ ] **Step 5: Verify the worktree diff**

Run:

```powershell
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: only the approved design/plan, removal boundary test, and excellent-products removal changes are present.

- [ ] **Step 6: Commit final cleanup**

```powershell
git add -A tests
git commit -m "test: remove obsolete excellent products coverage"
```
