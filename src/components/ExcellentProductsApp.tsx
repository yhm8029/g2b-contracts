"use client";

import { useMemo, useRef, useState } from "react";

import type {
  BuildingControlExcellentProductsResponse,
  ExcellentProductViewItem,
} from "@/lib/excellent-products/types";

export const EXCELLENT_PRODUCTS_ENDPOINT = "/api/excellent-products/building-control";
export const EXCELLENT_PRODUCTS_SYNC_ENDPOINT = "/api/excellent-products/building-control/sync";
export const EXCELLENT_PRODUCTS_EXPORT_ENDPOINT = "/api/excellent-products/building-control/export";
export const BUILDING_CONTROL_CLASSIFICATION = "39121801";

export type ExcellentProductSortKey =
  | "companyName"
  | "designationNo"
  | "issueDate"
  | "recognitionPeriod";
export type ExcellentProductSortDirection = "asc" | "desc";

const TABLE_HEADERS = [
  "No.",
  "지정번호",
  "품명",
  "발급일자",
  "인정(연장)기간",
  "상호명",
  "사업자등록번호",
  "대표자명",
  "전화번호",
  "주소",
  "물품분류번호",
  "물품분류명",
  "규격모델",
  "인증내역",
  "생산지 (공장소재지)",
  "면허 현황",
] as const;

export function filterBuildingControlProducts(
  items: ExcellentProductViewItem[],
  companyNameQuery: string,
): ExcellentProductViewItem[] {
  const query = companyNameQuery.trim().toLocaleLowerCase("ko-KR");
  if (!query) return [...items];
  return items.filter((item) => item.companyName.toLocaleLowerCase("ko-KR").includes(query));
}

export function sortBuildingControlProducts(
  items: ExcellentProductViewItem[],
  sortKey: ExcellentProductSortKey,
  direction: ExcellentProductSortDirection = "asc",
): ExcellentProductViewItem[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    const leftValue = sortValue(left, sortKey);
    const rightValue = sortValue(right, sortKey);
    const comparison = leftValue.localeCompare(rightValue, "ko-KR", { numeric: true });
    if (comparison !== 0) return comparison * multiplier;

    // A designation number tie-break keeps every sort deterministic.
    return left.designationNo.localeCompare(right.designationNo, "ko-KR", { numeric: true });
  });
}

function sortValue(item: ExcellentProductViewItem, key: ExcellentProductSortKey): string {
  switch (key) {
    case "companyName":
      return item.companyName;
    case "designationNo":
      return item.designationNo;
    case "issueDate":
      return item.designationStartDate ?? "";
    case "recognitionPeriod":
      return `${item.designationStartDate ?? ""} ${item.designationEndDate ?? ""}`;
  }
}

type LoadStatus = "idle" | "loading" | "loaded" | "error";

export function ExcellentProductsApp() {
  const [response, setResponse] = useState<BuildingControlExcellentProductsResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [companyNameQuery, setCompanyNameQuery] = useState("");
  const [sortKey, setSortKey] = useState<ExcellentProductSortKey>("companyName");
  const [sortDirection, setSortDirection] = useState<ExcellentProductSortDirection>("asc");
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInFlight = useRef(false);

  const visibleItems = useMemo(() => {
    const filtered = filterBuildingControlProducts(response?.items ?? [], companyNameQuery);
    return sortBuildingControlProducts(filtered, sortKey, sortDirection);
  }, [companyNameQuery, response?.items, sortDirection, sortKey]);

  async function loadProducts() {
    setStatus("loading");
    setError(null);
    try {
      const result = await fetch(EXCELLENT_PRODUCTS_ENDPOINT, {
        headers: { accept: "application/json" },
      });
      if (!result.ok) throw new Error(await readError(result, "우수업체 조회에 실패했습니다."));
      const payload = (await result.json()) as BuildingControlExcellentProductsResponse;
      setResponse(payload);
      setStatus("loaded");
    } catch (caught: unknown) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "우수업체 조회에 실패했습니다.");
    }
  }

  async function handleLookup() {
    await loadProducts();
  }

  async function handleSync() {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setIsSyncing(true);
    setError(null);
    try {
      const result = await fetch(EXCELLENT_PRODUCTS_SYNC_ENDPOINT, { method: "POST" });
      if (!result.ok) throw new Error(await readError(result, "최신 정보 갱신에 실패했습니다."));
      await loadProducts();
    } catch (caught: unknown) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "최신 정보 갱신에 실패했습니다.");
    } finally {
      syncInFlight.current = false;
      setIsSyncing(false);
    }
  }

  function changeSort(nextKey: ExcellentProductSortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  const resultsLoaded = status === "loaded";

  return (
    <main className="excellent-products-page">
      <header className="excellent-products-heading">
        <p className="eyebrow">조달 우수제품 조회</p>
        <h1>빌딩자동제어장치 조달우수업체 현황</h1>
        <p>물품분류번호 <strong>{BUILDING_CONTROL_CLASSIFICATION}</strong> 기준의 저장된 현황을 조회합니다.</p>
      </header>

      <section className="excellent-products-panel" aria-label="빌딩자동제어장치 조달우수업체 현황">
        <div className="excellent-products-controls">
          <div className="excellent-products-fixed-filter">
            <span>물품분류번호</span>
            <strong>{BUILDING_CONTROL_CLASSIFICATION}</strong>
          </div>
          <label className="excellent-products-company-filter">
            <span>회사명으로 결과 필터</span>
            <input
              aria-label="회사명으로 결과 필터"
              onChange={(event) => setCompanyNameQuery(event.target.value)}
              placeholder="회사명 입력"
              type="search"
              value={companyNameQuery}
            />
          </label>
          <div className="excellent-products-actions">
            <button className="primary-button" onClick={handleLookup} type="button">
              조달우수업체 전체 조회
            </button>
            <button className="secondary-button" disabled={isSyncing} onClick={handleSync} type="button">
              {isSyncing ? "최신 정보 갱신 중…" : "최신 정보 갱신"}
            </button>
            {resultsLoaded ? (
              <a className="secondary-button" href={EXCELLENT_PRODUCTS_EXPORT_ENDPOINT}>
                CSV 다운로드
              </a>
            ) : (
              <button className="secondary-button disabled-link" disabled type="button">CSV 다운로드</button>
            )}
          </div>
        </div>

        {status === "loading" ? <p className="excellent-products-status" role="status">조회 중입니다…</p> : null}
        {error ? <p className="excellent-products-error" role="alert">{error}</p> : null}
        {resultsLoaded ? (
          <div className="excellent-products-summary" aria-live="polite">
            <span>업체 수 <strong>{response?.companyCount ?? 0}</strong></span>
            <span>지정 건수 <strong>{response?.designationCount ?? 0}</strong></span>
            <span>표시 결과 <strong>{visibleItems.length}</strong></span>
          </div>
        ) : null}

        {resultsLoaded && visibleItems.length === 0 ? (
          <p className="excellent-products-empty">조회된 우수업체가 없습니다.</p>
        ) : resultsLoaded ? (
          <div className="excellent-products-table-frame">
            <table className="excellent-products-table">
              <thead>
                <tr>
                  <th scope="col">{TABLE_HEADERS[0]}</th>
                  <SortableHeader label={TABLE_HEADERS[1]} active={sortKey === "designationNo"} onClick={() => changeSort("designationNo")} />
                  <th scope="col">{TABLE_HEADERS[2]}</th>
                  <SortableHeader label={TABLE_HEADERS[3]} active={sortKey === "issueDate"} onClick={() => changeSort("issueDate")} />
                  <SortableHeader label={TABLE_HEADERS[4]} active={sortKey === "recognitionPeriod"} onClick={() => changeSort("recognitionPeriod")} />
                  <SortableHeader label={TABLE_HEADERS[5]} active={sortKey === "companyName"} onClick={() => changeSort("companyName")} />
                  <th scope="col">{TABLE_HEADERS[6]}</th>
                  <th scope="col">{TABLE_HEADERS[7]}</th>
                  <th scope="col">{TABLE_HEADERS[8]}</th>
                  <th scope="col">{TABLE_HEADERS[9]}</th>
                  <th scope="col">{TABLE_HEADERS[10]}</th>
                  <th scope="col">{TABLE_HEADERS[11]}</th>
                  <th scope="col">{TABLE_HEADERS[12]}</th>
                  <th scope="col">{TABLE_HEADERS[13]}</th>
                  <th scope="col">{TABLE_HEADERS[14]}</th>
                  <th scope="col">{TABLE_HEADERS[15]}</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item, index) => <ExcellentProductRow index={index} item={item} key={`${item.designationNo}-${item.bizNoNormalized}`} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="excellent-products-empty">조회 버튼을 눌러 저장된 우수업체 현황을 불러오세요.</p>
        )}
      </section>
    </main>
  );
}

function SortableHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th scope="col">
      <button aria-label={`${label} 정렬`} aria-pressed={active} className="excellent-products-sort" onClick={onClick} type="button">
        {label} {active ? "↕" : "↕"}
      </button>
    </th>
  );
}

function ExcellentProductRow({ item, index }: { item: ExcellentProductViewItem; index: number }) {
  const recognitionPeriod = [item.designationStartDate, item.designationEndDate].filter(Boolean).join(" ~ ") || "정보 없음";
  return (
    <tr>
      <td>{index + 1}</td>
      <td>{item.designationNo || "정보 없음"}</td>
      <td>{item.productName || "정보 없음"}</td>
      <td>{item.designationStartDate || "정보 없음"}</td>
      <td>{recognitionPeriod}</td>
      <td><a href={`/?bizNo=${encodeURIComponent(item.bizNoNormalized)}`}>{item.companyName || "상호명 정보 없음"}</a></td>
      <td>{item.bizNoNormalized || "정보 없음"}</td>
      <td>{item.representativeName || "대표자명 정보 없음"}</td>
      <td>{item.phone || "전화번호 정보 없음"}</td>
      <td>{item.address || "주소 정보 없음"}</td>
      <td>{item.productClassificationNo || "정보 없음"}</td>
      <td>{item.productClassificationName || "물품분류명 정보 없음"}</td>
      <td>{item.productSpec || "규격모델 정보 없음"}</td>
      <td><span className="excellent-products-certification">{item.certificationDetailsRaw || "인증내역 정보 없음"}</span></td>
      <td><MultilineValues emptyLabel="공장소재지 정보 없음" values={item.factoryLocations} /></td>
      <td><MultilineValues emptyLabel="면허정보 없음" values={item.industries} /></td>
    </tr>
  );
}

function MultilineValues({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (values.length === 0) return <span>{emptyLabel}</span>;
  return <span className="excellent-products-multiline">{values.map((value) => <span key={value}>{value}</span>)}</span>;
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof payload.message === "string" && payload.message) return payload.message;
    if (typeof payload.error === "string" && payload.error) return payload.error;
  } catch {
    // Use a stable message when the server does not return JSON.
  }
  return fallback;
}
