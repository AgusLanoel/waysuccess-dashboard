// ig-comentarios (cron cada hora, minuto 41): trae los comentarios (y respuestas) de los posts, carruseles y reels
// → org_comentarios; después recalcula la atribución recuperada (org_recuperar_atribucion).
// Sirve para saber en qué publicación comentó cada persona antes de llenar el quiz (antes del 27-11 ManyChat mandaba
// el mismo link a todos). Solo LEE de Meta: no responde ni manda mensajes.
// Body opcional: {"dias": 60} (ventana de publicaciones; por defecto 21), {"max_llamadas": 400}.
// Token: private.ig_cuenta vía rpc org_ig_token_get (el mismo de ig-sync). EAA → graph.facebook.com/v23.0.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const IG_ID = (Deno.env.get("IG_USER_ID") ?? "17841440091537738").trim();
const PROPIA = "waysuccess_";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

let llamadas = 0, maxLlamadas = 400, frenado: string | null = null;

// GET con reintentos: límites de Meta (códigos 4, 17, 32, 613 o HTTP 429/5xx) → espera 2 s, 6 s, 15 s.
// Si el uso de la app pasa el 85 % se deja de pedir en esta corrida (sigue en la próxima).
async function get(url: string): Promise<any> {
  for (let intento = 0; ; intento++) {
    if (llamadas >= maxLlamadas) { frenado = "tope de llamadas"; return null; }
    llamadas++;
    const r = await fetch(url);
    for (const h of ["x-app-usage", "x-business-use-case-usage"]) {
      const v = r.headers.get(h);
      if (!v) continue;
      const nums = (v.match(/"(call_count|total_cputime|total_time)"\s*:\s*(\d+)/g) ?? []).map((s) => +s.split(":")[1]);
      if (nums.some((n) => n >= 85)) frenado = `uso de la API ${Math.max(...nums)} %`;
    }
    const j = await r.json().catch(() => ({}));
    if (r.ok && !j.error) return j;
    const code = j.error?.code;
    const limite = [4, 17, 32, 613].includes(code) || r.status === 429 || r.status >= 500;
    if (!limite || intento >= 3) throw new Error(`${code ?? r.status}: ${j.error?.message ?? "error"}`);
    await espera([2000, 6000, 15000][intento]);
  }
}

const F = "id,text,timestamp,username,from{id,username}";

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  const dias = Math.min(Math.max(Number(body.dias) || 21, 1), 120);
  maxLlamadas = Math.min(Math.max(Number(body.max_llamadas) || 400, 10), 1500);
  const res = { piezas: 0, comentarios: 0, errores: 0, llamadas: 0, recuperados: null as unknown, frenado: null as string | null, error: null as string | null };
  try {
    const { data: tk } = await sb.rpc("org_ig_token_get");
    const token = (tk as any[])?.[0]?.token as string | undefined;
    if (!token) throw new Error("sin token en private.ig_cuenta");
    const G = token.startsWith("EAA") ? "https://graph.facebook.com/v23.0" : "https://graph.instagram.com";

    const desde = new Date(Date.now() - dias * 864e5).toISOString();
    const { data: piezas, error } = await sb.from("org_piezas").select("id, ig_media_id, comentarios")
      .like("id", "ig-%").neq("tipo", "historia").gte("publicado_at", desde).order("publicado_at", { ascending: false });
    if (error) throw new Error(error.message);

    for (const p of piezas ?? []) {
      if (frenado) break;
      if (!p.ig_media_id || !(p.comentarios > 0)) continue;
      const filas: Record<string, unknown>[] = [];
      const meter = (c: any, parent: string | null) => {
        const user = c.username ?? c.from?.username ?? null;
        filas.push({
          id: c.id, pieza_id: p.id, ig_media_id: p.ig_media_id, parent_id: parent, ig_user_id: c.from?.id ?? null,
          username: user, texto: c.text ?? null, ocurrio_at: c.timestamp,
          propio: (user ?? "").toLowerCase() === PROPIA || c.from?.id === IG_ID, traido_at: new Date().toISOString(),
        });
      };
      try {
        let url: string | null = `${G}/${p.ig_media_id}/comments?fields=${encodeURIComponent(`${F},replies.limit(50){${F}}`)}&limit=50&access_token=${token}`;
        let pag = 0;
        while (url && pag++ < 20) {
          const j = await get(url);
          if (!j) break;
          for (const c of j.data ?? []) {
            meter(c, null);
            for (const r of c.replies?.data ?? []) meter(r, c.id);
          }
          url = j.paging?.next ?? null;
        }
      } catch (e) { res.errores++; console.error("comentarios", p.id, String(e)); }
      for (let i = 0; i < filas.length; i += 500) {
        const { error: e2 } = await sb.from("org_comentarios").upsert(filas.slice(i, i + 500), { onConflict: "id" });
        if (e2) { res.errores++; console.error("upsert", p.id, e2.message); }
      }
      res.piezas++; res.comentarios += filas.length;
    }
  } catch (e) { res.error = String(e).slice(0, 300); }
  res.llamadas = llamadas; res.frenado = frenado;
  const { data: rec, error: er } = await sb.rpc("org_recuperar_atribucion");
  res.recuperados = er ? `error: ${er.message}` : rec;
  await sb.from("org_webhook_log").insert({ fuente: "ig-comentarios", ok: !res.error, detalle: JSON.stringify(res).slice(0, 300) });
  return Response.json(res);
});
