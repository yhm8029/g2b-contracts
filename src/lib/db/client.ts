import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";

const defaultDatabasePath = "./data/g2b-contracts.sqlite";
const urlSchemePattern = /^([a-z][a-z0-9+.-]*):/i;
const windowsDrivePathPattern = /^[a-z]:[\\/]/i;

export function getDatabasePath(): string {
  const configuredPath = process.env.DATABASE_URL ?? defaultDatabasePath;
  const schemeMatch = configuredPath.match(urlSchemePattern);

  if (schemeMatch && !windowsDrivePathPattern.test(configuredPath)) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "file") {
      throw new Error(
        `DATABASE_URL must be a SQLite local filesystem path or file: URL; received ${scheme}: URL.`,
      );
    }

    if (configuredPath.startsWith("file://")) {
      return resolve(fileURLToPath(configuredPath));
    }

    return resolve(configuredPath.slice("file:".length));
  }

  return resolve(configuredPath);
}

export function createSqliteConnection(path = getDatabasePath()) {
  const databasePath = resolve(path);
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  return sqlite;
}

export function createDb(path?: string) {
  const sqlite = createSqliteConnection(path);
  const db = drizzle(sqlite, { schema });

  return { sqlite, db };
}

export type Db = ReturnType<typeof createDb>["db"];
