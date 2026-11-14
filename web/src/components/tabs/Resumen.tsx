import { useMemo } from "react";
import { FILAS_RESUMEN, FUENTES, bloque, leads, periodoAnterior, variacion, type Bloque, type DashDatos, type Filtros } from "../../lib/metricas";
import { fmtKind, Panel } from "../ui";

// Resumen = solo la "Vista empresa" (aprobada por Luca): Comercial + una columna por fuente, filas en el orden del Tracker.
export function Resumen({ d, f, from, to }: { d: DashDatos; f: Filtros; from: string; to: string }) {
  const { cols, ant } = useMemo(() => {
    const L = leads(d);
    const ant = periodoAnterior(from, to);
    const grupos = [{ g: "Comercial", fuente: "Todas" }, ...FUENTES.map((x) => ({ g: x, fuente: x }))]
      .filter((x) => f.fuente === "Todas" || x.g === "Comercial" || x.fuente === f.fuente);
    const cols = grupos.map(({ g, fuente }) => {
      const ff = { ...f, fuente: fuente === "Todas" ? f.fuente : fuente };
      const a = bloque(d, ff, from, to, {}, L);
      const b = ant ? bloque(d, ff, ant[0], ant[1], {}, L) : null;
      return { g, a, b };
    }).filter((c) => c.g === "Comercial" || vacio(c.a) === false); // fuentes en cero se ocultan
    return { cols, ant };
  }, [d, f, from, to]);

  return (
    <Panel className="lleno" titulo="Vista empresa" extra={<span className="muted">{ant ? `Variación contra ${ant[0].slice(8)}/${ant[0].slice(5, 7)} – ${ant[1].slice(8)}/${ant[1].slice(5, 7)}` : "Sin comparación: el período anterior empieza antes del 01/10/2026"}</span>}>
      <div className="tabla-scroll">
        <table className="t2 empresa2">
          <thead>
            <tr>
              <th className="l">Métrica</th>
              {cols.map((c) => <th key={c.g} colSpan={ant ? 2 : 1} className={c.g === "Comercial" ? "col-total" : ""}>{c.g}</th>)}
            </tr>
          </thead>
          <tbody>
            {FILAS_RESUMEN.map((fila) => (
              <tr key={fila.label} className={fila.label.startsWith("Cobrado") ? "fila-cobro" : ""}>
                <td className="l">{fila.label}</td>
                {cols.map((c) => {
                  const va = fila.get(c.a);
                  const v = variacion(fila.kind, va, c.b ? fila.get(c.b) : null);
                  return [
                    <td key={c.g} className={c.g === "Comercial" ? "col-total" : ""}>{fmtKind(fila.kind, va)}</td>,
                    ant && <td key={c.g + "v"} className={`vs ${v.cls}`}>{v.txt}</td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="nota">Un lead cuenta una vez en agendas, asistencias y ofertas, con su primera llamada. Cierres por fecha de cierre (Won en GHL). Cobrado en seguimiento: fuente Tracker. Ticket = cobrado ÷ cierres totales. Comisión = 3% de lo cobrado.</p>
    </Panel>
  );
}
const vacio = (b: Bloque) => !(b.agendas || b.asistencias || b.ofertas || b.cierres_totales || b.cobrado_seguimiento);
