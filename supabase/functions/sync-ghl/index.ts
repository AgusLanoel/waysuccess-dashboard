// Sincroniza desde GHL: citas de los calendarios de llamadas, contactos (con su atribución) y
// oportunidades de los pipelines de agendas/closers. Body opcional: { days_back: 30, contacts: "missing"|"all" }.
// Protegida con x-sync-key.
// 21-10-2026: migrado a la cuenta GHL nueva (fssMX…, StartFly). Los datos de la cuenta vieja quedan en las tablas.
// 25-10-2026: la oportunidad trae sus campos personalizados (cf), dueño y fechas de cambio; el trigger arma el historial.
// 11-11-2026: depura del dashboard lo que GHL borró (oportunidades y contactos), con copia en ghl_purgados.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GHL = Deno.env.get("GHL_PIT_TOKEN")!;
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const H = { Authorization: `Bearer ${GHL}`, Version: "2021-07-28", Accept: "application/json" };
const API = "https://services.leadconnectorhq.com";
const CALENDARS = ["7SNm0NGnthgEIWCbOf05", "Q5crAi9OAPOqzrg4cTgU"]; // Llamada de Asesoramiento | WS + Asesoría Orgánico Quiz | WS (ahí se reagendó hasta el 10-11)
const PIPELINES = ["kW8pBFCaVVZJ1pw9okvh", "eiE5LJcujd9GS7XFqlYl"]; // 2. Leads (Agendado) - Venta, WaySuccess — Comercial Closers

// 404, o 400 con "not found": GHL ya no lo tiene
const gone = (e: unknown) => { const s = String(e); return s.includes("GHL 404") || (s.includes("GHL 400") && /not.?found|does not exist|no.*exist/i.test(s)); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(path: string, tries = 4): Promise<any> {
  const r = await fetch(path.startsWith("http") ? path : API + path, { headers: H });
  if (r.status === 429 && tries > 0) { await sleep(2000); return get(path, tries - 1); }
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`GHL ${r.status} ${path.slice(0, 80)}: ${b?.message ?? ""}`);
  return b;
}

export const normEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : null);
export const normPhone = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
};

function parseAttr(a: any) {
  const url: string | null = a?.url ?? a?.pageUrl ?? null;
  let q = new URLSearchParams();
  try { if (url) q = new URL(url).searchParams; } catch { /* url inválida */ }
  const isId = (v?: string | null) => !!v && /^\d{12,}$/.test(v);
  const content = q.get("utm_content") ?? a?.utmContent ?? null;
  const term = q.get("utm_term") ?? a?.utmTerm ?? null;
  const adId = q.get("ad_id") ?? (isId(content) ? content : null);
  return {
    url,
    ad_id: isId(adId) ? adId : null,
    adset_id: isId(q.get("adset_id")) ? q.get("adset_id") : isId(term) ? term : null,
    campaign_id: isId(q.get("campaign_id")) ? q.get("campaign_id") : isId(q.get("utm_id")) ? q.get("utm_id") : null,
    utm_content: content,
    utm_campaign: q.get("utm_campaign") ?? a?.campaign ?? null,
  };
}

function contactRow(c: any) {
  const f = parseAttr(c.attributionSource);
  const l = parseAttr(c.lastAttributionSource ?? c.attributionSource);
  const strip = (a: any) => { if (!a) return null; const { ip, userAgent, ...rest } = a; return rest; };
  return {
    id: c.id,
    date_added: c.dateAdded ?? null,
    email_norm: normEmail(c.email),
    phone_norm: normPhone(c.phone),
    // 01-11-2026: para la lista de agendas calificadas del día ('' = GHL no lo tiene, no se vuelve a pedir)
    full_name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.contactName || c.name || "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    timezone: c.timezone ?? "",
    source: c.source ?? null,
    tags: c.tags ?? [],
    custom_fields: Object.fromEntries((c.customFields ?? []).map((x: any) => [x.id, x.value])),
    first_attr: strip(c.attributionSource),
    last_attr: strip(c.lastAttributionSource),
    first_url: f.url, first_ad_id: f.ad_id, first_adset_id: f.adset_id, first_campaign_id: f.campaign_id, first_utm_content: f.utm_content, first_utm_campaign: f.utm_campaign,
    last_url: l.url, last_ad_id: l.ad_id, last_adset_id: l.adset_id, last_campaign_id: l.campaign_id, last_utm_content: l.utm_content, last_utm_campaign: l.utm_campaign,
    synced_at: new Date().toISOString(),
  };
}

async function upsert(table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  const daysBack = Number(body.days_back ?? 30);
  const { data: run } = await sb.from("sync_runs").insert({ source: "ghl", detail: body }).select("id").single();
  const t0 = Date.now();
  try {
    // 1) Citas (ventanas de 30 días)
    const appts: any[] = [];
    const end = Date.now() + 60 * 864e5;
    for (const cal of CALENDARS) {
      for (let s = Date.now() - daysBack * 864e5; s < end; s += 30 * 864e5) {
        const e = Math.min(s + 30 * 864e5, end);
        const b = await get(`/calendars/events?locationId=${LOC}&calendarId=${cal}&startTime=${s}&endTime=${e}`);
        appts.push(...(b.events ?? []));
      }
    }
    const apptRows = [...new Map(appts.map((a) => [a.id, a])).values()].map((a) => ({
      id: a.id,
      contact_id: a.contactId,
      calendar_id: a.calendarId,
      status: a.appointmentStatus ?? a.appoinmentStatus,
      start_time: a.startTime,
      date_added: a.dateAdded,
      assigned_user_id: a.assignedUserId,
      deleted: !!a.deleted,
      synced_at: new Date().toISOString(),
    }));
    await upsert("ghl_appointments", apptRows);

    // 10-11-2026: citas guardadas que ya no salen en el listado (canceladas o movidas): se consultan una por una para no dejarlas viejas
    const vistos = new Set(apptRows.map((a) => a.id));
    const { data: guardadas } = await sb.from("ghl_appointments").select("id")
      .in("calendar_id", CALENDARS).eq("deleted", false).not("status", "in", "(cancelled,invalid)")
      .gte("start_time", new Date(Date.now() - daysBack * 864e5).toISOString()).lte("start_time", new Date(end).toISOString());
    const faltan = (guardadas ?? []).map((r: any) => r.id).filter((id: string) => !vistos.has(id)).slice(0, 40);
    for (const id of faltan) {
      try {
        const b = await get(`/calendars/events/appointments/${id}`);
        const a = b.appointment ?? b.event ?? b;
        if (!a?.id) continue;
        const st = a.appointmentStatus ?? a.appoinmentStatus;
        await sb.from("ghl_appointments").update({
          calendar_id: a.calendarId, start_time: a.startTime, assigned_user_id: a.assignedUserId, deleted: !!a.deleted,
          ...(st ? { status: st } : {}), synced_at: new Date().toISOString(),
        }).eq("id", id);
      } catch (e) {
        if (String(e).includes("GHL 404")) await sb.from("ghl_appointments").update({ deleted: true, synced_at: new Date().toISOString() }).eq("id", id);
      }
      await sleep(150);
    }

    // 2) Oportunidades de los pipelines de agendas y closers
    const pipes = await get(`/opportunities/pipelines?locationId=${LOC}`);
    const stageName = new Map<string, string>();
    for (const p of pipes.pipelines ?? []) for (const s of p.stages ?? []) stageName.set(s.id, s.name);
    const opps: any[] = [];
    for (const pipeline of PIPELINES) {
      let url: string | null = `/opportunities/search?location_id=${LOC}&pipeline_id=${pipeline}&limit=100`;
      let guard = 0;
      while (url && guard++ < 200) {
        const b = await get(url);
        opps.push(...(b.opportunities ?? []));
        const m = b.meta ?? {};
        url = (b.opportunities?.length ?? 0) === 100 && m.startAfterId
          ? `/opportunities/search?location_id=${LOC}&pipeline_id=${pipeline}&limit=100&startAfter=${m.startAfter}&startAfterId=${m.startAfterId}`
          : null;
      }
    }
    // Campos personalizados por id; las fechas llegan en ms y se guardan como YYYY-MM-DD
    const cfValue = (f: any) =>
      f.fieldValueDate != null ? new Date(f.fieldValueDate).toISOString().slice(0, 10)
      : f.fieldValueNumber ?? f.fieldValueString ?? f.fieldValueArray ?? f.fieldValue ?? f.value ?? null;
    const oppRows = opps.map((o) => ({
      id: o.id,
      name: o.name ?? null,
      assigned_to: o.assignedTo ?? null,
      cf: Object.fromEntries((o.customFields ?? []).map((f: any) => [f.id, cfValue(f)])),
      lost_reason_id: o.lostReasonId ?? null,
      last_stage_change_at: o.lastStageChangeAt ?? null,
      last_status_change_at: o.lastStatusChangeAt ?? null,
      contact_id: o.contactId ?? o.contact?.id,
      pipeline_id: o.pipelineId,
      stage_id: o.pipelineStageId,
      stage_name: stageName.get(o.pipelineStageId) ?? null,
      status: o.status,
      monetary_value: o.monetaryValue ?? null,
      source: o.source ?? null,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
      synced_at: new Date().toISOString(),
    }));
    await upsert("ghl_opportunities", oppRows);

    // 11-11-2026 dueño: lo que GHL depura (borra) también se depura en el dashboard.
    // Oportunidades guardadas de estos pipelines que el listado ya no trae: se confirman una por una.
    // 404 → se borra la fila (copia en ghl_purgados) y se revisa su contacto; si existe en otro pipeline, se actualiza.
    let purgadas = 0, contactosPurgados = 0;
    const vistasOpp = new Set(oppRows.map((o) => o.id));
    const { data: oppGuardadas } = await sb.from("ghl_opportunities").select("*").in("pipeline_id", PIPELINES).range(0, 19999);
    const oppFaltan = (oppGuardadas ?? []).filter((o: any) => !vistasOpp.has(o.id));
    // Freno: si "faltan" demasiadas, el listado vino incompleto; no se borra nada.
    const listadoSano = oppRows.length > 0 && oppFaltan.length <= Math.max(25, 0.1 * (oppGuardadas ?? []).length);
    const contactosARevisar = new Set<string>();
    if (listadoSano) {
      for (const o of oppFaltan.slice(0, 40)) {
        try {
          const b = await get(`/opportunities/${o.id}`);
          const x = b.opportunity ?? b;
          if (x?.id && x.pipelineId) {
            await sb.from("ghl_opportunities").update({ pipeline_id: x.pipelineId, stage_id: x.pipelineStageId, stage_name: stageName.get(x.pipelineStageId) ?? null, status: x.status, synced_at: new Date().toISOString() }).eq("id", o.id);
          }
        } catch (e) {
          if (gone(e)) {
            await sb.from("ghl_purgados").insert({ tipo: "oportunidad", ghl_id: o.id, nombre: o.name, fila: o });
            await sb.from("ghl_opportunities").delete().eq("id", o.id);
            purgadas++;
            if (o.contact_id) contactosARevisar.add(o.contact_id);
          }
        }
        await sleep(150);
      }
    }
    // Contactos de citas marcadas como borradas en esta corrida y de oportunidades purgadas
    for (const id of faltan) {
      const { data: a } = await sb.from("ghl_appointments").select("contact_id, deleted").eq("id", id).maybeSingle();
      if (a?.deleted && a.contact_id) contactosARevisar.add(a.contact_id);
    }
    for (const cid of [...contactosARevisar].slice(0, 40)) {
      try { await get(`/contacts/${cid}`); } catch (e) {
        if (gone(e)) {
          const { data: c } = await sb.from("ghl_contacts").select("*").eq("id", cid).maybeSingle();
          if (c) {
            await sb.from("ghl_purgados").insert({ tipo: "contacto", ghl_id: cid, nombre: c.full_name, fila: c });
            await sb.from("ghl_contacts").delete().eq("id", cid);
            contactosPurgados++;
          }
          await sb.from("ghl_appointments").update({ deleted: true, synced_at: new Date().toISOString() }).eq("contact_id", cid);
          const { data: os } = await sb.from("ghl_opportunities").select("*").eq("contact_id", cid);
          for (const o of os ?? []) {
            await sb.from("ghl_purgados").insert({ tipo: "oportunidad", ghl_id: o.id, nombre: o.name, fila: o });
            await sb.from("ghl_opportunities").delete().eq("id", o.id);
            purgadas++;
          }
        }
      }
      await sleep(150);
    }

    // 3) Contactos: los de las citas y oportunidades que falten (o todos si contacts="all")
    const ids = new Set<string>([...apptRows.map((a) => a.contact_id), ...oppRows.map((o) => o.contact_id)].filter(Boolean));
    let toFetch = [...ids];
    if (body.contacts !== "all") {
      const have = new Set<string>();
      for (let i = 0; i < toFetch.length; i += 300) {
        const { data } = await sb.from("ghl_contacts").select("id").not("full_name", "is", null).in("id", toFetch.slice(i, i + 300));
        for (const r of data ?? []) have.add(r.id);
      }
      // Siempre refresca los contactos de citas creadas en los últimos 3 días
      const recent = new Set(apptRows.filter((a) => Date.now() - Date.parse(a.date_added) < 3 * 864e5).map((a) => a.contact_id));
      toFetch = toFetch.filter((id) => !have.has(id) || recent.has(id));
    }
    const contactRows: any[] = [];
    const budgetMs = 120_000;
    let pending = 0;
    for (let i = 0; i < toFetch.length; i += 8) {
      if (Date.now() - t0 > budgetMs) { pending = toFetch.length - i; break; }
      const batch = await Promise.all(toFetch.slice(i, i + 8).map((id) => get(`/contacts/${id}`).then((b) => b.contact).catch(() => null)));
      for (const c of batch) if (c) contactRows.push(contactRow(c));
      await sleep(400);
    }
    await upsert("ghl_contacts", contactRows);
    await sb.rpc("link_sheet_calls");

    const detail = { days_back: daysBack, appointments: apptRows.length, rechecked: faltan.length, opportunities: oppRows.length, opp_faltan: oppFaltan.length, listado_sano: listadoSano, purgadas, contactos_purgados: contactosPurgados, contacts_fetched: contactRows.length, contacts_pending: pending, ms: Date.now() - t0 };
    await sb.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: true, detail }).eq("id", run!.id);
    return Response.json(detail);
  } catch (e) {
    await sb.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: false, detail: { error: String(e) } }).eq("id", run!.id);
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
