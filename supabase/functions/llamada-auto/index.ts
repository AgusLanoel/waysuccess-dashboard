// CRM automático desde las llamadas (17-11-2026, dueño + Rod: "que funcione siempre, sin la PC").
//
// Reemplaza la parte de comercial-auto que dependía de Fathom (descartado el 12-11). Fuente: "Notas de Gemini"
// en el Drive de cada closer, compartidas con el Gmail del dueño (OAuth en Vault, igual que oferta-auto).
//
// Cron cada 15 min {"action":"procesar"} (x-sync-key):
//   1) Encola las citas de los closers que terminaron hace 40+ min (desde el 16-11, cambio de oferta).
//   2) Por cada una busca la nota de Gemini del lead (−2 h / +24 h); espera "La transcripción finalizó".
//   3) Claude extrae: asistió, oferta (DFY/JessiK/Ninguna), resultado, etapa sugerida, motivo, próxima llamada, resumen.
//   4) Escribe en la oportunidad SIN pisar lo que cargó el closer: ¿Asistió?, ¿Se realizó la oferta?, Oferta,
//      Resumen (se agrega), Razón de seguimiento, próxima llamada, Fecha próximo seguimiento, link a la transcripción;
//      nota en el contacto. Mueve la etapa SOLO si sigue en una etapa previa a la llamada y SOLO a P1/P3/P5/2da Llamada.
//      Nunca a ganada, perdida, Reserva ni Cerrado: eso lo decide el closer.
//   5) Sin transcripción a las 3 h → alerta por Telegram al closer (vía com_alertas, la envía comercial-auto:revisar).
//   Si el lead no habló en la llamada (no-show), no escribe nada.
// La evaluación con la ficha de Rod se agrega en la columna `evaluacion` (pendiente de recibir la ficha).
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const API = "https://services.leadconnectorhq.com";
const GH = { Authorization: `Bearer ${Deno.env.get("GHL_PIT_TOKEN")}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const PIPELINE = "kW8pBFCaVVZJ1pw9okvh"; // 2. Leads (Agendado) - Venta
const TZ = "America/Argentina/Buenos_Aires";
const DESDE = "2026-11-16T00:00:00-03:00"; // cambio de oferta: no gastar tokens en llamadas anteriores
const H = 3600e3;
const ESPERA_MIN = 40; // minutos después del inicio de la cita
const PLAZO_H = 3; // sin transcripción a las 3 h → alerta
const anthropicKey = () => Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY_ALE");

const F = {
  asistio: "Vp3rYUo47OzLrgxol7yP",
  realizo: "H3JJfIUflRDFxE0vnllM",
  oferta: "50leQ4Rh4kKu08aQOcRQ",
  grabacion: "2lrp6WvUZk1HcWPVLLCa",
  resumen: "nhcb5PnmbX0XNpav3ZvE",
  proxSeguimiento: "cZQznvJEZOmObwid7Lgs",
  razonSeguimiento: "I1YDC7yUCv8z7eTWJQIl",
  proxLlamada: "6Wag8vuv9DP5PXnhPMxY",
};
const OFERTA_GHL: Record<string, string> = { DFY: "DFY $30k", JessiK: "JessiK $10k" };
const RAZONES = ["Capacidad de pago", "Socio / pareja", "Contrato", "Está viendo otras opciones", "Confianza en la empresa", "Logístico",
  "Tiene que pensarlo", "Quiere hacerlo después", "No toma decisiones en caliente", "Confianza en Ale", "Confianza en el vehículo",
  "Capacidad de él mismo", "Caro", "Confianza en el closer", "Malas experiencias", "Miedo al éxito", "Ghosteó", "Lo quiere hacer por su cuenta"];
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
const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// ---------- Google Drive (OAuth del Gmail del dueño) ----------
let tok: { t: string; exp: number } | null = null;
async function googleToken() {
  if (tok && tok.exp > Date.now() + 60e3) return tok.t;
  const { data: o } = await sb.rpc("get_drive_oauth");
  if (!o?.refresh_token) throw new Error("sin OAuth de Drive");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: o.client_id, client_secret: o.client_secret, refresh_token: o.refresh_token, grant_type: "refresh_token" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Google OAuth: ${j.error_description ?? j.error ?? r.status}`);
  tok = { t: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return tok.t;
}
// Mismo criterio que oferta-auto: primer nombre igual y, si ambos tienen apellido, al menos otra palabra en común.
function mismoLead(titulo: string, lead: string) {
  const m = norm(titulo).match(/asesoria(?: personalizada)?(?: entre .+? y)?(?: c)? (.+?) (?:\d{4} \d{2} \d{2}|transcripcion|notas de gemini)/);
  const a = (m ? m[1] : norm(titulo)).split(" ").filter((w) => w.length > 1);
  const b = norm(lead).split(" ").filter((w) => w.length > 1);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  if (a.length === 1 || b.length === 1) return true;
  return a.slice(1).some((w) => b.slice(1).includes(w));
}
async function buscarTranscripcion(lead: string, callAt: number) {
  const t = await googleToken();
  const desde = new Date(callAt - 2 * H).toISOString(), hasta = new Date(callAt + 24 * H).toISOString();
  const q = `name contains 'Notas de Gemini' and name contains 'Asesor' and mimeType = 'application/vnd.google-apps.document' and trashed = false and createdTime > '${desde}' and createdTime < '${hasta}'`;
  const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,webViewLink,owners(emailAddress))&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Drive ${r.status}: ${j?.error?.message ?? ""}`);
  const mejor = (j.files ?? []).filter((f: any) => mismoLead(f.name, lead))
    .sort((a: any, b: any) => Math.abs(Date.parse(a.createdTime) - callAt) - Math.abs(Date.parse(b.createdTime) - callAt))[0];
  if (!mejor) return null;
  const e = await fetch(`https://www.googleapis.com/drive/v3/files/${mejor.id}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${t}` } });
  if (!e.ok) throw new Error(`Drive export ${e.status}`);
  return { id: mejor.id, titulo: mejor.name, url: mejor.webViewLink ?? `https://docs.google.com/document/d/${mejor.id}`, owner: mejor.owners?.[0]?.emailAddress ?? null, texto: await e.text() };
}

// ---------- Claude ----------
const ESQUEMA = {
  type: "object", additionalProperties: false,
  required: ["asistio", "oferta", "precio_detectado", "evidencia_oferta", "resultado", "etapa_sugerida", "motivo", "proxima_llamada_acordada", "proximo_seguimiento", "cita_textual", "resumen", "resumen_corto"],
  properties: {
    asistio: { type: "boolean", description: "El lead estuvo y habló en la llamada" },
    oferta: { type: "string", enum: ["DFY", "JessiK", "Ninguna"], description: "Producto cuyo precio se le presentó. Si se presentaron los dos, el ÚLTIMO que el closer intentó vender." },
    precio_detectado: { type: "string", description: "El precio tal como se dijo; vacío si no hubo precio" },
    evidencia_oferta: { type: "string", description: "Frase textual corta (máx. 200 caracteres) donde se dice el precio; vacío si no hubo" },
    resultado: { type: "string", enum: ["Compró", "Reservó", "Seguimiento", "No le interesa", "No califica", "No se presentó", "Otro"] },
    etapa_sugerida: { type: "string", enum: [...Object.keys(ETAPAS_DESTINO), "Ninguna"], description: "Etapa de seguimiento si no compró ni reservó: P5 = va a comprar este mes; P3 = le interesa pero no puede ahora; P1 = no le interesa; 2da Llamada Agenda = quedó agendada una segunda llamada (p. ej. con el socio o pareja). 'Ninguna' si no aplica" },
    motivo: { type: "string", enum: [...RAZONES, "Ninguno"], description: "Principal razón por la que no cerró hoy" },
    proxima_llamada_acordada: { type: "boolean", description: "Quedaron explícitamente en volver a hablar en un momento concreto o aproximado" },
    proximo_seguimiento: { type: "string", description: "Fecha y hora acordada en ISO 8601 con offset. Vacío si no hay. Si solo hay día, 10:00 hora Argentina" },
    cita_textual: { type: "string", description: "Frase donde acuerdan la próxima llamada; vacío si no hay" },
    resumen: { type: "string", description: "Resumen para el CRM en 4 a 8 líneas: negocio y facturación, dolor, objeciones, qué se ofreció y a qué precio, próximos pasos" },
    resumen_corto: { type: "string", description: "Una línea" },
  },
};
const REGLAS = `Extraés datos de llamadas de venta de WaySuccess para cargarlos en el CRM. Respondé solo con lo que dice la transcripción; si algo no aparece, usá el valor vacío o 'Ninguno'. Español neutro.
Productos y precios:
- DFY ($30.000): "30.000", "30k", "15.000 para empezar y 15.000 al lograr el objetivo", financiado ~2.800 a 2.890 al mes, "4.000 al mes".
- JessiK ($10.000): "10.000", "10k", financiado 11.700 u 11.764, 980 (o 890 a 900) al mes, suscripción anual.
Mencionar el servicio sin precio NO es oferta. La transcripción automática a veces se come dígitos ("$,000", "mil"): resolvelo con el contexto.
Las "Notas de Gemini" existen aunque el lead no se presente: si en la transcripción solo habla el closer, asistio = false.`;
async function extraer(texto: string, lead: string, closer: string | null, callAt: string) {
  const key = anthropicKey();
  if (!key) throw new Error("falta ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const r: any = await client.beta.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
    system: REGLAS,
    messages: [{ role: "user", content: `Closer: ${closer ?? "?"}. Lead: ${lead}. La llamada empezó ${callAt} (UTC); en hora Argentina ${fmt(callAt)}. Resolvé fechas relativas ("el jueves", "mañana") contra esa fecha.\n\nNotas y transcripción:\n${texto.slice(0, 180000)}` }],
  } as any);
  if (r.stop_reason === "refusal") throw new Error("Claude no procesó la transcripción (refusal)");
  const txt = (r.content ?? []).find((b: any) => b.type === "text")?.text;
  if (!txt) throw new Error(`respuesta vacía (${r.stop_reason})`);
  return JSON.parse(txt);
}

// ---------- GHL ----------
let etapas: Map<string, string> | null = null;
async function nombresEtapas() {
  if (etapas) return etapas;
  const p = await ghl("GET", `/opportunities/pipelines?locationId=${LOC}`);
  etapas = new Map();
  for (const x of p.pipelines ?? []) for (const s of x.stages ?? []) etapas.set(s.id, s.name);
  return etapas;
}
async function oportunidad(contactId: string) {
  const j = await ghl("GET", `/opportunities/search?location_id=${LOC}&pipeline_id=${PIPELINE}&contact_id=${contactId}&limit=20`);
  const os = (j?.opportunities ?? []) as any[];
  return os.sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}

async function escribir(job: any, opp: any, ia: any, doc: any) {
  const actual: Record<string, any> = {};
  for (const f of opp.customFields ?? []) actual[f.id] = f.fieldValueString ?? f.fieldValueDate ?? f.fieldValue ?? f.value ?? null;
  const vacio = (id: string) => actual[id] == null || String(actual[id]).trim() === "";
  const cf: { id: string; field_value: any }[] = [];
  const cambios: Record<string, unknown> = {};
  const set = (id: string, v: any, nombre: string) => { cf.push({ id, field_value: v }); cambios[nombre] = v; };

  if (vacio(F.asistio)) set(F.asistio, "Si", "¿Asistió?");
  if (vacio(F.realizo)) set(F.realizo, ia.oferta !== "Ninguna" ? "Si" : "No", "¿Se realizó la oferta?");
  if (ia.oferta !== "Ninguna" && vacio(F.oferta)) set(F.oferta, OFERTA_GHL[ia.oferta], "Oferta");
  if (vacio(F.grabacion)) set(F.grabacion, doc.url, "Link grabación");
  if (ia.motivo !== "Ninguno" && RAZONES.includes(ia.motivo) && vacio(F.razonSeguimiento)) set(F.razonSeguimiento, ia.motivo, "Razón de seguimiento");
  const encabezado = `— ${fmt(job.call_at)} · ${job.closer ?? "closer"} —`;
  const previo = String(actual[F.resumen] ?? "");
  if (!previo.includes(encabezado)) set(F.resumen, [previo, `${encabezado}\n${ia.resumen}`].filter(Boolean).join("\n\n").slice(0, 9000), "Resumen de la llamada");
  if (ia.proxima_llamada_acordada) {
    const cuando = ia.proximo_seguimiento ? `${fmt(ia.proximo_seguimiento)} (hora Argentina)` : "sin fecha concreta";
    set(F.proxLlamada, `${cuando}${ia.cita_textual ? ` — "${ia.cita_textual.slice(0, 200)}"` : ""}`, "Próxima llamada acordada");
    if (ia.proximo_seguimiento) {
      const dia = new Date(ia.proximo_seguimiento).toLocaleDateString("en-CA", { timeZone: TZ });
      const previa = actual[F.proxSeguimiento] ? new Date(actual[F.proxSeguimiento]).toISOString().slice(0, 10) : null;
      const hoy = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
      if (!previa || previa < hoy) set(F.proxSeguimiento, dia, "Fecha próximo seguimiento");
    }
  }
  const body: Record<string, unknown> = {};
  if (cf.length) body.customFields = cf;
  const etapaActual = (await nombresEtapas()).get(opp.pipelineStageId) ?? "";
  const destino = ETAPAS_DESTINO[ia.etapa_sugerida];
  if (opp.status === "open" && destino && ETAPAS_PREVIAS.has(etapaActual) && ["Seguimiento", "No le interesa", "No califica"].includes(ia.resultado)) {
    body.pipelineStageId = destino;
    cambios["Etapa"] = `${etapaActual} → ${ia.etapa_sugerida}`;
  }
  if (Object.keys(body).length) await ghl("PUT", `/opportunities/${opp.id}`, body);

  const nota = [
    `📞 Llamada ${fmt(job.call_at)} · ${job.closer ?? "closer"} (automático)`,
    ia.resumen_corto,
    `Oferta: ${ia.oferta === "Ninguna" ? "sin precio en la llamada" : `${OFERTA_GHL[ia.oferta]} (${ia.precio_detectado})`}${ia.evidencia_oferta ? ` — "${ia.evidencia_oferta}"` : ""}`,
    `Resultado: ${ia.resultado}${ia.motivo !== "Ninguno" ? ` · Motivo: ${ia.motivo}` : ""}`,
    ia.proxima_llamada_acordada ? `Próxima llamada: ${ia.proximo_seguimiento ? fmt(ia.proximo_seguimiento) : "sin fecha concreta"}` : "",
    cambios["Etapa"] ? `Etapa: ${cambios["Etapa"]}` : "",
    `Transcripción: ${doc.url}`,
  ].filter(Boolean).join("\n");
  await ghl("POST", `/contacts/${job.contact_id}/notes`, { body: nota });
  return cambios;
}

// ---------- Cola ----------
async function encolar() {
  const { data: team } = await sb.from("comercial_team").select("name, ghl_user_id").eq("role", "closer").eq("active", true).not("ghl_user_id", "is", null);
  const porId = new Map((team ?? []).map((t: any) => [t.ghl_user_id, t.name]));
  const hasta = new Date(Date.now() - ESPERA_MIN * 60e3).toISOString();
  const desde = new Date(Math.max(Date.parse(DESDE), Date.now() - 3 * 24 * H)).toISOString();
  const { data: aps } = await sb.from("ghl_appointments").select("id, contact_id, assigned_user_id, start_time, status")
    .eq("deleted", false).gte("start_time", desde).lte("start_time", hasta).in("assigned_user_id", [...porId.keys()]).not("status", "in", "(cancelled,invalid)");
  if (!aps?.length) return 0;
  const { data: ya } = await sb.from("llamada_auto_jobs").select("appointment_id").in("appointment_id", aps.map((a: any) => a.id));
  const hechos = new Set((ya ?? []).map((x: any) => x.appointment_id));
  const nuevos = aps.filter((a: any) => !hechos.has(a.id));
  if (!nuevos.length) return 0;
  const { data: cs } = await sb.from("ghl_contacts").select("id, full_name").in("id", nuevos.map((a: any) => a.contact_id));
  const nombre = new Map((cs ?? []).map((c: any) => [c.id, c.full_name]));
  await sb.from("llamada_auto_jobs").insert(nuevos.map((a: any) => ({
    appointment_id: a.id, contact_id: a.contact_id, closer: porId.get(a.assigned_user_id) ?? null, lead_nombre: nombre.get(a.contact_id) ?? null,
    call_at: a.start_time, deadline_at: new Date(Date.parse(a.start_time) + PLAZO_H * H).toISOString(),
  })));
  return nuevos.length;
}

async function procesarJob(job: any) {
  const ahora = new Date().toISOString();
  const lead = job.lead_nombre ?? "";
  const doc = lead ? await buscarTranscripcion(lead, Date.parse(job.call_at)) : null;
  const completo = !!doc && /transcripci[oó]n finaliz|transcription ended/i.test(doc.texto);
  const vencido = Date.now() > Date.parse(job.deadline_at);
  if (!doc || (!completo && !vencido)) {
    if (!vencido) {
      await sb.from("llamada_auto_jobs").update({ estado: "buscando", intentos: job.intentos + 1, next_try_at: new Date(Date.now() + 15 * 60e3).toISOString(), updated_at: ahora }).eq("appointment_id", job.appointment_id);
      return "buscando";
    }
    // Sin transcripción a las 3 h: aviso al closer y se sigue buscando cada hora hasta las 24 h por si aparece tarde.
    if (job.estado !== "sin_transcripcion") {
      await sb.from("com_alertas").insert({
        tipo: "sin_transcripcion", persona: job.closer, contact_id: job.contact_id, lead_nombre: lead,
        mensaje: `No aparece la nota de Gemini de tu llamada con ${lead || "el lead"} (${fmt(job.call_at)}). Si la llamada ocurrió: ¿activaste "Tomar notas con Gemini" y la transcripción? ¿La nota quedó en tu carpeta "Google Meet" compartida? Si fue no-show, ignorá este aviso.`,
      });
    }
    const final = Date.now() > Date.parse(job.call_at) + 24 * H;
    await sb.from("llamada_auto_jobs").update({ estado: final ? "sin_transcripcion_final" : "sin_transcripcion", intentos: job.intentos + 1, next_try_at: new Date(Date.now() + H).toISOString(), updated_at: ahora }).eq("appointment_id", job.appointment_id);
    return "sin_transcripcion";
  }
  const ia = await extraer(doc.texto, lead, job.closer, job.call_at);
  const fila = { doc_id: doc.id, doc_url: doc.url, doc_titulo: doc.titulo, ia, intentos: job.intentos + 1, error: null, updated_at: ahora };
  if (!ia.asistio) {
    await sb.from("llamada_auto_jobs").update({ ...fila, estado: "no_asistio" }).eq("appointment_id", job.appointment_id);
    return "no_asistio";
  }
  const opp = await oportunidad(job.contact_id);
  if (!opp) {
    await sb.from("llamada_auto_jobs").update({ ...fila, estado: "sin_oportunidad" }).eq("appointment_id", job.appointment_id);
    return "sin_oportunidad";
  }
  const escrito = await escribir(job, opp, ia, doc);
  await sb.from("llamada_auto_jobs").update({ ...fila, opp_id: opp.id, escrito: { ...escrito, doc_owner: doc.owner }, estado: "hecho" }).eq("appointment_id", job.appointment_id);
  return "hecho";
}

async function procesar(limite = 15) {
  const encolados = await encolar();
  const { data: jobs } = await sb.from("llamada_auto_jobs").select("*")
    .in("estado", ["buscando", "sin_transcripcion", "error"]).lte("next_try_at", new Date().toISOString()).lt("intentos", 120)
    .order("call_at").limit(limite);
  const res: Record<string, number> = { encolados };
  for (const j of jobs ?? []) {
    try { const r = await procesarJob(j); res[r] = (res[r] ?? 0) + 1; }
    catch (e) {
      await sb.from("llamada_auto_jobs").update({ estado: "error", error: String(e).slice(0, 500), intentos: j.intentos + 1, next_try_at: new Date(Date.now() + 15 * 60e3).toISOString(), updated_at: new Date().toISOString() }).eq("appointment_id", j.appointment_id);
      res.error = (res.error ?? 0) + 1;
    }
  }
  return res;
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const t0 = Date.now();
  try {
    const detail = await procesar(Number(b.limite ?? 15));
    await sb.from("sync_runs").insert({ source: "llamada-auto", ok: true, finished_at: new Date().toISOString(), detail: { ...detail, ms: Date.now() - t0 } });
    return Response.json(detail);
  } catch (e) {
    await sb.from("sync_runs").insert({ source: "llamada-auto", ok: false, finished_at: new Date().toISOString(), detail: { error: String(e) } });
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
