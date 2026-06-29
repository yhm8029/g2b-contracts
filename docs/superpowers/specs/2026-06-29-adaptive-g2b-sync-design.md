# Adaptive G2B Contract Sync Design

## Goal

Add a G2B API synchronization path so a business registration number search can fetch matching contract records from the Public Data Portal, store them in SQLite, and then show the refreshed local results.

The current app only searches records already imported into the local database. That is why a real business number can show one manually imported row even though the selected date range likely has more contracts. The new flow keeps the local-first model, but fills the local index from the official API before returning final results.

## Source API

Use `PubDataOpnStdService/getDataSetOpnStdCntrctInfo` from the G2B public data open standard service as the primary discovery endpoint.

The relevant request parameters are:

- `ServiceKey`: Public Data Portal service key.
- `type=json`: JSON response format.
- `pageNo`: page number.
- `numOfRows`: page size.
- `cntrctCnclsBgnDate`: contract conclusion start date in `YYYYMMDD`.
- `cntrctCnclsEndDate`: contract conclusion end date in `YYYYMMDD`.

The service documentation states a contract date range limit, and the current portal notice says the contract information operation may be temporarily limited from one month to one week. The implementation must therefore use adaptive chunking instead of assuming one fixed interval.

## Chunking Strategy

Use month-first adaptive chunking:

1. Split the user date range into calendar-month chunks.
2. Fetch each monthly chunk.
3. If a monthly chunk succeeds, keep its results.
4. If a monthly chunk fails with a date-range-limit style provider error, split only that month into week chunks and retry.
5. If a week chunk still fails due to date range, split that week into day chunks.
6. Non-range errors do not trigger smaller chunks automatically. They are reported as provider failures.

This keeps the normal request count low while still handling the portal's temporary one-week limit.

For `2025-01-01` to `2026-06-29`, the first pass is about 18 monthly chunks. Only chunks rejected by the provider are expanded to weekly chunks.

## Pagination

Each chunk must fetch all pages:

- Start with `pageNo=1`.
- Use a page size of 100 unless provider behavior forces a lower value.
- Continue until fetched item count reaches `totalCount`, or until the response returns no items.
- Guard against infinite loops with a maximum page cap per chunk.

The sync result should report chunk count, page count, fetched row count, matched row count, inserted count, updated count, and provider errors.

## Business Number Filtering

The API fetch is date-range based, not business-number indexed. The app must filter returned rows locally.

The matcher should:

- Normalize the user's business registration number to 10 digits.
- Inspect known supplier or winning-company business-number fields from the response.
- Normalize candidate values by stripping non-digits.
- Keep only rows where a candidate field equals the requested business number.

The parser should tolerate missing fields because public API field names can vary across data sources and versions. It should preserve raw row JSON for hashing/debugging.

## Import Mapping

Matched API rows are mapped into the existing contract repository shape and upserted into SQLite.

Required mapped fields:

- `biz_no`
- `business_name`
- `contract_date`
- `contract_name`

Best-effort optional mappings:

- supplier or winner name
- contract number
- unified contract number if present
- notice number and notice order
- notice name
- current contract amount
- total contract amount
- demand agency
- contract agency
- contract method
- winning method
- contract detail URL
- notice detail URL
- raw source URL

Rows that cannot provide the required fields should be skipped with a structured skip reason rather than crashing the whole sync.

## API Surface

Add a sync endpoint:

`POST /api/sync`

Request body:

```json
{
  "bizNo": "502-81-42086",
  "dateFrom": "2025-01-01",
  "dateTo": "2026-06-29",
  "businessCategory": "all"
}
```

Response body:

```json
{
  "status": "completed",
  "chunksAttempted": 18,
  "chunksExpanded": 18,
  "pagesFetched": 96,
  "rowsFetched": 9500,
  "rowsMatched": 12,
  "insertedCount": 11,
  "updatedCount": 1,
  "skippedCount": 0,
  "errors": []
}
```

If the API key is missing, return `403` with a clear message. If the key is not approved for the service and the provider returns `403`, surface a message that the Public Data Portal service usage approval is required for the G2B public data open standard service.

## UI Flow

The search screen should support two stages:

1. Immediate local search.
2. Optional G2B sync followed by refreshed local search.

Recommended behavior:

- Add a "Sync G2B" control next to Search, or make Search run sync when an "Include G2B API sync" toggle is enabled.
- Show progress text such as `Syncing G2B: 4/18 monthly chunks`.
- If a month is expanded, show `Some months retried weekly due to provider date range limits`.
- After sync completes, rerun local search and refresh the table, summaries, and CSV export state.
- If sync fails because the API key is missing or unauthorized, leave local results visible and show the provider error.

The app should not block the user from searching local data when G2B sync fails.

## Concurrency And Rate Limiting

Use bounded concurrency for chunk fetches:

- Default concurrency: 2 chunks at a time.
- Configurable via an environment variable later if needed.
- Retry transient network errors once with a short delay.
- Do not retry provider validation errors except by shrinking date chunks when the error indicates a range limit.

This avoids overloading the public API and reduces throttling risk.

## Persistence

Keep local-first persistence:

- Imported API rows use `sourceDataset = "g2b-public-standard-contract"`.
- `sourceRowHash` is computed from the raw provider row plus the normalized business number.
- Existing repository upsert behavior should be reused.
- API sync runs should be recorded in `import_runs` with a source name that distinguishes public API sync from CSV import.
- Provider responses should not store the service key.

## Error Handling

Errors are classified as:

- `missing_api_key`
- `unauthorized_service_key`
- `date_range_too_large`
- `provider_error`
- `network_error`
- `parse_error`
- `row_skipped`

The UI should show a concise summary, with technical details available in the detail area or console logs during development.

## Testing

Add tests for:

- Month chunk generation across partial months.
- Fallback from month to week, and week to day.
- Pagination termination.
- Business-number matching across candidate provider fields.
- Mapping provider rows into contract import rows.
- Sync endpoint behavior for missing key, unauthorized provider response, successful sync, and partial provider errors.

Network calls must be mocked in tests.

## Out Of Scope

- Full background job queue.
- Cross-user synchronization state.
- PostgreSQL migration work.
- Real-time server-sent progress updates.
- Automatic scheduled sync.

The first implementation can return progress only after completion. A richer progress UI can be added later.

## Self-Review

- No placeholders remain.
- The design keeps the existing local-first architecture.
- The chunking behavior is explicit: month first, fallback to week/day only when needed.
- API key and provider authorization errors are handled without storing secrets.
- Implementation scope is small enough for one follow-up plan.
