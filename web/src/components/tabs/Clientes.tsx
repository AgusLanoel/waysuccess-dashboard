import { useMemo, useState } from "react";
import type { DashDatos, Filtros } from "../../lib/metricas";
import { resumenClientes, type ClienteT, type CtxTracker, type FiltrosTab } from "../../lib/metricasTracker";
import { ChipProd, Kpi, Panel, Tabla, Valor, fecha, money, num } from "../ui";

// Pestaña "Clientes" = hoja "Cierres — Clientes" del Tracker (15-11)
export function Clientes({ ctx, f, from, to, ft }: { d: DashDatos; ctx: CtxTracker; f: Filtros; from: string; to: string; ft: FiltrosTab }) {
  const r = useMemo(() => resumenClientes(ctx, f, from, to, ft), [ctx, f, from, to, ft]);
  const [abierto, setAbierto] = useState<ClienteT | null>(null);
  const desglose = `Cierres ${money(r.recolectado_cierres)} + seguimiento ${money(r.recolectado_seguimiento)} + cobranzas ${money(r.cobranzas)}`;

  return (
    <div className="tab-col">
      <div className="kpis6">
        <Kpi label="Nuevos" value={<Valor k="n" v={r.nuevos} />} sub="cierre en el mes de la llamada" />
        <Kpi label="En seguimiento" value={<Valor k="n" v={r.seguimiento} />} sub="cierre en un mes posterior" />
        <Kpi label="Total cierres" value={<Valor k="n" v={r.total} />} />
        <Kpi k="m" label="Vendido" value={money(r.vendido)} />
        <Kpi k="m" label="Cobrado" value={money(r.cobrado)} sub="al cierre + cobros en seguimiento" />
        <Kpi k="m" tone={r.revisar ? "alerta" : ""} label="Por cobrar" value={money(r.por_cobrar)} sub={r.revisar ? <span className="txt-alerta">⚠ {r.revisar} para revisar</span> : "vendido − cobrado"} />
      </div>
      <div className="kpis3">
        <Kpi k="m" label="Recolectado cierres" value={money(r.recolectado_cierres)} sub="cobrado al cierre, por fecha de ingreso" />
        <Kpi k="m" label="Recolectado seguimiento" value={money(r.recolectado_seguimiento)} sub="Cobros — Seguimiento, por fecha de cobro" />
        <span title={desglose} className="kpi-tip"><Kpi k="m" label="Recolectado total" value={money(r.recolectado_total)} sub={desglose} /></span>
      </div>
      <Panel className="lleno" titulo="Clientes cerrados" fuente="Tracker · Cierres — Clientes" extra={<span className="muted">Tocá un cliente para ver sus pagos</span>}>
        <Tabla rows={r.filas} porPagina={15} csv="clientes" onRow={setAbierto}
          buscar={(c) => `${c.cliente} ${c.email ?? ""} ${c.telefono ?? ""}`}
          rowCls={(c) => (c.revisar ? "fila-ambar" : abierto?.fila === c.fila ? "fila-sel" : "")}
          vacio="Sin datos para este filtro"
          cols={[
            { k: "f", label: "Ingreso", get: (c) => fecha(c.fecha), csv: (c) => c.fecha },
            { k: "n", label: "Cliente", align: "l", get: (c) => <b>{c.cliente}</b>, csv: (c) => c.cliente },
            { k: "cl", label: "Closer", get: (c) => c.closer ?? "—" },
            { k: "p", label: "Producto", get: (c) => <ChipProd p={c.producto} />, csv: (c) => c.producto },
            { k: "fu", label: "Fuente", get: (c) => c.fuente ?? "—" },
            { k: "t", label: "Tipo", get: (c) => c.tipo, csv: (c) => c.tipo },
            { k: "v", label: "Vendido", get: (c) => <Valor k="m" v={c.vendido} />, csv: (c) => c.vendido },
            { k: "co", label: "Cobrado", get: (c) => <Valor k="m" v={c.cobrado} />, csv: (c) => c.cobrado },
            { k: "pc", label: "Por cobrar", get: (c) => <PorCobrar c={c} />, csv: (c) => c.por_cobrar },
            { k: "m", label: "Modalidad", align: "l", get: (c) => <span className="recorte">{c.modalidad ?? "—"}</span>, csv: (c) => c.modalidad },
            { k: "pa", label: "País", align: "l", get: (c) => c.pais ?? "—" },
            { k: "e", label: "Estado", align: "l", get: (c) => <span className="recorte">{c.estado ?? "—"}</span>, csv: (c) => c.estado },
            { k: "fo", label: "Llamada original", get: (c) => fecha(c.fecha_original), csv: (c) => c.fecha_original },
            { k: "no", label: "Notas", get: (c) => (c.notas ? <span className="icono" title={c.notas}>ⓘ</span> : ""), csv: (c) => c.notas },
          ]} />
      </Panel>
      <p className="nota pie">Cobrado según el Tracker, no conciliado con banco · Por cobrar = vendido − cobrado al cierre − cobros en seguimiento (si da negativo se muestra 0 con ⚠)</p>
      {abierto && (
        <div className="overlay" onClick={() => setAbierto(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="panel-head"><h2>{abierto.cliente}</h2><button className="link" onClick={() => setAbierto(null)}>Cerrar ✕</button></header>
            <div className="ficha">
              <span>Closer</span><b>{abierto.closer ?? "—"}</b>
              <span>Producto</span><b><ChipProd p={abierto.producto} /></b>
              <span>Fuente</span><b>{abierto.fuente ?? "—"}</b>
              <span>Correo</span><b>{abierto.email ?? "—"}</b>
              <span>Teléfono</span><b>{abierto.telefono ?? "—"}</b>
              <span>País / estado</span><b>{[abierto.pais, abierto.estado, abierto.ciudad].filter(Boolean).join(" · ") || "—"}</b>
              <span>Modalidad</span><b>{abierto.modalidad ?? "—"}</b>
              <span>Ingreso · llamada</span><b>{fecha(abierto.fecha)} · {fecha(abierto.fecha_original)}</b>
              <span>Fila en Llamadas</span><b>{abierto.fila_llamadas ?? "—"}</b>
            </div>
            <div className="kpis3 compacto">
              <Kpi k="m" label="Vendido" value={money(abierto.vendido)} />
              <Kpi k="m" label="Cobrado" value={money(abierto.cobrado)} />
              <Kpi k="m" tone={abierto.revisar ? "alerta" : ""} label="Por cobrar" value={<>{money(abierto.por_cobrar)}{abierto.revisar && <span className="txt-alerta"> ⚠</span>}</>} />
            </div>
            <h3 className="sub-h">Pagos ({abierto.pagos.length})</h3>
            <Tabla rows={abierto.pagos} porPagina={20} vacio="Sin pagos cargados"
              cols={[{ k: "f", label: "Fecha", get: (p) => fecha(p.fecha) }, { k: "t", label: "Tipo", align: "l", get: (p) => p.tipo }, { k: "m", label: "Monto", get: (p) => <Valor k="m" v={p.monto} /> }]} />
            {abierto.cobranzas > 0 && <p className="nota">Incluye {money(abierto.cobranzas)} de cobranzas (recurrencia), que no descuentan del por cobrar.</p>}
            {abierto.notas && <><h3 className="sub-h">Notas comerciales</h3><p className="nota">{abierto.notas}</p></>}
            <p className="nota">{num(abierto.pagos.length)} movimientos · fuente: Tracker</p>
          </aside>
        </div>
      )}
    </div>
  );
}

// Por cobrar con barra de progreso cobrado / vendido
function PorCobrar({ c }: { c: ClienteT }) {
  const r = c.vendido > 0 ? Math.min(1, c.cobrado / c.vendido) : null;
  return (
    <span className="por-cobrar">
      {r != null && <span className="mini" title={`Cobrado ${Math.round(r * 100)}%`}><span style={{ width: `${r * 100}%` }} /></span>}
      <span className="v-m">{money(c.por_cobrar)}</span>{c.revisar && <span className="txt-alerta" title="Cobrado mayor que vendido: revisar"> ⚠</span>}
    </span>
  );
}
