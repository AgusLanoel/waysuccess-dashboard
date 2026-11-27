// Webhook de Instagram (comentarios, DMs, respuestas a historias, referidos de anuncios) → org_leads + org_toques.
// GET = verificación de Meta (IG_VERIFY_TOKEN, por defecto jessik-organico-2026). POST = firma X-Hub-Signature-256 con
// IG_APP_SECRET (app de Instagram) o META_APP_SECRET (app de Facebook).
// Automatizaciones (org_automatizaciones): SOLO las activas. Palabra clave → respuesta pública opcional + DM privado con
// link único por persona (www.waysuccess.io/l/<slug>) → el quiz lleva el slug a GHL (utm_term) → agenda y pago por pieza.
// Mientras ManyChat responda, las automatizaciones quedan apagadas (nunca dos sistemas contestando lo mismo).
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const VERIFY = (Deno.env.get("IG_VERIFY_TOKEN") || "jessik-organico-2026").trim();
const SECRETS = [Deno.env.get("IG_APP_SECRET"), Deno.env.get("META_APP_SECRET")].map((s) => (s ?? "").trim()).filter(Boolean);
const LINK = "https://www.waysuccess.io/l/";
const G = "https://graph.instagram.com";
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
const coincide = (palabras: string[], texto: string) => {
  if (!palabras?.length) return true;
  const t = ` ${norm(texto).replace(/[^A-Z0-9Ñ]+/g, " ")} `;
  return palabras.some((p) => t.includes(` ${norm(p).trim()} `));
};
let tokenCache: string | null = null;
async function tokenIg() {
  if (tokenCache) return tokenCache;
  const { data } = await sb.rpc("org_ig_token_get");
  tokenCache = ((data as any[])?.[0]?.token ?? (Deno.env.get("IG_ACCESS_TOKEN") ?? "").trim()) || null;
  return tokenCache;
}
async function post(path: string, body: unknown) {
  const t = await tokenIg();
  if (!t) throw new Error("falta token de IG");
  const r = await fetch(`${G}/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

async function automatizar(o: { disparador: "comentario" | "dm" | "historia"; texto: string; pieza: string | null; lead: { id: number; ig_username: string | null }; comentarioId?: string; senderId?: string; eventoId: string }) {
  const { data: autos } = await sb.from("org_automatizaciones").select("*").eq("activa", true).eq("disparador", o.disparador);
  for (const a of autos ?? []) {
    if (a.pieza_id && a.pieza_id !== o.pieza) continue;
    if (!coincide(a.palabras, o.texto)) continue;
    // candado: una sola respuesta por automatización y comentario/mensaje (Meta reintenta los webhooks)
    const { data: fila, error: dup } = await sb.from("org_mensajes").insert({ lead_id: o.lead.id, automatizacion_id: a.id, comentario_id: o.eventoId, tipo: o.disparador }).select("id").single();
    if (dup || !fila) continue;
    const pieza = o.pieza ?? `auto-${a.nombre.toLowerCase()}`;
    if (!o.pieza) await sb.from("org_piezas").upsert({ id: pieza, tipo: "dm", titulo: `Automatización ${a.nombre}` }, { onConflict: "id", ignoreDuplicates: true });
    const { data: slug } = await sb.rpc("org_crear_link", { p_pieza: pieza, p_lead: o.lead.id, p_destino: a.destino, p_auto: a.nombre, p_medium: o.disparador === "comentario" ? "comentario" : "dm" });
    const texto = String(a.mensaje).replaceAll("{link}", LINK + slug).replaceAll("{nombre}", o.lead.ig_username ? `@${o.lead.ig_username}` : "").replace(/\s+([!,.])/g, "$1");
    let error: string | null = null;
    try {
      const recipient = o.comentarioId ? { comment_id: o.comentarioId } : { id: o.senderId };
      await post("me/messages", { recipient, message: { text: texto } });
      if (o.comentarioId && a.respuesta_publica) {
        try { await post(`${o.comentarioId}/replies`, { message: a.respuesta_publica }); } catch (e) { console.error("respuesta pública", String(e)); }
      }
    } catch (e) { error = String(e).slice(0, 300); }
    await sb.from("org_mensajes").update({ slug, texto, ok: !error, error }).eq("id", fila.id);
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
        if (!v.parent_id) await automatizar({ disparador: "comentario", texto: String(v.text ?? ""), pieza, lead: L, comentarioId: String(v.id), eventoId: `c:${v.id}` });
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
