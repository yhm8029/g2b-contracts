'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

async function main() {
  const sourcePath = path.resolve(process.argv[2] || '');
  const destinationPath = path.resolve(process.argv[3] || '');

  if (!process.argv[2] || !process.argv[3]) {
    throw new Error('Usage: node backup-sqlite.cjs <source> <destination>');
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite source does not exist: ${sourcePath}`);
  }
  if (sourcePath.toLowerCase() === destinationPath.toLowerCase()) {
    throw new Error('SQLite source and destination must be different.');
  }
  if (fs.existsSync(destinationPath)) {
    throw new Error(`SQLite destination already exists: ${destinationPath}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const source = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    await source.backup(destinationPath);
  } finally {
    source.close();
  }

  const snapshot = new Database(destinationPath, { fileMustExist: true });
  try {
    snapshot.pragma('journal_mode = DELETE');
    const result = snapshot.pragma('quick_check', { simple: true });
    if (result !== 'ok') {
      throw new Error(`SQLite snapshot quick_check failed: ${result}`);
    }
  } finally {
    snapshot.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
