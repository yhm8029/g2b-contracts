import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { enrichContractRecord } from "@/lib/g2b/enrichment";
import { redactG2bSecrets } from "@/lib/g2b/http";

const recordIdArg = process.argv[2];
const recordId = recordIdArg === undefined ? NaN : Number(recordIdArg);

if (!Number.isInteger(recordId) || recordId <= 0) {
  console.error("Usage: npm run contracts:enrich -- <record-id>");
  process.exit(1);
}

const { sqlite, db } = createDb();

try {
  initializeSqliteSchema(sqlite);
  const result = await enrichContractRecord(db, recordId);
  console.log(JSON.stringify({ ...result, message: redactG2bSecrets(result.message) }, null, 2));
} finally {
  sqlite.close();
}
