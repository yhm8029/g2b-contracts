import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";

const { sqlite } = createDb();
initializeSqliteSchema(sqlite);
sqlite.close();

console.log("Initialized SQLite database.");
