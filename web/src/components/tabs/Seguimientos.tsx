import { useMemo, useState } from "react";
import { ETAPA_CORTA, ETAPAS_SEGUIMIENTO, seguimientos, topObjeciones, type DashDatos, type Filtros } from "../../lib/metricas";
import { Barras, C, ChipProd, Panel, Seg, Tabla, fecha, ghlContacto, num, pct } from "../ui";

export function Seguimientos({ d, f, setCloser }: { d: DashDatos; f: Filtros; setCloser: (c: string) => void }) {
  const [etapa, setEtapa] = useState<string>("Todos");
  const [prodObj, setProdObj] = useState<"Todos" | "DFY" | "JessiK">("Todos");
  const todas = useMemo(() => seguimientos(d, f), [d, f]);
  const sinCloser = useMemo(() => seguimientos(d, { ...f, closer: "Todos" }), [d, f]);
  const filas = etapa === "Todos" ? todas : todas.filter((x) => x.etapa === etapa);
  const obj = useMemo(() => topObjeciones(d, new Set(filas.map((x) => x.persona)), prodObj), [d, filas, prodObj]);
  const closersM = [...new Set(sinCloser.map((x) => x.closer ?? "Sin closer"))].sort();
  const cuenta = (c: string | null, e: string | null) => sinCloser.filter((x) => (c == null || (x.closer ?? "Sin closer") === c) && (e == null || x.etapa === e)).length;

  return (
    <div className="tab-col">
      <Seg label="Etapa" value={etapa} onChange={setEtapa}
        options={[["Todos", `Todos · ${todas.length}`], ...ETAPAS_SEGUIMIENTO.map((e) => [e, `${ETAPA_CORTA[e]} · ${todas.filter((x) => x.etapa === e).length}`] as const)] as const} />
      <div className="fila-70-30">
        <Panel className="lleno" titulo={`Seguimientos · ${filas.length}`} extra={<span className="muted">Primero vencidos o sin fecha, después P5 → P3 → P1</span>}>
          <Tabla
            rows={filas}
            porPagina={12}
            buscar={(x) => `${x.nombre ?? ""} ${x.telefono ?? ""}`}
            rowCls={(x) => (x.estado === "vencido" || x.estado === "sin fecha" ? "fila-roja" : x.estado === "hoy" ? "fila-ambar" : "")}
            cols={[
              { k: "n", label: "Lead", align: "l", get: (x) => { const u = ghlContacto(x.contact_id); return u ? <a href={u} target="_blank" rel="noreferrer">{x.nombre ?? "—"}</a> : x.nombre ?? "—"; } },
              { k: "t", label: "Teléfono", get: (x) => { const u = ghlContacto(x.contact_id); return u ? <a href={u} target="_blank" rel="noreferrer">{x.telefono ?? "—"}</a> : x.telefono ?? "—"; } },
              { k: "c", label: "Closer", get: (x) => x.closer ?? "—" },
              { k: "p", label: "Producto", get: (x) => <ChipProd p={x.producto} /> },
              { k: "ti", label: "Tier", get: (x) => x.tier ?? "—" },
              { k: "e", label: "Etapa", get: (x) => ETAPA_CORTA[x.etapa] ?? x.etapa },
              { k: "m", label: "Motivo", align: "l", get: (x) => <span className="recorte" title={x.motivo ?? ""}>{x.motivo ?? "—"}</span> },
              { k: "f", label: "Llamada", get: (x) => fecha(x.fecha_llamada) },
              { k: "pr", label: "Próximo seguimiento", get: (x) => (x.estado === "sin fecha" ? "Sin fecha" : x.estado === "hoy" ? "Vence hoy" : fecha(x.proximo)), cls: (x) => `estado-${x.estado.replace(" ", "-")}` },
              { k: "d", label: "Días en etapa", get: (x) => num(x.dias_en_etapa) },
            ]}
            vacio="Sin leads en seguimiento con estos filtros"
          />
        </Panel>
        <div className="tab-col">
          <Panel titulo="Closer × etapa">
            <div className="tabla-scroll">
              <table className="t2 matriz">
                <thead><tr><th className="l">Closer</th>{ETAPAS_SEGUIMIENTO.map((e) => <th key={e}>{ETAPA_CORTA[e]}</th>)}<th>Total</th></tr></thead>
                <tbody>
                  {closersM.map((c) => (
                    <tr key={c}>
                      <td className="l">{c}</td>
                      {ETAPAS_SEGUIMIENTO.map((e) => <td key={e}><button className="link" onClick={() => { setCloser(c); setEtapa(e); }}>{cuenta(c, e) || "·"}</button></td>)}
                      <td><button className="link" onClick={() => { setCloser(c); setEtapa("Todos"); }}><b>{cuenta(c, null)}</b></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel className="lleno" titulo="Top 5 objeciones" fuente="Tracker" extra={<Seg label="Producto" value={prodObj} onChange={setProdObj} options={[["Todos", "Todos"], ["DFY", "DFY"], ["JessiK", "JessiK"]] as const} />}>
            <div className="grafico">
              <Barras horizontal data={obj.top.map((o) => ({ k: o.objecion, v: o.pct }))} x="k" series={[{ key: "v", label: "% de leads", color: prodObj === "DFY" ? C.dfy : prodObj === "JessiK" ? C.jessik : C.neutro }]} fmt={pct} />
            </div>
            <p className="nota">{obj.total} leads de la tabla con fila en el Tracker. Hasta que GHL tenga “Motivo de no venta”, sale de las columnas U:AM.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
