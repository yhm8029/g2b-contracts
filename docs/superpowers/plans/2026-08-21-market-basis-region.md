# Market Basis and Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add award/contract reporting bases and nationwide/Busan filters to the market-share EXE and Excel export.

**Architecture:** Extend the portable SQLite market store with normalized award metadata and contract facts. Keep one shared report row model, selecting the source table by query basis and filtering Busan by demand-agency text. Reuse existing competitor contract collection and mapping helpers where possible.

**Tech Stack:** Next.js 15, TypeScript, better-sqlite3, ExcelJS, Tauri 2.

---

### Task 1: Report and SQLite model

**Files:** `src/lib/building-control-market/report.ts`, `src/lib/building-control-market/store.ts`, `tests/building-control-market-mvp.test.ts`

- [x] Add `MarketBasis`, `MarketRegion`, shared market fact input, and Busan predicate.
- [x] Add idempotent award metadata columns and `market_contracts` table.
- [x] Add list/replace functions and focused award/contract/Busan assertions.

### Task 2: Sync data projections

**Files:** `src/lib/building-control-market/sync.ts`, `src/lib/competitors/service.ts`

- [x] Preserve notice name and demand agency on award facts.
- [x] Expose a reusable contract collection result and map target contract facts into `market_contracts`.
- [x] Replace both snapshots only after their respective collection succeeds.

### Task 3: API, UI, and workbook

**Files:** `src/app/api/building-control-market/report/route.ts`, `src/app/api/building-control-market/export/route.ts`, `src/components/MarketShareApp.tsx`, `src/lib/building-control-market/excel.ts`

- [x] Parse `basis` and `region` query values with safe defaults.
- [x] Add two segmented controls and include them in report/export URLs.
- [x] Export region, name, date, identifiers, supplier, amount, agency, and URL in the detail sheet.

### Task 4: Package

**Files:** `C:\Users\user\경쟁사 조회`

- [x] Run only the focused market test and `npm run build`.
- [x] Rebuild portable runtime without rebuilding unchanged Rust.
- [x] Replace the local portable runtime while preserving its SQLite `data` directory.
- [x] Commit and push, explicitly stating whether live contract sync confirmation remains.
