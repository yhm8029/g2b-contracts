import type { ContractSearchRow } from "@/lib/contracts/types";

export type ContractSummary = {
  contractCount: number;
  totalAmount: number;
  noticeLinkedCount: number;
  latestContractDate: string | null;
};

export function summarizeContracts(rows: ContractSearchRow[]): ContractSummary {
  return {
    contractCount: rows.length,
    totalAmount: rows.reduce((sum, row) => sum + (row.totalContractAmount ?? 0), 0),
    noticeLinkedCount: rows.filter((row) => row.noticeNo !== null).length,
    latestContractDate: rows.reduce<string | null>((latest, row) => {
      if (latest === null || row.contractDate > latest) {
        return row.contractDate;
      }

      return latest;
    }, null),
  };
}
