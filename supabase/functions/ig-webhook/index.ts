// Webhook de Instagram (comentarios, DMs, respuestas a historias, referidos de anuncios) → org_leads + org_toques.
// GET = verificación de Meta (IG_VERIFY_TOKEN, por defecto jessik-organico-2026). POST = firma X-Hub-Signature-256 con
// IG_APP_SECRET (app de Instagram) o META_APP_SECRET (app de Facebook).
// Automatizaciones (org_automatizaciones): SOLO las activas. Palabra clave → respuesta pública opcional + DM privado con
// link único por persona (www.waysuccess.io/l/<slug>) → el quiz lleva el slug a GHL (utm_term) → agenda y pago por pieza.
// Flujo de 2 pasos (mensaje_apertura + boton_apertura): DM de apertura con botón → al tocarlo/responder, DM con botón al link.
// ManyChat apagado desde 27-11: nunca dos sistemas contestando lo mismo.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const VERIFY = (Deno.env.get("IG_VERIFY_TOKEN") || "jessik-organico-2026").trim();
const SECRETS = [Deno.env.get("IG_APP_SECRET"), Deno.env.get("META_APP_SECRET")].map((s) => (s ?? "").trim()).filter(Boolean);
const LINK = "https://www.waysuccess.io/l/";
const IG_ID = (Deno.env.get("IG_USER_ID") ?? "17841440091537738").trim();
const enc = new TextEncoder();

async function firmaOk(req: Request, body: string) {
  const h = req.headers.get("x-hub-signature-256") ?? "";
  if (!SECRETS.length || !h.startsWith("sha256=")) return false;
  const got = h.slice(7);
  for (const s of SECRETS) {
    const k = await crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const want = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(body)))).map((x) => x.toString(16).padStart(2, "0")).join("");
    if (got.length !== want.length) continue;
    let r = 0; for (let i = 0; i < got.length; i++) r |= got.charCodeAt(i) ^ want.charCodeAt(i);
    if (r === 0) return true;
  }
  return false;
}

async function lead(igId: string, username?: string | null) {
  const { data } = await sb.from("org_leads").upsert({ ig_user_id: igId, ...(username ? { ig_username: username } : {}) }, { onConflict: "ig_user_id" }).select("id, ig_username").single();
  return data as { id: number; ig_username: string | null } | null;
}
async function piezaPorMedia(mediaId?: string | null, tipoIg?: string | null) {
  if (!mediaId) return null;
  const { data } = await sb.from("org_piezas").select("id").eq("ig_media_id", mediaId).maybeSingle();
  if (data) return data.id as string;
  const tipo = /REEL/i.test(tipoIg ?? "") ? "reel" : /STORY/i.test(tipoIg ?? "") ? "historia" : "post";
  const id = `ig-${mediaId}`;
  await sb.from("org_piezas").upsert({ id, ig_media_id: mediaId, tipo }, { onConflict: "id" });
  return id;
}
async function piezaPorPalabra(texto?: string | null) {
  const m = (texto ?? "").toUpperCase().match(/\b([A-ZÑ]{3,})[- ]?(\d{2,3})\b/);
  if (!m) return null;
  const { data } = await sb.from("org_piezas").select("id").ilike("palabra_clave", `${m[1]}${m[2]}`).maybeSingle();
  return (data?.id as string) ?? null;
}
async function toque(t: Record<string, unknown>) {
  const { error } = await sb.from("org_toques").insert(t);
  if (error && !/duplicate/.test(error.message)) console.error("ig toque", error.message);
}

// ───────── automatizaciones ─────────
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
// devuelve la palabra que coincidió ("" si la automatización no tiene palabras), o null si no coincide
const coincide = (palabras: string[], texto: string): string | null => {
  if (!palabras?.length) return "";
  const t = ` ${norm(texto).replace(/[^A-Z0-9Ñ]+/g, " ")} `;
  return palabras.find((p) => t.includes(` ${norm(p).trim()} `)) ?? null;
};
// títulos de botón: Meta acepta hasta 20 caracteres → recorte por palabra
const corto = (t: string) => { if (t.length <= 20) return t; const c = t.slice(0, 20); return (c.lastIndexOf(" ") > 8 ? c.slice(0, c.lastIndexOf(" ")) : c).replace(/[,\s]+$/, ""); };
let tokenCache: string | null = null;
async function tokenIg() {
  if (tokenCache) return tokenCache;
  const { data } = await sb.rpc("org_ig_token_get");
  tokenCache = ((data as any[])?.[0]?.token ?? (Deno.env.get("IG_ACCESS_TOKEN") ?? "").trim()) || null;
  return tokenCache;
}
async function get(path: string) {
  const t = await tokenIg();
  if (!t) throw new Error("falta token de IG");
  const base = t.startsWith("EAA") ? "https://graph.facebook.com/v23.0" : "https://graph.instagram.com";
  const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}
async function post(path: string, body: unknown) {
  const t = await tokenIg();
  if (!t) throw new Error("falta token de IG");
  // token de Instagram (IGAA…) → graph.instagram.com/me; token de Facebook (EAA…) → graph.facebook.com/<id de la cuenta de IG>
  const base = t.startsWith("EAA") ? "https://graph.facebook.com/v23.0" : "https://graph.instagram.com";
  const r = await fetch(`${base}/${path.replace(/^me\//, t.startsWith("EAA") ? `${IG_ID}/` : "me/")}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

// {nombre} (28-11): nombre de pila del perfil (name) → si no, nombre sacado del usuario cuando parece un nombre
// (rpc org_nombre_pila: "adrian77d" → Adrián, "fernandez.sergio.d1982" → Sergio) → si no, vacío ("¡Hola!").
// Ya no se usa @usuario (cuentas de negocio tipo @sm.paisajismo). tipo = nombre_api | nombre_usuario | sin_nombre.
// Si la rpc falla, comportamiento anterior (name o @usuario, tipo "arroba").
async function saludoDe(igsid: string | null, username: string | null): Promise<{ nombre: string; tipo: string; usuario?: string | null }> {
  let name: string | null = null, user = username;
  if (igsid) {
    try { const p = await get(`${igsid}?fields=name,username`); name = p?.name ?? null; user = p?.username ?? user; }
    catch (e) { console.error("nombre", String(e)); }
  }
  try {
    const { data, error } = await sb.rpc("org_nombre_pila", { p_name: name, p_username: user });
    const r = (data as any[])?.[0];
    if (!error && r) return { nombre: String(r.nombre ?? ""), tipo: String(r.tipo), usuario: user };
  } catch (e) { console.error("org_nombre_pila", String(e)); }
  const pila = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  if (pila && /\p{L}/u.test(pila)) return { nombre: pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase(), tipo: "nombre_api" };
  return user ? { nombre: `@${user}`, tipo: "arroba" } : { nombre: "", tipo: "sin_nombre" };
}

// A/B (28-11): si la automatización tiene un test CORRIENDO, la persona recibe su variante (fija por persona).
// Sin test corriendo (o si la rpc falla) → null y todo sigue exactamente igual que v13.
async function varianteDe(autoId: number, usuario: string | null) {
  if (!usuario) return null;
  try {
    const { data, error } = await sb.rpc("org_auto_asignar", { p_auto: autoId, p_usuario: usuario });
    if (error) { console.error("org_auto_asignar", error.message); return null; }
    return ((data as any[])?.[0] ?? null) as { test_id: number; variante_id: number; letra: string; mensaje_apertura: string | null; boton_apertura: string | null; mensaje: string | null; boton_link: string | null; destino: string | null } | null;
  } catch (e) { console.error("org_auto_asignar", String(e)); return null; }
}

async function automatizar(o: { disparador: "comentario" | "dm" | "historia"; texto: string; pieza: string | null; lead: { id: number; ig_username: string | null }; comentarioId?: string; senderId?: string; igId?: string; eventoId: string }) {
  const { data: autos } = await sb.from("org_automatizaciones").select("*").eq("activa", true).eq("disparador", o.disparador);
  for (const a0 of autos ?? []) {
    if (a0.pieza_id && a0.pieza_id !== o.pieza) continue;
    const palabra = coincide(a0.palabras, o.texto);
    if (palabra === null) continue;
    // candado: una sola respuesta por automatización y comentario/mensaje (Meta reintenta los webhooks)
    const { data: fila, error: dup } = await sb.from("org_mensajes").insert({ lead_id: o.lead.id, automatizacion_id: a0.id, comentario_id: o.eventoId, tipo: o.disparador, ig_sender: o.senderId ?? o.igId ?? null, username: o.lead.ig_username }).select("id").single();
    if (dup || !fila) continue;
    const v = await varianteDe(a0.id, o.senderId ?? o.igId ?? null);
    const a = v ? { ...a0, mensaje_apertura: v.mensaje_apertura ?? a0.mensaje_apertura, boton_apertura: v.boton_apertura ?? a0.boton_apertura, mensaje: v.mensaje ?? a0.mensaje, boton_link: v.boton_link ?? a0.boton_link, destino: v.destino ?? a0.destino } : a0;
    const pieza = o.pieza ?? `auto-${a.nombre.toLowerCase()}`;
    if (!o.pieza) await sb.from("org_piezas").upsert({ id: pieza, tipo: "dm", titulo: `Automatización ${a.nombre}` }, { onConflict: "id", ignoreDuplicates: true });
    const { data: slug } = await sb.rpc("org_crear_link", { p_pieza: pieza, p_lead: o.lead.id, p_destino: a.destino, p_auto: a.nombre, p_medium: o.disparador === "comentario" ? "comentario" : "dm" });
    if (v && slug) await sb.from("org_links").update({ variante_id: v.variante_id, variante: v.letra }).eq("slug", slug);
    const sal = await saludoDe(o.senderId ?? o.igId ?? null, o.lead.ig_username);
    const nombre = sal.nombre;
    // {nombre_o_usuario}: el nombre si lo hay; si no, @usuario (para el test sugerido "@usuario vs sin nombre")
    const nomUsu = nombre || (sal.usuario ? `@${sal.usuario}` : "");
    const llenar = (m: string) => String(m ?? "").replaceAll("{link}", LINK + slug).replaceAll("{nombre_o_usuario}", nomUsu).replaceAll("{nombre}", nombre).replaceAll("{palabra}", (palabra || "").toUpperCase()).replace(/[ \t]+([!,.])/g, "$1");
    const recipient = o.comentarioId ? { comment_id: o.comentarioId } : { id: o.senderId };
    let error: string | null = null;
    let texto = llenar(a.mensaje);
    let paso = 1;
    try {
      if (a.mensaje_apertura && a.boton_apertura) {
        // flujo de 2 pasos (como ManyChat): DM de apertura con respuesta rápida → al tocarla (o responder) ig-respuestas manda el link
        texto = llenar(a.mensaje_apertura);
        const titulos = [String(a.boton_apertura), corto(String(a.boton_apertura))].filter((t, i, arr) => arr.indexOf(t) === i);
        // primero respuesta rápida: el toque llega como mensaje; el botón de plantilla necesita "messaging_postbacks"
        // (no activable con la cuenta de desarrollador bloqueada, 27-11) y además Instagram lo muestra sin botón
        const intentos = [
          { text: texto.slice(0, 1000), quick_replies: [{ content_type: "text", title: corto(String(a.boton_apertura)), payload: `AUTO2:${fila.id}` }] },
          ...titulos.map((title) => ({ attachment: { type: "template", payload: { template_type: "button", text: texto.slice(0, 640), buttons: [{ type: "postback", title, payload: `AUTO2:${fila.id}` }] } } })),
        ];
        let enviado = false;
        for (const message of intentos) {
          try { await post("me/messages", { recipient, message }); enviado = true; break; } catch (e1) { console.error("apertura", String(e1)); error = String(e1).slice(0, 300); }
        }
        if (enviado) error = null;
        else {
          // último recurso: un solo DM con todo y el link (un comentario permite un solo mensaje hasta que la persona responda)
          texto = `${texto}\n\n${llenar(a.mensaje).replace(LINK + slug, "").trim()}\n${a.boton_link ? a.boton_link + ": " : ""}${LINK + slug}`;
          await post("me/messages", { recipient, message: { text: texto.slice(0, 1000) } });
          error = null;
          paso = 2;
        }
      } else {
        await post("me/messages", { recipient, message: { text: texto } });
        paso = 2;
      }
      if (o.comentarioId && a.respuesta_publica) {
        try { await post(`${o.comentarioId}/replies`, { message: a.respuesta_publica }); } catch (e) { console.error("respuesta pública", String(e)); }
      }
    } catch (e) { error = String(e).slice(0, 300); }
    await sb.from("org_mensajes").update({ slug, texto, ok: !error, error, paso: error ? 1 : paso, ...(paso === 2 && !error ? { link_enviado_at: new Date().toISOString() } : {}) }).eq("id", fila.id);
    // extras 28-11 en un update aparte: si fallara (columna nueva), no toca el registro principal
    await sb.from("org_mensajes").update({ saludo: sal.tipo, ...(v ? { variante_id: v.variante_id, test_id: v.test_id } : {}) }).eq("id", fila.id).then(({ error: e }) => e && console.error("extras", e.message));
    break; // una automatización por evento
  }
}

async function procesar(j: any) {
  const cuenta = new Set<string>();
  for (const e of j.entry ?? []) {
    cuenta.add(String(e.id ?? ""));
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {};
      if ((ch.field === "comments" || ch.field === "live_comments") && v.from?.id && String(v.from.id) !== String(e.id)) {
        const L = await lead(String(v.from.id), v.from.username);
        if (!L) continue;
        const pieza = await piezaPorMedia(v.media?.id, v.media?.media_product_type);
        await toque({ lead_id: L.id, pieza_id: pieza, tipo: v.media?.ad_id ? "anuncio" : "comentario", nivel: "A", ig_event_id: `c:${v.id}`, texto: String(v.text ?? "").slice(0, 500), ocurrio_at: new Date().toISOString() });
        // respuestas del propio equipo / respuestas a otro comentario no disparan
        if (!v.parent_id) await automatizar({ disparador: "comentario", texto: String(v.text ?? ""), pieza, lead: L, comentarioId: String(v.id), igId: String(v.from.id), eventoId: `c:${v.id}` });
      }
    }
    for (const m of e.messaging ?? []) {
      const msg = m.message;
      if (!msg && !m.referral && !m.postback) continue; // lecturas, reacciones, etc.
      if (msg?.is_echo || !m.sender?.id || String(m.sender.id) === String(e.id)) continue;
      const L = await lead(String(m.sender.id));
      if (!L) continue;
      const at = new Date(m.timestamp ?? Date.now()).toISOString();
      const id = `m:${msg?.mid ?? m.timestamp}`;
      const texto = String(msg?.text ?? m.postback?.title ?? "");
      const payload = m.postback?.payload ?? msg?.quick_reply?.payload ?? null;
      // 27-11: el link lo manda SOLO ig-respuestas (cron cada minuto, texto con link, una vez por persona).
      // Si es respuesta a una apertura pendiente, se registra el toque y no se dispara otra automatización.
      if (payload || msg?.text) {
        const { count: pendiente } = await sb.from("org_mensajes").select("id", { count: "exact", head: true }).eq("paso", 1).or(`lead_id.eq.${L.id},ig_sender.eq.${m.sender.id}`);
        if (pendiente || /^AUTO2:/.test(payload ?? "")) { await toque({ lead_id: L.id, tipo: "dm_respuesta", nivel: "B", ig_event_id: id, texto: texto.slice(0, 500), ocurrio_at: at }); continue; }
      }
      const ref = m.referral ?? msg?.referral;
      if (ref?.ad_id) { await toque({ lead_id: L.id, tipo: "anuncio", nivel: "A", ig_event_id: id, texto: `ad ${ref.ad_id}`, ocurrio_at: at }); continue; }
      if (msg?.reply_to?.story?.id) {
        const pieza = await piezaPorMedia(msg.reply_to.story.id, "STORY");
        await toque({ lead_id: L.id, pieza_id: pieza, tipo: "historia", nivel: "A", ig_event_id: id, texto: texto.slice(0, 500), ocurrio_at: at });
        await automatizar({ disparador: "historia", texto, pieza, lead: L, senderId: String(m.sender.id), eventoId: id });
        continue;
      }
      const share = (msg?.attachments ?? []).find((a: any) => ["share", "ig_reel", "reel", "story_mention"].includes(a.type));
      if (share) {
        const mid = share.payload?.reel_video_id ?? share.payload?.id ?? null;
        await toque({ lead_id: L.id, pieza_id: await piezaPorMedia(mid, share.type === "story_mention" ? "STORY" : "REEL"), tipo: share.type === "story_mention" ? "historia" : "compartido", nivel: "B", ig_event_id: id, texto: share.payload?.url?.slice(0, 300) ?? null, ocurrio_at: at });
        continue;
      }
      const p = await piezaPorPalabra(texto);
      const { count } = await sb.from("org_toques").select("id", { count: "exact", head: true }).eq("lead_id", L.id);
      if (p) await toque({ lead_id: L.id, pieza_id: p, tipo: "dm_kw", nivel: "B", ig_event_id: id, texto: texto.slice(0, 500), ocurrio_at: at });
      else if (!count) await toque({ lead_id: L.id, tipo: "dm_frio", nivel: "C", ig_event_id: id, texto: texto.slice(0, 500), ocurrio_at: at });
      if (texto) await automatizar({ disparador: "dm", texto, pieza: p, lead: L, senderId: String(m.sender.id), eventoId: id });
    }
  }
  return [...cuenta];
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && VERIFY && url.searchParams.get("hub.verify_token") === VERIFY;
    await sb.from("org_webhook_log").insert({ fuente: "instagram", ok: !!ok, detalle: ok ? "verificación OK" : "verificación rechazada (token distinto)" });
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
  }
  const body = await req.text();
  const ok = await firmaOk(req, body);
  let j: any = null; try { j = JSON.parse(body); } catch { /* */ }
  if (!ok) { await sb.from("org_webhook_log").insert({ fuente: "instagram", ok: false, detalle: SECRETS.length ? "firma no coincide" : "falta IG_APP_SECRET", payload: j }); return new Response("firma", { status: 401 }); }
  try { const c = await procesar(j); await sb.from("org_webhook_log").insert({ fuente: "instagram", ok: true, detalle: `cuentas ${c.join(",")}`.slice(0, 80) }); }
  catch (e) { console.error("ig procesar", String(e)); await sb.from("org_webhook_log").insert({ fuente: "instagram", ok: false, detalle: String(e).slice(0, 200), payload: j }); }
  return new Response("EVENT_RECEIVED");
});
