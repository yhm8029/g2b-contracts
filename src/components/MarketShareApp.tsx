"use client";

import { Download, RefreshCw, Save, Settings, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./MarketShareApp.module.css";

type Category = "excellent" | "non_excellent" | "cooperative";
type ReportRow = { companyName: string; bizNo: string | null; designationEndDate: string | null; category: Category; awardCount: number; marketSharePercent: number };
type RegistryRow = { bizNo: string; companyName: string; designationNo: string; designationStartDate: string; designationEndDate: string; enabled: boolean; displayOrder: number };
type ReportResponse = { periodLabel: string; totalAwardCount: number; rows: ReportRow[]; registry: RegistryRow[]; sync: { status: string; lastSyncedAt: string | null; message: string | null } };

const COLORS = ["#156f4a", "#d97706", "#2563eb", "#be123c", "#7c3aed", "#0891b2", "#4d7c0f", "#c2410c", "#4338ca", "#0f766e", "#a16207", "#0369a1", "#9f1239", "#6d28d9", "#15803d", "#b45309", "#1d4ed8", "#b91c1c", "#5b21b6", "#0e7490", "#3f6212", "#9a3412", "#3730a3", "#047857"];
const CATEGORY_LABEL: Record<Category, string> = { excellent: "조달우수", non_excellent: "조달우수X", cooperative: "협동조합" };

export function MarketShareApp() {
  const current = useMemo(() => seoulYearQuarter(), []);
  const [year, setYear] = useState(current.year);
  const [quarter, setQuarter] = useState<number | null>(current.quarter);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [registry, setRegistry] = useState<RegistryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ year: String(year) });
    if (quarter !== null) params.set("quarter", String(quarter));
    return params.toString();
  }, [quarter, year]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/building-control-market/report?${query}`);
      const payload = await response.json() as ReportResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "보고서를 불러오지 못했습니다.");
      setData(payload);
      setRegistry(payload.registry);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "보고서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/building-control-market/sync", { method: "POST" });
      const payload = await response.json() as { error?: string; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? payload.error ?? "동기화에 실패했습니다.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "동기화에 실패했습니다.");
    } finally {
      setSyncing(false);
    }
  }

  async function save(row: RegistryRow) {
    setSaving(row.bizNo);
    setError(null);
    try {
      const response = await fetch("/api/building-control-market/registry", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row),
      });
      const payload = await response.json() as { registry?: RegistryRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "업체 정보를 저장하지 못했습니다.");
      if (payload.registry) setRegistry(payload.registry);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "업체 정보를 저장하지 못했습니다.");
    } finally {
      setSaving(null);
    }
  }

  const pie = useMemo(() => pieGradient(data?.rows ?? []), [data]);
  const years = Array.from({ length: current.year - 2025 + 1 }, (_, index) => current.year - index);

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <div>
          <h1>빌딩자동제어 시장점유율</h1>
          <p>품목번호 39121801 / 3912180101 · 낙찰일 기준 2025년 이후</p>
        </div>
        <div className={styles.toolbar}>
          <button onClick={() => void load()} disabled={loading} title="새로고침" type="button"><RefreshCw size={16} />새로고침</button>
          <a className={styles.export} href={`/api/building-control-market/export?${query}`}><Download size={16} />엑셀 다운로드</a>
          <button onClick={() => setEditorOpen((open) => !open)} type="button">{editorOpen ? <X size={16} /> : <Settings size={16} />}{editorOpen ? "편집 닫기" : "업체 편집"}</button>
          <button className={styles.primary} onClick={() => void sync()} disabled={syncing} type="button"><RefreshCw className={syncing ? styles.spin : undefined} size={16} />{syncing ? "동기화 중" : "나라장터 동기화"}</button>
        </div>
      </header>

      <section className={styles.filters} aria-label="조회 기간">
        <label>연도<select value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((value) => <option key={value}>{value}</option>)}</select></label>
        <div className={styles.segments} role="group" aria-label="분기">
          <button className={quarter === null ? styles.active : undefined} onClick={() => setQuarter(null)} type="button">연간</button>
          {[1, 2, 3, 4].map((value) => <button className={quarter === value ? styles.active : undefined} key={value} onClick={() => setQuarter(value)} type="button">{value}분기</button>)}
        </div>
      </section>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {loading ? <p className={styles.state}>데이터를 불러오는 중입니다.</p> : null}

      {!loading && data ? (
        <>
          <section className={styles.metrics}>
            <Metric label="조회 기간" value={data.periodLabel} />
            <Metric label="전체 공고 수" value={`${data.totalAwardCount.toLocaleString("ko-KR")}건`} />
            <Metric label="마지막 동기화" value={formatTimestamp(data.sync.lastSyncedAt)} />
            <Metric label="상태" value={data.sync.message ?? "아직 동기화하지 않았습니다."} />
          </section>
          <section className={styles.content}>
            <div className={styles.chartSection}>
              <h2>시장점유율</h2>
              <div className={styles.chartBody}>
                <div aria-label="시장점유율 원형 그래프" className={styles.pie} role="img" style={{ background: pie }}><div><strong>{data.totalAwardCount}</strong><span>전체 공고</span></div></div>
                <ol className={styles.legend}>{data.rows.map((row, index) => <li key={`${row.category}-${row.bizNo ?? "bucket"}`}><i style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span>{row.companyName}</span><strong>{row.marketSharePercent.toFixed(1)}%</strong></li>)}</ol>
              </div>
            </div>
            <div className={styles.tableSection}>
              <h2>업체별 점유율</h2>
              <div className={styles.scroll}><table><thead><tr><th>업체</th><th>분류</th><th>낙찰</th><th>점유율</th><th>지정 만료일</th></tr></thead><tbody>{data.rows.map((row) => <tr key={`${row.category}-${row.bizNo ?? "bucket"}`}><td>{row.companyName}</td><td><span className={`${styles.badge} ${styles[row.category]}`}>{CATEGORY_LABEL[row.category]}</span></td><td className={styles.number}>{row.awardCount}건</td><td className={styles.number}>{row.marketSharePercent.toFixed(1)}%</td><td>{row.designationEndDate ?? "-"}</td></tr>)}</tbody></table></div>
            </div>
          </section>
        </>
      ) : null}

      {editorOpen ? <section className={styles.editor}><h2>조달우수업체 편집</h2><div className={styles.scroll}><table><thead><tr><th>지정번호</th><th>사업자번호</th><th>업체명</th><th>지정 시작일</th><th>지정 만료일</th><th>사용</th><th /></tr></thead><tbody>{registry.map((row, index) => <tr key={row.bizNo}><td>{row.designationNo}</td><td>{row.bizNo}</td><td><input value={row.companyName} onChange={(event) => updateRegistry(setRegistry, index, { companyName: event.target.value })} /></td><td><input type="date" value={row.designationStartDate} onChange={(event) => updateRegistry(setRegistry, index, { designationStartDate: event.target.value })} /></td><td><input type="date" value={row.designationEndDate} onChange={(event) => updateRegistry(setRegistry, index, { designationEndDate: event.target.value })} /></td><td><input checked={row.enabled} onChange={(event) => updateRegistry(setRegistry, index, { enabled: event.target.checked })} type="checkbox" /></td><td><button className={styles.save} disabled={saving === row.bizNo} onClick={() => void save(row)} title="저장" type="button"><Save size={15} /></button></td></tr>)}</tbody></table></div></section> : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <article><span>{label}</span><strong>{value}</strong></article>; }

function updateRegistry(setter: React.Dispatch<React.SetStateAction<RegistryRow[]>>, index: number, patch: Partial<RegistryRow>) { setter((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)); }

function pieGradient(rows: ReportRow[]) {
  const total = rows.reduce((sum, row) => sum + row.awardCount, 0);
  if (!total) return "conic-gradient(#e5e7eb 0deg 360deg)";
  let cursor = 0;
  return `conic-gradient(${rows.map((row, index) => { const start = cursor; cursor += row.awardCount / total * 360; return `${COLORS[index % COLORS.length]} ${start}deg ${cursor}deg`; }).join(",")})`;
}

function seoulYearQuarter() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(new Date()); const value = (type: string) => Number(parts.find((part) => part.type === type)?.value); return { year: value("year"), quarter: Math.ceil(value("month") / 3) }; }

function formatTimestamp(value: string | null) { return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미수집"; }
