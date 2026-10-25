import { useEffect, useState } from "react";
import { supabase, type EmpresaRow } from "../lib/supabase";
import { money, num, pct, ratio } from "../lib/format";

const GRUPOS = ["Comercial", "Marketing", "Ads", "Orgánico", "Referidos", "Afiliados"] as const;
const PRODUCTOS: [string, string][] = [
  ["Todos", "Todos"],
  ["DFY", "DFY $30k"],
  ["JessiK", "JessiK"],
];

type Kind = "n" | "p" | "m";
// Mismas filas y fórmulas que la "Vista empresa" del sheet comercial
const FILAS: { label: string; kind: Kind; get: (r: EmpresaRow) => number | null }[] = [
  { label: "Agendas brutas", kind: "n", get: (r) => r.agendas },
  { label: "Asistencias", kind: "n", get: (r) => r.asistencias },
  { label: "% Asistencia (÷ agendas)", kind: "p", get: (r) => ratio(r.asistencias, r.agendas) },
  { label: "Asistencias calificadas", kind: "n", get: (r) => r.asistencias_calificadas },
  { label: "% Asistencias calificadas", kind: "p", get: (r) => ratio(r.asistencias_calificadas, r.asistencias) },
  { label: "Ofertas", kind: "n", get: (r) => r.ofertas },
  { label: "% Ofertas", kind: "p", get: (r) => ratio(r.ofertas, r.asistencias) },
  { label: "Cierres", kind: "n", get: (r) => r.cierres },
  { label: "Cierres en seguimiento", kind: "n", get: (r) => r.cierres_seguimiento },
  { label: "Cierres totales", kind: "n", get: (r) => r.cierres_totales },
  { label: "Clientes nuevos", kind: "n", get: (r) => r.clientes_nuevos },
  { label: "% Cierre (÷ asistencias)", kind: "p", get: (r) => ratio(r.cierres, r.asistencias) },
  { label: "Vendido", kind: "m", get: (r) => Number(r.vendido) },
  { label: "Cobrado", kind: "m", get: (r) => Number(r.cobrado) },
  { label: "Ticket promedio", kind: "m", get: (r) => (r.cierres_totales ? Number(r.cobrado) / r.cierres_totales : null) },
  { label: "Comisiones", kind: "m", get: (r) => Number(r.comisiones) },
];

const fmt = (k: Kind, v: number | null) => (k === "p" ? pct(v, 0) : k === "m" ? money(v) : num(v));

// Cantidades: variación %; porcentajes: diferencia en puntos
function vs(k: Kind, a: number | null, b: number | null): { txt: string; cls: string } {
  if (a == null || b == null) return { txt: "—", cls: "" };
  if (k === "p") {
    const d = (a - b) * 100;
    if (Math.abs(d) < 0.5) return { txt: "=", cls: "" };
    return { txt: `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)} pp`, cls: d > 0 ? "up" : "down" };
  }
  if (!b) return { txt: a ? "nuevo" : "—", cls: a ? "up" : "" };
  const d = (a - b) / b;
  if (Math.abs(d) < 0.005) return { txt: "=", cls: "" };
  return { txt: `${d > 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(0)}%`, cls: d > 0 ? "up" : "down" };
}

export function VistaEmpresa({ from, to, reloadKey }: { from: string; to: string; reloadKey: number }) {
  const [producto, setProducto] = useState("Todos");
  const [rows, setRows] = useState<EmpresaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase.rpc("comercial_empresa", { p_from: from, p_to: to, p_producto: producto }).then(({ data, error }) => {
      if (!alive) return;
      setErr(error?.message ?? null);
      setRows((data as EmpresaRow[]) ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [from, to, producto, reloadKey]);

  const get = (g: string, periodo: string) => rows.find((r) => r.grupo === g && r.periodo === periodo);

  return (
    <section className="card table-card" aria-busy={loading}>
      <div className="table-head">
        <h2 className="section-title">Vista empresa · resumen por fuente</h2>
        <div className="seg" role="tablist" aria-label="Producto">
          {PRODUCTOS.map(([k, l]) => (
            <button key={k} className={producto === k ? "on" : ""} onClick={() => setProducto(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="error">Error: {err}</p>}
      <div className="table-wrap">
        <table className="empresa">
          <thead>
            <tr>
              <th className="name">Métrica</th>
              {GRUPOS.map((g) => (
                <th key={g} colSpan={2} className={`grp grp-${g === "Orgánico" ? "organico" : g.toLowerCase()}`}>
                  {g}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS.map((f) => (
              <tr key={f.label}>
                <td className="name">{f.label}</td>
                {GRUPOS.map((g) => {
                  const a = get(g, "actual");
                  const b = get(g, "anterior");
                  const va = a ? f.get(a) : null;
                  const d = vs(f.kind, va, b ? f.get(b) : null);
                  return [
                    <td key={`${g}-v`}>{fmt(f.kind, va)}</td>,
                    <td key={`${g}-d`} className={`vs ${d.cls}`}>{d.txt}</td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Comparación contra el período anterior del mismo largo. Comercial = todas las fuentes; Marketing = Ads + Orgánico. Fuente: campo “Fuente” del contacto en GHL
        (Referidos / Afiliados); si no, Ads cuando vino de un anuncio, si no Orgánico. Antes del 21-10, la columna “Origen” de la hoja. Cierres = primera llamada en el
        mismo mes; en seguimiento = de meses anteriores. % Cierre = cierres ÷ asistencias. Ticket = cobrado ÷ cierres totales.
      </p>
    </section>
  );
}
