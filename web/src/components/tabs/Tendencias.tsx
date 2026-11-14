import { useMemo, useState } from "react";
import { agendasPor, bloque, desglose, semanal, tasa, type DashDatos, type Filtros } from "../../lib/metricas";
import { Barras, C, Lineas, Panel, Tabla, Vacio, money, num, pct } from "../ui";

const OTROS = [
  ["g1", "Embudo"], ["g9", "% asistencias calificadas"], ["g10", "% ofertas realizadas"], ["g11", "Ticket promedio"], ["g12", "% agendas calificadas"],
  ["g13", "% cobrado sobre vendido"], ["g14", "Participación de agendas"], ["g15", "% cierres en seguimiento"], ["g16", "Agendas por closer"],
  ["g17", "Agendas por fuente"], ["g18", "Agendas por producto"], ["g19", "Agendas por industria"], ["ind", "Desglose por industria"], ["pais", "Desglose por país"],
] as const;
type Otro = (typeof OTROS)[number][0];

export function Tendencias({ d, f, from, to }: { d: DashDatos; f: Filtros; from: string; to: string }) {
  const [otro, setOtro] = useState<Otro>("g1");
  const sem = useMemo(() => semanal(d, f, from, to), [d, f, from, to]);
  const data = sem.map((s) => ({ ...s, x: s.label }));
  return (
    <div className="fila-60-40 alto">
      <div className="grid2x2">
        <Panel titulo="% asistencia y % cierre"><div className="grafico"><Lineas data={data} x="x" series={[{ key: "pct_asistencia", label: "% asistencia", color: C.s1 }, { key: "pct_cierre", label: "% cierre", color: C.s2 }]} /></div></Panel>
        <Panel titulo="Volumen"><div className="grafico"><Barras data={data} x="x" series={[{ key: "agendas", label: "Agendas", color: C.s1 }, { key: "asistencias", label: "Asistencias", color: C.s2 }, { key: "asistencias_calificadas", label: "Asist. calificadas", color: C.s3 }]} /></div></Panel>
        <Panel titulo="Vendido vs cobrado"><div className="grafico"><Barras data={data} x="x" fmt={money} series={[{ key: "vendido", label: "Vendido", color: C.s1 }, { key: "cobrado", label: "Cobrado", color: C.s2, stack: "c" }, { key: "cobrado_seguimiento", label: "Cobrado en seguimiento", color: C.s3, stack: "c" }]} /></div></Panel>
        <Panel titulo="Ofertas y cierres"><div className="grafico"><Barras data={data} x="x" series={[{ key: "ofertas", label: "Ofertas", color: C.s1 }, { key: "cierres_totales", label: "Cierres", color: C.s2 }]} /></div></Panel>
      </div>
      <div className="tab-col">
        <Panel titulo="Semanal">
          <Tabla rows={sem} porPagina={6} cols={[
            { k: "n", label: "Sem.", align: "l", get: (s) => `${s.n} · ${s.label}` },
            { k: "a", label: "Agendas", get: (s) => num(s.agendas) },
            { k: "pa", label: "% asist.", get: (s) => pct(s.pct_asistencia) },
            { k: "ac", label: "Asist. calif.", get: (s) => num(s.asistencias_calificadas) },
            { k: "o", label: "Ofertas", get: (s) => num(s.ofertas) },
            { k: "c", label: "Cierres", get: (s) => num(s.cierres_totales) },
            { k: "pc", label: "% cierre", get: (s) => pct(s.pct_cierre) },
            { k: "t", label: "Ticket", get: (s) => money(s.ticket) },
            { k: "v", label: "Vendido", get: (s) => money(s.vendido) },
            { k: "co", label: "Cobrado", get: (s) => money(s.cobrado_total) },
            { k: "pco", label: "% cobro", get: (s) => pct(tasa(s.cobrado, s.vendido)) },
          ]} />
        </Panel>
        <Panel className="lleno" titulo="Ver otro gráfico" extra={
          <select className="select" value={otro} onChange={(e) => setOtro(e.target.value as Otro)} aria-label="Ver otro gráfico">
            {OTROS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>}>
          <Otro d={d} f={f} from={from} to={to} k={otro} data={data} />
        </Panel>
      </div>
    </div>
  );
}

function Otro({ d, f, from, to, k, data }: { d: DashDatos; f: Filtros; from: string; to: string; k: Otro; data: Record<string, unknown>[] }) {
  const linea = (key: string, label: string, fmt = pct) => <div className="grafico"><Lineas data={data} x="x" fmt={fmt} series={[{ key, label, color: C.neutro }]} /></div>;
  const por = (dim: "closer" | "fuente" | "producto" | "industria") => {
    const rows = agendasPor(d, f, from, to, dim).map((r) => ({ k: r.k, n: r.n }));
    return <div className="grafico"><Barras horizontal data={rows} x="k" series={[{ key: "n", label: "Agendas", color: C.neutro }]} /></div>;
  };
  switch (k) {
    case "g1": {
      const b = bloque(d, f, from, to);
      const pasos = [["Agendas", b.agendas], ["Asistencias", b.asistencias], ["Asist. calificadas", b.asistencias_calificadas], ["Ofertas", b.ofertas], ["Cierres", b.cierres_totales]] as const;
      if (!b.agendas && !b.asistencias) return <Vacio />;
      const max = Math.max(...pasos.map((p) => p[1]), 1);
      return (
        <ul className="embudo2">
          {pasos.map(([l, n], i) => (
            <li key={l}><span className="l">{l}</span><span className="pista"><span style={{ width: `${(n / max) * 100}%` }} /></span><b>{num(n)}</b><span className="muted">{i ? pct(tasa(n, pasos[i - 1][1])) : ""}</span></li>
          ))}
        </ul>
      );
    }
    case "g9": return linea("pct_asist_calificadas", "% asistencias calificadas");
    case "g10": return linea("pct_ofertas", "% ofertas");
    case "g11": return linea("ticket", "Ticket promedio", money);
    case "g12": return linea("pct_agendas_calificadas", "% agendas calificadas");
    case "g13": return linea("pct_recoleccion", "% cobrado sobre vendido");
    case "g14": return linea("participacion", "Participación de agendas");
    case "g15": return linea("pct_cierres_seguimiento", "% cierres en seguimiento");
    case "g16": return por("closer");
    case "g17": return por("fuente");
    case "g18": return por("producto");
    case "g19": return por("industria");
    case "ind":
    case "pais": {
      const rows = desglose(d, f, from, to, k === "ind" ? "industria" : "pais");
      return <Tabla rows={rows} porPagina={9} cols={[{ k: "k", label: k === "ind" ? "Industria" : "País", align: "l", get: (r) => r.k }, { k: "l", label: "Llamadas", get: (r) => num(r.llamadas) }, { k: "v", label: "Vendidos", get: (r) => num(r.vendidos) }]} />;
    }
  }
}
