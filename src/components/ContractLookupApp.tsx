"use client";

import {
  AlertCircle,
  CalendarDays,
  Database,
  Download,
  ExternalLink,
  FileText,
  LinkIcon,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { ContractSearchRow, DatabaseHealth } from "@/lib/contracts/types";

const categoryOptions = [
  { value: "all", label: "전체" },
  { value: "goods", label: "물품" },
  { value: "construction", label: "공사" },
  { value: "services", label: "용역" },
  { value: "foreign", label: "외자" },
  { value: "shopping_third_party", label: "3자단가 판매" },
  { value: "unknown", label: "미분류" },
];

const categoryLabels = new Map(categoryOptions.map((option) => [option.value, option.label]));

const sourceStatusLabels: Record<string, string> = {
  local_only: "로컬 저장",
  api_enriched: "API 보강 완료",
};

const enrichmentStatusLabels: Record<string, string> = {
  success: "성공",
  error: "오류",
  skipped: "건너뜀",
};

const statusDisplayLabels = {
  syncing: "동기화 중",
  searching: "검색 중",
  error: "오류",
  connected: "연결됨",
  ready: "준비됨",
} as const;

type ContractSummary = {
  contractCount: number;
  totalAmount: number;
  noticeLinkedCount: number;
  latestContractDate: string | null;
};

type SearchResponse = {
  rows: ContractSearchRow[];
  summary: ContractSummary;
  health: DatabaseHealth;
};

type SyncResponse = {
  status: "completed" | "completed_with_errors" | "failed";
  chunksAttempted?: number;
  pagesFetched?: number;
  rowsFetched?: number;
  rowsMatched: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount?: number;
  errorCount: number;
};

type SearchFormParams = {
  bizNo: string;
  dateFrom: string;
  dateTo: string;
  businessCategory: string;
};

type SyncProgressParams = SearchFormParams & {
  elapsedSeconds: number;
};

const emptySummary: ContractSummary = {
  contractCount: 0,
  totalAmount: 0,
  noticeLinkedCount: 0,
  latestContractDate: null,
};

function buildQueryString(params: SearchFormParams) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const trimmed = value.trim();

    if (trimmed.length > 0 && !(key === "businessCategory" && trimmed === "all")) {
      searchParams.set(key, trimmed);
    }
  }

  return searchParams.toString();
}

export function exportHrefForLastSearch(params: SearchFormParams | null, visibleRowCount: number) {
  if (params === null || visibleRowCount === 0) {
    return null;
  }

  const queryString = buildQueryString(params);

  return `/api/export${queryString.length > 0 ? `?${queryString}` : ""}`;
}

export function normalizeCompactDateInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function compactDateToIsoDate(value: string) {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function categoryLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return categoryLabels.get(value) ?? value;
}

function businessNumberLabel(row: ContractSearchRow) {
  return row.bizNoDisplay ?? row.bizNoNormalized;
}

function requestParamsFromForm(params: SearchFormParams): SearchFormParams {
  return {
    ...params,
    dateFrom: compactDateToIsoDate(params.dateFrom),
    dateTo: compactDateToIsoDate(params.dateTo),
  };
}

function countMonths(dateFrom: string, dateTo: string) {
  const from = compactDateToIsoDate(dateFrom);
  const to = compactDateToIsoDate(dateTo);
  const fromMatch = from.match(/^(\d{4})-(\d{2})-\d{2}$/);
  const toMatch = to.match(/^(\d{4})-(\d{2})-\d{2}$/);

  if (!fromMatch || !toMatch) {
    return null;
  }

  const fromIndex = Number(fromMatch[1]) * 12 + Number(fromMatch[2]);
  const toIndex = Number(toMatch[1]) * 12 + Number(toMatch[2]);
  return Math.max(1, toIndex - fromIndex + 1);
}

function countBusinessNumberInputs(value: string) {
  return value
    .split(/[,\s/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0).length;
}

function formatElapsed(seconds: number) {
  if (seconds < 60) {
    return `${seconds}초`;
  }

  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export function buildSyncProgressView(params: SyncProgressParams) {
  const months = countMonths(params.dateFrom, params.dateTo);
  const businessCount = countBusinessNumberInputs(params.bizNo);
  const businessScope = businessCount > 1 ? `${businessCount}개 사업자, ` : "";
  const includesShopping =
    params.businessCategory === "all" ||
    params.businessCategory === "" ||
    params.businessCategory === "shopping_third_party";
  const scopeLabel =
    params.businessCategory === "shopping_third_party"
      ? `${businessScope}3자단가 납품요구 판매 실적 조회`
      : `${businessScope}${months ?? "선택"}개월 범위 계약정보${includesShopping ? " + 3자단가 납품요구 판매 실적 조회" : ""}`;
  const phaseLabel = buildSyncPhaseLabel(params.elapsedSeconds, includesShopping);

  return {
    title: "동기화 진행 중",
    elapsedLabel: formatElapsed(params.elapsedSeconds),
    scopeLabel,
    phaseLabel,
  };
}

function buildSyncPhaseLabel(elapsedSeconds: number, includesShopping: boolean) {
  if (elapsedSeconds < 5) {
    return "요청 준비 중";
  }

  if (!includesShopping) {
    return "계약정보 페이지를 병렬로 조회 중";
  }

  if (elapsedSeconds < 30) {
    return "납품요구 목록을 병렬로 조회하고 사업자번호를 대조 중";
  }

  if (elapsedSeconds < 90) {
    return "응답량이 많아 계속 수집 중, 완료되면 자동으로 결과를 갱신합니다";
  }

  return "대량 조회를 계속 처리 중, 창을 닫지 않으면 완료 후 결과가 표시됩니다";
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatDate(value: string | null | undefined) {
  return value ?? "-";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceLinks(row: ContractSearchRow) {
  return [
    { label: "계약", href: row.contractDetailUrl },
    { label: "공고", href: row.noticeDetailUrl },
    { label: "원문", href: row.rawSourceUrl },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));
}

function sourceStatusLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return sourceStatusLabels[value] ?? value;
}

function enrichmentStatusLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return enrichmentStatusLabels[value] ?? value;
}

function detailValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function redactSensitiveText(value: string) {
  return value.replace(/(serviceKey|DATA_GO_KR_SERVICE_KEY)=([^&\s]+)/gi, "$1=[REDACTED]");
}

export function localizeClientError(message: string, context: "search" | "sync") {
  const knownMessages: Record<string, string> = {
    "Business registration number must contain 10 digits.":
      "사업자등록번호는 숫자 10자리여야 합니다.",
    "each bizNo must contain 10 digits":
      "각 사업자등록번호는 숫자 10자리여야 합니다.",
    "Business registration number list can contain up to 20 entries.":
      "사업자등록번호는 한 번에 최대 20개까지 입력할 수 있습니다.",
    "Business registration number list can contain up to 50 entries.":
      "사업자등록번호는 한 번에 최대 50개까지 입력할 수 있습니다.",
    "Search failed.": "검색에 실패했습니다.",
    "G2B sync failed.": "나라장터 동기화에 실패했습니다.",
    "DATA_GO_KR_SERVICE_KEY is required for G2B sync.":
      "나라장터 동기화를 위해 공공데이터포털 API 키가 필요합니다.",
    "Public Data Portal service usage approval is required for the G2B public data open standard service.":
      "나라장터 공공데이터개방표준서비스 활용 승인이 필요합니다.",
    "Public Data Portal service usage approval is required for the G2B shopping mall delivery request service.":
      "나라장터 종합쇼핑몰 납품요구 서비스 활용 승인이 필요합니다.",
    "Invalid request body.": "요청 형식이 올바르지 않습니다.",
  };
  const translated = knownMessages[message];

  if (translated) {
    return translated;
  }

  const prefix = context === "search" ? "검색 실패" : "나라장터 동기화 실패";
  return `${prefix}: ${redactSensitiveText(message)}`;
}
export function apiStatusLabels(health: DatabaseHealth | null) {
  if (health === null) {
    return {
      apiKey: "확인 전",
      enrichment: "확인 전",
    };
  }

  return {
    apiKey: health.apiKeyConfigured ? "설정됨" : "미설정",
    enrichment: health.enrichmentEnabled ? "활성" : "비활성",
  };
}

export function syncStatusMessage(result: SyncResponse) {
  const countSummary = `매칭 ${formatNumber(result.rowsMatched)}건, 신규 ${formatNumber(
    result.insertedCount,
  )}건, 갱신 ${formatNumber(result.updatedCount)}건`;
  const sourceSummary =
    result.pagesFetched !== undefined || result.rowsFetched !== undefined
      ? `조회 ${formatNumber(result.pagesFetched ?? 0)}페이지, 수집 ${formatNumber(result.rowsFetched ?? 0)}건`
      : null;
  const errorSummary = `오류 ${formatNumber(result.errorCount)}건`;

  if (result.status === "failed") {
    return `나라장터 동기화 실패: ${errorSummary}.`;
  }

  if (result.rowsMatched === 0 && result.insertedCount === 0 && result.updatedCount === 0) {
    return result.status === "completed_with_errors"
      ? `나라장터 동기화 일부 완료(${errorSummary}): 매칭 계약 없음.`
      : "나라장터 동기화 완료: 매칭 계약 없음.";
  }

  if (result.status === "completed_with_errors") {
    return `나라장터 동기화 일부 완료(${errorSummary}): ${sourceSummary ? `${sourceSummary}, ` : ""}${countSummary}.`;
  }

  return `나라장터 동기화 완료: ${sourceSummary ? `${sourceSummary}, ` : ""}${countSummary}.`;
}

export function ContractLookupApp() {
  const [bizNo, setBizNo] = useState("123-45-67890");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [businessCategory, setBusinessCategory] = useState("all");
  const [rows, setRows] = useState<ContractSearchRow[]>([]);
  const [summary, setSummary] = useState<ContractSummary>(emptySummary);
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [selectedRow, setSelectedRow] = useState<ContractSearchRow | null>(null);
  const [lastSearchParams, setLastSearchParams] = useState<SearchFormParams | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncElapsedSeconds, setSyncElapsedSeconds] = useState(0);
  const [syncProgressParams, setSyncProgressParams] = useState<SearchFormParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const exportHref = exportHrefForLastSearch(lastSearchParams, rows.length);
  const selectedLinks = selectedRow ? sourceLinks(selectedRow) : [];
  const latestEnrichmentError = selectedRow?.latestEnrichmentError
    ? redactSensitiveText(selectedRow.latestEnrichmentError)
    : null;
  const showEnrichmentIssue =
    latestEnrichmentError !== null || selectedRow?.latestEnrichmentStatus === "error";
  const isBusy = loading || syncing;
  const statusKey = syncing
    ? "syncing"
    : loading
      ? "searching"
      : error
        ? "error"
        : health
          ? "connected"
          : "ready";
  const statusLabel = statusDisplayLabels[statusKey];
  const apiLabels = apiStatusLabels(health);
  const syncProgress =
    syncing && syncProgressParams
      ? buildSyncProgressView({ ...syncProgressParams, elapsedSeconds: syncElapsedSeconds })
      : null;

  useEffect(() => {
    if (!syncing) {
      setSyncElapsedSeconds(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setSyncElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [syncing]);

  async function runSearch(submittedParams: SearchFormParams) {
    const submittedQueryString = buildQueryString(submittedParams);
    const response = await fetch(`/api/search?${submittedQueryString}`, {
      headers: { accept: "application/json" },
    });
    const payload = (await response.json()) as SearchResponse | { error?: string };

    if (!response.ok) {
      throw new Error(
        localizeClientError(
          "error" in payload && payload.error ? payload.error : "Search failed.",
          "search",
        ),
      );
    }

    const result = payload as SearchResponse;
    setRows(result.rows);
    setSummary(result.summary);
    setHealth(result.health);
    setSelectedRow(result.rows[0] ?? null);
    setLastSearchParams(submittedParams);
  }

  async function handleSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (isBusy) {
      return;
    }

    setLoading(true);
    setError(null);
    setStatusMessage(null);
    setHasSearched(true);
    const submittedParams = requestParamsFromForm({ bizNo, dateFrom, dateTo, businessCategory });

    try {
      await runSearch(submittedParams);
    } catch (searchError) {
      setRows([]);
      setSummary(emptySummary);
      setSelectedRow(null);
      setLastSearchParams(null);
      setError(
        searchError instanceof Error ? searchError.message : localizeClientError("Search failed.", "search"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (isBusy) {
      return;
    }

    const submittedParams = requestParamsFromForm({ bizNo, dateFrom, dateTo, businessCategory });
    setSyncing(true);
    setSyncElapsedSeconds(0);
    setSyncProgressParams({ bizNo, dateFrom, dateTo, businessCategory });
    setError(null);
    setStatusMessage("나라장터 동기화 시작.");

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(submittedParams),
      });
      const payload = (await response.json()) as SyncResponse | { error?: string };

      if (!response.ok) {
        throw new Error(
          localizeClientError(
            "error" in payload && payload.error ? payload.error : "G2B sync failed.",
            "sync",
          ),
        );
      }

      const syncResult = payload as SyncResponse;
      const message = syncStatusMessage(syncResult);

      if (syncResult.status === "failed") {
        setStatusMessage(null);
        setError(message);
        return;
      }

      await runSearch(submittedParams);
      setHasSearched(true);
      setStatusMessage(message);
    } catch (syncError) {
      setError(
        syncError instanceof Error ? syncError.message : localizeClientError("G2B sync failed.", "sync"),
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">나라장터 계약</p>
          <h1>계약 조회</h1>
        </div>
        <div className="header-status">
          <div className={`status-pill status-${statusKey}`}>
            <Database aria-hidden="true" size={16} />
            <span>{statusLabel}</span>
          </div>
          <span>DB 행 {health ? formatNumber(health.contractCount) : "-"}</span>
          <span>최근 가져오기 {formatDateTime(health?.latestImportAt)}</span>
          <span>API 키: {apiLabels.apiKey}</span>
          <span>상세 보강: {apiLabels.enrichment}</span>
        </div>
      </header>

      <form className="search-panel" onSubmit={handleSearch}>
        <label>
          <span>사업자등록번호</span>
          <textarea
            value={bizNo}
            onChange={(event) => setBizNo(event.target.value)}
            placeholder="123-45-67890, 204-81-45651"
            rows={3}
          />
        </label>
        <label>
          <span>시작일</span>
          <input
            inputMode="numeric"
            maxLength={8}
            pattern="\d{8}"
            placeholder="20250101"
            value={dateFrom}
            onChange={(event) => setDateFrom(normalizeCompactDateInput(event.target.value))}
          />
        </label>
        <label>
          <span>종료일</span>
          <input
            inputMode="numeric"
            maxLength={8}
            pattern="\d{8}"
            placeholder="20251231"
            value={dateTo}
            onChange={(event) => setDateTo(normalizeCompactDateInput(event.target.value))}
          />
        </label>
        <label>
          <span>업무 구분</span>
          <select
            value={businessCategory}
            onChange={(event) => setBusinessCategory(event.target.value)}
          >
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="search-actions">
          <button className="primary-button" type="submit" disabled={isBusy}>
            {loading ? (
              <Loader2 aria-hidden="true" className="spin" size={17} />
            ) : (
              <Search aria-hidden="true" size={17} />
            )}
            <span>검색</span>
          </button>
          <button
            className="secondary-button sync-button"
            type="button"
            disabled={isBusy}
            onClick={handleSync}
          >
            {syncing ? (
              <Loader2 aria-hidden="true" className="spin" size={17} />
            ) : (
              <RefreshCw aria-hidden="true" size={17} />
            )}
            <span>나라장터 동기화</span>
          </button>
          {exportHref ? (
            <a className="secondary-button" href={exportHref}>
              <Download aria-hidden="true" size={17} />
              <span>CSV 다운로드</span>
            </a>
          ) : (
            <span aria-disabled="true" className="secondary-button disabled-link">
              <Download aria-hidden="true" size={17} />
              <span>CSV 다운로드</span>
            </span>
          )}
        </div>
      </form>

      {error ? (
        <div className="error-banner" role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {statusMessage && !error && !syncing ? (
        <div className="info-banner" role="status">
          <Database aria-hidden="true" size={18} />
          <span>{statusMessage}</span>
        </div>
      ) : null}

      {syncProgress ? (
        <section className="sync-progress-panel" aria-label="동기화 진행 상태">
          <div>
            <strong>{syncProgress.title}</strong>
            <span>{syncProgress.phaseLabel}</span>
          </div>
          <div className="sync-progress-meta">
            <span>{syncProgress.scopeLabel}</span>
            <span>경과 {syncProgress.elapsedLabel}</span>
          </div>
          <div className="sync-progress-bar" aria-hidden="true">
            <span />
          </div>
        </section>
      ) : null}

      <section className="summary-grid" aria-label="검색 요약">
        <article>
          <span>계약 건수</span>
          <strong>{formatNumber(summary.contractCount)}</strong>
        </article>
        <article>
          <span>총 계약금액</span>
          <strong>{formatCurrency(summary.totalAmount)}</strong>
        </article>
        <article>
          <span>연결 공고</span>
          <strong>{formatNumber(summary.noticeLinkedCount)}</strong>
        </article>
        <article>
          <span>최근 계약일</span>
          <strong>{formatDate(summary.latestContractDate)}</strong>
        </article>
      </section>

      <section className="workspace-grid">
        <section className="results-panel" aria-label="검색 결과">
          <div className="panel-header">
            <div>
              <h2>검색 결과</h2>
              <p>
                {loading
                  ? "계약 불러오는 중"
                  : hasSearched
                    ? `${formatNumber(rows.length)}건 일치`
                    : "검색하면 계약 목록을 불러옵니다"}
              </p>
            </div>
            {health ? (
              <span className="health-note">DB 행 {formatNumber(health.contractCount)}</span>
            ) : null}
          </div>

          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>사업자등록번호</th>
                  <th>계약</th>
                  <th>공고</th>
                  <th>업무 구분</th>
                  <th>계약일</th>
                  <th>금액</th>
                  <th>기관</th>
                  <th>계약방법</th>
                  <th>링크</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowLinks = sourceLinks(row);

                  return (
                    <tr
                      className={selectedRow?.id === row.id ? "selected" : undefined}
                      key={row.id}
                      onClick={() => setSelectedRow(row)}
                    >
                      <td>
                        <div className="stacked-cell">
                          <span>{businessNumberLabel(row)}</span>
                          <small>{row.businessName ?? row.businessNameAtContract ?? "-"}</small>
                        </div>
                      </td>
                      <td>
                        <button
                          className="row-selector"
                          type="button"
                          onClick={() => setSelectedRow(row)}
                        >
                          <span>{row.contractName}</span>
                          <small>{row.unifiedContractNo ?? row.contractNo ?? "-"}</small>
                        </button>
                      </td>
                      <td>
                        <div className="stacked-cell">
                          <span>{row.noticeName ?? "-"}</span>
                          <small>{row.noticeNo ?? "-"}</small>
                        </div>
                      </td>
                      <td>{categoryLabel(row.businessCategory)}</td>
                      <td>{formatDate(row.contractDate)}</td>
                      <td>{formatCurrency(row.totalContractAmount ?? row.currentContractAmount)}</td>
                      <td>
                        <div className="stacked-cell">
                          <span>수요: {row.demandAgencyName ?? "-"}</span>
                          <span>계약: {row.contractAgencyName ?? "-"}</span>
                        </div>
                      </td>
                      <td>{row.contractMethod ?? row.winningMethod ?? "-"}</td>
                      <td>
                        {rowLinks.length > 0 ? (
                          <div className="row-source-links">
                            {rowLinks.map((link) => (
                              <a
                                href={link.href}
                                key={link.label}
                                onClick={(event) => event.stopPropagation()}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <span>{link.label}</span>
                                <ExternalLink aria-hidden="true" size={13} />
                              </a>
                            ))}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{sourceStatusLabel(row.sourceStatus)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {loading ? (
              <div className="table-state">
                <Loader2 aria-hidden="true" className="spin" size={20} />
                <span>가져온 계약 검색 중</span>
              </div>
            ) : null}

            {!loading && hasSearched && rows.length === 0 && !error ? (
              <div className="table-state">
                <FileText aria-hidden="true" size={20} />
                <span>현재 조건과 일치하는 계약이 없습니다.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="detail-panel" aria-label="선택한 계약 상세">
          <div className="panel-header">
            <div>
              <h2>상세</h2>
              <p>{selectedRow ? selectedRow.businessName ?? selectedRow.bizNoDisplay : "선택한 행 없음"}</p>
            </div>
          </div>

          {selectedRow ? (
            <div className="detail-content">
              <div className="detail-title">
                <FileText aria-hidden="true" size={20} />
                <div>
                  <h3>{selectedRow.contractName}</h3>
                  <p>{categoryLabel(selectedRow.businessCategory)}</p>
                </div>
              </div>

              <dl className="detail-list">
                <div>
                  <dt>계약번호</dt>
                  <dd>{detailValue(selectedRow.unifiedContractNo ?? selectedRow.contractNo)}</dd>
                </div>
                <div>
                  <dt>공고번호</dt>
                  <dd>{detailValue(selectedRow.noticeNo)}</dd>
                </div>
                <div>
                  <dt>계약일</dt>
                  <dd>{formatDate(selectedRow.contractDate)}</dd>
                </div>
                <div>
                  <dt>현재 계약금액</dt>
                  <dd>{formatCurrency(selectedRow.currentContractAmount)}</dd>
                </div>
                <div>
                  <dt>총 계약금액</dt>
                  <dd>{formatCurrency(selectedRow.totalContractAmount)}</dd>
                </div>
                <div>
                  <dt>수요기관</dt>
                  <dd>{detailValue(selectedRow.demandAgencyName)}</dd>
                </div>
                <div>
                  <dt>계약기관</dt>
                  <dd>{detailValue(selectedRow.contractAgencyName)}</dd>
                </div>
                <div>
                  <dt>계약 당시 업체명</dt>
                  <dd>{detailValue(selectedRow.businessNameAtContract)}</dd>
                </div>
                {showEnrichmentIssue ? (
                  <div className="api-error-row">
                    <dt>API 오류</dt>
                    <dd>
                      {latestEnrichmentError ??
                        `최근 보강 상태: ${enrichmentStatusLabel(selectedRow.latestEnrichmentStatus)}`}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <section className="source-section">
                <h3>
                  <LinkIcon aria-hidden="true" size={17} />
                  원문 링크
                </h3>
                {selectedLinks.length > 0 ? (
                  <div className="source-links">
                    {selectedLinks.map((link) => (
                      <a href={link.href} key={link.label} rel="noreferrer" target="_blank">
                        <span>{link.label}</span>
                        <ExternalLink aria-hidden="true" size={15} />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="muted">사용 가능한 원문 링크가 없습니다.</p>
                )}
              </section>

              <section className="freshness-section">
                <h3>
                  <CalendarDays aria-hidden="true" size={17} />
                  데이터 상태
                </h3>
                <dl className="detail-list compact">
                  <div>
                    <dt>데이터셋</dt>
                    <dd>{selectedRow.sourceDataset}</dd>
                  </div>
                  <div>
                    <dt>상태</dt>
                    <dd>{sourceStatusLabel(selectedRow.sourceStatus)}</dd>
                  </div>
                  <div>
                    <dt>가져온 시각</dt>
                    <dd>{formatDateTime(selectedRow.lastImportedAt)}</dd>
                  </div>
                  <div>
                    <dt>보강 시각</dt>
                    <dd>{formatDateTime(selectedRow.lastEnrichedAt)}</dd>
                  </div>
                  <div>
                    <dt>최근 가져오기</dt>
                    <dd>{formatDateTime(health?.latestImportAt)}</dd>
                  </div>
                  <div>
                    <dt>원본 해시</dt>
                    <dd className="hash-text">{selectedRow.sourceRowHash}</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : (
            <div className="detail-empty">
              <FileText aria-hidden="true" size={22} />
              <span>결과 행을 선택하면 계약 원문과 데이터 상태를 확인할 수 있습니다.</span>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
