# Building-Control Award Market Share Design

## Goal

Extend the existing Windows Tauri competitor-sales application into a complete local market database for G2B building-control awards from 2025 onward. The application must collect every matching notice and final award, classify the representative winner using the excellent-product designation that was valid on the award date, provide year and quarter views, and export a workbook with a native editable Excel pie chart.

The implementation starts from `feature/g2b-contract-lookup`. It reuses the existing Next.js application, G2B HTTP/parsing helpers, SQLite conventions, portable Tauri packaging, and competitor screen patterns. It imports only the relevant official excellent-product API logic from `agent/building-control-excellent-products`; it does not restore that branch wholesale.

## Fixed Business Rules

- Data begins on `2025-01-01`. Earlier awards are out of scope.
- A notice is in scope only when its official purchase-target product data contains exactly `39121801` or `3912180101` after digit normalization. When a valid detailed code is present, it takes precedence and must equal `3912180101`; exact parent `39121801` is accepted only when the provider legitimately omits the detailed code. This prevents a sibling detailed code from qualifying only because its parent is `39121801`. Prefix-only matches and free-text title matches are not accepted.
- Code normalization converts full-width decimal digits to ASCII, trims Unicode whitespace, and permits whitespace or hyphens only as separators. It rejects every other character, preserves leading zeroes, and compares the resulting 8- or 10-digit string for exact equality. It never accepts a value by deleting arbitrary non-digits or coercing it to a number.
- Every matching notice published from `2025-01-01` onward is stored in SQLite, including cancelled, failed, rebid, in-progress, and no-award notices. Those statuses affect reporting eligibility, not inventory persistence.
- The selected period is based on the official final award date, not notice publication date, opening date, contract date, or collection date.
- The denominator is the number of distinct in-scope notices with a final award in the selected period.
- Each final notice contributes exactly one count. Rebid, failed, cancelled, in-progress, and no-award records do not enter the denominator.
- For a joint supply, the representative winning business receives the one notice count. Consortium members are retained in raw data when supplied but do not receive fractional or duplicate counts.
- Market share is `winner notice count / total final awarded notice count * 100`.
- The cooperative identity is business number `214-82-04708`, whose official name is `한국자동제어공업협동조합`.
- Classification precedence is cooperative, then award-date-valid excellent designation, then non-excellent.
- Cooperative results are aggregated under `빌딩자동제어공업협동조합` even if other evidence would otherwise qualify the business as excellent.
- Every business with a target excellent designation overlapping the selected period is listed individually, including zero-award businesses. Historical excellent businesses are not limited to the current hardcoded 22.
- All remaining winners are aggregated into one `조달우수X` category.
- Excellent status is immutable historical attribution: a later designation refresh must not reclassify an old award unless the official designation dates or award record were corrected.

## Source Data

### Bid notices and final awards

Use the official Public Data Portal services already represented in the repository:

- `BidPublicInfoService` for goods notices and purchase-target products.
- `ScsbidInfoService` for successful goods bids and final winner information.
- The local public-data service key is read through the existing secret-loading path. It is never written to source, URLs in logs, workbook cells, or raw response diagnostics.

Collection has two independently covered axes so report completeness is not inferred from notice publication dates:

1. Notice inventory queries goods notices by official publication date from `2025-01-01`, paginates every matching search result, and persists every exact-code notice regardless of outcome.
2. Award inventory uses bounded successful-result registration (`rgstDt`) windows as the incremental feed because the provider does not offer a final-award-date range query. `getScsbidListSttusThng` is a final successful-result feed: it retains one outcome per three-part result grain plus the outcome's `rbidNo` in the four-part source identity `(bidNtceNo, bidNtceOrd, bidClsfcNo, rbidNo)`. The collector does not invent a revision chain by comparing unrelated rows. It resolves the matching notice and paginated purchase-target rows at the same `bidClsfcNo` grain and filters the report by official `fnlSucsfDate >= 2025-01-01`. This path also captures a notice published before 2025 when its final award falls in the reporting period.

Final award date is the authority for the market denominator, but coverage separately proves successful-result registration ingestion and notice-product resolution. A publication-date coverage window can never prove an award-date report complete. The incremental feed retains unresolved results regardless of notice age, re-reads a documented registration-date safety overlap, and reconciles backdated registrations before advancing coverage.

Before historical backfill, a live API contract spike is a release gate. It records fixtures and verifies the supported bulk search operations, date parameters and inclusivity, `totalCount`/pagination behavior, parent and detailed product-code fields, final-result identity, final award date, final-winner business number/name, and API-key permission. The server-side detailed-code filter does not prove recall for exact parent-only rows, so the persisted/resumable production path uses exhaustive purchase-target pagination and exact local filtering. It respects daily limits and never marks unvisited pages complete.

`getScsbidListSttusThng` exposes one official final-winner business identity in `bidwinnrBizno`/`bidwinnrNm`; it does not expose a separate consortium-representative marker. Representative attribution therefore uses that singular provider final-winner identity only. The contract gate requires one valid ten-digit business number and one unambiguous winner per three-part `(bidNtceNo, bidNtceOrd, bidClsfcNo)` result grain, a numeric nonnegative `rbidNo`, and observed final-result examples with `rbidNo > 0`. Registration timestamps are parsed in their official format and every returned row must fall inside the requested Seoul window. Final-award-date availability is measured separately because the live feed contains rows with blank `fnlSucsfDate`; a target result with no resolved final award date is quarantined and keeps the affected report coverage incomplete rather than substituting `rgstDt`. The implementation must not infer a representative from row order, CEO name, company-name text, or registration date. Missing or conflicting identities are quarantined and keep award coverage incomplete.

The four-part source grain is collapsed to the one-notice denominator only after product/result correlation. If one notice has several target lots or terminal results, every target result must resolve to the same representative business to contribute one notice. Different target-lot winners make the notice ambiguous and block coverage until an approved business rule or corrected official result resolves it.

### Excellent-product designation history

Use the official anonymous G2B excellent-product designation list and detail endpoints implemented on `agent/building-control-excellent-products`:

- `selectElpdtSlctnSttusLst.do` supplies designation identity, business identity, validity dates, pagination, and detail request keys.
- `selectElpdtSlctnSttusDtl.do` is the authoritative source for deciding whether a designation contains exact classification `39121801` or exact detailed classification `3912180101`.

The current implementation's `applVldYn = 유효` query is insufficient for award-date history. A second live contract matrix is therefore part of the release gate. It verifies the supported all-status value, date-filter semantics, anonymous session access, total-count pagination, original/extension date formats, detail request keys, and representative fixtures for currently valid, expired, and extended designations. Historical backfill does not begin and the release cannot pass unless this contract is proven.

The contract probe established that `applVldYn: ""` is the all-status query. Its paginated union currently contains the exact observed statuses blank, `유효`, `만료`, and `효력정지`; `유효` and `만료` filtered totals must agree with their counts inside the all-status result. The anonymous bootstrap follows only the exact official origins `https://shop.g2b.go.kr` and `https://sso.g2b.go.kr`, stores cookies in separate per-origin jars, and rejects every other redirect or credential-bearing URL. After that gate, sync paginates the blank all-status query completely and fails closed on any new status value, count contraction, pagination mismatch, disallowed session redirect, invalid validity date, or list/detail identity mismatch. A designation is target evidence only after its official detail contains exact normalized classification `39121801` or `3912180101`. Product-title searches may locate bounded probe samples but are not membership evidence. Product-title token matching, classification prefix matching, the hardcoded competitor registry, Shopping Mall evidence, and the legacy CSV snapshot are not authoritative membership sources. The full list is checked for completeness on each designation sync, while details are fetched only for new or list-row-hash-changed identities; cached official details cover unchanged rows.

The effective end date is the official extension date when present, otherwise the official end date. Live rows with extension evidence currently repeat the effective extended date in both `dsgnExtsYmd` and `dsgnEndYmd`, so equality is valid and the original pre-extension end is nullable unless another official field supplies it. A nonblank extension earlier than the listed end fails closed. Status and cancellation/revocation effective dates are retained when supplied. An award is excellent only when `start_date <= final_award_date <= effective_end_date` and no cancellation or revocation was effective on that date. Multiple designations for one business are retained separately; any valid target designation qualifies that award. The report records the matched designation version, number, effective expiry date, and evidence hash.

Historical list completeness is fail-closed. If the all-status query is rejected, truncated, or omits required detail identities, the application preserves the previous complete designation history and marks classification coverage incomplete. It must not silently classify uncovered awards as `조달우수X`. A missing effective end date is displayed as `미확인` and also prevents award-date classification for the affected interval until corrected; it is not treated as an unlimited designation.

## SQLite Model

The portable database remains under the application's writable `data` directory. Existing schema initialization stays additive and idempotent.

### `building_control_notices`

- Integer `id` plus canonical notice identity: notice number plus normalized non-null notice order.
- Notice name, publication date, demand agency, notice URL, status, first/last seen timestamps.
- Normalized target product codes and raw notice JSON.
- Unique constraint on canonical notice identity and indexes for notice date and status.

### `building_control_notice_products`

- `notice_id`, normalized `bidClsfcNo`, provider row identity/order, parent `prdctClsfcNo`, detailed `dtilPrdctClsfcNo`, exact-match decision, source hash, raw JSON, and sync provenance.
- Every response page is validated against `totalCount`. Canonical notice target membership and award correlation are derived from these rows rather than a denormalized first product.
- Unique source identity includes `notice_id`, `bidClsfcNo`, and the stable provider product-row identity.

### `building_control_awards`

- `notice_id` as a unique foreign key to the canonical notice.
- Final award date, representative winner business number and name, award amount/rate when supplied, final-result identity, and raw award JSON.
- One active canonical final award per notice. If multiple lot/result rows do not resolve to one consistent official representative, no canonical award is published and the source window stays incomplete.
- Indexes for final award date and winner business number.

### `building_control_award_revisions`

- Append-only official final-result revisions keyed by `(notice_id, bidClsfcNo, rbidNo, provider result identity)`.
- Source status, winner rows, fetched timestamp, source hash, raw JSON, and the `sync_run_id` that observed it.
- The canonical award points to the selected latest valid revision, so provider corrections remain auditable.

### `excellent_designations`

- Stable designation identity with designation number, normalized business number, and the current canonical observation pointer.
- Rows are history-aware and are never deleted merely because a later provider snapshot omits them.
- Indexes support business-number lookup.

### `excellent_designation_observations`

- Append-only source versions keyed by designation identity, observed generation, and source hash.
- Official company/product names, start/original end/extension/effective end, status, cancellation/revocation effective dates, exact target classifications, list/detail identities, raw JSON, and sync provenance.
- Unexpected total-count contraction, duplicate identity, unstable pagination, missing validity fields, or unexplained disappearance fails the generation instead of deleting prior evidence.
- Indexes support business-number and validity-interval matching at award date.

### `award_classifications`

- Append-only classification facts for a canonical award revision: cooperative, excellent, or non-excellent.
- Stores the matched designation observation/version when applicable, evaluated interval, reason, evidence hash, and classification generation.
- The active fact changes only through a successful correction/reclassification generation. Prior facts remain auditable, so later provider changes cannot silently rewrite old attribution.

### `sync_runs` and coverage

- Trigger (`startup`, `manual`, or resume), source type, requested range, Seoul calendar date, started/completed timestamps, status, page/row counts, error code, and redacted message.
- Durable per-source coverage generations distinguish notice-publication, successful-result registration, notice-product resolution, final-award classification, and designation-history completeness. A report is complete only when all award/product and designation/classification generations needed by that period are complete.
- Staging rows are keyed by `sync_run_id` and date window. Only a validated generation is promoted to canonical tables; abandoned staging rows are safely removable after restart.
- A SQLite-backed lease prevents two application processes from publishing concurrently. Validated source generations are promoted with compare-and-swap of one active-generation pointer, so an older run cannot overwrite a newer run.
- A persisted successful startup-sync marker for the Seoul calendar date prevents a second automatic sync after application restart. A process-local mutex still coalesces concurrent requests within one process.
- Raw JSON is retained for auditability, but secrets and session cookies are never stored.

Schema changes are added to both the repository's idempotent initializer and Drizzle schema declarations. Upgrade tests start from a populated legacy portable database, not only an empty database.

## Synchronization

On first successful run, backfill notice-publication and successful-result-registration windows from `2025-01-01` through the current Seoul date, plus all designation intervals overlapping that range. Later runs re-fetch a trailing registration/publication safety window and any incomplete coverage, then continue to the current date. Each overlap constant is explicit and tested; it exists to absorb backdated registrations, delayed final results, and provider corrections.

The application attempts one automatic sync per Seoul calendar day on startup, guarded by the durable successful marker. `지금 갱신` runs the same pipeline on demand. Concurrent sync requests coalesce behind one process-local job so API pages are not duplicated.

Network work is staged outside the live report tables. A sync publishes notice, product, award, designation, classification, and coverage changes only after all required pages and details for a generation pass validation, then atomically flips the active-generation pointer. A fully scanned window reconciles its complete source identity set and deactivates rescinded awards or product rows corrected out of scope without deleting raw history. An upstream failure records a failed `sync_runs` row and leaves the previous active generation available. A partial first backfill may be resumed, but the UI and export cannot label an uncovered period complete.

Retries are limited to transient timeouts, rate limits, and provider 5xx responses with bounded exponential backoff. Authentication, schema, invalid parameter, and completeness errors fail immediately with redacted diagnostics.

## Aggregation

One pure report service owns both screen and workbook numbers. Its input is a normalized year or year-quarter range; its output contains:

- total final awarded notice count;
- category totals for excellent, non-excellent, and cooperative;
- one ordered market-share row per eligible excellent business plus `조달우수X` and the cooperative;
- detailed awarded notices with the matched designation and classification reason;
- completeness and last-successful-sync metadata.

Winner names are display metadata; normalized business number is the classification key. Company renames therefore do not split a business's counts. For an excellent business, use the official name associated with the designation valid on the award date, with the latest official profile name only as a fallback.

When a business has multiple overlapping target designations, the report DTO retains all of them. Each award records one deterministic match, ordered by latest effective end date and then designation number. The company summary shows the latest effective expiry plus an additional-designation count; the detail rows and designation-history worksheet expose every exact match.

Rows are ordered by count descending, then category priority, then Korean company name. Percentages are calculated from integer counts at full precision and formatted for display; displayed rounded percentages are not re-summed or used as source data.

## User Interface

The Tauri executable opens the actual market-share workspace, replacing the current 22-company-only behavior as the primary competitor view. Browser development mode remains supported for report and sync testing.

The top control row contains:

- year selection from 2025 through the current year;
- period selection for full year or Q1-Q4;
- `지금 갱신` with progress/disabled state;
- `Excel 내보내기` with a download icon.

The screen shows total final awards, excellent total, `조달우수X`, cooperative count, coverage, and last successful refresh. The main report combines a pie chart with a scannable table containing category/company, award count, denominator, market share, designation number, designation start date, and `유효 만료일`. A null date renders as `미확인`. Selecting a row filters or highlights the award detail list without changing the denominator.

Zero-count excellent businesses remain in the table and chart source/legend. A native pie chart cannot draw a visible zero-area slice, which is acceptable; the category must still be present in the source table.

Incomplete coverage and stale data are explicit states. Existing complete data remains visible after refresh failure, accompanied by an inline error and the last successful refresh timestamp.

## Editable Excel Export

The export is a newly created `.xlsx` workbook, not an image-based chart and not a template mutation. The Tauri Rust layer uses pinned `rust_xlsxwriter`, `serde`, and `tauri-plugin-dialog` dependencies to create native Excel chart objects. The web report service supplies the versioned aggregation DTO used on screen. One typed `save_market_share_workbook(dto)` command validates the DTO version and payload limit, opens the Windows save dialog itself, writes a sibling temporary file, and atomically renames it on success. It exposes no generic filesystem-write command.

The current Tauri window loads a dynamic loopback URL. Its v2 capability explicitly permits only the required command for the competitor window and a narrow `http://127.0.0.1:*` remote URL pattern; external origins cannot invoke it. Browser development mode has no Rust IPC, so native-chart export is unavailable there and the adapter is mocked in frontend tests. The packaged EXE is the supported export environment.

Workbook filename example: `빌딩자동제어_시장점유율_2026_Q1.xlsx`.

### `시장점유율`

- Selected period, total final awards, coverage, and generated timestamp.
- Editable source table with company/category, award count, denominator, formula-based market share with cached numeric results/recalculation enabled, designation dates, and effective expiry.
- Native Excel pie chart referencing the company-name and award-count cell ranges.
- Data labels show category name and percentage; legend remains enabled.
- Editing company names or counts in Excel changes the chart source. Users can directly change chart colors, labels, layout, title, and legend in Excel.

### `낙찰공고 상세`

- One row per counted notice with notice identity/name, target code, final award date, winner name/business number, award amount/rate, classification, matched designation, expiry, demand agency, and official source URL.
- Header freeze, autofilter, numeric/date cell types, and stable column order.

### `조달우수 지정이력`

- Every target designation relevant to the selected period, including zero-award businesses.
- Designation/business identity, product, start/end/extension/effective expiry, and overlap status.

Export is enabled only for complete cached coverage. It performs no public-data calls. Screen and workbook values must be semantically equal fields derived from the same versioned report DTO; generated workbook metadata need not be byte-identical.

## Error Handling

- Missing/invalid local API key: show a configuration error without exposing the key.
- Upstream timeout/rate limit: bounded retry, then preserve the prior database.
- Provider page-count mismatch, malformed JSON, or missing notice/winner identity: reject the affected sync unit as incomplete.
- An ambiguous representative winner or conflicting final-result revision is quarantined and blocks completeness; it is never assigned by row order.
- Designation-history coverage failure: preserve history and prevent uncovered `조달우수X` attribution.
- SQLite migration or transaction failure: roll back and keep the last usable schema/data when possible.
- Workbook save cancellation: no error toast and no partial file.
- Workbook generation/write failure: remove any incomplete output and show a Korean error message.
- A browser without Tauri IPC cannot invoke native workbook export; no weaker image-chart workbook is substituted.
- Sidecar/Tauri startup failure: retain existing portable log behavior with secrets redacted.

## Verification

### Unit tests

- Exact acceptance of `39121801` and `3912180101`; rejection of prefixes, neighboring codes, and title-only matches.
- Strict normalization tests cover full-width digits, allowed separators, leading zeroes, alphabetic suffixes, decimal-like values, and both parent/detailed API fields.
- Notice identity and final-result de-duplication, including rebids and revised results.
- Product/result correlation retains `bidClsfcNo`, selects terminal `rbidNo`, rejects cross-lot joins, and fails closed when target lots have different winners.
- Representative-winner attribution for a single winner and officially marked joint representative, plus quarantine for missing/conflicting/multiple-unmarked identities.
- Award-date boundary checks on designation start, original end, extension end, before-start, and after-expiry dates.
- Classification precedence: cooperative, valid excellent, then `조달우수X`.
- Historical businesses and zero-award excellent businesses remain in report rows.
- Year/Q1-Q4 Seoul date ranges, integer denominator, and full-precision market share.
- Provider pagination/completeness, status-union reconciliation, contraction/disappearance checks, independently versioned coverage, retry policy, secret redaction, and atomic preservation on failure.

### Integration tests

- SQLite initialization/migration, idempotent upserts, sync coverage, and restart persistence.
- Database lease, staging generation, compare-and-swap promotion, authoritative removal/deactivation, and audit preservation under overlapping sync processes.
- Exact-code notice inventory persists awarded, failed, cancelled, rebid, in-progress, and no-award fixtures while only canonical final awards enter the denominator.
- Two startups on the same Seoul date exercise the durable automatic-sync guard and issue only one automatic provider sync.
- API routes for report, refresh, progress, invalid periods, incomplete coverage, and refresh failure.
- One fixture dataset produces semantically identical screen DTO and workbook DTO fields/totals.
- Rust workbook tests unzip the XLSX package and verify worksheet names, chart XML, chart ranges, data-label percentage/category flags, formulas, typed cells, and row counts.
- Tauri command tests cover save cancellation, successful write, invalid payload, and cleanup after failure.

### End-to-end acceptance

- `npm run build:portable` produces the named Windows `.exe` plus its private runtime folder, and the EXE launches on a supported clean Windows machine with WebView2 but without globally installed Node, npm, Rust, or project dependencies.
- With the local API key, it backfills 2025 onward, restarts from SQLite, and performs at most one automatic daily refresh.
- Year and quarter switches produce expected totals and winner shares.
- The generated workbook opens without repair warnings in desktop Excel.
- Editing a source count or company name updates the native pie chart, and Excel exposes normal chart editing controls.
- Desktop and narrow-window screenshots show no overlapping controls, labels, chart, or table content.
- A packaged smoke test invokes the real Tauri save command, opens the resulting workbook package for validation, and confirms that an external web origin cannot invoke the command.

## Delivery Workflow

All source-code implementation is generated through the locally configured `MiniMax-M3` model. Codex owns requirements, architecture, task decomposition, review, test execution, and acceptance. Lightweight independent checks may be delegated to Luna, broader implementation review to Terra, and high-risk architecture or data-correctness review to Sol, as requested. Codex may edit design/review documentation but does not author the production implementation.

## Non-Goals

- Awards before 2025.
- Amount-based market share; this version is notice-count based.
- Fractional consortium allocation.
- Manual CSV selection of excellent companies.
- Hardcoding the current 22 as the authoritative registry.
- General-purpose product-code search outside the two fixed target codes.
- Editing an existing customer workbook template.
