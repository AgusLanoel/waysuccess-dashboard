import { Fragment, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money, num } from "../../lib/format";
import { ghlContacto } from "../ui";

// 27-11 (nivel Mochi): lo que pasa en Instagram antes de que la persona llegue a GHL.
// Personas = quien comentó, respondió una historia o escribió por DM (webhook ig-webhook), con su recorrido completo.
// Automatizaciones = reemplazo de ManyChat: palabra clave → DM con link único por persona. Apagadas hasta el cambio.

export interface PiezaIG {
  id: string; tipo: string | null; titulo: string | null; permalink: string | null; thumbnail_url: string | null; publicado_at: string | null;
  views: number | null; alcance: number | null; guardados: number | null; compartidos: number | null; likes: number | null; comentarios: number | null;
}
interface LeadIG { lead_id: number; usuario: string | null; nombre: string | null; primer_toque: string; ultimo_toque: string; toques: number; pieza_primera: string | null; ultimo_tipo: string | null; ultimo_texto: string | null; link: string | null; ghl_contact_id: string | null; agendo: boolean; cobrado: number }
interface Auto { id: number | null; nombre: string; disparador: "comentario" | "dm" | "historia"; palabras: string[]; pieza_id: string | null; respuesta_publica: string | null; mensaje: string; destino: string; activa: boolean; mensaje_apertura?: string | null; boton_apertura?: string | null; boton_link?: string | null; enviados?: number; fallidos?: number; links?: number; clics?: number; ultimo_envio?: string | null; ultimo_error?: string | null }
interface Estado { conectada: boolean; usuario: string | null; token_vence: string | null; ultimo_sync: { ok: boolean; at: string; detalle: string } | null; ultimo_evento: string | null; leads: number; toques: number; piezas_ig: number; mensajes: number }
interface Paso { at: string; paso: string; detalle: string | null; pieza_id: string | null }

const TIPO: Record<string, string> = { comentario: "Comentó", historia: "Respondió una historia", dm_kw: "DM con palabra clave", dm_frio: "Escribió por DM", compartido: "Compartió una publicación", anuncio: "Llegó desde un anuncio" };
const PASO: Record<string, [string, string]> = {
  comentario: ["💬", "Comentó"], historia: ["📸", "Respondió una historia"], dm_kw: ["✉️", "DM con palabra clave"], dm_frio: ["✉️", "Escribió por DM"],
  compartido: ["🔁", "Compartió"], anuncio: ["📣", "Desde un anuncio"], dm_enviado: ["📩", "Le mandamos su link"], dm_fallido: ["⚠️", "No se pudo mandar el DM"],
  clic: ["👆", "Abrió su link"], contacto_ghl: ["🧾", "Entró a GHL"], agenda: ["📅", "Agendó"], pago: ["💰", "Pagó"],
};
const DISP: Record<Auto["disparador"], string> = { comentario: "Comenta en un post", dm: "Escribe por DM", historia: "Responde una historia" };
const fecha = (s: string | null) => (s ? new Date(s).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const hace = (s: string | null) => {
  if (!s) return "—";
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};
const NUEVA: Auto = { id: null, nombre: "", disparador: "comentario", palabras: [], pieza_id: null, respuesta_publica: "¡Te lo mandé por DM! 📩", mensaje: "¡Hola {nombre}! Aquí tienes el acceso: {link}", destino: "https://www.waysuccess.io/", activa: false, mensaje_apertura: null, boton_apertura: null, boton_link: null };
const previa = (msg: string, palabra = "JESSI") => (msg ?? "").split("{nombre}").join("@maria.coach").split("{palabra}").join(palabra).split("{link}").join("waysuccess.io/l/Ab3xQ9");
const dosPasos = (a: Auto) => !!(a.mensaje_apertura && a.boton_apertura);
const linkOk = (a: Auto) => a.mensaje.includes("{link}") || !!a.boton_link?.trim();
// Vista previa del DM tal como llega: apertura con botón → mensaje con el botón del link
function ConversacionDM({ a, chica }: { a: Auto; chica?: boolean }) {
  const pal = a.palabras.find((p) => p.trim())?.trim().toUpperCase() || "JESSI";
  return (
    <div className={`dm-conv ${chica ? "chica" : ""}`}>
      {dosPasos(a) && (<>
        <div className={`dm-bubble ${chica ? "clamp3" : "grande"}`}>{previa(a.mensaje_apertura!, pal)}<span className="dm-btn">{a.boton_apertura}</span></div>
        {!chica && <div className="dm-yo">{a.boton_apertura}</div>}
      </>)}
      {(!chica || !dosPasos(a)) && <div className={`dm-bubble ${chica ? "clamp3" : "grande"}`}>{previa(a.mensaje.split("{link}").join(a.boton_link ? "" : "{link}"), pal).trim()}{a.boton_link ? <span className="dm-btn">🔗 {a.boton_link}</span> : null}</div>}
    </div>
  );
}

export function nombrePiezaIG(id: string | null, piezas: Map<string, PiezaIG>) {
  if (!id) return "Sin pieza";
  const p = piezas.get(id);
  if (p?.titulo) return p.titulo;
  if (id.startsWith("ig-")) return `${p?.tipo === "reel" ? "Reel" : p?.tipo === "historia" ? "Historia" : p?.tipo === "carrusel" ? "Carrusel" : "Post"} de Instagram`;
  return id === "link_in_bio" ? "Link de la bio" : id;
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} disabled={disabled} onClick={onChange}><span /></button>;
}

function Recorrido({ lead, piezas }: { lead: number; piezas: Map<string, PiezaIG> }) {
  const [pasos, setPasos] = useState<Paso[] | null>(null);
  useEffect(() => { supabase.rpc("org_ig_recorrido", { p_lead: lead }).then(({ data }) => setPasos((data ?? []) as Paso[])); }, [lead]);
  if (!pasos) return <p className="muted small">Cargando…</p>;
  const llego = new Set(pasos.map((p) => p.paso));
  const faltan = [["dm_enviado", "Recibir su link"], ["clic", "Abrir el link"], ["agenda", "Agendar"], ["pago", "Pagar"]].filter(([k]) => !llego.has(k));
  return (
    <ol className="timeline">
      {pasos.map((p, i) => {
        const [ico, txt] = PASO[p.paso] ?? ["•", p.paso];
        const pz = p.pieza_id ? piezas.get(p.pieza_id) : undefined;
        return (
          <li key={i} className={`tl-${p.paso}`}>
            <span className="tl-ico" aria-hidden>{ico}</span>
            <div>
              <b>{txt}</b> <span className="muted small">{fecha(p.at)}</span>
              {p.paso === "pago" ? <div>{money(Number(p.detalle))}</div> : p.detalle ? <div className="muted small">“{p.detalle.slice(0, 120)}”</div> : null}
              {pz && <div className="small">en {pz.permalink ? <a href={pz.permalink} target="_blank" rel="noreferrer">{nombrePiezaIG(pz.id, piezas).slice(0, 70)}</a> : nombrePiezaIG(pz.id, piezas)}</div>}
            </div>
          </li>
        );
      })}
      {faltan.map(([k, txt]) => (
        <li key={k} className="tl-pendiente"><span className="tl-ico" aria-hidden>○</span><div className="muted">{txt}</div></li>
      ))}
    </ol>
  );
}

export function OrganicoIG({ from, to, reloadKey, piezas }: { from: string; to: string; reloadKey: number; piezas: Map<string, PiezaIG> }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [leads, setLeads] = useState<LeadIG[]>([]);
  const [autos, setAutos] = useState<Auto[]>([]);
  const [edit, setEdit] = useState<Auto | null>(null);
  const [guardando, setGuardando] = useState<number | "form" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
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

  const guardar = async (a: Auto, desde: number | "form") => {
    setGuardando(desde);
    const { error } = await supabase.rpc("org_automatizacion_guardar", {
      p_id: a.id, p_nombre: a.nombre.trim() || "Sin nombre", p_disparador: a.disparador, p_palabras: a.palabras.map((p) => p.trim()).filter(Boolean),
      p_mensaje: a.mensaje, p_respuesta: a.respuesta_publica ?? "", p_destino: a.destino, p_activa: a.activa, p_pieza: a.pieza_id ?? "",
      p_apertura: a.mensaje_apertura ?? "", p_boton_apertura: a.boton_apertura ?? "", p_boton_link: a.boton_link ?? "",
    });
    setGuardando(null);
    if (error) { setErr(error.message); return; }
    setErr(null); setEdit(null); setRecarga((n) => n + 1);
  };

  const sync = estado?.ultimo_sync;
  let syncErr: string | null = null;
  if (sync && !sync.ok) { try { syncErr = JSON.parse(sync.detalle).error ?? sync.detalle; } catch { syncErr = sync.detalle; } }
  const vivo = !!estado?.ultimo_evento && Date.now() - new Date(estado.ultimo_evento).getTime() < 3 * 864e5;
  const activas = autos.filter((a) => a.activa).length;

  return (
    <section className="ig-bloque">
      <div className="ig-head">
        <h2 className="section-title">Instagram {estado?.usuario ? <span className="muted">@{estado.usuario}</span> : null}</h2>
        <div className="estado-strip">
          <span className={`estado ${vivo ? "ok" : "warn"}`} title="Comentarios, respuestas a historias y DMs">{vivo ? `Recibiendo · ${hace(estado!.ultimo_evento)}` : "Esperando eventos"}</span>
          <span className={`estado ${estado?.conectada && !syncErr ? "ok" : "warn"}`} title={syncErr ?? ""}>{estado?.conectada ? `${num(estado.piezas_ig)} publicaciones · sincronizado ${hace(sync?.at ?? null)}` : "Cuenta sin conectar"}</span>
          <span className={`estado ${activas ? "ok" : "off"}`}>{activas ? `${activas} automatización${activas > 1 ? "es" : ""} activa${activas > 1 ? "s" : ""}` : "Responde ManyChat"}</span>
        </div>
      </div>
      {err && <p className="error">Error: {err}</p>}
      {syncErr && <p className="error small">Sincronización: {syncErr}</p>}

      {/* ───── Automatizaciones ───── */}
      <div className="sub-head">
        <h3>Automatizaciones <span className="muted small">reemplazo de ManyChat · palabra clave → DM con link único por persona</span></h3>
        <button className="btn-sec" onClick={() => setEdit({ ...NUEVA })}>+ Nueva</button>
      </div>
      <div className="auto-grid">
        {autos.map((a) => (
          <article key={a.id ?? a.nombre} className={`auto-card ${a.activa ? "activa" : ""}`}>
            <header>
              <div>
                <b className="auto-nombre">{a.nombre}</b>
                <div className="muted small">{DISP[a.disparador]}{a.pieza_id ? ` · solo en ${nombrePiezaIG(a.pieza_id, piezas).slice(0, 40)}` : " · todas las publicaciones"}</div>
              </div>
              <Switch on={a.activa} disabled={guardando === a.id} label={`${a.activa ? "Apagar" : "Prender"} ${a.nombre}`} onChange={() => guardar({ ...a, activa: !a.activa }, a.id!)} />
            </header>
            <div className="chips">{a.palabras.length ? a.palabras.map((p) => <span key={p} className="chip chip-kw">{p}</span>) : <span className="chip chip-none">Cualquier texto</span>}</div>
            <ConversacionDM a={a} chica />
            <footer>
              <span title="Personas que recibieron el primer DM"><b>{num(a.enviados ?? 0)}</b> enviados</span>
              {dosPasos(a) && <span title="Tocaron el botón y recibieron su link"><b>{num(a.links ?? 0)}</b> pidieron link</span>}
              <span><b>{num(a.clics ?? 0)}</b> clics</span>
              {a.fallidos ? <span className="error" title={a.ultimo_error ?? ""}><b>{num(a.fallidos)}</b> fallidos</span> : null}
              <button className="link" onClick={() => setEdit({ ...a })}>Editar</button>
            </footer>
          </article>
        ))}
      </div>
      {activas > 0 && <p className="muted small">Las automatizaciones activas responden desde nuestra app (ManyChat apagado). Cada persona recibe su propio link: lo que haga después (quiz, agenda, pago) queda atribuido a la publicación donde comentó.</p>}

      {edit && (
        <div className="card auto-editor">
          <div className="auto-form">
            <h3>{edit.id ? `Editar ${edit.nombre}` : "Nueva automatización"}</h3>
            <label>Nombre<input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} placeholder="JESSI" /></label>
            <label>Cuándo se dispara
              <select value={edit.disparador} onChange={(e) => setEdit({ ...edit, disparador: e.target.value as Auto["disparador"] })}>
                {Object.entries(DISP).map(([k, l]) => <option key={k} value={k}>Cuando alguien {l.toLowerCase()}</option>)}
              </select>
            </label>
            <label>Palabras clave <span className="muted">(separadas por coma · vacío = cualquier texto)</span><input value={edit.palabras.join(", ")} onChange={(e) => setEdit({ ...edit, palabras: e.target.value.split(",") })} placeholder="JESSI, QUIERO" /></label>
            <label>Publicación
              <select value={edit.pieza_id ?? ""} onChange={(e) => setEdit({ ...edit, pieza_id: e.target.value || null })}>
                <option value="">Todas las publicaciones</option>
                {[...piezas.values()].filter((p) => p.id.startsWith("ig-") && p.permalink).sort((a, b) => (b.publicado_at ?? "").localeCompare(a.publicado_at ?? "")).slice(0, 80).map((p) => (
                  <option key={p.id} value={p.id}>{(p.publicado_at ?? "").slice(5, 10).split("-").reverse().join("/")} · {nombrePiezaIG(p.id, piezas).slice(0, 60)}</option>
                ))}
              </select>
            </label>
            {edit.disparador === "comentario" && <label>Respuesta pública al comentario <span className="muted">(opcional)</span><input value={edit.respuesta_publica ?? ""} onChange={(e) => setEdit({ ...edit, respuesta_publica: e.target.value })} /></label>}
            <label>1 · DM de apertura <span className="muted">(opcional · {"{palabra}"} = lo que comentó · {"{nombre}"} = su usuario)</span><textarea rows={6} value={edit.mensaje_apertura ?? ""} onChange={(e) => setEdit({ ...edit, mensaje_apertura: e.target.value })} placeholder="¡Hola! Gracias por comentar {palabra} 🙌 …" /></label>
            {!!edit.mensaje_apertura?.trim() && <label>Botón de la apertura <span className="muted">(al tocarlo le llega el link)</span><input value={edit.boton_apertura ?? ""} onChange={(e) => setEdit({ ...edit, boton_apertura: e.target.value })} placeholder="Sí, quiero mis 30 guiones" /></label>}
            <label>{edit.mensaje_apertura?.trim() ? "2 · DM con el link" : "DM con el link"} <span className="muted">{"{link}"} = link único (o usa el botón)</span><textarea rows={4} value={edit.mensaje} onChange={(e) => setEdit({ ...edit, mensaje: e.target.value })} /></label>
            <label>Botón del link <span className="muted">(opcional · si lo pones, el link va en el botón)</span><input value={edit.boton_link ?? ""} onChange={(e) => setEdit({ ...edit, boton_link: e.target.value })} placeholder="Ver mis 30 guiones" /></label>
            <label>A dónde lleva el link<input value={edit.destino} onChange={(e) => setEdit({ ...edit, destino: e.target.value })} /></label>
            <label className="fila"><Switch on={edit.activa} label="Activa" onChange={() => setEdit({ ...edit, activa: !edit.activa })} /> {edit.activa ? "Activa: responde nuestra app" : "Apagada: no responde"}</label>
            <div className="fila">
              <button className="primary" disabled={guardando === "form" || !linkOk(edit) || (!!edit.mensaje_apertura?.trim() && !edit.boton_apertura?.trim())} onClick={() => guardar(edit, "form")}>{guardando === "form" ? "Guardando…" : "Guardar"}</button>
              <button className="link" onClick={() => setEdit(null)}>Cancelar</button>
              {!linkOk(edit) && <span className="error small">Pon {"{link}"} en el mensaje o el texto del botón del link</span>}
              {!!edit.mensaje_apertura?.trim() && !edit.boton_apertura?.trim() && <span className="error small">Falta el texto del botón de la apertura</span>}
            </div>
          </div>
          <div className="telefono" aria-label="Vista previa">
            <div className="tel-top">Vista previa en Instagram</div>
            {edit.disparador === "comentario" && (
              <div className="tel-coment"><b>maria.coach</b> {edit.palabras.find((p) => p.trim())?.trim() || "Quiero"}{edit.respuesta_publica ? <div className="tel-resp"><b>{estado?.usuario ?? "tu_cuenta"}</b> {edit.respuesta_publica}</div> : null}</div>
            )}
            <ConversacionDM a={edit} />
          </div>
        </div>
      )}

      {/* ───── Personas ───── */}
      <div className="sub-head">
        <h3>Personas <span className="muted small">{num(leads.length)} interactuaron en el período · toca una para ver su recorrido</span></h3>
      </div>
      <div className="card table-card">
        <div className="table-wrap">
          <table className="personas">
            <thead><tr><th className="name">Persona</th><th className="name">Llegó por</th><th className="name">Último</th><th>Toques</th><th className="name">Estado</th><th>Cobrado</th></tr></thead>
            <tbody>
              {leads.map((l) => {
                const p = l.pieza_primera ? piezas.get(l.pieza_primera) : undefined;
                const url = ghlContacto(l.ghl_contact_id);
                const etapa = l.cobrado > 0 ? ["Pagó", "e-pago"] : l.agendo ? ["Agendó", "e-agenda"] : l.ghl_contact_id ? ["En GHL", "e-ghl"] : l.link ? ["Link enviado", "e-link"] : ["Interactuó", "e-toque"];
                return (
                  <Fragment key={l.lead_id}>
                    <tr className="clic" onClick={() => setAbierto(abierto === l.lead_id ? null : l.lead_id)} aria-expanded={abierto === l.lead_id}>
                      <td className="name">
                        <div className="persona">
                          <span className="avatar" aria-hidden>{(l.usuario ?? "?").slice(0, 1).toUpperCase()}</span>
                          <div>{l.usuario ? <b>@{l.usuario}</b> : <span className="muted">Usuario sin resolver</span>}<div className="muted small">{fecha(l.primer_toque)}</div></div>
                        </div>
                      </td>
                      <td className="name"><div className="name-cell">{p?.thumbnail_url && <img className="thumb" src={p.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}<span className="clamp">{nombrePiezaIG(l.pieza_primera, piezas)}</span></div></td>
                      <td className="name">{TIPO[l.ultimo_tipo ?? ""] ?? l.ultimo_tipo}{l.ultimo_texto ? <div className="muted small clamp">“{l.ultimo_texto}”</div> : null}</td>
                      <td>{num(l.toques)}</td>
                      <td className="name"><span className={`etapa ${etapa[1]}`}>{etapa[0]}</span>{url && <a className="small" href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}> GHL ↗</a>}</td>
                      <td>{l.cobrado > 0 ? money(l.cobrado) : "—"}</td>
                    </tr>
                    {abierto === l.lead_id && <tr className="detalle"><td colSpan={6}><Recorrido lead={l.lead_id} piezas={piezas} /></td></tr>}
                  </Fragment>
                );
              })}
              {!leads.length && <tr><td colSpan={6} className="vacio">Nadie interactuó en este período</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
