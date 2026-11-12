import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// 11-11-2026 dueño: un solo lugar para lo comercial. Recursos (contratos, links de pago, scripts, entregables),
// tareas del área, llamadas grabadas con Fathom (lo que se escribió en GHL) y alertas abiertas.
// Todos los miembros lo ven; solo los owners editan recursos y tareas (la base también lo exige).

const LOC = "fssMXOOdUdCpuTFkSTGc";
const ghl = (contactId: string | null) => (contactId ? `https://app.gohighlevel.com/v2/location/${LOC}/contacts/detail/${contactId}` : undefined);
const CATEGORIAS = ["Links de pago", "Scripts", "Contratos", "Entregables a los leads", "Otros"] as const;
const ESTADOS = ["Pendiente", "En curso", "Hecho", "Bloqueado"] as const;

interface Recurso { id: number; categoria: string; titulo: string; url: string | null; nota: string | null; orden: number; activo: boolean; updated_by: string | null }
interface Tarea { id: number; titulo: string; detalle: string | null; estado: string; responsable: string | null; orden: number; updated_at: string; updated_by: string | null }
interface Llamada {
  id: string; persona: string | null; lead_nombre: string | null; contact_id: string | null; inicio: string | null; share_url: string | null;
  estado: string; error: string | null; proxima_llamada_acordada: boolean | null; proximo_seguimiento: string | null;
  ia: { resultado?: string; etapa_sugerida?: string; motivo?: string; resumen_corto?: string; oferta_hecha?: boolean; asistio?: boolean } | null;
}
interface Alerta { id: number; tipo: string; persona: string | null; para: string | null; lead_nombre: string | null; contact_id: string | null; mensaje: string; creada_at: string; enviada_at: string | null }

const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "—";
const ESTADO_LLAMADA: Record<string, string> = {
  recibida: "Procesando", sin_lead: "Sin lead en GHL", procesada: "Leída, sin escribir en GHL", ghl_ok: "Oportunidad actualizada", error: "Error",
};

export function CentroComercial({ isOwner, reloadKey }: { isOwner: boolean; reloadKey: number }) {
  const [recursos, setRecursos] = useState<Recurso[]>([]);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [llamadas, setLlamadas] = useState<Llamada[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<Recurso> | null>(null);
  const [nuevaTarea, setNuevaTarea] = useState("");
  const [tick, setTick] = useState(0);
  // Conectar Fathom: la clave de API va directo a la función (no se guarda); solo queda el secreto del webhook.
  const [conectados, setConectados] = useState<{ persona: string; creado_at: string }[]>([]);
  const [fPersona, setFPersona] = useState("Luca");
  const [fClave, setFClave] = useState("");
  const [fEstado, setFEstado] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("fathom_conectados").then(({ data }) => setConectados((data as { persona: string; creado_at: string }[]) ?? []));
  }, [reloadKey, tick]);

  async function conectarFathom() {
    setFEstado("Conectando…");
    const { data: s } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("comercial-auto", {
      body: { action: "registrar", persona: fPersona, api_key: fClave },
      headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` },
    });
    setFClave("");
    if (error || data?.error) return setFEstado(`No se pudo: ${data?.error ?? error?.message}`);
    setFEstado(`Listo: las llamadas de ${fPersona} van a llegar solas.`);
    setTick((x) => x + 1);
  }

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("com_recursos").select("*").eq("activo", true).order("orden"),
      supabase.from("com_tareas").select("*").order("orden"),
      supabase.from("fathom_calls").select("id,persona,lead_nombre,contact_id,inicio,share_url,estado,error,proxima_llamada_acordada,proximo_seguimiento,ia").order("inicio", { ascending: false }).limit(30),
      supabase.from("com_alertas").select("*").is("resuelta_at", null).order("creada_at", { ascending: false }).limit(50),
    ]).then(([r, t, l, a]) => {
      if (!alive) return;
      setErr(r.error?.message ?? t.error?.message ?? l.error?.message ?? a.error?.message ?? null);
      setRecursos((r.data as Recurso[]) ?? []);
      setTareas((t.data as Tarea[]) ?? []);
      setLlamadas((l.data as Llamada[]) ?? []);
      setAlertas((a.data as Alerta[]) ?? []);
    });
    return () => { alive = false; };
  }, [reloadKey, tick]);

  async function guardarRecurso() {
    if (!editando?.titulo || !editando.categoria) return;
    const fila = { categoria: editando.categoria, titulo: editando.titulo, url: editando.url || null, nota: editando.nota || null, orden: editando.orden ?? 100 };
    const { error } = editando.id
      ? await supabase.from("com_recursos").update(fila).eq("id", editando.id)
      : await supabase.from("com_recursos").insert(fila);
    if (error) return setErr(error.message);
    setEditando(null);
    setTick((x) => x + 1);
  }
  async function quitarRecurso(id: number) {
    const { error } = await supabase.from("com_recursos").update({ activo: false }).eq("id", id);
    if (error) return setErr(error.message);
    setEditando(null);
    setTick((x) => x + 1);
  }
  async function cambiarTarea(id: number, cambios: Partial<Tarea>) {
    setTareas((ts) => ts.map((t) => (t.id === id ? { ...t, ...cambios } : t)));
    const { error } = await supabase.from("com_tareas").update(cambios).eq("id", id);
    if (error) setErr(error.message);
  }
  async function agregarTarea() {
    if (!nuevaTarea.trim()) return;
    const { error } = await supabase.from("com_tareas").insert({ titulo: nuevaTarea.trim(), orden: (tareas.at(-1)?.orden ?? 100) + 10 });
    if (error) return setErr(error.message);
    setNuevaTarea("");
    setTick((x) => x + 1);
  }
  async function resolverAlerta(id: number) {
    setAlertas((as) => as.filter((a) => a.id !== id));
    const { error } = await supabase.from("com_alertas").update({ resuelta_at: new Date().toISOString() }).eq("id", id);
    if (error) setErr(error.message);
  }

  const hechas = tareas.filter((t) => t.estado === "Hecho").length;

  return (
    <div className="cc-wrap">
      {err && <p className="error">Error: {err}</p>}

      {alertas.length > 0 && (
        <section className="card table-card tone-alerta">
          <div className="table-head">
            <h2 className="section-title"><i className="dot" />Alertas abiertas · {alertas.length}</h2>
            <span className="muted">Próximas llamadas acordadas que no están en el calendario, y otros avisos</span>
          </div>
          <ul className="cc-list">
            {alertas.map((a) => (
              <li key={a.id} className="cc-item">
                <div className="cc-main">
                  <strong>{ghl(a.contact_id) ? <a href={ghl(a.contact_id)} target="_blank" rel="noreferrer">{a.lead_nombre ?? "Lead"}</a> : a.lead_nombre ?? "Lead"}</strong>
                  <span className="muted"> · {a.persona ?? "—"} · {fecha(a.creada_at)}{a.enviada_at ? ` · avisado a ${a.para ?? "—"}` : ""}</span>
                  <div>{a.mensaje}</div>
                </div>
                <button className="link" onClick={() => resolverAlerta(a.id)}>Resuelta</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cc-grid">
        {CATEGORIAS.map((cat) => {
          const items = recursos.filter((r) => r.categoria === cat);
          if (!items.length && cat === "Otros") return null;
          return (
            <div key={cat} className="card table-card tone-embudo">
              <div className="table-head">
                <h2 className="section-title"><i className="dot" />{cat}</h2>
                {isOwner && <button className="link" onClick={() => setEditando({ categoria: cat, orden: (items.at(-1)?.orden ?? 0) + 10 })}>+ Agregar</button>}
              </div>
              <ul className="cc-list">
                {items.map((r) => (
                  <li key={r.id} className="cc-item">
                    <div className="cc-main">
                      {r.url ? <a href={r.url} target="_blank" rel="noreferrer"><strong>{r.titulo}</strong></a> : <strong className="muted">{r.titulo}</strong>}
                      {r.nota && <div className="muted cc-nota">{r.nota}</div>}
                    </div>
                    {isOwner && <button className="link" onClick={() => setEditando(r)}>Editar</button>}
                  </li>
                ))}
                {!items.length && <li className="empty">Nada cargado todavía.</li>}
              </ul>
              {editando && editando.categoria === cat && (
                <div className="cc-form">
                  <input placeholder="Título" value={editando.titulo ?? ""} onChange={(e) => setEditando({ ...editando, titulo: e.target.value })} />
                  <input placeholder="Link (https://…)" value={editando.url ?? ""} onChange={(e) => setEditando({ ...editando, url: e.target.value })} />
                  <input placeholder="Nota (opcional)" value={editando.nota ?? ""} onChange={(e) => setEditando({ ...editando, nota: e.target.value })} />
                  <select value={editando.categoria} onChange={(e) => setEditando({ ...editando, categoria: e.target.value })}>
                    {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <div className="cc-actions">
                    <button className="primary" onClick={guardarRecurso}>Guardar</button>
                    <button className="link" onClick={() => setEditando(null)}>Cancelar</button>
                    {editando.id && <button className="link cc-danger" onClick={() => quitarRecurso(editando.id!)}>Quitar</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="card table-card tone-closers">
        <div className="table-head">
          <h2 className="section-title"><i className="dot" />Tareas del área comercial · {hechas} de {tareas.length} hechas</h2>
        </div>
        <div className="table-wrap">
          <table className="cierres">
            <thead><tr><th>Estado</th><th className="name">Tarea</th><th>Responsable</th><th>Actualizado</th></tr></thead>
            <tbody>
              {tareas.map((t) => (
                <tr key={t.id} className={t.estado === "Hecho" ? "dim" : ""}>
                  <td>
                    {isOwner ? (
                      <select value={t.estado} onChange={(e) => cambiarTarea(t.id, { estado: e.target.value })}>
                        {ESTADOS.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    ) : t.estado}
                  </td>
                  <td className="name"><strong>{t.titulo}</strong>{t.detalle && <div className="muted cc-nota">{t.detalle}</div>}</td>
                  <td>
                    {isOwner ? (
                      <input className="cc-inline" value={t.responsable ?? ""} onChange={(e) => setTareas((ts) => ts.map((x) => (x.id === t.id ? { ...x, responsable: e.target.value } : x)))}
                        onBlur={(e) => cambiarTarea(t.id, { responsable: e.target.value || null })} />
                    ) : t.responsable ?? "—"}
                  </td>
                  <td className="muted">{fecha(t.updated_at)}{t.updated_by ? ` · ${t.updated_by}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isOwner && (
          <div className="cc-form cc-row">
            <input placeholder="Nueva tarea" value={nuevaTarea} onChange={(e) => setNuevaTarea(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregarTarea()} />
            <button className="primary" onClick={agregarTarea}>Agregar</button>
          </div>
        )}
      </section>

      <section className="card table-card tone-ventas">
        <div className="table-head">
          <h2 className="section-title"><i className="dot" />Llamadas grabadas con Fathom · {llamadas.length}</h2>
          <span className="muted">Al terminar cada llamada, la transcripción actualiza la oportunidad en GHL</span>
        </div>
        <div className="table-wrap">
          <table className="cierres">
            <thead><tr><th>Fecha</th><th>Closer</th><th className="name">Lead</th><th>Resultado</th><th>Próx. seguimiento</th><th>Estado</th><th>Grabación</th></tr></thead>
            <tbody>
              {llamadas.map((l) => (
                <tr key={l.id}>
                  <td>{fecha(l.inicio)}</td>
                  <td>{l.persona ?? "—"}</td>
                  <td className="name">
                    {ghl(l.contact_id) ? <a href={ghl(l.contact_id)} target="_blank" rel="noreferrer">{l.lead_nombre ?? "—"}</a> : l.lead_nombre ?? "—"}
                    {l.ia?.resumen_corto && <div className="muted cc-nota">{l.ia.resumen_corto}</div>}
                  </td>
                  <td>{l.ia?.etapa_sugerida ?? l.ia?.resultado ?? "—"}{l.ia?.motivo ? <div className="muted cc-nota">{l.ia.motivo}</div> : null}</td>
                  <td className={l.proxima_llamada_acordada && !l.proximo_seguimiento ? "warn" : ""}>
                    {l.proximo_seguimiento ? fecha(l.proximo_seguimiento) : l.proxima_llamada_acordada ? "Acordada sin fecha" : "—"}
                  </td>
                  <td className={l.estado === "error" || l.estado === "sin_lead" ? "warn" : ""} title={l.error ?? undefined}>{ESTADO_LLAMADA[l.estado] ?? l.estado}</td>
                  <td>{l.share_url ? <a href={l.share_url} target="_blank" rel="noreferrer">Ver</a> : "—"}</td>
                </tr>
              ))}
              {llamadas.length === 0 && (
                <tr><td colSpan={7} className="empty">Todavía no llegó ninguna llamada. Aparecen acá apenas cada closer conecte su Fathom.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="cc-form">
          <strong>Conectar Fathom</strong>
          <span className="muted cc-nota">
            Conectados: {conectados.length ? conectados.map((c) => c.persona).join(", ") : "nadie todavía"}.
            En Fathom: Settings → API Access → Generate API key, y pegala acá. La clave no se guarda.
          </span>
          <div className="cc-row cc-fathom">
            <select value={fPersona} onChange={(e) => setFPersona(e.target.value)}>
              {["Luca", "Jenny", "Mileces", "Ale"].map((p) => <option key={p}>{p}</option>)}
            </select>
            <input type="password" placeholder="Clave de API de Fathom" value={fClave} onChange={(e) => setFClave(e.target.value)} autoComplete="off" />
            <button className="primary" disabled={fClave.length < 10} onClick={conectarFathom}>Conectar</button>
          </div>
          {fEstado && <span className="muted cc-nota">{fEstado}</span>}
        </div>
      </section>
    </div>
  );
}
