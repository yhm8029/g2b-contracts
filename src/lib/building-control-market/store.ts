import type Database from "better-sqlite3";

import type { ExcellentRegistryEntry, MarketAwardInput, MarketContractInput } from "./report";

export const COOPERATIVE_BIZ_NO = "2148204708";

export type StoredMarketAward = MarketAwardInput & {
  amount: number | null;
  noticeName: string | null;
  demandAgencyName: string | null;
  regionName: string;
  sourceUrl: string | null;
};

export type StoredMarketContract = {
  sourceIdentity: string;
  contractNo: string;
  contractName: string;
  contractDate: string;
  noticeNo: string | null;
  noticeOrder: string | null;
  winnerBizNo: string;
  winnerName: string;
  amount: number | null;
  demandAgencyName: string | null;
  regionName: string;
  sourceUrl: string | null;
};

export type MarketContractInputStored = MarketContractInput & {
  amount?: number | null;
  sourceUrl?: string | null;
  demandAgencyName?: string | null;
};

export type StoredExcellentRegistryEntry = ExcellentRegistryEntry & {
  designationNo: string;
  displayOrder: number;
};

const SEED_REGISTRY: ReadonlyArray<readonly [string, string, string, string]> = [
  ["\uB355\uC0B0\uBA54\uCE74\uC2DC\uC2A4(\uC8FC)", "2208104763", "2026058", "2026-07-20"],
  ["(\uC8FC)\uC6B0\uB9AC\uC820", "1138190302", "2025208", "2026-01-19"],
  ["\uC774\uC5D0\uC2A4\uCF58\uD2B8\uB864\uC2A4(\uC8FC)", "1108175113", "2025205", "2026-01-19"],
  ["\uC8FC\uC2DD\uD68C\uC0AC \uBE44\uC5D8\uC544\uC774\uC548\uC528", "7708700599", "2025140", "2026-01-18"],
  ["(\uC8FC)\uD30C\uB178\uD15D", "2048145651", "2025135", "2025-10-20"],
  ["\uC911\uC559\uC544\uC774\uC5D4\uD2F0 \uC8FC\uC2DD\uD68C\uC0AC", "1268144518", "2025074", "2025-07-21"],
  ["\uC131\uD55C \uC8FC\uC2DD\uD68C\uC0AC", "3148146957", "2025073", "2025-07-21"],
  ["\uD55C\uACBD\uAE30\uC804(\uC8FC)", "1138111990", "2024064", "2024-09-13"],
  ["\uD55C\uAD6D\uB514\uC9C0\uD0C8\uCF58\uD2B8\uB864 \uC8FC\uC2DD\uD68C\uC0AC", "1238122892", "2024063", "2024-07-15"],
  ["\uC8FC\uC2DD\uD68C\uC0AC \uB098\uB77C\uCEE4\uB4DC\uB85C\uC6CC", "2118138895", "2024150", "2024-07-15"],
  ["\uC8FC\uC2DD\uD68C\uC0AC \uC0BC\uC6D0\uC528\uC548\uC9C0", "2048169430", "2024018", "2024-04-15"],
  ["\uC8FC\uC2DD\uD68C\uC0AC \uC2E0\uC601\uC815\uBCF4\uAE30\uC220", "2068117262", "2024004", "2024-04-15"],
  ["\uC8FC\uC2DD\uD68C\uC0AC\uC77C\uB809\uCF64", "1338128627", "2023197", "2024-01-22"],
  ["(\uC8FC)\uD5E4\uB9AC\uD2B8", "3148130305", "2022241", "2023-03-17"],
  ["(\uC8FC)\uCF00\uC774\uB514\uD2F0", "1078171028", "2022186", "2022-10-24"],
  ["\uB85C\uC9C0\uC2DC\uC2A4\uD15C(\uC8FC)", "1098182104", "2022061", "2022-05-02"],
  ["\uC8FC\uC2DD\uD68C\uC0AC \uC5D8\uC54C\uBC14\uC2A4", "2148143121", "2021037", "2021-06-07"],
  ["\uC8FC\uC2DD\uD68C\uC0AC \uC8FC\uC778\uC815\uBCF4\uC2DC\uC2A4\uD15C", "2208658565", "2020239", "2021-03-22"],
  ["\uC11C\uC804\uC5D4\uC9C0\uB2C8\uC5B4\uB9C1(\uC8FC)", "2208165402", "2020220", "2021-03-22"],
  ["(\uC8FC)\uB3D9\uC591\uC774\uC5D4\uC528", "1068133832", "2020111", "2020-11-10"],
  ["(\uC8FC)\uC2E0\uC544\uC2DC\uC2A4\uD15C", "1238180252", "2020101", "2020-11-10"],
  ["\uD654\uC778\uC2DC\uC2A4\uD15C(\uC8FC)", "5028142086", "2020059", "2020-07-31"],
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function initMarketStore(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_excellent_registry (
      biz_no TEXT PRIMARY KEY, company_name TEXT NOT NULL, designation_no TEXT NOT NULL,
      designation_start_date TEXT NOT NULL, designation_end_date TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_awards (
      notice_no TEXT NOT NULL, notice_order TEXT NOT NULL, final_award_date TEXT NOT NULL,
      winner_biz_no TEXT NOT NULL, winner_name TEXT NOT NULL, amount REAL,
      notice_name TEXT, demand_agency_name TEXT, region_name TEXT NOT NULL DEFAULT '\uAE30\uD0C0',
      source_url TEXT,
      PRIMARY KEY (notice_no, notice_order)
    );
    CREATE TABLE IF NOT EXISTS market_contracts (
      source_identity TEXT PRIMARY KEY,
      contract_no TEXT NOT NULL, contract_name TEXT NOT NULL, contract_date TEXT NOT NULL,
      notice_no TEXT, notice_order TEXT,
      winner_biz_no TEXT NOT NULL, winner_name TEXT NOT NULL, amount REAL,
      demand_agency_name TEXT, region_name TEXT NOT NULL DEFAULT '\uAE30\uD0C0',
      source_url TEXT
    );
    CREATE TABLE IF NOT EXISTS market_sync_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), last_synced_at TEXT,
      status TEXT NOT NULL, message TEXT
    );
    INSERT OR IGNORE INTO market_sync_state(singleton, status) VALUES (1, 'never');
  `);

  upgradeMarketStore(db);

  const insert = db.prepare(`INSERT OR IGNORE INTO market_excellent_registry
    (biz_no, company_name, designation_no, designation_start_date, designation_end_date, enabled, display_order)
    VALUES (?, ?, ?, ?, ?, 1, ?)`);
  db.transaction(() => SEED_REGISTRY.forEach(([name, bizNo, designationNo, start], index) =>
    insert.run(bizNo, name, designationNo, start, designationEndDate(start), index + 1)))();
}

function upgradeMarketStore(db: Database.Database) {
  addColumnIfMissing(db, "market_awards", "notice_name", "TEXT");
  addColumnIfMissing(db, "market_awards", "demand_agency_name", "TEXT");
  addColumnIfMissing(db, "market_awards", "region_name", "TEXT NOT NULL DEFAULT '\uAE30\uD0C0'");
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (info.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function listExcellentRegistry(db: Database.Database): StoredExcellentRegistryEntry[] {
  const rows = db.prepare(`SELECT biz_no, company_name, designation_no, designation_start_date,
    designation_end_date, enabled, display_order FROM market_excellent_registry ORDER BY display_order, biz_no`).all() as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    bizNo: String(row.biz_no), companyName: String(row.company_name), designationNo: String(row.designation_no),
    designationStartDate: String(row.designation_start_date), designationEndDate: String(row.designation_end_date),
    enabled: row.enabled === 1, displayOrder: Number(row.display_order),
  }));
}

export function updateExcellentRegistry(db: Database.Database, input: StoredExcellentRegistryEntry) {
  const bizNo = normalizeBizNo(input.bizNo);
  if (bizNo.length !== 10) throw new Error("\uC0AC\uC5C5\uC790\uBC88\uD638\uB294 10\uC790\uB9AC\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  if (!input.companyName.trim()) throw new Error("\uC5C5\uCCB4\uBA85\uC744 \uC785\uB825\uD574\uC57C \uD569\uB2C8\uB2E4.");
  if (!isIsoDate(input.designationStartDate) || !isIsoDate(input.designationEndDate) || input.designationStartDate > input.designationEndDate) {
    throw new Error("\uC9C0\uC815 \uC2DC\uC791\uC77C\uACFC \uB9CC\uB8CC\uC77C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  }
  const result = db.prepare(`UPDATE market_excellent_registry SET company_name=?, designation_no=?,
    designation_start_date=?, designation_end_date=?, enabled=?, display_order=? WHERE biz_no=?`).run(
    input.companyName.trim(), input.designationNo.trim(), input.designationStartDate,
    input.designationEndDate, input.enabled ? 1 : 0, input.displayOrder, bizNo,
  );
  if (result.changes !== 1) throw new Error("\uC218\uC815\uD560 \uC5C5\uCCB4\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
}

export function replaceMarketAwards(db: Database.Database, awards: StoredMarketAward[]) {
  db.transaction(() => {
    db.prepare("DELETE FROM market_awards").run();
    writeMarketAwards(db, awards);
  })();
}

export function upsertMarketAwards(db: Database.Database, awards: StoredMarketAward[]) {
  db.transaction(() => writeMarketAwards(db, awards))();
}

function writeMarketAwards(db: Database.Database, awards: StoredMarketAward[]) {
  const insert = db.prepare(`INSERT INTO market_awards
    (notice_no, notice_order, final_award_date, winner_biz_no, winner_name, amount,
     notice_name, demand_agency_name, region_name, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(notice_no, notice_order) DO UPDATE SET
      final_award_date=excluded.final_award_date,
      winner_biz_no=excluded.winner_biz_no,
      winner_name=excluded.winner_name,
      amount=excluded.amount,
      notice_name=excluded.notice_name,
      demand_agency_name=excluded.demand_agency_name,
      region_name=excluded.region_name,
      source_url=excluded.source_url`);
  for (const award of awards) {
    insert.run(
      award.noticeNo, award.noticeOrder, award.finalAwardDate, normalizeBizNo(award.winnerBizNo),
      award.winnerName.trim(), award.amount,
      award.noticeName ?? null, award.demandAgencyName ?? null, deriveRegionName(award.demandAgencyName),
      award.sourceUrl,
    );
  }
}

export function listMarketAwards(db: Database.Database): StoredMarketAward[] {
  const rows = db.prepare(`SELECT notice_no, notice_order, final_award_date, winner_biz_no,
    winner_name, amount, notice_name, demand_agency_name, region_name, source_url
    FROM market_awards ORDER BY final_award_date DESC, notice_no`).all() as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    noticeNo: String(row.notice_no), noticeOrder: String(row.notice_order), finalAwardDate: String(row.final_award_date),
    winnerBizNo: String(row.winner_biz_no), winnerName: String(row.winner_name),
    amount: row.amount === null ? null : Number(row.amount),
    noticeName: row.notice_name === null ? null : String(row.notice_name),
    demandAgencyName: row.demand_agency_name === null ? null : String(row.demand_agency_name),
    regionName: String(row.region_name),
    sourceUrl: row.source_url === null ? null : String(row.source_url),
  }));
}

export function replaceMarketContracts(db: Database.Database, contracts: StoredMarketContract[]) {
  db.transaction(() => {
    db.prepare("DELETE FROM market_contracts").run();
    writeMarketContracts(db, contracts);
  })();
}

export function upsertMarketContracts(db: Database.Database, contracts: StoredMarketContract[]) {
  db.transaction(() => writeMarketContracts(db, contracts))();
}

function writeMarketContracts(db: Database.Database, contracts: StoredMarketContract[]) {
  const insert = db.prepare(`INSERT INTO market_contracts
    (source_identity, contract_no, contract_name, contract_date, notice_no, notice_order,
     winner_biz_no, winner_name, amount, demand_agency_name, region_name, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_identity) DO UPDATE SET
      contract_no=excluded.contract_no,
      contract_name=excluded.contract_name,
      contract_date=excluded.contract_date,
      notice_no=excluded.notice_no,
      notice_order=excluded.notice_order,
      winner_biz_no=excluded.winner_biz_no,
      winner_name=excluded.winner_name,
      amount=excluded.amount,
      demand_agency_name=excluded.demand_agency_name,
      region_name=excluded.region_name,
      source_url=excluded.source_url`);
  for (const contract of contracts) {
    insert.run(
      contract.sourceIdentity, contract.contractNo, contract.contractName, contract.contractDate,
      contract.noticeNo, contract.noticeOrder,
      normalizeBizNo(contract.winnerBizNo), contract.winnerName.trim(), contract.amount,
      contract.demandAgencyName, deriveRegionName(contract.demandAgencyName), contract.sourceUrl,
    );
  }
}

export function listMarketContracts(db: Database.Database): StoredMarketContract[] {
  const rows = db.prepare(`SELECT source_identity, contract_no, contract_name, contract_date,
    notice_no, notice_order, winner_biz_no, winner_name, amount, demand_agency_name, region_name, source_url
    FROM market_contracts ORDER BY contract_date DESC, contract_no`).all() as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    sourceIdentity: String(row.source_identity),
    contractNo: String(row.contract_no),
    contractName: String(row.contract_name),
    contractDate: String(row.contract_date),
    noticeNo: row.notice_no === null ? null : String(row.notice_no),
    noticeOrder: row.notice_order === null ? null : String(row.notice_order),
    winnerBizNo: String(row.winner_biz_no),
    winnerName: String(row.winner_name),
    amount: row.amount === null ? null : Number(row.amount),
    demandAgencyName: row.demand_agency_name === null ? null : String(row.demand_agency_name),
    regionName: String(row.region_name),
    sourceUrl: row.source_url === null ? null : String(row.source_url),
  }));
}

export function getMarketSyncState(db: Database.Database) {
  const row = db.prepare("SELECT last_synced_at, status, message FROM market_sync_state WHERE singleton=1").get() as {
    last_synced_at: string | null; status: "never" | "syncing" | "ready" | "failed"; message: string | null;
  };
  return { lastSyncedAt: row.last_synced_at, status: row.status, message: row.message };
}

export function setMarketSyncState(db: Database.Database, status: "never" | "syncing" | "ready" | "failed", message: string | null, lastSyncedAt?: string | null) {
  db.prepare(`UPDATE market_sync_state SET status=?, message=?,
    last_synced_at=CASE WHEN ? IS NULL THEN last_synced_at ELSE ? END WHERE singleton=1`)
    .run(status, message, lastSyncedAt ?? null, lastSyncedAt ?? null);
}

export function deriveRegionName(demandAgencyName: string | null | undefined): string {
  if (!demandAgencyName) return "\uAE30\uD0C0";
  return demandAgencyName.toLowerCase().includes("\uBD80\uC0B0") ? "\uBD80\uC0B0" : "\uAE30\uD0C0";
}

function normalizeBizNo(value: string) { return value.replace(/\D/g, ""); }

function isIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function designationEndDate(start: string) {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 6);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
