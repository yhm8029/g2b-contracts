import { createHash } from "node:crypto";
import { collectCompletePages, type CompletePage } from "./paging";
export type { CompletePage } from "./paging";
import { matchesTargetProduct, normalizeProductCode } from "../normalization";
import { fetchG2bJson } from "../../g2b/http";

export type G2bFetchJson = (
  operation: string,
  params: Record<string, string | number>,
) => Promise<unknown>;

export interface NoticeInventoryRow {
  noticeNo: string;
  noticeOrder: string;
  noticeName: string;
  publishedAt: string;
  status: string;
  demandAgencyName: string | null;
  sourceUrl: string | null;
  rawJson: string;
}

export interface NoticeProductRow {
  noticeNo: string;
  noticeOrder: string;
  bidClassNo: string;
  parentCode: string | null;
  detailCode: string | null;
  targetCode: "39121801" | "3912180101" | null;
  productSerial: string | null;
  providerRowIdentity: string;
  sourceIdentity: string;
  sourceHash: string;
  rawJson: string;
}

export interface NoticeInventoryBatch {
  dateFrom: string;
  dateTo: string;
  totalCount: number;
  notices: NoticeInventoryRow[];
  products: NoticeProductRow[];
}

export interface CollectNoticeInventoryInput {
  dateFrom: string;
  dateTo: string;
  pageSize: number;
  maxPages: number;
  fetchJson?: G2bFetchJson;
}

export interface NoticeIdentityInventory {
  noticeNo: string;
  noticeOrder: string;
  totalCount: number;
  notices: NoticeInventoryRow[];
  products: NoticeProductRow[];
}

export interface CollectNoticeInventoryByIdentityInput {
  noticeNo: string;
  noticeOrder: string;
  pageSize: number;
  maxPages: number;
  fetchJson?: G2bFetchJson;
}

const SUCCESS_RESULT_CODES = new Set(["00", "0"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readResultCode(header: unknown): string | null {
  if (!isObject(header)) return null;
  const code = header.resultCode;
  if (typeof code === "string") return code;
  if (typeof code === "number") return String(code);
  return null;
}

function readItemsArray(body: unknown): unknown[] | null {
  if (!isObject(body)) return null;
  const items = body.items;
  if (items === null || items === undefined) return [];
  if (Array.isArray(items)) return items;
  if (!isObject(items)) return null;
  const item = items.item;
  if (item === null || item === undefined) return [];
  if (Array.isArray(item)) return item;
  return [item];
}

function requireTotalCount(body: unknown): number {
  if (!isObject(body)) {
    throw new Error("parseG2bResponse: body.totalCount missing (no body)");
  }
  const value = body.totalCount;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("parseG2bResponse: body.totalCount missing or invalid");
    }
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new Error("parseG2bResponse: body.totalCount invalid");
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    throw new Error("parseG2bResponse: body.totalCount invalid");
  }
  throw new Error("parseG2bResponse: body.totalCount missing or invalid");
}

function requirePageNumber(body: unknown): number {
  if (!isObject(body)) {
    throw new Error("parseG2bResponse: body.pageNo missing (no body)");
  }
  const value = body.pageNo;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("parseG2bResponse: body.pageNo missing or invalid");
    }
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new Error("parseG2bResponse: body.pageNo invalid");
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    throw new Error("parseG2bResponse: body.pageNo invalid");
  }
  throw new Error("parseG2bResponse: body.pageNo missing or invalid");
}

function requireNumOfRows(body: unknown): number {
  if (!isObject(body)) {
    throw new Error("parseG2bResponse: body.numOfRows missing (no body)");
  }
  const value = body.numOfRows;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("parseG2bResponse: body.numOfRows missing or invalid");
    }
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new Error("parseG2bResponse: body.numOfRows invalid");
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    throw new Error("parseG2bResponse: body.numOfRows invalid");
  }
  throw new Error("parseG2bResponse: body.numOfRows missing or invalid");
}

function readResponseEnvelope(payload: unknown): {
  header: unknown;
  body: unknown;
} {
  if (!isObject(payload)) {
    throw new Error("parseG2bResponse: payload must be an object");
  }
  const response = payload.response;
  if (!isObject(response)) {
    throw new Error("parseG2bResponse: payload.response must be an object");
  }
  return { header: response.header, body: response.body };
}

function ensureSuccess(payload: unknown): void {
  const { header, body } = readResponseEnvelope(payload);
  const code = readResultCode(header);
  if (code === null || !SUCCESS_RESULT_CODES.has(code)) {
    throw new Error(
      `parseG2bResponse: provider returned non-success resultCode ${code ?? "<missing>"}`,
    );
  }
  if (!isObject(body)) {
    throw new Error(
      "parseG2bResponse: payload.response.body must be an object",
    );
  }
  const items = readItemsArray(body);
  if (items === null) {
    throw new Error("parseG2bResponse: body.items must be an object or array");
  }
}

function readTrimmedString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function nonBlankString(value: unknown): string | null {
  const trimmed = readTrimmedString(value);
  return trimmed.length === 0 ? null : trimmed;
}

function requireNonBlankString(field: string, value: unknown): string {
  const trimmed = nonBlankString(value);
  if (trimmed === null) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return trimmed;
}

function sha256Lower(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function defaultPageRawJson(
  rawJson: string | undefined,
  payload: unknown,
): string {
  if (typeof rawJson === "string" && rawJson.length > 0) return rawJson;
  return JSON.stringify(payload);
}

export function parseNoticePage(
  payload: unknown,
  rawJson?: string,
): CompletePage<NoticeInventoryRow> {
  ensureSuccess(payload);
  const { body } = readResponseEnvelope(payload);
  const totalCount = requireTotalCount(body);
  const pageNo = requirePageNumber(body);
  const pageSize = requireNumOfRows(body);
  const items = readItemsArray(body) ?? [];

  const rows: NoticeInventoryRow[] = [];
  for (const item of items) {
    if (!isObject(item)) {
      throw new Error("parseNoticePage: each item must be an object");
    }
    const noticeNo = requireNonBlankString("bidNtceNo", item.bidNtceNo);
    const noticeOrder = requireNonBlankString("bidNtceOrd", item.bidNtceOrd);
    const noticeName = requireNonBlankString("bidNtceNm", item.bidNtceNm);
    const publishedAt = readTrimmedString(item.bidNtceDt);
    const status = readTrimmedString(item.bidNtceSttusNm);
    const demandAgencyName = nonBlankString(item.dmndInsttNm);
    const sourceUrl = nonBlankString(item.bidNtceDtlUrl);
    const rowRawJson = JSON.stringify(item);
    rows.push({
      noticeNo,
      noticeOrder,
      noticeName,
      publishedAt,
      status,
      demandAgencyName,
      sourceUrl,
      rawJson: rowRawJson,
    });
  }

  return {
    pageNo,
    pageSize,
    totalCount,
    items: rows,
    rawJson: defaultPageRawJson(rawJson, payload),
  };
}

export function parseNoticeProductPage(
  payload: unknown,
  rawJson?: string,
): CompletePage<NoticeProductRow> {
  ensureSuccess(payload);
  const { body } = readResponseEnvelope(payload);
  const totalCount = requireTotalCount(body);
  const pageNo = requirePageNumber(body);
  const pageSize = requireNumOfRows(body);
  const items = readItemsArray(body) ?? [];

  const rows: NoticeProductRow[] = [];
  const seenIdentities = new Set<string>();
  for (const item of items) {
    if (!isObject(item)) {
      throw new Error("parseNoticeProductPage: each item must be an object");
    }
    const noticeNo = requireNonBlankString("bidNtceNo", item.bidNtceNo);
    const noticeOrder = requireNonBlankString("bidNtceOrd", item.bidNtceOrd);
    const bidClassNo = requireNonBlankString("bidClsfcNo", item.bidClsfcNo);

    const rawParent = item.prdctClsfcNo;
    const rawDetail = item.dtilPrdctClsfcNo;

    const parentCode = normalizeProductCode(rawParent);
    const detailCode = normalizeProductCode(rawDetail);

    const isExactTarget = matchesTargetProduct({
      parentCode: rawParent,
      detailCode: rawDetail,
    });

    let targetCode: "39121801" | "3912180101" | null = null;
    if (isExactTarget) {
      if (detailCode !== null) {
        targetCode = "3912180101";
      } else if (
        rawDetail === undefined ||
        rawDetail === null ||
        (typeof rawDetail === "string" && rawDetail.trim().length === 0)
      ) {
        if (parentCode !== null) {
          targetCode = "39121801";
        }
      }
    }

    const productSerial = nonBlankString(item.prdctSno);

    const rowRawJson = JSON.stringify(item);
    const sourceHash = sha256Lower(rowRawJson);
    const providerRowIdentity = `${noticeNo}|${noticeOrder}|${bidClassNo}|${productSerial ?? ""}`;

    if (seenIdentities.has(providerRowIdentity)) {
      throw new Error(
        "parseNoticeProductPage: duplicate providerRowIdentity within page",
      );
    }
    seenIdentities.add(providerRowIdentity);

    rows.push({
      noticeNo,
      noticeOrder,
      bidClassNo,
      parentCode,
      detailCode,
      targetCode,
      productSerial,
      providerRowIdentity,
      sourceIdentity: providerRowIdentity,
      sourceHash,
      rawJson: rowRawJson,
    });
  }

  return {
    pageNo,
    pageSize,
    totalCount,
    items: rows,
    rawJson: defaultPageRawJson(rawJson, payload),
  };
}

const NOTICE_OPERATION = "getBidPblancListInfoThng";
const NOTICE_PRODUCT_OPERATION = "getBidPblancListInfoThngPurchsObjPrdct";
const GOODS_BASE_URL =
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";

function buildDefaultFetchJson(): G2bFetchJson {
  return async (operation, params) =>
    fetchG2bJson(GOODS_BASE_URL, operation, params);
}

export async function collectNoticeInventory(
  input: CollectNoticeInventoryInput,
): Promise<NoticeInventoryBatch> {
  const fetchJson: G2bFetchJson = input.fetchJson ?? buildDefaultFetchJson();
  const baseParams = {
    inqryDiv: "1",
    inqryBgnDt: input.dateFrom,
    inqryEndDt: input.dateTo,
  };

  const noticeResult = await withCollectionLabel("notice", () => collectCompletePages<NoticeInventoryRow>({
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    identity: (item) => `${item.noticeNo}|${item.noticeOrder}`,
    fetchPage: async (pageNo, pageSize) => {
      const payload = await fetchJson(NOTICE_OPERATION, {
        ...baseParams,
        pageNo,
        numOfRows: pageSize,
      });
      return parseNoticePage(payload);
    },
  }));

  const productResult = await withCollectionLabel("notice-product", () => collectCompletePages<NoticeProductRow>({
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    identity: (item) => item.providerRowIdentity,
    fetchPage: async (pageNo, pageSize) => {
      const payload = await fetchJson(NOTICE_PRODUCT_OPERATION, {
        ...baseParams,
        pageNo,
        numOfRows: pageSize,
      });
      return parseNoticeProductPage(payload);
    },
  }));

  const noticeKeySet = new Set<string>(
    noticeResult.items.map((item) => `${item.noticeNo}|${item.noticeOrder}`),
  );
  for (const product of productResult.items) {
    if (product.targetCode !== null) {
      const identity = `${product.noticeNo}|${product.noticeOrder}`;
      if (!noticeKeySet.has(identity)) {
        throw new Error(
          `orphan target-product identity: ${identity} has no matching notice`,
        );
      }
    }
  }

  const matchingNoticeKeys = new Set<string>();
  for (const product of productResult.items) {
    if (product.targetCode !== null) {
      matchingNoticeKeys.add(`${product.noticeNo}|${product.noticeOrder}`);
    }
  }

  const filteredNotices = noticeResult.items.filter((notice) =>
    matchingNoticeKeys.has(`${notice.noticeNo}|${notice.noticeOrder}`),
  );

  const filteredProducts = productResult.items.filter(
    (product) => product.targetCode !== null,
  );

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    totalCount: noticeResult.totalCount,
    notices: filteredNotices,
    products: filteredProducts,
  };
}

async function withCollectionLabel<T>(label: string, operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export async function collectNoticeInventoryByIdentity(
  input: CollectNoticeInventoryByIdentityInput,
): Promise<NoticeIdentityInventory> {
  const fetchJson: G2bFetchJson = input.fetchJson ?? buildDefaultFetchJson();
  const baseParams = {
    inqryDiv: "2",
    bidNtceNo: input.noticeNo,
    bidNtceOrd: input.noticeOrder,
  };

  const noticeResult = await collectCompletePages<NoticeInventoryRow>({
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    identity: (item) => `${item.noticeNo}|${item.noticeOrder}`,
    fetchPage: async (pageNo, pageSize) => {
      const payload = await fetchJson(NOTICE_OPERATION, {
        ...baseParams,
        pageNo,
        numOfRows: pageSize,
      });
      return parseNoticePage(payload);
    },
  });

  const targetIdentity = `${input.noticeNo}|${input.noticeOrder}`;
  if (
    noticeResult.items.length !== 1 ||
    `${noticeResult.items[0]!.noticeNo}|${noticeResult.items[0]!.noticeOrder}` !==
      targetIdentity
  ) {
    throw new Error(`notice identity mismatch: expected ${targetIdentity}`);
  }

  const productResult = await collectCompletePages<NoticeProductRow>({
    pageSize: input.pageSize,
    maxPages: input.maxPages,
    identity: (item) => item.providerRowIdentity,
    fetchPage: async (pageNo, pageSize) => {
      const payload = await fetchJson(NOTICE_PRODUCT_OPERATION, {
        ...baseParams,
        pageNo,
        numOfRows: pageSize,
      });
      return parseNoticeProductPage(payload);
    },
  });

  for (const product of productResult.items) {
    const productIdentity = `${product.noticeNo}|${product.noticeOrder}`;
    if (productIdentity !== targetIdentity) {
      throw new Error(
        `product identity mismatch: expected ${targetIdentity}, got ${productIdentity}`,
      );
    }
  }

  const filteredProducts = productResult.items.filter(
    (product) =>
      product.targetCode !== null &&
      `${product.noticeNo}|${product.noticeOrder}` === targetIdentity,
  );

  const filteredNotices =
    filteredProducts.length > 0
      ? noticeResult.items.filter(
          (notice) =>
            `${notice.noticeNo}|${notice.noticeOrder}` === targetIdentity,
        )
      : [];

  return {
    noticeNo: input.noticeNo,
    noticeOrder: input.noticeOrder,
    totalCount: noticeResult.totalCount,
    notices: filteredNotices,
    products: filteredProducts,
  };
}
