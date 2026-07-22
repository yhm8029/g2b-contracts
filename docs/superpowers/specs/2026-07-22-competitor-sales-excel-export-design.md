# Competitor Sales Excel Export Design

## Goal

Add an Excel download for the selected competitor-sales period without starting another slow G2B collection during the download.

## Workbook

The `.xlsx` workbook contains exactly two worksheets:

- `업체별 요약`: the 22 competitors in sales ranking order with company name, business number, excellent-product designation number and dates, contract count, contract amount, and latest contract date.
- `전체`: every related contract in the selected period with company/designation fields, contract and item names, agencies, contract date and method, amount and attribution, contract/notice numbers, and the best available G2B source URL.

Amounts are numeric Excel cells with a won number format. Headers are frozen and filtered so the workbook remains useful for sorting and analysis.

## Data And Safety

The export route accepts the same strict period parameters as the overview route. It reads the SQLite cache in cache-only mode and never calls the Public Data Portal. If stored coverage does not span the entire selected period, it returns HTTP 409 instead of exporting partial results.

The UI enables export only after the selected overview is complete and fresh. During partial collection or stale-data refresh, the control remains disabled with an accessible explanation.

## Architecture

- `src/lib/competitors/excel.ts` owns pure workbook mapping and ExcelJS serialization.
- `src/app/api/competitors/export/route.ts` validates the period, reads the cached overview, enforces complete coverage, and returns the workbook attachment.
- `src/components/CompetitorSalesApp.tsx` derives the export URL from the current selection and renders a download command in the panel header.
- ExcelJS is a server dependency; workbook generation does not enter the client bundle.

## Error Handling

- Invalid or duplicate period parameters: 400.
- Incomplete SQLite coverage: 409 with a Korean message.
- Database or workbook generation failure: 500 with a Korean message.
- The filename uses the selected period label, for example `competitor-sales-2026-Q3.xlsx`.

## Verification

- Unit tests inspect both worksheet names, column order, row counts, numeric amount cells, and source URLs.
- Route tests cover strict validation, cache-only service use, incomplete-cache rejection, and attachment headers.
- Frontend tests cover the URL and complete/fresh enablement rule.
- Full tests, TypeScript checking, production build, and a real downloaded workbook are verified before completion.
