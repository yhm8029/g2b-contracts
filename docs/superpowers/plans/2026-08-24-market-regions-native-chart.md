# Market Regions And Native Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand regional reporting, exclude procurement framework notices, and export an editable Excel pie chart.

**Architecture:** Add one shared region module used by report, storage, UI, and Excel. Apply the framework-notice predicate at ingestion and read boundaries. Generate the workbook with ExcelJS, then add a standards-compliant native pie-chart part linked to visible summary cells.

**Tech Stack:** TypeScript, Next.js, SQLite, ExcelJS, JSZip, Vitest, Tauri portable packaging.

---

### Task 1: Shared region and exclusion rules

**Files:**
- Create: `src/lib/building-control-market/regions.ts`
- Modify: `src/lib/building-control-market/report.ts`
- Modify: `src/lib/building-control-market/store.ts`
- Modify: `src/lib/building-control-market/sync.ts`
- Test: `tests/building-control-market-mvp.test.ts`

- [ ] Add table-driven failing tests for every requested region and the 경기 광주/광주광역시 boundary.
- [ ] Add a failing test that a notice named `우수조달물품(...) 제3자단가계약` is removed from stored and reported awards.
- [ ] Implement the shared classifier and exclusion predicate.
- [ ] Run `npx vitest run tests/building-control-market-mvp.test.ts`.

### Task 2: Region UI and export naming

**Files:**
- Modify: `src/components/MarketShareApp.tsx`
- Modify: `src/components/MarketShareApp.module.css`
- Modify: `src/lib/building-control-market/excel.ts`

- [ ] Replace the region segments with a labeled select using the shared region options.
- [ ] Use the selected label in the UI, workbook filename, workbook summary, and detail rows.
- [ ] Filter workbook details with the shared demand-agency classifier.

### Task 3: Combined-source duplicate handling

**Files:**
- Modify: `src/lib/building-control-market/report.ts`
- Modify: `src/lib/building-control-market/excel.ts`
- Test: `tests/building-control-market-mvp.test.ts`

- [ ] Add a failing test for matching normalized name, amount, winner business number, and demand agency across award and shopping rows.
- [ ] Keep the G2B award and remove the shopping row only in combined reports and combined Excel details.
- [ ] Confirm award-only and shopping-only selections retain their source rows.

### Task 4: Editable Excel pie chart and release

**Files:**
- Modify: `src/lib/building-control-market/excel.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/building-control-market-mvp.test.ts`

- [ ] Add a failing XLSX-archive assertion for native chart XML and linked category/value ranges.
- [ ] Replace the PNG drawing with a native pie chart linked to visible company and count cells.
- [ ] Run the focused test and `npm run build`.
- [ ] Build and deploy `경쟁사 조회.exe` to `C:\Users\user\Desktop\경쟁사 조회` while preserving `data`.
- [ ] Commit and push with a completion status in the commit body.
