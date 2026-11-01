// 01-11-2026: lista de agendas calificadas del período (reemplaza los gráficos por día en Ads).
// Misma regla que el KPI: primera agenda calificada por persona, solo tráfico pago, día en hora del Pacífico.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

interface Row {
  contact_id: string;
  agendada_at: string;
  llamada_at: string | null;
  estado: string | null;
  tipo: "DFY" | "JessiK";
  nombre: string | null;
  email: string | null;
  phone: string | null;
  nicho: string | null;
  ingresos: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  timezone: string | null;
}

const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const COLS: [string, (r: Row) => string, string?][] = [
  ["Agendó", (r) => fecha(r.agendada_at)],
  ["Nombre", (r) => r.nombre ?? "—", "name"],
  ["Tipo", (r) => r.tipo],
  ["Llamada", (r) => fecha(r.llamada_at)],
  ["Email", (r) => r.email ?? "—"],
  ["Nicho", (r) => r.nicho ?? "—"],
  ["Ingresos", (r) => r.ingresos ?? "—"],
  ["Teléfono", (r) => r.phone ?? "—"],
  ["utm_medium", (r) => r.utm_medium ?? "—"],
  ["utm_campaign", (r) => r.utm_campaign ?? "—", "long"],
  ["utm_content", (r) => r.utm_content ?? "—"],
  ["utm_source", (r) => r.utm_source ?? "—"],
  ["Zona horaria", (r) => r.timezone ?? "—"],
];

export function AgendasCalificadas({ from, to, reloadKey }: { from: string; to: string; reloadKey: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase.rpc("agendas_calificadas", { p_from: from, p_to: to }).then(({ data, error }) => {
      if (!alive) return;
      setErr(error?.message ?? null);
      setRows((data ?? []) as Row[]);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [from, to, reloadKey]);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => COLS.some(([, get]) => get(r).toLowerCase().includes(t))) : rows;
  }, [rows, q]);

  const dfy = rows.filter((r) => r.tipo === "DFY").length;

  return (
    <section className="card table-card agendas-card" aria-busy={loading}>
      <div className="table-head">
        <div className="agendas-title">
          <span className="chart-title">Agendas calificadas</span>
          <span className="count-pill">{rows.length}</span>
          <span className="muted small">{dfy} DFY · {rows.length - dfy} JessiK</span>
        </div>
        <input className="search" type="search" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <p className="error">Error: {err}</p>}
      <div className="table-wrap agendas-wrap">
        <table className="agendas">
          <thead>
            <tr>{COLS.map(([l, , cls]) => <th key={l} className={cls}>{l}</th>)}</tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.contact_id}>
                {COLS.map(([l, get, cls]) => (
                  <td key={l} className={cls} title={cls === "long" ? get(r) : undefined}>
                    {l === "Tipo" ? <span className={`tipo ${r.tipo === "DFY" ? "t-dfy" : "t-jessik"}`}>{r.tipo}</span> : get(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="empty">Sin agendas calificadas en este período.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
