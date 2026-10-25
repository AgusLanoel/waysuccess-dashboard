import { useEffect, useState } from "react";
import { supabase, type SetterData } from "../lib/supabase";
import { num, pct, ratio, tiempo } from "../lib/format";

const LOC = "fssMXOOdUdCpuTFkSTGc";
const ghl = (contactId: string | null) => (contactId ? `https://app.gohighlevel.com/v2/location/${LOC}/contacts/detail/${contactId}` : undefined);
const hora = (s: string) =>
  new Date(s).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Trabajo de la setter: etapa "Agenda Contactada" del pipeline de Venta.
export function Setter({ from, to, reloadKey }: { from: string; to: string; reloadKey: number }) {
  const [data, setData] = useState<SetterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    supabase.rpc("setter", { p_from: from, p_to: to }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setErr(error.message);
      setData((data as SetterData) ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [from, to, reloadKey]);

  const t = data?.resumen.find((r) => r.setter === "Total");
  const porSetter = (data?.resumen ?? []).filter((r) => r.setter !== "Total");
  const pendientes = data?.pendientes ?? [];
  const porVenir = pendientes.filter((p) => !p.llamada_pasada).length;

  const kpis: [string, string, string?, string?][] = t
    ? [
        ["Sin contactar ahora", num(pendientes.length), `${num(porVenir)} con la llamada por venir · ${num(pendientes.length - porVenir)} ya pasó`,
          "Agendas abiertas en Triaje o Agenda que todavía no pasaron a “Agenda Contactada”. No depende del período."],
        ["Contactadas", pct(ratio(t.contactadas, t.agendas), 0), `${num(t.contactadas)} de ${num(t.agendas)} agendas del período`,
          "Agendas con llamada válida reservadas en el período que pasaron por “Agenda Contactada” o “Llamada Confirmada”."],
        ["Contactadas antes de la llamada", pct(ratio(t.contactadas_antes, t.agendas), 0), `${num(t.contactadas_antes)} agendas`,
          "Contactadas antes de la hora de la llamada ÷ agendas del período."],
        ["Tiempo hasta el contacto", tiempo(t.mediana_min), `Mediana · el 90% en menos de ${tiempo(t.p90_min)}`,
          "Desde que la oportunidad entró en “Agenda” hasta que pasó a “Agenda Contactada” (hora exacta de GHL). Se mide desde el 26-10."],
        ["Show rate contactadas", pct(ratio(t.asist_contactadas, t.pasadas_contactadas), 0),
          `${num(t.asist_contactadas)} de ${num(t.pasadas_contactadas)} · sin contactar ${pct(ratio(t.asist_no_contactadas, t.pasadas_no_contactadas), 0)} (${num(t.asist_no_contactadas)} de ${num(t.pasadas_no_contactadas)})`,
          "Asistencia de las llamadas que ya pasaron, separando las agendas contactadas de las que no."],
      ]
    : [];

  return (
    <>
      {err && <p className="error">Error: {err}</p>}
      <section className="card table-card" aria-busy={loading}>
        <div className="table-head">
          <h2 className="section-title">Setter · contacto de agendas</h2>
          <span className="muted">Etapa “Agenda Contactada” del pipeline de Venta · agendas que entraron desde el 26-10, por fecha de entrada a Agenda</span>
        </div>
        <section className="kpis">
          {kpis.map(([label, value, sub, help]) => (
            <div key={label} className="kpi" title={help}>
              <div className="kpi-label">{label}</div>
              <div className="kpi-value">{value}</div>
              {sub && <div className="kpi-sub">{sub}</div>}
            </div>
          ))}
        </section>
        {porSetter.length > 1 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="name">Setter</th><th>Agendas</th><th>Contactadas</th><th>Antes de la llamada</th><th>Sin contactar</th><th>Tiempo (mediana)</th>
                </tr>
              </thead>
              <tbody>
                {porSetter.map((r) => (
                  <tr key={r.setter}>
                    <td className="name">{r.setter}</td>
                    <td>{num(r.agendas)}</td>
                    <td>{pct(ratio(r.contactadas, r.agendas), 0)}</td>
                    <td>{pct(ratio(r.contactadas_antes, r.agendas), 0)}</td>
                    <td>{num(r.pendientes)}</td>
                    <td>{tiempo(r.mediana_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card table-card">
        <div className="table-head">
          <h2 className="section-title">Agendas sin contactar · {pendientes.length}</h2>
          <span className="muted">Ahora mismo, ordenadas por hora de la llamada</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="name">Lead</th><th>Teléfono</th><th>Producto</th><th>Etapa</th><th>Reservó</th><th>Esperando</th><th>Llamada</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.map((p) => (
                <tr key={p.id}>
                  <td className="name">{ghl(p.contact_id) ? <a href={ghl(p.contact_id)} target="_blank" rel="noreferrer">{p.nombre ?? "—"}</a> : p.nombre ?? "—"}</td>
                  <td>{p.telefono ?? "—"}</td>
                  <td>{p.producto}</td>
                  <td>{p.etapa}</td>
                  <td>{hora(p.agendada)}</td>
                  <td>{tiempo(p.horas_esperando * 60)}</td>
                  <td className={p.llamada_pasada ? "warn" : ""}>{hora(p.llamada)}{p.llamada_pasada && " · ya pasó"}</td>
                </tr>
              ))}
              {!loading && pendientes.length === 0 && (
                <tr><td colSpan={7} className="empty">Todas las agendas están contactadas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
