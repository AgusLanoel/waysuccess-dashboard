import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money, num } from "../../lib/format";
import { ghlContacto } from "../ui";

// 27-11 (nivel Mochi): lo que pasa en Instagram antes de que la persona llegue a GHL.
// Leads = quien comentó, respondió una historia o escribió por DM (webhook ig-webhook), con su recorrido.
// Automatizaciones = reemplazo de ManyChat: palabra clave → DM con link único por persona. Apagadas hasta el cambio.

export interface PiezaIG { id: string; tipo: string | null; titulo: string | null; permalink: string | null; thumbnail_url: string | null; publicado_at: string | null }
interface LeadIG { lead_id: number; usuario: string | null; nombre: string | null; primer_toque: string; ultimo_toque: string; toques: number; pieza_primera: string | null; ultimo_tipo: string | null; ultimo_texto: string | null; link: string | null; ghl_contact_id: string | null; agendo: boolean; cobrado: number }
interface Auto { id: number | null; nombre: string; disparador: "comentario" | "dm" | "historia"; palabras: string[]; pieza_id: string | null; respuesta_publica: string | null; mensaje: string; destino: string; activa: boolean; enviados?: number; fallidos?: number; clics?: number; ultimo_envio?: string | null; ultimo_error?: string | null }
interface Estado { conectada: boolean; usuario: string | null; token_vence: string | null; ultimo_sync: { ok: boolean; at: string; detalle: string } | null; ultimo_evento: string | null; leads: number; toques: number; piezas_ig: number; mensajes: number }

const TIPO: Record<string, string> = { comentario: "Comentó", historia: "Respondió una historia", dm_kw: "DM con palabra clave", dm_frio: "DM", compartido: "Compartió", anuncio: "Desde un anuncio" };
const DISP: Record<Auto["disparador"], string> = { comentario: "Comentario en un post", dm: "Mensaje directo", historia: "Respuesta a una historia" };
const fecha = (s: string | null) => (s ? new Date(s).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const NUEVA: Auto = { id: null, nombre: "", disparador: "comentario", palabras: [], pieza_id: null, respuesta_publica: "¡Te lo mandé por DM! 📩", mensaje: "¡Hola {nombre}! Aquí tienes el acceso: {link}", destino: "https://www.waysuccess.io/", activa: false };

export function nombrePiezaIG(id: string | null, piezas: Map<string, PiezaIG>) {
  if (!id) return "Sin pieza";
  const p = piezas.get(id);
  if (p?.titulo) return p.titulo;
  if (id.startsWith("ig-")) return `${p?.tipo === "reel" ? "Reel" : p?.tipo === "historia" ? "Historia" : p?.tipo === "carrusel" ? "Carrusel" : "Post"} de Instagram`;
  return id === "link_in_bio" ? "Link de la bio" : id;
}

export function OrganicoIG({ from, to, reloadKey, piezas }: { from: string; to: string; reloadKey: number; piezas: Map<string, PiezaIG> }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [leads, setLeads] = useState<LeadIG[]>([]);
  const [autos, setAutos] = useState<Auto[]>([]);
  const [edit, setEdit] = useState<Auto | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [verLeads, setVerLeads] = useState(true);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    Promise.all([supabase.rpc("org_ig_estado"), supabase.rpc("org_ig_leads", { desde: from, hasta: to }), supabase.rpc("org_automatizaciones_lista")]).then(([e, l, a]) => {
      if (!vivo) return;
      setErr(e.error?.message ?? l.error?.message ?? a.error?.message ?? null);
      setEstado((e.data as Estado) ?? null);
      setLeads(((l.data ?? []) as LeadIG[]).map((x) => ({ ...x, cobrado: +x.cobrado })));
      setAutos((a.data ?? []) as Auto[]);
    });
    return () => { vivo = false; };
  }, [from, to, reloadKey, recarga]);

  const guardar = async (a: Auto) => {
    setGuardando(true);
    const { error } = await supabase.rpc("org_automatizacion_guardar", {
      p_id: a.id, p_nombre: a.nombre.trim() || "Sin nombre", p_disparador: a.disparador, p_palabras: a.palabras.map((p) => p.trim()).filter(Boolean),
      p_mensaje: a.mensaje, p_respuesta: a.respuesta_publica ?? "", p_destino: a.destino, p_activa: a.activa, p_pieza: a.pieza_id ?? "",
    });
    setGuardando(false);
    if (error) { setErr(error.message); return; }
    setErr(null); setEdit(null); setRecarga((n) => n + 1);
  };
  const alternar = (a: Auto) => guardar({ ...a, activa: !a.activa });

  const sync = estado?.ultimo_sync;
  const conectadoTxt = !estado ? "…" : estado.conectada
    ? `Conectada${estado.usuario ? ` como @${estado.usuario}` : ""} · ${num(estado.piezas_ig)} publicaciones sincronizadas${estado.token_vence ? ` · el acceso se renueva solo (vence ${new Date(estado.token_vence).toLocaleDateString("es-CL")})` : ""}`
    : "Falta conectar la cuenta (token de acceso) para leer las publicaciones y mandar mensajes";

  return (
    <>
      {err && <p className="error">Error: {err}</p>}

      <section className="card table-card">
        <div className="table-head"><b>Instagram</b><span className="muted" style={{ fontSize: ".8rem" }}>Comentarios, respuestas a historias y DMs entran solos · ManyChat sigue respondiendo hasta que prendas una automatización</span></div>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><td className="name">Eventos en vivo (webhook)</td><td className="name">{estado?.ultimo_evento ? `Recibiendo · último ${fecha(estado.ultimo_evento)} · ${num(estado.leads)} personas, ${num(estado.toques)} interacciones` : "Esperando el primer evento"}</td></tr>
              <tr><td className="name">Cuenta y publicaciones</td><td className="name">{conectadoTxt}</td></tr>
              <tr><td className="name">Última sincronización</td><td className="name">{sync ? `${fecha(sync.at)} · ${sync.ok ? "bien" : "con error: " + (JSON.parse(sync.detalle || "{}").error ?? sync.detalle)}` : "—"}</td></tr>
              <tr><td className="name">Mensajes enviados por nuestras automatizaciones</td><td className="name">{num(estado?.mensajes ?? 0)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card">
        <div className="table-head">
          <b>Automatizaciones (reemplazo de ManyChat)</b>
          <button className="link" onClick={() => setEdit({ ...NUEVA })}>+ Nueva</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th className="name">Nombre</th><th className="name">Cuándo</th><th className="name">Palabras</th><th>Enviados</th><th>Clics</th><th>Fallidos</th><th className="name">Estado</th><th></th></tr></thead>
            <tbody>
              {autos.map((a) => (
                <tr key={a.id ?? a.nombre}>
                  <td className="name"><b>{a.nombre}</b></td>
                  <td className="name">{DISP[a.disparador]}{a.pieza_id ? ` · solo en ${nombrePiezaIG(a.pieza_id, piezas)}` : ""}</td>
                  <td className="name">{a.palabras.length ? a.palabras.join(", ") : "Cualquier texto"}</td>
                  <td>{num(a.enviados ?? 0)}</td>
                  <td>{num(a.clics ?? 0)}</td>
                  <td title={a.ultimo_error ?? ""}>{a.fallidos ? <span className="error">{num(a.fallidos)}</span> : "0"}</td>
                  <td className="name">
                    <button className="link" disabled={guardando} onClick={() => alternar(a)} title={a.activa ? "Apagar" : "Prender: desde ahora responde nuestra app. Apaga la misma automatización en ManyChat."}>
                      {a.activa ? "🟢 Activa" : "⚪ Apagada"}
                    </button>
                  </td>
                  <td><button className="link" onClick={() => setEdit({ ...a })}>Editar</button></td>
                </tr>
              ))}
              {!autos.length && <tr><td colSpan={8} className="vacio">Sin automatizaciones</td></tr>}
            </tbody>
          </table>
        </div>
        {autos.some((a) => a.activa) && <p className="muted small" style={{ padding: "0 14px 12px" }}>Las activas responden desde nuestra app. Asegúrate de tener apagada la misma palabra clave en ManyChat para que la persona no reciba dos mensajes.</p>}
        {edit && (
          <div className="auto-form">
            <label>Nombre<input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} placeholder="JESSI" /></label>
            <label>Cuándo se dispara
              <select value={edit.disparador} onChange={(e) => setEdit({ ...edit, disparador: e.target.value as Auto["disparador"] })}>
                {Object.entries(DISP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>Palabras clave (separadas por coma; vacío = cualquier texto)<input value={edit.palabras.join(", ")} onChange={(e) => setEdit({ ...edit, palabras: e.target.value.split(",") })} placeholder="JESSI, QUIERO" /></label>
            <label>Solo en esta publicación (opcional)
              <select value={edit.pieza_id ?? ""} onChange={(e) => setEdit({ ...edit, pieza_id: e.target.value || null })}>
                <option value="">Todas las publicaciones</option>
                {[...piezas.values()].filter((p) => p.id.startsWith("ig-") && p.permalink).sort((a, b) => (b.publicado_at ?? "").localeCompare(a.publicado_at ?? "")).slice(0, 60).map((p) => (
                  <option key={p.id} value={p.id}>{(p.publicado_at ?? "").slice(0, 10)} · {nombrePiezaIG(p.id, piezas).slice(0, 60)}</option>
                ))}
              </select>
            </label>
            {edit.disparador === "comentario" && <label>Respuesta pública al comentario (opcional)<input value={edit.respuesta_publica ?? ""} onChange={(e) => setEdit({ ...edit, respuesta_publica: e.target.value })} /></label>}
            <label>Mensaje por DM ({"{link}"} = link único de la persona, {"{nombre}"} = su usuario)<textarea rows={3} value={edit.mensaje} onChange={(e) => setEdit({ ...edit, mensaje: e.target.value })} /></label>
            <label>A dónde lleva el link<input value={edit.destino} onChange={(e) => setEdit({ ...edit, destino: e.target.value })} /></label>
            <label className="fila"><input type="checkbox" checked={edit.activa} onChange={(e) => setEdit({ ...edit, activa: e.target.checked })} /> Activa (responde desde nuestra app)</label>
            <div className="fila">
              <button className="primary" disabled={guardando || !edit.mensaje.includes("{link}")} onClick={() => guardar(edit)}>{guardando ? "Guardando…" : "Guardar"}</button>
              <button className="link" onClick={() => setEdit(null)}>Cancelar</button>
              {!edit.mensaje.includes("{link}") && <span className="error small">El mensaje tiene que incluir {"{link}"}</span>}
            </div>
          </div>
        )}
      </section>

      <button className="link desplegable" onClick={() => setVerLeads(!verLeads)}>{verLeads ? "▾" : "▸"} Personas de Instagram ({num(leads.length)})</button>
      {verLeads && (
        <section className="card table-card">
          <div className="table-wrap">
            <table>
              <thead><tr><th className="name">Persona</th><th className="name">Primera vez</th><th className="name">Llegó por</th><th className="name">Último</th><th>Toques</th><th className="name">Link</th><th className="name">GHL</th><th>Agendó</th><th>Cobrado</th></tr></thead>
              <tbody>
                {leads.map((l) => {
                  const url = ghlContacto(l.ghl_contact_id);
                  const p = l.pieza_primera ? piezas.get(l.pieza_primera) : undefined;
                  return (
                    <tr key={l.lead_id}>
                      <td className="name">{l.usuario ? <a href={`https://instagram.com/${l.usuario}`} target="_blank" rel="noreferrer">@{l.usuario}</a> : <span className="muted">Usuario sin resolver</span>}{l.nombre ? <div className="muted small">{l.nombre}</div> : null}</td>
                      <td className="name">{fecha(l.primer_toque)}</td>
                      <td className="name">{p?.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer">{nombrePiezaIG(l.pieza_primera, piezas).slice(0, 50)}</a> : nombrePiezaIG(l.pieza_primera, piezas).slice(0, 50)}</td>
                      <td className="name">{TIPO[l.ultimo_tipo ?? ""] ?? l.ultimo_tipo}{l.ultimo_texto ? <div className="muted small">“{l.ultimo_texto.slice(0, 60)}”</div> : null}</td>
                      <td>{num(l.toques)}</td>
                      <td className="name">{l.link ? <code>/l/{l.link}</code> : "—"}</td>
                      <td className="name">{url ? <a href={url} target="_blank" rel="noreferrer">Ver contacto</a> : "—"}</td>
                      <td>{l.agendo ? "Sí" : "—"}</td>
                      <td>{l.cobrado > 0 ? money(l.cobrado) : "—"}</td>
                    </tr>
                  );
                })}
                {!leads.length && <tr><td colSpan={9} className="vacio">Nadie interactuó en este período</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
