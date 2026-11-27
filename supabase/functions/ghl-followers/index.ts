// 16-11-2026: el dueño pidió sacar los followers de TODAS las oportunidades (a closers con "solo datos asignados"
// les aparecían leads de otros por ser followers). Body: { mode: "dry" | "apply" }.
// dry: lista las oportunidades con followers. apply: los quita con DELETE /opportunities/{id}/followers.
// El resultado queda en sync_runs (source "ghl-followers"). Protegida con x-sync-key.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GHL = Deno.env.get("GHL_PIT_TOKEN")!;
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const H = { Authorization: `Bearer ${GHL}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const API = "https://services.leadconnectorhq.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, body?: unknown, tries = 4): Promise<{ status: number; b: any }> {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 429 && tries > 0) { await sleep(2000); return call(method, path, body, tries - 1); }
  return { status: r.status, b: await r.json().catch(() => null) };
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const { mode = "dry" } = await req.json().catch(() => ({}));

  // Todas las oportunidades de la cuenta (todos los pipelines)
  const opps: any[] = [];
  let url: string | null = `/opportunities/search?location_id=${LOC}&limit=100`;
  let guard = 0;
  while (url && guard++ < 300) {
    const { status, b } = await call("GET", url);
    if (status !== 200) return Response.json({ error: status, body: b }, { status: 500 });
    opps.push(...(b.opportunities ?? []));
    const m = b.meta ?? {};
    url = (b.opportunities?.length ?? 0) === 100 && m.startAfterId
      ? `/opportunities/search?location_id=${LOC}&limit=100&startAfter=${m.startAfter}&startAfterId=${m.startAfterId}`
      : null;
  }
  const con = opps.filter((o) => Array.isArray(o.followers) && o.followers.length > 0)
    .map((o) => ({ id: o.id, name: o.name, pipeline: o.pipelineId, assignedTo: o.assignedTo ?? null, followers: o.followers }));

  const resultados: any[] = [];
  if (mode === "apply") {
    for (const o of con) {
      const r = await call("DELETE", `/opportunities/${o.id}/followers`, { followers: o.followers });
      resultados.push({ id: o.id, status: r.status, body: JSON.stringify(r.b).slice(0, 200) });
      await sleep(200);
    }
  }
  const out = { mode, total_opps: opps.length, con_followers: con.length, oportunidades: con, resultados };
  await sb.from("sync_runs").insert({ source: "ghl-followers", ok: true, finished_at: new Date().toISOString(), detail: out });
  return Response.json(out);
});
