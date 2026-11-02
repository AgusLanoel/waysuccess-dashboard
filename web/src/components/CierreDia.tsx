import { useEffect, useMemo, useState } from "react";
import { supabase, type CierreDiaData } from "../lib/supabase";

const LOC = "fssMXOOdUdCpuTFkSTGc";
const ghl = (contactId: string | null) => (contactId ? `https://app.gohighlevel.com/v2/location/${LOC}/contacts/detail/${contactId}` : undefined);
const TIPOS: Record<string, string> = {
  sin_contactar: "Sin contactar",
  sin_confirmar: "Contactadas sin confirmar",
  sin_resultado: "Llamadas sin resultado",
  faltan_datos: "Etiquetas incompletas",
  perdida_sin_motivo: "Perdidas sin motivo",
  sin_oportunidad: "Llamadas sin oportunidad",
};
const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Lo que quedó sin actualizar en el CRM, por persona, para avisarle al equipo. Solo owner.
export function CierreDia({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<CierreDiaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [soloHoy, setSoloHoy] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase.rpc("control_cierre").then(({ data, error }) => {
      if (!alive) return;
      setErr(error?.message ?? null);
      setData((data as CierreDiaData) ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const items = useMemo(() => (data?.items ?? []).filter((i) => !soloHoy || i.es_de_hoy), [data, soloHoy]);
  const personas = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const i of items) m.set(i.responsable, [...(m.get(i.responsable) ?? []), i]);
    return [...m.entries()].sort((a, b) => Number(b[1][0].area === "setter") - Number(a[1][0].area === "setter") || b[1].length - a[1].length);
  }, [items]);
  const deHoy = (data?.items ?? []).filter((i) => i.es_de_hoy).length;
  const total = data?.items.length ?? 0;

  const copiar = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.texto_equipo);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <>
      {err && <p className="error">Error: {err}</p>}
      <section className="kpis kpi-group tone-alerta" aria-busy={loading}>
        <div className="kpi"><div className="kpi-label">Pendientes en el CRM</div><div className="kpi-value">{loading ? "…" : total}</div><div className="kpi-sub">Se calcula en vivo</div></div>
        <div className="kpi"><div className="kpi-label">De hoy</div><div className="kpi-value">{loading ? "…" : deHoy}</div><div className="kpi-sub">{total - deHoy} arrastrados</div></div>
        <div className="kpi"><div className="kpi-label">Última sync con GHL</div><div className="kpi-value">{data?.ultima_sync ? fecha(data.ultima_sync).slice(-5) : "—"}</div><div className="kpi-sub">Cambios de los últimos 20 min pueden no verse</div></div>
      </section>

      <div className="filters">
        <button className="primary" onClick={copiar} disabled={!data}>{copiado ? "Copiado ✓" : "Copiar mensaje para el equipo"}</button>
        <label className="check">
          <input type="checkbox" checked={soloHoy} onChange={(e) => setSoloHoy(e.target.checked)} />
          Solo lo de hoy
        </label>
      </div>

      {!loading && !err && personas.length === 0 && (
        <section className="card table-card"><p className="empty">✅ Todo al día: no falta actualizar nada.</p></section>
      )}

      {personas.map(([persona, filas]) => (
        <section key={persona} className="card table-card tone-alerta">
          <div className="table-head"><h2 className="section-title"><i className="dot" />{persona} · {filas.length}</h2></div>
          <div className="table-wrap">
            <table className="cierres">
              <thead><tr><th>Problema</th><th className="name">Lead</th><th>Producto</th><th>Fecha</th><th className="name">Qué falta</th></tr></thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={`${f.tipo}-${f.opp_id ?? f.contact_id ?? i}`}>
                    <td>{TIPOS[f.tipo] ?? f.tipo}</td>
                    <td className="name">{ghl(f.contact_id) ? <a href={ghl(f.contact_id)} target="_blank" rel="noreferrer">{f.nombre}</a> : f.nombre}</td>
                    <td><span className={`chip ${f.producto === "DFY" ? "chip-dfy" : f.producto === "JessiK" ? "chip-jessik" : "chip-none"}`}>{f.producto ?? "—"}</span></td>
                    <td className={f.es_de_hoy ? "" : "warn"}>{fecha(f.referencia)}</td>
                    <td className="name">{f.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
