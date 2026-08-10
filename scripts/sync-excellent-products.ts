import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { syncBuildingControlCompanies } from "@/lib/excellent-products/enrichment";

// Operational precondition: do not run the CSV import concurrently with this refresh.
console.log("Refreshing excellent products (do not run CSV import concurrently)...");

try {
  const connection = createDb();
  try {
    initializeSqliteSchema(connection.sqlite);
    const result = await syncBuildingControlCompanies(connection.db);
    console.log(
      `Excellent products sync: processed=${result.processedCompanies} ` +
        `updated=${result.updatedCompanies} errors=${result.errors.length}`,
    );
    if (
      result.processedCompanies > 0 &&
      result.updatedCompanies === 0 &&
      result.errors.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    connection.sqlite.close();
  }
} catch (error) {
  console.error(
    `Excellent products sync failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
