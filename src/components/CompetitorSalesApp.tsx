"use client";

import { ChevronDown, Download, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CompetitorSalesOverview,
  CompetitorSalesOverviewResponse,
  CompetitorSalesPeriodQuery,
} from "@/lib/competitors/types";

const FIRST_COMPETITOR_YEAR = 2020;
const wonFormatter = new Intl.NumberFormat("ko-KR");
const MAX_OVERVIEW_COMPLETION_PASSES = 3;

type PeriodUnit = CompetitorSalesPeriodQuery["period"];
type PeriodSelection =
  | { period: "month"; year: number; month: number }
  | { period: "quarter"; year: number; quarter: number }
  | { period: "year"; year: number };
type SalesCompany = CompetitorSalesOverviewResponse["companies"][number];
type SortableCompany = Pick<SalesCompany, "competitorId" | "displayOrder" | "totalAmount">;
type AmountCompany = {
  collectionStatus: SalesCompany["collectionStatus"];
  contracts: Array<{ amountAttribution?: "full-contract" | "supplier-reported" | "supplier-rate" | "equal-share" }>;
  totalAmount: number | null;
};
type ExportableCompetitorOverview = Pick<CompetitorSalesOverviewResponse, "coverage"> & {
  period: Pick<CompetitorSalesOverview["period"], "period" | "year" | "month" | "quarter">;
};

const periodUnits: Array<{ label: string; value: PeriodUnit }> = [
  { label: "월별", value: "month" },
  { label: "분기별", value: "quarter" },
  { label: "연별", value: "year" },
];

export function getSeoulPeriodSelection(now = new Date()): Extract<PeriodSelection, { period: "month" }> {
  const { month, year } = getSeoulYearMonth(now);
  return { period: "month", year, month };
}

export function getSeoulYearOptions(now = new Date()) {
  const { year } = getSeoulYearMonth(now);
  return Array.from(
    { length: year - FIRST_COMPETITOR_YEAR + 1 },
    (_, index) => year - index,
  );
}

export function getAvailableMonths(year: number, now = new Date()) {
  const current = getSeoulYearMonth(now);
  return Array.from(
    { length: year === current.year ? current.month : 12 },
    (_, index) => index + 1,
  );
}

export function getAvailableQuarters(year: number, now = new Date()) {
  const current = getSeoulYearMonth(now);
  return Array.from(
    { length: year === current.year ? Math.ceil(current.month / 3) : 4 },
    (_, index) => index + 1,
  );
}

export function switchPeriodSelection(
  selection: PeriodSelection,
  period: PeriodUnit,
  now = new Date(),
): PeriodSelection {
  const current = getSeoulYearMonth(now);
  if (period === "month") return { period, year: selection.year, month: current.month };
  if (period === "quarter") {
    return { period, year: selection.year, quarter: Math.ceil(current.month / 3) };
  }
  return { period, year: selection.year };
}

export function buildOverviewQuery(
  selection: PeriodSelection,
  options: { cacheOnly?: boolean; refresh?: boolean } = {},
) {
  const params = new URLSearchParams({ period: selection.period, year: String(selection.year) });
  if (selection.period === "month") params.set("month", String(selection.month));
  if (selection.period === "quarter") params.set("quarter", String(selection.quarter));
  if (options.cacheOnly) params.set("cacheOnly", "1");
  if (options.refresh) params.set("refresh", "1");
  return params.toString();
}

export function buildCompetitorExportUrl(selection: PeriodSelection) {
  return `/api/competitors/export?${buildOverviewQuery(selection)}`;
}

export function canExportCompetitorOverview(
  overview: ExportableCompetitorOverview | null,
  isLoading: boolean,
  selection: PeriodSelection,
) {
  return Boolean(
    overview
    && !isLoading
    && overview.coverage.complete
    && overview.coverage.fresh
    && overview.period.period === selection.period
    && overview.period.year === selection.year
    && overview.period.month === (selection.period === "month" ? selection.month : null)
    && overview.period.quarter === (selection.period === "quarter" ? selection.quarter : null),
  );
}

export function cacheCollectionStatus(coverage?: CompetitorSalesOverviewResponse["coverage"]) {
  if (!coverage || (coverage.complete && coverage.fresh)) return { isPartial: false, message: null };
  if (coverage.complete) {
    return {
      isPartial: false,
      message: "저장된 전체 결과를 표시하고 최신 데이터를 확인 중입니다.",
    };
  }
  return {
    isPartial: true,
    message: "저장된 결과를 먼저 표시하고 누락 기간을 조회 중입니다.",
  };
}

export function sortCompaniesBySales<T extends SortableCompany>(companies: T[]) {
  return [...companies].sort(
    (left, right) =>
      (right.totalAmount ?? -1) - (left.totalAmount ?? -1) || left.displayOrder - right.displayOrder,
  );
}

export function formatCompetitorAmount(company: AmountCompany) {
  if (company.collectionStatus === "collecting") return "조회 중";
  if (company.collectionStatus === "failed") return "조회 실패";
  if (company.collectionStatus === "uncollected" || company.totalAmount === null) return "미집계";

  const hasEstimatedAmount = company.contracts.some(
    (contract) => contract.amountAttribution === "equal-share",
  );
  return `${formatWon(company.totalAmount)}${hasEstimatedAmount ? " (추정 포함)" : ""}`;
}

export function CompetitorSalesApp() {
  const current = useRef(getSeoulYearMonth(new Date())).current;
  const [selection, setSelection] = useState<PeriodSelection>(() => getSeoulPeriodSelection());
  const [overview, setOverview] = useState<CompetitorSalesOverviewResponse | null>(null);
  const [openCompanyId, setOpenCompanyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestSequence = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const refreshSequence = useRef(0);

  useEffect(() => {
    refreshController.current?.abort();
    refreshController.current = null;
    refreshSequence.current += 1;
    setIsRefreshing(false);
    const controller = new AbortController();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setIsLoading(true);
    setError(null);
    setOverview(null);
    setOpenCompanyId(null);

    void (async () => {
      try {
        const cachedOverview = await loadOverview(selection, controller.signal, { cacheOnly: true });
        if (sequence !== requestSequence.current) return;

        if (hasCachedOverviewData(cachedOverview)) {
          setOverview(cachedOverview);
          setOpenCompanyId(null);
        }

        if (cachedOverview.coverage.complete && cachedOverview.coverage.fresh) {
          setIsLoading(false);
          return;
        }

        for (let pass = 0; pass < MAX_OVERVIEW_COMPLETION_PASSES; pass += 1) {
          const nextOverview = await loadOverview(selection, controller.signal);
          if (sequence !== requestSequence.current) return;
          setOverview(nextOverview);
          setOpenCompanyId(null);
          if (nextOverview.coverage.complete && nextOverview.coverage.fresh) {
            break;
          }
        }
      } catch (caught: unknown) {
        if (isAbortError(caught) || sequence !== requestSequence.current) return;
        setError(caught instanceof Error ? caught.message : "경쟁사 영업 성과를 불러오지 못했습니다.");
      } finally {
        if (sequence === requestSequence.current) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selection]);

  const companies = useMemo(() => sortCompaniesBySales(overview?.companies ?? []), [overview]);
  const years = useMemo(() => getSeoulYearOptions(), []);
  const availableMonths = useMemo(
    () => getAvailableMonths(selection.year),
    [selection.year],
  );
  const availableQuarters = useMemo(
    () => getAvailableQuarters(selection.year),
    [selection.year],
  );
  const cacheStatus = cacheCollectionStatus(overview?.coverage);
  const partialCache = cacheStatus.isPartial;
  const loadingMessage = cacheStatus.message ?? "조회 중입니다.";
  const exportHref = canExportCompetitorOverview(overview, isLoading, selection)
    ? buildCompetitorExportUrl(selection)
    : null;
  const exportLabel = exportHref ? "엑셀 내보내기" : "전체 집계 완료 후 엑셀을 내보낼 수 있습니다.";

  function updateSelection(next: PeriodSelection) {
    setSelection(next);
  }

  function changeUnit(period: PeriodUnit) {
    if (period === selection.period) return;
    updateSelection(switchPeriodSelection(selection, period));
  }

  function changeYear(year: number) {
    if (selection.period === "year") return updateSelection({ period: "year", year });
    if (selection.period === "month") {
      return updateSelection({ period: "month", year, month: clampMonth(year, selection.month, current) });
    }
    updateSelection({ period: "quarter", year, quarter: clampQuarter(year, selection.quarter, current) });
  }

  function handleRefresh() {
    if (isRefreshing) return;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    setIsRefreshing(true);

    void (async () => {
      try {
        const refreshed = await loadOverview(selection, controller.signal, { refresh: true });
        if (sequence !== refreshSequence.current) return;
        setOverview(refreshed);
        setError(null);
        if (!refreshed.coverage.complete || !refreshed.coverage.fresh) {
          for (let pass = 1; pass < MAX_OVERVIEW_COMPLETION_PASSES; pass++) {
            const nextOverview = await loadOverview(selection, controller.signal);
            if (sequence !== refreshSequence.current) return;
            setOverview(nextOverview);
            if (nextOverview.coverage.complete && nextOverview.coverage.fresh) break;
          }
        }
      } catch (caught: unknown) {
        if (isAbortError(caught) || sequence !== refreshSequence.current) return;
        setError(caught instanceof Error ? caught.message : "경쟁사 영업 성과를 불러오지 못했습니다.");
      } finally {
        if (sequence === refreshSequence.current) setIsRefreshing(false);
      }
    })();
  }

  useEffect(() => () => {
    refreshController.current?.abort();
  }, []);

  return (
    <main className="competitor-sales-page">
      <header className="competitor-sales-heading">
        <h1>경쟁사 영업 성과</h1>
        <p>조달우수제품 지정 경쟁사의 계약금액과 계약 건수를 비교합니다.</p>
      </header>

      <section className="competitor-sales-panel" aria-label="경쟁사 영업 성과">
        <div className="competitor-sales-panel-header">
          <div>
            <h2>경쟁사 영업 성과</h2>
            <p>{periodContext(selection, overview?.period)}</p>
            <p className="competitor-sales-collected-at">마지막 API 확인: {formatCollectedAt(overview?.collectedAt)}</p>
          </div>
          <div className="competitor-sales-controls">
            <div aria-label="집계 단위" className="competitor-sales-segmented" role="group">
              {periodUnits.map((unit) => (
                <button
                  aria-pressed={selection.period === unit.value}
                  key={unit.value}
                  onClick={() => changeUnit(unit.value)}
                  type="button"
                >
                  {unit.label}
                </button>
              ))}
            </div>
            <label className="competitor-sales-select">
              <span>연도</span>
              <select onChange={(event) => changeYear(Number(event.target.value))} value={selection.year}>
                {years.map((year) => <option key={year} value={year}>{year}년</option>)}
              </select>
            </label>
            {selection.period === "month" ? (
              <label className="competitor-sales-select">
                <span>월</span>
                <select
                  onChange={(event) => updateSelection({ ...selection, month: Number(event.target.value) })}
                  value={selection.month}
                >
                  {availableMonths.map((month) => <option key={month} value={month}>{month}월</option>)}
                </select>
              </label>
            ) : null}
            {selection.period === "quarter" ? (
              <label className="competitor-sales-select">
                <span>분기</span>
                <select
                  onChange={(event) => updateSelection({ ...selection, quarter: Number(event.target.value) })}
                  value={selection.quarter}
                >
                  {availableQuarters.map((quarter) => <option key={quarter} value={quarter}>{quarter}분기</option>)}
                </select>
              </label>
            ) : null}
            <button
              aria-label={isRefreshing ? "최신 데이터 조회 중" : "최신 데이터 조회"}
              className="competitor-sales-refresh"
              disabled={isRefreshing || isLoading}
              onClick={handleRefresh}
              title={isRefreshing ? "최신 데이터 조회 중" : "최신 데이터 조회"}
              type="button"
            >
              <RefreshCw
                aria-hidden="true"
                className={isRefreshing ? "competitor-sales-spin" : undefined}
                size={14}
              />
              <span>최신 데이터</span>
            </button>
            {exportHref ? (
              <a
                aria-label={exportLabel}
                className="competitor-sales-export"
                href={exportHref}
                title={exportLabel}
              >
                <Download aria-hidden="true" size={15} />
                엑셀 내보내기
              </a>
            ) : (
              <button
                aria-disabled="true"
                aria-label={exportLabel}
                className="competitor-sales-export is-disabled"
                title={exportLabel}
                type="button"
              >
                <Download aria-hidden="true" size={15} />
                엑셀 내보내기
              </button>
            )}
          </div>
        </div>

        {error ? <p className="competitor-sales-error" role="alert">{error}</p> : null}
        {isLoading ? <p className="competitor-sales-loading" role="status"><LoaderCircle aria-hidden="true" className="competitor-sales-spin" size={15} />{loadingMessage}</p> : null}

        <section className="competitor-sales-summary" aria-label="전체 계약 요약">
          <Metric label={partialCache ? "저장된 결과 기준 계약금액" : "전체 계약금액"} value={formatOverviewAmount(overview)} />
          <Metric label={partialCache ? "저장된 결과 기준 계약건수" : "전체 계약건수"} value={formatOverviewCount(overview)} />
          <Metric label={partialCache ? "저장된 결과 기준 최근 계약일" : "전체 최근 계약일"} value={formatOverviewLatestDate(overview)} />
        </section>

        <section className="competitor-sales-list" aria-label="조달우수제품 지정 업체 22곳">
          {companies.length > 0
            ? companies.map((company, index) => (
              <CompanyDisclosure
                company={company}
                index={index}
                key={company.competitorId}
                open={company.competitorId === openCompanyId}
                onToggle={() => setOpenCompanyId((currentOpen) => currentOpen === company.competitorId ? null : company.competitorId)}
              />
            ))
            : Array.from({ length: 22 }, (_, index) => <CompanySkeleton index={index} key={index} />)}
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function CompanyDisclosure({
  company,
  index,
  onToggle,
  open,
}: {
  company: SalesCompany;
  index: number;
  onToggle: () => void;
  open: boolean;
}) {
  const detailId = `competitor-contracts-${company.competitorId}`;
  return (
    <article className={`competitor-sales-company ${open ? "is-open" : ""}`}>
      <button
        aria-controls={detailId}
        aria-expanded={open}
        aria-label={`${company.companyName}, ${formatCompetitorAmount(company)}, ${formatCompanyCount(company)}, 최근 계약일 ${company.latestContractDate ?? "없음"}`}
        className="competitor-sales-company-toggle"
        onClick={onToggle}
        type="button"
      >
        <span className="competitor-sales-company-name">
          <strong>{index + 1}. {company.companyName}</strong>
          <small>{company.designationStartDate} ~ {company.designationEndDate}</small>
          <small>지정번호 {company.designationNo}</small>
        </span>
        <span className="competitor-sales-company-metric"><small>금액</small><strong>{formatCompetitorAmount(company)}</strong></span>
        <span className="competitor-sales-company-metric"><small>건수</small><strong>{formatCompanyCount(company)}</strong></span>
        <span className="competitor-sales-company-metric"><small>최근 계약일</small><strong>{company.latestContractDate ?? "-"}</strong></span>
        <span aria-hidden="true" className="competitor-sales-view">보기 <ChevronDown size={16} /></span>
      </button>
      {open ? <ContractDetails company={company} id={detailId} /> : null}
    </article>
  );
}

function ContractDetails({ company, id }: { company: SalesCompany; id: string }) {
  if (company.contracts.length === 0) {
    return <div className="competitor-sales-contract-empty" id={id}>선택한 기간에 계약 내역이 없습니다.</div>;
  }

  return (
    <div className="competitor-sales-contract-wrap" id={id}>
      <table aria-label={`${company.companyName} 계약 상세`}>
        <thead>
          <tr><th scope="col">계약명</th><th scope="col">수요기관</th><th scope="col">계약일</th><th scope="col">계약방식</th><th scope="col">금액</th><th scope="col">원문</th></tr>
        </thead>
        <tbody>
          {company.contracts.map((contract) => {
            const detailUrl = contract.contractDetailUrl || contract.noticeDetailUrl;
            return (
              <tr key={contract.id}>
                <td data-label="계약명"><strong>{contract.contractName || "-"}</strong></td>
                <td data-label="수요기관">{contract.demandAgencyName || "-"}</td>
                <td data-label="계약일">{contract.contractDate ?? "-"}</td>
                <td data-label="계약방식">{contract.contractMethod || "-"}</td>
                <td data-label="금액">{formatContractAmount(contract.totalContractAmount, contract.amountAttribution)}</td>
                <td data-label="원문">
                  {detailUrl ? <a href={detailUrl} rel="noreferrer" target="_blank">원문 <ExternalLink aria-hidden="true" size={13} /></a> : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompanySkeleton({ index }: { index: number }) {
  return (
    <article aria-label={`${index + 1}번째 업체를 불러오는 중`} className="competitor-sales-company competitor-sales-skeleton">
      <span /><span /><span /><span /><span />
    </article>
  );
}

export function hasCachedOverviewData(overview: {
  coverage: CompetitorSalesOverviewResponse["coverage"];
  period: Pick<CompetitorSalesOverview["period"], "dateFrom" | "dateTo">;
  companies: Array<Pick<SalesCompany, "contracts">>;
}) {
  if (overview.coverage.complete || overview.companies.some((company) => company.contracts.length > 0)) {
    return true;
  }

  const [missingRange] = overview.coverage.missingRanges;
  const wholePeriodIsMissing = overview.coverage.missingRanges.length === 1
    && missingRange?.dateFrom === overview.period.dateFrom
    && missingRange.dateTo === overview.period.dateTo;
  return !wholePeriodIsMissing;
}

async function loadOverview(
  selection: PeriodSelection,
  signal: AbortSignal,
  options: { cacheOnly?: boolean; refresh?: boolean } = {},
): Promise<CompetitorSalesOverviewResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/competitors/overview?${buildOverviewQuery(selection, options)}`, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch (caught) {
    if (isAbortError(caught)) throw caught;
    throw new Error("경쟁사 영업 성과를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.");
  }

  if (!response.ok) {
    throw new Error(await overviewErrorMessage(response));
  }
  return response.json() as Promise<CompetitorSalesOverviewResponse>;
}

async function overviewErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    const message = typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : "";
    if (message) return message;
  } catch {
    // Fall through to the safe client-facing message.
  }
  return response.status >= 500
    ? "경쟁사 계약 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 조회해 주세요."
    : "선택한 기간을 조회할 수 없습니다.";
}

function formatOverviewAmount(overview: CompetitorSalesOverviewResponse | null) {
  if (!overview || overview.totalAmount === null) return overview?.status === "failed" ? "조회 실패" : "미집계";
  const estimated = overview.companies.some((company) => company.contracts.some((contract) => contract.amountAttribution === "equal-share"));
  return `${formatWon(overview.totalAmount)}${estimated ? " (추정 포함)" : ""}`;
}

function formatOverviewCount(overview: CompetitorSalesOverviewResponse | null) {
  if (!overview || overview.totalContractCount === null) return overview?.status === "failed" ? "조회 실패" : "미집계";
  return `${wonFormatter.format(overview.totalContractCount)}건`;
}

function formatOverviewLatestDate(overview: CompetitorSalesOverviewResponse | null) {
  if (!overview || overview.latestContractDate === null) return overview?.status === "ready" ? "계약 없음" : "미집계";
  return overview.latestContractDate;
}

function formatCompanyCount(company: Pick<SalesCompany, "collectionStatus" | "contractCount">) {
  if (company.collectionStatus === "collecting") return "조회 중";
  if (company.collectionStatus === "failed") return "조회 실패";
  if (company.collectionStatus === "uncollected" || company.contractCount === null) return "미집계";
  return `${wonFormatter.format(company.contractCount)}건`;
}

function formatContractAmount(
  amount: number,
  attribution: "full-contract" | "supplier-reported" | "supplier-rate" | "equal-share" | undefined,
) {
  return `${formatWon(amount)}${attribution === "equal-share" ? " (추정)" : ""}`;
}

function formatWon(amount: number) {
  return `${wonFormatter.format(amount)}원`;
}

export function periodContext(selection: PeriodSelection, _period?: CompetitorSalesOverview["period"]) {
  const basis = "조달우수 지정 업체의 계약";
  if (selection.period === "month") return `${selection.year}년 ${selection.month}월 ${basis}을 집계합니다.`;
  if (selection.period === "quarter") return `${selection.year}년 ${selection.quarter}분기 ${basis}을 집계합니다.`;
  return `${selection.year}년 ${basis}을 집계합니다.`;
}

function clampMonth(year: number, month: number, current: { year: number; month: number }) {
  return year === current.year ? Math.min(month, current.month) : month;
}

function clampQuarter(year: number, quarter: number, current: { year: number; month: number }) {
  return year === current.year ? Math.min(quarter, Math.ceil(current.month / 3)) : quarter;
}

function getSeoulYearMonth(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function isAbortError(value: unknown) {
  return value instanceof DOMException ? value.name === "AbortError" : value instanceof Error && value.name === "AbortError";
}

function formatCollectedAt(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
