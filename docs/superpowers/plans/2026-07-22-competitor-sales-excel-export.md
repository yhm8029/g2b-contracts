# Competitor Sales Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the fully collected competitor-sales period as a two-sheet `.xlsx` workbook.

**Architecture:** A server-only ExcelJS formatter converts `CompetitorSalesOverviewResponse` into `업체별 요약` and `전체` worksheets. A strict cache-only API route refuses partial coverage, while the client exposes the route only when the current result is complete and fresh.

**Tech Stack:** Next.js App Router, TypeScript, ExcelJS, Vitest, SQLite cache, React, lucide-react.

---

## File Structure

- Create `src/lib/competitors/excel.ts`: workbook columns, rows, styles, and buffer serialization.
- Create `src/app/api/competitors/export/route.ts`: period validation, cache-only overview read, completeness guard, attachment response.
- Modify `src/components/CompetitorSalesApp.tsx`: export URL helper and enabled/disabled download control.
- Modify `src/app/globals.css`: compact export-control states consistent with the current panel.
- Modify `package.json`, `package-lock.json`: add ExcelJS.
- Create `tests/competitors-excel.test.ts`: workbook content tests.
- Create `tests/competitors-export-route.test.ts`: route validation and response tests.
- Modify `tests/competitor-sales-app.test.ts`, `tests/competitor-sales-frontend.test.ts`: client URL and availability tests.

---

### Task 1: Workbook Generator

**Files:**
- Create: `src/lib/competitors/excel.ts`
- Create: `tests/competitors-excel.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add ExcelJS and write a failing workbook test**

Run `npm install exceljs@4.4.0`, then test that `buildCompetitorSalesWorkbook(overview)` creates worksheets named `업체별 요약` and `전체`, emits 22 summary rows, emits one detail row per contract, stores amounts as numbers, and preserves the source URL.

- [ ] **Step 2: Verify the test fails for the missing module**

Run: `npx vitest run tests/competitors-excel.test.ts`

Expected: FAIL because `src/lib/competitors/excel.ts` does not exist.

- [ ] **Step 3: Implement the server-only workbook generator**

Export:

```ts
export async function buildCompetitorSalesWorkbook(
  overview: CompetitorSalesOverviewResponse,
): Promise<Buffer>
```

Create exactly two worksheets, freeze/filter the header rows, use numeric amount cells with `#,##0"원"`, and choose `contractDetailUrl || noticeDetailUrl` for the source URL.

- [ ] **Step 4: Verify workbook tests pass**

Run: `npx vitest run tests/competitors-excel.test.ts`

Expected: PASS.

### Task 2: Cached Export API

**Files:**
- Create: `src/app/api/competitors/export/route.ts`
- Create: `tests/competitors-export-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover strict month/quarter/year validation, `cacheOnly: true` service input, 409 for `coverage.complete === false`, and a successful response with:

```text
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="competitor-sales-<period>.xlsx"
```

- [ ] **Step 2: Verify route tests fail**

Run: `npx vitest run tests/competitors-export-route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route**

Reuse the overview period parser semantics, open/initialize SQLite, call `getCompetitorSalesOverview({ cacheOnly: true })`, reject incomplete coverage, serialize the workbook, and always close the connection.

- [ ] **Step 4: Verify route tests pass**

Run: `npx vitest run tests/competitors-export-route.test.ts`

Expected: PASS.

### Task 3: Download Control

**Files:**
- Modify: `src/components/CompetitorSalesApp.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/competitor-sales-app.test.ts`
- Modify: `tests/competitor-sales-frontend.test.ts`

- [ ] **Step 1: Write failing client tests**

Test that `buildCompetitorExportUrl(selection)` mirrors the overview query and that export is enabled only for `coverage.complete && coverage.fresh && !isLoading`.

- [ ] **Step 2: Verify client tests fail**

Run: `npx vitest run tests/competitor-sales-app.test.ts tests/competitor-sales-frontend.test.ts`

Expected: FAIL because the helpers and control do not exist.

- [ ] **Step 3: Implement the compact download command**

Use the Lucide `Download` icon and the label `엑셀 내보내기`. Render an anchor with the export URL only when enabled; otherwise render the same control with `aria-disabled="true"` and no `href`. Keep the control in the panel header next to the period filters.

- [ ] **Step 4: Verify client tests pass**

Run: `npx vitest run tests/competitor-sales-app.test.ts tests/competitor-sales-frontend.test.ts`

Expected: PASS.

### Task 4: Integration Verification

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Verify a real workbook**

Download a complete cached period from `/api/competitors/export`, open it with ExcelJS, and assert the two worksheet names and non-empty rows. Verify the production page and endpoint return 200 after restarting port 5182.
