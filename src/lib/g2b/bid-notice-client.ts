import { z } from "zod";

import { fetchG2bJson } from "@/lib/g2b/http";
import { firstApiItem, firstApiItemResult, optionalApiString } from "@/lib/g2b/parsing";

export const BID_NOTICE_BASE_URL = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
export const GET_BID_NOTICE_OPERATION = "getBidPblancListInfoThng";

export type BidNoticeInfo = {
  noticeNo: string | null;
  noticeOrder: string | null;
  noticeName: string | null;
  noticeDetailUrl: string | null;
};

export type BidNoticeLookup = BidNoticeInfo & {
  matched: boolean;
};

const bidNoticeItemSchema = z
  .object({
    bidNtceNo: optionalApiString,
    bidNtceOrd: optionalApiString,
    bidNtceNm: optionalApiString,
    bidNtceDtlUrl: optionalApiString,
  })
  .passthrough();

export function parseBidNoticeResponse(response: unknown): BidNoticeInfo {
  const item = bidNoticeItemSchema.parse(firstApiItem(response));

  return {
    noticeNo: item.bidNtceNo,
    noticeOrder: item.bidNtceOrd,
    noticeName: item.bidNtceNm,
    noticeDetailUrl: item.bidNtceDtlUrl,
  };
}

export function parseBidNoticeLookupResponse(response: unknown): BidNoticeLookup {
  const result = firstApiItemResult(response);
  const item = bidNoticeItemSchema.parse(result.item);

  return {
    matched: result.matched,
    noticeNo: item.bidNtceNo,
    noticeOrder: item.bidNtceOrd,
    noticeName: item.bidNtceNm,
    noticeDetailUrl: item.bidNtceDtlUrl,
  };
}

export async function fetchBidNotice(
  noticeNo: string,
  noticeOrder?: string | null,
): Promise<BidNoticeLookup> {
  const response = await fetchG2bJson(BID_NOTICE_BASE_URL, GET_BID_NOTICE_OPERATION, {
    bidNtceNo: noticeNo,
    bidNtceOrd: noticeOrder,
    pageNo: 1,
    numOfRows: 10,
  });

  return parseBidNoticeLookupResponse(response);
}
