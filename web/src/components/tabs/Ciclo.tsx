import { useMemo, useState } from "react";
import {
  DIMS_PAGO, MAPEO_PIF, TRAMOS, agruparPago, ciclo, cierresPago, filtrarPago, opcionesPago, pif, resumenPago,
  type CierrePago, type DashDatos, type Filtros, type FiltrosPago,
} from "../../lib/metricas";
import { Barras, C, ChipProd, Kpi, Panel, Seg, Tabla, dec, dias, fecha, money, num, pct } from "../ui";

export function Ciclo({ d, f, from, to, vista, setVista, pf, setPf, outliers, setOutliers }: {
  d: DashDatos; f: Filtros; from: string; to: string; vista: "embudo" | "pago"; setVista: (v: "embudo" | "pago") => void;
  pf: FiltrosPago; setPf: (x: FiltrosPago) => void; outliers: boolean; setOutliers: (v: boolean) => void;
}) {
  return (
    <div className="tab-col">
      <Seg label="Bloque" className="seg-grande" value={vista} onChange={setVista} options={[["embudo", "Embudo GHL"], ["pago", "Llamada → pago"]] as const} />
      {vista === "embudo" ? <Embudo d={d} f={f} from={from} to={to} /> : <LlamadaPago d={d} f={f} from={from} to={to} pf={pf} setPf={setPf} outliers={outliers} setOutliers={setOutliers} />}
    </div>
  );
}

// ───────── Ciclo de venta T0→T4 + PIF ─────────
const diasTxt = (n: number | null) => (n == null ? "—" : n === 0 ? "< 1 día" : n === 1 ? "1 día" : `${dec(n, n % 1 ? 1 : 0)} días`);
function Embudo({ d, f, from, to }: { d: DashDatos; f: Filtros; from: string; to: string }) {
  const [abajo, setAbajo] = useState<"tramos" | "leads">("tramos");
  const [verSin, setVerSin] = useState(false);
  const c = useMemo(() => ciclo(d, f, from, to), [d, f, from, to]);
  const p = useMemo(() => pif(d, f, from, to), [d, f, from, to]);
  const t = c.todos.tramos;
  const barra = (nombre: string, r: typeof c.dfy, color: string) => {
    const vals = r.tramos.map((x) => x.mediana ?? 0);
    const tot = vals.reduce((a, b) => a + b, 0);
    return (
      <div className="timeline">
        <span className="tl-nombre">{nombre}</span>
        <div className="tl-barra">
          {tot === 0 ? <span className="muted">Sin datos en este período</span> : r.tramos.map((x, i) => (
            <span key={i} className="tl-seg" style={{ flex: Math.max(vals[i], tot * 0.04), background: color, opacity: 1 - i * 0.18 }} title={`${x.nombre}: mediana ${diasTxt(x.mediana)} · ${x.n} leads`}>
              {diasTxt(x.mediana)}
            </span>
          ))}
        </div>
      </div>
    );
  };
  return (
    <>
      <div className="kpis6">
        <Kpi label="Ciclo total" value={diasTxt(c.todos.total.mediana)} sub={`mediana · ${c.todos.total.n} cierres`} />
        {TRAMOS.map((n, i) => <Kpi key={n} label={i === 0 ? "Primer contacto (anuncio) → agenda" : n} value={diasTxt(t[i].mediana)} sub={`mediana · ${t[i].n} leads`} />)}
        <Kpi label="PIF" value={p.pifs ? `1 cada ${dec(p.porCierres)} cierres` : "Sin PIF en el período"} sub={p.pifs ? `1 cada ${dec(p.porLeads)} leads · ${pct(p.pctPif)} PIF` : undefined} />
      </div>
      <div className="fila-60-40">
        <Panel titulo="Línea de tiempo del ciclo" extra={<span className="muted">Mediana de cada tramo · orgánicos y referidos arrancan en la agenda</span>}>
          {barra("DFY $30k", c.dfy, C.dfy)}
          {barra("JessiK", c.jessik, C.jessik)}
          <div className="tl-leyenda">{TRAMOS.map((n, i) => <span key={n}><i style={{ opacity: 1 - i * 0.18 }} />{n}</span>)}</div>
        </Panel>
        <Panel titulo="PIF (JessiK, año completo)">
          <table className="t2">
            <tbody>
              <tr><td className="l">PIFs</td><td>{num(p.pifs)}</td></tr>
              <tr><td className="l">Cierres por PIF</td><td>{p.pifs ? `1 cada ${dec(p.porCierres)}` : "Sin PIF en el período"}</td></tr>
              <tr><td className="l">Cierres JessiK por PIF</td><td>{p.pifs ? `1 cada ${dec(p.porCierresJessik)}` : "—"}</td></tr>
              <tr><td className="l">Leads por PIF</td><td>{p.pifs ? `1 cada ${dec(p.porLeads)}` : "—"}</td></tr>
              <tr><td className="l">Asistencias por PIF</td><td>{p.pifs ? `1 cada ${dec(p.porAsistencias)}` : "—"}</td></tr>
              <tr><td className="l">% PIF</td><td>{pct(p.pctPif)}</td></tr>
              <tr><td className="l">Sin clasificar</td><td><button className="link" onClick={() => setVerSin(true)}>{p.sinClasificar.length} →</button></td></tr>
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel className="lleno" titulo={<Seg label="Detalle" value={abajo} onChange={setAbajo} options={[["tramos", "Tramos"], ["leads", "Leads"]] as const} />}
        extra={<span className="muted">Datos incompletos (fechas fuera de orden): {c.invalidos}</span>}>
        {abajo === "tramos" ? (
          <Tabla rows={[...t.map((x) => ({ ...x })), { nombre: "Ciclo total (T0→T4 o T1→T4)", ...c.todos.total }]}
            cols={[
              { k: "n", label: "Tramo", align: "l", get: (x) => x.nombre },
              { k: "m", label: "Mediana", get: (x) => diasTxt(x.mediana) },
              { k: "p", label: "Percentil 75", get: (x) => diasTxt(x.p75) },
              { k: "c", label: "Leads medidos", get: (x) => num(x.n) },
              { k: "md", label: "DFY (mediana)", get: (x) => diasTxt((x.nombre.startsWith("Ciclo") ? c.dfy.total : c.dfy.tramos.find((y) => y.nombre === x.nombre))?.mediana ?? null) },
              { k: "mj", label: "JessiK (mediana)", get: (x) => diasTxt((x.nombre.startsWith("Ciclo") ? c.jessik.total : c.jessik.tramos.find((y) => y.nombre === x.nombre))?.mediana ?? null) },
            ]} />
        ) : (
          <Tabla rows={c.filas} porPagina={10} buscar={(x) => x.nombre ?? ""} csv="ciclo-leads"
            cols={[
              { k: "n", label: "Lead", align: "l", get: (x) => x.nombre ?? "—" },
              { k: "p", label: "Producto", get: (x) => <ChipProd p={x.producto} />, csv: (x) => x.producto },
              { k: "c", label: "Closer", get: (x) => x.closer ?? "—" },
              { k: "t0", label: "T0 anuncio", get: (x) => fecha(x.t0), csv: (x) => x.t0 },
              { k: "t1", label: "T1 agenda", get: (x) => fecha(x.t1), csv: (x) => x.t1 },
              { k: "t2", label: "T2 asistencia", get: (x) => fecha(x.t2), csv: (x) => x.t2 },
              { k: "t3", label: "T3 oferta", get: (x) => fecha(x.t3), csv: (x) => x.t3 },
              { k: "t4", label: "T4 cierre", get: (x) => fecha(x.t4), csv: (x) => x.t4 },
              ...TRAMOS.map((n, i) => ({ k: `d${i}`, label: n, get: (x: typeof c.filas[number]) => diasTxt(x.tramos[i]), csv: (x: typeof c.filas[number]) => x.tramos[i] })),
              { k: "tot", label: "Total", get: (x) => diasTxt(x.total), csv: (x) => x.total },
            ]} />
        )}
      </Panel>
      {verSin && (
        <div className="overlay" onClick={() => setVerSin(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="panel-head"><h2>Cierres JessiK sin clasificar como PIF</h2><button className="link" onClick={() => setVerSin(false)}>Cerrar ✕</button></header>
            <Tabla rows={p.detalle} porPagina={10} cols={[
              { k: "n", label: "Cliente", align: "l", get: (x) => x.nombre ?? "—" },
              { k: "f", label: "Cierre", get: (x) => fecha(x.fecha_cierre) },
              { k: "pl", label: "Plan de pago", get: (x) => x.plan_pago ?? "—" },
              { k: "m", label: "Método de cobro", get: (x) => x.metodo_cobro ?? "—" },
              { k: "c", label: "Clase", get: (x) => x.clase },
              { k: "fu", label: "Según", align: "l", get: (x) => x.fuente },
            ]} />
            <h3 className="sub-h">Mapeo PIF [A CONFIRMAR con Luca]</h3>
            <Tabla rows={MAPEO_PIF} cols={[{ k: "p", label: "Plan de pago", align: "l", get: (m) => m.plan ?? "—" }, { k: "m", label: "Método", get: (m) => m.metodo ?? "cualquiera" }, { k: "c", label: "Clase", get: (m) => m.clase }, { k: "n", label: "Nota", align: "l", get: (m) => m.nota }]} />
          </div>
        </div>
      )}
    </>
  );
}

// ───────── Llamada → pago (Tracker) ─────────
const AGRUPAR: [keyof CierrePago, string][] = [
  ["producto", "Producto"], ["closer", "Closer"], ["tier", "Tier setter"], ["origen", "Origen de Lead"], ["pais", "País"], ["estado", "Estado / provincia"],
  ["industria", "Industria"], ["facturacion", "Facturación"], ["setter", "Setter origen"], ["campana", "Campaña"], ["modalidad", "Modalidad pago"],
  ["oferta", "Oferta hecha"], ["bono", "Bono activado"], ["mes", "Mes"],
];
function LlamadaPago({ d, f, from, to, pf, setPf, outliers, setOutliers }: { d: DashDatos; f: Filtros; from: string; to: string; pf: FiltrosPago; setPf: (x: FiltrosPago) => void; outliers: boolean; setOutliers: (v: boolean) => void }) {
  const [grupo, setGrupo] = useState<keyof CierrePago>("producto");
  const [der, setDer] = useState<"dist" | "cruce">("dist");
  const [panel, setPanel] = useState(false);
  const [soloSinFecha, setSoloSinFecha] = useState(false);
  const todos = useMemo(() => cierresPago(d), [d]);
  const opciones = useMemo(() => opcionesPago(todos), [todos]);
  const cs = useMemo(() => filtrarPago(todos, f, from, to, pf), [todos, f, from, to, pf]);
  const r = useMemo(() => resumenPago(cs, outliers), [cs, outliers]);
  const grupos = useMemo(() => agruparPago(cs, outliers, grupo), [cs, outliers, grupo]);
  const cruce = useMemo(() => {
    const out: { k: string; cierres: number; pct: number | null; prom: number | null }[] = [];
    for (const prod of ["DFY", "JessiK"]) for (const g of agruparPago(cs.filter((c) => c.producto === prod), outliers, "origen")) out.push({ k: `${prod} · ${g.k}`, cierres: g.cierres, pct: g.pctLlamada, prom: g.promSeguimiento });
    return out;
  }, [cs, outliers]);
  const detalle = soloSinFecha ? cs.filter((c) => c.fuente_fecha === "sin fecha") : cs;
  const activos = Object.entries(pf).flatMap(([k, vs]) => vs.map((v) => ({ k, v })));
  const toggle = (k: string, v: string) => { const cur = pf[k] ?? []; setPf({ ...pf, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }); };

  return (
    <>
      <div className="barra-filtros-bloque">
        <button className="link" onClick={() => setPanel(true)}>Más filtros{activos.length ? ` (${activos.length})` : ""}</button>
        {activos.map(({ k, v }) => <span key={k + v} className="chip-filtro">{DIMS_PAGO.find((x) => x.key === k)?.label}: {v}<button aria-label="Quitar" onClick={() => toggle(k, v)}>✕</button></span>)}
        {activos.length > 0 && <button className="link" onClick={() => setPf({})}>Limpiar filtros</button>}
        <label className="check derecha"><input type="checkbox" checked={outliers} onChange={(e) => setOutliers(e.target.checked)} /> Excluir outliers (&gt; 30 días){r.outliers ? ` · ${r.outliers}` : ""}</label>
      </div>
      <div className="kpis5">
        <Kpi label="% en llamada" value={pct(r.pctLlamada)} sub={`${r.enLlamada} cierres el mismo día`} />
        <Kpi label="% en seguimiento" value={pct(r.pctSeguimiento)} sub={`${r.enSeguimiento} cierres`} />
        <Kpi label="Días promedio en seguimiento" value={r.promSeguimiento == null ? "—" : dec(r.promSeguimiento)} sub={`mediana ${r.medianaSeguimiento == null ? "—" : dec(r.medianaSeguimiento)}`} />
        <Kpi label="Días promedio total" value={r.promTotal == null ? "—" : dec(r.promTotal)} sub={`${r.cierres} cierres medidos`} />
        <Kpi label="Sin fecha de pago" value={num(r.sinFecha.length)} sub={soloSinFecha ? "Mostrando solo estos ✕" : "Tocá para ver cuáles"} tone={r.sinFecha.length ? "alerta" : ""} onClick={() => setSoloSinFecha(!soloSinFecha)} />
      </div>
      <div className="fila-60-40 media">
        <Panel titulo="Comparativa" extra={<select className="select" value={grupo} onChange={(e) => setGrupo(e.target.value as keyof CierrePago)} aria-label="Agrupar por">{AGRUPAR.map(([k, l]) => <option key={k} value={k}>Agrupar por {l}</option>)}</select>}>
          <div className="grafico">
            <Barras data={grupos.map((g) => ({ k: g.k, enLlamada: g.enLlamada, enSeguimiento: g.enSeguimiento, prom: g.promSeguimiento, med: g.medianaSeguimiento }))} x="k"
              series={[{ key: "enLlamada", label: "En llamada", color: C.s1, stack: "a" }, { key: "enSeguimiento", label: "En seguimiento", color: C.s2, stack: "a" }]} />
          </div>
          <div className="mini-leyenda">{grupos.slice(0, 6).map((g) => <span key={g.k}><b>{g.k}</b> {g.cierres} cierres · {pct(g.pctLlamada)} en llamada · seg. {g.promSeguimiento == null ? "—" : dec(g.promSeguimiento)} d (med. {g.medianaSeguimiento == null ? "—" : dec(g.medianaSeguimiento)})</span>)}</div>
        </Panel>
        <Panel titulo={<Seg label="Vista" value={der} onChange={setDer} options={[["dist", "Distribución"], ["cruce", "Producto × Origen"]] as const} />}>
          {der === "dist"
            ? <div className="grafico"><Barras data={r.buckets} x="label" series={[{ key: "n", label: "Cierres", color: C.neutro }]} /></div>
            : <Tabla rows={cruce} cols={[{ k: "k", label: "Producto · origen", align: "l", get: (x) => x.k }, { k: "c", label: "Cierres", get: (x) => num(x.cierres) }, { k: "p", label: "% en llamada", get: (x) => pct(x.pct) }, { k: "d", label: "Días prom. seg.", get: (x) => (x.prom == null ? "—" : dec(x.prom)) }]} />}
        </Panel>
      </div>
      <Panel className="lleno" titulo={`Detalle · ${detalle.length} cierres`} fuente="Tracker (Fecha primer pago BF / Cobros — Seguimiento)">
        <Tabla rows={detalle} porPagina={10} buscar={(c) => `${c.nombre} ${c.email ?? ""}`} csv="llamada-a-pago" rowCls={(c) => (c.fuente_fecha === "sin fecha" || c.incompleto ? "fila-roja" : "")}
          cols={[
            { k: "n", label: "Nombre", align: "l", get: (c) => c.nombre },
            { k: "p", label: "Producto", get: (c) => <ChipProd p={c.producto} />, csv: (c) => c.producto },
            { k: "c", label: "Closer", get: (c) => c.closer ?? "—" },
            { k: "o", label: "Origen", get: (c) => c.origen ?? "—" },
            { k: "t", label: "Tier", get: (c) => c.tier ?? "—" },
            { k: "pa", label: "País", get: (c) => c.pais ?? "—" },
            { k: "i", label: "Industria", get: (c) => c.industria ?? "—" },
            { k: "fl", label: "Llamada", get: (c) => fecha(c.fecha_llamada), csv: (c) => c.fecha_llamada },
            { k: "fp", label: "Primer pago", get: (c) => fecha(c.fecha_pago), csv: (c) => c.fecha_pago },
            { k: "ff", label: "Fuente fecha", get: (c) => c.fuente_fecha },
            { k: "d", label: "Días", get: (c) => (c.incompleto ? c.incompleto : dias(c.dias)), csv: (c) => c.dias },
            { k: "ti", label: "Tipo", get: (c) => c.tipo ?? "—" },
            { k: "v", label: "Vendido", get: (c) => money(c.vendido), csv: (c) => c.vendido },
            { k: "co", label: "Cobrado", get: (c) => money(c.cobrado), csv: (c) => c.cobrado },
          ]} vacio="Sin cierres con estos filtros" />
      </Panel>
      {panel && (
        <div className="overlay" onClick={() => setPanel(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="panel-head"><h2>Más filtros</h2><span><button className="link" onClick={() => setPf({})}>Limpiar filtros</button> <button className="link" onClick={() => setPanel(false)}>Cerrar ✕</button></span></header>
            {(["Lead", "Venta", "Proceso"] as const).map((g) => (
              <details key={g} open={g === "Lead"} className="grupo-filtros">
                <summary>{g}</summary>
                {DIMS_PAGO.filter((x) => x.grupo === g).map((dm) => (
                  <div key={dm.key} className="filtro-dim">
                    <div className="filtro-titulo">{dm.label}</div>
                    <div className="opciones">
                      {(opciones[dm.key] ?? []).map((v) => (
                        <label key={v} className={`op ${(pf[dm.key] ?? []).includes(v) ? "on" : ""}`}><input type="checkbox" checked={(pf[dm.key] ?? []).includes(v)} onChange={() => toggle(dm.key, v)} />{v}</label>
                      ))}
                    </div>
                  </div>
                ))}
              </details>
            ))}
          </aside>
        </div>
      )}
    </>
  );
}
