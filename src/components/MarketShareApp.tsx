"use client";

import { Download, RefreshCw, Save, Settings, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./MarketShareApp.module.css";

type Category = "excellent" | "non_excellent" | "cooperative";
type ReportRow = { companyName: string; bizNo: string | null; designationEndDate: string | null; category: Category; awardCount: number; marketSharePercent: number };
type RegistryRow = { bizNo: string; companyName: string; designationNo: string; designationStartDate: string; designationEndDate: string; enabled: boolean; displayOrder: number };
type ReportResponse = {
  periodLabel: string;
  totalAwardCount: number;
  rows: ReportRow[];
  registry: RegistryRow[];
  basis: "award" | "contract";
  region: "all" | "busan";
  sync: { status: string; lastSyncedAt: string | null; message: string | null };
};
type Basis = "award" | "contract";
type Region = "all" | "busan";

const COLORS = ["#156f4a", "#d97706", "#2563eb", "#be123c", "#7c3aed", "#0891b2", "#4d7c0f", "#c2410c", "#4338ca", "#0f766e", "#a16207", "#0369a1", "#9f1239", "#6d28d9", "#15803d", "#b45309", "#1d4ed8", "#b91c1c", "#5b21b6", "#0e7490", "#3f6212", "#9a3412", "#3730a3", "#047857"];
const CATEGORY_LABEL: Record<Category, string> = { excellent: "\uc870\ub2ec\uc6b0\uc218", non_excellent: "\uc870\ub2ec\uc6b0\uc218X", cooperative: "\ud611\ub3d9\uc870\ud569" };

export function MarketShareApp() {
  const current = useMemo(() => seoulYearQuarter(), []);
  const [year, setYear] = useState(current.year);
  const [quarter, setQuarter] = useState<number | null>(current.quarter);
  const [basis, setBasis] = useState<Basis>("award");
  const [region, setRegion] = useState<Region>("all");
  const [data, setData] = useState<ReportResponse | null>(null);
  const [registry, setRegistry] = useState<RegistryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ year: String(year), basis, region });
    if (quarter !== null) params.set("quarter", String(quarter));
    return params.toString();
  }, [basis, quarter, region, year]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/building-control-market/report?${query}`);
      const payload = (await response.json()) as ReportResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "\ubcf4\uace0\uc11c\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.");
      setData(payload);
      setRegistry(payload.registry);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "\ubcf4\uace0\uc11c\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.");
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
      const payload = (await response.json()) as { error?: string; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? payload.error ?? "\ub3d9\uae30\ud654\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "\ub3d9\uae30\ud654\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.");
    } finally {
      setSyncing(false);
    }
  }

  async function save(row: RegistryRow) {
    setSaving(row.bizNo);
    setError(null);
    try {
      const response = await fetch("/api/building-control-market/registry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      const payload = (await response.json()) as { registry?: RegistryRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "\uc5c5\uccb4 \uc815\ubcf4\ub97c \uc800\uc7a5\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.");
      if (payload.registry) setRegistry(payload.registry);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "\uc5c5\uccb4 \uc815\ubcf4\ub97c \uc800\uc7a5\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.");
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
          <h1>\ube4c\ub529\uc790\ub3d9\uc81c\uc5b4 \uc2dc\uc7a5\uc810\uc720\uc728</h1>
          <p>\ud48d\ubaa9\ubc88\ud638 39121801 / 3912180101 \u00b7 {basis === "award" ? "\ub099\ucc30\uc77c" : "\uacc4\uc57d\uccb4\uacb0\uc77c"} \uae30\uc900 {region === "all" ? "\uc804\uad6d" : "\ubd80\uc0b0"} \ud3d0\ub9e8</p>
        </div>
        <div className={styles.toolbar}>
          <button onClick={() => void load()} disabled={loading} title="\uc0c8\ub85c\uace0\uce68" type="button"><RefreshCw size={16} />\uc0c8\ub85c\uace0\uce68</button>
          <a className={styles.export} href={`/api/building-control-market/export?${query}`}><Download size={16} />\uc5c5\uc20d \ub2e4\uc6b4\ub85c\ub4dc</a>
          <button onClick={() => setEditorOpen((open) => !open)} type="button">{editorOpen ? <X size={16} /> : <Settings size={16} />}{editorOpen ? "\ud3c9\uc9d1 \ub2eb\uae30" : "\uc5c5\uccb4 \ud3c9\uc9d1"}</button>
          <button className={styles.primary} onClick={() => void sync()} disabled={syncing} type="button"><RefreshCw className={syncing ? styles.spin : undefined} size={16} />{syncing ? "\ub3d9\uae30\ud654 \uc911" : "\ub098\ub77c\uc7a5\ud130 \ub3d9\uae30\ud654"}</button>
        </div>
      </header>

      <section className={styles.filters} aria-label="\uc870\ud68c \uc870\uac74">
        <div className={styles.segments} role="group" aria-label="\uae30\uc900">
          <span className={styles.segmentLabel}>\uae30\uc900</span>
          <button className={basis === "award" ? styles.active : undefined} onClick={() => setBasis("award")} type="button">\uacf5\uace0 \uae30\uc900</button>
          <button className={basis === "contract" ? styles.active : undefined} onClick={() => setBasis("contract")} type="button">\uacc4\uc57d \uae30\uc900</button>
        </div>
        <div className={styles.segments} role="group" aria-label="\uc9c0\uc5ed">
          <span className={styles.segmentLabel}>\uc9c0\uc5ed</span>
          <button className={region === "all" ? styles.active : undefined} onClick={() => setRegion("all")} type="button">\uc804\uad6d</button>
          <button className={region === "busan" ? styles.active : undefined} onClick={() => setRegion("busan")} type="button">\ubd80\uc0b0</button>
        </div>
        <div className={styles.segments} role="group" aria-label="\ubd84\uae30">
          <label className={styles.segmentLabel}>\uc5f0\ub3c4</label>
          <select value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((value) => <option key={value}>{value}</option>)}</select>
          <button className={quarter === null ? styles.active : undefined} onClick={() => setQuarter(null)} type="button">\uc5f0\uac04</button>
          {[1, 2, 3, 4].map((value) => <button className={quarter === value ? styles.active : undefined} key={value} onClick={() => setQuarter(value)} type="button">{value}\ubd84\uae30</button>)}
        </div>
      </section>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {loading ? <p className={styles.state}>\ub370\uc774\ud130\ub97c \ubd88\ub7ec\uc624\ub294 \uc911\uc785\ub2c8\ub2e4.</p> : null}

      {!loading && data ? (
        <>
          <section className={styles.metrics}>
            <Metric label="\uc870\ud68c \uae30\uac04" value={data.periodLabel} />
            <Metric label={basis === "award" ? "\uc804\uccb4 \uacf5\uace0 \uc218" : "\uc804\uccb4 \uacc4\uc57d \uc218"} value={`${data.totalAwardCount.toLocaleString("ko-KR")}\uac74`} />
            <Metric label="\uc9c0\uc5ed \ud3d0\ub9e8" value={region === "all" ? "\uc804\uad6d" : "\ubd80\uc0b0"} />
            <Metric label="\ub9c8\uc9c0\ub9c9 \ub3d9\uae30\ud654" value={formatTimestamp(data.sync.lastSyncedAt)} />
            <Metric label="\uc0c1\ud0dc" value={data.sync.message ?? "\uc544\uc9c1 \ub3d9\uae30\ud654\ud558\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4."} />
          </section>
          <section className={styles.content}>
            <div className={styles.chartSection}>
              <h2>\uc2dc\uc7a5\uc810\uc720\uc728</h2>
              <div className={styles.chartBody}>
                <div aria-label="\uc2dc\uc7a5\uc810\uc720\uc728 \uc6d0\ud615 \uadf8\ub798\ud504" className={styles.pie} role="img" style={{ background: pie }}><div><strong>{data.totalAwardCount}</strong><span>{basis === "award" ? "\uc804\uccb4 \uacf5\uace0" : "\uc804\uccb4 \uacc4\uc57d"}</span></div></div>
                <ol className={styles.legend}>{data.rows.map((row, index) => <li key={`${row.category}-${row.bizNo ?? "bucket"}`}><i style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span>{row.companyName}</span><strong>{row.marketSharePercent.toFixed(1)}%</strong></li>)}</ol>
              </div>
            </div>
            <div className={styles.tableSection}>
              <h2>\uc5c5\uccb4\ubcc4 \uc810\uc720\uc728</h2>
              <div className={styles.scroll}><table><thead><tr><th>\uc5c5\uccb4</th><th>\ubd84\ub958</th><th>{basis === "award" ? "\ub099\ucc30" : "\uacc4\uc57d"}</th><th>\uc810\uc720\uc728</th><th>\uc9c0\uc815 \ub9c8\ub8cc\uc77c</th></tr></thead><tbody>{data.rows.map((row) => <tr key={`${row.category}-${row.bizNo ?? "bucket"}`}><td>{row.companyName}</td><td><span className={`${styles.badge} ${styles[row.category]}`}>{CATEGORY_LABEL[row.category]}</span></td><td className={styles.number}>{row.awardCount}\uac74</td><td className={styles.number}>{row.marketSharePercent.toFixed(1)}%</td><td>{row.designationEndDate ?? "-"}</td></tr>)}</tbody></table></div>
            </div>
          </section>
        </>
      ) : null}

      {editorOpen ? <section className={styles.editor}><h2>\uc870\ub2ec\uc6b0\uc218\uc5c5\uccb4 \ud3c9\uc9d1</h2><div className={styles.scroll}><table><thead><tr><th>\uc9c0\uc815\ubc88\ud638</th><th>\uc0ac\uc5c5\uc790\ubc88\ud638</th><th>\uc5c5\uccb4\uba85</th><th>\uc9c0\uc815 \uc2dc\uc791\uc77c</th><th>\uc9c0\uc815 \ub9c8\ub8cc\uc77c</th><th>\uc0ac\uc6a9</th><th /></tr></thead><tbody>{registry.map((row, index) => <tr key={row.bizNo}><td>{row.designationNo}</td><td>{row.bizNo}</td><td><input value={row.companyName} onChange={(event) => updateRegistry(setRegistry, index, { companyName: event.target.value })} /></td><td><input type="date" value={row.designationStartDate} onChange={(event) => updateRegistry(setRegistry, index, { designationStartDate: event.target.value })} /></td><td><input type="date" value={row.designationEndDate} onChange={(event) => updateRegistry(setRegistry, index, { designationEndDate: event.target.value })} /></td><td><input checked={row.enabled} onChange={(event) => updateRegistry(setRegistry, index, { enabled: event.target.checked })} type="checkbox" /></td><td><button className={styles.save} disabled={saving === row.bizNo} onClick={() => void save(row)} title="\uc800\uc7a5" type="button"><Save size={15} /></button></td></tr>)}</tbody></table></div></section> : null}
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

function formatTimestamp(value: string | null) { return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "\ubbf8\uc218\uc9d1"; }
