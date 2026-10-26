// Escrituras puntuales en GHL StartFly: crear (POST /opportunities/) o actualizar (PUT /opportunities/{id}) oportunidades,
// crear/actualizar contactos (POST /contacts/upsert, deduplica por teléfono/email),
// actualizar el calendario de llamadas (PUT /calendars/7SNm0NGnthgEIWCbOf05) y crear campos personalizados (POST /locations/{LOC}/customFields).
// Protegida con x-sync-key. Body: { ops: [{ method: "PUT"|"POST", path, body }] }. Devuelve el status y la respuesta de cada una.
// "$contact" en el body de una op se reemplaza por el id del contacto devuelto por el último /contacts/upsert.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GHL = Deno.env.get("GHL_PIT_TOKEN")!;
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const H = { Authorization: `Bearer ${GHL}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const API = "https://services.leadconnectorhq.com";
const allowed = (m: string, p: string) =>
  (m === "PUT" && /^\/opportunities\/[A-Za-z0-9]+$/.test(p)) || (m === "POST" && p === "/opportunities/") ||
  (m === "POST" && p === "/contacts/upsert") || (m === "GET" && p === `/locations/${LOC}/customFields?model=contact`) ||
  (m === "PUT" && p === "/calendars/7SNm0NGnthgEIWCbOf05") || (m === "POST" && p === `/locations/${LOC}/customFields`);

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const { ops = [] } = await req.json().catch(() => ({}));
  const out: any[] = [];
  let contactId: string | null = null;
  for (const op0 of ops) {
    const op = { ...op0, path: String(op0.path).replace("{LOC}", LOC) };
    if (!allowed(op.method, op.path)) { out.push({ path: op.path, error: "no permitido" }); continue; }
    let body = op.body;
    if (contactId && body) body = JSON.parse(JSON.stringify(body).replaceAll('"$contact"', JSON.stringify(contactId)));
    if (op.method === "POST" && (op.path === "/opportunities/" || op.path === "/contacts/upsert")) body = { locationId: LOC, ...body };
    const r = await fetch(API + op.path, { method: op.method, headers: H, body: op.method === "GET" ? undefined : JSON.stringify(body) });
    const t = await r.text();
    if (op.path === "/contacts/upsert") { try { contactId = JSON.parse(t)?.contact?.id ?? null; } catch { contactId = null; } }
    out.push({ path: op.path, status: r.status, body: t.slice(0, 400) });
    await sb.from("sync_runs").insert({ source: "ghl-write", ok: r.ok, finished_at: new Date().toISOString(), detail: { path: op.path, status: r.status, body: op.method === "GET" ? t.slice(0, 20000) : t.slice(0, 400) } });
    await new Promise((res) => setTimeout(res, 250));
  }
  return Response.json(out);
});
