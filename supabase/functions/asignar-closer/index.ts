// Reparto de llamadas de los calendarios de ads (7SNm0), orgánico del quiz (Q5crAi9, desde 23-11) e inmigración (sZdepV5, desde 23-11) (pedido del dueño 26-10 y 23-11):
// - DFY (ingresos $20k o más) -> siempre Luca. Si Luca tiene un downsell que se superpone, se intercambian (el downsell pasa a Jenny).
//   Si Luca tiene otra DFY superpuesta (o Jenny no está libre para el intercambio), no se toca y queda como alerta.
//   24-11 (dueño): la decisión es UNA sola vez, al entrar la cita. Si en ese momento Luca no podía, queda con Jenny
//   para siempre (aunque después Luca se libere). Antes las alertas se reintentaban cada minuto.
// - Downsell ($10k-$20k, antes $5k-$20k) -> queda con quien lo agendó (Luca o Jenny).
// - 24-11 (dueño): contactos con el tag "closer-fijo" no se tocan nunca (aunque reagenden).
// - 25-11 (Laura, caso Liliana Bustamante): solo se evalúan citas RECIÉN agendadas (creadas hace 30 min o menos).
//   Si alguien pasa una cita a Jenny a mano más tarde (ej. de Mileces a Jenny), el reparto automático no la toca.
// Corre por cron cada minuto. Body opcional: { dry: true } para ver las decisiones sin escribir, { probe: "<eventId>" } para
// re-guardar una cita con su mismo closer (prueba de escritura sin cambios), { fijar: { contact_id, user: "Jenny"|"Luca" } }
// para poner el tag "closer-fijo" y pasar sus próximas citas (y la oportunidad abierta) a ese closer.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GHL = Deno.env.get("GHL_PIT_TOKEN")!;
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const H = { Authorization: `Bearer ${GHL}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const API = "https://services.leadconnectorhq.com";
// 23-11: también el calendario orgánico del quiz ("Entrega de tus 30 guiones"), que toman Luca y Jenny,
// y el calendario del funnel de inmigración ("Llamada de Asesoramiento Inmigración | WS", mismo formulario de ingresos HiWw).
const CALS = ["7SNm0NGnthgEIWCbOf05", "Q5crAi9OAPOqzrg4cTgU", "sZdepV5YHrczI8waGvwZ"];
const LUCA = "8Ik8wFHag273XhAacKpC", JENNY = "nemsqu8uDRyZ6lasDDDV";
const NAME: Record<string, string> = { [LUCA]: "Luca", [JENNY]: "Jenny" };
const INGRESOS = "HiWwvpsTtDZMXR3ideKY"; // "¿Cuáles son tus ingresos mensuales…?" (el que usa el formulario del VSL)
const QUIZ_FACT = "KO4UpKfZCa61A1MN4qg8"; // "Quiz: facturación" (quiz orgánico; mismas opciones mensuales que el VSL)
const NICHO = "Zx82M03hxVfg98NtIvGD"; // "¿En qué nicho se encuentra tu negocio?" (formulario VSL)
// 23-11: ecommerce solo califica si factura $50k/mes o más (regla nueva, para agendas desde el 23-11).
const DESDE_ECOM = Date.parse("2026-11-23T08:00:00Z");
const PIPE = "kW8pBFCaVVZJ1pw9okvh", CLOSER_CF = "eDFc3YKm41aXOXf7UR8m";
const BUFFER = 15 * 60_000; // buffer posterior del calendario
const ACTIVA = (s: string) => !["cancelled", "invalid", "noshow"].includes(s);
const FIJO = "closer-fijo";
const RECIENTE = 30 * 60_000; // ventana para considerar una cita "recién agendada" (el cron corre cada minuto)

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ }
  return { status: r.status, json: j, text: t.slice(0, 300) };
}

const tipoDe = (ans: string | null) =>
  !ans ? null : /^\s*menos/i.test(ans) ? "no_califica" : /^\s*\$?\s*(5|10)k\s*a\s*\$?\s*20k/i.test(ans) ? "downsell" : "dfy";

async function datos(contactId: string): Promise<{ ingreso: string | null; nicho: string | null; fijo: boolean }> {
  const r = await api("GET", `/contacts/${contactId}`);
  const cf = r.json?.contact?.customFields ?? [];
  const val = (id: string) => { const v = cf.find((f: any) => f.id === id)?.value; return (Array.isArray(v) ? v[0] : v) || null; };
  const fijo = (r.json?.contact?.tags ?? []).some((t: string) => String(t).toLowerCase() === FIJO);
  return { ingreso: val(INGRESOS) ?? val(QUIZ_FACT), nicho: val(NICHO), fijo };
}
// Tipo de la cita: con la regla de ecommerce (menos de $50k = no califica) para citas creadas desde el 23-11.
// "fijo" = el contacto tiene closer fijado a mano (tag closer-fijo): no se toca.
async function tipoCita(ev: any) {
  const d = await datos(ev.contactId);
  if (d.fijo) return "fijo";
  const t = tipoDe(d.ingreso);
  const creada = Date.parse(ev.dateAdded ?? ev.createdAt ?? "") || Date.now();
  const ecomBajo = /^\s*e-?commerce/i.test(d.nicho ?? "") && /^\s*\$?\s*(5|10|20)\s*k/i.test(d.ingreso ?? "");
  return ecomBajo && creada >= DESDE_ECOM ? "no_califica" : t;
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

  if (body.fijar) {
    const { contact_id, user } = body.fijar;
    const uid = user === "Jenny" ? JENNY : user === "Luca" ? LUCA : null;
    if (!contact_id || !uid) return Response.json({ error: "fijar necesita contact_id y user Jenny|Luca" }, { status: 400 });
    const tag = await api("POST", `/contacts/${contact_id}/tags`, { tags: [FIJO] });
    const n = Date.now();
    const resps = await Promise.all(CALS.map((c) => api("GET", `/calendars/events?locationId=${LOC}&calendarId=${c}&startTime=${n - 3 * 3600_000}&endTime=${n + 30 * 86400_000}`)));
    const citas = resps.flatMap((r) => r.json?.events ?? []).filter((e: any) => e.contactId === contact_id && ACTIVA(e.appointmentStatus ?? ""));
    const tipo = tipoDe((await datos(contact_id)).ingreso);
    const hechas: any[] = [];
    for (const ev of citas) {
      const st = await reasignar(ev, uid); // siempre: aunque la cita ya esté bien, alinea la oportunidad (dueño + campo Closer)
      hechas.push({ appt_id: ev.id, inicio: ev.startTime, st });
      await log({ appt_id: ev.id, contact_id, inicio: ev.startTime, tipo, de_user: NAME[ev.assignedUserId] ?? ev.assignedUserId, a_user: NAME[uid], accion: "fijada", detalle: { st, manual: true, calendario: ev.calendarId } });
    }
    const res = { fijar: { contact_id, user, tag: tag.status, citas: hechas } };
    await sb.from("sync_runs").insert({ source: "asignar-closer", ok: tag.status < 300, finished_at: new Date().toISOString(), detail: res });
    return Response.json(res);
  }

  const now = Date.now(), to = now + 14 * 86400_000;
  const resps = await Promise.all(CALS.map((c) => api("GET", `/calendars/events?locationId=${LOC}&calendarId=${c}&startTime=${now}&endTime=${to}`)));
  const evs = resps.flatMap((r) => r.json?.events ?? []).filter((e: any) => ACTIVA(e.appointmentStatus ?? ""));
  const estado = Math.max(...resps.map((r) => r.status));
  const { data: hechas } = await sb.from("asignaciones_closer").select("appt_id");
  // toda cita ya evaluada (movida, intercambio, alerta, fijada) no se vuelve a tocar: la primera decisión es la definitiva
  const listo = new Set((hechas ?? []).map((h: any) => h.appt_id));
  const out: any[] = [];
  let lucaEvs: any[] = [], jennyEvs: any[] = [], leidos = false;

  for (const ev of evs) {
    if (ev.assignedUserId !== JENNY || listo.has(ev.id)) continue; // solo preocupan las DFY que cayeron en Jenny
    // 25-11: solo al agendar. Una cita vieja que hoy está en Jenny la puso alguien a mano -> se respeta.
    const creada = Date.parse(ev.dateAdded ?? ev.createdAt ?? "");
    if (!creada || now - creada > RECIENTE) continue;
    const tipo = await tipoCita(ev);
    if (tipo !== "dfy") continue;
    if (!leidos) {
      lucaEvs = await eventosDe(LUCA, now - 3 * 3600_000, to);
      jennyEvs = await eventosDe(JENNY, now - 3 * 3600_000, to);
      leidos = true;
    }
    const conflictos = lucaEvs.filter((x) => x.id !== ev.id && choca(x, ev));
    const base = { appt_id: ev.id, contact_id: ev.contactId, inicio: ev.startTime, tipo, de_user: "Jenny" };
    if (!conflictos.length) {
      const st = dry ? "dry" : await reasignar(ev, LUCA);
      out.push({ ...base, a_user: "Luca", accion: "movida", calendario: ev.calendarId, st });
      if (!dry) await log({ ...base, a_user: "Luca", accion: "movida", detalle: { st, calendario: ev.calendarId } });
      continue;
    }
    // ¿todos los choques de Luca son downsell y Jenny queda libre para tomarlos? -> intercambio
    const tipos = await Promise.all(conflictos.map((x) => tipoCita(x)));
    const jennyLibre = conflictos.every((x) => !jennyEvs.some((j) => j.id !== ev.id && j.id !== x.id && choca(j, x)));
    if (tipos.every((t) => t === "downsell") && jennyLibre) {
      const st = dry ? "dry" : [await reasignar(ev, LUCA), ...(await Promise.all(conflictos.map((x) => reasignar(x, JENNY))))];
      out.push({ ...base, a_user: "Luca", accion: "intercambio", calendario: ev.calendarId, con: conflictos.map((x) => x.id), st });
      if (!dry) {
        await log({ ...base, a_user: "Luca", accion: "intercambio", detalle: { st, calendario: ev.calendarId, downsell_a_jenny: conflictos.map((x) => x.id) } });
        for (const x of conflictos) await log({ appt_id: x.id, contact_id: x.contactId, inicio: x.startTime, tipo: "downsell", de_user: "Luca", a_user: "Jenny", accion: "intercambio", detalle: { por: ev.id } });
      }
      continue;
    }
    // Luca no puede: queda con Jenny para siempre (no se reintenta aunque Luca se libere)
    out.push({ ...base, a_user: null, accion: "alerta", calendario: ev.calendarId, motivo: "Luca ocupado con DFY a esa hora: queda con Jenny", con: conflictos.map((x) => x.id) });
    if (!dry) await log({ ...base, a_user: null, accion: "alerta", detalle: { motivo: "Luca ocupado con DFY: queda con Jenny (definitivo)", calendario: ev.calendarId, con: conflictos.map((x) => x.id) } });
  }
  const res = { dry, revisadas: evs.length, cambios: out, events_status: estado };
  if (dry || out.length || estado >= 300)
    await sb.from("sync_runs").insert({ source: "asignar-closer", ok: estado < 300, finished_at: new Date().toISOString(), detail: res });
  return Response.json(res);
});
