import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";

export function getDatabasePath(): string {
  return resolve(process.env.DATABASE_URL ?? "./data/g2b-contracts.sqlite");
}

export function createSqliteConnection(path = getDatabasePath()) {
  const databasePath = resolve(path);
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");

  return sqlite;
}

export function createDb(path?: string) {
  const sqlite = createSqliteConnection(path);
  const db = drizzle(sqlite, { schema });

  return { sqlite, db };
}
