import { useEffect, useMemo, useState } from "react";
import { supabase, type MiDiaData } from "../lib/supabase";

const LOC = "fssMXOOdUdCpuTFkSTGc";
const ghl = (contactId: string | null) => (contactId ? `https://app.gohighlevel.com/v2/location/${LOC}/contacts/detail/${contactId}` : undefined);
const CLOSERS = ["Todos", "Luca", "Jenny", "Eduardo", "Ale"];

// Agenda del closer: llamadas de hoy y mañana, seguimientos de la semana y lo que falta completar en GHL.
export function MiDia({ esCloser, reloadKey }: { esCloser: boolean; reloadKey: number }) {
  const [closer, setCloser] = useState("Todos");
  const [data, setData] = useState<MiDiaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [conHistorico, setConHistorico] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase.rpc("mi_dia", { p_closer: esCloser || closer === "Todos" ? null : closer }).then(({ data, error }) => {
      if (!alive) return;
      setErr(error?.message ?? null);
      setData((data as MiDiaData) ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [closer, esCloser, reloadKey]);

  const hoy = data?.hoy;
  const llamadasHoy = (data?.llamadas ?? []).filter((l) => l.dia === hoy);
  const llamadasManana = (data?.llamadas ?? []).filter((l) => l.dia !== hoy);
  const seguimientos = (data?.seguimientos ?? []).filter((s) => conHistorico || !s.historico);
  const vencidos = seguimientos.filter((s) => !s.proximo_seguimiento || (hoy && s.proximo_seguimiento <= hoy));
  const proximos = seguimientos.filter((s) => s.proximo_seguimiento && hoy && s.proximo_seguimiento > hoy);
  const pendientes = useMemo(() => {
    const m = new Map<string, NonNullable<MiDiaData["pendientes"]>>();
    for (const p of data?.pendientes ?? []) if (conHistorico || !p.historico) m.set(p.problema, [...(m.get(p.problema) ?? []), p]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [data, conHistorico]);
  const nPend = pendientes.reduce((t, [, xs]) => t + xs.length, 0);
  const verCloser = !esCloser && closer === "Todos";

  const tablaLlamadas = (rows: MiDiaData["llamadas"], vacio: string) => (
    <div className="table-wrap">
      <table className="cierres">
        <thead>
          <tr>
            <th>Hora</th><th className="name">Lead</th><th>Teléfono</th>{verCloser && <th>Closer</th>}<th>Producto</th><th>Ingresos</th><th className="name">Negocio</th><th>Etapa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{l.hora.slice(6)}</td>
              <td className="name">{ghl(l.contact_id) ? <a href={ghl(l.contact_id)} target="_blank" rel="noreferrer">{l.nombre ?? "—"}</a> : l.nombre ?? "—"}</td>
              <td>{l.telefono ?? "—"}</td>
              {verCloser && <td>{l.closer}</td>}
              <td>{l.producto}</td>
              <td>{l.ingresos ?? "—"}</td>
              <td className="name">{l.negocio ?? "—"}</td>
              <td>{l.etapa ?? "—"}</td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={verCloser ? 8 : 7} className="empty">{vacio}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {err && <p className="error">Error: {err}</p>}
      <section className="kpis" aria-busy={loading}>
        <div className="kpi"><div className="kpi-label">Llamadas hoy</div><div className="kpi-value">{llamadasHoy.length}</div><div className="kpi-sub">{llamadasManana.length} mañana</div></div>
        <div className="kpi"><div className="kpi-label">Seguimientos vencidos</div><div className="kpi-value">{vencidos.length}</div><div className="kpi-sub">{proximos.length} en los próximos 7 días</div></div>
        <div className="kpi"><div className="kpi-label">Pendientes en GHL</div><div className="kpi-value">{nPend}</div><div className="kpi-sub">Datos que faltan completar</div></div>
      </section>

      <div className="filters">
        {!esCloser && (
          <div className="seg" role="tablist" aria-label="Closer">
            {CLOSERS.map((c) => (
              <button key={c} className={closer === c ? "on" : ""} onClick={() => setCloser(c)}>{c}</button>
            ))}
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={conHistorico} onChange={(e) => setConHistorico(e.target.checked)} />
          Incluir oportunidades del histórico importado
        </label>
      </div>

      <section className="card table-card">
        <div className="table-head"><h2 className="section-title">Llamadas de hoy · {llamadasHoy.length}</h2><span className="muted">Tocá el nombre para abrir el contacto en GHL</span></div>
        {tablaLlamadas(llamadasHoy, "No hay llamadas hoy.")}
      </section>

      <section className="card table-card">
        <div className="table-head"><h2 className="section-title">Mañana · {llamadasManana.length}</h2></div>
        {tablaLlamadas(llamadasManana, "No hay llamadas mañana.")}
      </section>

      <section className="card table-card">
        <div className="table-head">
          <h2 className="section-title">Seguimientos · {vencidos.length} vencidos, {proximos.length} esta semana</h2>
          <span className="muted">P1, P3, P5, Reserva y 2da llamada. Al contactarlo, cargá la nueva “Fecha próximo seguimiento”</span>
        </div>
        <div className="table-wrap">
          <table className="cierres">
            <thead>
              <tr><th>Fecha</th><th className="name">Lead</th><th>Teléfono</th>{verCloser && <th>Closer</th>}<th>Etapa</th><th>Producto</th><th>Motivo</th></tr>
            </thead>
            <tbody>
              {[...vencidos, ...proximos].map((s) => (
                <tr key={s.id} className={s.proximo_seguimiento && hoy && s.proximo_seguimiento > hoy ? "dim" : ""}>
                  <td className={s.proximo_seguimiento ? "" : "warn"}>{s.proximo_seguimiento ?? "Sin fecha"}</td>
                  <td className="name">{ghl(s.contact_id) ? <a href={ghl(s.contact_id)} target="_blank" rel="noreferrer">{s.nombre ?? "—"}</a> : s.nombre ?? "—"}</td>
                  <td>{s.telefono ?? "—"}</td>
                  {verCloser && <td>{s.closer ?? "—"}</td>}
                  <td>{s.etapa}</td>
                  <td>{s.producto}</td>
                  <td>{s.motivo ?? "—"}</td>
                </tr>
              ))}
              {!loading && seguimientos.length === 0 && (
                <tr><td colSpan={verCloser ? 7 : 6} className="empty">Nada pendiente esta semana.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card">
        <div className="table-head"><h2 className="section-title">Pendientes de completar en GHL · {nPend}</h2><span className="muted">Tocá un pendiente para ver los nombres</span></div>
        {pendientes.length === 0 && <p className="empty">Todo completo.</p>}
        <ul className="issues">
          {pendientes.map(([problema, items]) => (
            <li key={problema}>
              <button className="issue" onClick={() => setAbierto((a) => (a === problema ? null : problema))} aria-expanded={abierto === problema}>
                <span>{problema}</span>
                <b>{items.length}</b>
              </button>
              {abierto === problema && (
                <ul className="issue-list">
                  {items.map((q) => (
                    <li key={`${q.id}-${problema}`}>
                      {ghl(q.contact_id) ? <a href={ghl(q.contact_id)} target="_blank" rel="noreferrer">{q.nombre ?? "—"}</a> : q.nombre ?? "—"}
                      <span className="sub"> · {verCloser ? `${q.closer ?? "sin closer"} · ` : ""}{q.etapa}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
