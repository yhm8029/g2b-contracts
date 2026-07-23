# Competitor Third-Party Deliveries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep third-party unit-price master ceilings out of sales while adding actual building-control delivery-request sales with SQLite-first monthly retrieval.

**Architecture:** Query the official specific-product procurement endpoint with detail product code `3912180101`, retain only competitor rows whose contract division is third-party unit-price and whose contract/delivery division is delivery request, and cache each requested month in SQLite. Merge these rows with existing standard-contract rows in the competitor service; do not add amendment or duplicate collapsing beyond existing overview behavior.

**Tech Stack:** Next.js 15, TypeScript, better-sqlite3/Drizzle schema initialization, Vitest, data.go.kr G2B JSON API.

---

### Task 1: Specific-product delivery source and monthly cache

**Files:**
- Create: `src/lib/competitors/third-party-deliveries.ts`
- Modify: `src/lib/db/init.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/competitors/contracts.ts`
- Test: `tests/competitors-third-party-deliveries.test.ts`

- [ ] Write failing tests for request parameters, response mapping, third-party delivery filtering, and exact SQLite cache reuse.
- [ ] Run `npm test -- tests/competitors-third-party-deliveries.test.ts` and confirm failure because the source does not exist.
- [ ] Implement the client, mapper, month splitter, SQLite cache, coverage result, and competitor-row source type.
- [ ] Run the focused test and confirm it passes.

### Task 2: Merge standard contracts and actual delivery sales

**Files:**
- Modify: `src/lib/competitors/service.ts`
- Modify: `src/lib/competitors/overview.ts`
- Test: `tests/competitors-overview.test.ts`
- Test: `tests/competitors-service-cache.test.ts`

- [ ] Write failing tests proving a standard third-party master ceiling is excluded while a specific-product delivery row is included and displayed as `제3자단가계약`.
- [ ] Write failing tests proving cache-only coverage combines both sources and month caches are reusable from quarter/year requests.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Merge both row sources and combine coverage without adding new duplicate/amendment collapsing.
- [ ] Run focused tests and confirm they pass.

### Task 3: End-to-end verification

**Files:**
- Test: existing competitor Excel and frontend suites

- [ ] Run `npm test` and `npx tsc --noEmit`.
- [ ] Build with `npm run build`, restart port `5182`, and fetch July 2026.
- [ ] Verify the 9,025,070,000 won master ceiling is absent, actual third-party delivery requests are present, cached repeat requests do not call upstream, and Excel contains the same rows.
- [ ] Commit and push the reviewed changes to `feature/g2b-contract-lookup`.
