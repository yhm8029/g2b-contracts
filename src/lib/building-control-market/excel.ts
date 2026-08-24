import ExcelJS from "exceljs";
import JSZip from "jszip";

import {
  removeCrossSourceDuplicateContracts,
  type MarketShareReport,
  type ReportBasis,
  type ReportRegion,
} from "./report";
import {
  classifyMarketRegion,
  marketRegionLabel,
  matchesMarketRegion,
} from "./regions";
import { isExcludedMarketFrameworkName } from "./rules";
import type { StoredMarketAward, StoredMarketContract } from "./store";

const COLORS = ["156f4a", "d97706", "2563eb", "be123c", "7c3aed", "0891b2", "4d7c0f", "c2410c", "4338ca", "0f766e", "a16207", "0369a1", "9f1239", "6d28d9", "15803d", "b45309", "1d4ed8", "b91c1c", "5b21b6", "0e7490", "3f6212", "9a3412", "3730a3", "047857"];

export function marketWorkbookFileName(
  basis: ReportBasis,
  region: ReportRegion,
  period: MarketShareReport["period"],
): string {
  const basisLabel = basis === "award"
    ? "\uB098\uB77C\uC7A5\uD130"
    : basis === "contract"
      ? "\uC885\uD569\uC1FC\uD551\uBAB0"
      : "\uD1B5\uD569";
  const regionLabel = marketRegionLabel(region);
  const periodLabel = period.quarter
    ? `${period.year}\uB144${period.quarter}\uBD84\uAE30`
    : `${period.year}\uC5F0\uAC04`;
  return `${basisLabel}_${regionLabel}_${periodLabel}.xlsx`;
}

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
  summary.getCell("A3").value = `\uae30\uc900: ${basisLabel(basis)} \u00b7 \uc9c0\uc5ed: ${marketRegionLabel(region)}`;
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
  const details = workbook.addWorksheet(basis === "award" ? "\uacf5\uace0\ub0b4\uc5ed" : basis === "contract" ? "\uc1fc\ud551\ubab0\ub0b4\uc5ed" : "\ud1b5\ud569\ub0b4\uc5ed", { views: [{ state: "frozen", ySplit: 1 }] });
  details.columns = [14, 14, 36, 14, 20, 20, 22, 18, 18, 28, 48].map((width) => ({ width }));
  details.getRow(1).values = basis === "award"
    ? ["\uae30\uc900", "\uc9c0\uc5ed", "\uacf5\uace0\uba85", "\ub099\ucc30\uc77c", "\uacf5\uace0\ubc88\ud638", "\uc5f0\uacc4\ubc88\ud638", "\uc5c5\uccb4\uba85", "\uc0ac\uc5c5\uc790\ubc88\ud638", "\uae08\uc561", "\uc218\uc694\uae30\uad00", "\uc6d0\ubb38 URL"]
    : basis === "contract"
      ? ["\uae30\uc900", "\uc9c0\uc5ed", "\ub0a9\ud488\uc694\uad6c\uba85", "\ub0a9\ud488\uc694\uad6c\uc77c", "\ub0a9\ud488\uc694\uad6c\ubc88\ud638", "\uc6d0 \ub2e8\uac00\uacc4\uc57d\ubc88\ud638", "\uc5c5\uccb4\uba85", "\uc0ac\uc5c5\uc790\ubc88\ud638", "\uae08\uc561", "\uc218\uc694\uae30\uad00", "\uc6d0\ubb38 URL"]
      : ["\uae30\uc900", "\uc9c0\uc5ed", "\ub0b4\uc5ed\uba85", "\uae30\uc900\uc77c", "\ubc88\ud638", "\uc6d0 \ub2e8\uac00\uacc4\uc57d\ubc88\ud638", "\uc5c5\uccb4\uba85", "\uc0ac\uc5c5\uc790\ubc88\ud638", "\uae08\uc561", "\uc218\uc694\uae30\uad00", "\uc6d0\ubb38 URL"];
  styleHeader(details.getRow(1));

  if (basis !== "contract") {
    for (const award of awards.filter((item) =>
      !isExcludedMarketFrameworkName(item.noticeName)
      && inReportPeriod(item.finalAwardDate, report.period)
      && matchesMarketRegion(item.demandAgencyName, region))) {
      const row = details.addRow([
        "\ub098\ub77c\uc7a5\ud130 \uacf5\uace0",
        marketRegionLabel(classifyMarketRegion(award.demandAgencyName)),
        award.noticeName ?? "",
        award.finalAwardDate,
        award.noticeNo,
        "",
        award.winnerName,
        award.winnerBizNo,
        award.amount,
        award.demandAgencyName ?? "",
        award.sourceUrl ?? "",
      ]);
      if (award.sourceUrl && /^https?:\/\//i.test(award.sourceUrl)) {
        row.getCell(11).value = { text: award.sourceUrl, hyperlink: award.sourceUrl };
        row.getCell(11).font = { color: { argb: "FF0563C1" }, underline: true };
      }
    }
  }
  if (basis !== "award") {
    const sourceContracts = basis === "combined"
      ? removeCrossSourceDuplicateContracts(awards, contracts)
      : contracts;
    for (const contract of sourceContracts.filter((item) =>
      inReportPeriod(item.contractDate, report.period)
      && matchesMarketRegion(item.demandAgencyName, region))) {
      const row = details.addRow([
        "\uc885\ud569\uc1fc\ud551\ubab0",
        marketRegionLabel(classifyMarketRegion(contract.demandAgencyName)),
        contract.contractName,
        contract.contractDate,
        contract.contractNo,
        contract.noticeNo ?? "",
        contract.winnerName,
        contract.winnerBizNo,
        contract.amount,
        contract.demandAgencyName ?? "",
        contract.sourceUrl ?? "",
      ]);
      if (contract.sourceUrl && /^https?:\/\//i.test(contract.sourceUrl)) {
        row.getCell(11).value = { text: contract.sourceUrl, hyperlink: contract.sourceUrl };
        row.getCell(11).font = { color: { argb: "FF0563C1" }, underline: true };
      }
    }
  }

  details.getColumn(9).numFmt = "#,##0";
  details.autoFilter = { from: "A1", to: `K${Math.max(1, details.rowCount)}` };

  const output = await workbook.xlsx.writeBuffer();
  const bytes = await addNativePieChart(Buffer.from(output), report);
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 25;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B4A" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
}

async function addNativePieChart(source: Buffer, report: MarketShareReport): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  const contentTypes = await requiredZipText(zip, "[Content_Types].xml");
  const sheet = await requiredZipText(zip, "xl/worksheets/sheet1.xml");
  const sheetRelsPath = "xl/worksheets/_rels/sheet1.xml.rels";
  const existingSheetRels = await zip.file(sheetRelsPath)?.async("string");
  const relationshipId = "rIdMarketChart";

  if (sheet.includes("<drawing ") || existingSheetRels?.includes(`Id="${relationshipId}"`)) {
    throw new Error("시장점유율 시트에 이미 충돌하는 차트 관계가 있습니다.");
  }

  zip.file("[Content_Types].xml", addContentTypeOverrides(contentTypes));
  zip.file("xl/worksheets/sheet1.xml", sheet.replace(
    "</worksheet>",
    `<drawing r:id="${relationshipId}"/></worksheet>`,
  ));
  zip.file(sheetRelsPath, addSheetDrawingRelationship(existingSheetRels, relationshipId));
  zip.file("xl/drawings/drawing1.xml", drawingXml());
  zip.file("xl/drawings/_rels/drawing1.xml.rels", drawingRelationshipsXml());
  zip.file("xl/charts/chart1.xml", pieChartXml(report));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function requiredZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`엑셀 내부 파일이 없습니다: ${path}`);
  return file.async("string");
}

function addContentTypeOverrides(xml: string): string {
  const drawingOverride = '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
  const chartOverride = '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>';
  return xml.replace("</Types>", `${drawingOverride}${chartOverride}</Types>`);
}

function addSheetDrawingRelationship(existing: string | undefined, relationshipId: string): string {
  const relationship = `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`;
  if (existing) return existing.replace("</Relationships>", `${relationship}</Relationships>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`;
}

function drawingRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>` +
    `</Relationships>`;
}

function drawingXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>23</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="시장점유율 차트"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
}

function pieChartXml(report: MarketShareReport): string {
  const firstRow = 7;
  const lastRow = 6 + report.rows.length;
  const categories = report.rows.map((row, index) =>
    `<c:pt idx="${index}"><c:v>${escapeXml(row.companyName)}</c:v></c:pt>`).join("");
  const values = report.rows.map((row, index) =>
    `<c:pt idx="${index}"><c:v>${row.awardCount}</c:v></c:pt>`).join("");
  const colors = report.rows.map((_, index) =>
    `<c:dPt><c:idx val="${index}"/><c:spPr><a:solidFill><a:srgbClr val="${COLORS[index % COLORS.length]}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:lang val="ko-KR"/><c:roundedCorners val="0"/>
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" sz="1200"/><a:t>시장점유율</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/>
      <c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>건수</c:v></c:tx>
        ${colors}
        <c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showLeaderLines val="1"/></c:dLbls>
        <c:cat><c:strRef><c:f>'시장점유율'!$A$${firstRow}:$A$${lastRow}</c:f><c:strCache><c:ptCount val="${report.rows.length}"/>${categories}</c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:f>'시장점유율'!$E$${firstRow}:$E$${lastRow}</c:f><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="${report.rows.length}"/>${values}</c:numCache></c:numRef></c:val>
      </c:ser><c:firstSliceAng val="270"/>
    </c:pieChart></c:plotArea>
    <c:legend><c:legendPos val="r"/><c:layout/><c:overlay val="0"/></c:legend>
    <c:plotVisOnly val="1"/><c:dispBlanksAs val="zero"/><c:showDLblsOverMax val="0"/>
  </c:chart>
  <c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings>
</c:chartSpace>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function inReportPeriod(date: string, period: { year: number; quarter?: number }) {
  return Number(date.slice(0, 4)) === period.year
    && (period.quarter === undefined || Math.ceil(Number(date.slice(5, 7)) / 3) === period.quarter);
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
