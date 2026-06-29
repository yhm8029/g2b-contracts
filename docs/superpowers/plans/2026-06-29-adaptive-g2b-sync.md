# Adaptive G2B Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch G2B contract records from the public standard contract API with month-first adaptive date chunks, persist matching business-number rows into SQLite, and refresh the UI search results.

**Architecture:** Keep search local-first. Add a sync boundary under `src/lib/g2b/standard-contract-*` that fetches date chunks, filters rows by business number, maps provider rows into existing import rows, and reuses the repository import path. Add `POST /api/sync` and a UI "Sync G2B" action that runs sync then reruns local search.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle/better-sqlite3, Vitest, native fetch.

---

## File Structure

- Create `src/lib/g2b/date-chunks.ts`: month/week/day chunk generation and adaptive split helpers.
- Create `src/lib/g2b/standard-contract-client.ts`: public standard contract API client, pagination, provider error classification.
- Create `src/lib/g2b/standard-contract-mapper.ts`: business-number matching and provider-row to `ParsedContractCsvRow` mapping.
- Create `src/lib/g2b/standard-contract-sync.ts`: orchestration, import persistence, sync summary.
- Create `src/app/api/sync/route.ts`: server route for explicit sync.
- Modify `src/components/ContractLookupApp.tsx`: add sync button/status and refresh search after sync.
- Modify `src/lib/contracts/repository.ts`: allow non-CSV source names when recording import runs.
- Test `tests/g2b-date-chunks.test.ts`, `tests/g2b-standard-contract-mapper.test.ts`, `tests/g2b-standard-contract-sync.test.ts`, `tests/sync-route.test.ts`, and update `tests/contract-lookup-status.test.ts`.

---

### Task 1: Date Chunk Helpers

**Files:**
- Create: `src/lib/g2b/date-chunks.ts`
- Create: `tests/g2b-date-chunks.test.ts`

- [ ] **Step 1: Write failing tests**

Test month chunks for partial ranges and fallback expansion:

```ts
import { describe, expect, it } from "vitest";
import { splitDateRangeIntoDays, splitDateRangeIntoMonths, splitDateRangeIntoWeeks } from "@/lib/g2b/date-chunks";

describe("g2b date chunks", () => {
  it("splits a partial range into calendar months", () => {
    expect(splitDateRangeIntoMonths("2025-01-15", "2025-03-02")).toEqual([
      { dateFrom: "2025-01-15", dateTo: "2025-01-31", granularity: "month" },
      { dateFrom: "2025-02-01", dateTo: "2025-02-28", granularity: "month" },
      { dateFrom: "2025-03-01", dateTo: "2025-03-02", granularity: "month" },
    ]);
  });

  it("splits a month into seven-day week chunks", () => {
    expect(splitDateRangeIntoWeeks("2026-06-01", "2026-06-15")).toEqual([
      { dateFrom: "2026-06-01", dateTo: "2026-06-07", granularity: "week" },
      { dateFrom: "2026-06-08", dateTo: "2026-06-14", granularity: "week" },
      { dateFrom: "2026-06-15", dateTo: "2026-06-15", granularity: "week" },
    ]);
  });

  it("splits a short range into days", () => {
    expect(splitDateRangeIntoDays("2026-06-27", "2026-06-29")).toEqual([
      { dateFrom: "2026-06-27", dateTo: "2026-06-27", granularity: "day" },
      { dateFrom: "2026-06-28", dateTo: "2026-06-28", granularity: "day" },
      { dateFrom: "2026-06-29", dateTo: "2026-06-29", granularity: "day" },
    ]);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/g2b-date-chunks.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement helper**

Create pure functions using UTC date math and returning ISO `YYYY-MM-DD` strings.

- [ ] **Step 4: Verify tests pass**

Run: `npm test -- tests/g2b-date-chunks.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/lib/g2b/date-chunks.ts tests/g2b-date-chunks.test.ts && git commit -m "feat: add adaptive g2b date chunks"`

---

### Task 2: Standard Contract API Mapper And Client

**Files:**
- Create: `src/lib/g2b/standard-contract-client.ts`
- Create: `src/lib/g2b/standard-contract-mapper.ts`
- Create: `tests/g2b-standard-contract-mapper.test.ts`

- [ ] **Step 1: Write mapper tests**

Cover business-number candidate fields, required field mapping, amount/date normalization, and skipped rows when required fields are missing.

- [ ] **Step 2: Implement mapper**

Use candidate field names including `bizno`, `bizrno`, `cntrctCorpBizno`, `cntrctEntrpsBizno`, `bidwinnrBizrno`, `corpBizno`, and Korean-key fallback scans containing `사업자등록번호`.

Map best-effort provider fields into `ParsedContractCsvRow` with `sourceDataset = "g2b-public-standard-contract"` and `sourceRowHash` from raw provider row plus normalized business number.

- [ ] **Step 3: Implement client**

Use `fetchG2bJson`, operation `getDataSetOpnStdCntrctInfo`, parameters `ServiceKey`, `type=json`, `pageNo`, `numOfRows`, `cntrctCnclsBgnDate`, `cntrctCnclsEndDate`.

Normalize response shapes where `items` can be an array, a single object, or nested under `item`.

Classify `403` as `unauthorized_service_key`; date-range provider messages as `date_range_too_large`.

- [ ] **Step 4: Verify mapper tests pass**

Run: `npm test -- tests/g2b-standard-contract-mapper.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/lib/g2b/standard-contract-client.ts src/lib/g2b/standard-contract-mapper.ts tests/g2b-standard-contract-mapper.test.ts && git commit -m "feat: map g2b standard contract rows"`

---

### Task 3: Sync Orchestration And API Route

**Files:**
- Create: `src/lib/g2b/standard-contract-sync.ts`
- Create: `src/app/api/sync/route.ts`
- Modify: `src/lib/contracts/repository.ts`
- Create: `tests/g2b-standard-contract-sync.test.ts`
- Create: `tests/sync-route.test.ts`

- [ ] **Step 1: Write sync tests**

Test month success, month range-limit fallback to weeks, week range-limit fallback to days, missing API key route response, and unauthorized provider route response.

- [ ] **Step 2: Update repository**

Add optional `sourceName` parameter to `importParsedRows(db, rows, sourceFileName, sourceName = "csv")`, and store that value in `import_runs.source_name`.

- [ ] **Step 3: Implement sync orchestrator**

Create `syncStandardContractsForBusiness(db, params, client)`:

- validates business number and dates,
- generates month chunks,
- fetches all pages for each chunk,
- falls back to week/day only on `date_range_too_large`,
- maps and filters matching rows,
- imports valid rows with source name `g2b-public-standard-contract`,
- returns counts and errors.

- [ ] **Step 4: Implement route**

Add `POST /api/sync`. It initializes SQLite, calls sync, returns summary JSON, and redacts provider details. Missing key returns 403. Unauthorized provider returns 403 with "Public Data Portal service usage approval is required for the G2B public data open standard service."

- [ ] **Step 5: Verify tests pass**

Run: `npm test -- tests/g2b-standard-contract-sync.test.ts tests/sync-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add src/lib/g2b/standard-contract-sync.ts src/app/api/sync/route.ts src/lib/contracts/repository.ts tests/g2b-standard-contract-sync.test.ts tests/sync-route.test.ts && git commit -m "feat: sync g2b standard contracts"`

---

### Task 4: UI Sync Action

**Files:**
- Modify: `src/components/ContractLookupApp.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/contract-lookup-status.test.ts`

- [ ] **Step 1: Add UI helper tests**

Add pure helper coverage for sync labels and export state after sync.

- [ ] **Step 2: Add Sync G2B button**

Add a secondary action next to Search:

- local Search remains unchanged,
- Sync G2B calls `POST /api/sync`,
- after success, it reruns `/api/search`,
- errors leave current local results visible,
- button is disabled while search or sync is running.

- [ ] **Step 3: Add status messaging**

Show concise status text: sync started, completed with matched/imported counts, unauthorized API service approval required, or provider error.

- [ ] **Step 4: Verify UI build and tests**

Run:

- `npm test -- tests/contract-lookup-status.test.ts`
- `npm test`
- `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/components/ContractLookupApp.tsx src/app/globals.css tests/contract-lookup-status.test.ts && git commit -m "feat: add g2b sync action"`

---

### Task 5: Local Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document sync**

Add a short README note explaining that Search is local-only and Sync G2B fetches provider data into SQLite first.

- [ ] **Step 2: Run verification**

Run:

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- local server smoke test for `/api/search` and `/api/sync` missing-key or unauthorized-key behavior.

- [ ] **Step 3: Commit docs**

Run: `git add README.md && git commit -m "docs: explain g2b sync workflow"`

---

## Plan Self-Review

- Spec coverage: adaptive month/week/day chunking, pagination, filtering, mapping, persistence, UI, and error handling all have tasks.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: sync APIs use existing `ContractSearchParams` shape plus explicit sync summary types.
