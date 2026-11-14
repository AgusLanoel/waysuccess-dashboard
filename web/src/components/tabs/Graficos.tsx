import { useMemo, useState } from "react";
import type { DashDatos, Filtros } from "../../lib/metricas";
import { fuentesT, mensualT, objecionesT, type CtxTracker } from "../../lib/metricasTracker";
import { Barras, BarrasMes, Dona, Lineas, Panel, Seg, Vacio, money, num } from "../ui";

// Pestaña "Gráficos" = hoja "Gráficos CVO" del Tracker (15-11). Vista ejecutiva: grilla 3×3 sin scroll de página.
// Evolución mensual desde oct-26 hasta el mes del fin del período (último mes resaltado); Objeciones y Fuentes usan el período elegido.
export function Graficos({ d, ctx, f, from, to, pais }: { d: DashDatos; ctx: CtxTracker; f: Filtros; from: string; to: string; pais: string }) {
  const m = useMemo(() => mensualT(d, ctx, f, to, pais), [d, ctx, f, to, pais]);
  const [extra, setExtra] = useState<"objeciones" | "fuentes">("objeciones");
  const [soloCal, setSoloCal] = useState(false);
  const obj = useMemo(() => objecionesT(ctx, f, from, to, soloCal, pais), [ctx, f, from, to, soloCal, pais]);
  const fuentes = useMemo(() => fuentesT(ctx, f, from, to, pais), [ctx, f, from, to, pais]);
  const [fuenteSel, setFuenteSel] = useState<string | null>(null);
  const fs = fuentes.find((x) => x.fuente === fuenteSel) ?? fuentes[0];

  return (
    <div className="tab-col">
      <div className="grid3x3">
        <Panel titulo="Vendido por mes"><div className="grafico"><BarrasMes data={m} fmt={money} meta="meta_vendido" series={[{ key: "vendido", label: "Vendido", color: "tono:3" }]} /></div></Panel>
        <Panel titulo="Cobrado por mes"><div className="grafico"><BarrasMes data={m} fmt={money} series={[{ key: "cobrado", label: "Cierres", color: "tono:1" }, { key: "cobrado_seg_solo", label: "Seguimiento", color: "tono:3" }, { key: "cobranzas", label: "Cobranzas", color: "tono:5" }]} /></div></Panel>
        <Panel titulo="Agendas por mes"><div className="grafico"><BarrasMes data={m} meta="meta_agendas" series={[{ key: "agendas", label: "Agendas", color: "tono:3" }]} /></div></Panel>
        <Panel titulo="Asistencias por mes"><div className="grafico"><BarrasMes data={m} meta="meta_asistencias" series={[{ key: "asistencias", label: "Asistencias", color: "tono:3" }]} /></div></Panel>
        <Panel titulo="Cierres por mes"><div className="grafico"><BarrasMes data={m} meta="meta_cierres" series={[{ key: "cierres", label: "Cierres", color: "tono:3" }]} /></div></Panel>
        <Panel titulo="% Recolección por mes"><div className="grafico"><Lineas data={m} x="mes" series={[{ key: "pct_recoleccion", label: "% Recolección", color: "tono:2" }]} /></div></Panel>
        <Panel titulo="% Asistencia y % calificada"><div className="grafico"><Lineas data={m} x="mes" series={[{ key: "pct_asistencia", label: "% Asistencia", color: "tono:1" }, { key: "pct_asist_cal", label: "% Asist. calificada", color: "tono:4" }]} /></div></Panel>
        <Panel titulo="% Cierre por mes"><div className="grafico"><Lineas data={m} x="mes" series={[{ key: "pct_cierre", label: "% Cierre", color: "tono:2" }]} /></div></Panel>
        <Panel titulo={<Seg label="Vista" value={extra} onChange={setExtra} options={[["objeciones", "Objeciones"], ["fuentes", "Fuentes e industrias"]] as const} />}
          extra={extra === "objeciones"
            ? <Seg label="Base" value={soloCal ? "c" : "t"} onChange={(v) => setSoloCal(v === "c")} options={[["t", "Todas"], ["c", "Calificadas"]] as const} />
            : <span className="muted">{num(fuentes.reduce((a, x) => a + x.n, 0))} agendas</span>}>
          {extra === "objeciones" ? (
            obj.filas.every((o) => !o.n) ? <Vacio txt="Sin datos para este filtro" /> : (
              <div className="scroll-interno">
                <div style={{ height: obj.filas.filter((o) => o.n).length * 22 + 30 }}>
                  <Barras horizontal data={obj.filas.filter((o) => o.n)} x="objecion" series={[{ key: "n", label: "Veces", color: "tono:2" }]} />
                </div>
                <p className="nota">Base: {num(obj.base)} asistencias{soloCal ? " calificadas" : ""} del período</p>
              </div>
            )
          ) : (
            <div className="dona-ind">
              <div className="grafico"><Dona data={fuentes.map((x) => ({ k: x.fuente, n: x.n }))} activo={fs?.fuente} onClick={setFuenteSel} /></div>
              <div className="top-ind">
                <div className="filtro-titulo">Top industrias · {fs?.fuente ?? "—"}</div>
                <ol>{(fs?.industrias ?? []).map((i) => <li key={i.k}><span className="recorte">{i.k}</span><b className="v-n">{i.n}</b></li>)}</ol>
              </div>
            </div>
          )}
        </Panel>
      </div>
      <p className="nota pie">Barras por mes desde oct-26 · el último mes va resaltado · línea punteada = meta de Proyecciones · objeciones y fuentes según el período elegido · fuente: Tracker</p>
    </div>
  );
}
