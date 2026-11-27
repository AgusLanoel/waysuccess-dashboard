// Paso 1 de las automatizaciones de IG para DMs y respuestas a historias, por sondeo (27-11).
// Meta dejó de mandar los webhooks de DMs (campo "messages") desde ~16:00 del 27-11, y las historias de waysuccess_
// ahora piden "Respóndeme CONTENIDO / MARCA / JESSI…" (Business Suite no tiene encuestas). Regla del dueño: no se
// pregunta nada que no vayamos a contestar. Cada minuto (cron ig-dm-palabras):
//   1. lee los mensajes ENTRANTES nuevos de la bandeja de waysuccess_ desde el cursor (org_ig_cursor 'ws_dm');
//   2. cada mensaje se procesa una sola vez (org_dm_vistos.mid = id del mensaje en Graph = mid del webhook);
//   3. si contiene una palabra clave de una automatización activa (las de disparador 'comentario': mismas palabras,
//      mismo texto) y el mensaje es corto (≤ 4 palabras, para no saltar en medio de una conversación normal),
//      registra el toque (ig_event_id m:<mid>, igual que el webhook), y si la persona no tiene una apertura pendiente
//      ni recibió link en las últimas 24 h: crea su fila en org_mensajes (tipo 'dm' o 'historia'), su link único
//      (org_crear_link) y le manda el DM de apertura con la respuesta rápida, recipient {id: igsid}.
//   4. el paso 2 (link) lo manda ig-respuestas cuando la persona responde, igual que con los comentarios.
// No se duplica con ig-webhook: el webhook solo dispara automatizaciones con disparador 'dm'/'historia', y no hay
// ninguna (las de DM salen de aquí). Si un día se crean, hay que sacar este sondeo o esas filas.
// Auth: x-sync-key. Body {"dry": true} = solo lectura (no escribe ni manda nada) y devuelve qué haría.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const LINK = "https://www.waysuccess.io/l/";
const IG_ID = (Deno.env.get("IG_USER_ID") ?? "17841440091537738").trim();
const CURSOR = "ws_dm";
const SOLAPE_MS = 3 * 60e3; // relee 3 min hacia atrás por si un mensaje llega con retraso (org_dm_vistos evita repetir)
const MAX_PALABRAS = 4;

async function token() {
  const { data } = await sb.rpc("org_ig_token_get");
  return ((data as any[])?.[0]?.token ?? (Deno.env.get("IG_ACCESS_TOKEN") ?? "").trim()) as string;
}
const base = (t: string) => (t.startsWith("EAA") ? "https://graph.facebook.com/v23.0" : "https://graph.instagram.com");
const cuenta = (t: string) => (t.startsWith("EAA") ? IG_ID : "me");

async function get(t: string, path: string) {
  const r = await fetch(`${base(t)}/${path}`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}
async function enviar(t: string, body: unknown) {
  const r = await fetch(`${base(t)}/${cuenta(t)}/messages`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

// misma lógica que coincide() de ig-webhook
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
export const coincide = (palabras: string[], texto: string): string | null => {
  if (!palabras?.length) return "";
  const t = ` ${norm(texto).replace(/[^A-Z0-9Ñ]+/g, " ")} `;
  return palabras.find((p) => t.includes(` ${norm(p).trim()} `)) ?? null;
};
export const nPalabras = (texto: string) => norm(texto).replace(/[^A-Z0-9Ñ]+/g, " ").trim().split(" ").filter(Boolean).length;
const corto = (t: string) => { if (t.length <= 20) return t; const c = t.slice(0, 20); return (c.lastIndexOf(" ") > 8 ? c.slice(0, c.lastIndexOf(" ")) : c).replace(/[,\s]+$/, ""); };
const fechaChile = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

async function nombreDe(t: string, igsid: string, username: string | null): Promise<string> {
  try {
    const p = await get(t, `${igsid}?fields=name,username`);
    const pila = String(p?.name ?? "").trim().split(/\s+/)[0] ?? "";
    if (pila && /\p{L}/u.test(pila)) return pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase();
    if (p?.username) return `@${p.username}`;
  } catch (e) { console.error("nombre", String(e)); }
  return username ? `@${username}` : "";
}

// pieza de una respuesta a historia: el código hist-<nombre>-ws-<fecha> de ese día si hay uno solo (el que el dueño
// crea en Orgánico → Historias); si no, la historia misma (ig-<id>, tipo historia, como el webhook)
async function piezaHistoria(t: string, storyId: string, msgMs: number, dry: boolean) {
  let ms = msgMs;
  try { const s = await get(t, `${storyId}?fields=timestamp`); if (s?.timestamp) ms = Date.parse(s.timestamp); } catch { /* historia vencida o sin permiso */ }
  const { data } = await sb.from("org_piezas").select("id").like("id", `hist-%-ws-${fechaChile(ms)}`);
  if (data?.length === 1) return data[0].id as string;
  const { data: p } = await sb.from("org_piezas").select("id").eq("ig_media_id", storyId).maybeSingle();
  if (p) return p.id as string;
  const id = `ig-${storyId}`;
  if (!dry) await sb.from("org_piezas").upsert({ id, ig_media_id: storyId, tipo: "historia" }, { onConflict: "id", ignoreDuplicates: true });
  return id;
}

// textos de la automatización de comentarios adaptados a DM/historia (lo único que cambia: "comentar" → "escribir"
// y "en el post" → "en la historia" cuando responde a una historia)
function adaptar(m: string, historia: boolean) {
  let s = String(m ?? "").replaceAll("Gracias por comentar", "Gracias por escribir").replaceAll("gracias por comentar", "gracias por escribir");
  if (historia) s = s.replaceAll("en el post", "en la historia");
  return s;
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("no", { status: 401 });
  const body = await req.json().catch(() => ({}));
  const dry = !!body?.dry;

  const { data: cur } = await sb.from("org_ig_cursor").select("valor").eq("clave", CURSOR).maybeSingle();
  const ahora = Date.now();
  const piso = ahora - 24 * 3600e3; // fuera de la ventana de 24 h no se puede responder
  // en prueba (dry) se puede leer más atrás con {"desde": "<fecha>"} para revisar la detección con mensajes reales
  const desde = dry && body?.desde ? Date.parse(body.desde) : Math.max(piso, (cur?.valor ? Date.parse(cur.valor) : ahora) - SOLAPE_MS);

  const { data: autos } = await sb.from("org_automatizaciones").select("*").eq("activa", true).eq("disparador", "comentario").is("pieza_id", null).order("id");
  const t = await token();

  // 1. mensajes entrantes nuevos
  const nuevos: any[] = [];
  let maxVisto = cur?.valor ? Date.parse(cur.valor) : 0;
  let url: string | null = `${base(t)}/${cuenta(t)}/conversations?platform=instagram&limit=25&fields=updated_time,messages.limit(10){id,created_time,from,message,story}`;
  for (let pag = 0; url && pag < (dry ? 40 : 8); pag++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
    const j: any = await r.json().catch(() => ({}));
    if (j.error) return Response.json({ error: j.error.message }, { status: 502 });
    let viejas = false;
    for (const c of j.data ?? []) {
      if (Date.parse(c.updated_time) < desde) { viejas = true; break; }
      for (const m of c.messages?.data ?? []) {
        const de = String(m.from?.id ?? "");
        const at = Date.parse(m.created_time);
        if (!de || de === IG_ID || at < desde) continue;
        if (at > maxVisto) maxVisto = at;
        nuevos.push({ ...m, at, de });
      }
    }
    url = viejas ? null : j.paging?.next ?? null;
  }
  nuevos.sort((a, b) => a.at - b.at);

  // ya procesados
  const vistos = new Set<string>();
  if (nuevos.length) {
    const { data } = await sb.from("org_dm_vistos").select("mid").in("mid", nuevos.map((m) => m.id));
    for (const v of data ?? []) vistos.add(v.mid);
  }

  const res: any[] = [];
  const atendidos = new Set<string>(); // una apertura por persona por pasada
  for (const m of nuevos) {
    if (vistos.has(m.id)) continue;
    const texto = String(m.message ?? "");
    const storyId: string | null = m.story?.reply_to?.id ?? null;
    let a: any = null, palabra: string | null = null;
    if (texto && nPalabras(texto) <= MAX_PALABRAS) {
      for (const x of autos ?? []) { const p = coincide(x.palabras, texto); if (p) { a = x; palabra = p; break; } }
    }
    const fila: any = { mid: m.id, de: m.de, usuario: m.from?.username ?? null, at: m.created_time, texto: texto.slice(0, 80), historia: !!storyId, auto: a?.nombre ?? null };
    if (!a) {
      fila.resultado = texto && coincide((autos ?? []).flatMap((x) => x.palabras), texto) ? "largo (no dispara)" : "sin palabra";
      if (!dry) await sb.from("org_dm_vistos").insert({ mid: m.id, ig_sender: m.de, creado_at: m.created_time, resultado: fila.resultado });
      res.push(fila); continue;
    }
    // candado del mensaje: si otra pasada lo tomó, se salta
    if (!dry) {
      const { error } = await sb.from("org_dm_vistos").insert({ mid: m.id, ig_sender: m.de, creado_at: m.created_time, resultado: "procesando" });
      if (error) continue;
    }
    const tipo = storyId ? "historia" : "dm";
    // elegible: sin apertura pendiente (paso 1, ventana abierta) ni link en las últimas 24 h
    const d24 = new Date(ahora - 24 * 3600e3).toISOString();
    const { data: pend } = await sb.from("org_mensajes").select("id").eq("ig_sender", m.de).eq("paso", 1).eq("ok", true).gte("enviado_at", d24).limit(1);
    const { data: ya } = await sb.from("org_mensajes").select("id").eq("ig_sender", m.de).gte("link_enviado_at", d24).limit(1);
    const elegible = !pend?.length && !ya?.length && !atendidos.has(m.de);
    fila.resultado = elegible ? (dry ? "mandaría apertura" : "apertura") : pend?.length ? "ya tiene apertura pendiente" : ya?.length ? "ya recibió link en 24 h" : "ya atendido en esta pasada";
    if (dry) { fila.pieza = storyId ? await piezaHistoria(t, storyId, m.at, true) : `auto-${a.nombre.toLowerCase()}`; res.push(fila); continue; }

    // lead + pieza + toque
    const { data: L } = await sb.from("org_leads").upsert({ ig_user_id: m.de, ...(m.from?.username ? { ig_username: m.from.username } : {}) }, { onConflict: "ig_user_id" }).select("id, ig_username").single();
    if (!L) { await sb.from("org_dm_vistos").update({ resultado: "error lead" }).eq("mid", m.id); continue; }
    let pieza: string;
    if (storyId) pieza = await piezaHistoria(t, storyId, m.at, false);
    else {
      pieza = `auto-${a.nombre.toLowerCase()}`;
      await sb.from("org_piezas").upsert({ id: pieza, tipo: "dm", titulo: `Automatización ${a.nombre}` }, { onConflict: "id", ignoreDuplicates: true });
    }
    fila.pieza = pieza;
    const { error: et } = await sb.from("org_toques").insert({ lead_id: L.id, pieza_id: pieza, tipo: storyId ? "historia" : "dm_kw", nivel: storyId ? "A" : "B", ig_event_id: `m:${m.id}`, texto: texto.slice(0, 500), ocurrio_at: new Date(m.at).toISOString() });
    if (et && !/duplicate/.test(et.message)) console.error("toque", et.message);

    if (elegible) {
      atendidos.add(m.de);
      const { data: om, error: dup } = await sb.from("org_mensajes").insert({ lead_id: L.id, automatizacion_id: a.id, comentario_id: `m:${m.id}`, tipo, ig_sender: m.de, username: L.ig_username }).select("id").single();
      if (dup || !om) { fila.resultado = "ya registrado"; }
      else {
        const { data: slug } = await sb.rpc("org_crear_link", { p_pieza: pieza, p_lead: L.id, p_destino: a.destino, p_auto: a.nombre, p_medium: "dm" });
        const nombre = await nombreDe(t, m.de, L.ig_username);
        const llenar = (s: string) => adaptar(s, !!storyId).replaceAll("{link}", LINK + slug).replaceAll("{nombre}", nombre).replaceAll("{palabra}", (palabra || "").toUpperCase()).replace(/[ \t]+([!,.])/g, "$1");
        let textoEnv = llenar(a.mensaje_apertura || a.mensaje);
        let paso = 1, error: string | null = null;
        try {
          if (a.mensaje_apertura && a.boton_apertura) {
            try {
              await enviar(t, { recipient: { id: m.de }, message: { text: textoEnv.slice(0, 1000), quick_replies: [{ content_type: "text", title: corto(String(a.boton_apertura)), payload: `AUTO2:${om.id}` }] } });
            } catch (e1) {
              // sin respuesta rápida: un solo DM con todo y el link
              console.error("apertura qr", String(e1));
              const m2 = llenar(a.mensaje).replace(LINK + slug, "").trim();
              textoEnv = `${textoEnv}\n\n${m2}\n👉 ${a.boton_link ? a.boton_link + ": " : ""}${LINK + slug}`;
              await enviar(t, { recipient: { id: m.de }, message: { text: textoEnv.slice(0, 1000) } });
              paso = 2;
            }
          } else {
            const m2 = llenar(a.mensaje);
            textoEnv = m2.includes(LINK) ? m2 : `${m2}\n\n👉 ${a.boton_link ? a.boton_link + ": " : ""}${LINK + slug}`;
            await enviar(t, { recipient: { id: m.de }, message: { text: textoEnv.slice(0, 1000) } });
            paso = 2;
          }
        } catch (e) { error = String(e).slice(0, 300); }
        await sb.from("org_mensajes").update({ slug, texto: textoEnv, ok: !error, error, paso: error ? 1 : paso, ...(paso === 2 && !error ? { link_enviado_at: new Date().toISOString() } : {}) }).eq("id", om.id);
        fila.resultado = error ? `error: ${error}` : paso === 2 ? "link directo" : "apertura enviada";
      }
    }
    await sb.from("org_dm_vistos").update({ resultado: fila.resultado }).eq("mid", m.id);
    res.push(fila);
  }

  if (!dry && maxVisto) await sb.from("org_ig_cursor").update({ valor: new Date(maxVisto).toISOString(), actualizado_at: new Date().toISOString() }).eq("clave", CURSOR);
  const disparos = res.filter((r) => r.auto);
  if (!dry && disparos.length) await sb.from("org_webhook_log").insert({ fuente: "ig-dm-palabras", ok: true, detalle: disparos.map((r) => `${r.usuario ?? r.de} ${r.auto} ${r.resultado}`).join(", ").slice(0, 200) });
  return Response.json({ dry, desde: new Date(desde).toISOString(), leidos: nuevos.length, nuevos: res.length, disparos: disparos.length, detalle: dry ? res.filter((r) => r.auto || r.historia || String(r.resultado).startsWith("largo")) : disparos });
});
