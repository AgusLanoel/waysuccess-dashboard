import { useMemo, useState } from "react";
import { cobranza, derivadas, variacion, type DashDatos, type Filtros } from "../../lib/metricas";
import { Barras, C, ChipProd, Kpi, Panel, Seg, Tabla, fecha, money, num, pct } from "../ui";

type Vista = "pagos" | "clientes" | "cierres";
export function Cobranza({ d, f, from, to }: { d: DashDatos; f: Filtros; from: string; to: string }) {
  const [vista, setVista] = useState<Vista>("pagos");
  const [porCliente, setPorCliente] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const c = useMemo(() => cobranza(d, f, from, to), [d, f, from, to]);
  const der = derivadas(c.b), derAnt = c.bAnt ? derivadas(c.bAnt) : null;
  const pagosAgrupados = useMemo(() => {
    if (!porCliente) return c.pagos;
    const m = new Map<string, typeof c.pagos[number]>();
    for (const p of c.pagos) { const k = p.cliente ?? "—"; const x = m.get(k); m.set(k, x ? { ...x, cobrado: (x.cobrado ?? 0) + (p.cobrado ?? 0), alerta: x.alerta || p.alerta } : { ...p }); }
    return [...m.values()];
  }, [c.pagos, porCliente]);
  const cliente = c.clientes.find((x) => x.id === abierto);

  return (
    <div className="tab-col">
      <div className="kpis5">
        <Kpi label="Cobrado" value={money(c.b.cobrado)} sub="de cierres del período" delta={variacion("m", c.b.cobrado, c.bAnt?.cobrado ?? null)} />
        <Kpi label="Cobrado en seguimiento" value={money(c.b.cobrado_seguimiento)} sub="fuente: Tracker" delta={variacion("m", c.b.cobrado_seguimiento, c.bAnt?.cobrado_seguimiento ?? null)} />
        <Kpi label="Cobrado total" value={money(c.b.cobrado_total)} delta={variacion("m", c.b.cobrado_total, c.bAnt?.cobrado_total ?? null)} />
        <Kpi label="% Recolección" value={pct(der.pct_recoleccion)} sub="cobrado ÷ vendido" delta={variacion("p", der.pct_recoleccion, derAnt?.pct_recoleccion ?? null)} />
        <Kpi label="Por cobrar" value={money(c.porCobrarTotal)} sub="vendido − cobrado de clientes desde el 01/10" />
      </div>
      <div className="fila2 media">
        <Panel titulo="Cobrado por semana"><div className="grafico"><Barras data={c.semanal} x="label" fmt={money} series={[{ key: "cobrado", label: "Cobrado de cierres", color: C.s1, stack: "a" }, { key: "seguimiento", label: "Cobrado en seguimiento", color: C.s3, stack: "a" }]} /></div></Panel>
        <Panel titulo="Por cobrar por cliente" extra={c.porCliente.length > 8 && <button className="link" onClick={() => setVerTodos(true)}>Ver todos ({c.porCliente.length})</button>}>
          <div className="grafico"><Barras horizontal data={c.porCliente.slice(0, 8)} x="nombre" fmt={money} series={[{ key: "saldo", label: "Saldo pendiente", color: C.neutro }]} /></div>
        </Panel>
      </div>
      <Panel className="lleno" titulo={<Seg label="Detalle" value={vista} onChange={setVista} options={[["pagos", "Pagos en seguimiento"], ["clientes", "Clientes"], ["cierres", "Cierres del período"]] as const} />}
        extra={vista === "pagos" ? <Seg label="Vista" value={porCliente ? "c" : "f"} onChange={(v) => setPorCliente(v === "c")} options={[["f", "Por fecha de pago"], ["c", "Por cliente"]] as const} />
          : vista === "clientes" ? <span className="muted">Nuevos {c.clientes.filter((x) => x.tipo === "Nuevo").length} · en seguimiento {c.clientes.filter((x) => x.tipo === "Seguimiento").length} · total {c.clientes.length} · MRR {money(c.mrr)} · ARR {money(c.arr)}</span> : null}>
        {vista === "pagos" && (
          <Tabla rows={pagosAgrupados} porPagina={8} buscar={(p) => `${p.cliente ?? ""} ${p.email ?? ""}`} rowCls={(p) => (p.alerta ? "fila-roja" : "")}
            cols={[
              { k: "f", label: "Fecha de cobro", get: (p) => fecha(p.fecha) },
              { k: "c", label: "Cliente", align: "l", get: (p) => p.cliente ?? "—" },
              { k: "cl", label: "Closer", get: (p) => p.closer ?? "—" },
              { k: "fu", label: "Fuente", get: (p) => p.fuente ?? "—" },
              { k: "p", label: "Producto", get: (p) => p.producto ?? "—" },
              { k: "co", label: "Cobrado", get: (p) => money(p.cobrado) },
              { k: "v", label: "Vendido original", get: (p) => money(p.vendido_original) },
              { k: "a", label: "Cobrado acumulado", get: (p) => money(p.cobrado_acumulado) },
              { k: "s", label: "Saldo", get: (p) => money(p.saldo) },
              { k: "o", label: "Obs.", get: (p) => (p.observacion ? <span className="icono" title={p.observacion}>ⓘ</span> : "") },
            ]} vacio="Sin pagos en seguimiento en el período" />
        )}
        {vista === "clientes" && (
          <div className="fila-70-30 alto">
            <Tabla rows={c.clientes} porPagina={8} buscar={(x) => `${x.nombre ?? ""} ${x.telefono ?? ""}`} onRow={(x) => setAbierto(x.id)} rowCls={(x) => (x.cobrado > x.valor && x.valor > 0 ? "fila-roja" : abierto === x.id ? "fila-sel" : "")}
              cols={[
                { k: "f", label: "Ingreso", get: (x) => fecha(x.fecha_cierre) },
                { k: "n", label: "Cliente", align: "l", get: (x) => x.nombre ?? "—" },
                { k: "c", label: "Closer", get: (x) => x.closer ?? "—" },
                { k: "p", label: "Producto", get: (x) => <ChipProd p={x.producto} /> },
                { k: "fu", label: "Fuente", get: (x) => x.fuente ?? "—" },
                { k: "v", label: "Vendido", get: (x) => money(x.valor) },
                { k: "co", label: "Cobrado", get: (x) => money(x.cobrado_ok) },
                { k: "pc", label: "Por cobrar", get: (x) => money(x.por_cobrar) },
                { k: "t", label: "Tipo", get: (x) => x.tipo },
                { k: "m", label: "Modalidad", get: (x) => [x.plan_pago, x.metodo_cobro].filter(Boolean).join(" · ") || "—" },
              ]} vacio="Sin clientes en el período" />
            <div className="tab-col">
              <Panel titulo={cliente ? `Pagos de ${cliente.nombre}` : "Pagos del cliente"}>
                {cliente ? (cliente.pagos.length
                  ? <Tabla rows={cliente.pagos} cols={[{ k: "f", label: "Fecha", get: (p) => fecha(p.fecha) }, { k: "c", label: "Cobrado", get: (p) => money(p.cobrado) }, { k: "t", label: "Tipo", align: "l", get: (p) => p.tipo ?? "—" }]} />
                  : <p className="nota">Sin pagos en seguimiento cargados. Cobrado al cierre: {money(cliente.cobrado_ok)}.</p>) : <p className="nota">Tocá un cliente para ver sus pagos.</p>}
              </Panel>
              <Panel className="lleno" titulo="Cierres por mes"><div className="grafico"><Barras data={c.cierresPorMes} x="mes" series={[{ key: "nuevos", label: "Nuevos", color: C.s1, stack: "m" }, { key: "seguimiento", label: "En seguimiento", color: C.s3, stack: "m" }]} /></div></Panel>
            </div>
          </div>
        )}
        {vista === "cierres" && (
          <Tabla rows={c.clientes} porPagina={8} buscar={(x) => `${x.nombre ?? ""} ${x.telefono ?? ""}`} csv="cierres-del-periodo"
            cols={[
              { k: "f", label: "Fecha", get: (x) => fecha(x.fecha_cierre), csv: (x) => x.fecha_cierre },
              { k: "n", label: "Cliente", align: "l", get: (x) => x.nombre ?? "—" },
              { k: "c", label: "Closer", get: (x) => x.closer ?? "—" },
              { k: "o", label: "Oferta", get: (x) => x.producto, csv: (x) => x.producto },
              { k: "v", label: "Vendido", get: (x) => money(x.valor), csv: (x) => x.valor },
              { k: "co", label: "Cobrado", get: (x) => money(x.cobrado_ok), csv: (x) => x.cobrado_ok },
              { k: "pl", label: "Plan", get: (x) => x.plan_pago ?? "—" },
              { k: "me", label: "Método", get: (x) => x.metodo_cobro ?? "—" },
              { k: "d", label: "Días a cierre", get: (x) => num(x.dias_a_cierre), csv: (x) => x.dias_a_cierre },
              { k: "fu", label: "Fuente", get: (x) => x.fuente ?? "—" },
            ]} vacio="Sin cierres en el período" />
        )}
      </Panel>
      <p className="nota pie">Cobrado en seguimiento: fuente Tracker hasta conectar Whop y Stripe · no conciliado con banco</p>
      {verTodos && (
        <div className="overlay" onClick={() => setVerTodos(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="panel-head"><h2>Por cobrar · todos los clientes</h2><button className="link" onClick={() => setVerTodos(false)}>Cerrar ✕</button></header>
            <Tabla rows={c.porCliente} porPagina={12} buscar={(x) => x.nombre} cols={[{ k: "n", label: "Cliente", align: "l", get: (x) => x.nombre }, { k: "s", label: "Saldo", get: (x) => money(x.saldo) }]} />
          </div>
        </div>
      )}
    </div>
  );
}
