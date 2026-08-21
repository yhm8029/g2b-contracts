import ExcelJS from "exceljs";
import { PNG } from "pngjs";

import type { MarketShareReport } from "./report";
import type { StoredMarketAward } from "./store";

const COLORS = ["156f4a", "d97706", "2563eb", "be123c", "7c3aed", "0891b2", "4d7c0f", "c2410c", "4338ca", "0f766e", "a16207", "0369a1", "9f1239", "6d28d9", "15803d", "b45309", "1d4ed8", "b91c1c", "5b21b6", "0e7490", "3f6212", "9a3412", "3730a3", "047857"];

export async function buildMarketWorkbook(report: MarketShareReport, awards: StoredMarketAward[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "g2b-contracts";
  const summary = workbook.addWorksheet("시장점유율", { views: [{ state: "frozen", ySplit: 5 }] });
  summary.columns = [32, 14, 18, 15, 12, 14].map((width) => ({ width }));
  summary.mergeCells("A1:F1");
  summary.getCell("A1").value = "빌딩자동제어 시장점유율";
  summary.getCell("A1").font = { bold: true, size: 17, color: { argb: "FF153D2E" } };
  summary.mergeCells("A2:F2");
  summary.getCell("A2").value = `조회 기간: ${report.periodLabel}`;
  summary.mergeCells("A3:F3");
  summary.getCell("A3").value = `전체 공고 수: ${report.totalAwardCount}건`;
  const header = summary.getRow(5);
  header.values = ["업체명", "분류", "사업자번호", "지정 만료일", "낙찰 건수", "시장점유율"];
  styleHeader(header);
  for (const row of report.rows) {
    const added = summary.addRow([
      row.companyName, categoryLabel(row.category), row.bizNo ?? "", row.designationEndDate ?? "",
      row.awardCount, row.marketSharePercent / 100,
    ]);
    added.getCell(6).numFmt = "0.0%";
  }
  summary.autoFilter = { from: "A5", to: `F${Math.max(5, summary.rowCount)}` };
  const imageId = workbook.addImage({
    base64: `data:image/png;base64,${buildPiePng(report).toString("base64")}`,
    extension: "png",
  });
  summary.addImage(imageId, { tl: { col: 7, row: 1 }, ext: { width: 720, height: 420 } });

  const details = workbook.addWorksheet("낙찰내역", { views: [{ state: "frozen", ySplit: 1 }] });
  details.columns = [26, 8, 14, 30, 18, 18, 48].map((width) => ({ width }));
  details.getRow(1).values = ["공고번호", "차수", "낙찰일", "업체명", "사업자번호", "낙찰금액", "원문 URL"];
  styleHeader(details.getRow(1));
  for (const award of awards.filter((item) => inReportPeriod(item.finalAwardDate, report.period))) {
    const row = details.addRow([award.noticeNo, award.noticeOrder, award.finalAwardDate, award.winnerName, award.winnerBizNo, award.amount, award.sourceUrl ?? ""]);
    row.getCell(6).numFmt = "#,##0";
    if (award.sourceUrl && /^https?:\/\//i.test(award.sourceUrl)) {
      row.getCell(7).value = { text: award.sourceUrl, hyperlink: award.sourceUrl };
      row.getCell(7).font = { color: { argb: "FF0563C1" }, underline: true };
    }
  }
  details.autoFilter = { from: "A1", to: `G${Math.max(1, details.rowCount)}` };
  const output = await workbook.xlsx.writeBuffer();
  const bytes = Buffer.from(output);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 25;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B4A" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
}

function buildPiePng(report: MarketShareReport) {
  const png = new PNG({ width: 720, height: 420 });
  png.data.fill(255);
  const total = report.rows.reduce((sum, row) => sum + row.awardCount, 0);
  const cumulative: number[] = [];
  report.rows.reduce((sum, row) => { const next = sum + (total ? row.awardCount / total : 0); cumulative.push(next); return next; }, 0);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < 390; x += 1) {
      const dx = x - 195;
      const dy = y - 210;
      if (dx * dx + dy * dy > 155 * 155) continue;
      const ratio = ((Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      const colorIndex = total ? Math.max(0, cumulative.findIndex((limit) => ratio <= limit)) : -1;
      setPixel(png, x, y, colorIndex >= 0 ? COLORS[colorIndex % COLORS.length] : "e5e7eb");
    }
  }
  report.rows.forEach((_, index) => fillRect(png, 415, 20 + index * 16, 12, 12, COLORS[index % COLORS.length]));
  return PNG.sync.write(png);
}

function fillRect(png: PNG, x: number, y: number, width: number, height: number, color: string) {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) setPixel(png, px, py, color);
}

function setPixel(png: PNG, x: number, y: number, color: string) {
  const offset = (y * png.width + x) * 4;
  const value = Number.parseInt(color, 16);
  png.data[offset] = value >> 16;
  png.data[offset + 1] = value >> 8 & 255;
  png.data[offset + 2] = value & 255;
  png.data[offset + 3] = 255;
}

function inReportPeriod(date: string, period: { year: number; quarter?: number }) {
  return Number(date.slice(0, 4)) === period.year
    && (period.quarter === undefined || Math.ceil(Number(date.slice(5, 7)) / 3) === period.quarter);
}

function categoryLabel(category: string) {
  if (category === "excellent") return "조달우수";
  if (category === "cooperative") return "협동조합";
  return "조달우수X";
}
