// ig-sync (cron cada hora): trae posts, reels e historias de la cuenta de IG con sus métricas → org_piezas;
// completa el usuario de los leads que escribieron por DM; renueva el token (dura 60 días) y une leads con GHL.
// Token: primero private.ig_cuenta (renovado acá); si no hay, el secreto IG_ACCESS_TOKEN (se copia a la tabla).
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const G = "https://graph.instagram.com";

async function ig(path: string, token: string, params: Record<string, string> = {}) {
  const u = new URL(path.startsWith("http") ? path : `${G}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${path}: ${j.error?.message ?? r.status}`);
  return j;
}

async function token(): Promise<{ token: string; user: string }> {
  const { data } = await sb.rpc("org_ig_token_get");
  let row = (data as any[])?.[0];
  if (!row?.token) {
    const t = (Deno.env.get("IG_ACCESS_TOKEN") ?? "").trim();
    if (!t) throw new Error("falta IG_ACCESS_TOKEN");
    const me = await ig("me", t, { fields: "user_id,username" });
    await sb.rpc("org_ig_token_set", { p_token: t, p_expira: new Date(Date.now() + 55 * 864e5).toISOString(), p_user: String(me.user_id), p_username: me.username });
    row = { token: t, ig_user_id: String(me.user_id), token_expira: new Date(Date.now() + 55 * 864e5).toISOString() };
  }
  // renovar si vence en menos de 20 días (el token largo de IG dura 60 y se puede renovar después de 24 h)
  if (row.token_expira && new Date(row.token_expira).getTime() - Date.now() < 20 * 864e5) {
    try {
      const r = await ig("refresh_access_token", row.token, { grant_type: "ig_refresh_token" });
      await sb.rpc("org_ig_token_set", { p_token: r.access_token, p_expira: new Date(Date.now() + (r.expires_in ?? 5184000) * 1000).toISOString(), p_user: null, p_username: null });
      row.token = r.access_token;
    } catch (e) { console.error("refresh", String(e)); }
  }
  return { token: row.token, user: row.ig_user_id };
}

const tipoDe = (m: any) =>
  m.media_product_type === "STORY" ? "historia" : m.media_product_type === "REELS" ? "reel" : m.media_type === "CAROUSEL_ALBUM" ? "carrusel" : "post";

async function insights(id: string, tipo: string, t: string) {
  const sets = tipo === "historia" ? ["views,reach,shares,replies", "reach,replies"] : ["views,reach,saved,shares", "reach,saved,shares", "reach,saved"];
  for (const metric of sets) {
    try {
      const j = await ig(`${id}/insights`, t, { metric });
      const o: Record<string, number> = {};
      for (const d of j.data ?? []) o[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? 0;
      return o;
    } catch { /* probar con menos métricas */ }
  }
  return null;
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const res = { piezas: 0, insights: 0, usuarios: 0, unidos: 0, error: null as string | null };
  try {
    const { token: t } = await token();
    const F = "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,media_url,thumbnail_url";
    const media: any[] = [];
    let next: string | null = null, pag = 0;
    let j = await ig("me/media", t, { fields: F, limit: "50" });
    do {
      media.push(...(j.data ?? []));
      next = j.paging?.next ?? null;
      if (next && ++pag < 6) j = await ig(next, t); else next = null;
    } while (next);
    try { media.push(...((await ig("me/stories", t, { fields: F })).data ?? [])); } catch (e) { console.error("stories", String(e)); }

    const { data: prev } = await sb.from("org_piezas").select("id, insights_at, publicado_at").like("id", "ig-%");
    const vist = new Map((prev ?? []).map((p: any) => [p.id, p]));
    let llamadas = 0;
    for (const m of media) {
      const id = `ig-${m.id}`, tipo = tipoDe(m);
      const row: Record<string, unknown> = {
        id, ig_media_id: m.id, tipo, cuenta: "jessik", permalink: m.permalink, publicado_at: m.timestamp,
        caption: m.caption ?? null, titulo: (m.caption ?? "").split("\n")[0].slice(0, 90) || null,
        likes: m.like_count ?? null, comentarios: m.comments_count ?? null, media_url: m.media_url ?? null, thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
      };
      // métricas: posts de los últimos 60 días cada 6 h; más viejos una vez por semana; máximo 80 por corrida
      const p: any = vist.get(id);
      const edadDias = (Date.now() - new Date(m.timestamp).getTime()) / 864e5;
      const cada = edadDias < 60 ? 6 * 36e5 : 7 * 864e5;
      if (llamadas < 80 && (!p?.insights_at || Date.now() - new Date(p.insights_at).getTime() > cada)) {
        llamadas++;
        const i = await insights(m.id, tipo, t);
        if (i) {
          Object.assign(row, { views: i.views ?? null, alcance: i.reach ?? null, guardados: i.saved ?? null, compartidos: i.shares ?? null, insights_at: new Date().toISOString() });
          res.insights++;
        }
      }
      const { error } = await sb.from("org_piezas").upsert(row, { onConflict: "id" });
      if (error) console.error("pieza", id, error.message); else res.piezas++;
    }

    // usuarios de quienes escribieron por DM (el webhook solo trae el id)
    const { data: sinUser } = await sb.from("org_leads").select("id, ig_user_id").is("ig_username", null).not("ig_user_id", "is", null).limit(40);
    for (const l of sinUser ?? []) {
      try {
        const u = await ig(l.ig_user_id, t, { fields: "username,name" });
        await sb.from("org_leads").update({ ig_username: u.username ?? null, nombre: u.name ?? null }).eq("id", l.id);
        res.usuarios++;
      } catch { /* sin permiso para ese usuario */ }
    }
  } catch (e) { res.error = String(e).slice(0, 300); }
  const { data: n } = await sb.rpc("org_unir_leads");
  res.unidos = (n as number) ?? 0;
  await sb.from("org_webhook_log").insert({ fuente: "ig-sync", ok: !res.error, detalle: JSON.stringify(res).slice(0, 300) });
  return Response.json(res);
});
