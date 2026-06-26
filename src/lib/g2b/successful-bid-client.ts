import { z } from "zod";

import { fetchG2bJson } from "@/lib/g2b/http";
import { firstApiItem, firstApiItemResult, optionalApiString } from "@/lib/g2b/parsing";

export const SUCCESSFUL_BID_BASE_URL = "https://apis.data.go.kr/1230000/as/ScsbidInfoService";
export const GET_SUCCESSFUL_BID_OPERATION = "getScsbidListSttusThng";

export type SuccessfulBidInfo = {
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  successfulBidAmount: string | null;
  successfulBidRate: string | null;
};

export type SuccessfulBidLookup = SuccessfulBidInfo & {
  matched: boolean;
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

export function parseSuccessfulBidLookupResponse(response: unknown): SuccessfulBidLookup {
  const result = firstApiItemResult(response);
  const item = successfulBidItemSchema.parse(result.item);

  return {
    matched: result.matched,
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
): Promise<SuccessfulBidLookup> {
  const response = await fetchG2bJson(SUCCESSFUL_BID_BASE_URL, GET_SUCCESSFUL_BID_OPERATION, {
    bidNtceNo: noticeNo,
    bidNtceOrd: noticeOrder,
    inqryDiv: 3,
    pageNo: 1,
    numOfRows: 10,
  });

  return parseSuccessfulBidLookupResponse(response);
}
