import { z } from "zod";

import { fetchG2bJson } from "@/lib/g2b/http";
import { firstApiItem, optionalApiString } from "@/lib/g2b/parsing";

export const CONTRACT_INFO_BASE_URL = "https://apis.data.go.kr/1230000/CntrctInfoService";
export const GET_CONTRACT_INFO_OPERATION = "getCntrctInfoListThng";

export type ContractInfo = {
  contractNo: string | null;
  unifiedContractNo: string | null;
  contractName: string | null;
  contractDetailUrl: string | null;
};

const contractInfoItemSchema = z
  .object({
    dcsnCntrctNo: optionalApiString,
    untyCntrctNo: optionalApiString,
    cntrctNm: optionalApiString,
    cntrctDtlInfoUrl: optionalApiString,
  })
  .passthrough();

export function parseContractInfoResponse(response: unknown): ContractInfo {
  const item = contractInfoItemSchema.parse(firstApiItem(response));

  return {
    contractNo: item.dcsnCntrctNo,
    unifiedContractNo: item.untyCntrctNo,
    contractName: item.cntrctNm,
    contractDetailUrl: item.cntrctDtlInfoUrl,
  };
}

export async function fetchContractInfo(contractNo: string): Promise<ContractInfo> {
  const response = await fetchG2bJson(CONTRACT_INFO_BASE_URL, GET_CONTRACT_INFO_OPERATION, {
    dcsnCntrctNo: contractNo,
    pageNo: 1,
    numOfRows: 10,
  });

  return parseContractInfoResponse(response);
}
