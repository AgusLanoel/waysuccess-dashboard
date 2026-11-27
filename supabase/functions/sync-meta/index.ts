// Carga gasto y métricas diarias por anuncio desde Meta (cuenta Waysuccess Ads USA).
// La cuenta cerrada WaySuccess Ads (1376171866434598) se cargó una sola vez (jul–oct 2026) desde la conexión de Meta del usuario:
// el token de sistema no tiene permiso sobre ella y sus datos ya no cambian.
// Body opcional: { since: "YYYY-MM-DD", until: "YYYY-MM-DD" }. Por defecto, los últimos 4 días.
// Protegida con x-sync-key.
// 24-11-2026 (v11): además guarda métricas POR HORA por anuncio en meta_insights_hourly (para el reporte 19:00→19:00 Chile).
//   Si esa parte falla no rompe el sync diario: queda el error en detail.hourly_error.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("META_SYSTEM_TOKEN")!;
const ACCOUNTS = ["1327704949277228"]; // Waysuccess Ads USA
const G = "https://graph.facebook.com/v23.0";
// El evento de agenda calificada que GHL manda por API llega como evento personalizado del dataset.
const SCHEDULE_TYPES = ["offsite_conversion.fb_pixel_custom", "schedule_total", "offsite_conversion.fb_pixel_schedule", "schedule_website"];

async function pages(url: string) {
  const out: any[] = [];
  let next: string | null = url;
  while (next) {
    const r = await fetch(next);
    const b = await r.json();
    if (!r.ok) throw new Error(`Meta ${r.status}: ${b?.error?.message}`);
    out.push(...(b.data ?? []));
    next = b.paging?.next ?? null;
  }
  return out;
}

const act = (actions: any[] | undefined, types: string[]) => {
  for (const t of types) {
    const a = actions?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

// utm_content de los "Parámetros de URL" del anuncio (null si es dinámico, p. ej. {{ad.id}})
const utmContent = (tags?: string) => {
  const v = new URLSearchParams(tags ?? "").get("utm_content")?.trim();
  return v && !v.includes("{{") ? v : null;
};

async function syncHourly(account: string, ACT: string, since: string, until: string) {
  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  const ins = await pages(
    `${G}/${ACT}/insights?level=ad&time_increment=1&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&time_range=${tr}&fields=ad_id,adset_id,campaign_id,spend,impressions,inline_link_clicks,actions&limit=500&access_token=${TOKEN}`,
  );
  const rows = ins.map((r) => ({
    date: r.date_start,
    hour: Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone).slice(0, 2)),
    ad_id: r.ad_id,
    account_id: account,
    adset_id: r.adset_id,
    campaign_id: r.campaign_id,
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    link_clicks: Number(r.inline_link_clicks) || 0,
    landing_page_views: act(r.actions, ["landing_page_view", "omni_landing_page_view"]),
    synced_at: new Date().toISOString(),
  }));
  const { error: delErr } = await sb.from("meta_insights_hourly").delete().eq("account_id", account).gte("date", since).lte("date", until);
  if (delErr) throw delErr;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("meta_insights_hourly").upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }
  return rows.length;
}

async function syncAccount(account: string, since: string, until: string) {
  const ACT = `act_${account}`;
  // 1) Anuncios (nombres, conjunto, campaña, estado, miniatura, parámetros de URL, vista previa y página)
  const ads = await pages(
    `${G}/${ACT}/ads?fields=id,name,adset{id,name},campaign{id,name},effective_status,created_time,preview_shareable_link,creative{thumbnail_url,url_tags,effective_object_story_id,body}&limit=200&access_token=${TOKEN}`,
  );
  const adRows = ads.map((a) => ({
    ad_id: a.id,
    account_id: account,
    ad_name: a.name,
    adset_id: a.adset?.id,
    adset_name: a.adset?.name,
    campaign_id: a.campaign?.id,
    campaign_name: a.campaign?.name,
    effective_status: a.effective_status,
    created_time: a.created_time,
    thumbnail_url: a.creative?.thumbnail_url ?? null,
    url_tags: a.creative?.url_tags ?? null,
    utm_content: utmContent(a.creative?.url_tags),
    preview_url: a.preview_shareable_link ?? null,
    page_id: a.creative?.effective_object_story_id ? String(a.creative.effective_object_story_id).split("_")[0] : null,
    body: a.creative?.body ?? null,
    synced_at: new Date().toISOString(),
  }));
  for (let i = 0; i < adRows.length; i += 500) {
    const { error } = await sb.from("meta_ads").upsert(adRows.slice(i, i + 500));
    if (error) throw error;
  }

  // 2) Métricas diarias por anuncio
  const fields = "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,actions";
  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  const ins = await pages(
    `${G}/${ACT}/insights?level=ad&time_increment=1&time_range=${tr}&fields=${fields}&limit=500&access_token=${TOKEN}`,
  );
  const rows = ins.map((r) => ({
    date: r.date_start,
    ad_id: r.ad_id,
    account_id: account,
    adset_id: r.adset_id,
    campaign_id: r.campaign_id,
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    reach: Number(r.reach) || 0,
    clicks: Number(r.clicks) || 0,
    link_clicks: Number(r.inline_link_clicks) || 0,
    landing_page_views: act(r.actions, ["landing_page_view", "omni_landing_page_view"]),
    meta_schedules: act(r.actions, SCHEDULE_TYPES),
    actions: r.actions ?? null,
    synced_at: new Date().toISOString(),
  }));
  // Anuncios que aparecen en métricas pero ya no en la lista (borrados): guardar nombres igual
  const known = new Set(adRows.map((a) => a.ad_id));
  const missing = new Map<string, any>();
  for (const r of ins) if (!known.has(r.ad_id)) missing.set(r.ad_id, {
    ad_id: r.ad_id, account_id: account, ad_name: r.ad_name, adset_id: r.adset_id, adset_name: r.adset_name,
    campaign_id: r.campaign_id, campaign_name: r.campaign_name, effective_status: "DELETED_OR_ARCHIVED",
  });
  if (missing.size) await sb.from("meta_ads").upsert([...missing.values()], { ignoreDuplicates: true });

  // Reemplaza el rango completo de esta cuenta (Meta corrige días recientes)
  const { error: delErr } = await sb.from("meta_insights_daily").delete().eq("account_id", account).gte("date", since).lte("date", until);
  if (delErr) throw delErr;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("meta_insights_daily").upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }
  const out: Record<string, unknown> = { ads: adRows.length, insight_rows: rows.length, spend: rows.reduce((s, r) => s + r.spend, 0).toFixed(2) };
  try { out.hourly_rows = await syncHourly(account, ACT, since, until); }
  catch (e) { out.hourly_error = String((e as any)?.message ?? e); }
  return out;
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  const until = body.until ?? day(new Date());
  const since = body.since ?? day(new Date(Date.now() - 3 * 864e5));
  const { data: run } = await sb.from("sync_runs").insert({ source: "meta", detail: { since, until } }).select("id").single();

  const detail: Record<string, unknown> = { since, until };
  let failed = false;
  for (const a of ACCOUNTS) {
    try {
      detail[a] = await syncAccount(a, since, until);
    } catch (e) {
      failed = true;
      detail[a] = { error: String((e as any)?.message ?? e) };
    }
  }
  await sb.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: !failed, detail }).eq("id", run!.id);
  return Response.json(detail, { status: failed ? 500 : 200 });
});
