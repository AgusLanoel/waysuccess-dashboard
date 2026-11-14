import { useMemo, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// ───────── Formato ─────────
const usd = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }); // US$12.000 (punto de miles, sin centavos)
export const money = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `${n < 0 ? "-" : ""}US$${usd.format(Math.abs(Math.round(n)))}`);
export const num = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : usd.format(Math.round(n)));
export const pct = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `${Math.round(n * 100)}%`);
export const dec = (n: number | null | undefined, d = 1) => (n == null || !isFinite(n) ? "—" : n.toFixed(d).replace(".", ","));
export const fecha = (s: string | null | undefined) => (s ? `${+s.slice(8, 10)}/${+s.slice(5, 7)}` : "—");
export const dias = (n: number | null | undefined) => (n == null ? "—" : n === 0 ? "mismo día" : `${dec(n, n % 1 ? 1 : 0)} d`);
export const fmtKind = (k: "n" | "p" | "m", v: number | null) => (k === "p" ? pct(v) : k === "m" ? money(v) : num(v));
export const ghlContacto = (id: string | null | undefined) => (id && !id.startsWith("hoja-") ? `https://app.gohighlevel.com/v2/location/fssMXOOdUdCpuTFkSTGc/contacts/detail/${id}` : null);

// ───────── Controles ─────────
export function Seg<T extends string>({ value, options, onChange, label, className = "" }: { value: T; options: readonly (readonly [T, ReactNode])[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div className={`seg ${className}`} role="tablist" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub, delta, onClick, tone }: { label: string; value: ReactNode; sub?: ReactNode; delta?: { txt: string; cls: string }; onClick?: () => void; tone?: string }) {
  const El = onClick ? "button" : "div";
  return (
    <El className={`kpi2 ${onClick ? "clic" : ""} ${tone ?? ""}`} onClick={onClick}>
      <div className="kpi2-label">{label}</div>
      <div className="kpi2-value">{value}{delta && delta.txt !== "—" && <span className={`vs ${delta.cls}`}>{delta.txt}</span>}</div>
      {sub && <div className="kpi2-sub">{sub}</div>}
    </El>
  );
}

export const Vacio = ({ txt = "Sin datos en este período" }: { txt?: string }) => <div className="vacio">{txt}</div>;

export function Panel({ titulo, extra, children, className = "", fuente }: { titulo?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; fuente?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(titulo || extra) && (
        <header className="panel-head">
          {titulo && <h2>{titulo}{fuente && <span className="fuente"> · fuente: {fuente}</span>}</h2>}
          {extra && <div className="panel-extra">{extra}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

// ───────── Tabla con buscador, paginado y scroll interno ─────────
export interface Col<R> { k: string; label: string; get: (r: R) => ReactNode; csv?: (r: R) => string | number | null; align?: "l" | "r"; cls?: (r: R) => string }
export function Tabla<R>({ rows, cols, porPagina = 10, buscar, csv, vacio, rowCls, onRow }: {
  rows: R[]; cols: Col<R>[]; porPagina?: number; buscar?: (r: R) => string; csv?: string; vacio?: string; rowCls?: (r: R) => string; onRow?: (r: R) => void;
}) {
  const [q, setQ] = useState("");
  const [pag, setPag] = useState(0);
  const filtradas = useMemo(() => {
    if (!q || !buscar) return rows;
    const t = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const dig = q.replace(/\D/g, "");
    return rows.filter((r) => { const s = buscar(r).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); return s.includes(t) || (dig.length >= 3 && s.replace(/\D/g, "").includes(dig)); });
  }, [rows, q, buscar]);
  const paginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const p = Math.min(pag, paginas - 1);
  const vis = filtradas.slice(p * porPagina, (p + 1) * porPagina);
  const conBuscador = buscar && rows.length > 10;
  return (
    <div className="tabla">
      {(conBuscador || csv) && (
        <div className="tabla-tools">
          {conBuscador && <input className="buscar" placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => { setQ(e.target.value); setPag(0); }} />}
          {csv && <button className="link" onClick={() => exportarCSV(csv, cols, filtradas)}>Exportar CSV</button>}
        </div>
      )}
      <div className="tabla-scroll">
        <table className="t2">
          <thead><tr>{cols.map((c) => <th key={c.k} className={c.align === "l" ? "l" : ""}>{c.label}</th>)}</tr></thead>
          <tbody>
            {vis.map((r, i) => (
              <tr key={i} className={`${rowCls?.(r) ?? ""} ${onRow ? "clic" : ""}`} onClick={onRow ? () => onRow(r) : undefined}>
                {cols.map((c) => <td key={c.k} className={`${c.align === "l" ? "l" : ""} ${c.cls?.(r) ?? ""}`}>{c.get(r)}</td>)}
              </tr>
            ))}
            {!vis.length && <tr><td colSpan={cols.length} className="vacio">{vacio ?? "Sin datos en este período"}</td></tr>}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <div className="paginado">
          <button className="link" disabled={p === 0} onClick={() => setPag(p - 1)}>‹ Anterior</button>
          <span className="muted">{p + 1} / {paginas} · {filtradas.length} filas</span>
          <button className="link" disabled={p >= paginas - 1} onClick={() => setPag(p + 1)}>Siguiente ›</button>
        </div>
      )}
    </div>
  );
}
function exportarCSV<R>(nombre: string, cols: Col<R>[], rows: R[]) {
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const txt = [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(c.csv ? c.csv(r) : textoPlano(c.get(r)))).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" }));
  a.download = `${nombre}.csv`;
  a.click();
}
const textoPlano = (n: ReactNode): string => (n == null || typeof n === "boolean" ? "" : typeof n === "string" || typeof n === "number" ? String(n) : "");

// ───────── Gráficos (Recharts) ─────────
// Colores: DFY = slot 1 (azul), JessiK = slot 2 (naranja); una sola serie = neutro. Paleta validada (skill dataviz).
export const C = { dfy: "var(--dfy)", jessik: "var(--jessik)", s1: "var(--series-1)", s2: "var(--series-2)", s3: "var(--series-3)", neutro: "var(--neutro)" };
const ejes = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false, axisLine: false };
const tt = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "var(--text)" }, itemStyle: { color: "var(--text-2)" }, cursor: { fill: "var(--surface-2)" } };
export interface Serie { key: string; label: string; color: string; stack?: string }
type Fmt = (n: number) => string;

export function Barras({ data, x, series, fmt = num, alto = "100%", horizontal = false }: { data: Record<string, unknown>[]; x: string; series: Serie[]; fmt?: Fmt; alto?: number | string; horizontal?: boolean }) {
  if (!data.length || data.every((d) => series.every((s) => !Number(d[s.key])))) return <Vacio />;
  return (
    <ResponsiveContainer width="100%" height={alto as number}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 6, right: 12, left: horizontal ? 4 : 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid stroke="var(--grid)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? <><XAxis type="number" {...ejes} tickFormatter={fmt} /><YAxis type="category" dataKey={x} {...ejes} width={150} /></>
          : <><XAxis dataKey={x} {...ejes} /><YAxis {...ejes} tickFormatter={fmt} width={56} /></>}
        <Tooltip {...tt} formatter={(v: number, n: string) => [fmt(v), n]} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-2)" }} iconType="circle" iconSize={8} />}
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={s.stack} radius={s.stack ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Lineas({ data, x, series, fmt = pct, alto = "100%" }: { data: Record<string, unknown>[]; x: string; series: Serie[]; fmt?: Fmt; alto?: number | string }) {
  if (!data.length || data.every((d) => series.every((s) => d[s.key] == null))) return <Vacio />;
  return (
    <ResponsiveContainer width="100%" height={alto as number}>
      <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={x} {...ejes} />
        <YAxis {...ejes} tickFormatter={fmt} width={48} />
        <Tooltip {...tt} cursor={{ stroke: "var(--axis)" }} formatter={(v: number, n: string) => [fmt(v), n]} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-2)" }} iconType="circle" iconSize={8} />}
        {series.map((s) => <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--surface)" }} activeDot={{ r: 5 }} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Barra de progreso (Metas): verde ≥ 100%, ámbar 70–99%, rojo < 70%
export function Progreso({ v }: { v: number | null }) {
  if (v == null) return <span className="muted">—</span>;
  const cls = v >= 1 ? "ok" : v >= 0.7 ? "warn" : "bad";
  return <span className="prog"><span className={`prog-bar ${cls}`} style={{ width: `${Math.min(100, v * 100)}%` }} /><span className="prog-n">{pct(v)}</span></span>;
}

// Chip de producto
export const ChipProd = ({ p }: { p: string | null | undefined }) => (p === "DFY" ? <span className="chip chip-dfy">DFY</span> : p === "JessiK" ? <span className="chip chip-jessik">JessiK</span> : <span className="muted">—</span>);
