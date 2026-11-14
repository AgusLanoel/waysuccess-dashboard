import { useMemo, useState } from "react";
import { variacion, type DashDatos, type Filtros } from "../../lib/metricas";
import { desgloseT, numeros, type CtxTracker, type DimT } from "../../lib/metricasTracker";
import { Barras, C, Kpi, Lineas, Panel, Seg, Tabla, Valor, fecha, money, pct, type Col } from "../ui";

// Pestaña "Números" = hoja "Gráficos · Números" del Tracker (15-11). Un bloque a la vez (selector), sin scroll de página.
type Bloque = "resultados" | "semanal" | "evolucion" | "volumen" | "calidad" | "conversion" | "closer" | "producto";
const BLOQUES: [Bloque, string][] = [
  ["resultados", "Resultados"], ["semanal", "Comparativa semanal"], ["evolucion", "Evolución"], ["volumen", "Volumen"],
  ["calidad", "Calidad"], ["conversion", "Conversión"], ["closer", "Closer y fuente"], ["producto", "Producto e industria"],
];

export function Numeros({ ctx, f, from, to }: { d: DashDatos; ctx: CtxTracker; f: Filtros; from: string; to: string }) {
  const [bloque, setBloque] = useState<Bloque>("resultados");
  const n = useMemo(() => numeros(ctx, f, from, to), [ctx, f, from, to]);
  const { b, der, bAnt, derAnt } = n;
  const dv = (k: "n" | "p" | "m", a: number | null, x: number | null | undefined) => variacion(k, a, x ?? null);
  const sem = n.semanas.map((s) => ({ ...s, label: `${fecha(s.ini)}–${fecha(s.fin)}` }));

  return (
    <div className="tab-col">
      <Seg label="Bloque" className="seg-bloques" value={bloque} onChange={setBloque} options={BLOQUES} />
      {bloque === "resultados" && (
        <div className="kpis-grid3">
          <Kpi label="Agendas" value={<Valor k="n" v={b.agendas} />} delta={dv("n", b.agendas, bAnt?.agendas)} />
          <Kpi k="p" ratio={der.pct_agendas_cal} label="% Agendas calificadas" value={pct(der.pct_agendas_cal)} delta={dv("p", der.pct_agendas_cal, derAnt?.pct_agendas_cal)} sub={`${b.agendas_cal} calificadas`} />
          <Kpi label="Asistencias" value={<Valor k="n" v={b.asistencias} />} delta={dv("n", b.asistencias, bAnt?.asistencias)} />
          <Kpi k="p" ratio={der.pct_asistencia} label="% Asistencia" value={pct(der.pct_asistencia)} delta={dv("p", der.pct_asistencia, derAnt?.pct_asistencia)} sub="asistencias ÷ agendas" />
          <Kpi label="Asist. calificadas" value={<Valor k="n" v={b.asist_cal} />} delta={dv("n", b.asist_cal, bAnt?.asist_cal)} />
          <Kpi k="p" ratio={der.pct_asist_cal} label="% Asist. calificadas" value={pct(der.pct_asist_cal)} delta={dv("p", der.pct_asist_cal, derAnt?.pct_asist_cal)} sub="calificadas ÷ asistencias" />

          <Kpi label="Ofertas" value={<Valor k="n" v={b.ofertas} />} delta={dv("n", b.ofertas, bAnt?.ofertas)} />
          <Kpi k="p" ratio={der.pct_ofertas} label="% Ofertas" value={pct(der.pct_ofertas)} delta={dv("p", der.pct_ofertas, derAnt?.pct_ofertas)} sub="ofertas ÷ asistencias" />
          <Kpi label="Cierres" value={<Valor k="n" v={b.cierres} />} delta={dv("n", b.cierres, bAnt?.cierres)} />
          <Kpi k="p" ratio={der.pct_cierre} label="% Cierre" value={pct(der.pct_cierre)} delta={dv("p", der.pct_cierre, derAnt?.pct_cierre)} sub="cierres ÷ asistencias" />
          <Kpi k="avg" label="Ticket" value={money(der.ticket)} delta={dv("m", der.ticket, derAnt?.ticket)} sub="cobrado ÷ cierres" />
          <Kpi k="p" ratio={der.pct_cierres_seg} label="% Cierres en seguimiento" value={pct(der.pct_cierres_seg)} delta={dv("p", der.pct_cierres_seg, derAnt?.pct_cierres_seg)} />

          <Kpi k="m" label="Total vendido" value={money(b.vendido)} delta={dv("m", b.vendido, bAnt?.vendido)} />
          <Kpi k="m" label="Recolectado cierres" value={money(b.cobrado)} delta={dv("m", b.cobrado, bAnt?.cobrado)} />
          <Kpi k="p" ratio={der.pct_recoleccion} label="% Recolección" value={pct(der.pct_recoleccion)} delta={dv("p", der.pct_recoleccion, derAnt?.pct_recoleccion)} sub="recolectado total ÷ vendido" />
          <Kpi label="Cierres en seguimiento" value={<Valor k="n" v={b.cierres_seg} />} delta={dv("n", b.cierres_seg, bAnt?.cierres_seg)} />
          <Kpi k="m" label="Recolectado seguimiento" value={money(b.cobrado_seg)} delta={dv("m", b.cobrado_seg, bAnt?.cobrado_seg)} />
          <Kpi k="m" label="Recolectado total" value={money(b.cobrado_total)} delta={dv("m", b.cobrado_total, bAnt?.cobrado_total)} />
        </div>
      )}
      {bloque === "semanal" && (
        <Panel className="lleno" titulo="Comparativa semanal" fuente="Tracker">
          <Tabla rows={[...n.semanas, { ...b, ...der, semana: "Total", ini: from, fin: to, label: "", part_agendas: 1 }]} porPagina={12} csv="comparativa-semanal"
            rowCls={(s) => (s.semana === "Total" ? "fila-total" : "")} cols={COLS_SEMANA} />
        </Panel>
      )}
      {bloque === "evolucion" && (
        <div className="fila2 lleno">
          <Panel titulo="% Asistencia por semana"><div className="grafico"><Lineas data={sem} x="label" series={[{ key: "pct_asistencia", label: "% Asistencia", color: C.s1 }]} /></div></Panel>
          <Panel titulo="% Cierre por semana"><div className="grafico"><Lineas data={sem} x="label" series={[{ key: "pct_cierre", label: "% Cierre", color: C.s3 }]} /></div></Panel>
        </div>
      )}
      {bloque === "volumen" && (
        <div className="fila2 lleno">
          <Panel titulo="Agendas, asistencias y calificadas"><div className="grafico"><Barras data={sem} x="label" series={[{ key: "agendas", label: "Agendas", color: "tono:1" }, { key: "asistencias", label: "Asistencias", color: "tono:3" }, { key: "asist_cal", label: "Asist. calificadas", color: "tono:5" }]} /></div></Panel>
          <Panel titulo="Vendido vs cobrado"><div className="grafico"><Barras data={sem} x="label" fmt={money} series={[{ key: "vendido", label: "Vendido", color: "tono:1" }, { key: "cobrado", label: "Cobrado", color: "tono:4" }]} /></div></Panel>
        </div>
      )}
      {bloque === "calidad" && (
        <div className="fila2 lleno">
          <Panel titulo="% Asistencias calificadas por semana"><div className="grafico"><Lineas data={sem} x="label" series={[{ key: "pct_asist_cal", label: "% Asist. calificadas", color: C.s1 }]} /></div></Panel>
          <Panel titulo="% Ofertas realizadas por semana"><div className="grafico"><Lineas data={sem} x="label" series={[{ key: "pct_ofertas", label: "% Ofertas", color: C.s3 }]} /></div></Panel>
        </div>
      )}
      {bloque === "conversion" && (
        <div className="fila2 lleno">
          <Panel titulo="Ofertas y cierres por semana"><div className="grafico"><Barras data={sem} x="label" series={[{ key: "ofertas", label: "Ofertas", color: "tono:4" }, { key: "cierres", label: "Cierres", color: "tono:1" }]} /></div></Panel>
          <Panel titulo="⌀ Ticket promedio por semana · cobrado ÷ cierres"><div className="grafico"><Lineas data={sem} x="label" fmt={money} series={[{ key: "ticket", label: "Ticket prom.", color: C.s1 }]} /></div></Panel>
        </div>
      )}
      {bloque === "closer" && <div className="fila2 lleno"><TablaSeg ctx={ctx} f={f} from={from} to={to} k="closer" titulo="Por closer" /><TablaSeg ctx={ctx} f={f} from={from} to={to} k="fuente" titulo="Por fuente" /></div>}
      {bloque === "producto" && <div className="fila2 lleno"><TablaSeg ctx={ctx} f={f} from={from} to={to} k="producto" titulo="Por producto" /><TablaSeg ctx={ctx} f={f} from={from} to={to} k="industria" titulo="Por industria (normalizada)" /></div>}
      <p className="nota pie">Agenda = fila de Llamadas por fecha de llamada · % Asistencia = asistencias ÷ agendas · % Asist. calificadas = calificadas ÷ asistencias · % Ofertas = ofertas ÷ asistencias · % Cierre = cierres ÷ asistencias · Ticket = cobrado ÷ cierres · % Recolección = recolectado total ÷ vendido · vendido y cobrado por fecha de cierre · fuente: Tracker</p>
    </div>
  );
}

type FilaSem = ReturnType<typeof numeros>["semanas"][number] & { label?: string };
const COLS_SEMANA: Col<FilaSem>[] = [
  { k: "s", label: "Semana", align: "l", get: (s) => <b>{s.semana}</b>, csv: (s) => s.semana },
  { k: "i", label: "Inicio", get: (s) => fecha(s.ini), csv: (s) => s.ini },
  { k: "f", label: "Fin", get: (s) => fecha(s.fin), csv: (s) => s.fin },
  { k: "ag", label: "Agendas", get: (s) => <Valor k="n" v={s.agendas} />, csv: (s) => s.agendas },
  { k: "pag", label: "% Agendas", get: (s) => <Valor k="p" v={s.part_agendas} />, csv: (s) => s.part_agendas },
  { k: "as", label: "Asist.", get: (s) => <Valor k="n" v={s.asistencias} />, csv: (s) => s.asistencias },
  { k: "pas", label: "% Asistencia", get: (s) => <Valor k="p" v={s.pct_asistencia} />, csv: (s) => s.pct_asistencia },
  { k: "ac", label: "Asist. cal.", get: (s) => <Valor k="n" v={s.asist_cal} />, csv: (s) => s.asist_cal },
  { k: "pac", label: "% Asist. cal.", get: (s) => <Valor k="p" v={s.pct_asist_cal} />, csv: (s) => s.pct_asist_cal },
  { k: "of", label: "Ofertas", get: (s) => <Valor k="n" v={s.ofertas} />, csv: (s) => s.ofertas },
  { k: "pof", label: "% Oferta", get: (s) => <Valor k="p" v={s.pct_ofertas} />, csv: (s) => s.pct_ofertas },
  { k: "ci", label: "Cierres", get: (s) => <Valor k="n" v={s.cierres} />, csv: (s) => s.cierres },
  { k: "pci", label: "% Cierre", get: (s) => <Valor k="p" v={s.pct_cierre} />, csv: (s) => s.pct_cierre },
  { k: "tk", label: "Ticket medio", get: (s) => <Valor k="avg" v={s.ticket} />, csv: (s) => s.ticket },
  { k: "v", label: "Vendido", get: (s) => <Valor k="m" v={s.vendido} />, csv: (s) => s.vendido },
  { k: "c", label: "Cobrado", get: (s) => <Valor k="m" v={s.cobrado} />, csv: (s) => s.cobrado },
  { k: "pse", label: "% Seguimiento", get: (s) => <Valor k="p" v={s.pct_cierres_seg} />, csv: (s) => s.pct_cierres_seg },
  { k: "pco", label: "% Cobro", get: (s) => <Valor k="p" v={s.pct_cobro} />, csv: (s) => s.pct_cobro },
  { k: "cs", label: "Cierres seg.", get: (s) => <Valor k="n" v={s.cierres_seg} />, csv: (s) => s.cierres_seg },
];

function TablaSeg({ ctx, f, from, to, k, titulo }: { ctx: CtxTracker; f: Filtros; from: string; to: string; k: DimT; titulo: string }) {
  const filas = useMemo(() => desgloseT(ctx, f, from, to, k), [ctx, f, from, to, k]);
  return (
    <Panel titulo={titulo} fuente="Tracker">
      <Tabla rows={filas} porPagina={14} vacio="Sin datos para este filtro"
        cols={[
          { k: "s", label: "Segmento", align: "l", get: (r) => <b>{r.seg}</b>, csv: (r) => r.seg },
          { k: "a", label: "Agendas", get: (r) => <Valor k="n" v={r.agendas} /> },
          { k: "as", label: "Asist.", get: (r) => <Valor k="n" v={r.asistencias} /> },
          { k: "p", label: "% Asist.", get: (r) => <Valor k="p" v={r.pct_asistencia} /> },
          { k: "c", label: "Cierres", get: (r) => <Valor k="n" v={r.cierres} /> },
          { k: "v", label: "Vendido", get: (r) => <Valor k="m" v={r.vendido} /> },
          { k: "co", label: "Cobrado", get: (r) => <Valor k="m" v={r.cobrado} /> },
        ]} />
    </Panel>
  );
}
