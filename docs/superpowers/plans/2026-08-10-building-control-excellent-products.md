# Building Control Excellent Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated, local-first `39121801` building-control excellent-product company lookup with official CSV import, company enrichment, a 16-column table, and Excel-safe CSV export.

**Architecture:** Import only normalized product classifications beginning with the fixed `39121801` prefix into a dedicated snapshot table. Reuse `businesses`, the SQLite/Drizzle setup, and G2B HTTP utilities; add normalized child tables for factories and industries. Reads are DB-only, while explicit refresh calls official company, industry, and third-party shopping-mall APIs once per distinct business number.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, SQLite, Drizzle ORM, Vitest, official data.go.kr JSON APIs

---

## File map

- `src/lib/excellent-products/constants.ts`: fixed classification constant and normalization/match helpers.
- `src/lib/excellent-products/types.ts`: import, query, API response, and sync types.
- `src/lib/excellent-products/csv.ts`: multiline-safe CSV records, official-header aliases, row mapping.
- `src/lib/excellent-products/repository.ts`: snapshot import, joined DB query, counts, enrichment persistence.
- `src/lib/excellent-products/export.ts`: exact 16-column UTF-8 BOM CSV.
- `src/lib/excellent-products/enrichment.ts`: distinct-business sync orchestration and source priority.
- `src/lib/g2b/user-info-client.ts`: official company/basic-industry API calls and parsers.
- `src/lib/g2b/shopping-mall-product-client.ts`: third-party contract product paging and separate head-office/factory mapping.
- `src/app/api/excellent-products/building-control/{route.ts,export/route.ts,sync/route.ts}`: dedicated internal API.
- `src/components/ExcellentProductsApp.tsx`: fixed-purpose lookup UI, client filter/sort, sync, export.
- `src/app/excellent-products/page.tsx`: page entry.
- `scripts/import-excellent-products.ts`, `scripts/sync-excellent-products.ts`: repeatable CLI workflows.
- `src/lib/db/schema.ts`, `src/lib/db/init.ts`, `src/lib/contracts/repository.ts`: schema and safe profile reuse.
- `src/app/page.tsx`, `src/app/globals.css`, `package.json`, `README.md`: navigation, styling, commands, operations documentation.

### Task 1: Classification normalization and official CSV parsing

**Files:**
- Create: `src/lib/excellent-products/constants.ts`
- Create: `src/lib/excellent-products/types.ts`
- Create: `src/lib/excellent-products/csv.ts`
- Test: `tests/excellent-products-csv.test.ts`

- [ ] **Step 1: Write failing normalization and parser tests**

Test `39121801`, `3912180101`, `39121801-01`, and `3912180102` as matches and `44103103` as a non-match. Build a 100-row CSV with official Korean headers where four rows match. Include a quoted certification field containing comma, quote, and CR/LF and assert the exact raw string survives. Assert aliases such as `사업자등록번호`, `지정번호`, `규격모델`, `물품분류번호`, and `물품분류명` also map.

```ts
expect(isTargetProductClassification("39121801-01")).toBe(true);
expect(isTargetProductClassification("44103103")).toBe(false);
expect(result.rows).toHaveLength(4);
expect(result.rows[0].certificationDetailsRaw).toContain('K마크,"A"\r\nGS');
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/excellent-products-csv.test.ts`

Expected: FAIL because the excellent-products modules do not exist.

- [ ] **Step 3: Implement fixed-prefix helpers and parser**

Export exactly these helpers and types:

```ts
export const TARGET_PRODUCT_CLASSIFICATION_PREFIX = "39121801";
export function normalizeProductClassificationNo(value: unknown): string;
export function isTargetProductClassification(value: unknown): boolean;
export function parseExcellentProductsCsv(content: string, sourceFileName: string): ExcellentProductCsvParseResult;
```

The record parser must track quote state across CR/LF, unescape doubled quotes, remove a leading BOM, reject duplicate/missing required headers, extract the first 8- or 10-digit classification token after removing punctuation, and retain `rawData` plus `certificationDetailsRaw`. Use `parseBusinessNumber` for business numbers and `createSourceRowHash` over business number, designation number, normalized classification, and specification.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm test -- tests/excellent-products-csv.test.ts`

Expected: all parser tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/excellent-products/constants.ts src/lib/excellent-products/types.ts src/lib/excellent-products/csv.ts tests/excellent-products-csv.test.ts
git commit -m "feat: parse building control excellent products"
```

### Task 2: SQLite schema and snapshot import

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/init.ts`
- Modify: `src/lib/contracts/repository.ts`
- Create: `src/lib/excellent-products/repository.ts`
- Test: `tests/excellent-products-repository.test.ts`
- Modify: `tests/db-schema.test.ts`

- [ ] **Step 1: Write failing schema and snapshot tests**

Initialize a temporary SQLite DB and assert tables `excellent_products`, `factory_locations`, and `company_industries` exist. Import a snapshot containing a duplicated source row, two designations for one business, and one other business. Assert three product rows, two businesses, and idempotent second import. Import a new valid snapshot and assert stale product rows disappear while factory/industry rows remain.

Also test that a later contract import with null profile fields does not overwrite an API-enriched business name, representative, phone, or address.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm test -- tests/db-schema.test.ts tests/excellent-products-repository.test.ts`

Expected: FAIL for missing tables and repository exports.

- [ ] **Step 3: Add schema and transactional snapshot replacement**

Add nullable `phone`, `profile_source`, and `last_synced_at` to `businesses` using idempotent `PRAGMA table_info` plus `ALTER TABLE` for existing databases. Define Drizzle columns in `schema.ts`.

Create `excellent_products` with the design fields and unique `(source_dataset, source_row_hash)`. Create `factory_locations` unique on `(biz_no_normalized, location, source)` and `company_industries` unique on `(biz_no_normalized, industry_code, industry_name, source)`.

Export:

```ts
export function replaceExcellentProductsSnapshot(
  db: Db,
  rows: ParsedExcellentProductRow[],
  sourceFileName: string,
): ExcellentProductImportResult;
```

Reject an empty target snapshot before opening the replacing transaction. Inside one transaction, upsert CSV fallback profiles without replacing non-null API values, delete only `excellent_products`, insert unique rows, and record an `import_runs` row with source name `excellent-products-csv`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/db-schema.test.ts tests/excellent-products-repository.test.ts tests/contracts-repository.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/db/schema.ts src/lib/db/init.ts src/lib/contracts/repository.ts src/lib/excellent-products/repository.ts tests/db-schema.test.ts tests/excellent-products-repository.test.ts tests/contracts-repository.test.ts
git commit -m "feat: store excellent product snapshots"
```

### Task 3: Joined query and exact CSV export

**Files:**
- Modify: `src/lib/excellent-products/repository.ts`
- Create: `src/lib/excellent-products/export.ts`
- Test: `tests/excellent-products-query.test.ts`
- Test: `tests/excellent-products-export.test.ts`

- [ ] **Step 1: Write failing joined-result and export tests**

Seed two designations for one company, multiple duplicate factories, and three industries. Assert every product remains a separate item, factory/industry arrays are deduplicated, `companyCount` is one, and `designationCount` is two. Assert API profile values win over CSV fallback values.

For export, parse the first CSV record and assert this exact 16-column order:

```ts
[
  "No.", "지정번호", "품명", "발급일자", "인정(연장)기간", "상호명",
  "사업자등록번호", "대표자명", "전화번호", "주소", "물품분류번호",
  "물품분류명", "규격모델", "인증내역", "생산지 (공장소재지)", "면허 현황",
]
```

Assert the output starts with `\ufeff`, contains 16 fields per row, uses `; ` between multiple factories/industries, and round-trips Korean, newlines, commas, and quotes.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- tests/excellent-products-query.test.ts tests/excellent-products-export.test.ts`

Expected: FAIL for missing query/export functions.

- [ ] **Step 3: Implement one-query product rows plus grouped children**

Export:

```ts
export function getBuildingControlExcellentProducts(db: Db): BuildingControlExcellentProductsResponse;
export function excellentProductsToCsv(items: ExcellentProductViewItem[]): string;
```

Use product rows as the cardinality root. Fetch child rows for the distinct business numbers, group with `Map<string, Set<string>>`, and never join two one-to-many child tables directly into product rows. Recheck the fixed prefix while reading so unrelated classifications cannot leak through even if the DB is manually modified.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/excellent-products-query.test.ts tests/excellent-products-export.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/excellent-products/repository.ts src/lib/excellent-products/export.ts tests/excellent-products-query.test.ts tests/excellent-products-export.test.ts
git commit -m "feat: query and export excellent products"
```

### Task 4: Official company, industry, and factory clients

**Files:**
- Create: `src/lib/g2b/user-info-client.ts`
- Create: `src/lib/g2b/shopping-mall-product-client.ts`
- Test: `tests/g2b-user-info-client.test.ts`
- Test: `tests/shopping-mall-product-client.test.ts`

- [ ] **Step 1: Write failing API parser/client tests**

Mock `fetch` and verify calls use:

```text
UsrInfoService02/getPrcrmntCorpBasicInfo02?inqryDiv=1&bizno=<10 digits>
UsrInfoService02/getPrcrmntCorpIndstrytyInfo02?inqryDiv=1&bizno=<10 digits>
ShoppingMallPrdctInfoService/getThptyUcntrctPrdctInfoList?inqryDiv=1&cntrctCorpNm=<name>
```

Test array, `{ item: [...] }`, single-item, and empty envelopes. Assert basic fields map from `corpNm`, `ceoNm`, `telNo`, `adrs`, `dtlAdrs`; industries map all `indstrytyCd`/`indstrytyNm`; product rows preserve `headOfficeLocation` from `hdoffceLocplc` separately from `factoryLocation` from `fctryLocplc`. Assert a head-office-only response produces no factory.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- tests/g2b-user-info-client.test.ts tests/shopping-mall-product-client.test.ts`

Expected: FAIL because clients do not exist.

- [ ] **Step 3: Implement paginated official clients**

Reuse `fetchG2bJson`, `redactG2bSecrets`, and existing provider-error conventions. Fetch page 1, read `totalCount`, then fetch remaining pages with `numOfRows=100`. Export typed functions:

```ts
export async function fetchCompanyBasicInfo(bizNoNormalized: string): Promise<CompanyBasicInfo | null>;
export async function fetchCompanyIndustries(bizNoNormalized: string): Promise<CompanyIndustryInfo[]>;
export async function fetchThirdPartyProducts(companyName: string): Promise<ShoppingMallProductInfo[]>;
```

Do not copy `headOfficeLocation` into `factoryLocation` under any condition.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/g2b-user-info-client.test.ts tests/shopping-mall-product-client.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/g2b/user-info-client.ts src/lib/g2b/shopping-mall-product-client.ts tests/g2b-user-info-client.test.ts tests/shopping-mall-product-client.test.ts
git commit -m "feat: add excellent product enrichment clients"
```

### Task 5: Distinct-business enrichment orchestration

**Files:**
- Create: `src/lib/excellent-products/enrichment.ts`
- Modify: `src/lib/excellent-products/repository.ts`
- Test: `tests/excellent-products-enrichment.test.ts`

- [ ] **Step 1: Write failing deduplication and persistence tests**

Seed five product rows for one business and two for another. Inject spies for all three clients. Assert each client is called twice total, not seven times. Return multiple industries and product rows with target and unrelated classifications. Assert only target factory locations persist, all industries persist, repeated sync replaces stale factories/industries, and one business failure is reported without rolling back the successful business.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `npm test -- tests/excellent-products-enrichment.test.ts`

Expected: FAIL for missing orchestrator.

- [ ] **Step 3: Implement sequential per-business transactions**

Export an injectable client interface and:

```ts
export async function syncBuildingControlCompanies(
  db: Db,
  clients?: ExcellentProductEnrichmentClients,
): Promise<ExcellentProductSyncResult>;
```

Select distinct business number plus CSV company name. For each business, call each API once. Persist basic profile only when returned. Replace that business's industries and factory locations in a transaction. Filter shopping rows with `isTargetProductClassification(row.detailedClassificationNo ?? row.classificationNo)`. Count `processedCompanies`, `updatedCompanies`, and structured errors with redacted messages.

- [ ] **Step 4: Run focused test and confirm GREEN**

Run: `npm test -- tests/excellent-products-enrichment.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/excellent-products/enrichment.ts src/lib/excellent-products/repository.ts tests/excellent-products-enrichment.test.ts
git commit -m "feat: sync excellent product companies"
```

### Task 6: Dedicated routes and CLI workflows

**Files:**
- Create: `src/app/api/excellent-products/building-control/route.ts`
- Create: `src/app/api/excellent-products/building-control/export/route.ts`
- Create: `src/app/api/excellent-products/building-control/sync/route.ts`
- Create: `scripts/import-excellent-products.ts`
- Create: `scripts/sync-excellent-products.ts`
- Modify: `package.json`
- Test: `tests/excellent-products-routes.test.ts`
- Test: `tests/excellent-products-cli.test.ts`

- [ ] **Step 1: Write failing route and CLI tests**

Route tests must use an isolated `DATABASE_URL`, assert the GET response shape and counts, assert export content type/disposition/BOM, and assert sync calls the orchestrator. CLI tests must execute the import against a temporary DB twice and assert stable row counts and nonzero exit for missing file, invalid CSV, and zero target rows.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- tests/excellent-products-routes.test.ts tests/excellent-products-cli.test.ts`

Expected: FAIL for missing routes/scripts.

- [ ] **Step 3: Implement routes and commands**

Every route opens `createDb()`, calls `initializeSqliteSchema`, and closes SQLite in `finally`. GET returns `{ classification: "39121801", companyCount, designationCount, items }`. Export uses filename `g2b-excellent-products-39121801.csv`. Sync returns HTTP 200 for partial success and 500 only when no company could be processed.

Add scripts:

```json
"excellent-products:import": "tsx scripts/import-excellent-products.ts",
"excellent-products:sync": "tsx scripts/sync-excellent-products.ts"
```

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/excellent-products-routes.test.ts tests/excellent-products-cli.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/app/api/excellent-products scripts/import-excellent-products.ts scripts/sync-excellent-products.ts package.json package-lock.json tests/excellent-products-routes.test.ts tests/excellent-products-cli.test.ts
git commit -m "feat: expose excellent product workflows"
```

### Task 7: Dedicated table UI and existing-app navigation

**Files:**
- Create: `src/components/ExcellentProductsApp.tsx`
- Create: `src/app/excellent-products/page.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/excellent-products-app.test.ts`
- Test: `tests/excellent-products-frontend.test.ts`

- [ ] **Step 1: Write failing UI source-contract tests**

Assert the page contains fixed `39121801` text, a `조달우수업체 전체 조회` button, `최신 정보 갱신`, `CSV 다운로드`, company/designation counts, company-name filter, all 16 headers, and sort controls for company, designation, issue date, and recognition period. Assert there is no product-classification input. Assert existing home contains a link to `/excellent-products` and still renders `ContractLookupApp`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- tests/excellent-products-app.test.ts tests/excellent-products-frontend.test.ts`

Expected: FAIL for missing component/page.

- [ ] **Step 3: Implement client-side load, filter, and sort UI**

The initial page shows the button and no external request. Clicking lookup fetches the dedicated GET route. Filter only by displayed company name. Sort on a copied array with deterministic designation number tie-break. Render certifications with `white-space: pre-wrap`; render multiple factories/industries as separate lines; use explicit missing-data labels. Link the company name to `/?bizNo=<normalized>` so the existing contract page remains the detail destination.

The sync button posts to the sync route and reloads DB results after completion. The CSV link targets the export route only after results have loaded.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/excellent-products-app.test.ts tests/excellent-products-frontend.test.ts`

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ExcellentProductsApp.tsx src/app/excellent-products/page.tsx src/app/page.tsx src/app/globals.css tests/excellent-products-app.test.ts tests/excellent-products-frontend.test.ts
git commit -m "feat: add excellent product lookup screen"
```

### Task 8: Operations documentation and regression verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document actual source and commands**

Document the official `조달청_우수제품 지정 내역` CSV, its report ID `UI-ADOSAA-005R`, the `npm run excellent-products:import -- <path>` command, optional `npm run excellent-products:sync`, the `/excellent-products` page, DB-only lookup behavior, API key requirement for refresh, source priority, and the fact that absent factory/license fields remain explicit missing data.

- [ ] **Step 2: Run all automated tests**

Run: `npm test`

Expected: all Vitest files pass with zero failures.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: Next.js build exits 0 and lists `/excellent-products` plus the three API routes.

- [ ] **Step 4: Run whitespace and scope checks**

Run: `git diff --check`

Expected: no output and exit 0.

Run: `git status --short`

Expected: only intentional feature/documentation files are present.

- [ ] **Step 5: Commit documentation or regression fixes**

```powershell
git add README.md
git commit -m "docs: explain excellent product data refresh"
```
