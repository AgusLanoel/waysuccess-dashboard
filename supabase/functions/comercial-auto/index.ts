// Automatización comercial (11-11-2026, pedido del dueño: "lo más automático posible").
//
// 1) Webhook de Fathom (sin x-sync-key; se verifica la firma con el secreto de cada closer en fathom_webhooks):
//    al terminar una llamada llega la transcripción → se busca el lead en GHL → Claude extrae asistencia, oferta,
//    resultado, motivo y CUÁNDO quedaron en volver a hablar → se escribe en la oportunidad (sin pisar lo que el
//    closer ya cargó) y queda todo en fathom_calls (pestaña "Centro comercial").
// 2) {"action":"revisar"} (cron cada 5 min, x-sync-key): llamadas terminadas hace 10+ min en las que quedaron en una
//    próxima llamada y no hay cita futura en GHL → alerta a Laura (y al closer) para que la agende.
//    También manda por Telegram las alertas pendientes (reagendas detectadas por trigger en ghl_appointments).
// 3) {"action":"seguimientos"} (cron 9 h ART, x-sync-key): a cada closer, sus llamadas y seguimientos del día.
// 4) {"action":"registrar","persona":"Luca","api_key":"…"} con la sesión del dashboard (owner, o el propio closer):
//    crea el webhook en la cuenta de Fathom de esa persona y guarda solo el secreto. La clave de API no se guarda.
//
// Secretos: ANTHROPIC_API_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID, TELEGRAM_BOT_TOKEN.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GHL = Deno.env.get("GHL_PIT_TOKEN")!;
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN");
const API = "https://services.leadconnectorhq.com";
const GH = { Authorization: `Bearer ${GHL}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const PIPELINE = "kW8pBFCaVVZJ1pw9okvh"; // 2. Leads (Agendado) - Venta
const TZ = "America/Argentina/Buenos_Aires";
const DOMINIO_PROPIO = /@alessandrows\.com$|@waysuccess\./i;

// Campos de la oportunidad en GHL
const F = {
  asistio: "Vp3rYUo47OzLrgxol7yP",
  oferta: "H3JJfIUflRDFxE0vnllM",
  grabacion: "2lrp6WvUZk1HcWPVLLCa",
  resumen: "nhcb5PnmbX0XNpav3ZvE",
  proxSeguimiento: "cZQznvJEZOmObwid7Lgs",
  razonSeguimiento: "I1YDC7yUCv8z7eTWJQIl",
  proxLlamadaFathom: "6Wag8vuv9DP5PXnhPMxY",
};
const RAZONES = ["Capacidad de pago", "Socio / pareja", "Contrato", "Está viendo otras opciones", "Confianza en la empresa", "Logístico",
  "Tiene que pensarlo", "Quiere hacerlo después", "No toma decisiones en caliente", "Confianza en Ale", "Confianza en el vehículo",
  "Capacidad de él mismo", "Caro", "Confianza en el closer", "Malas experiencias", "Miedo al éxito", "Ghosteó", "Lo quiere hacer por su cuenta"];
// Solo se mueve la etapa si la oportunidad sigue en una etapa previa a la llamada, y solo hacia seguimiento.
// Nunca a ganada, perdida, Reserva ni Cerrado: eso lo decide el closer.
const ETAPAS_PREVIAS = new Set(["Triaje", "Agenda", "Agenda Contactada", "Llamada Confirmada", "Reagenda"]);
const ETAPAS_DESTINO: Record<string, string> = {
  "P1 - No tiene interés en este momento": "08400d43-c052-4aa0-95d1-0d701c97face",
  "P3 - Interés pero no puede ahora": "00c394aa-2278-431d-a964-9883ddd52b6a",
  "P5 - Compra este mes": "79e3ee86-9c96-4452-abd6-a5cabf4bd0fc",
  "2da Llamada Agenda": "719f67a7-5055-4e75-a74e-f5d66702907b",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ghl(method: string, path: string, body?: unknown) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(API + path, { method, headers: GH, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await sleep(2000); continue; }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`GHL ${r.status} ${path}: ${j?.message ?? ""}`);
    return j;
  }
  throw new Error(`GHL 429 ${path}`);
}
const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "sin fecha";

// ---------- Telegram ----------
async function chatDe(nombre: string): Promise<number | null> {
  const { data } = await sb.from("control_bot_miembros").select("chat_id, nombre").eq("activo", true);
  const m = (data ?? []).find((x: any) => x.nombre.toLowerCase().startsWith(nombre.toLowerCase()));
  return m?.chat_id ?? null;
}
async function telegram(chat: number, text: string) {
  if (!TG) throw new Error("falta TELEGRAM_BOT_TOKEN");
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(`Telegram ${r.status} ${j?.description ?? ""}`);
}

// ---------- Firma de Fathom (estándar Svix: HMAC-SHA256 de "id.timestamp.body") ----------
async function firmaValida(secret: string, id: string, ts: string, body: string, header: string) {
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const esperado = btoa(String.fromCharCode(...sig));
  return header.split(" ").map((s) => s.split(",")[1] ?? s).some((s) => s.length === esperado.length && timingSafe(s, esperado));
}
function timingSafe(a: string, b: string) { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// ---------- Extracción con Claude ----------
const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["asistio", "oferta_hecha", "resultado", "etapa_sugerida", "motivo", "proxima_llamada_acordada", "proximo_seguimiento", "cita_textual", "resumen", "resumen_corto"],
  properties: {
    asistio: { type: "boolean", description: "El lead estuvo y habló en la llamada" },
    oferta_hecha: { type: "boolean", description: "El closer presentó la oferta con precio" },
    resultado: { type: "string", enum: ["Compró", "Reservó", "Seguimiento", "No le interesa", "No califica", "No se presentó", "Otro"] },
    etapa_sugerida: { type: "string", enum: [...Object.keys(ETAPAS_DESTINO), "Ninguna"], description: "Etapa de seguimiento que corresponde si no compró ni reservó; 'Ninguna' si no aplica" },
    motivo: { type: "string", enum: [...RAZONES, "Ninguno"], description: "Principal razón por la que no cerró hoy" },
    proxima_llamada_acordada: { type: "boolean", description: "Quedaron explícitamente en volver a hablar (otra llamada o contacto) en un momento concreto o aproximado" },
    proximo_seguimiento: { type: "string", description: "Fecha y hora acordada en ISO 8601 con offset (ej. 2026-11-13T16:00:00-03:00). Vacío si no hay fecha. Si solo hay día, usar 10:00 hora Argentina" },
    cita_textual: { type: "string", description: "La frase de la transcripción donde acuerdan la próxima llamada; vacío si no hay" },
    resumen: { type: "string", description: "Resumen para el CRM en 4 a 8 líneas: negocio y facturación, dolor, objeciones, qué se ofreció, próximos pasos" },
    resumen_corto: { type: "string", description: "Una línea" },
  },
};

async function extraer(m: any, leadNombre: string, leadTz: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("falta ANTHROPIC_API_KEY en los secretos de Supabase");
  const client = new Anthropic({ apiKey: key });
  const lineas = (m.transcript ?? []).map((t: any) => `[${t.timestamp}] ${t.speaker?.display_name ?? "?"}: ${t.text}`).join("\n");
  if (!lineas) throw new Error("la llamada llegó sin transcripción");
  const contexto = [
    `Llamada de venta de WaySuccess (servicio de marketing y contenido para coaches, consultores y negocios).`,
    `Closer: ${m.recorded_by?.name ?? "?"}. Lead: ${leadNombre || "desconocido"}.`,
    `La llamada empezó ${m.recording_start_time} (UTC). En hora Argentina: ${fmt(m.recording_start_time)}.`,
    `Zona horaria del lead según el CRM: ${leadTz || "desconocida"}. Si dicen una hora sin aclarar la zona, asumí la del lead si se conoce; si no, la de Argentina.`,
    `Resolvé fechas relativas ("el jueves", "mañana", "la semana que viene") contra la fecha de la llamada.`,
    m.default_summary?.markdown_formatted ? `Resumen de Fathom:\n${m.default_summary.markdown_formatted}` : "",
  ].filter(Boolean).join("\n");
  const r: any = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
    system: "Extraés datos de llamadas de venta para cargarlos en el CRM. Respondé solo con lo que dice la transcripción; si algo no aparece, usá el valor vacío o 'Ninguno'. Escribí en español rioplatense neutro.",
    messages: [{ role: "user", content: `${contexto}\n\nTranscripción:\n${lineas}` }],
  } as any);
  if (r.stop_reason === "refusal") throw new Error("Claude no procesó la transcripción (refusal)");
  const txt = (r.content ?? []).find((b: any) => b.type === "text")?.text;
  if (!txt) throw new Error(`respuesta vacía (${r.stop_reason})`);
  return JSON.parse(txt);
}

// ---------- Lead y oportunidad ----------
async function buscarLead(m: any, persona: string | null) {
  const emails = (m.calendar_invitees ?? []).filter((i: any) => i.is_external && i.email && !DOMINIO_PROPIO.test(i.email)).map((i: any) => i.email.trim().toLowerCase());
  for (const e of emails) {
    const { data } = await sb.from("ghl_contacts").select("id, full_name, timezone").eq("email_norm", e).order("date_added", { ascending: false }).limit(1);
    if (data?.[0]) return data[0];
    try {
      const j = await ghl("GET", `/contacts/?locationId=${LOC}&query=${encodeURIComponent(e)}&limit=1`);
      const c = j?.contacts?.[0];
      if (c?.id) return { id: c.id, full_name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || e, timezone: c.timezone ?? "" };
    } catch { /* sigue con el siguiente */ }
  }
  // Sin email: la cita del closer más cercana a la hora de la llamada (±45 min)
  const t = Date.parse(m.scheduled_start_time ?? m.recording_start_time);
  if (persona && t) {
    const { data: tm } = await sb.from("comercial_team").select("ghl_user_id").eq("name", persona).maybeSingle();
    let q = sb.from("ghl_appointments").select("contact_id, start_time").eq("deleted", false)
      .gte("start_time", new Date(t - 45 * 60e3).toISOString()).lte("start_time", new Date(t + 45 * 60e3).toISOString());
    if (tm?.ghl_user_id) q = q.eq("assigned_user_id", tm.ghl_user_id);
    const { data: ap } = await q;
    const mejor = (ap ?? []).sort((a: any, b: any) => Math.abs(Date.parse(a.start_time) - t) - Math.abs(Date.parse(b.start_time) - t))[0];
    if (mejor?.contact_id) {
      const { data: c } = await sb.from("ghl_contacts").select("id, full_name, timezone").eq("id", mejor.contact_id).maybeSingle();
      return c ?? { id: mejor.contact_id, full_name: "", timezone: "" };
    }
  }
  return null;
}

async function oportunidad(contactId: string) {
  const j = await ghl("GET", `/opportunities/search?location_id=${LOC}&pipeline_id=${PIPELINE}&contact_id=${contactId}&limit=20`);
  const os = (j?.opportunities ?? []) as any[];
  return os.sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}

// Escribe sin pisar lo que el closer ya cargó. Devuelve lo que cambió.
async function escribirEnGhl(opp: any, ia: any, m: any, stageNames: Map<string, string>) {
  const actual: Record<string, any> = {};
  for (const f of opp.customFields ?? []) actual[f.id] = f.fieldValueString ?? f.fieldValueDate ?? f.fieldValue ?? f.value ?? null;
  const vacio = (id: string) => actual[id] == null || actual[id] === "";
  const cf: { id: string; field_value: any }[] = [];
  const cambios: Record<string, unknown> = {};
  const set = (id: string, v: any, nombre: string) => { cf.push({ id, field_value: v }); cambios[nombre] = v; };

  if (ia.asistio && vacio(F.asistio)) set(F.asistio, "Si", "¿Asistió?");
  if (ia.asistio && vacio(F.oferta)) set(F.oferta, ia.oferta_hecha ? "Si" : "No", "¿Se realizó la oferta?");
  if (m.share_url && vacio(F.grabacion)) set(F.grabacion, m.share_url, "Link grabación");
  if (ia.motivo && ia.motivo !== "Ninguno" && vacio(F.razonSeguimiento) && RAZONES.includes(ia.motivo)) set(F.razonSeguimiento, ia.motivo, "Razón de seguimiento");
  const encabezado = `— ${fmt(m.recording_start_time)} · Fathom —`;
  const previo = String(actual[F.resumen] ?? "");
  if (!previo.includes(encabezado)) set(F.resumen, [previo, `${encabezado}\n${ia.resumen}`].filter(Boolean).join("\n\n").slice(0, 9000), "Resumen de la llamada");
  if (ia.proxima_llamada_acordada) {
    const cuando = ia.proximo_seguimiento ? fmt(ia.proximo_seguimiento) + " (hora Argentina)" : "sin fecha concreta";
    set(F.proxLlamadaFathom, `${cuando}${ia.cita_textual ? ` — "${ia.cita_textual.slice(0, 200)}"` : ""}`, "Próxima llamada acordada (Fathom)");
    if (ia.proximo_seguimiento) {
      const dia = new Date(ia.proximo_seguimiento).toLocaleDateString("en-CA", { timeZone: TZ });
      const previa = actual[F.proxSeguimiento] ? new Date(actual[F.proxSeguimiento]).toISOString().slice(0, 10) : null;
      const hoy = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
      if (!previa || previa < hoy) set(F.proxSeguimiento, dia, "Fecha próximo seguimiento");
    }
  }
  const body: Record<string, unknown> = {};
  if (cf.length) body.customFields = cf;
  const etapaActual = stageNames.get(opp.pipelineStageId) ?? "";
  const destino = ETAPAS_DESTINO[ia.etapa_sugerida];
  if (opp.status === "open" && destino && ETAPAS_PREVIAS.has(etapaActual) && ia.asistio && ["Seguimiento", "No le interesa"].includes(ia.resultado)) {
    body.pipelineStageId = destino;
    cambios["Etapa"] = `${etapaActual} → ${ia.etapa_sugerida}`;
  }
  if (Object.keys(body).length) await ghl("PUT", `/opportunities/${opp.id}`, body);
  return cambios;
}

// ---------- 1) Webhook ----------
async function webhook(req: Request) {
  const body = await req.text();
  const id = req.headers.get("webhook-id") ?? "", ts = req.headers.get("webhook-timestamp") ?? "", sig = req.headers.get("webhook-signature") ?? "";
  if (!id || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return new Response("firma inválida", { status: 401 });
  const { data: hooks } = await sb.from("fathom_webhooks").select("persona, secret");
  let persona: string | null = null;
  for (const h of hooks ?? []) if (await firmaValida(h.secret, id, ts, body, sig)) { persona = h.persona; break; }
  if (!persona) return new Response("firma inválida", { status: 401 });

  const m = JSON.parse(body);
  const callId = String(m.recording_id ?? m.url);
  const { data: previa } = await sb.from("fathom_calls").select("estado").eq("id", callId).maybeSingle();
  if (previa?.estado === "ghl_ok") return Response.json({ ok: true, repetida: true });
  const base = {
    id: callId, persona, titulo: m.meeting_title ?? m.title, share_url: m.share_url ?? m.url,
    inicio: m.recording_start_time, fin: m.recording_end_time, invitados: m.calendar_invitees ?? [],
    transcript: m.transcript ?? null, resumen: m.default_summary?.markdown_formatted ?? null,
  };
  await sb.from("fathom_calls").upsert({ ...base, estado: "recibida", error: null });

  // Se responde enseguida y el resto sigue en segundo plano (Fathom no espera minutos).
  const trabajo = (async () => {
    try {
      const lead = await buscarLead(m, persona);
      const leadNombre = lead?.full_name || (m.calendar_invitees ?? []).find((i: any) => i.is_external)?.name || "";
      const ia = await extraer(m, leadNombre, lead?.timezone ?? "");
      const fila: Record<string, unknown> = {
        contact_id: lead?.id ?? null, lead_nombre: leadNombre || null, ia,
        proxima_llamada_acordada: !!ia.proxima_llamada_acordada,
        proximo_seguimiento: ia.proximo_seguimiento ? new Date(ia.proximo_seguimiento).toISOString() : null,
      };
      if (!lead) { await sb.from("fathom_calls").update({ ...fila, estado: "sin_lead", error: "No se encontró el lead en GHL (email del invitado ni cita a esa hora)" }).eq("id", callId); return; }
      const opp = await oportunidad(lead.id);
      if (!opp) { await sb.from("fathom_calls").update({ ...fila, estado: "procesada", error: "El lead no tiene oportunidad en el pipeline de venta" }).eq("id", callId); return; }
      const pipes = await ghl("GET", `/opportunities/pipelines?locationId=${LOC}`);
      const stageNames = new Map<string, string>();
      for (const p of pipes.pipelines ?? []) for (const s of p.stages ?? []) stageNames.set(s.id, s.name);
      const cambios = await escribirEnGhl(opp, ia, m, stageNames);
      await sb.from("fathom_calls").update({ ...fila, opp_id: opp.id, ghl_escrito: cambios, estado: "ghl_ok", error: null }).eq("id", callId);
    } catch (e) {
      await sb.from("fathom_calls").update({ estado: "error", error: String(e).slice(0, 500) }).eq("id", callId);
    }
  })();
  // @ts-ignore EdgeRuntime existe en Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(trabajo); else await trabajo;
  return Response.json({ ok: true });
}

// ---------- 2) Revisar: próxima llamada sin agendar + envío de alertas ----------
async function revisar() {
  const hace10 = new Date(Date.now() - 10 * 60e3).toISOString();
  const { data: calls } = await sb.from("fathom_calls").select("*")
    .eq("proxima_llamada_acordada", true).is("revisada_cita_at", null).lte("fin", hace10)
    .gte("fin", new Date(Date.now() - 3 * 864e5).toISOString()).in("estado", ["ghl_ok", "procesada", "sin_lead"]);
  let creadas = 0;
  for (const c of calls ?? []) {
    let agendada = false;
    if (c.contact_id) {
      try {
        const j = await ghl("GET", `/contacts/${c.contact_id}/appointments`);
        agendada = (j?.events ?? []).some((e: any) => Date.parse(e.startTime) > Date.parse(c.fin) && !["cancelled", "invalid"].includes(e.appointmentStatus ?? e.appoinmentStatus));
      } catch { agendada = false; }
    }
    if (!agendada) {
      const cuando = c.proximo_seguimiento ? fmt(c.proximo_seguimiento) : "sin fecha concreta";
      const { error } = await sb.from("com_alertas").insert({
        tipo: "proxima_llamada_sin_agendar", persona: c.persona, para: "Laura", contact_id: c.contact_id, opp_id: c.opp_id,
        lead_nombre: c.lead_nombre, fathom_call_id: c.id,
        mensaje: `En la llamada con ${c.lead_nombre ?? "el lead"} (${c.persona}) quedaron en volver a hablar: ${cuando}${c.ia?.cita_textual ? ` — "${String(c.ia.cita_textual).slice(0, 160)}"` : ""}. No hay cita en el calendario.`,
      });
      if (!error) creadas++;
    }
    await sb.from("fathom_calls").update({ revisada_cita_at: new Date().toISOString() }).eq("id", c.id);
  }

  // Alertas sin enviar (de este chequeo y las reagendas que detecta el trigger)
  const { data: pend } = await sb.from("com_alertas").select("*").is("enviada_at", null).is("resuelta_at", null)
    .gte("creada_at", new Date(Date.now() - 2 * 864e5).toISOString()).order("creada_at").limit(30);
  let enviadas = 0;
  const ghlLink = (cid: string | null) => (cid ? `\nhttps://app.gohighlevel.com/v2/location/${LOC}/contacts/detail/${cid}` : "");
  for (const a of pend ?? []) {
    const destinos = a.tipo === "proxima_llamada_sin_agendar" ? [a.para ?? "Laura", a.persona] : [a.persona];
    let ok = false;
    for (const d of [...new Set(destinos.filter(Boolean))] as string[]) {
      const chat = await chatDe(d);
      if (!chat) continue;
      const titulo = a.tipo === "proxima_llamada_sin_agendar"
        ? (d === (a.para ?? "Laura") ? "⚠️ Falta agendar la próxima llamada — agendala o recordáselo al closer" : "⚠️ Te falta agendar la próxima llamada")
        : a.tipo === "reagenda" ? "🔁 Se reagendó una llamada" : "Aviso";
      try { await telegram(chat, `${titulo}\n\n${a.mensaje}${ghlLink(a.contact_id)}`); ok = true; } catch { /* reintenta en la próxima corrida */ }
    }
    if (ok) { await sb.from("com_alertas").update({ enviada_at: new Date().toISOString() }).eq("id", a.id); enviadas++; }
  }
  return { revisadas: calls?.length ?? 0, alertas_creadas: creadas, alertas_enviadas: enviadas };
}

// ---------- 3) Seguimientos del día a cada closer ----------
async function seguimientos() {
  const { data: team } = await sb.from("comercial_team").select("name").eq("active", true).eq("role", "closer");
  const out: Record<string, string> = {};
  for (const t of team ?? []) {
    const chat = await chatDe(t.name);
    if (!chat) { out[t.name] = "sin Telegram"; continue; }
    const { data: d } = await sb.rpc("mi_dia", { p_closer: t.name });
    const hoy = d?.hoy;
    const llamadas = (d?.llamadas ?? []).filter((l: any) => l.dia === hoy);
    const segs = (d?.seguimientos ?? []).filter((s: any) => !s.historico && (!s.proximo_seguimiento || s.proximo_seguimiento <= hoy));
    if (!llamadas.length && !segs.length) { out[t.name] = "nada hoy"; continue; }
    const lineas = [`Buen día ${t.name} 👋 Esto tenés hoy:`];
    if (llamadas.length) lineas.push("", `📞 Llamadas (${llamadas.length}):`, ...llamadas.map((l: any) => `• ${String(l.hora).slice(6)} — ${l.nombre ?? "—"}`));
    if (segs.length) lineas.push("", `🔔 Seguimientos para hoy o vencidos (${segs.length}):`, ...segs.slice(0, 25).map((s: any) => `• ${s.nombre ?? "—"} · ${s.etapa}${s.proximo_seguimiento ? ` · ${s.proximo_seguimiento}` : " · sin fecha"}`));
    if (segs.length > 25) lineas.push(`…y ${segs.length - 25} más en el dashboard.`);
    lineas.push("", "Al contactarlo, actualizá la etapa y la fecha de próximo seguimiento en GHL.");
    try { await telegram(chat, lineas.join("\n")); out[t.name] = `${llamadas.length} llamadas, ${segs.length} seguimientos`; } catch (e) { out[t.name] = String(e); }
  }
  return out;
}

// ---------- 4) Registrar el webhook de Fathom de una persona ----------
async function registrar(req: Request, b: any) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const { data: u } = await sb.auth.getUser(jwt);
  if (!u?.user) return new Response("sin sesión", { status: 401 });
  const { data: mem } = await sb.from("dashboard_members").select("role, closer_name, display_name").eq("user_id", u.user.id).maybeSingle();
  const persona = String(b.persona ?? "").trim();
  if (!mem || !persona || !(mem.role === "owner" || mem.closer_name === persona)) return new Response("sin permiso", { status: 403 });
  const key = String(b.api_key ?? "").trim();
  if (key.length < 10) return Response.json({ error: "Clave de API vacía" }, { status: 400 });
  const r = await fetch("https://api.fathom.ai/external/v1/webhooks", {
    method: "POST", headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      destination_url: `${URL_SB}/functions/v1/comercial-auto`,
      triggered_for: ["my_recordings"],
      include_transcript: true, include_summary: true, include_action_items: true, include_crm_matches: false,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.secret) return Response.json({ error: `Fathom respondió ${r.status}: ${j?.message ?? j?.error ?? "sin detalle"}` }, { status: 400 });
  await sb.from("fathom_webhooks").upsert({ id: j.id, persona, email: null, secret: j.secret });
  return Response.json({ ok: true, persona, webhook: j.id });
}

Deno.serve(async (req) => {
  // Fathom firma sus envíos: si trae esos headers, es el webhook.
  if (req.headers.get("webhook-signature")) return webhook(req);
  const b = await req.json().catch(() => ({}));
  if (b.action === "registrar") return registrar(req, b);
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const t0 = Date.now();
  try {
    const detail = b.action === "seguimientos" ? await seguimientos() : await revisar();
    await sb.from("sync_runs").insert({ source: `comercial-auto:${b.action ?? "revisar"}`, ok: true, finished_at: new Date().toISOString(), detail: { ...detail, ms: Date.now() - t0 } });
    return Response.json(detail);
  } catch (e) {
    await sb.from("sync_runs").insert({ source: `comercial-auto:${b.action ?? "revisar"}`, ok: false, finished_at: new Date().toISOString(), detail: { error: String(e) } });
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
