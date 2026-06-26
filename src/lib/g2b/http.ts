type G2bParamValue = string | number | boolean | null | undefined;

export type G2bParams = Record<string, G2bParamValue>;

export function getServiceKey(): string | null {
  const key = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  return key === undefined || key.length === 0 ? null : key;
}

export function buildG2bUrl(baseUrl: string, operation: string, params: G2bParams = {}): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedOperation = operation.replace(/^\/+/, "");
  const url = new URL(normalizedOperation, normalizedBaseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }

    const serializedValue = String(value).trim();

    if (serializedValue.length === 0) {
      continue;
    }

    url.searchParams.set(key, serializedValue);
  }

  url.searchParams.set("type", "json");
  return url;
}

export async function fetchG2bJson(
  baseUrl: string,
  operation: string,
  params: G2bParams = {},
): Promise<unknown> {
  const serviceKey = getServiceKey();

  if (serviceKey === null) {
    throw new Error("DATA_GO_KR_SERVICE_KEY is required for G2B API requests.");
  }

  const url = buildG2bUrl(baseUrl, operation, {
    ...params,
    serviceKey,
  });
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`G2B API request failed with status ${response.status}.`);
  }

  return response.json();
}
