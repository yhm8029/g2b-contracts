# G2B Contract Lookup Design

## Goal

Build a local-first web app that lets the user enter a Korean business registration number and see which Nara Market/G2B notices and contracts are associated with that business, including contract details, linked notice details, and source links.

## Scope

The first version is a focused single-business lookup tool, not a full procurement analytics platform.

Included:

- Search by business registration number.
- Normalize input with or without hyphens.
- Show matched contract rows from a local searchable index.
- Link each contract to available notice and contract source URLs.
- Enrich indexed rows with official Public Data Portal APIs where a notice number, contract number, or detail URL exists.
- Store data locally in SQLite.
- Keep the persistence layer portable enough to move to PostgreSQL for web deployment.
- Export current results to CSV.
- Show data freshness and source status so stale or partial records are visible.

Not included in the first version:

- User accounts.
- Scheduled background crawling in production.
- Bulk multi-business monitoring.
- Paid procurement data providers.
- Browser scraping of Nara Market pages.
- Automatic discovery of every historical contract only through live API scanning.

## Source Data Reality

The design uses a hybrid data model because the official APIs do not clearly expose a direct "search contracts by business registration number" condition.

Official data sources to use:

- Public Data Portal: PPS Nara Market Contract Information Service
  - Provides contract lists, contract details, change history, deletion history, and search by conditions such as contract date, confirmed contract number, request number, notice number, agency name, item name, contract method, and contract reference number.
  - Source: https://www.data.go.kr/data/15129427/openapi.do
- Public Data Portal: PPS Nara Market Bid Notice Information Service
  - Provides notice lists, notice details, base amount information, license restrictions, allowed regions, and change history by business category.
  - Source: https://www.data.go.kr/data/15129394/openapi.do
- Public Data Portal: PPS Nara Market Successful Bid Information Service
  - Provides bid opening results, final winning bidder data, ranking, and preliminary price information by business category.
  - Source: https://www.data.go.kr/data/15129397/openapi.do
- Public Data Portal file/report data such as business-level bidding and contract reports may be used to seed the local index when it includes a business registration number field.
  - Source example: https://www.data.go.kr/data/15050832/fileData.do

Design implication:

- Business-number search must run against a local indexed table.
- Official APIs are used to enrich, verify, and refresh rows rather than as the sole search mechanism.
- Rows must preserve source metadata so the user can see whether a field came from the local import, contract API, notice API, or winning-bid API.

## Recommended Approach

Use a local index plus API enrichment.

The app imports report/file data or user-provided seed files into SQLite, keyed by normalized business registration number. After the user searches, the app returns matching rows immediately from SQLite. For each row with a notice number, contract number, or source URL, the app can call official APIs to fill missing detail fields and refresh source links.

This avoids slow or incomplete live scanning while still keeping official API data in the loop.

Rejected alternatives:

- API-only: cleaner on paper, but unreliable for business-number lookup because the contract API search conditions do not clearly include business registration number.
- File-only: fast for business-number lookup, but weaker for current detail pages, status, and notice enrichment.

## User Experience

The first screen is a search-focused MVP:

- Header with app name, API key status, DB status, and latest import timestamp.
- Search form with:
  - business registration number input
  - optional date range
  - optional business category filter: goods, construction, services, foreign capital, unknown/all
  - search button
- Summary strip:
  - contract count
  - total contract amount
  - notice-linked count
  - latest contract date
- Results table:
  - contract date
  - contract name
  - notice name
  - contract amount
  - demand agency
  - contract agency
  - contract method
  - business category
  - source status
  - links: contract detail, notice detail, raw source
- Row detail drawer:
  - original imported fields
  - API-enriched fields
  - source URLs
  - last refresh timestamp
  - API errors if enrichment failed
- CSV export button for the current result set.

The UI should be dense and operational. It should not be a marketing landing page.

## Architecture

Use a Next.js + TypeScript app in `C:\Users\user\g2b-contracts`.

Primary modules:

- Next.js App Router for pages and server-side API routes.
- Drizzle ORM as the database access layer.
- SQLite for local development.
- PostgreSQL support through the same repository interfaces for deployment.
- Zod for input validation and API response parsing.
- Vitest for unit tests.

Recommended package choices:

- `next`, `react`, `react-dom`
- `typescript`, `tsx`, `vitest`
- `drizzle-orm`, `drizzle-kit`
- SQLite driver for local development
- PostgreSQL driver for deployment
- `zod`
- `lucide-react`

Drizzle is recommended over Prisma for this app because the data model is table-centric, query-heavy, and likely to need explicit SQL indexes and import/upsert behavior. Prisma is still viable, but Drizzle keeps the SQLite-to-PostgreSQL path simple without hiding SQL details that matter for search performance.

## Data Model

Use stable internal IDs and keep external identifiers as nullable indexed columns because official records vary by business category and source.

Tables:

### `businesses`

- `id`
- `biz_no_normalized`
- `biz_no_display`
- `business_name`
- `representative_name`
- `address`
- `created_at`
- `updated_at`

Indexes:

- unique `biz_no_normalized`
- index `business_name`

### `contract_records`

- `id`
- `business_id`
- `source_dataset`
- `source_row_hash`
- `business_category`
- `notice_no`
- `notice_order`
- `notice_name`
- `contract_no`
- `unified_contract_no`
- `contract_name`
- `contract_date`
- `current_contract_amount`
- `total_contract_amount`
- `demand_agency_code`
- `demand_agency_name`
- `contract_agency_code`
- `contract_agency_name`
- `contract_method`
- `winning_method`
- `business_name_at_contract`
- `biz_no_normalized`
- `contract_detail_url`
- `notice_detail_url`
- `raw_source_url`
- `source_status`
- `last_imported_at`
- `last_enriched_at`
- `created_at`
- `updated_at`

Indexes:

- `biz_no_normalized`
- `contract_date`
- `notice_no`
- `contract_no`
- `unified_contract_no`
- composite `biz_no_normalized, contract_date`
- unique `source_dataset, source_row_hash`

### `api_enrichment_logs`

- `id`
- `contract_record_id`
- `provider`
- `operation`
- `request_params_json`
- `response_status`
- `error_message`
- `created_at`

### `import_runs`

- `id`
- `source_name`
- `source_file_name`
- `row_count`
- `inserted_count`
- `updated_count`
- `skipped_count`
- `error_count`
- `started_at`
- `finished_at`
- `status`
- `notes`

## Data Flow

### Import

1. The user downloads or supplies a source file/report that includes business registration numbers and contract or notice identifiers.
2. `scripts/import-contract-index.ts` reads the file.
3. Each business number is normalized by removing non-digits.
4. Each row is validated with Zod.
5. The importer computes `source_row_hash`.
6. The importer upserts `businesses`.
7. The importer upserts `contract_records`.
8. The importer writes an `import_runs` summary.

### Search

1. The user enters a business registration number.
2. `src/lib/domain/business-number.ts` normalizes and validates it as 10 digits.
3. The server queries `contract_records` by `biz_no_normalized`.
4. Optional date and category filters are applied.
5. The UI renders table rows and summary metrics.

### Enrichment

1. A row with `notice_no` can be enriched through the notice API.
2. A row with `contract_no` or `unified_contract_no` can be enriched through the contract API.
3. A row with winning-bid identifiers can be enriched through the winning-bid API.
4. Parsed fields update nullable columns on `contract_records`.
5. Every enrichment attempt writes `api_enrichment_logs`.

## API Integration

Environment variables:

- `DATA_GO_KR_SERVICE_KEY`
- `DATABASE_URL`
- `DATABASE_PROVIDER=sqlite|postgres`
- `ENRICHMENT_ENABLED=true|false`

Provider modules:

- `src/lib/g2b/contract-info-client.ts`
- `src/lib/g2b/bid-notice-client.ts`
- `src/lib/g2b/successful-bid-client.ts`

Rules:

- Always request JSON where the API supports `type=json`.
- Treat response parsing as untrusted input and validate with Zod.
- Support pagination with `pageNo` and `numOfRows`.
- Rate-limit enrichment in scripts to avoid exhausting development traffic.
- Store raw error messages in logs, but do not expose API keys to the UI.

## Error Handling

Search errors:

- Invalid business number: show inline validation message.
- No local records: show empty state with import instructions.
- Database unavailable: show a server error banner and log the exception.

Import errors:

- Invalid rows are skipped and counted.
- Missing business number rows are skipped.
- Duplicate rows are upserted by `source_dataset + source_row_hash`.
- The import command exits non-zero only when the file cannot be read or the schema is incompatible.

API errors:

- API key missing: show "API enrichment disabled".
- API timeout: keep local row and mark enrichment failed.
- API schema mismatch: log provider, operation, and response status.
- No API match: keep local row and set `source_status=local_only`.

## Testing

Unit tests:

- Business number normalization and validation.
- Source row hash stability.
- CSV import row parsing.
- Repository search filters.
- API response parsers with fixture JSON.
- Source URL selection logic.

Integration tests:

- SQLite schema initialization.
- Import sample file into a temporary SQLite database.
- Search by business number returns expected rows.
- Enrichment updates only intended nullable fields.

UI tests can wait until after the MVP backend and repository layer are stable. The first implementation should still verify the main page manually with local sample data.

## Migration Path To Web Deployment

Keep all DB calls behind repository functions:

- `searchContractsByBusinessNumber`
- `upsertBusiness`
- `upsertContractRecord`
- `recordImportRun`
- `recordEnrichmentLog`

Local:

- SQLite file at `./data/g2b-contracts.sqlite`.

Deployment:

- PostgreSQL via `DATABASE_URL`.
- Same Drizzle schema, with provider-specific migration configuration.
- Import/enrichment scripts can run manually from an admin machine before adding scheduled jobs.

## Open Decisions For Implementation Planning

These are not blockers for the design, but they should be resolved before implementation:

- Which seed file/report will be the first supported import format.
- Whether the first importer accepts only CSV or also XLSX.
- Whether enrichment runs automatically after search or only via a button/script.
- Whether PostgreSQL deployment target is Vercel Postgres, Supabase, Neon, or another provider.

## Acceptance Criteria

The MVP is complete when:

- A user can run the app locally.
- A user can initialize a SQLite database.
- A user can import a supported seed file containing business registration numbers.
- A user can search a business registration number and see matching contract rows.
- Matching rows show linked notice/contract URLs when available.
- The app can export visible results to CSV.
- Missing API key does not break local search.
- Tests cover normalization, import parsing, repository search, and API parser fixtures.
