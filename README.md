# G2B Contract Lookup

G2B Contract Lookup is a local-first web app for searching imported G2B/Nara Market contract records by business registration number.

## Setup

```powershell
npm install
copy .env.local.example .env.local
npm run db:init
npm run contracts:import -- data/sample-contracts.csv
npm run dev
```

Open `http://localhost:3000` and search for `123-45-67890`.

## Data Model

Business-number lookup is local-index-first. Imported contract rows are stored locally and searched from the local index before any enrichment is considered.

Public Data Portal APIs enrich existing rows when a record already has notice or contract identifiers. Enrichment adds details to known records; it does not replace the local business-number index as the source for lookup.

## Commands

- `npm run db:init` initializes the local database schema.
- `npm run contracts:import -- data/sample-contracts.csv` imports the sample contract index CSV.
- `npm run contracts:enrich -- <record-id>` enriches one existing imported record with Public Data Portal data when identifiers are available.
- `npm test` runs the test suite.
- `npm run build` builds the Next.js app.
