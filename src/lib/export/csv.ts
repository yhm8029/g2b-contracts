import type { ContractSearchRow } from "@/lib/contracts/types";

const header = [
  "contract_date",
  "contract_name",
  "notice_name",
  "contract_amount",
  "demand_agency",
  "contract_agency",
  "contract_method",
  "business_category",
  "notice_no",
  "contract_no",
  "contract_detail_url",
  "notice_detail_url",
  "source_status",
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

  return [header.join(","), ...csvRows, ""].join("\n");
}
