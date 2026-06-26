import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { importParsedRows } from "@/lib/contracts/repository";
import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { parseContractCsv } from "@/lib/import/csv";

const csvPath = process.argv[2];

if (csvPath === undefined) {
  console.error("Usage: npm run contracts:import -- <path-to-csv>");
  process.exit(1);
}

const absolutePath = resolve(csvPath);
const sourceFileName = basename(csvPath);
const csv = readFileSync(absolutePath, "utf8");
const parsed = parseContractCsv(csv, sourceFileName);

const { sqlite, db } = createDb();

try {
  initializeSqliteSchema(sqlite);
  const result = importParsedRows(db, parsed.validRows, sourceFileName);
  const output = {
    ...result,
    parseErrorCount: parsed.errors.length,
    parseErrors: parsed.errors,
  };

  console.log(JSON.stringify(output, null, 2));

  const totalErrorCount = result.errorCount + parsed.errors.length;

  if (result.insertedCount === 0 && result.updatedCount === 0 && totalErrorCount > 0) {
    process.exitCode = 1;
  }
} finally {
  sqlite.close();
}
