import type Database from "better-sqlite3";

import type { ExcellentRegistryEntry, MarketAwardInput } from "./report";

export const COOPERATIVE_BIZ_NO = "2148204708";

export type StoredMarketAward = MarketAwardInput & {
  amount: number | null;
  sourceUrl: string | null;
};

export type StoredExcellentRegistryEntry = ExcellentRegistryEntry & {
  designationNo: string;
  displayOrder: number;
};

const SEED_REGISTRY: ReadonlyArray<readonly [string, string, string, string]> = [
  ["덕산메카시스(주)", "2208104763", "2026058", "2026-07-20"],
  ["(주)우리젠", "1138190302", "2025208", "2026-01-19"],
  ["이에스콘트롤스(주)", "1108175113", "2025205", "2026-01-19"],
  ["주식회사 비엘아이앤씨", "7708700599", "2025140", "2026-01-18"],
  ["(주)파노텍", "2048145651", "2025135", "2025-10-20"],
  ["중앙아이엔티 주식회사", "1268144518", "2025074", "2025-07-21"],
  ["성한 주식회사", "3148146957", "2025073", "2025-07-21"],
  ["한경기전(주)", "1138111990", "2024064", "2024-09-13"],
  ["한국디지탈콘트롤 주식회사", "1238122892", "2024063", "2024-07-15"],
  ["주식회사 나라컨트롤", "2118138895", "2024150", "2024-07-15"],
  ["주식회사 삼원씨앤지", "2048169430", "2024018", "2024-04-15"],
  ["주식회사 신영정보기술", "2068117262", "2024004", "2024-04-15"],
  ["주식회사일렉콤", "1338128627", "2023197", "2024-01-22"],
  ["(주)헤리트", "3148130305", "2022241", "2023-03-17"],
  ["(주)케이디티", "1078171028", "2022186", "2022-10-24"],
  ["로지시스템(주)", "1098182104", "2022061", "2022-05-02"],
  ["주식회사 엠알바스", "2148143121", "2021037", "2021-06-07"],
  ["주식회사 주인정보시스템", "2208658565", "2020239", "2021-03-22"],
  ["서전엔지니어링(주)", "2208165402", "2020220", "2021-03-22"],
  ["(주)동양이엔씨", "1068133832", "2020111", "2020-11-10"],
  ["(주)신아시스템", "1238180252", "2020101", "2020-11-10"],
  ["화인시스템(주)", "5028142086", "2020059", "2020-07-31"],
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
      winner_biz_no TEXT NOT NULL, winner_name TEXT NOT NULL, amount REAL, source_url TEXT,
      PRIMARY KEY (notice_no, notice_order)
    );
    CREATE TABLE IF NOT EXISTS market_sync_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), last_synced_at TEXT,
      status TEXT NOT NULL, message TEXT
    );
    INSERT OR IGNORE INTO market_sync_state(singleton, status) VALUES (1, 'never');
  `);

  const insert = db.prepare(`INSERT OR IGNORE INTO market_excellent_registry
    (biz_no, company_name, designation_no, designation_start_date, designation_end_date, enabled, display_order)
    VALUES (?, ?, ?, ?, ?, 1, ?)`);
  db.transaction(() => SEED_REGISTRY.forEach(([name, bizNo, designationNo, start], index) =>
    insert.run(bizNo, name, designationNo, start, designationEndDate(start), index + 1)))();
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
  if (bizNo.length !== 10) throw new Error("사업자번호는 10자리여야 합니다.");
  if (!input.companyName.trim()) throw new Error("업체명을 입력해야 합니다.");
  if (!isIsoDate(input.designationStartDate) || !isIsoDate(input.designationEndDate) || input.designationStartDate > input.designationEndDate) {
    throw new Error("지정 시작일과 만료일을 확인해 주세요.");
  }
  const result = db.prepare(`UPDATE market_excellent_registry SET company_name=?, designation_no=?,
    designation_start_date=?, designation_end_date=?, enabled=?, display_order=? WHERE biz_no=?`).run(
    input.companyName.trim(), input.designationNo.trim(), input.designationStartDate,
    input.designationEndDate, input.enabled ? 1 : 0, input.displayOrder, bizNo,
  );
  if (result.changes !== 1) throw new Error("수정할 업체를 찾지 못했습니다.");
}

export function replaceMarketAwards(db: Database.Database, awards: StoredMarketAward[]) {
  const insert = db.prepare(`INSERT INTO market_awards
    (notice_no, notice_order, final_award_date, winner_biz_no, winner_name, amount, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare("DELETE FROM market_awards").run();
    for (const award of awards) {
      insert.run(award.noticeNo, award.noticeOrder, award.finalAwardDate, normalizeBizNo(award.winnerBizNo),
        award.winnerName.trim(), award.amount, award.sourceUrl);
    }
  })();
}

export function listMarketAwards(db: Database.Database): StoredMarketAward[] {
  const rows = db.prepare(`SELECT notice_no, notice_order, final_award_date, winner_biz_no,
    winner_name, amount, source_url FROM market_awards ORDER BY final_award_date DESC, notice_no`).all() as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    noticeNo: String(row.notice_no), noticeOrder: String(row.notice_order), finalAwardDate: String(row.final_award_date),
    winnerBizNo: String(row.winner_biz_no), winnerName: String(row.winner_name),
    amount: row.amount === null ? null : Number(row.amount), sourceUrl: row.source_url === null ? null : String(row.source_url),
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
