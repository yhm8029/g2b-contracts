import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { replaceExcellentProductsSnapshot } from "@/lib/excellent-products/repository";
import { parseExcellentProductsCsv } from "@/lib/excellent-products/csv";

const csvPath = process.argv[2];

if (csvPath === undefined) {
  console.error("Usage: npm run excellent-products:import -- <path-to-csv>");
  process.exitCode = 1;
} else {
  try {
    const absolutePath = resolve(csvPath);
    const sourceFileName = basename(csvPath);
    const csv = readFileSync(absolutePath, "utf8");
    const parsed = parseExcellentProductsCsv(csv, sourceFileName);

    if (parsed.errors.length > 0) {
      throw new Error(`Invalid CSV: ${parsed.errors.join("; ")}`);
    }
    if (parsed.rows.length === 0) {
      throw new Error("CSV contains zero target 39121801 rows.");
    }

    const connection = createDb();
    try {
      initializeSqliteSchema(connection.sqlite);
      const result = replaceExcellentProductsSnapshot(
        connection.db,
        parsed.rows,
        sourceFileName,
      );
      console.log(
        `Imported excellent products: rows=${result.rowCount} inserted=${result.insertedCount} ` +
          `updated=${result.updatedCount} skipped=${result.skippedCount}`,
      );
    } finally {
      connection.sqlite.close();
    }
  } catch (error) {
    console.error(
      `Excellent products import failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
