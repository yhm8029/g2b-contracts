import ExcelJS from "exceljs";

import type { CompetitorSalesOverviewResponse } from "./types";

const WON_NUMBER_FORMAT = "₩#,##0";
const DATE_NUMBER_FORMAT = "yyyy-mm-dd";

export async function buildCompetitorSalesWorkbook(
  overview: CompetitorSalesOverviewResponse,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "g2b-contracts";
  workbook.created = new Date();

  addSummaryWorksheet(workbook, overview);
  addDetailsWorksheet(workbook, overview);

  return workbook.xlsx.writeBuffer();
}

function addSummaryWorksheet(workbook: ExcelJS.Workbook, overview: CompetitorSalesOverviewResponse) {
  const sheet = workbook.addWorksheet("업체별 요약", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "순위", key: "rank", width: 8 },
    { header: "업체명", key: "companyName", width: 28 },
    { header: "사업자번호", key: "bizNo", width: 16 },
    { header: "지정번호", key: "designationNo", width: 14 },
    { header: "지정시작일", key: "designationStartDate", width: 14 },
    { header: "지정종료일", key: "designationEndDate", width: 14 },
    { header: "계약건수", key: "contractCount", width: 12 },
    { header: "계약금액", key: "totalAmount", width: 18 },
    { header: "최근계약일", key: "latestContractDate", width: 14 },
  ];

  overview.companies.forEach((company, index) => {
    sheet.addRow({
      rank: index + 1,
      companyName: company.companyName,
      bizNo: company.bizNo,
      designationNo: company.designationNo,
      designationStartDate: excelDate(company.designationStartDate),
      designationEndDate: excelDate(company.designationEndDate),
      contractCount: company.contractCount,
      totalAmount: company.totalAmount,
      latestContractDate: excelDate(company.latestContractDate),
    });
  });

  formatHeader(sheet);
  formatDateColumn(sheet, "E");
  formatDateColumn(sheet, "F");
  formatDateColumn(sheet, "I");
  formatWonColumn(sheet, "H");
  sheet.autoFilter = { from: "A1", to: `I${Math.max(sheet.rowCount, 1)}` };
}

function addDetailsWorksheet(workbook: ExcelJS.Workbook, overview: CompetitorSalesOverviewResponse) {
  const sheet = workbook.addWorksheet("전체", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "업체명", key: "companyName", width: 28 },
    { header: "사업자번호", key: "bizNo", width: 16 },
    { header: "지정번호", key: "designationNo", width: 14 },
    { header: "지정시작일", key: "designationStartDate", width: 14 },
    { header: "지정종료일", key: "designationEndDate", width: 14 },
    { header: "계약명", key: "contractName", width: 42 },
    { header: "품목명", key: "itemName", width: 36 },
    { header: "수요기관", key: "demandAgencyName", width: 24 },
    { header: "계약기관", key: "contractAgencyName", width: 24 },
    { header: "계약일", key: "contractDate", width: 14 },
    { header: "계약방식", key: "contractMethod", width: 18 },
    { header: "계약금액", key: "contractAmount", width: 18 },
    { header: "금액귀속", key: "amountAttribution", width: 18 },
    { header: "계약번호", key: "contractNo", width: 22 },
    { header: "공고번호", key: "noticeNo", width: 22 },
    { header: "원문 URL", key: "sourceUrl", width: 54 },
  ];

  for (const company of overview.companies) {
    for (const contract of company.contracts) {
      const row = sheet.addRow({
        companyName: company.companyName,
        bizNo: company.bizNo,
        designationNo: company.designationNo,
        designationStartDate: excelDate(company.designationStartDate),
        designationEndDate: excelDate(company.designationEndDate),
        contractName: contract.contractName,
        itemName: (contract.itemNames ?? []).join(", "),
        demandAgencyName: contract.demandAgencyName,
        contractAgencyName: contract.contractAgencyName,
        contractDate: excelDate(contract.contractDate),
        contractMethod: contract.contractMethod,
        contractAmount: contract.totalContractAmount,
        amountAttribution: amountAttributionLabel(contract.amountAttribution),
        contractNo: contract.contractNo,
        noticeNo: contract.noticeNo,
        sourceUrl: safeSourceHyperlink(contract.contractDetailUrl, contract.noticeDetailUrl),
      });
      const sourceCell = row.getCell(16);
      if (sourceCell.hyperlink) {
        sourceCell.font = { color: { argb: "FF0563C1" }, underline: true };
      }
    }
  }

  formatHeader(sheet);
  formatDateColumn(sheet, "D");
  formatDateColumn(sheet, "E");
  formatDateColumn(sheet, "J");
  formatWonColumn(sheet, "L");
  sheet.autoFilter = { from: "A1", to: `P${Math.max(sheet.rowCount, 1)}` };
}

function formatHeader(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17233B" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 24;
}

function formatDateColumn(sheet: ExcelJS.Worksheet, column: string) {
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    sheet.getCell(`${column}${row}`).numFmt = DATE_NUMBER_FORMAT;
  }
}

function formatWonColumn(sheet: ExcelJS.Worksheet, column: string) {
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    sheet.getCell(`${column}${row}`).numFmt = WON_NUMBER_FORMAT;
  }
}

function excelDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

function amountAttributionLabel(value: string | undefined) {
  switch (value) {
    case "full-contract": return "전체 계약금액";
    case "supplier-reported": return "공급사 신고금액";
    case "supplier-rate": return "공급비율 배분";
    case "equal-share": return "균등배분 추정";
    default: return "";
  }
}

function safeSourceHyperlink(...candidates: Array<string | null | undefined>): ExcelJS.CellHyperlinkValue | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return { text: candidate, hyperlink: candidate };
      }
    } catch {
      // Ignore malformed source URLs from the upstream dataset.
    }
  }
  return null;
}
