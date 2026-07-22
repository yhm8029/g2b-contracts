export type G2bPublicStandardContractFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type G2bPublicStandardContractSleep = (milliseconds: number) => Promise<void>;

export type G2bPublicStandardContractUpstreamErrorKind = "temporary" | "response";

export class G2bPublicStandardContractUpstreamError extends Error {
  constructor(
    message: string,
    readonly kind: G2bPublicStandardContractUpstreamErrorKind,
    readonly upstreamCode?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "G2bPublicStandardContractUpstreamError";
  }
}

export type G2bPublicStandardContractPage = {
  dateFrom: string;
  dateTo: string;
  pageNo: number;
  totalCount: number;
  returnedRowCount: number;
  items: Record<string, unknown>[];
};

export const G2B_PUBLIC_STANDARD_CONTRACT_ENDPOINT =
  "https://apis.data.go.kr/1230000/ao/PubDataOpnStdService/getDataSetOpnStdCntrctInfo";

export const G2B_PUBLIC_STANDARD_CONTRACT_NUM_OF_ROWS = 999;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 100;
const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_UPSTREAM_CODES = new Set(["02", "05"]);
let validationNonceSequence = 0;

export async function fetchG2bPublicStandardContractPage(input: {
  dateFrom: string;
  dateTo: string;
  pageNo: number;
  serviceKey: string;
  fetchImpl?: G2bPublicStandardContractFetch;
  sleep?: G2bPublicStandardContractSleep;
  signal?: AbortSignal;
}): Promise<G2bPublicStandardContractPage> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(input.signal);
    try {
      const parsed = await fetchG2bPublicStandardContractPageOnce({ ...input, fetchImpl });
      return {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        pageNo: input.pageNo,
        totalCount: parsed.totalCount,
        returnedRowCount: parsed.items.length,
        items: parsed.items,
      };
    } catch (error) {
      if (input.signal?.aborted) {
        throw abortReason(input.signal);
      }
      const upstreamError = normalizeUpstreamError(error);
      if (upstreamError.kind !== "temporary" || attempt === MAX_ATTEMPTS) {
        throw upstreamError;
      }
      await sleepWithSignal(sleep, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), input.signal);
    }
  }

  throw new G2bPublicStandardContractUpstreamError("G2B contract retry loop exhausted", "temporary");
}

export function buildG2bPublicStandardContractUrl(input: {
  dateFrom: string;
  dateTo: string;
  pageNo: number;
  serviceKey: string;
  validationNonce?: string;
}) {
  const params = new URLSearchParams({
    cntrctCnclsBgnDate: input.dateFrom,
    cntrctCnclsEndDate: input.dateTo,
    numOfRows: String(G2B_PUBLIC_STANDARD_CONTRACT_NUM_OF_ROWS),
    pageNo: String(input.pageNo),
    type: "json",
  });
  const serviceKey = input.serviceKey.includes("%") ? input.serviceKey : encodeURIComponent(input.serviceKey);
  const validationNonce = input.validationNonce
    ? `&validationNonce=${encodeURIComponent(input.validationNonce)}`
    : "";
  return `${G2B_PUBLIC_STANDARD_CONTRACT_ENDPOINT}?${params.toString()}&serviceKey=${serviceKey}${validationNonce}`;
}

async function fetchG2bPublicStandardContractPageOnce(input: {
  dateFrom: string;
  dateTo: string;
  pageNo: number;
  fetchImpl: G2bPublicStandardContractFetch;
  serviceKey: string;
  signal?: AbortSignal;
}) {
  const response = await input.fetchImpl(
    buildG2bPublicStandardContractUrl({ ...input, validationNonce: nextValidationNonce() }),
    { signal: input.signal },
  );
  if (!response.ok) {
    throw new G2bPublicStandardContractUpstreamError(
      `G2B contract search returned HTTP ${response.status}`,
      TRANSIENT_HTTP_STATUSES.has(response.status) ? "temporary" : "response",
      undefined,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new G2bPublicStandardContractUpstreamError("G2B contract search returned invalid JSON", "response");
  }
  return parseG2bPublicStandardContractPayload(payload);
}

function nextValidationNonce() {
  validationNonceSequence += 1;
  return `${Date.now()}-${validationNonceSequence}`;
}

function parseG2bPublicStandardContractPayload(payload: unknown) {
  const root = getRecord(payload);
  const apiError = extractG2bPublicStandardContractApiError(root);
  if (apiError) {
    throw new G2bPublicStandardContractUpstreamError(
      apiError.message,
      TRANSIENT_UPSTREAM_CODES.has(apiError.code) ? "temporary" : "response",
      apiError.code,
    );
  }

  const response = getRecord(root.response);
  if (Object.keys(response).length === 0) {
    throw new G2bPublicStandardContractUpstreamError(
      "G2B contract search returned an unknown response envelope",
      "response",
    );
  }
  const header = getRecord(response.header);
  const resultCode = asText(header.resultCode);
  if (resultCode !== "00") {
    throw new G2bPublicStandardContractUpstreamError(
      asText(header.resultMsg) || "G2B contract search returned an invalid result code",
      TRANSIENT_UPSTREAM_CODES.has(resultCode) ? "temporary" : "response",
      resultCode || undefined,
    );
  }
  const body = getRecord(response.body);
  if (Object.keys(body).length === 0) {
    throw new G2bPublicStandardContractUpstreamError("G2B contract search response body is missing", "response");
  }
  const totalCount = Number(asText(body.totalCount));
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new G2bPublicStandardContractUpstreamError(
      "G2B contract search returned an invalid totalCount",
      "response",
    );
  }
  const itemsValue = getRecord(body.items).item ?? body.items ?? [];
  const items = (Array.isArray(itemsValue) ? itemsValue : [itemsValue])
    .map((item) => getRecord(item))
    .filter((item) => Object.keys(item).length > 0);
  return { totalCount, items };
}

function extractG2bPublicStandardContractApiError(root: Record<string, unknown>) {
  const candidates = [
    root,
    getRecord(root.header),
    getRecord(getRecord(root.response).header),
    getRecord(getRecord(root["nkoneps.com.response.ResponseError"]).header),
  ];
  for (const candidate of candidates) {
    const error = resultErrorFromRecord(candidate);
    if (error) {
      return error;
    }
  }

  const commonHeader = getRecord(getRecord(root.OpenAPI_ServiceResponse).cmmMsgHeader);
  if (Object.keys(commonHeader).length === 0) {
    return null;
  }
  const code = asText(commonHeader.returnReasonCode);
  return {
    code: code || "unknown",
    message:
      asText(commonHeader.returnAuthMsg) || asText(commonHeader.errMsg) || "Public data portal returned an error",
  };
}

function resultErrorFromRecord(record: Record<string, unknown>) {
  const code = asText(record.resultCode);
  if (!code || code === "00") {
    return null;
  }
  return {
    code,
    message: asText(record.resultMsg) || `G2B contract search returned ${code}`,
  };
}

function normalizeUpstreamError(error: unknown) {
  return error instanceof G2bPublicStandardContractUpstreamError
    ? error
    : new G2bPublicStandardContractUpstreamError(
        error instanceof Error ? error.message : "G2B contract search request failed",
        "temporary",
      );
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function sleepWithSignal(
  sleep: G2bPublicStandardContractSleep,
  milliseconds: number,
  signal?: AbortSignal,
) {
  if (!signal) return sleep(milliseconds);
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    sleep(milliseconds).then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function asText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
