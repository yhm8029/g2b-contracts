import { z } from "zod";

import { fetchG2bJson } from "@/lib/g2b/http";
import { firstApiItem, firstApiItemResult, optionalApiString } from "@/lib/g2b/parsing";

export const CONTRACT_INFO_BASE_URL = "https://apis.data.go.kr/1230000/ao/CntrctInfoService";
export const GET_CONTRACT_INFO_OPERATION = "getCntrctInfoListThng";

export type ContractInfo = {
  contractNo: string | null;
  unifiedContractNo: string | null;
  contractName: string | null;
  contractDetailUrl: string | null;
};

export type ContractInfoLookup = ContractInfo & {
  matched: boolean;
};

export type ContractInfoIdentifier =
  | { contractNo: string; unifiedContractNo?: never }
  | { contractNo?: never; unifiedContractNo: string };

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

export function parseContractInfoLookupResponse(response: unknown): ContractInfoLookup {
  const result = firstApiItemResult(response);
  const item = contractInfoItemSchema.parse(result.item);

  return {
    matched: result.matched,
    contractNo: item.dcsnCntrctNo,
    unifiedContractNo: item.untyCntrctNo,
    contractName: item.cntrctNm,
    contractDetailUrl: item.cntrctDtlInfoUrl,
  };
}

export async function fetchContractInfoByContractIdentifier(
  identifier: ContractInfoIdentifier,
): Promise<ContractInfoLookup> {
  const identifierParams =
    "contractNo" in identifier
      ? { dcsnCntrctNo: identifier.contractNo }
      : { untyCntrctNo: identifier.unifiedContractNo };
  const response = await fetchG2bJson(CONTRACT_INFO_BASE_URL, GET_CONTRACT_INFO_OPERATION, {
    ...identifierParams,
    inqryDiv: 2,
    pageNo: 1,
    numOfRows: 10,
  });

  return parseContractInfoLookupResponse(response);
}

export async function fetchContractInfo(contractNo: string): Promise<ContractInfoLookup> {
  return fetchContractInfoByContractIdentifier({ contractNo });
}
