// Paso 2 de las automatizaciones de IG por sondeo (27-11): Meta dejó de mandar los webhooks de DMs (campo "messages"),
// así que cada minuto (cron ig-respuestas) se lee la bandeja y, a quien respondió el DM de apertura (tocó "Quiero mis
// guiones" o escribió cualquier cosa), se le manda el DM con su link único. Mismo candado que ig-webhook
// (paso 1 → 2), así que si el webhook vuelve a llegar, nadie recibe el link dos veces. Auth: x-sync-key.
// - Una persona = un link: si comentó varias veces, se manda solo el de su último comentario; los anteriores quedan
//   en paso 3 (reemplazados).
// - El link va ESCRITO en el texto: Instagram acepta las plantillas con botón pero las muestra sin botón (27-11).
// - 28-11: si el DM de apertura salió con una variante de un test A/B (org_mensajes.variante_id), el paso 2 usa el
//   texto de esa variante. Guarda respondio_at (cuándo tocó) para medir toque→link. Personaliza el paso 2 con el
//   nombre de pila (el perfil suele traer name después de que la persona respondió). Recordatorio único opcional
//   (org_automatizaciones.recordatorio_activo, apagado por defecto) SOLO para aperturas por DM/historia: a un
//   comentario Meta permite un solo mensaje privado hasta que la persona responda.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const LINK = "https://www.waysuccess.io/l/";
const IG_ID = (Deno.env.get("IG_USER_ID") ?? "17841440091537738").trim();

async function token() {
  const { data } = await sb.rpc("org_ig_token_get");
  return ((data as any[])?.[0]?.token ?? (Deno.env.get("IG_ACCESS_TOKEN") ?? "").trim()) as string;
}
const base = (t: string) => (t.startsWith("EAA") ? "https://graph.facebook.com/v23.0" : "https://graph.instagram.com");
const cuenta = (t: string) => (t.startsWith("EAA") ? IG_ID : "me");

async function enviar(t: string, body: unknown) {
  const r = await fetch(`${base(t)}/${cuenta(t)}/messages`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
}

// texto del paso 2 con el link escrito ({link} donde lo pongan; si no, al final con el texto del botón).
// nombre: si el texto tiene {nombre} va ahí; si no, "Adrián, acá lo tienes 👇…" (solo si el texto empieza con letra).
export function textoLink(a: any, link: string, nombre = "") {
  const raw = String(a?.mensaje ?? "");
  let m = raw.replaceAll("{nombre}", nombre).replaceAll("{palabra}", "").replace(/[ \t]+([!,.])/g, "$1").trim();
  if (nombre && !raw.includes("{nombre}") && /^\p{L}/u.test(m)) m = `${nombre}, ${m.charAt(0).toLowerCase()}${m.slice(1)}`;
  if (m.includes("{link}")) return m.replaceAll("{link}", link);
  return `${m}\n\n👉 ${a?.boton_link ? a.boton_link + ": " : ""}${link}`;
}

// nombre de pila para el paso 2: name del perfil o nombre sacado del usuario (rpc org_nombre_pila); nunca @usuario
async function nombrePaso2(t: string, igsid: string, username: string | null): Promise<{ nombre: string; tipo: string }> {
  let name: string | null = null, user = username;
  try {
    const r = await fetch(`${base(t)}/${igsid}?fields=name,username`, { headers: { Authorization: `Bearer ${t}` } });
    const j: any = await r.json().catch(() => ({}));
    if (!j.error) { name = j.name ?? null; user = j.username ?? user; }
  } catch { /* sin nombre */ }
  try {
    const { data, error } = await sb.rpc("org_nombre_pila", { p_name: name, p_username: user });
    const x = (data as any[])?.[0];
    if (!error && x) return { nombre: String(x.nombre ?? ""), tipo: String(x.tipo) };
  } catch { /* sin nombre */ }
  return { nombre: "", tipo: "sin_nombre" };
}

// textos de la variante A/B (si la hay) encima de los de la automatización
async function textosDe(autoId: number, varianteId: number | null, cache: Map<string, any>) {
  const k = `${autoId}:${varianteId ?? ""}`;
  if (cache.has(k)) return cache.get(k);
  const a = (await sb.from("org_automatizaciones").select("*").eq("id", autoId).single()).data;
  let r = a;
  if (varianteId && a) {
    const { data: v } = await sb.from("org_auto_variantes").select("*").eq("id", varianteId).maybeSingle();
    if (v) r = { ...a, mensaje_apertura: v.mensaje_apertura ?? a.mensaje_apertura, boton_apertura: v.boton_apertura ?? a.boton_apertura, mensaje: v.mensaje ?? a.mensaje, boton_link: v.boton_link ?? a.boton_link };
  }
  cache.set(k, r);
  return r;
}
const corto = (t: string) => { if (t.length <= 20) return t; const c = t.slice(0, 20); return (c.lastIndexOf(" ") > 8 ? c.slice(0, c.lastIndexOf(" ")) : c).replace(/[,\s]+$/, ""); };

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("no", { status: 401 });

  // pendientes: recibieron la apertura en las últimas 24 h (ventana de mensajería de Meta) y todavía no el link
  const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: pend } = await sb.from("org_mensajes").select("id, slug, ig_sender, username, enviado_at, automatizacion_id, variante_id, tipo, recordatorio_at").eq("paso", 1).eq("ok", true).not("slug", "is", null).not("ig_sender", "is", null).gte("enviado_at", desde).order("id", { ascending: false });
  if (!pend?.length) return Response.json({ pendientes: 0 });

  const t = await token();
  const masVieja = Math.min(...pend.map((p) => Date.parse(p.enviado_at)));
  const respondio = new Map<string, number>(); // ig id → último mensaje suyo (ms)
  let url: string | null = `${base(t)}/${cuenta(t)}/conversations?platform=instagram&limit=50&fields=updated_time,messages.limit(6){from,created_time}`;
  for (let pag = 0; url && pag < 6; pag++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
    const j: any = await r.json().catch(() => ({}));
    if (j.error) return Response.json({ error: j.error.message }, { status: 502 });
    let viejas = false;
    for (const c of j.data ?? []) {
      if (Date.parse(c.updated_time) < masVieja) { viejas = true; break; }
      for (const m of c.messages?.data ?? []) {
        const de = String(m.from?.id ?? "");
        if (!de || de === IG_ID) continue;
        const at = Date.parse(m.created_time);
        if (at > (respondio.get(de) ?? 0)) respondio.set(de, at);
      }
    }
    url = viejas ? null : j.paging?.next ?? null;
  }

  const enviados: string[] = [];
  const autos = new Map<string, any>();
  const atendidos = new Set<number>();
  const vistos = new Set<string>();
  for (const p of pend) { // de la más nueva a la más vieja
    const quien = String(p.ig_sender);
    if (vistos.has(quien)) { // comentario anterior de alguien que ya se atiende con el último
      await sb.from("org_mensajes").update({ paso: 3 }).eq("id", p.id).eq("paso", 1);
      continue;
    }
    const ult = respondio.get(quien);
    if (!ult || ult <= Date.parse(p.enviado_at)) {
      // todavía no respondió al último; si respondió a uno anterior, se atiende con el último igual
      if (!ult || !pend.some((q) => String(q.ig_sender) === quien && ult > Date.parse(q.enviado_at))) continue;
    }
    vistos.add(quien);
    // ¿ya recibió un link en las últimas 24 h después de su último comentario? → no repetir
    const { data: ya } = await sb.from("org_mensajes").select("id").eq("ig_sender", quien).gte("link_enviado_at", p.enviado_at).limit(1);
    if (ya?.length) { await sb.from("org_mensajes").update({ paso: 3 }).eq("id", p.id).eq("paso", 1); continue; }
    const { data: tomado } = await sb.from("org_mensajes").update({ paso: 2 }).eq("id", p.id).eq("paso", 1).select("id");
    if (!tomado?.length) continue;
    atendidos.add(p.id);
    const a = await textosDe(p.automatizacion_id, p.variante_id ?? null, autos);
    const sal = await nombrePaso2(t, quien, p.username ?? null);
    let error: string | null = null;
    try { await enviar(t, { recipient: { id: quien }, message: { text: textoLink(a, LINK + p.slug, sal.nombre) } }); }
    catch (e) { error = String(e).slice(0, 300); }
    await sb.from("org_mensajes").update(error ? { paso: 1, error2: error } : { link_enviado_at: new Date().toISOString(), error2: null }).eq("id", p.id);
    await sb.from("org_mensajes").update({ respondio_at: new Date(ult ?? Date.now()).toISOString(), saludo2: sal.tipo }).eq("id", p.id).then(({ error: e }) => e && console.error("extras", e.message));
    enviados.push(`${p.username ?? quien}${error ? " ✗ " + error : ""}`);
  }
  // recordatorio único (apagado por defecto): solo aperturas por DM/historia, X horas sin respuesta, dentro de 23 h
  const recordados: string[] = [];
  const conRec = new Set(((await sb.from("org_automatizaciones").select("id").eq("recordatorio_activo", true)).data ?? []).map((x: any) => x.id));
  if (conRec.size) {
    for (const p of pend) {
      if (atendidos.has(p.id) || p.recordatorio_at || !conRec.has(p.automatizacion_id) || !["dm", "historia"].includes(p.tipo)) continue;
      const a = await textosDe(p.automatizacion_id, p.variante_id ?? null, autos);
      const edad = Date.now() - Date.parse(p.enviado_at);
      if (!a?.recordatorio_texto || edad < (a.recordatorio_horas ?? 4) * 3600e3 || edad > 23 * 3600e3) continue;
      if ((respondio.get(String(p.ig_sender)) ?? 0) > Date.parse(p.enviado_at)) continue;
      const { data: tomado } = await sb.from("org_mensajes").update({ recordatorio_at: new Date().toISOString() }).eq("id", p.id).eq("paso", 1).is("recordatorio_at", null).select("id");
      if (!tomado?.length) continue;
      const texto = String(a.recordatorio_texto).replaceAll("{nombre}", "").replace(/[ \t]+([!,.])/g, "$1").trim();
      try {
        await enviar(t, { recipient: { id: String(p.ig_sender) }, message: { text: texto.slice(0, 1000), ...(a.boton_apertura ? { quick_replies: [{ content_type: "text", title: corto(String(a.boton_apertura)), payload: `AUTO2:${p.id}` }] } : {}) } });
        recordados.push(p.username ?? String(p.ig_sender));
      } catch (e) { await sb.from("org_mensajes").update({ recordatorio_error: String(e).slice(0, 300) }).eq("id", p.id); }
    }
    if (recordados.length) await sb.from("org_webhook_log").insert({ fuente: "ig-respuestas", ok: true, detalle: `recordatorios: ${recordados.join(", ")}`.slice(0, 200) });
  }

  if (enviados.length) await sb.from("org_webhook_log").insert({ fuente: "ig-respuestas", ok: true, detalle: `links: ${enviados.join(", ")}`.slice(0, 200) });
  return Response.json({ pendientes: pend.length, respondieron: enviados });
});
