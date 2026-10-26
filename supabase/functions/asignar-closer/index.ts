// Reparto de llamadas del calendario 7SNm0 (pedido del dueño 26-10):
// - DFY (ingresos $20k o más) -> siempre Luca. Si Luca tiene un downsell que se superpone, se intercambian (el downsell pasa a Jenny).
//   Si Luca tiene otra DFY superpuesta (o Jenny no está libre para el intercambio), no se toca y queda como alerta.
// - Downsell ($10k-$20k, antes $5k-$20k) -> queda con quien lo agendó (Luca o Jenny).
// Corre por cron cada minuto. Body opcional: { dry: true } para ver las decisiones sin escribir, { probe: "<eventId>" } para
// re-guardar una cita con su mismo closer (prueba de escritura sin cambios).
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GHL = Deno.env.get("GHL_PIT_TOKEN")!;
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const H = { Authorization: `Bearer ${GHL}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const API = "https://services.leadconnectorhq.com";
const CAL = "7SNm0NGnthgEIWCbOf05";
const LUCA = "8Ik8wFHag273XhAacKpC", JENNY = "nemsqu8uDRyZ6lasDDDV";
const NAME: Record<string, string> = { [LUCA]: "Luca", [JENNY]: "Jenny" };
const INGRESOS = "HiWwvpsTtDZMXR3ideKY"; // "¿Cuáles son tus ingresos mensuales…?" (el que usa el formulario)
const PIPE = "kW8pBFCaVVZJ1pw9okvh", CLOSER_CF = "eDFc3YKm41aXOXf7UR8m";
const BUFFER = 15 * 60_000; // buffer posterior del calendario
const ACTIVA = (s: string) => !["cancelled", "invalid", "noshow"].includes(s);

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ }
  return { status: r.status, json: j, text: t.slice(0, 300) };
}

const tipoDe = (ans: string | null) =>
  !ans ? null : /^\s*menos/i.test(ans) ? "no_califica" : /^\s*\$?\s*(5|10)k\s*a\s*\$?\s*20k/i.test(ans) ? "downsell" : "dfy";

async function ingreso(contactId: string): Promise<string | null> {
  const r = await api("GET", `/contacts/${contactId}`);
  const cf = r.json?.contact?.customFields ?? [];
  const v = cf.find((f: any) => f.id === INGRESOS)?.value;
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

async function eventosDe(userId: string, from: number, to: number) {
  const r = await api("GET", `/calendars/events?locationId=${LOC}&userId=${userId}&startTime=${from}&endTime=${to}`);
  return (r.json?.events ?? []).filter((e: any) => ACTIVA(e.appointmentStatus ?? ""));
}

const choca = (a: any, b: any) =>
  new Date(a.startTime).getTime() < new Date(b.endTime).getTime() + BUFFER &&
  new Date(b.startTime).getTime() < new Date(a.endTime).getTime() + BUFFER;

async function reasignar(ev: any, userId: string) {
  const r = await api("PUT", `/calendars/events/appointments/${ev.id}`, {
    calendarId: ev.calendarId, startTime: ev.startTime, endTime: ev.endTime, assignedUserId: userId, ignoreFreeSlotValidation: true,
  });
  // oportunidad del pipeline de Venta: mismo dueño y campo Closer, para que el dashboard y "Mi día" lo reflejen
  const o = await api("GET", `/opportunities/search?location_id=${LOC}&pipeline_id=${PIPE}&contact_id=${ev.contactId}&limit=5`);
  for (const opp of o.json?.opportunities ?? []) {
    if (opp.status !== "open") continue;
    await api("PUT", `/opportunities/${opp.id}`, { assignedTo: userId, customFields: [{ id: CLOSER_CF, field_value: NAME[userId] }] });
  }
  return r.status;
}

async function log(row: Record<string, unknown>) {
  await sb.from("asignaciones_closer").upsert({ ...row, at: new Date().toISOString() });
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  const dry = !!body.dry;

  if (body.probe) {
    const g = await api("GET", `/calendars/events/appointments/${body.probe}`);
    const ev = g.json?.appointment ?? g.json?.event ?? g.json;
    const p = await api("PUT", `/calendars/events/appointments/${body.probe}`, {
      calendarId: ev.calendarId, startTime: ev.startTime, endTime: ev.endTime, assignedUserId: ev.assignedUserId, ignoreFreeSlotValidation: true,
    });
    const g2 = await api("GET", `/calendars/events/appointments/${body.probe}`);
    const res = { antes: g.json, put: p.status, put_body: p.text, despues: g2.json };
    await sb.from("sync_runs").insert({ source: "asignar-closer", ok: p.status < 300, finished_at: new Date().toISOString(), detail: { probe: res } });
    return Response.json(res);
  }

  const now = Date.now(), to = now + 14 * 86400_000;
  const r = await api("GET", `/calendars/events?locationId=${LOC}&calendarId=${CAL}&startTime=${now}&endTime=${to}`);
  const evs = (r.json?.events ?? []).filter((e: any) => ACTIVA(e.appointmentStatus ?? ""));
  const { data: hechas } = await sb.from("asignaciones_closer").select("appt_id, accion");
  const listo = new Set((hechas ?? []).filter((h: any) => h.accion !== "alerta").map((h: any) => h.appt_id));
  const alertadas = new Set((hechas ?? []).filter((h: any) => h.accion === "alerta").map((h: any) => h.appt_id));
  const out: any[] = [];
  let lucaEvs: any[] | null = null, jennyEvs: any[] | null = null;

  for (const ev of evs) {
    if (ev.assignedUserId !== JENNY || listo.has(ev.id)) continue; // solo preocupan las DFY que cayeron en Jenny
    const tipo = tipoDe(await ingreso(ev.contactId));
    if (tipo !== "dfy") continue;
    lucaEvs ??= await eventosDe(LUCA, now - 3 * 3600_000, to);
    jennyEvs ??= await eventosDe(JENNY, now - 3 * 3600_000, to);
    const conflictos = lucaEvs.filter((x) => x.id !== ev.id && choca(x, ev));
    const base = { appt_id: ev.id, contact_id: ev.contactId, inicio: ev.startTime, tipo, de_user: "Jenny" };
    if (!conflictos.length) {
      const st = dry ? "dry" : await reasignar(ev, LUCA);
      out.push({ ...base, a_user: "Luca", accion: "movida", st });
      if (!dry) await log({ ...base, a_user: "Luca", accion: "movida", detalle: { st } });
      continue;
    }
    // ¿todos los choques de Luca son downsell y Jenny queda libre para tomarlos? -> intercambio
    const tipos = await Promise.all(conflictos.map(async (x) => tipoDe(await ingreso(x.contactId))));
    const jennyLibre = conflictos.every((x) => !jennyEvs!.some((j) => j.id !== ev.id && j.id !== x.id && choca(j, x)));
    if (tipos.every((t) => t === "downsell") && jennyLibre) {
      const st = dry ? "dry" : [await reasignar(ev, LUCA), ...(await Promise.all(conflictos.map((x) => reasignar(x, JENNY))))];
      out.push({ ...base, a_user: "Luca", accion: "intercambio", con: conflictos.map((x) => x.id), st });
      if (!dry) {
        await log({ ...base, a_user: "Luca", accion: "intercambio", detalle: { st, downsell_a_jenny: conflictos.map((x) => x.id) } });
        for (const x of conflictos) await log({ appt_id: x.id, contact_id: x.contactId, inicio: x.startTime, tipo: "downsell", de_user: "Luca", a_user: "Jenny", accion: "intercambio", detalle: { por: ev.id } });
      }
      continue;
    }
    if (alertadas.has(ev.id) && !dry) continue; // ya avisada; se reintenta sola si Luca se libera
    out.push({ ...base, a_user: null, accion: "alerta", motivo: "Luca ocupado con DFY a esa hora", con: conflictos.map((x) => x.id) });
    if (!dry) await log({ ...base, a_user: null, accion: "alerta", detalle: { motivo: "Luca ocupado con DFY", con: conflictos.map((x) => x.id) } });
  }
  const res = { dry, revisadas: evs.length, cambios: out, events_status: r.status };
  if (dry || out.length || r.status >= 300)
    await sb.from("sync_runs").insert({ source: "asignar-closer", ok: r.status < 300, finished_at: new Date().toISOString(), detail: res });
  return Response.json(res);
});
