import { useEffect, useMemo, useState } from "react";
import { supabase, type ComercialData, type FunnelRow } from "../lib/supabase";
import { money, num, pct, ratio, tiempo } from "../lib/format";
import { VistaEmpresa } from "./VistaEmpresa";
import { Setter } from "./Setter";

const PRODUCTOS = ["DFY", "JessiK", "Sin definir"] as const;

// Más cierres que asistencias = cierres de llamadas anteriores al período (o al GHL nuevo): el % no aplica
const closeRate = (cierres: number, asistencias: number) => (cierres > asistencias ? null : ratio(cierres, asistencias));

// Variación contra el período anterior del mismo largo
function delta(a: number, b: number) {
  if (!b) return "";
  const d = (a - b) / b;
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(0)}% vs anterior`;
}

export function Comercial({ from, to, reloadKey }: { from: string; to: string; reloadKey: number }) {
  const [data, setData] = useState<ComercialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [closer, setCloser] = useState("Todos");
  const [conHistorico, setConHistorico] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    supabase.rpc("comercial", { p_from: from, p_to: to }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setErr(error.message);
      setData((data as ComercialData) ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [from, to, reloadKey]);

  const f = (producto: string, periodo = "actual"): FunnelRow | undefined =>
    data?.funnel.find((r) => r.producto === producto && r.periodo === periodo);
  const t = f("Total");
  const p = f("Total", "anterior");

  const closers = useMemo(() => ["Todos", ...(data?.closers ?? []).map((c) => c.closer)], [data]);
  const keep = <T extends { closer: string | null; historico?: boolean }>(xs: T[]) =>
    xs.filter((x) => (closer === "Todos" || x.closer === closer) && (conHistorico || !x.historico));
  const seguimientos = keep(data?.seguimientos ?? []);
  const calidad = keep(data?.calidad ?? []);
  const calidadPorProblema = useMemo(() => {
    const m = new Map<string, typeof calidad>();
    for (const q of calidad) m.set(q.problema, [...(m.get(q.problema) ?? []), q]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [calidad]);
  const objeciones = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const o of data?.objeciones ?? []) m.set(o.motivo, { ...(m.get(o.motivo) ?? {}), [o.producto]: o.n });
    return [...m.entries()].map(([motivo, n]) => ({ motivo, n, total: Object.values(n).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  }, [data]);
  const maxObj = Math.max(1, ...objeciones.map((o) => o.total));

  const dfy = f("DFY"), jes = f("JessiK"), sd = f("Sin definir");
  // [título, valor, subtítulo, explicación al pasar el mouse]
  const kpis: [string, string, string?, string?][] = t && p
    ? [
        ["Agendas brutas", num(t.agendas), `${num(dfy?.agendas)} DFY · ${num(jes?.agendas)} JessiK · ${num(sd?.agendas)} no califican · ${delta(t.agendas, p.agendas)}`,
          "Personas que reservaron una llamada en el período (por fecha de reserva), califiquen o no. DFY = facturan US$20k+/mes; JessiK = US$10k–20k (antes del 25-10, US$5k–20k); no califican = menos de US$10k o sin respuesta."],
        ["Llamadas programadas", num(t.llamadas), `${num(t.canceladas)} canceladas o reagendadas aparte`,
          "Citas cuya fecha de llamada cae en el período y no fueron canceladas. Puede incluir reservas de períodos anteriores."],
        ["Show rate", pct(ratio(t.asistencias, t.llamadas_pasadas), 0), `${num(t.asistencias)} asistencias de ${num(t.llamadas_pasadas)} llamadas que ya pasaron · ${num(t.llamadas - t.llamadas_pasadas)} por venir`,
          "Asistencias ÷ llamadas programadas que ya ocurrieron (las que todavía no pasaron no cuentan). Asistió = “¿Asistió?” en Sí, o la oportunidad pasó a P1, P3, P5, Reserva, 2da llamada o Cerrado."],
        ["Tiempo de contacto", tiempo(data?.setter?.mediana_min),
          data?.setter?.agendas
            ? `${pct(ratio(data.setter.contactadas_antes, data.setter.agendas), 0)} contactadas antes de la llamada · ${num(data.setter.sin_contactar_ahora)} sin contactar ahora`
            : `Se mide desde el ${data?.setter?.desde?.split("-").reverse().slice(0, 2).join("/") ?? "26/10"}`,
          "Mediana desde que la oportunidad entra en “Agenda” hasta que la setter la pasa a “Agenda Contactada”. Detalle en la sección Setter."],
        ["Ofertas", num(t.ofertas), `${pct(ratio(t.ofertas, t.asistencias), 0)} de las asistencias`, "Asistencias con “¿Se realizó la oferta?” = Sí."],
        ["Cierres", num(t.cierres), t.cierres_nuevos + t.cierres_seguimiento ? `${num(t.cierres_nuevos)} nuevos · ${num(t.cierres_seguimiento)} de seguimiento` : undefined,
          "Ventas ganadas por fecha de cierre. Nuevo = la primera llamada fue en el mismo mes; de seguimiento = en un mes anterior."],
        ["Vendido", money(t.vendido), delta(t.vendido, p.vendido), "Suma del valor de los contratos cerrados en el período."],
        ["Cobrado", money(t.cobrado), `${pct(ratio(t.cobrado, t.vendido), 0)} de lo vendido`, "Efectivo cobrado de las ventas cerradas en el período."],
        ["Cash pendiente", money(t.vendido - t.cobrado), "Vendido − cobrado de esas ventas"],
        ["Ticket promedio", money(t.cierres ? t.cobrado / t.cierres : null), `Cobrado ÷ cierres · contrato promedio ${money(t.cierres ? t.vendido / t.cierres : null)}`],
      ]
    : [];

  return (
    <>
      {err && <p className="error">Error: {err}</p>}

      <VistaEmpresa from={from} to={to} reloadKey={reloadKey} />

      <section className="kpis" aria-busy={loading}>
        {kpis.map(([label, value, sub, help]) => (
          <div key={label} className="kpi" title={help}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{value}</div>
            {sub && <div className="kpi-sub">{sub}</div>}
          </div>
        ))}
      </section>

      <section className="card table-card">
        <div className="table-head">
          <h2 className="section-title">DFY vs JessiK</h2>
          <span className="muted">Producto = campo “Oferta” de la oportunidad; si está vacío, la facturación que respondió en el formulario</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="name">Producto</th>
                <th>Agendas</th><th>Llamadas</th><th>Asistencias</th><th title="Asistencias ÷ llamadas que ya pasaron">Show rate</th><th>Ofertas</th><th>Cierres</th><th>% cierre</th><th>Vendido</th><th>Cobrado</th><th>Ticket</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTOS.map((k) => {
                const r = f(k);
                if (!r) return null;
                return (
                  <tr key={k} className={k === "Sin definir" ? "dim" : ""}>
                    <td className="name">{k}</td>
                    <td>{num(r.agendas)}</td>
                    <td>{num(r.llamadas)}</td>
                    <td>{num(r.asistencias)}</td>
                    <td>{pct(ratio(r.asistencias, r.llamadas_pasadas), 0)}</td>
                    <td>{num(r.ofertas)}</td>
                    <td>{num(r.cierres)}</td>
                    <td>{pct(closeRate(r.cierres, r.asistencias), 0)}</td>
                    <td>{money(r.vendido)}</td>
                    <td>{money(r.cobrado)}</td>
                    <td>{money(r.cierres ? r.cobrado / r.cierres : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card">
        <div className="table-head">
          <h2 className="section-title">Closers</h2>
          <span className="muted">Comisión: 3% DFY / 5% JessiK sobre lo cobrado</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="name">Closer</th>
                <th>Llamadas</th><th>Asistencias</th><th title="Asistencias ÷ llamadas que ya pasaron">Show rate</th><th>Ofertas</th><th>Cierres</th><th>% cierre</th><th>Vendido</th><th>Cobrado</th><th>Comisión</th><th>En seguimiento</th>
              </tr>
            </thead>
            <tbody>
              {(data?.closers ?? []).map((c) => (
                <tr key={c.closer} className={c.active ? "" : "dim"}>
                  <td className="name">{c.closer}{!c.active && <span className="sub"> · inactivo</span>}</td>
                  <td>{num(c.llamadas)}</td>
                  <td>{num(c.asistencias)}</td>
                  <td>{pct(ratio(c.asistencias, c.llamadas_pasadas), 0)}</td>
                  <td>{num(c.ofertas)}</td>
                  <td>{num(c.cierres)}</td>
                  <td>{pct(closeRate(c.cierres, c.asistencias), 0)}</td>
                  <td>{money(Number(c.vendido))}</td>
                  <td>{money(Number(c.cobrado))}</td>
                  <td>{c.closer === "Ale" ? "—" : money(Number(c.comision))}</td>
                  <td>{num(c.en_seguimiento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Setter from={from} to={to} reloadKey={reloadKey} />

      <section className="card table-card">
        <div className="table-head">
          <h2 className="section-title">Cierres · {data?.cierres.length ?? 0}</h2>
          <span className="muted">Por fecha de cierre · vendido {money(t?.vendido)} · cobrado {money(t?.cobrado)}</span>
        </div>
        <div className="table-wrap">
          <table className="cierres">
            <thead>
              <tr>
                <th>Fecha</th><th className="name">Cliente</th><th>Closer</th><th>Producto</th><th>Vendido</th><th>Cobrado</th><th>Plan</th><th>Método</th><th>Días a cierre</th><th>Fuente</th>
              </tr>
            </thead>
            <tbody>
              {(data?.cierres ?? []).map((x, i) => (
                <tr key={`${x.nombre}-${i}`}>
                  <td>{x.fecha_cierre}</td>
                  <td className="name">{x.nombre ?? "—"}</td>
                  <td>{x.closer ?? "—"}</td>
                  <td>{x.producto}</td>
                  <td>{money(Number(x.valor))}</td>
                  <td>{money(Number(x.cobrado))}</td>
                  <td>{x.plan_pago ?? "—"}</td>
                  <td>{x.metodo_cobro ?? "—"}</td>
                  <td>{x.dias_a_cierre ?? "—"}</td>
                  <td>{x.fuente ?? "—"}</td>
                </tr>
              ))}
              {!loading && !data?.cierres.length && (
                <tr><td colSpan={10} className="empty">Sin cierres en este período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="filters">
        <label className="inline">
          Closer
          <select value={closer} onChange={(e) => setCloser(e.target.value)}>
            {closers.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={conHistorico} onChange={(e) => setConHistorico(e.target.checked)} />
          Incluir oportunidades del histórico importado
        </label>
      </div>

      <section className="card table-card">
        <div className="table-head">
          <h2 className="section-title">Seguimientos vencidos · {seguimientos.length}</h2>
          <span className="muted">En P1, P3, P5, Reserva o 2da llamada, con la fecha de próximo seguimiento vencida o sin cargar</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="name">Cliente</th><th>Closer</th><th>Producto</th><th>Etapa</th><th>Motivo</th><th>Próximo seguimiento</th><th>Días en la etapa</th>
              </tr>
            </thead>
            <tbody>
              {seguimientos.map((s) => (
                <tr key={s.id}>
                  <td className="name">{s.nombre ?? "—"}</td>
                  <td>{s.closer ?? "—"}</td>
                  <td>{s.producto}</td>
                  <td>{s.etapa}</td>
                  <td>{s.motivo ?? "—"}</td>
                  <td className={s.proximo_seguimiento ? "" : "warn"}>{s.proximo_seguimiento ?? "Sin fecha"}</td>
                  <td>{s.dias_en_etapa ?? "—"}</td>
                </tr>
              ))}
              {!loading && seguimientos.length === 0 && (
                <tr><td colSpan={7} className="empty">Nada vencido.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="split">
        <div className="card table-card">
          <div className="table-head">
            <h2 className="section-title">Objeciones</h2>
            <span className="muted">Motivo de no venta de las llamadas del período</span>
          </div>
          {objeciones.length === 0 && <p className="empty">Todavía no hay motivos cargados en este período.</p>}
          <ul className="bars">
            {objeciones.map((o) => (
              <li key={o.motivo}>
                <span className="bar-label">{o.motivo}</span>
                <span className="bar-track">
                  <span className="bar" style={{ width: `${(o.total / maxObj) * 100}%` }} />
                </span>
                <span className="bar-n" title={Object.entries(o.n).map(([k, v]) => `${k}: ${v}`).join(" · ")}>{o.total}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card table-card">
          <div className="table-head">
            <h2 className="section-title">Calidad de datos · {calidad.length}</h2>
            <span className="muted">Lo que falta completar en GHL</span>
          </div>
          {calidadPorProblema.length === 0 && <p className="empty">Todo completo.</p>}
          <ul className="issues">
            {calidadPorProblema.map(([problema, items]) => (
              <li key={problema}>
                <button className="issue" onClick={() => setAbierto((a) => (a === problema ? null : problema))} aria-expanded={abierto === problema}>
                  <span>{problema}</span>
                  <b>{items.length}</b>
                </button>
                {abierto === problema && (
                  <ul className="issue-list">
                    {items.map((q) => (
                      <li key={q.id}>
                        {q.nombre ?? "—"} <span className="sub">· {q.closer ?? "sin closer"} · {q.etapa}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="foot muted">
        <p>
          Fuente: GHL StartFly (pipeline “2. Leads (Agendado) - Venta”), en vivo cada 20 minutos. Antes del 21-10 (migración), llamadas y agendas salen del archivo congelado
          (hoja “Llamadas” y GHL viejo); las ventas salen SOLO de las oportunidades Won del pipeline de Venta. Agendas por fecha de reserva; llamadas, asistencias y ofertas por fecha de llamada;
          cierres, vendido y cobrado por fecha de cierre. Asistió = “¿Asistió?” en Sí, cita marcada como asistida, o la oportunidad ya pasó a P1/P3/P5/Reserva/Cerrado.
          Cobrado = campo “$Efectivo recolectado” hasta que se conecten Whop y Stripe.
        </p>
      </footer>
    </>
  );
}
