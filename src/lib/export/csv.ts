import type { ContractSearchRow } from "@/lib/contracts/types";

const utf8Bom = "\ufeff";

const header = [
  "사업자등록번호",
  "업체명",
  "계약일",
  "계약명",
  "공고명",
  "계약금액",
  "수요기관",
  "계약기관",
  "계약방법",
  "업무구분",
  "공고번호",
  "계약번호",
  "계약상세URL",
  "공고상세URL",
  "데이터상태",
];

function csvField(value: number | string | null): string {
  if (value === null) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export function contractsToCsv(rows: ContractSearchRow[]): string {
  const csvRows = rows.map((row) =>
    [
      row.bizNoDisplay ?? row.bizNoNormalized,
      row.businessName,
      row.contractDate,
      row.contractName,
      row.noticeName,
      row.totalContractAmount ?? row.currentContractAmount,
      row.demandAgencyName,
      row.contractAgencyName,
      row.contractMethod,
      row.businessCategory,
      row.noticeNo,
      row.contractNo,
      row.contractDetailUrl,
      row.noticeDetailUrl,
      row.sourceStatus,
    ]
      .map(csvField)
      .join(","),
  );

  return `${utf8Bom}${[header.join(","), ...csvRows, ""].join("\n")}`;
}
