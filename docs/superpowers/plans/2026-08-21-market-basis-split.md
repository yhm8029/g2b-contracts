# Market Basis Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide notice, shopping-mall, and combined market-share modes without the generic standard-contract scan.

**Architecture:** Keep stored award and shopping facts separate. Select either set or concatenate both at the report boundary, while preserving the existing period, region, and excellence classification logic.

**Tech Stack:** TypeScript, React, Next.js, SQLite, ExcelJS, Vitest

---

### Task 1: Report modes

**Files:**
- Modify: `src/lib/building-control-market/report.ts`
- Test: `tests/building-control-market-mvp.test.ts`

- [ ] Add a failing test asserting notice=1, shopping=2, combined=3.
- [ ] Extend `ReportBasis` with `combined` and concatenate selected records for that mode.
- [ ] Run `npx vitest run tests/building-control-market-mvp.test.ts`.

### Task 2: Collection and labels

**Files:**
- Modify: `src/lib/building-control-market/sync.ts`
- Modify: `src/components/MarketShareApp.tsx`
- Modify: `src/lib/building-control-market/excel.ts`

- [ ] Remove the standard-contract collection loop so sync collects only target notices/awards and exact-code shopping delivery requests.
- [ ] Label the modes `나라장터 공고`, `종합쇼핑몰`, and `통합` in the UI and workbook.
- [ ] Include both detail types in the combined workbook.

### Task 3: Verify and deploy

**Files:**
- Package: `C:\Users\user\경쟁사 조회\경쟁사 조회.exe`

- [ ] Run the focused test and `npm run build`.
- [ ] Repackage without replacing the portable `data` directory.
- [ ] Verify report totals for all three bases, then commit and push with remaining-work status.
