// Verifica qué permisos tiene GHL_PIT_TOKEN sin exponerlo. La prueba de escritura es un no-op:
// guarda una oportunidad con el mismo nombre que ya tiene. Devuelve también los campos de la oportunidad.
// Protegida con x-sync-key.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GHL = Deno.env.get("GHL_PIT_TOKEN")!;
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const H = { Authorization: `Bearer ${GHL}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const API = "https://services.leadconnectorhq.com";

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const b = await r.json().catch(() => null);
  return { status: r.status, body: b };
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const out: Record<string, unknown> = {};
  const cf = await call("GET", `/locations/${LOC}/customFields?model=opportunity`);
  out.customFields_read = cf.status;
  out.opp_fields = (cf.body?.customFields ?? []).map((f: any) => ({ id: f.id, name: f.name, key: f.fieldKey, type: f.dataType, options: f.picklistOptions ?? null }));
  out.users_read = (await call("GET", `/users/?locationId=${LOC}`)).status;
  const s = await call("GET", `/opportunities/search?location_id=${LOC}&pipeline_id=kW8pBFCaVVZJ1pw9okvh&limit=1`);
  out.opps_read = s.status;
  const o = s.body?.opportunities?.[0];
  if (o) out.opps_write = (await call("PUT", `/opportunities/${o.id}`, { name: o.name })).status;
  out.contacts_read = (await call("GET", `/contacts/?locationId=${LOC}&limit=1`)).status;
  out.calendars_read = (await call("GET", `/calendars/?locationId=${LOC}`)).status;
  return Response.json(out);
});
