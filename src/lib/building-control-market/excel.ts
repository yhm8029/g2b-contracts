import ExcelJS from "exceljs";
import { PNG } from "pngjs";

import type {
  MarketShareReport,
  ReportBasis,
  ReportRegion,
} from "./report";
import type { StoredMarketAward, StoredMarketContract } from "./store";

const COLORS = ["156f4a", "d97706", "2563eb", "be123c", "7c3aed", "0891b2", "4d7c0f", "c2410c", "4338ca", "0f766e", "a16207", "0369a1", "9f1239", "6d28d9", "15803d", "b45309", "1d4ed8", "b91c1c", "5b21b6", "0e7490", "3f6212", "9a3412", "3730a3", "047857"];

export async function buildMarketWorkbook(input: {
  report: MarketShareReport;
  basis: ReportBasis;
  region: ReportRegion;
  awards: StoredMarketAward[];
  contracts: StoredMarketContract[];
}) {
  const { report, basis, region, awards, contracts } = input;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "g2b-contracts";

  const summary = workbook.addWorksheet("\uc2dc\uc7a5\uc810\uc720\uc728", { views: [{ state: "frozen", ySplit: 5 }] });
  summary.columns = [32, 14, 18, 15, 12, 14].map((width) => ({ width }));
  summary.mergeCells("A1:F1");
  summary.getCell("A1").value = "\ube4c\ub529\uc790\ub3d9\uc81c\uc5b4 \uc2dc\uc7a5\uc810\uc720\uc728";
  summary.getCell("A1").font = { bold: true, size: 17, color: { argb: "FF153D2E" } };
  summary.mergeCells("A2:F2");
  summary.getCell("A2").value = `\uc870\ud68c \uae30\uac04: ${report.periodLabel}`;
  summary.mergeCells("A3:F3");
  summary.getCell("A3").value = `\uae30\uc900: ${basisLabel(basis)} \u00b7 \uc9c0\uc5ed: ${region === "all" ? "\uc804\uad6d" : "\ubd80\uc0b0"}`;
  summary.mergeCells("A4:F4");
  summary.getCell("A4").value = `${basisCountLabel(basis)}: ${report.totalAwardCount}\uac74`;

  const header = summary.getRow(6);
  header.values = ["\uc5c5\uccb4\uba85", "\ubd84\ub958", "\uc0ac\uc5c5\uc790\ubc88\ud638", "\uc9c0\uc815 \ub9c8\ub8cc\uc77c", basis === "award" ? "\ub099\ucc30 \uacf5\uace0 \uac74\uc218" : basis === "contract" ? "\ub0a9\ud488\uc694\uad6c \uac74\uc218" : "\ud1b5\ud569 \uac74\uc218", "\uc2dc\uc7a5\uc810\uc720\uc728"];
  styleHeader(header);
  for (const row of report.rows) {
    const added = summary.addRow([
      row.companyName, categoryLabel(row.category), row.bizNo ?? "", row.designationEndDate ?? "",
      row.awardCount, row.marketSharePercent / 100,
    ]);
    added.getCell(6).numFmt = "0.0%";
  }
  summary.autoFilter = { from: "A6", to: `F${Math.max(6, summary.rowCount)}` };
  const imageId = workbook.addImage({
    base64: `data:image/png;base64,${buildPiePng(report).toString("base64")}`,
    extension: "png",
  });
  summary.addImage(imageId, { tl: { col: 7, row: 1 }, ext: { width: 720, height: 420 } });

  const details = workbook.addWorksheet(basis === "award" ? "\uacf5\uace0\ub0b4\uc5ed" : basis === "contract" ? "\uc1fc\ud551\ubab0\ub0b4\uc5ed" : "\ud1b5\ud569\ub0b4\uc5ed", { views: [{ state: "frozen", ySplit: 1 }] });
  details.columns = [14, 14, 36, 14, 20, 22, 18, 18, 28, 48].map((width) => ({ width }));
  details.getRow(1).values = basis === "award"
    ? ["\uae30\uc900", "\uc9c0\uc5ed", "\uacf5\uace0\uba85", "\ub099\ucc30\uc77c", "\uacf5\uace0\ubc88\ud638", "\uc5c5\uccb4\uba85", "\uc0ac\uc5c5\uc790\ubc88\ud638", "\uae08\uc561", "\uc218\uc694\uae30\uad00", "\uc6d0\ubb38 URL"]
    : basis === "contract"
      ? ["\uae30\uc900", "\uc9c0\uc5ed", "\ub0a9\ud488\uc694\uad6c\uba85", "\ub0a9\ud488\uc694\uad6c\uc77c", "\ub0a9\ud488\uc694\uad6c\ubc88\ud638", "\uc5c5\uccb4\uba85", "\uc0ac\uc5c5\uc790\ubc88\ud638", "\uae08\uc561", "\uc218\uc694\uae30\uad00", "\uc6d0\ubb38 URL"]
      : ["\uae30\uc900", "\uc9c0\uc5ed", "\ub0b4\uc5ed\uba85", "\uae30\uc900\uc77c", "\ubc88\ud638", "\uc5c5\uccb4\uba85", "\uc0ac\uc5c5\uc790\ubc88\ud638", "\uae08\uc561", "\uc218\uc694\uae30\uad00", "\uc6d0\ubb38 URL"];
  styleHeader(details.getRow(1));

  if (basis !== "contract") {
    for (const award of awards.filter((item) => inReportPeriod(item.finalAwardDate, report.period) && matchesExportRegion(item.regionName, region))) {
      const row = details.addRow([
        "\ub098\ub77c\uc7a5\ud130 \uacf5\uace0",
        award.regionName,
        award.noticeName ?? "",
        award.finalAwardDate,
        award.noticeNo,
        award.winnerName,
        award.winnerBizNo,
        award.amount,
        award.demandAgencyName ?? "",
        award.sourceUrl ?? "",
      ]);
      if (award.sourceUrl && /^https?:\/\//i.test(award.sourceUrl)) {
        row.getCell(10).value = { text: award.sourceUrl, hyperlink: award.sourceUrl };
        row.getCell(10).font = { color: { argb: "FF0563C1" }, underline: true };
      }
    }
  }
  if (basis !== "award") {
    for (const contract of contracts.filter((item) => inReportPeriod(item.contractDate, report.period) && matchesExportRegion(item.regionName, region))) {
      const row = details.addRow([
        "\uc885\ud569\uc1fc\ud551\ubab0",
        contract.regionName,
        contract.contractName,
        contract.contractDate,
        contract.contractNo,
        contract.winnerName,
        contract.winnerBizNo,
        contract.amount,
        contract.demandAgencyName ?? "",
        contract.sourceUrl ?? "",
      ]);
      if (contract.sourceUrl && /^https?:\/\//i.test(contract.sourceUrl)) {
        row.getCell(10).value = { text: contract.sourceUrl, hyperlink: contract.sourceUrl };
        row.getCell(10).font = { color: { argb: "FF0563C1" }, underline: true };
      }
    }
  }

  details.getColumn(8).numFmt = "#,##0";
  details.autoFilter = { from: "A1", to: `J${Math.max(1, details.rowCount)}` };

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

function matchesExportRegion(regionName: string, region: ReportRegion) {
  return region === "all" || regionName === "\uBD80\uC0B0";
}

function categoryLabel(category: string) {
  if (category === "excellent") return "\uc870\ub2ec\uc6b0\uc218";
  if (category === "cooperative") return "\ud611\ub3d9\uc870\ud569";
  return "\uc870\ub2ec\uc6b0\uc218X";
}

function basisLabel(basis: ReportBasis) {
  if (basis === "award") return "\ub098\ub77c\uc7a5\ud130 \uacf5\uace0";
  if (basis === "contract") return "\uc885\ud569\uc1fc\ud551\ubab0";
  return "\ud1b5\ud569";
}

function basisCountLabel(basis: ReportBasis) {
  if (basis === "award") return "\uc804\uccb4 \uacf5\uace0 \uc218";
  if (basis === "contract") return "\uc804\uccb4 \uc1fc\ud551\ubab0 \uc218";
  return "\uc804\uccb4 \ud1b5\ud569 \uc218";
}
