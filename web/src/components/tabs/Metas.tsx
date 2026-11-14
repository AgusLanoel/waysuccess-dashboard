import { useMemo, useState } from "react";
import { closers, metas, prorratear, type DashDatos, type Filtros } from "../../lib/metricas";
import { Barras, C, Kpi, Panel, Progreso, dec, fmtKind, num, pct } from "../ui";

export function Metas({ d, f, from, to }: { d: DashDatos; f: Filtros; from: string; to: string }) {
  const [verPlan, setVerPlan] = useState(false);
  const m = useMemo(() => metas(d, f, from, to), [d, f, from, to]);
  const cl = useMemo(() => closers(d, f, from, to), [d, f, from, to]);
  if (!d.tracker.proyecciones) return <div className="vacio">Conectar Tracker para ver este bloque (la hoja Proyecciones solo la ven owner y finanzas).</div>;
  const avance = Object.entries(m.metasCloser).map(([c, mc]) => ({
    k: c, real: cl.find((x) => x.closer === c)?.cierres_totales ?? 0, meta: Math.round(prorratear(from < d.desde ? d.desde : from, to, () => mc.cierres) * 10) / 10,
  }));
  const semaforo = m.estado === "En ruta" ? "ok" : m.estado === "En riesgo" ? "warn" : "bad";
  return (
    <div className="tab-col">
      <div className="kpis5">
        <Kpi label="Alineación con la proyección" value={pct(m.alineacion)} sub="cierres reales ÷ proyectados a la fecha" />
        <Kpi label="Días transcurridos" value={`${m.pasados} / ${m.total}`} />
        <Kpi label="Estado" value={<span className={`semaforo ${semaforo}`}>{m.estado}</span>} />
      </div>
      <div className="fila-60-40">
        <Panel className="lleno" titulo="Actual vs proyección" fuente="Proyecciones (plan mensual prorrateado por día)">
          <div className="tabla-scroll">
            <table className="t2">
              <thead><tr><th className="l">Métrica</th><th>Actual</th><th>Proyección</th><th>Diferencia</th><th className="l">% logrado</th></tr></thead>
              <tbody>
                {m.filas.map((x) => {
                  const dif = x.actual != null && x.meta != null ? x.actual - x.meta : null;
                  const log = x.actual != null && x.meta ? x.actual / x.meta : null;
                  return (
                    <tr key={x.label}>
                      <td className="l">{x.label}</td>
                      <td>{fmtKind(x.kind, x.actual)}</td>
                      <td>{x.meta == null ? "—" : x.kind === "n" ? dec(x.meta, 0) : fmtKind(x.kind, x.meta)}</td>
                      <td className={dif == null ? "" : dif >= 0 ? "up" : "down"}>{dif == null ? "—" : x.kind === "p" ? `${dif >= 0 ? "+" : ""}${Math.round(dif * 100)} pp` : `${dif > 0 ? "+" : ""}${fmtKind(x.kind, dif)}`}</td>
                      <td className="l"><Progreso v={log} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="tab-col">
          <Panel titulo="Meta Ads por closer" fuente="Proyecciones 34-39">
            <table className="t2">
              <thead><tr><th className="l">Closer</th><th>Cierres</th><th>Agendas</th><th>Asistencias</th><th>Ofertas</th></tr></thead>
              <tbody>{Object.entries(m.metasCloser).map(([c, x]) => <tr key={c}><td className="l">{c}</td><td>{num(x.cierres)}</td><td>{num(x.agendas)}</td><td>{num(x.asistencias)}</td><td>{num(x.ofertas)}</td></tr>)}</tbody>
            </table>
            <p className="nota">Meta mensual (solo Ads) [A CONFIRMAR].</p>
          </Panel>
          <Panel className="lleno" titulo="Avance por closer">
            <div className="grafico"><Barras horizontal data={avance} x="k" series={[{ key: "real", label: "Cierres reales", color: C.s1 }, { key: "meta", label: "Meta del período", color: C.neutro }]} /></div>
          </Panel>
        </div>
      </div>
      <button className="link desplegable" onClick={() => setVerPlan(!verPlan)}>{verPlan ? "▾" : "▸"} Plan mensual por fases</button>
      {verPlan && (
        <div className="overlay" onClick={() => setVerPlan(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="panel-head"><h2>Plan mensual por fases</h2><button className="link" onClick={() => setVerPlan(false)}>Cerrar ✕</button></header>
            <div className="tabla-scroll">
              <table className="t2">
                <thead><tr><th className="l">Mes</th><th>Fase</th><th>Cierres Ads</th><th>Orgánico</th><th>Referidos</th><th>Afiliados</th><th>Comercial</th><th>Agendas necesarias</th><th>Asistencias necesarias</th><th className="l">Gates</th></tr></thead>
                <tbody>{m.plan.map((p) => <tr key={p.ym}><td className="l">{p.mes}</td><td>{p.fase}</td><td>{num(p.ads)}</td><td>{num(p.organico)}</td><td>{num(p.referidos)}</td><td>{num(p.afiliados)}</td><td><b>{num(p.comercial)}</b></td><td>{num(p.agendas)}</td><td>{num(p.asistencias)}</td><td className="l">{p.gates}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
