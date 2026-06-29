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
import { useState } from "react";
import type { FormEvent } from "react";

import type { ContractSearchRow, DatabaseHealth } from "@/lib/contracts/types";

const categoryOptions = [
  { value: "all", label: "All" },
  { value: "goods", label: "Goods" },
  { value: "construction", label: "Construction" },
  { value: "services", label: "Services" },
  { value: "foreign", label: "Foreign" },
  { value: "unknown", label: "Unknown" },
];

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
  rowsMatched: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
};

type SearchFormParams = {
  bizNo: string;
  dateFrom: string;
  dateTo: string;
  businessCategory: string;
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
    { label: "Contract", href: row.contractDetailUrl },
    { label: "Notice", href: row.noticeDetailUrl },
    { label: "Raw", href: row.rawSourceUrl },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));
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

export function apiStatusLabels(health: DatabaseHealth | null) {
  if (health === null) {
    return {
      apiKey: "unknown",
      enrichment: "unknown",
    };
  }

  return {
    apiKey: health.apiKeyConfigured ? "configured" : "missing",
    enrichment: health.enrichmentEnabled ? "enabled" : "disabled",
  };
}

export function syncStatusMessage(result: SyncResponse) {
  const countSummary = `matched ${formatNumber(result.rowsMatched)}, inserted ${formatNumber(
    result.insertedCount,
  )}, updated ${formatNumber(result.updatedCount)}`;
  const errorSummary = `${formatNumber(result.errorCount)} ${
    result.errorCount === 1 ? "error" : "errors"
  }`;

  if (result.status === "failed") {
    return `G2B sync failed: ${errorSummary}.`;
  }

  if (result.rowsMatched === 0 && result.insertedCount === 0 && result.updatedCount === 0) {
    return result.status === "completed_with_errors"
      ? `G2B sync completed with ${errorSummary}: no matching G2B contracts found.`
      : "G2B sync completed: no matching G2B contracts found.";
  }

  if (result.status === "completed_with_errors") {
    return `G2B sync completed with ${errorSummary}: ${countSummary}.`;
  }

  return `G2B sync completed: ${countSummary}.`;
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
  const statusLabel = syncing
    ? "Syncing"
    : loading
      ? "Searching"
      : error
        ? "Error"
        : health
          ? "Connected"
          : "Ready";
  const apiLabels = apiStatusLabels(health);

  async function runSearch(submittedParams: SearchFormParams) {
    const submittedQueryString = buildQueryString(submittedParams);
    const response = await fetch(`/api/search?${submittedQueryString}`, {
      headers: { accept: "application/json" },
    });
    const payload = (await response.json()) as SearchResponse | { error?: string };

    if (!response.ok) {
      throw new Error("error" in payload && payload.error ? payload.error : "Search failed.");
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
    const submittedParams = { bizNo, dateFrom, dateTo, businessCategory };

    try {
      await runSearch(submittedParams);
    } catch (searchError) {
      setRows([]);
      setSummary(emptySummary);
      setSelectedRow(null);
      setLastSearchParams(null);
      setError(searchError instanceof Error ? searchError.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (isBusy) {
      return;
    }

    const submittedParams = { bizNo, dateFrom, dateTo, businessCategory };
    setSyncing(true);
    setError(null);
    setStatusMessage("G2B sync started.");

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
        throw new Error("error" in payload && payload.error ? payload.error : "G2B sync failed.");
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
      setError(syncError instanceof Error ? syncError.message : "G2B sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">G2B contracts</p>
          <h1>Contract Lookup</h1>
        </div>
        <div className="header-status">
          <div className={`status-pill status-${statusLabel.toLowerCase()}`}>
            <Database aria-hidden="true" size={16} />
            <span>{statusLabel}</span>
          </div>
          <span>DB rows {health ? formatNumber(health.contractCount) : "-"}</span>
          <span>Latest import {formatDateTime(health?.latestImportAt)}</span>
          <span>API key: {apiLabels.apiKey}</span>
          <span>Enrichment: {apiLabels.enrichment}</span>
        </div>
      </header>

      <form className="search-panel" onSubmit={handleSearch}>
        <label>
          <span>Business registration no.</span>
          <input
            value={bizNo}
            onChange={(event) => setBizNo(event.target.value)}
            placeholder="123-45-67890"
          />
        </label>
        <label>
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          <span>Category</span>
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
            <span>Search</span>
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
            <span>Sync G2B</span>
          </button>
          {exportHref ? (
            <a className="secondary-button" href={exportHref}>
              <Download aria-hidden="true" size={17} />
              <span>CSV</span>
            </a>
          ) : (
            <span aria-disabled="true" className="secondary-button disabled-link">
              <Download aria-hidden="true" size={17} />
              <span>CSV</span>
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

      {statusMessage && !error ? (
        <div className="info-banner" role="status">
          <Database aria-hidden="true" size={18} />
          <span>{statusMessage}</span>
        </div>
      ) : null}

      <section className="summary-grid" aria-label="Search summary">
        <article>
          <span>Contracts</span>
          <strong>{formatNumber(summary.contractCount)}</strong>
        </article>
        <article>
          <span>Total amount</span>
          <strong>{formatCurrency(summary.totalAmount)}</strong>
        </article>
        <article>
          <span>Linked notices</span>
          <strong>{formatNumber(summary.noticeLinkedCount)}</strong>
        </article>
        <article>
          <span>Latest contract</span>
          <strong>{formatDate(summary.latestContractDate)}</strong>
        </article>
      </section>

      <section className="workspace-grid">
        <section className="results-panel" aria-label="Search results">
          <div className="panel-header">
            <div>
              <h2>Results</h2>
              <p>
                {loading
                  ? "Loading records"
                  : hasSearched
                    ? `${formatNumber(rows.length)} matching records`
                    : "Run a search to load records"}
              </p>
            </div>
            {health ? (
              <span className="health-note">DB rows {formatNumber(health.contractCount)}</span>
            ) : null}
          </div>

          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Notice</th>
                  <th>Category</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Agencies</th>
                  <th>Method</th>
                  <th>Links</th>
                  <th>Status</th>
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
                      <td>{row.businessCategory}</td>
                      <td>{formatDate(row.contractDate)}</td>
                      <td>{formatCurrency(row.totalContractAmount ?? row.currentContractAmount)}</td>
                      <td>
                        <div className="stacked-cell">
                          <span>D: {row.demandAgencyName ?? "-"}</span>
                          <span>C: {row.contractAgencyName ?? "-"}</span>
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
                      <td>{row.sourceStatus}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {loading ? (
              <div className="table-state">
                <Loader2 aria-hidden="true" className="spin" size={20} />
                <span>Searching imported contracts</span>
              </div>
            ) : null}

            {!loading && hasSearched && rows.length === 0 && !error ? (
              <div className="table-state">
                <FileText aria-hidden="true" size={20} />
                <span>No contracts matched the current filters.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="detail-panel" aria-label="Selected contract details">
          <div className="panel-header">
            <div>
              <h2>Detail</h2>
              <p>{selectedRow ? selectedRow.businessName ?? selectedRow.bizNoDisplay : "No row selected"}</p>
            </div>
          </div>

          {selectedRow ? (
            <div className="detail-content">
              <div className="detail-title">
                <FileText aria-hidden="true" size={20} />
                <div>
                  <h3>{selectedRow.contractName}</h3>
                  <p>{selectedRow.businessCategory}</p>
                </div>
              </div>

              <dl className="detail-list">
                <div>
                  <dt>Contract no.</dt>
                  <dd>{detailValue(selectedRow.unifiedContractNo ?? selectedRow.contractNo)}</dd>
                </div>
                <div>
                  <dt>Notice no.</dt>
                  <dd>{detailValue(selectedRow.noticeNo)}</dd>
                </div>
                <div>
                  <dt>Contract date</dt>
                  <dd>{formatDate(selectedRow.contractDate)}</dd>
                </div>
                <div>
                  <dt>Current amount</dt>
                  <dd>{formatCurrency(selectedRow.currentContractAmount)}</dd>
                </div>
                <div>
                  <dt>Total amount</dt>
                  <dd>{formatCurrency(selectedRow.totalContractAmount)}</dd>
                </div>
                <div>
                  <dt>Demand agency</dt>
                  <dd>{detailValue(selectedRow.demandAgencyName)}</dd>
                </div>
                <div>
                  <dt>Contract agency</dt>
                  <dd>{detailValue(selectedRow.contractAgencyName)}</dd>
                </div>
                <div>
                  <dt>Business at contract</dt>
                  <dd>{detailValue(selectedRow.businessNameAtContract)}</dd>
                </div>
                {showEnrichmentIssue ? (
                  <div className="api-error-row">
                    <dt>API error</dt>
                    <dd>
                      {latestEnrichmentError ??
                        `Latest enrichment status: ${selectedRow.latestEnrichmentStatus}`}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <section className="source-section">
                <h3>
                  <LinkIcon aria-hidden="true" size={17} />
                  Sources
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
                  <p className="muted">No source links available.</p>
                )}
              </section>

              <section className="freshness-section">
                <h3>
                  <CalendarDays aria-hidden="true" size={17} />
                  Freshness
                </h3>
                <dl className="detail-list compact">
                  <div>
                    <dt>Dataset</dt>
                    <dd>{selectedRow.sourceDataset}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{selectedRow.sourceStatus}</dd>
                  </div>
                  <div>
                    <dt>Imported</dt>
                    <dd>{formatDateTime(selectedRow.lastImportedAt)}</dd>
                  </div>
                  <div>
                    <dt>Enriched</dt>
                    <dd>{formatDateTime(selectedRow.lastEnrichedAt)}</dd>
                  </div>
                  <div>
                    <dt>Latest import</dt>
                    <dd>{formatDateTime(health?.latestImportAt)}</dd>
                  </div>
                  <div>
                    <dt>Source hash</dt>
                    <dd className="hash-text">{selectedRow.sourceRowHash}</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : (
            <div className="detail-empty">
              <FileText aria-hidden="true" size={22} />
              <span>Select a result row to inspect contract source and freshness.</span>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
