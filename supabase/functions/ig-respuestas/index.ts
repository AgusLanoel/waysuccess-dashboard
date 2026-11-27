// Paso 2 de las automatizaciones de IG por sondeo (27-11): Meta dejó de mandar los webhooks de DMs (campo "messages"),
// así que cada minuto (cron ig-respuestas) se lee la bandeja y, a quien respondió el DM de apertura (tocó "Quiero mis
// guiones" o escribió cualquier cosa), se le manda el DM con su link único. Mismo candado que ig-webhook
// (paso 1 → 2), así que si el webhook vuelve a llegar, nadie recibe el link dos veces. Auth: x-sync-key.
// - Una persona = un link: si comentó varias veces, se manda solo el de su último comentario; los anteriores quedan
//   en paso 3 (reemplazados).
// - El link va ESCRITO en el texto: Instagram acepta las plantillas con botón pero las muestra sin botón (27-11).
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

// texto del paso 2 con el link escrito ({link} donde lo pongan; si no, al final con el texto del botón)
export function textoLink(a: any, link: string) {
  const m = String(a?.mensaje ?? "").replaceAll("{nombre}", "").replaceAll("{palabra}", "").replace(/[ \t]+([!,.])/g, "$1").trim();
  if (m.includes("{link}")) return m.replaceAll("{link}", link);
  return `${m}\n\n👉 ${a?.boton_link ? a.boton_link + ": " : ""}${link}`;
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("no", { status: 401 });

  // pendientes: recibieron la apertura en las últimas 24 h (ventana de mensajería de Meta) y todavía no el link
  const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: pend } = await sb.from("org_mensajes").select("id, slug, ig_sender, username, enviado_at, automatizacion_id").eq("paso", 1).eq("ok", true).not("slug", "is", null).not("ig_sender", "is", null).gte("enviado_at", desde).order("id", { ascending: false });
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
  const autos = new Map<number, any>();
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
    if (!autos.has(p.automatizacion_id)) autos.set(p.automatizacion_id, (await sb.from("org_automatizaciones").select("*").eq("id", p.automatizacion_id).single()).data);
    let error: string | null = null;
    try { await enviar(t, { recipient: { id: quien }, message: { text: textoLink(autos.get(p.automatizacion_id), LINK + p.slug) } }); }
    catch (e) { error = String(e).slice(0, 300); }
    await sb.from("org_mensajes").update(error ? { paso: 1, error2: error } : { link_enviado_at: new Date().toISOString(), error2: null }).eq("id", p.id);
    enviados.push(`${p.username ?? quien}${error ? " ✗ " + error : ""}`);
  }
  if (enviados.length) await sb.from("org_webhook_log").insert({ fuente: "ig-respuestas", ok: true, detalle: `links: ${enviados.join(", ")}`.slice(0, 200) });
  return Response.json({ pendientes: pend.length, respondieron: enviados });
});
