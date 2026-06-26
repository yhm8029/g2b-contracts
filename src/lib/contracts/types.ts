export type ContractSearchParams = {
  businessNumber: string;
  dateFrom?: string;
  dateTo?: string;
  businessCategory?: string;
};

export type ContractSearchRow = {
  id: number;
  businessId: number | null;
  bizNoNormalized: string;
  bizNoDisplay: string | null;
  businessName: string | null;
  businessCategory: string;
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  contractNo: string | null;
  unifiedContractNo: string | null;
  contractName: string;
  contractDate: string;
  currentContractAmount: number | null;
  totalContractAmount: number | null;
  demandAgencyCode: string | null;
  demandAgencyName: string | null;
  contractAgencyCode: string | null;
  contractAgencyName: string | null;
  contractMethod: string | null;
  winningMethod: string | null;
  businessNameAtContract: string | null;
  contractDetailUrl: string | null;
  noticeDetailUrl: string | null;
  rawSourceUrl: string | null;
  sourceDataset: string;
  sourceRowHash: string;
  sourceStatus: string;
  lastImportedAt: string;
  lastEnrichedAt: string | null;
};

export type ImportResult = {
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
};

export type DatabaseHealth = {
  totalContractCount: number;
  latestImportTimestamp: string | null;
};
