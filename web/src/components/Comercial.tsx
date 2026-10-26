import { useEffect, useMemo, useState } from "react";
import { supabase, type ComercialData, type FunnelRow } from "../lib/supabase";
import { money, num, pct, ratio, tiempo } from "../lib/format";
import { VistaEmpresa } from "./VistaEmpresa";
import { Setter } from "./Setter";

const OFERTAS = ["DFY", "JessiK"] as const;
type Oferta = "Todas" | (typeof OFERTAS)[number];
const OFERTA_LABEL: Record<string, string> = { DFY: "DFY $30k", JessiK: "JessiK $10k" };

// Más cierres que asistencias = cierres de llamadas anteriores al período (o al GHL nuevo): el % no aplica
const closeRate = (cierres: number, asistencias: number) => (cierres > asistencias ? null : ratio(cierres, asistencias));

// Variación contra el período anterior del mismo largo
function delta(a: number, b: number) {
  if (!b) return "";
  const d = (a - b) / b;
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(0)}% vs anterior`;
}

const chipClass = (producto: string | null | undefined) =>
  `chip ${producto === "DFY" ? "chip-dfy" : producto === "JessiK" ? "chip-jessik" : "chip-none"}`;
const Chip = ({ p }: { p: string | null | undefined }) => <span className={chipClass(p)}>{p ?? "—"}</span>;

// Tasa con color: verde si llega a la meta, rojo si queda muy abajo
function Rate({ v, meta }: { v: number | null; meta: number }) {
  const cls = v == null ? "" : v >= meta ? "rate-good" : v < meta * 0.6 ? "rate-bad" : "rate-mid";
  return <span className={`rate ${cls}`}>{pct(v, 0)}</span>;
}

type Kpi = { label: string; value: string; sub?: string; help?: string };

function KpiGroup({ title, tone, items, loading }: { title: string; tone: string; items: Kpi[]; loading: boolean }) {
  return (
    <section className={`kpi-group tone-${tone}`} aria-busy={loading}>
      <h3 className="kpi-group-title">{title}</h3>
      <div className="kpis">
        {items.map((k) => (
          <div key={k.label} className="kpi" title={k.help}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            {k.sub && <div className="kpi-sub">{k.sub}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// Embudo de una oferta: cada barra relativa a las agendas
function OfertaCard({ producto, r }: { producto: string; r: FunnelRow | undefined }) {
  const base = Math.max(1, r?.agendas ?? 0, r?.llamadas ?? 0);
  const pasos: [string, number, string][] = r
    ? [
        ["Agendas", r.agendas, ""],
        ["Llamadas", r.llamadas, ""],
        ["Asistencias", r.asistencias, pct(ratio(r.asistencias, r.llamadas_pasadas), 0) + " show"],
        ["Ofertas", r.ofertas, pct(ratio(r.ofertas, r.asistencias), 0) + " de asist."],
        ["Cierres", r.cierres, pct(closeRate(r.cierres, r.asistencias), 0) + " cierre"],
      ]
    : [];
  return (
    <div className={`card oferta-card ${producto === "DFY" ? "of-dfy" : "of-jessik"}`}>
      <div className="oferta-head">
        <h3>{OFERTA_LABEL[producto]}</h3>
        <div className="oferta-money">
          <span><b>{money(r?.vendido)}</b> vendido</span>
          <span><b>{money(r?.cobrado)}</b> cobrado</span>
          <span><b>{money(r?.cierres ? r.cobrado / r.cierres : null)}</b> ticket</span>
        </div>
      </div>
      <ul className="funnel">
        {pasos.map(([label, n, tasa]) => (
          <li key={label}>
            <span className="funnel-label">{label}</span>
            <span className="funnel-track"><span className="funnel-bar" style={{ width: `${(n / base) * 100}%` }} /></span>
            <span className="funnel-n">{num(n)}</span>
            <span className="funnel-rate">{tasa}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Comercial({ from, to, reloadKey }: { from: string; to: string; reloadKey: number }) {
  const [data, setData] = useState<ComercialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [closer, setCloser] = useState("Todos");
  const [oferta, setOferta] = useState<Oferta>("Todas");
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
  const deOferta = (x: string | null | undefined) => oferta === "Todas" || x === oferta;
  const keep = <T extends { closer: string | null; historico?: boolean; producto?: string | null }>(xs: T[]) =>
    xs.filter((x) => (closer === "Todos" || x.closer === closer) && (conHistorico || !x.historico) && deOferta(x.producto));
  const seguimientos = keep(data?.seguimientos ?? []);
  const calidad = keep(data?.calidad ?? []);
  const cierres = (data?.cierres ?? []).filter((x) => deOferta(x.producto));
  const calidadPorProblema = useMemo(() => {
    const m = new Map<string, typeof calidad>();
    for (const q of calidad) m.set(q.problema, [...(m.get(q.problema) ?? []), q]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [calidad]);
  // Objeciones por oferta, ordenadas de más a menos
  const objeciones = useMemo(() => {
    const por: Record<string, { motivo: string; n: number }[]> = {};
    for (const k of OFERTAS) {
      const m = new Map<string, number>();
      for (const o of data?.objeciones ?? []) if (o.producto === k) m.set(o.motivo, (m.get(o.motivo) ?? 0) + o.n);
      por[k] = [...m.entries()].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n);
    }
    return por;
  }, [data]);
  const ofertasVisibles = OFERTAS.filter((k) => oferta === "Todas" || k === oferta);

  const dfy = f("DFY"), jes = f("JessiK");
  const embudo: Kpi[] = t && p
    ? [
        { label: "Agendas calificadas", value: num(t.agendas), sub: `${num(dfy?.agendas)} DFY · ${num(jes?.agendas)} JessiK · ${delta(t.agendas, p.agendas)}`,
          help: "Reservas calificadas (DFY o JessiK) y no canceladas, por fecha de reserva. Hasta el 30-09 = filas de la hoja Llamadas." },
        { label: "Llamadas programadas", value: num(t.llamadas), sub: `${num(t.canceladas)} canceladas o reagendadas aparte`,
          help: "Citas cuya fecha de llamada cae en el período y no fueron canceladas." },
        { label: "Show rate", value: pct(ratio(t.asistencias, t.llamadas_pasadas), 0), sub: `${num(t.asistencias)} de ${num(t.llamadas_pasadas)} que ya pasaron · ${num(t.llamadas - t.llamadas_pasadas)} por venir`,
          help: "Asistencias ÷ llamadas que ya ocurrieron. Asistió = “¿Asistió?” en Sí, o la oportunidad pasó a P1, P3, P5, Reserva, 2da llamada o Cerrado." },
        { label: "Tiempo de contacto", value: tiempo(data?.setter?.mediana_min),
          sub: data?.setter?.agendas
            ? `${pct(ratio(data.setter.contactadas_antes, data.setter.agendas), 0)} contactadas antes de la llamada · ${num(data.setter.sin_contactar_ahora)} sin contactar`
            : `Se mide desde el ${data?.setter?.desde?.split("-").reverse().slice(0, 2).join("/") ?? "26/10"}`,
          help: "Mediana desde que la oportunidad entra en “Agenda” hasta “Agenda Contactada”." },
        { label: "Ofertas", value: num(t.ofertas), sub: `${pct(ratio(t.ofertas, t.asistencias), 0)} de las asistencias`, help: "Asistencias con “¿Se realizó la oferta?” = Sí." },
      ]
    : [];
  const ventas: Kpi[] = t && p
    ? [
        { label: "Cierres", value: num(t.cierres), sub: t.cierres_nuevos + t.cierres_seguimiento ? `${num(t.cierres_nuevos)} nuevos · ${num(t.cierres_seguimiento)} de seguimiento` : undefined,
          help: "Ventas ganadas por fecha de cierre. Nuevo = primera llamada en el mismo mes; de seguimiento = de un mes anterior." },
        { label: "Vendido", value: money(t.vendido), sub: delta(t.vendido, p.vendido), help: "Valor de los contratos cerrados en el período." },
        { label: "Cobrado", value: money(t.cobrado), sub: `${pct(ratio(t.cobrado, t.vendido), 0)} de lo vendido`, help: "Efectivo cobrado de las ventas cerradas en el período." },
        { label: "Cash pendiente", value: money(t.vendido - t.cobrado), sub: "Vendido − cobrado de esas ventas" },
        { label: "Ticket promedio", value: money(t.cierres ? t.cobrado / t.cierres : null), sub: `Contrato promedio ${money(t.cierres ? t.vendido / t.cierres : null)}` },
      ]
    : [];

  return (
    <>
      {err && <p className="error">Error: {err}</p>}

      <VistaEmpresa from={from} to={to} reloadKey={reloadKey} />

      <div className="kpi-groups">
        <KpiGroup title="Embudo" tone="embudo" items={embudo} loading={loading} />
        <KpiGroup title="Ventas" tone="ventas" items={ventas} loading={loading} />
      </div>

      <section className="ofertas">
        <OfertaCard producto="DFY" r={dfy} />
        <OfertaCard producto="JessiK" r={jes} />
      </section>

      <section className="card table-card tone-closers">
        <div className="table-head">
          <h2 className="section-title"><i className="dot" />Closers</h2>
          <span className="muted">Comisión: 3% DFY / 5% JessiK sobre lo cobrado · tasas en verde = en meta</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="name">Closer</th>
                <th>Llamadas</th><th>Asistencias</th><th title="Asistencias ÷ llamadas que ya pasaron · meta 60%">Show rate</th><th>Ofertas</th><th>Cierres</th><th title="Cierres ÷ asistencias · meta 20%">% cierre</th><th>Vendido</th><th>Cobrado</th><th>Comisión</th><th>En seguimiento</th>
              </tr>
            </thead>
            <tbody>
              {(data?.closers ?? []).map((c) => (
                <tr key={c.closer} className={c.active ? "" : "dim"}>
                  <td className="name"><b>{c.closer}</b>{!c.active && <span className="sub"> · inactivo</span>}</td>
                  <td>{num(c.llamadas)}</td>
                  <td>{num(c.asistencias)}</td>
                  <td><Rate v={ratio(c.asistencias, c.llamadas_pasadas)} meta={0.6} /></td>
                  <td>{num(c.ofertas)}</td>
                  <td>{num(c.cierres)}</td>
                  <td><Rate v={closeRate(c.cierres, c.asistencias)} meta={0.2} /></td>
                  <td className="money">{money(Number(c.vendido))}</td>
                  <td className="money">{money(Number(c.cobrado))}</td>
                  <td>{c.closer === "Ale" ? "—" : money(Number(c.comision))}</td>
                  <td>{num(c.en_seguimiento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Setter from={from} to={to} reloadKey={reloadKey} />

      <div className="detalle-bar card">
        <div>
          <h2 className="section-title">Detalle por oferta</h2>
          <span className="muted">Cierres, seguimientos, objeciones y pendientes de GHL</span>
        </div>
        <div className="filters">
          <div className="seg seg-oferta" role="tablist" aria-label="Oferta">
            {(["Todas", ...OFERTAS] as Oferta[]).map((k) => (
              <button key={k} className={`${oferta === k ? "on" : ""} o-${k.toLowerCase()}`} onClick={() => setOferta(k)}>
                {k === "Todas" ? "Todas" : OFERTA_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="inline">
            Closer
            <select value={closer} onChange={(e) => setCloser(e.target.value)}>
              {closers.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={conHistorico} onChange={(e) => setConHistorico(e.target.checked)} />
            Incluir histórico importado
          </label>
        </div>
      </div>

      <section className={`split split-${ofertasVisibles.length}`}>
        {ofertasVisibles.map((k) => {
          const xs = objeciones[k];
          const max = Math.max(1, ...xs.map((o) => o.n));
          return (
            <div key={k} className={`card table-card ${k === "DFY" ? "of-dfy" : "of-jessik"}`}>
              <div className="table-head">
                <h2 className="section-title"><i className="dot" />Objeciones · {OFERTA_LABEL[k]}</h2>
                <span className="muted">{xs.reduce((a, o) => a + o.n, 0)} motivos de no venta</span>
              </div>
              {xs.length === 0 && <p className="empty">Sin motivos cargados en este período.</p>}
              <ul className="bars">
                {xs.map((o) => (
                  <li key={o.motivo}>
                    <span className="bar-label">{o.motivo}</span>
                    <span className="bar-track"><span className="bar" style={{ width: `${(o.n / max) * 100}%` }} /></span>
                    <span className="bar-n">{o.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="card table-card tone-ventas">
        <div className="table-head">
          <h2 className="section-title"><i className="dot" />Cierres · {cierres.length}</h2>
          <span className="muted">Por fecha de cierre · vendido {money(cierres.reduce((a, x) => a + Number(x.valor), 0))} · cobrado {money(cierres.reduce((a, x) => a + Number(x.cobrado), 0))}</span>
        </div>
        <div className="table-wrap">
          <table className="cierres">
            <thead>
              <tr>
                <th>Fecha</th><th className="name">Cliente</th><th>Closer</th><th>Oferta</th><th>Vendido</th><th>Cobrado</th><th>Plan</th><th>Método</th><th>Días a cierre</th><th>Fuente</th>
              </tr>
            </thead>
            <tbody>
              {cierres.map((x, i) => (
                <tr key={`${x.nombre}-${i}`}>
                  <td>{x.fecha_cierre}</td>
                  <td className="name">{x.nombre ?? "—"}</td>
                  <td>{x.closer ?? "—"}</td>
                  <td><Chip p={x.producto} /></td>
                  <td className="money">{money(Number(x.valor))}</td>
                  <td className="money">{money(Number(x.cobrado))}</td>
                  <td>{x.plan_pago ?? "—"}</td>
                  <td>{x.metodo_cobro ?? "—"}</td>
                  <td>{x.dias_a_cierre ?? "—"}</td>
                  <td>{x.fuente ?? "—"}</td>
                </tr>
              ))}
              {!loading && !cierres.length && (
                <tr><td colSpan={10} className="empty">Sin cierres en este período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card tone-alerta">
        <div className="table-head">
          <h2 className="section-title"><i className="dot" />Seguimientos vencidos · {seguimientos.length}</h2>
          <span className="muted">En P1, P3, P5, Reserva o 2da llamada, con la fecha de próximo seguimiento vencida o sin cargar</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="name">Cliente</th><th>Closer</th><th>Oferta</th><th>Etapa</th><th>Motivo</th><th>Próximo seguimiento</th><th>Días en la etapa</th>
              </tr>
            </thead>
            <tbody>
              {seguimientos.map((s) => (
                <tr key={s.id}>
                  <td className="name">{s.nombre ?? "—"}</td>
                  <td>{s.closer ?? "—"}</td>
                  <td><Chip p={s.producto} /></td>
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

      <section className="card table-card tone-alerta">
        <div className="table-head">
          <h2 className="section-title"><i className="dot" />Calidad de datos · {calidad.length}</h2>
          <span className="muted">Lo que falta completar en GHL · tocá un pendiente para ver los nombres</span>
        </div>
        {calidadPorProblema.length === 0 && <p className="empty">Todo completo.</p>}
        <ul className="issues">
          {calidadPorProblema.map(([problema, items]) => (
            <li key={problema}>
              <button className="issue" onClick={() => setAbierto((a) => (a === problema ? null : problema))} aria-expanded={abierto === problema}>
                <span>{problema}</span>
                <b className="issue-n">{items.length}</b>
              </button>
              {abierto === problema && (
                <ul className="issue-list">
                  {items.map((q) => (
                    <li key={q.id}>
                      {q.nombre ?? "—"} <Chip p={q.producto} /> <span className="sub">· {q.closer ?? "sin closer"} · {q.etapa}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <footer className="foot muted">
        <p>
          Fuente: GHL StartFly (pipeline “2. Leads (Agendado) - Venta”), en vivo cada 20 minutos. Agendas hasta el 30-09 y llamadas, asistencias y ofertas hasta el 21-10
          son copia exacta de la hoja “Llamadas”; agendas del 01-10 al 21-10 del GHL viejo; las ventas salen SOLO de las oportunidades Won del pipeline de Venta. Agendas por fecha de reserva;
          llamadas, asistencias y ofertas por fecha de llamada; cierres, vendido y cobrado por fecha de cierre. Cobrado = campo “$Efectivo recolectado” hasta que se conecten Whop y Stripe.
        </p>
      </footer>
    </>
  );
}
