// Asistencia + Oferta automáticas en GHL (12-11-2026).
//
// Disparador: workflow de GHL "Pipeline Stage Changed" (pipeline 2. Leads (Agendado) - Venta, etapas P1/P3/P5)
//   → POST {SUPABASE_URL}/functions/v1/oferta-auto?k=<secreto oferta_webhook_key>
//     con datos personalizados opportunity_id={{opportunity.id}} y contact_id={{contact.id}}.
//
// Regla A (al instante): "¿Asistio?" vacío → "Si". Nunca pisa un valor cargado.
// Regla B (cola, cron cada 15 min {"action":"procesar"} con x-sync-key):
//   busca en Drive "Asesoría Personalizada | {lead} - … - Notas de Gemini" (trae la transcripción; −2 h / +24 h de la llamada), Claude detecta el
//   precio presentado → "¿Se realizo la oferta?" + "Oferta", nota con evidencia y enlace. Sin pisar lo cargado:
//   si contradice, nota "Revisar oferta". Sin transcripción a las 24 h → etiqueta revisar-oferta, sin inventar.
//   14-11 (dueño): si se presentaron los dos productos, Oferta = la ÚLTIMA que el closer intentó vender
//   (pitcheó DFY y bajó a JessiK → JessiK), aunque el lead no la haya aceptado.
// Backfill: {"action":"backfill"} arma la cola; {"action":"backfill_dry"} (repetir hasta vaciar) calcula la propuesta
//   sin escribir en GHL; {"action":"aplicar"} escribe solo
//   las filas con aprobado = true (las aprueba Luca sobre el CSV).
//
// Secretos: GHL_PIT_TOKEN, GHL_LOCATION_ID, ANTHROPIC_API_KEY, GOOGLE_SA_JSON (cuenta de servicio),
//   GOOGLE_DWD_SUBJECTS (correos de los closers separados por coma; si falta, la cuenta de servicio busca
//   solo lo que le compartieron).
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const LOC = Deno.env.get("GHL_LOCATION_ID")!;
const API = "https://services.leadconnectorhq.com";
const GH = { Authorization: `Bearer ${Deno.env.get("GHL_PIT_TOKEN")}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const PIPELINE = "kW8pBFCaVVZJ1pw9okvh";
const ETAPAS: Record<string, string> = {
  "08400d43-c052-4aa0-95d1-0d701c97face": "P1 - No tiene interés en este momento",
  "00c394aa-2278-431d-a964-9883ddd52b6a": "P3 - Interés pero no puede ahora",
  "79e3ee86-9c96-4452-abd6-a5cabf4bd0fc": "P5 - Compra este mes",
};
const F = { asistio: "Vp3rYUo47OzLrgxol7yP", realizo: "H3JJfIUflRDFxE0vnllM", oferta: "50leQ4Rh4kKu08aQOcRQ" };
const OFERTA_GHL: Record<string, string> = { DFY: "DFY $30k", JessiK: "JessiK $10k" };
const DESDE_BACKFILL = "2026-10-01T00:00:00-03:00";
const H = 3600e3;
const anthropicKey = () => Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY_ALE");

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
const log = (opp_id: string | null, accion: string, ok: boolean, detalle: unknown) =>
  sb.from("oferta_auto_log").insert({ opp_id, accion, ok, detalle });
const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const valores = (opp: any) => {
  const a: Record<string, string> = {};
  for (const f of opp.customFields ?? []) a[f.id] = String(f.fieldValueString ?? f.fieldValue ?? f.value ?? "").trim();
  return { asistio: a[F.asistio] ?? "", realizo: a[F.realizo] ?? "", oferta: a[F.oferta] ?? "" };
};
async function config() {
  const { data } = await sb.from("settings").select("value").eq("key", "oferta_auto").maybeSingle();
  return { siempreSi: !!data?.value?.oferta_siempre_si };
}

// ---------- Llamada y closer ----------
async function llamadaDe(contactId: string, antesDe: number) {
  const { data } = await sb.from("ghl_appointments").select("start_time, status, assigned_user_id").eq("contact_id", contactId)
    .eq("deleted", false).lte("start_time", new Date(antesDe + H).toISOString()).order("start_time", { ascending: false }).limit(5);
  let ap = (data ?? []).find((a: any) => !["cancelled", "invalid"].includes(a.status));
  if (!ap) {
    try {
      const j = await ghl("GET", `/contacts/${contactId}/appointments`);
      ap = (j?.events ?? []).map((e: any) => ({ start_time: e.startTime, status: e.appointmentStatus ?? e.appoinmentStatus, assigned_user_id: e.assignedUserId }))
        .filter((e: any) => Date.parse(e.start_time) <= antesDe + H && !["cancelled", "invalid"].includes(e.status))
        .sort((a: any, b: any) => Date.parse(b.start_time) - Date.parse(a.start_time))[0];
    } catch { /* sin cita */ }
  }
  if (!ap) return { call_at: null, closer: null };
  const { data: t } = await sb.from("comercial_team").select("name").eq("ghl_user_id", ap.assigned_user_id ?? "-").maybeSingle();
  return { call_at: new Date(ap.start_time).toISOString(), closer: t?.name ?? null };
}

// ---------- Regla A ----------
async function reglaA(opp: any, origen: string) {
  const v = valores(opp);
  if (v.asistio) return { asistio: "ya cargado: " + v.asistio };
  await ghl("PUT", `/opportunities/${opp.id}`, { customFields: [{ id: F.asistio, field_value: "Si" }] });
  await log(opp.id, `regla_a:${origen}`, true, { asistio: "Si" });
  return { asistio: "Si" };
}

async function encolar(opp: any, origen: string, extra: Record<string, unknown> = {}) {
  const contactId = opp.contactId ?? opp.contact?.id ?? opp.contact_id;
  const ref = Date.parse(opp.lastStageChangeAt ?? opp.last_stage_change_at ?? "") || Date.now();
  const { call_at, closer } = await llamadaDe(contactId, ref);
  const base = call_at ? Date.parse(call_at) : ref;
  const fila = {
    opp_id: opp.id, contact_id: contactId, lead_nombre: opp.contact?.name ?? opp.name ?? null, closer,
    etapa: ETAPAS[opp.pipelineStageId ?? opp.stage_id] ?? null, call_at, origen, estado: "pendiente", intentos: 0,
    next_try_at: new Date().toISOString(), deadline_at: new Date(Math.max(base, origen === "webhook" ? Date.now() - 2 * H : 0) + 24 * H).toISOString(),
    actual: valores(opp), error: null, updated_at: new Date().toISOString(), ...extra,
  };
  const { data: previa } = await sb.from("oferta_auto_jobs").select("estado, origen").eq("opp_id", opp.id).maybeSingle();
  if (previa && previa.estado === "hecho" && origen !== "webhook") return previa;
  await sb.from("oferta_auto_jobs").upsert(fila);
  return fila;
}

// ---------- Google Drive ----------
// Fuente principal (desde 12-11): OAuth drive.readonly del Gmail del dueño, al que cada closer le comparte su
// carpeta "Google Meet" (Lector). Credencial en Vault 'google_drive_oauth' → rpc get_drive_oauth (solo service_role).
// Respaldo: cuenta de servicio GOOGLE_SA_JSON (+ GOOGLE_DWD_SUBJECTS).
const tokens = new Map<string, { t: string; exp: number }>();
let oauthCfg: any = undefined;
async function oauth() {
  if (oauthCfg === undefined) { const { data } = await sb.rpc("get_drive_oauth"); oauthCfg = data ?? null; }
  return oauthCfg;
}
async function googleToken(sub: string | null) {
  const o = sub ? null : await oauth();
  if (o?.refresh_token) {
    const c = tokens.get("oauth");
    if (c && c.exp > Date.now() + 60e3) return c.t;
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: o.client_id, client_secret: o.client_secret, refresh_token: o.refresh_token, grant_type: "refresh_token" }) });
    const j = await r.json();
    if (!j.access_token) throw new Error(`Google OAuth: ${j.error_description ?? j.error ?? r.status}`);
    tokens.set("oauth", { t: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
    return j.access_token as string;
  }
  const raw = Deno.env.get("GOOGLE_SA_JSON");
  if (!raw) return null;
  const k = sub ?? "-";
  const c = tokens.get(k);
  if (c && c.exp > Date.now() + 60e3) return c.t;
  const sa = JSON.parse(raw);
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  const claim: Record<string, unknown> = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  if (sub) claim.sub = sub;
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Google token (${sub ?? "cuenta de servicio"}): ${j.error_description ?? j.error ?? r.status}`);
  tokens.set(k, { t: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token as string;
}
const credencialesDrive = async () => !!(await oauth())?.refresh_token || !!Deno.env.get("GOOGLE_SA_JSON");

// Títulos reales: "Asesoría Personalizada | X - 2026/11/06 12:00 GMT-04:00 - Notas de Gemini",
// "Asesoria Personalizada entre Luca Ferraria y X - …", "Asesoría X - …".
// Nombre parcial: el primer nombre coincide y, si ambos tienen apellido, comparten al menos otra palabra.
function mismoLead(titulo: string, lead: string) {
  const m = norm(titulo).match(/asesoria(?: personalizada)?(?: entre .+? y)? (.+?) (?:\d{4} \d{2} \d{2}|transcripcion|notas de gemini)/);
  const a = (m ? m[1] : norm(titulo)).split(" ").filter((w) => w.length > 1);
  const b = norm(lead).split(" ").filter((w) => w.length > 1);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  if (a.length === 1 || b.length === 1) return true;
  return a.slice(1).some((w) => b.slice(1).includes(w));
}

async function buscarTranscripcion(lead: string, callAt: number) {
  const subs = (Deno.env.get("GOOGLE_DWD_SUBJECTS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const desde = new Date(callAt - 2 * H).toISOString(), hasta = new Date(callAt + 24 * H).toISOString();
  const q = `(name contains 'Notas de Gemini' or name contains 'Transcripción') and name contains 'Asesor' and mimeType = 'application/vnd.google-apps.document' and trashed = false and createdTime > '${desde}' and createdTime < '${hasta}'`;
  const vistos: any[] = [];
  const usaOauth = !!(await oauth())?.refresh_token;
  for (const sub of !usaOauth && subs.length ? subs : [null]) {
    const tok = await googleToken(sub);
    const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,webViewLink)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(`Drive ${r.status} (${sub ?? "cuenta de servicio"}): ${j?.error?.message ?? ""}`);
    for (const f of j.files ?? []) if (mismoLead(f.name, lead)) vistos.push({ ...f, sub });
  }
  const mejor = vistos.sort((a, b) => Math.abs(Date.parse(a.createdTime) - callAt) - Math.abs(Date.parse(b.createdTime) - callAt))[0];
  if (!mejor) return null;
  const tok = await googleToken(mejor.sub);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${mejor.id}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Drive export ${r.status}`);
  return { id: mejor.id, titulo: mejor.name, url: mejor.webViewLink ?? `https://docs.google.com/document/d/${mejor.id}`, texto: await r.text() };
}

// ---------- Claude ----------
const ESQUEMA = {
  type: "object", additionalProperties: false,
  required: ["oferta", "ambas", "precio_detectado", "evidencia"],
  properties: {
    oferta: { type: "string", enum: ["DFY", "JessiK", "Ninguna"], description: "Producto cuyo precio se le presentó al lead. Si se presentaron los dos, el ÚLTIMO que el closer intentó vender (pitcheó DFY y bajó a JessiK → JessiK)." },
    ambas: { type: "boolean", description: "Se presentaron los precios de los dos productos" },
    precio_detectado: { type: "string", description: "El precio tal como se dijo (ej. '30.000', '980 al mes'); vacío si no hubo precio" },
    evidencia: { type: "string", description: "Frase textual corta de la transcripción que lo respalda (máx. 200 caracteres); vacío si no hubo precio" },
  },
};
const REGLAS = `Detectás qué precio se le presentó al lead en una llamada de venta de WaySuccess. Hay dos productos:
- DFY ($30.000): "30.000", "30k", "15.000 para empezar y 15.000 al lograr el objetivo", financiado ~2.800 a 2.890 al mes, "4.000 al mes".
- JessiK ($10.000): "10.000", "10k", financiado 11.700 u 11.764, 980 (o 890 a 900) al mes, suscripción anual.
- Si no se dijo ningún precio: "Ninguna". Mencionar el servicio sin precio NO es oferta.
La transcripción automática a veces se come dígitos (aparece "$,000" o "mil"): resolvelo con el contexto (producto descrito, cuotas, "12 meses", "50%").
Si se presentaron los dos, la oferta es la ÚLTIMA que el closer intentó vender en la llamada, aunque el lead no la haya aceptado (ej.: pitcheó DFY y después bajó a JessiK → JessiK), y marcá ambas = true.
Respondé solo con lo que dice la transcripción.`;
async function clasificar(texto: string, lead: string) {
  const key = anthropicKey();
  if (!key) throw new Error("falta ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const r: any = await client.beta.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
    system: REGLAS,
    messages: [{ role: "user", content: `Lead: ${lead}\n\nTranscripción:\n${texto}` }],
  } as any);
  if (r.stop_reason === "refusal") throw new Error("Claude no procesó la transcripción (refusal)");
  const txt = (r.content ?? []).find((b: any) => b.type === "text")?.text;
  if (!txt) throw new Error(`respuesta vacía (${r.stop_reason})`);
  return JSON.parse(txt);
}

// ---------- Propuesta y escritura ----------
function proponer(v: { asistio: string; realizo: string; oferta: string }, ia: any, siempreSi: boolean, bloquearAsistencia: boolean) {
  const p: Record<string, string> = {};
  const revisar: string[] = [];
  if (!v.asistio && !bloquearAsistencia) p.asistio = "Si";
  if (ia) {
    if (ia.oferta !== "Ninguna") {
      const val = OFERTA_GHL[ia.oferta];
      if (!v.realizo) p.realizo = "Si"; else if (v.realizo !== "Si") revisar.push(`el closer marcó ¿Se realizo la oferta? = ${v.realizo}, la transcripción dice Sí (${ia.precio_detectado})`);
      // 14-11 (dueño): closer marcó JessiK y la grabación solo tiene DFY → la bajada a JessiK fue fuera de la grabación; no es contradicción.
      const bajadaFuera = v.oferta === OFERTA_GHL.JessiK && ia.oferta === "DFY";
      if (!v.oferta) p.oferta = val; else if (v.oferta !== val && !bajadaFuera) revisar.push(`el closer marcó Oferta = ${v.oferta}, la transcripción dice ${val} (${ia.precio_detectado})`);
    } else if (!v.realizo) p.realizo = siempreSi ? "Si" : "No";
    else if (v.realizo === "Si" && !siempreSi) revisar.push("el closer marcó ¿Se realizo la oferta? = Si, la transcripción no tiene precio");
  }
  return { p, revisar };
}

async function escribir(job: any, opp: any, ia: any, doc: any, sinTranscripcion: boolean) {
  const cfg = await config();
  const v = valores(opp);
  const { p, revisar } = proponer(v, ia, cfg.siempreSi, job.bloquear_asistencia);
  const cf = [];
  if (p.asistio) cf.push({ id: F.asistio, field_value: p.asistio });
  if (p.realizo) cf.push({ id: F.realizo, field_value: p.realizo });
  if (p.oferta) cf.push({ id: F.oferta, field_value: p.oferta });
  if (cf.length) await ghl("PUT", `/opportunities/${opp.id}`, { customFields: cf });
  const notas: string[] = [];
  if (ia && ia.oferta !== "Ninguna") {
    notas.push([`Oferta detectada automáticamente: ${ia.oferta}${ia.ambas ? " (Se ofrecieron ambas)" : ""}`, `Precio detectado: ${ia.precio_detectado}`,
      ia.evidencia ? `Frase: "${ia.evidencia}"` : "", `Transcripción: ${doc.url}`].filter(Boolean).join("\n"));
  } else if (ia) notas.push(`Oferta detectada automáticamente: sin precio en la llamada.\nTranscripción: ${doc.url}`);
  for (const r of revisar) notas.push(`Revisar oferta: ${r}.${doc ? `\nTranscripción: ${doc.url}` : ""}`);
  // Sin transcripción: solo avisar si el closer no cargó la oferta (si ya está completo, no molestar).
  sinTranscripcion = sinTranscripcion && (!v.realizo || !v.oferta);
  if (sinTranscripcion) notas.push("Revisar oferta: no apareció la transcripción de la llamada en Drive dentro de las 24 h. Completar ¿Se realizo la oferta? y Oferta a mano.");
  for (const body of notas) await ghl("POST", `/contacts/${job.contact_id}/notes`, { body });
  if (sinTranscripcion) await ghl("POST", `/contacts/${job.contact_id}/tags`, { tags: ["revisar-oferta"] });
  return { campos: p, notas: notas.length, revisar, etiqueta: sinTranscripcion ? "revisar-oferta" : null };
}

// Una pasada sobre un job: busca transcripción, clasifica y (si no es dry) escribe.
async function procesarJob(job: any, dry: boolean) {
  const cfg = await config();
  const opp = (await ghl("GET", `/opportunities/${job.opp_id}`)).opportunity;
  if (!opp) throw new Error("oportunidad no encontrada");
  if (!job.call_at) {
    const prop = proponer(valores(opp), null, cfg.siempreSi, job.bloquear_asistencia);
    await sb.from("oferta_auto_jobs").update({ estado: "sin_llamada", actual: valores(opp), propuesto: { ...prop.p, revisar: prop.revisar, nota: "sin cita en GHL" }, updated_at: new Date().toISOString() }).eq("opp_id", job.opp_id);
    return "sin_llamada";
  }
  const drive = await credencialesDrive();
  if (!drive || !anthropicKey()) {
    const falta = [!drive && "credencial de Drive", !anthropicKey() && "ANTHROPIC_API_KEY"].filter(Boolean).join(", ");
    const prop = proponer(valores(opp), null, cfg.siempreSi, job.bloquear_asistencia);
    await sb.from("oferta_auto_jobs").update({ estado: "sin_credenciales", error: `falta ${falta}`, actual: valores(opp), propuesto: { ...prop.p, revisar: prop.revisar }, next_try_at: new Date(Date.now() + 15 * 60e3).toISOString(), updated_at: new Date().toISOString() }).eq("opp_id", job.opp_id);
    return "sin_credenciales";
  }
  const lead = job.lead_nombre || opp.contact?.name || opp.name || "";
  const doc = await buscarTranscripcion(lead, Date.parse(job.call_at));
  const vencido = Date.now() > Date.parse(job.deadline_at);
  // El doc de Gemini se crea al empezar la llamada; la transcripción se completa al terminar.
  const completo = !!doc && /transcripci[oó]n finaliz|transcription ended/i.test(doc.texto);
  if ((!doc || !completo) && !vencido) {
    await sb.from("oferta_auto_jobs").update({ estado: "buscando", intentos: job.intentos + 1, next_try_at: new Date(Date.now() + 15 * 60e3).toISOString(), error: null, updated_at: new Date().toISOString() }).eq("opp_id", job.opp_id);
    return "buscando";
  }
  const ia = doc ? await clasificar(doc.texto, lead) : null;
  const prop = proponer(valores(opp), ia, cfg.siempreSi, job.bloquear_asistencia);
  const fila: Record<string, unknown> = {
    doc_id: doc?.id ?? null, doc_url: doc?.url ?? null, doc_titulo: doc?.titulo ?? null, ia, actual: valores(opp),
    propuesto: { ...prop.p, revisar: prop.revisar, etiqueta: doc ? null : "revisar-oferta" }, intentos: job.intentos + 1, error: null, updated_at: new Date().toISOString(),
  };
  if (dry) { await sb.from("oferta_auto_jobs").update({ ...fila, estado: doc ? "propuesto" : "propuesto_sin_transcripcion" }).eq("opp_id", job.opp_id); return "propuesto"; }
  const escrito = await escribir(job, opp, ia, doc, !doc);
  await sb.from("oferta_auto_jobs").update({ ...fila, escrito, estado: doc ? "hecho" : "sin_transcripcion" }).eq("opp_id", job.opp_id);
  await log(job.opp_id, "regla_b", true, escrito);
  return doc ? "hecho" : "sin_transcripcion";
}

// ---------- Acciones ----------
async function webhook(b: any) {
  const oppId = b.opportunity_id ?? b.customData?.opportunity_id ?? b.opportunityId ?? b.opportunity?.id ?? b.id;
  if (!oppId) { await log(null, "webhook", false, { error: "sin opportunity_id", claves: Object.keys(b) }); return Response.json({ error: "sin opportunity_id" }, { status: 400 }); }
  try {
    const opp = (await ghl("GET", `/opportunities/${oppId}`)).opportunity;
    if (opp.pipelineId !== PIPELINE || !ETAPAS[opp.pipelineStageId]) { await log(oppId, "webhook", true, { ignorado: "fuera de P1/P3/P5" }); return Response.json({ ok: true, ignorado: true }); }
    const a = await reglaA(opp, "webhook");
    opp.lastStageChangeAt = opp.lastStageChangeAt ?? new Date().toISOString();
    await encolar(opp, "webhook");
    await log(oppId, "webhook", true, a);
    return Response.json({ ok: true, ...a });
  } catch (e) {
    await log(oppId, "webhook", false, { error: String(e) });
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

async function procesar(origen = "webhook", dry = false, limite = 25) {
  let q = sb.from("oferta_auto_jobs").select("*").eq("origen", origen).order("next_try_at").limit(limite);
  q = origen === "webhook" ? q.in("estado", ["pendiente", "buscando", "sin_credenciales", "error"]).lte("next_try_at", new Date().toISOString()) : q.in("estado", ["pendiente", "error"]).lt("intentos", 3);
  const { data: jobs } = await q;
  const out: Record<string, number> = {};
  for (const j of jobs ?? []) {
    try { const r = await procesarJob(j, dry); out[r] = (out[r] ?? 0) + 1; } catch (e) {
      out.error = (out.error ?? 0) + 1;
      await sb.from("oferta_auto_jobs").update({ estado: "error", error: String(e).slice(0, 500), intentos: j.intentos + 1, next_try_at: new Date(Date.now() + 15 * 60e3).toISOString(), updated_at: new Date().toISOString() }).eq("opp_id", j.opp_id);
      await log(j.opp_id, dry ? "backfill_dry" : "regla_b", false, { error: String(e) });
    }
  }
  return out;
}

// Arma la cola del backfill: oportunidades en P1/P3/P5 con llamada desde el 01-10-2026. No escribe en GHL.
async function backfill() {
  const { data: opps } = await sb.from("ghl_opportunities").select("id, contact_id, name, stage_id, last_stage_change_at, cf").eq("pipeline_id", PIPELINE).in("stage_id", Object.keys(ETAPAS));
  let n = 0, fuera = 0;
  for (const o of opps ?? []) {
    const { data: prev } = await sb.from("oferta_auto_jobs").select("estado").eq("opp_id", o.id).maybeSingle();
    if (prev && ["hecho", "sin_transcripcion"].includes(prev.estado)) continue;
    const ref = Date.parse(o.last_stage_change_at ?? "") || Date.now();
    const { call_at, closer } = await llamadaDe(o.contact_id, ref);
    if (!call_at || call_at < new Date(DESDE_BACKFILL).toISOString()) { fuera++; continue; }
    const v = { asistio: String(o.cf?.[F.asistio] ?? ""), realizo: String(o.cf?.[F.realizo] ?? ""), oferta: String(o.cf?.[F.oferta] ?? "") };
    await sb.from("oferta_auto_jobs").upsert({
      opp_id: o.id, contact_id: o.contact_id, lead_nombre: o.name, closer, etapa: ETAPAS[o.stage_id], call_at, origen: "backfill",
      estado: "pendiente", intentos: 0, deadline_at: new Date(Date.parse(call_at) + 24 * H).toISOString(), actual: v, aprobado: false, updated_at: new Date().toISOString(),
    });
    n++;
  }
  return { encolados: n, fuera_de_rango_o_sin_llamada: fuera };
}

async function aplicar() {
  const { data: jobs } = await sb.from("oferta_auto_jobs").select("*").eq("origen", "backfill").eq("aprobado", true).in("estado", ["propuesto", "propuesto_sin_transcripcion", "sin_credenciales", "sin_llamada"]);
  const out: Record<string, number> = {};
  for (const j of jobs ?? []) {
    try {
      const opp = (await ghl("GET", `/opportunities/${j.opp_id}`)).opportunity;
      const doc = j.doc_id ? { url: j.doc_url } : null;
      // Sin credenciales no hay transcripción leída: solo se aplica la asistencia, nunca la etiqueta.
      const sinT = j.estado === "propuesto_sin_transcripcion";
      const escrito = await escribir(j, opp, j.ia, doc, sinT);
      await sb.from("oferta_auto_jobs").update({ escrito, estado: j.ia || sinT ? (doc ? "hecho" : "sin_transcripcion") : "asistencia_aplicada", updated_at: new Date().toISOString() }).eq("opp_id", j.opp_id);
      await log(j.opp_id, "backfill_aplicar", true, escrito);
      out.ok = (out.ok ?? 0) + 1;
    } catch (e) { out.error = (out.error ?? 0) + 1; await log(j.opp_id, "backfill_aplicar", false, { error: String(e) }); }
  }
  return out;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const b = await req.json().catch(() => ({}));
  const k = url.searchParams.get("k") ?? req.headers.get("x-oferta-key");
  if (k) {
    const { data: ok } = await sb.rpc("check_oferta_key", { k });
    if (!ok) return new Response("forbidden", { status: 403 });
    return webhook(b);
  }
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const t0 = Date.now();
  try {
    const detail = b.action === "backfill" ? await backfill()
      : b.action === "backfill_dry" ? await procesar("backfill", true, 40)
      : b.action === "aplicar" ? await aplicar()
      : b.action === "probar" ? await probar(b)
      : await procesar("webhook", false);
    await sb.from("sync_runs").insert({ source: `oferta-auto:${b.action ?? "procesar"}`, ok: true, finished_at: new Date().toISOString(), detail: { ...detail, ms: Date.now() - t0 } });
    return Response.json(detail);
  } catch (e) {
    await sb.from("sync_runs").insert({ source: `oferta-auto:${b.action ?? "procesar"}`, ok: false, finished_at: new Date().toISOString(), detail: { error: String(e) } });
    return Response.json({ error: String(e) }, { status: 500 });
  }
});

// Prueba sin GHL ni Drive: clasifica un texto y muestra qué se escribiría sobre valores dados.
async function probar(b: any) {
  const ia = b.texto ? await clasificar(String(b.texto), "Lead de prueba") : null;
  return { ia, propuesta: proponer(b.actual ?? { asistio: "", realizo: "", oferta: "" }, ia, !!b.siempre_si, false) };
}
