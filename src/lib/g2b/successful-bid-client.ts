import { z } from "zod";

import { fetchG2bJson } from "@/lib/g2b/http";
import { firstApiItem, optionalApiString } from "@/lib/g2b/parsing";

export const SUCCESSFUL_BID_BASE_URL = "https://apis.data.go.kr/1230000/ScsbidInfoService";
export const GET_SUCCESSFUL_BID_OPERATION = "getScsbidListSttusThng";

export type SuccessfulBidInfo = {
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  successfulBidAmount: string | null;
  successfulBidRate: string | null;
};

const successfulBidItemSchema = z
  .object({
    bidNtceNo: optionalApiString,
    bidNtceOrd: optionalApiString,
    bidNtceNm: optionalApiString,
    sucsfbidAmt: optionalApiString,
    sucsfbidRate: optionalApiString,
  })
  .passthrough();

export function parseSuccessfulBidResponse(response: unknown): SuccessfulBidInfo {
  const item = successfulBidItemSchema.parse(firstApiItem(response));

  return {
    noticeNo: item.bidNtceNo,
    noticeOrder: item.bidNtceOrd,
    noticeName: item.bidNtceNm,
    successfulBidAmount: item.sucsfbidAmt,
    successfulBidRate: item.sucsfbidRate,
  };
}

export async function fetchSuccessfulBid(
  noticeNo: string,
  noticeOrder?: string | null,
): Promise<SuccessfulBidInfo> {
  const response = await fetchG2bJson(SUCCESSFUL_BID_BASE_URL, GET_SUCCESSFUL_BID_OPERATION, {
    bidNtceNo: noticeNo,
    bidNtceOrd: noticeOrder,
    pageNo: 1,
    numOfRows: 10,
  });

  return parseSuccessfulBidResponse(response);
}
