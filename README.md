# G2B Contract Lookup

G2B Contract Lookup is a local-first web app for searching G2B/Nara Market contract records by business registration number.

## Setup

```powershell
npm install
copy .env.local.example .env.local
npm run db:init
npm run contracts:import -- data/sample-contracts.csv
npm run dev
```

Open `http://localhost:3000` and search for `123-45-67890`.

## Search And Sync

Search is local-only. It reads contract rows from the SQLite database at `data/g2b-contracts.sqlite` by default and does not call the G2B provider.

Use **Sync G2B** to fetch provider data into SQLite first. After the sync stores matching records locally, Search can show them.

G2B sync requires `DATA_GO_KR_SERVICE_KEY` in `.env.local` and Public Data Portal usage approval for **조달청_나라장터 계약정보서비스**. The sync queries goods, services, construction, and foreign contract divisions by month-sized date chunks, then retries smaller chunks when the provider rejects a date range.

## Commands

- `npm run db:init` initializes the local database schema.
- `npm run contracts:import -- data/sample-contracts.csv` imports the sample contract index CSV.
- `npm run contracts:enrich -- <record-id>` enriches one existing imported record with Public Data Portal data when identifiers are available.
- `npm test` runs the test suite.
- `npm run build` builds the Next.js app.
