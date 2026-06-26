# G2B Contract Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Next.js app that searches imported G2B contract records by business registration number, shows linked contract/notice source URLs, supports CSV export, and can enrich rows through Public Data Portal APIs.

**Architecture:** Use Next.js App Router with focused server API routes, Drizzle repositories, and a SQLite-first schema that can be migrated to PostgreSQL. Search is local-index-first; official G2B APIs enrich existing rows but do not drive business-number discovery.

**Tech Stack:** Next.js, React, TypeScript, Drizzle ORM, better-sqlite3, Zod, Vitest, tsx, lucide-react.

---

## Resolved Implementation Decisions

- First supported import format: CSV.
- Required CSV headers: `biz_no`, `business_name`, `contract_date`, `contract_name`.
- Optional CSV headers: `representative_name`, `address`, `business_category`, `notice_no`, `notice_order`, `notice_name`, `contract_no`, `unified_contract_no`, `current_contract_amount`, `total_contract_amount`, `demand_agency_code`, `demand_agency_name`, `contract_agency_code`, `contract_agency_name`, `contract_method`, `winning_method`, `business_name_at_contract`, `contract_detail_url`, `notice_detail_url`, `raw_source_url`.
- Enrichment trigger: explicit script and explicit API route, not automatic during search.
- Local DB: `./data/g2b-contracts.sqlite`.
- Default dev port: Next.js default `3000`, unless already occupied.

## File Structure

- Create `package.json`: scripts and dependencies.
- Create `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `drizzle.config.ts`: project config.
- Create `.gitignore`, `.env.local.example`: local hygiene and environment contract.
- Create `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`: main app surface.
- Create `src/app/api/search/route.ts`, `src/app/api/export/route.ts`, `src/app/api/enrich/route.ts`: server API.
- Create `src/components/ContractLookupApp.tsx`: client UI.
- Create `src/lib/domain/business-number.ts`, `src/lib/domain/source-row-hash.ts`, `src/lib/domain/money.ts`: pure domain helpers.
- Create `src/lib/import/csv.ts`: CSV parser and mapper.
- Create `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `src/lib/db/init.ts`: persistence setup.
- Create `src/lib/contracts/repository.ts`, `src/lib/contracts/types.ts`, `src/lib/contracts/summary.ts`: contract search boundary.
- Create `src/lib/g2b/http.ts`, `src/lib/g2b/contract-info-client.ts`, `src/lib/g2b/bid-notice-client.ts`, `src/lib/g2b/successful-bid-client.ts`, `src/lib/g2b/enrichment.ts`: official API clients and enrichment orchestrator.
- Create `src/lib/export/csv.ts`: export formatter.
- Create `scripts/db-init.ts`, `scripts/import-contract-index.ts`, `scripts/enrich-g2b-details.ts`: local commands.
- Create `tests/*.test.ts` and `tests/fixtures/*.json`: focused coverage.
- Create `data/sample-contracts.csv`: deterministic local sample.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `vitest.config.ts`
- Create: `drizzle.config.ts`
- Create: `.gitignore`
- Create: `.env.local.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "g2b-contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "db:init": "tsx scripts/db-init.ts",
    "contracts:import": "tsx scripts/import-contract-index.ts",
    "contracts:enrich": "tsx scripts/enrich-g2b-details.ts"
  },
  "dependencies": {
    "@libsql/client": "^0.15.15",
    "better-sqlite3": "^12.4.1",
    "drizzle-orm": "^0.45.0",
    "lucide-react": "^0.468.0",
    "next": "^15.1.0",
    "postgres": "^3.4.5",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.1",
    "drizzle-kit": "^0.30.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and the command exits with code 0.

- [ ] **Step 3: Add TypeScript and framework config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

Create `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/g2b-contracts.sqlite",
  },
});
```

- [ ] **Step 4: Add ignore and env example files**

Create `.gitignore`:

```gitignore
node_modules/
.next/
data/*.sqlite
data/*.sqlite-shm
data/*.sqlite-wal
.env.local
*.log
```

Create `.env.local.example`:

```bash
DATABASE_PROVIDER=sqlite
DATABASE_URL=./data/g2b-contracts.sqlite
DATA_GO_KR_SERVICE_KEY=
ENRICHMENT_ENABLED=false
```

- [ ] **Step 5: Add minimal app shell**

Create `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "G2B Contract Lookup",
  description: "Local business-number lookup for G2B contract records.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

Create `src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="app-panel">
        <h1>G2B Contract Lookup</h1>
        <p>Search imported G2B contract records by business registration number.</p>
      </section>
    </main>
  );
}
```

Create `src/app/globals.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, Helvetica, sans-serif;
  color: #172033;
  background: #f6f8fb;
}

button,
input,
select {
  font: inherit;
}

.page-shell {
  min-height: 100vh;
  padding: 32px;
}

.app-panel {
  max-width: 1180px;
  margin: 0 auto;
}
```

- [ ] **Step 6: Verify scaffold**

Run: `npm test`

Expected: Vitest reports no test files or passes once tests exist. If Vitest fails because no tests exist, continue to Task 2 and run the first real test.

- [ ] **Step 7: Commit scaffold**

```bash
git add package.json package-lock.json tsconfig.json next.config.mjs vitest.config.ts drizzle.config.ts .gitignore .env.local.example src/app
git commit -m "chore: scaffold g2b contract app"
```

---

### Task 2: Domain Helpers

**Files:**
- Create: `src/lib/domain/business-number.ts`
- Create: `src/lib/domain/source-row-hash.ts`
- Create: `src/lib/domain/money.ts`
- Create: `tests/business-number.test.ts`
- Create: `tests/source-row-hash.test.ts`
- Create: `tests/money.test.ts`

- [ ] **Step 1: Write failing business number tests**

Create `tests/business-number.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBusinessNumber, normalizeBusinessNumber, parseBusinessNumber } from "@/lib/domain/business-number";

describe("business-number", () => {
  it("normalizes hyphenated input", () => {
    expect(normalizeBusinessNumber("123-45-67890")).toBe("1234567890");
  });

  it("rejects non-10-digit input", () => {
    expect(() => parseBusinessNumber("123")).toThrow("Business registration number must contain 10 digits.");
  });

  it("formats normalized input for display", () => {
    expect(formatBusinessNumber("1234567890")).toBe("123-45-67890");
  });
});
```

- [ ] **Step 2: Verify failing business number test**

Run: `npm test -- tests/business-number.test.ts`

Expected: FAIL with module not found for `@/lib/domain/business-number`.

- [ ] **Step 3: Implement business number helper**

Create `src/lib/domain/business-number.ts`:

```ts
export function normalizeBusinessNumber(input: string): string {
  return input.replace(/\D/g, "");
}

export function parseBusinessNumber(input: string): string {
  const normalized = normalizeBusinessNumber(input);
  if (!/^\d{10}$/.test(normalized)) {
    throw new Error("Business registration number must contain 10 digits.");
  }
  return normalized;
}

export function formatBusinessNumber(normalized: string): string {
  const value = parseBusinessNumber(normalized);
  return `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}`;
}
```

- [ ] **Step 4: Add row hash and money tests**

Create `tests/source-row-hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";

describe("createSourceRowHash", () => {
  it("is stable regardless of object key order", () => {
    const a = createSourceRowHash({ biz_no: "123", contract_no: "A", amount: "1000" });
    const b = createSourceRowHash({ amount: "1000", contract_no: "A", biz_no: "123" });
    expect(a).toBe(b);
  });
});
```

Create `tests/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAmountToWon } from "@/lib/domain/money";

describe("parseAmountToWon", () => {
  it("parses commas and blank values", () => {
    expect(parseAmountToWon("1,234,500")).toBe(1234500);
    expect(parseAmountToWon("")).toBeNull();
  });
});
```

- [ ] **Step 5: Verify failing helper tests**

Run: `npm test -- tests/source-row-hash.test.ts tests/money.test.ts`

Expected: FAIL with module not found errors.

- [ ] **Step 6: Implement row hash and money helpers**

Create `src/lib/domain/source-row-hash.ts`:

```ts
import { createHash } from "node:crypto";

type HashableRecord = Record<string, string | number | null | undefined>;

export function createSourceRowHash(row: HashableRecord): string {
  const canonical = Object.keys(row)
    .sort()
    .map((key) => [key, row[key] ?? ""])
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("|");

  return createHash("sha256").update(canonical).digest("hex");
}
```

Create `src/lib/domain/money.ts`:

```ts
export function parseAmountToWon(input: string | null | undefined): number | null {
  const value = String(input ?? "").replace(/[,\s]/g, "");
  if (value.length === 0) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}
```

- [ ] **Step 7: Verify domain helpers pass**

Run: `npm test -- tests/business-number.test.ts tests/source-row-hash.test.ts tests/money.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit domain helpers**

```bash
git add src/lib/domain tests/business-number.test.ts tests/source-row-hash.test.ts tests/money.test.ts
git commit -m "feat: add contract lookup domain helpers"
```

---

### Task 3: Database Schema And Init

**Files:**
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/db/init.ts`
- Create: `scripts/db-init.ts`
- Create: `tests/db-schema.test.ts`

- [ ] **Step 1: Write failing DB init test**

Create `tests/db-schema.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initializeSqliteSchema } from "@/lib/db/init";

describe("initializeSqliteSchema", () => {
  it("creates required tables and indexes", () => {
    const dir = mkdtempSync(join(tmpdir(), "g2b-db-"));
    const db = new Database(join(dir, "test.sqlite"));

    initializeSqliteSchema(db);

    const tables = db.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(["api_enrichment_logs", "businesses", "contract_records", "import_runs"]);
  });
});
```

- [ ] **Step 2: Verify failing DB init test**

Run: `npm test -- tests/db-schema.test.ts`

Expected: FAIL with module not found for `@/lib/db/init`.

- [ ] **Step 3: Implement Drizzle schema**

Create `src/lib/db/schema.ts`:

```ts
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const businesses = sqliteTable(
  "businesses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    bizNoDisplay: text("biz_no_display").notNull(),
    businessName: text("business_name"),
    representativeName: text("representative_name"),
    address: text("address"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    bizNoUnique: uniqueIndex("businesses_biz_no_unique").on(table.bizNoNormalized),
    businessNameIdx: index("businesses_business_name_idx").on(table.businessName),
  }),
);

export const contractRecords = sqliteTable(
  "contract_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    businessId: integer("business_id").references(() => businesses.id),
    sourceDataset: text("source_dataset").notNull(),
    sourceRowHash: text("source_row_hash").notNull(),
    businessCategory: text("business_category").notNull().default("unknown"),
    noticeNo: text("notice_no"),
    noticeOrder: text("notice_order"),
    noticeName: text("notice_name"),
    contractNo: text("contract_no"),
    unifiedContractNo: text("unified_contract_no"),
    contractName: text("contract_name").notNull(),
    contractDate: text("contract_date").notNull(),
    currentContractAmount: integer("current_contract_amount"),
    totalContractAmount: integer("total_contract_amount"),
    demandAgencyCode: text("demand_agency_code"),
    demandAgencyName: text("demand_agency_name"),
    contractAgencyCode: text("contract_agency_code"),
    contractAgencyName: text("contract_agency_name"),
    contractMethod: text("contract_method"),
    winningMethod: text("winning_method"),
    businessNameAtContract: text("business_name_at_contract"),
    bizNoNormalized: text("biz_no_normalized").notNull(),
    contractDetailUrl: text("contract_detail_url"),
    noticeDetailUrl: text("notice_detail_url"),
    rawSourceUrl: text("raw_source_url"),
    sourceStatus: text("source_status").notNull().default("local_only"),
    lastImportedAt: text("last_imported_at").notNull(),
    lastEnrichedAt: text("last_enriched_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    bizNoIdx: index("contract_records_biz_no_idx").on(table.bizNoNormalized),
    contractDateIdx: index("contract_records_contract_date_idx").on(table.contractDate),
    noticeNoIdx: index("contract_records_notice_no_idx").on(table.noticeNo),
    contractNoIdx: index("contract_records_contract_no_idx").on(table.contractNo),
    unifiedContractNoIdx: index("contract_records_unified_contract_no_idx").on(table.unifiedContractNo),
    bizNoDateIdx: index("contract_records_biz_no_date_idx").on(table.bizNoNormalized, table.contractDate),
    sourceUnique: uniqueIndex("contract_records_source_unique").on(table.sourceDataset, table.sourceRowHash),
  }),
);

export const apiEnrichmentLogs = sqliteTable("api_enrichment_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractRecordId: integer("contract_record_id").references(() => contractRecords.id),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  requestParamsJson: text("request_params_json").notNull(),
  responseStatus: text("response_status").notNull(),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
});

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceName: text("source_name").notNull(),
  sourceFileName: text("source_file_name").notNull(),
  rowCount: integer("row_count").notNull(),
  insertedCount: integer("inserted_count").notNull(),
  updatedCount: integer("updated_count").notNull(),
  skippedCount: integer("skipped_count").notNull(),
  errorCount: integer("error_count").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  notes: text("notes"),
});
```

- [ ] **Step 4: Implement SQLite init and client**

Create `src/lib/db/init.ts`:

```ts
import type Database from "better-sqlite3";

export function initializeSqliteSchema(db: Database.Database): void {
  db.exec(`
    create table if not exists businesses (
      id integer primary key autoincrement,
      biz_no_normalized text not null,
      biz_no_display text not null,
      business_name text,
      representative_name text,
      address text,
      created_at text not null,
      updated_at text not null
    );
    create unique index if not exists businesses_biz_no_unique on businesses (biz_no_normalized);
    create index if not exists businesses_business_name_idx on businesses (business_name);

    create table if not exists contract_records (
      id integer primary key autoincrement,
      business_id integer references businesses(id),
      source_dataset text not null,
      source_row_hash text not null,
      business_category text not null default 'unknown',
      notice_no text,
      notice_order text,
      notice_name text,
      contract_no text,
      unified_contract_no text,
      contract_name text not null,
      contract_date text not null,
      current_contract_amount integer,
      total_contract_amount integer,
      demand_agency_code text,
      demand_agency_name text,
      contract_agency_code text,
      contract_agency_name text,
      contract_method text,
      winning_method text,
      business_name_at_contract text,
      biz_no_normalized text not null,
      contract_detail_url text,
      notice_detail_url text,
      raw_source_url text,
      source_status text not null default 'local_only',
      last_imported_at text not null,
      last_enriched_at text,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists contract_records_biz_no_idx on contract_records (biz_no_normalized);
    create index if not exists contract_records_contract_date_idx on contract_records (contract_date);
    create index if not exists contract_records_notice_no_idx on contract_records (notice_no);
    create index if not exists contract_records_contract_no_idx on contract_records (contract_no);
    create index if not exists contract_records_unified_contract_no_idx on contract_records (unified_contract_no);
    create index if not exists contract_records_biz_no_date_idx on contract_records (biz_no_normalized, contract_date);
    create unique index if not exists contract_records_source_unique on contract_records (source_dataset, source_row_hash);

    create table if not exists api_enrichment_logs (
      id integer primary key autoincrement,
      contract_record_id integer references contract_records(id),
      provider text not null,
      operation text not null,
      request_params_json text not null,
      response_status text not null,
      error_message text,
      created_at text not null
    );

    create table if not exists import_runs (
      id integer primary key autoincrement,
      source_name text not null,
      source_file_name text not null,
      row_count integer not null,
      inserted_count integer not null,
      updated_count integer not null,
      skipped_count integer not null,
      error_count integer not null,
      started_at text not null,
      finished_at text,
      status text not null,
      notes text
    );
  `);
}
```

Create `src/lib/db/client.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function getDatabasePath(): string {
  const raw = process.env.DATABASE_URL ?? "./data/g2b-contracts.sqlite";
  return resolve(raw);
}

export function createSqliteConnection(path = getDatabasePath()) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  return sqlite;
}

export function createDb(path?: string) {
  const sqlite = createSqliteConnection(path);
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
```

- [ ] **Step 5: Add init script**

Create `scripts/db-init.ts`:

```ts
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";

const { sqlite } = createDb();
initializeSqliteSchema(sqlite);
sqlite.close();

console.log("Initialized SQLite database.");
```

- [ ] **Step 6: Verify DB init**

Run: `npm test -- tests/db-schema.test.ts`

Expected: PASS.

Run: `npm run db:init`

Expected: prints `Initialized SQLite database.` and creates `data/g2b-contracts.sqlite`.

- [ ] **Step 7: Commit DB schema**

```bash
git add src/lib/db scripts/db-init.ts tests/db-schema.test.ts
git commit -m "feat: add sqlite schema initialization"
```

---

### Task 4: CSV Import Parser And Sample Data

**Files:**
- Create: `src/lib/import/csv.ts`
- Create: `data/sample-contracts.csv`
- Create: `tests/import-csv.test.ts`

- [ ] **Step 1: Write failing CSV parser test**

Create `tests/import-csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseContractCsv } from "@/lib/import/csv";

describe("parseContractCsv", () => {
  it("parses required and optional columns", () => {
    const csv = [
      "biz_no,business_name,contract_date,contract_name,current_contract_amount,notice_no,contract_detail_url",
      "123-45-67890,Sample Co,2026-01-15,Printer supply,1200000,20260123456,https://example.test/contract",
    ].join("\n");

    const result = parseContractCsv(csv, "sample.csv");

    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({
      bizNoNormalized: "1234567890",
      businessName: "Sample Co",
      contractName: "Printer supply",
      currentContractAmount: 1200000,
      noticeNo: "20260123456",
    });
    expect(result.errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failing CSV parser test**

Run: `npm test -- tests/import-csv.test.ts`

Expected: FAIL with module not found for `@/lib/import/csv`.

- [ ] **Step 3: Implement CSV parser**

Create `src/lib/import/csv.ts`:

```ts
import { z } from "zod";
import { formatBusinessNumber, parseBusinessNumber } from "@/lib/domain/business-number";
import { parseAmountToWon } from "@/lib/domain/money";
import { createSourceRowHash } from "@/lib/domain/source-row-hash";

const requiredHeaders = ["biz_no", "business_name", "contract_date", "contract_name"];

export type ParsedContractCsvRow = {
  sourceDataset: string;
  sourceRowHash: string;
  bizNoNormalized: string;
  bizNoDisplay: string;
  businessName: string;
  representativeName: string | null;
  address: string | null;
  businessCategory: string;
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  contractNo: string | null;
  unifiedContractNo: string | null;
  contractName: string;
  contractDate: string;
  currentContractAmount: number | null;
  totalContractAmount: number | null;
  demandAgencyCode: string | null;
  demandAgencyName: string | null;
  contractAgencyCode: string | null;
  contractAgencyName: string | null;
  contractMethod: string | null;
  winningMethod: string | null;
  businessNameAtContract: string | null;
  contractDetailUrl: string | null;
  noticeDetailUrl: string | null;
  rawSourceUrl: string | null;
};

export type ContractCsvParseResult = {
  validRows: ParsedContractCsvRow[];
  errors: string[];
};

const rowSchema = z.object({
  biz_no: z.string().min(1),
  business_name: z.string().min(1),
  contract_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contract_name: z.string().min(1),
});

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function nullable(value: string | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseContractCsv(content: string, sourceFileName: string): ContractCsvParseResult {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { validRows: [], errors: ["CSV file is empty."] };

  const headers = splitCsvLine(lines[0]);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    return { validRows: [], errors: [`Missing required CSV headers: ${missingHeaders.join(", ")}`] };
  }

  const validRows: ParsedContractCsvRow[] = [];
  const errors: string[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = splitCsvLine(lines[index]);
    const raw = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`Row ${index + 1}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      continue;
    }

    try {
      const bizNoNormalized = parseBusinessNumber(raw.biz_no);
      const sourceDataset = `csv:${sourceFileName}`;
      validRows.push({
        sourceDataset,
        sourceRowHash: createSourceRowHash(raw),
        bizNoNormalized,
        bizNoDisplay: formatBusinessNumber(bizNoNormalized),
        businessName: raw.business_name,
        representativeName: nullable(raw.representative_name),
        address: nullable(raw.address),
        businessCategory: nullable(raw.business_category) ?? "unknown",
        noticeNo: nullable(raw.notice_no),
        noticeOrder: nullable(raw.notice_order),
        noticeName: nullable(raw.notice_name),
        contractNo: nullable(raw.contract_no),
        unifiedContractNo: nullable(raw.unified_contract_no),
        contractName: raw.contract_name,
        contractDate: raw.contract_date,
        currentContractAmount: parseAmountToWon(raw.current_contract_amount),
        totalContractAmount: parseAmountToWon(raw.total_contract_amount),
        demandAgencyCode: nullable(raw.demand_agency_code),
        demandAgencyName: nullable(raw.demand_agency_name),
        contractAgencyCode: nullable(raw.contract_agency_code),
        contractAgencyName: nullable(raw.contract_agency_name),
        contractMethod: nullable(raw.contract_method),
        winningMethod: nullable(raw.winning_method),
        businessNameAtContract: nullable(raw.business_name_at_contract),
        contractDetailUrl: nullable(raw.contract_detail_url),
        noticeDetailUrl: nullable(raw.notice_detail_url),
        rawSourceUrl: nullable(raw.raw_source_url),
      });
    } catch (error) {
      errors.push(`Row ${index + 1}: ${(error as Error).message}`);
    }
  }

  return { validRows, errors };
}
```

- [ ] **Step 4: Add deterministic sample CSV**

Create `data/sample-contracts.csv`:

```csv
biz_no,business_name,representative_name,address,business_category,notice_no,notice_order,notice_name,contract_no,unified_contract_no,contract_name,contract_date,current_contract_amount,total_contract_amount,demand_agency_name,contract_agency_name,contract_method,winning_method,business_name_at_contract,contract_detail_url,notice_detail_url,raw_source_url
123-45-67890,Sample Office Co,Kim Test,Seoul,goods,20260123456,00,Office printer bid,CN-2026-0001,UCN-2026-0001,Printer supply,2026-01-15,1200000,1200000,Seoul Test Office,Seoul Test Office,Limited competition,Lowest price,Sample Office Co,https://example.test/contract/1,https://example.test/notice/1,https://example.test/raw/1
1234567890,Sample Office Co,Kim Test,Seoul,services,20260123457,00,Maintenance service bid,CN-2026-0002,UCN-2026-0002,Maintenance service,2026-03-20,3400000,3400000,Seoul Test Office,Seoul Test Office,Negotiated contract,Best value,Sample Office Co,https://example.test/contract/2,https://example.test/notice/2,https://example.test/raw/2
```

- [ ] **Step 5: Verify CSV parser**

Run: `npm test -- tests/import-csv.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit CSV parser**

```bash
git add src/lib/import tests/import-csv.test.ts data/sample-contracts.csv
git commit -m "feat: parse contract index csv"
```

---

### Task 5: Contract Repository And Import Script

**Files:**
- Create: `src/lib/contracts/types.ts`
- Create: `src/lib/contracts/repository.ts`
- Create: `src/lib/contracts/summary.ts`
- Create: `scripts/import-contract-index.ts`
- Create: `tests/contracts-repository.test.ts`

- [ ] **Step 1: Write failing repository test**

Create `tests/contracts-repository.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { parseContractCsv } from "@/lib/import/csv";
import { importParsedRows, searchContractsByBusinessNumber } from "@/lib/contracts/repository";

describe("contracts repository", () => {
  it("imports sample rows and searches by normalized business number", () => {
    const dir = mkdtempSync(join(tmpdir(), "g2b-repo-"));
    const { sqlite, db } = createDb(join(dir, "test.sqlite"));
    initializeSqliteSchema(sqlite);

    const csv = readFileSync("data/sample-contracts.csv", "utf8");
    const parsed = parseContractCsv(csv, "sample-contracts.csv");
    const result = importParsedRows(db, parsed.validRows, "sample-contracts.csv");

    expect(result.insertedCount).toBe(2);
    expect(result.errorCount).toBe(0);

    const rows = searchContractsByBusinessNumber(db, { bizNo: "123-45-67890" });
    expect(rows).toHaveLength(2);
    expect(rows[0].contractDate >= rows[1].contractDate).toBe(true);

    sqlite.close();
  });
});
```

- [ ] **Step 2: Verify failing repository test**

Run: `npm test -- tests/contracts-repository.test.ts`

Expected: FAIL with module not found for `@/lib/contracts/repository`.

- [ ] **Step 3: Implement contract types**

Create `src/lib/contracts/types.ts`:

```ts
export type ContractSearchParams = {
  bizNo: string;
  dateFrom?: string;
  dateTo?: string;
  businessCategory?: string;
};

export type ContractSearchRow = {
  id: number;
  bizNoNormalized: string;
  businessName: string | null;
  businessCategory: string;
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  contractNo: string | null;
  unifiedContractNo: string | null;
  contractName: string;
  contractDate: string;
  currentContractAmount: number | null;
  totalContractAmount: number | null;
  demandAgencyName: string | null;
  contractAgencyName: string | null;
  contractMethod: string | null;
  winningMethod: string | null;
  contractDetailUrl: string | null;
  noticeDetailUrl: string | null;
  rawSourceUrl: string | null;
  sourceStatus: string;
  lastImportedAt: string;
  lastEnrichedAt: string | null;
};

export type ImportResult = {
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
};
```

- [ ] **Step 4: Implement repository**

Create `src/lib/contracts/repository.ts`:

```ts
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { parseBusinessNumber } from "@/lib/domain/business-number";
import type { ParsedContractCsvRow } from "@/lib/import/csv";
import { businesses, contractRecords, importRuns } from "@/lib/db/schema";
import type { ContractSearchParams, ContractSearchRow, ImportResult } from "./types";

type Db = BetterSQLite3Database<typeof import("@/lib/db/schema")>;

function nowIso(): string {
  return new Date().toISOString();
}

export function importParsedRows(db: Db, rows: ParsedContractCsvRow[], sourceFileName: string): ImportResult {
  const startedAt = nowIso();
  let insertedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    try {
      const existingBusiness = db
        .select()
        .from(businesses)
        .where(eq(businesses.bizNoNormalized, row.bizNoNormalized))
        .get();

      const timestamp = nowIso();
      let businessId = existingBusiness?.id;

      if (existingBusiness) {
        db.update(businesses)
          .set({
            businessName: row.businessName,
            representativeName: row.representativeName,
            address: row.address,
            updatedAt: timestamp,
          })
          .where(eq(businesses.id, existingBusiness.id))
          .run();
      } else {
        const inserted = db
          .insert(businesses)
          .values({
            bizNoNormalized: row.bizNoNormalized,
            bizNoDisplay: row.bizNoDisplay,
            businessName: row.businessName,
            representativeName: row.representativeName,
            address: row.address,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning({ id: businesses.id })
          .get();
        businessId = inserted.id;
      }

      const existingRecord = db
        .select()
        .from(contractRecords)
        .where(and(eq(contractRecords.sourceDataset, row.sourceDataset), eq(contractRecords.sourceRowHash, row.sourceRowHash)))
        .get();

      const values = {
        businessId,
        sourceDataset: row.sourceDataset,
        sourceRowHash: row.sourceRowHash,
        businessCategory: row.businessCategory,
        noticeNo: row.noticeNo,
        noticeOrder: row.noticeOrder,
        noticeName: row.noticeName,
        contractNo: row.contractNo,
        unifiedContractNo: row.unifiedContractNo,
        contractName: row.contractName,
        contractDate: row.contractDate,
        currentContractAmount: row.currentContractAmount,
        totalContractAmount: row.totalContractAmount,
        demandAgencyName: row.demandAgencyName,
        contractAgencyName: row.contractAgencyName,
        contractMethod: row.contractMethod,
        winningMethod: row.winningMethod,
        businessNameAtContract: row.businessNameAtContract,
        bizNoNormalized: row.bizNoNormalized,
        contractDetailUrl: row.contractDetailUrl,
        noticeDetailUrl: row.noticeDetailUrl,
        rawSourceUrl: row.rawSourceUrl,
        lastImportedAt: timestamp,
        updatedAt: timestamp,
      };

      if (existingRecord) {
        db.update(contractRecords).set(values).where(eq(contractRecords.id, existingRecord.id)).run();
        updatedCount += 1;
      } else {
        db.insert(contractRecords)
          .values({ ...values, sourceStatus: "local_only", createdAt: timestamp })
          .run();
        insertedCount += 1;
      }
    } catch {
      errorCount += 1;
    }
  }

  db.insert(importRuns)
    .values({
      sourceName: "csv",
      sourceFileName,
      rowCount: rows.length,
      insertedCount,
      updatedCount,
      skippedCount: 0,
      errorCount,
      startedAt,
      finishedAt: nowIso(),
      status: errorCount > 0 ? "completed_with_errors" : "completed",
      notes: null,
    })
    .run();

  return { rowCount: rows.length, insertedCount, updatedCount, skippedCount: 0, errorCount };
}

export function searchContractsByBusinessNumber(db: Db, params: ContractSearchParams): ContractSearchRow[] {
  const bizNoNormalized = parseBusinessNumber(params.bizNo);
  const filters = [eq(contractRecords.bizNoNormalized, bizNoNormalized)];

  if (params.dateFrom) filters.push(gte(contractRecords.contractDate, params.dateFrom));
  if (params.dateTo) filters.push(lte(contractRecords.contractDate, params.dateTo));
  if (params.businessCategory && params.businessCategory !== "all") {
    filters.push(eq(contractRecords.businessCategory, params.businessCategory));
  }

  const rows = db
    .select({
      id: contractRecords.id,
      bizNoNormalized: contractRecords.bizNoNormalized,
      businessName: businesses.businessName,
      businessCategory: contractRecords.businessCategory,
      noticeNo: contractRecords.noticeNo,
      noticeOrder: contractRecords.noticeOrder,
      noticeName: contractRecords.noticeName,
      contractNo: contractRecords.contractNo,
      unifiedContractNo: contractRecords.unifiedContractNo,
      contractName: contractRecords.contractName,
      contractDate: contractRecords.contractDate,
      currentContractAmount: contractRecords.currentContractAmount,
      totalContractAmount: contractRecords.totalContractAmount,
      demandAgencyName: contractRecords.demandAgencyName,
      contractAgencyName: contractRecords.contractAgencyName,
      contractMethod: contractRecords.contractMethod,
      winningMethod: contractRecords.winningMethod,
      contractDetailUrl: contractRecords.contractDetailUrl,
      noticeDetailUrl: contractRecords.noticeDetailUrl,
      rawSourceUrl: contractRecords.rawSourceUrl,
      sourceStatus: contractRecords.sourceStatus,
      lastImportedAt: contractRecords.lastImportedAt,
      lastEnrichedAt: contractRecords.lastEnrichedAt,
    })
    .from(contractRecords)
    .leftJoin(businesses, eq(businesses.id, contractRecords.businessId))
    .where(and(...filters))
    .orderBy(desc(contractRecords.contractDate), desc(contractRecords.id))
    .all();

  return rows;
}

export function getDatabaseHealth(db: Db): { contractCount: number; latestImportAt: string | null } {
  const contractCountRow = db.select({ count: sql<number>`count(*)` }).from(contractRecords).get();
  const latestImport = db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(1).get();
  return {
    contractCount: Number(contractCountRow?.count ?? 0),
    latestImportAt: latestImport?.finishedAt ?? null,
  };
}
```

- [ ] **Step 5: Implement summary helper**

Create `src/lib/contracts/summary.ts`:

```ts
import type { ContractSearchRow } from "./types";

export type ContractSummary = {
  contractCount: number;
  totalAmount: number;
  noticeLinkedCount: number;
  latestContractDate: string | null;
};

export function summarizeContracts(rows: ContractSearchRow[]): ContractSummary {
  return {
    contractCount: rows.length,
    totalAmount: rows.reduce((sum, row) => sum + (row.totalContractAmount ?? row.currentContractAmount ?? 0), 0),
    noticeLinkedCount: rows.filter((row) => row.noticeNo || row.noticeDetailUrl).length,
    latestContractDate: rows[0]?.contractDate ?? null,
  };
}
```

- [ ] **Step 6: Add import script**

Create `scripts/import-contract-index.ts`:

```ts
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { importParsedRows } from "@/lib/contracts/repository";
import { parseContractCsv } from "@/lib/import/csv";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run contracts:import -- <path-to-csv>");
  process.exit(1);
}

const resolved = resolve(inputPath);
const csv = readFileSync(resolved, "utf8");
const parsed = parseContractCsv(csv, basename(resolved));

if (parsed.errors.length > 0) {
  for (const error of parsed.errors) console.error(error);
}

const { sqlite, db } = createDb();
initializeSqliteSchema(sqlite);
const result = importParsedRows(db, parsed.validRows, basename(resolved));
sqlite.close();

console.log(JSON.stringify(result, null, 2));

if (result.errorCount > 0 && result.insertedCount === 0 && result.updatedCount === 0) {
  process.exit(1);
}
```

- [ ] **Step 7: Verify repository and import script**

Run: `npm test -- tests/contracts-repository.test.ts`

Expected: PASS.

Run: `npm run db:init`

Expected: prints `Initialized SQLite database.`

Run: `npm run contracts:import -- data/sample-contracts.csv`

Expected: prints JSON with `"insertedCount": 2`.

- [ ] **Step 8: Commit repository and importer**

```bash
git add src/lib/contracts scripts/import-contract-index.ts tests/contracts-repository.test.ts
git commit -m "feat: import and search contract records"
```

---

### Task 6: Search And Export API Routes

**Files:**
- Create: `src/app/api/search/route.ts`
- Create: `src/app/api/export/route.ts`
- Create: `src/lib/export/csv.ts`
- Create: `tests/export-csv.test.ts`

- [ ] **Step 1: Write failing export formatter test**

Create `tests/export-csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contractsToCsv } from "@/lib/export/csv";

describe("contractsToCsv", () => {
  it("formats rows as CSV with source links", () => {
    const csv = contractsToCsv([
      {
        id: 1,
        bizNoNormalized: "1234567890",
        businessName: "Sample Co",
        businessCategory: "goods",
        noticeNo: "20260123456",
        noticeOrder: "00",
        noticeName: "Notice",
        contractNo: "CN-1",
        unifiedContractNo: "UCN-1",
        contractName: "Contract",
        contractDate: "2026-01-15",
        currentContractAmount: 1000,
        totalContractAmount: 1000,
        demandAgencyName: "Agency",
        contractAgencyName: "Agency",
        contractMethod: "Limited",
        winningMethod: "Lowest",
        contractDetailUrl: "https://example.test/contract",
        noticeDetailUrl: "https://example.test/notice",
        rawSourceUrl: null,
        sourceStatus: "local_only",
        lastImportedAt: "2026-01-16T00:00:00.000Z",
        lastEnrichedAt: null,
      },
    ]);

    expect(csv).toContain("contract_date,contract_name,notice_name");
    expect(csv).toContain("2026-01-15,Contract,Notice");
  });
});
```

- [ ] **Step 2: Verify failing export test**

Run: `npm test -- tests/export-csv.test.ts`

Expected: FAIL with module not found for `@/lib/export/csv`.

- [ ] **Step 3: Implement CSV export**

Create `src/lib/export/csv.ts`:

```ts
import type { ContractSearchRow } from "@/lib/contracts/types";

function escapeCsv(value: string | number | null): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function contractsToCsv(rows: ContractSearchRow[]): string {
  const headers = [
    "contract_date",
    "contract_name",
    "notice_name",
    "contract_amount",
    "demand_agency",
    "contract_agency",
    "contract_method",
    "business_category",
    "notice_no",
    "contract_no",
    "contract_detail_url",
    "notice_detail_url",
    "source_status",
  ];

  const body = rows.map((row) =>
    [
      row.contractDate,
      row.contractName,
      row.noticeName,
      row.totalContractAmount ?? row.currentContractAmount,
      row.demandAgencyName,
      row.contractAgencyName,
      row.contractMethod,
      row.businessCategory,
      row.noticeNo,
      row.contractNo,
      row.contractDetailUrl,
      row.noticeDetailUrl,
      row.sourceStatus,
    ]
      .map(escapeCsv)
      .join(","),
  );

  return [headers.join(","), ...body].join("\n") + "\n";
}
```

- [ ] **Step 4: Implement search API route**

Create `src/app/api/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { summarizeContracts } from "@/lib/contracts/summary";
import { getDatabaseHealth, searchContractsByBusinessNumber } from "@/lib/contracts/repository";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";

const searchSchema = z.object({
  bizNo: z.string().min(1),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  businessCategory: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = searchSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid search parameters." }, { status: 400 });
  }

  try {
    const { sqlite, db } = createDb();
    initializeSqliteSchema(sqlite);
    const rows = searchContractsByBusinessNumber(db, parsed.data);
    const health = getDatabaseHealth(db);
    sqlite.close();

    return NextResponse.json({
      rows,
      summary: summarizeContracts(rows),
      health,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 5: Implement export API route**

Create `src/app/api/export/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { contractsToCsv } from "@/lib/export/csv";
import { searchContractsByBusinessNumber } from "@/lib/contracts/repository";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";

export async function GET(request: NextRequest) {
  const bizNo = request.nextUrl.searchParams.get("bizNo") ?? "";
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? undefined;
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? undefined;
  const businessCategory = request.nextUrl.searchParams.get("businessCategory") ?? undefined;

  try {
    const { sqlite, db } = createDb();
    initializeSqliteSchema(sqlite);
    const rows = searchContractsByBusinessNumber(db, { bizNo, dateFrom, dateTo, businessCategory });
    sqlite.close();

    return new NextResponse(contractsToCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="g2b-contracts-${bizNo.replace(/\D/g, "")}.csv"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 6: Verify APIs and export helper**

Run: `npm test -- tests/export-csv.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit API routes**

```bash
git add src/app/api src/lib/export tests/export-csv.test.ts
git commit -m "feat: add search and csv export APIs"
```

---

### Task 7: G2B API Clients And Enrichment

**Files:**
- Create: `src/lib/g2b/http.ts`
- Create: `src/lib/g2b/contract-info-client.ts`
- Create: `src/lib/g2b/bid-notice-client.ts`
- Create: `src/lib/g2b/successful-bid-client.ts`
- Create: `src/lib/g2b/enrichment.ts`
- Create: `src/app/api/enrich/route.ts`
- Create: `scripts/enrich-g2b-details.ts`
- Create: `tests/g2b-parsers.test.ts`
- Create: `tests/fixtures/contract-info-response.json`
- Create: `tests/fixtures/bid-notice-response.json`

- [ ] **Step 1: Add parser fixtures**

Create `tests/fixtures/contract-info-response.json`:

```json
{
  "response": {
    "header": { "resultCode": "00", "resultMsg": "NORMAL SERVICE." },
    "body": {
      "items": [
        {
          "dcsnCntrctNo": "CN-2026-0001",
          "untyCntrctNo": "UCN-2026-0001",
          "cntrctNm": "Printer supply",
          "cntrctDtlInfoUrl": "https://example.test/contract/1"
        }
      ],
      "totalCount": 1
    }
  }
}
```

Create `tests/fixtures/bid-notice-response.json`:

```json
{
  "response": {
    "header": { "resultCode": "00", "resultMsg": "NORMAL SERVICE." },
    "body": {
      "items": [
        {
          "bidNtceNo": "20260123456",
          "bidNtceOrd": "00",
          "bidNtceNm": "Office printer bid",
          "bidNtceDtlUrl": "https://example.test/notice/1"
        }
      ],
      "totalCount": 1
    }
  }
}
```

- [ ] **Step 2: Write failing parser tests**

Create `tests/g2b-parsers.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseContractInfoResponse } from "@/lib/g2b/contract-info-client";
import { parseBidNoticeResponse } from "@/lib/g2b/bid-notice-client";

describe("G2B parsers", () => {
  it("parses contract detail URL", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/contract-info-response.json", "utf8"));
    const rows = parseContractInfoResponse(fixture);
    expect(rows[0].contractDetailUrl).toBe("https://example.test/contract/1");
  });

  it("parses notice detail URL", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/bid-notice-response.json", "utf8"));
    const rows = parseBidNoticeResponse(fixture);
    expect(rows[0].noticeDetailUrl).toBe("https://example.test/notice/1");
  });
});
```

- [ ] **Step 3: Verify failing parser tests**

Run: `npm test -- tests/g2b-parsers.test.ts`

Expected: FAIL with module not found for `@/lib/g2b/contract-info-client`.

- [ ] **Step 4: Implement HTTP helper**

Create `src/lib/g2b/http.ts`:

```ts
export type G2bRequestParams = Record<string, string | number | undefined | null>;

export function getServiceKey(): string | null {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

export function buildG2bUrl(baseUrl: string, operation: string, params: G2bRequestParams): string {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/${operation.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("type", "json");
  return url.toString();
}

export async function fetchG2bJson(baseUrl: string, operation: string, params: G2bRequestParams): Promise<unknown> {
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new Error("DATA_GO_KR_SERVICE_KEY is not configured.");

  const url = buildG2bUrl(baseUrl, operation, { ...params, serviceKey });
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`G2B API request failed with status ${response.status}.`);
  return response.json();
}
```

- [ ] **Step 5: Implement G2B parsers and client functions**

Create `src/lib/g2b/contract-info-client.ts`:

```ts
import { z } from "zod";
import { fetchG2bJson } from "./http";

const contractInfoItemSchema = z.object({
  dcsnCntrctNo: z.string().optional(),
  untyCntrctNo: z.string().optional(),
  cntrctNm: z.string().optional(),
  cntrctDtlInfoUrl: z.string().url().optional(),
});

const contractInfoResponseSchema = z.object({
  response: z.object({
    body: z.object({
      items: z.array(contractInfoItemSchema).default([]),
    }),
  }),
});

export type ContractInfoResult = {
  contractNo: string | null;
  unifiedContractNo: string | null;
  contractName: string | null;
  contractDetailUrl: string | null;
};

export function parseContractInfoResponse(input: unknown): ContractInfoResult[] {
  const parsed = contractInfoResponseSchema.parse(input);
  return parsed.response.body.items.map((item) => ({
    contractNo: item.dcsnCntrctNo ?? null,
    unifiedContractNo: item.untyCntrctNo ?? null,
    contractName: item.cntrctNm ?? null,
    contractDetailUrl: item.cntrctDtlInfoUrl ?? null,
  }));
}

export async function fetchContractInfoByContractNo(contractNo: string): Promise<ContractInfoResult[]> {
  const json = await fetchG2bJson("https://apis.data.go.kr/1230000/ao/CntrctInfoService", "getCntrctInfoListThng", {
    pageNo: 1,
    numOfRows: 10,
    inqryDiv: 2,
    dcsnCntrctNo: contractNo,
  });
  return parseContractInfoResponse(json);
}
```

Create `src/lib/g2b/bid-notice-client.ts`:

```ts
import { z } from "zod";
import { fetchG2bJson } from "./http";

const bidNoticeItemSchema = z.object({
  bidNtceNo: z.string().optional(),
  bidNtceOrd: z.string().optional(),
  bidNtceNm: z.string().optional(),
  bidNtceDtlUrl: z.string().url().optional(),
});

const bidNoticeResponseSchema = z.object({
  response: z.object({
    body: z.object({
      items: z.array(bidNoticeItemSchema).default([]),
    }),
  }),
});

export type BidNoticeResult = {
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  noticeDetailUrl: string | null;
};

export function parseBidNoticeResponse(input: unknown): BidNoticeResult[] {
  const parsed = bidNoticeResponseSchema.parse(input);
  return parsed.response.body.items.map((item) => ({
    noticeNo: item.bidNtceNo ?? null,
    noticeOrder: item.bidNtceOrd ?? null,
    noticeName: item.bidNtceNm ?? null,
    noticeDetailUrl: item.bidNtceDtlUrl ?? null,
  }));
}

export async function fetchBidNoticeByNoticeNo(noticeNo: string): Promise<BidNoticeResult[]> {
  const json = await fetchG2bJson("https://apis.data.go.kr/1230000/ad/BidPublicInfoService", "getBidPblancListInfoThng", {
    pageNo: 1,
    numOfRows: 10,
    inqryDiv: 2,
    bidNtceNo: noticeNo,
  });
  return parseBidNoticeResponse(json);
}
```

Create `src/lib/g2b/successful-bid-client.ts`:

```ts
import { fetchG2bJson } from "./http";

export type SuccessfulBidResult = {
  noticeNo: string | null;
  successfulBidAmount: number | null;
  successfulBidRate: string | null;
};

export async function fetchSuccessfulBidByNoticeNo(noticeNo: string): Promise<SuccessfulBidResult[]> {
  const json = await fetchG2bJson("https://apis.data.go.kr/1230000/as/ScsbidInfoService", "getScsbidListSttusThng", {
    pageNo: 1,
    numOfRows: 10,
    inqryDiv: 3,
    bidNtceNo: noticeNo,
  });

  const response = json as {
    response?: { body?: { items?: Array<{ bidNtceNo?: string; sucsfbidAmt?: string | number; sucsfbidRate?: string }> } };
  };

  return (response.response?.body?.items ?? []).map((item) => ({
    noticeNo: item.bidNtceNo ?? null,
    successfulBidAmount: item.sucsfbidAmt === undefined ? null : Number(item.sucsfbidAmt),
    successfulBidRate: item.sucsfbidRate ?? null,
  }));
}
```

- [ ] **Step 6: Implement enrichment orchestration**

Create `src/lib/g2b/enrichment.ts`:

```ts
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { apiEnrichmentLogs, contractRecords } from "@/lib/db/schema";
import { fetchBidNoticeByNoticeNo } from "./bid-notice-client";
import { fetchContractInfoByContractNo } from "./contract-info-client";

type Db = BetterSQLite3Database<typeof import("@/lib/db/schema")>;

function nowIso(): string {
  return new Date().toISOString();
}

export async function enrichContractRecord(db: Db, recordId: number): Promise<{ updated: boolean; message: string }> {
  const record = db.select().from(contractRecords).where(eq(contractRecords.id, recordId)).get();
  if (!record) return { updated: false, message: "Record not found." };

  const updates: Partial<typeof contractRecords.$inferInsert> = {};

  try {
    if (record.noticeNo) {
      const [notice] = await fetchBidNoticeByNoticeNo(record.noticeNo);
      if (notice?.noticeName) updates.noticeName = notice.noticeName;
      if (notice?.noticeDetailUrl) updates.noticeDetailUrl = notice.noticeDetailUrl;
    }

    if (record.contractNo) {
      const [contract] = await fetchContractInfoByContractNo(record.contractNo);
      if (contract?.contractName) updates.contractName = contract.contractName;
      if (contract?.contractDetailUrl) updates.contractDetailUrl = contract.contractDetailUrl;
      if (contract?.unifiedContractNo) updates.unifiedContractNo = contract.unifiedContractNo;
    }

    if (Object.keys(updates).length === 0) {
      return { updated: false, message: "No enrichment fields changed." };
    }

    db.update(contractRecords)
      .set({ ...updates, sourceStatus: "api_enriched", lastEnrichedAt: nowIso(), updatedAt: nowIso() })
      .where(eq(contractRecords.id, recordId))
      .run();

    db.insert(apiEnrichmentLogs)
      .values({
        contractRecordId: recordId,
        provider: "data.go.kr",
        operation: "enrichContractRecord",
        requestParamsJson: JSON.stringify({ recordId }),
        responseStatus: "success",
        errorMessage: null,
        createdAt: nowIso(),
      })
      .run();

    return { updated: true, message: "Record enriched." };
  } catch (error) {
    db.insert(apiEnrichmentLogs)
      .values({
        contractRecordId: recordId,
        provider: "data.go.kr",
        operation: "enrichContractRecord",
        requestParamsJson: JSON.stringify({ recordId }),
        responseStatus: "error",
        errorMessage: (error as Error).message,
        createdAt: nowIso(),
      })
      .run();

    return { updated: false, message: (error as Error).message };
  }
}
```

- [ ] **Step 7: Add enrichment API and script**

Create `src/app/api/enrich/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { enrichContractRecord } from "@/lib/g2b/enrichment";

const bodySchema = z.object({ recordId: z.number().int().positive() });

export async function POST(request: NextRequest) {
  if (process.env.ENRICHMENT_ENABLED !== "true") {
    return NextResponse.json({ error: "API enrichment disabled." }, { status: 403 });
  }

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid enrichment request." }, { status: 400 });

  const { sqlite, db } = createDb();
  initializeSqliteSchema(sqlite);
  const result = await enrichContractRecord(db, body.data.recordId);
  sqlite.close();

  return NextResponse.json(result);
}
```

Create `scripts/enrich-g2b-details.ts`:

```ts
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { enrichContractRecord } from "@/lib/g2b/enrichment";

const recordId = Number(process.argv[2]);

if (!Number.isInteger(recordId) || recordId <= 0) {
  console.error("Usage: npm run contracts:enrich -- <record-id>");
  process.exit(1);
}

const { sqlite, db } = createDb();
initializeSqliteSchema(sqlite);
const result = await enrichContractRecord(db, recordId);
sqlite.close();

console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 8: Verify API clients**

Run: `npm test -- tests/g2b-parsers.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 9: Commit enrichment layer**

```bash
git add src/lib/g2b src/app/api/enrich scripts/enrich-g2b-details.ts tests/g2b-parsers.test.ts tests/fixtures
git commit -m "feat: add g2b enrichment clients"
```

---

### Task 8: Search UI

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `src/components/ContractLookupApp.tsx`

- [ ] **Step 1: Replace page with client app**

Modify `src/app/page.tsx`:

```tsx
import { ContractLookupApp } from "@/components/ContractLookupApp";

export default function HomePage() {
  return <ContractLookupApp />;
}
```

- [ ] **Step 2: Implement client app**

Create `src/components/ContractLookupApp.tsx`:

```tsx
"use client";

import { Download, ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";

type ContractRow = {
  id: number;
  businessName: string | null;
  businessCategory: string;
  noticeNo: string | null;
  noticeName: string | null;
  contractNo: string | null;
  contractName: string;
  contractDate: string;
  currentContractAmount: number | null;
  totalContractAmount: number | null;
  demandAgencyName: string | null;
  contractAgencyName: string | null;
  contractMethod: string | null;
  contractDetailUrl: string | null;
  noticeDetailUrl: string | null;
  rawSourceUrl: string | null;
  sourceStatus: string;
  lastImportedAt: string;
  lastEnrichedAt: string | null;
};

type SearchResponse = {
  rows: ContractRow[];
  summary: {
    contractCount: number;
    totalAmount: number;
    noticeLinkedCount: number;
    latestContractDate: string | null;
  };
  health: {
    contractCount: number;
    latestImportAt: string | null;
  };
};

const emptyResponse: SearchResponse = {
  rows: [],
  summary: { contractCount: 0, totalAmount: 0, noticeLinkedCount: 0, latestContractDate: null },
  health: { contractCount: 0, latestImportAt: null },
};

function formatWon(value: number | null): string {
  if (value === null) return "-";
  return `${value.toLocaleString("ko-KR")}원`;
}

function SourceLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return <span className="muted">-</span>;
  return (
    <a className="source-link" href={href} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink size={14} />
    </a>
  );
}

export function ContractLookupApp() {
  const [bizNo, setBizNo] = useState("123-45-67890");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [businessCategory, setBusinessCategory] = useState("all");
  const [data, setData] = useState<SearchResponse>(emptyResponse);
  const [selected, setSelected] = useState<ContractRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({ bizNo });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (businessCategory !== "all") params.set("businessCategory", businessCategory);
    return `/api/export?${params.toString()}`;
  }, [bizNo, dateFrom, dateTo, businessCategory]);

  async function runSearch() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ bizNo });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (businessCategory !== "all") params.set("businessCategory", businessCategory);

    const response = await fetch(`/api/search?${params.toString()}`);
    const body = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(body.error ?? "Search failed.");
      return;
    }

    setData(body);
    setSelected(body.rows[0] ?? null);
  }

  return (
    <main className="page-shell">
      <section className="app-panel">
        <header className="topbar">
          <div>
            <h1>G2B Contract Lookup</h1>
            <p>Search imported contract records by business registration number.</p>
          </div>
          <div className="status-strip">
            <span>DB rows: {data.health.contractCount.toLocaleString("ko-KR")}</span>
            <span>Latest import: {data.health.latestImportAt ?? "-"}</span>
          </div>
        </header>

        <section className="search-panel">
          <label>
            Business number
            <input value={bizNo} onChange={(event) => setBizNo(event.target.value)} placeholder="123-45-67890" />
          </label>
          <label>
            From
            <input value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} placeholder="2026-01-01" />
          </label>
          <label>
            To
            <input value={dateTo} onChange={(event) => setDateTo(event.target.value)} placeholder="2026-12-31" />
          </label>
          <label>
            Category
            <select value={businessCategory} onChange={(event) => setBusinessCategory(event.target.value)}>
              <option value="all">All</option>
              <option value="goods">Goods</option>
              <option value="construction">Construction</option>
              <option value="services">Services</option>
              <option value="foreign">Foreign capital</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <button className="primary-button" onClick={runSearch} disabled={loading}>
            <Search size={16} />
            {loading ? "Searching" : "Search"}
          </button>
          <a className="secondary-button" href={exportUrl}>
            <Download size={16} />
            CSV
          </a>
        </section>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="summary-grid">
          <div><span>Contracts</span><strong>{data.summary.contractCount}</strong></div>
          <div><span>Total amount</span><strong>{formatWon(data.summary.totalAmount)}</strong></div>
          <div><span>Notice links</span><strong>{data.summary.noticeLinkedCount}</strong></div>
          <div><span>Latest date</span><strong>{data.summary.latestContractDate ?? "-"}</strong></div>
        </section>

        <section className="content-grid">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Contract</th>
                  <th>Notice</th>
                  <th>Amount</th>
                  <th>Agency</th>
                  <th>Links</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} onClick={() => setSelected(row)}>
                    <td>{row.contractDate}</td>
                    <td>{row.contractName}</td>
                    <td>{row.noticeName ?? row.noticeNo ?? "-"}</td>
                    <td>{formatWon(row.totalContractAmount ?? row.currentContractAmount)}</td>
                    <td>{row.demandAgencyName ?? row.contractAgencyName ?? "-"}</td>
                    <td>
                      <SourceLink href={row.contractDetailUrl} label="Contract" />
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">Import data, then search a business number.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <aside className="detail-panel">
            <h2>Record detail</h2>
            {selected ? (
              <div className="detail-stack">
                <div><span>Business</span><strong>{selected.businessName ?? "-"}</strong></div>
                <div><span>Contract no</span><strong>{selected.contractNo ?? "-"}</strong></div>
                <div><span>Source status</span><strong>{selected.sourceStatus}</strong></div>
                <div><span>Imported</span><strong>{selected.lastImportedAt}</strong></div>
                <div><span>Enriched</span><strong>{selected.lastEnrichedAt ?? "-"}</strong></div>
                <SourceLink href={selected.contractDetailUrl} label="Contract detail" />
                <SourceLink href={selected.noticeDetailUrl} label="Notice detail" />
                <SourceLink href={selected.rawSourceUrl} label="Raw source" />
              </div>
            ) : (
              <p className="muted">Select a row to inspect source links and freshness.</p>
            )}
          </aside>
        </section>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Replace CSS with operational layout**

Modify `src/app/globals.css`:

```css
* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: Arial, Helvetica, sans-serif;
  color: #172033;
  background: #f4f6f8;
}

button, input, select { font: inherit; }

a { color: inherit; }

.page-shell {
  min-height: 100vh;
  padding: 24px;
}

.app-panel {
  max-width: 1360px;
  margin: 0 auto;
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-end;
  margin-bottom: 20px;
}

.topbar h1 {
  margin: 0 0 6px;
  font-size: 28px;
  letter-spacing: 0;
}

.topbar p {
  margin: 0;
  color: #5b677a;
}

.status-strip {
  display: flex;
  gap: 12px;
  color: #5b677a;
  font-size: 13px;
}

.search-panel {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr auto auto;
  gap: 10px;
  align-items: end;
  padding: 14px;
  background: #ffffff;
  border: 1px solid #d8dee8;
  border-radius: 8px;
}

label {
  display: grid;
  gap: 6px;
  color: #445066;
  font-size: 13px;
}

input, select {
  min-height: 38px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  padding: 0 10px;
  background: #ffffff;
  color: #172033;
}

.primary-button, .secondary-button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 6px;
  padding: 0 14px;
  border: 1px solid #244264;
  text-decoration: none;
  cursor: pointer;
}

.primary-button {
  background: #244264;
  color: #ffffff;
}

.secondary-button {
  background: #ffffff;
  color: #244264;
}

.error-banner {
  margin-top: 12px;
  padding: 10px 12px;
  background: #fff2f2;
  color: #9b1c1c;
  border: 1px solid #f2b8b8;
  border-radius: 6px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 14px 0;
}

.summary-grid div {
  background: #ffffff;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  padding: 12px;
}

.summary-grid span, .detail-stack span {
  display: block;
  color: #667386;
  font-size: 12px;
  margin-bottom: 4px;
}

.summary-grid strong, .detail-stack strong {
  font-size: 16px;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
}

.table-wrap, .detail-panel {
  background: #ffffff;
  border: 1px solid #d8dee8;
  border-radius: 8px;
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 980px;
}

th, td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid #e6ebf1;
  font-size: 13px;
  vertical-align: top;
}

th {
  color: #445066;
  background: #f8fafc;
  font-weight: 700;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover {
  background: #f6f9fc;
}

.empty-cell {
  text-align: center;
  color: #667386;
  padding: 42px;
}

.detail-panel {
  padding: 14px;
}

.detail-panel h2 {
  margin: 0 0 12px;
  font-size: 18px;
}

.detail-stack {
  display: grid;
  gap: 12px;
}

.source-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #244264;
  text-decoration: none;
  font-weight: 700;
}

.muted {
  color: #667386;
}

@media (max-width: 900px) {
  .topbar, .status-strip {
    display: grid;
  }

  .search-panel, .summary-grid, .content-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Verify UI build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit UI**

```bash
git add src/app/page.tsx src/app/globals.css src/components/ContractLookupApp.tsx
git commit -m "feat: add contract lookup interface"
```

---

### Task 9: Local Verification Run

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README**

Create `README.md`:

````md
# G2B Contract Lookup

Local-first web app for searching imported G2B/Nara Market contract records by business registration number.

## Setup

```bash
npm install
copy .env.local.example .env.local
npm run db:init
npm run contracts:import -- data/sample-contracts.csv
npm run dev
```

Open `http://localhost:3000` and search `123-45-67890`.

## Data Model

Business-number lookup is local-index-first. Public Data Portal APIs are used for enrichment when a record already has notice or contract identifiers.

## Commands

- `npm run db:init`: initialize SQLite schema
- `npm run contracts:import -- data/sample-contracts.csv`: import CSV contract rows
- `npm run contracts:enrich -- <record-id>`: enrich one imported record when API credentials are configured
- `npm test`: run unit and integration tests
- `npm run build`: verify Next.js production build
````

- [ ] **Step 2: Run full verification**

Run: `npm test`

Expected: PASS.

Run: `npm run db:init`

Expected: prints `Initialized SQLite database.`

Run: `npm run contracts:import -- data/sample-contracts.csv`

Expected: imports sample rows without a fatal error.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Start local dev server**

Run: `npm run dev`

Expected: Next.js starts on `http://localhost:3000` or prints the alternate port if `3000` is occupied.

- [ ] **Step 4: Manual browser check**

Open the local URL and verify:

- The page loads without runtime errors.
- Searching `123-45-67890` returns two rows.
- Summary cards show `2` contracts and `2` notice-linked rows.
- The detail panel updates when clicking a row.
- CSV download returns a file containing the visible rows.

- [ ] **Step 5: Commit README and verification adjustments**

```bash
git add README.md
git commit -m "docs: add local setup instructions"
```

---

## Plan Self-Review

Spec coverage:

- Business-number search: Task 2, Task 5, Task 6, Task 8.
- SQLite local DB: Task 3, Task 5, Task 9.
- PostgreSQL-ready repository boundary: Task 5 creates repository functions and keeps UI/API out of SQL details.
- CSV import seed: Task 4 and Task 5.
- Contract and notice source links: Task 4, Task 5, Task 6, Task 8.
- API enrichment: Task 7.
- CSV export: Task 6 and Task 8.
- Data freshness and source status: Task 5 and Task 8.
- Tests: Tasks 2 through 7 and Task 9.

Placeholder scan:

- This plan intentionally resolves the CSV-only MVP importer and explicit enrichment trigger.
- No step depends on a hidden file or unlisted module.
- Every code-writing step lists the target file and concrete content.

Residual implementation risk:

- Public Data Portal operation names can vary by business category. Task 7 starts with parser fixtures and isolated clients so operation corrections are localized to `src/lib/g2b/*`.
- The first UI uses direct fetch calls and a simple table. This is enough for MVP verification and leaves bulk monitoring out of scope.
