// Paso 2 de las automatizaciones de IG por sondeo (27-11): Meta dejó de mandar los webhooks de DMs (campo "messages"),
// así que cada minuto (cron ig-respuestas) se lee la bandeja y, a quien respondió el DM de apertura (tocó "Quiero mis
// guiones" o escribió cualquier cosa), se le manda el DM con el botón al link único. Mismo candado que ig-webhook
// (paso 1 → 2), así que si el webhook vuelve a llegar, nadie recibe el link dos veces. Auth: x-sync-key.
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

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("no", { status: 401 });

  // pendientes: recibieron la apertura en las últimas 24 h (ventana de mensajería de Meta) y todavía no el link
  const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: pend } = await sb.from("org_mensajes").select("id, slug, ig_sender, username, enviado_at, automatizacion_id").eq("paso", 1).eq("ok", true).not("slug", "is", null).not("ig_sender", "is", null).gte("enviado_at", desde);
  if (!pend?.length) return Response.json({ pendientes: 0 });

  const t = await token();
  const masVieja = Math.min(...pend.map((p) => Date.parse(p.enviado_at)));
  // conversaciones actualizadas desde la apertura más vieja (bandeja ordenada por actividad)
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
  for (const p of pend) {
    const ult = respondio.get(String(p.ig_sender));
    if (!ult || ult <= Date.parse(p.enviado_at)) continue;
    // candado compartido con ig-webhook
    const { data: tomado } = await sb.from("org_mensajes").update({ paso: 2 }).eq("id", p.id).eq("paso", 1).select("id");
    if (!tomado?.length) continue;
    if (!autos.has(p.automatizacion_id)) autos.set(p.automatizacion_id, (await sb.from("org_automatizaciones").select("*").eq("id", p.automatizacion_id).single()).data);
    const a = autos.get(p.automatizacion_id);
    const link = LINK + p.slug;
    const texto = String(a?.mensaje ?? "{link}").replaceAll("{nombre}", "").replaceAll("{palabra}", "").replace(/[ \t]+([!,.])/g, "$1");
    let error: string | null = null;
    try {
      if (a?.boton_link) {
        const txt = texto.replaceAll("{link}", "").trim();
        try {
          await enviar(t, { recipient: { id: p.ig_sender }, message: { attachment: { type: "template", payload: { template_type: "button", text: txt.slice(0, 640), buttons: [{ type: "web_url", title: String(a.boton_link).slice(0, 20), url: link }] } } } });
        } catch (e1) {
          console.error("link con botón", String(e1));
          await enviar(t, { recipient: { id: p.ig_sender }, message: { text: `${txt}\n\n${a.boton_link}: ${link}` } });
        }
      } else {
        await enviar(t, { recipient: { id: p.ig_sender }, message: { text: texto.replaceAll("{link}", link) } });
      }
    } catch (e) { error = String(e).slice(0, 300); }
    await sb.from("org_mensajes").update(error ? { paso: 1, error2: error } : { link_enviado_at: new Date().toISOString(), error2: null }).eq("id", p.id);
    enviados.push(`${p.username ?? p.ig_sender}${error ? " ✗ " + error : ""}`);
  }
  if (enviados.length) await sb.from("org_webhook_log").insert({ fuente: "ig-respuestas", ok: true, detalle: `links: ${enviados.join(", ")}`.slice(0, 200) });
  return Response.json({ pendientes: pend.length, respondieron: enviados });
});
