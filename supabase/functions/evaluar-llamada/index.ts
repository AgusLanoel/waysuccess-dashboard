// Evaluación automática de cada asesoría con la ficha de Rod: "JessiK · Sistema de Evaluación de Llamadas v1.0 (preliminar)", 14-11-2026.
// 10 momentos (pasa/falla/N/A) + 5 KPIs (0–10) + chequeo de Fair Play + 3 prioridades de coaching, con cita textual.
//
// 17-11 (dueño): "cada vez que termina una llamada y llega una nueva transcripción, sacar el PDF y dejarlo en la oportunidad".
// Cron cada 15 min {"limite":N} (x-sync-key):
//   1) descubrir(): notas de Gemini nuevas en Drive sin tarea (p. ej. segundas llamadas sin cita en GHL) -> crea la tarea
//      en llamada_auto_jobs (appointment_id 'doc:<id>') para que llamada-auto cargue el CRM.
//   2) Evalúa las llamadas ya procesadas ('hecho') sin evaluación -> PDF en Storage (bucket privado 'evaluaciones',
//      link firmado 1 año) -> nota en el contacto de GHL con el resumen y el link al PDF (se ve en la oportunidad).
// {"appointment_ids":[...]} evalúa esas (re-evalúa si ya tenían). {"solo_pdf":true} rehace el PDF sin re-evaluar.
// El riesgo de no cierre y si la llamada pasa se calculan en código con las reglas de la ficha, no los decide el modelo.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API = "https://services.leadconnectorhq.com";
const GH = { Authorization: `Bearer ${Deno.env.get("GHL_PIT_TOKEN")}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" };
const TZ = "America/Argentina/Buenos_Aires";
const anthropicKey = () => Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY_ALE");
const fmt = (iso: string) => new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });

const MOMENTOS = [
  "Agenda verbalizada con \"simple y fácil\"",
  "Decisor confirmado antes del discovery",
  "Tres situaciones numeradas y \"¿Por qué?\"",
  "Números del negocio y conversión calculada",
  "Auditoría del Instagram en vivo",
  "Caso del mismo nicho mostrado",
  "Ecuación con sus números",
  "Demo de la plataforma en pantalla",
  "Convicción, dos formas de pago en orden y pausa",
  "Cierre asumido con fecha en voz alta",
];
const KPIS = ["V6 — Impulso de cierre", "V5 — Manejo de objeciones", "V11 — Claridad del cierre y siguientes pasos", "V3 — Discovery y palanca", "E7 — Adherencia al protocolo"];
const FAIR = ["Precio dentro de la oferta", "Solo servicios que existen", "Solo las garantías de la oferta", "Oferta correcta para la facturación"];

const FICHA = `Evaluás asesorías de venta de WaySuccess con la ficha "JessiK · Sistema de Evaluación de Llamadas v1.0" del Director Comercial (Rod). Cada hallazgo se ancla a una CITA TEXTUAL de la transcripción (con minuto si aparece). No inventes: si no está en la transcripción, no pasó.

CONTEXTO DE LA OPERACIÓN (desde el 16-nov). Dos ofertas:
- JessiK (prospectos que facturan 5.000 a 50.000 USD/mes): 10.000 USD por 3 meses, de contado o financiado a 12 meses (3 cuotas solo bajo demanda). Garantía: 100 agendas calificadas o devolución.
- Done For You (más de 50.000 USD/mes o referido de Ale): 30.000 USD, 100.000 seguidores garantizados. Solo flexible en 3 × 10.000.
La venta se hace en una asesoría de 45 minutos con el discovery incluido. El entregable de la llamada es un pago confirmado, una reserva de 500 USD o una siguiente llamada con fecha y hora dichas en voz alta. En Done For You se evalúa la fase equivalente de cada momento.

LOS 10 MOMENTOS (Pasa / Falla / N/A). N/A solo si no se podía evaluar: el prospecto cortó antes del bloque, o no era calificado (menos de 5.000 USD/mes) y no se presentó precio.
1. Agenda verbalizada con "simple y fácil" (bloque 02). Pasa si dice la promesa de tiempo (45 minutos), la agenda y "simple y fácil", y el prospecto da el sí.
2. Decisor confirmado antes del discovery (bloque 03). Pasa si se pregunta por otro decisor (socio/pareja) ANTES del bloque 04 y, si hay otro decisor, no se presenta el precio sin él.
3. Tres situaciones numeradas y "¿Por qué?" (bloques 05 y 06). Pasa si se dicen las tres situaciones numeradas, se espera la respuesta y se pregunta "¿Por qué?".
4. Números del negocio y conversión calculada (bloque 07). Pasa si obtiene ticket, facturación, leads y cierres (los cuatro) y calcula la conversión en vivo.
5. Auditoría del Instagram en vivo (bloque 08). Pasa si revisa el perfil en pantalla y hace la pregunta de representación (si el contenido lo representa).
6. Caso del mismo nicho mostrado (bloque 10). Pasa si el caso es del nicho del prospecto y se MUESTRA un video o captura (contarlo no basta).
7. Ecuación con sus números (bloque 11). Pasa si calcula clientes, agendas y seguidores con la meta, el ticket y la conversión del prospecto.
8. Demo de la plataforma en pantalla (bloque 14). Pasa si comparte pantalla con JessiK en el nicho del prospecto (Trending, un guion o la grabación guiada). Mostrar solo un tracker, landing o documento de marca no es la demo de JessiK.
9. Convicción de 8 o más, dos formas de pago en orden y pausa de 3 segundos (bloques 17 y 18). Pasa si hay un 8 o más (escala de convicción del prospecto) antes del precio, se dicen las dos formas de pago en orden (contado y financiado a 12 meses; las 3 cuotas no se ofrecen; en DFY "La inversión son 30.000 dólares") y el closer se calla al menos 3 segundos tras el precio.
10. Cierre asumido: pago en vivo o escalera con fecha dicha en voz alta (bloques 21 y 22). Pasa si se queda en la llamada hasta el pago o la reserva, o si agenda la siguiente llamada con la escalera (dos días, mañana o tarde, dos horas) y repite la fecha y la hora en voz alta.

LOS 5 KPIs (0 a 10, con cita):
- V6 Impulso de cierre: lenguaje asumido ("¿Cuál te acomoda más?", "Te mando el link") vs pedir permiso ("¿te interesaría?", "¿quieres pensarlo?"); si se quedó en la llamada hasta pago, reserva o fecha agendada.
- V5 Manejo de objeciones: cada objeción, si el closer la aisló, la respondió y confirmó del 1 al 10, o la esquivó.
- V11 Claridad del cierre y siguientes pasos: orden convicción 8+ → dos formas de pago en orden → pausa → "fuera del dinero" → pago en vivo o escalera → fecha y hora en voz alta → grupo de WhatsApp y onboarding agendado. Cada elemento que falta o está fuera de orden resta.
- V3 Discovery y palanca: esperó la respuesta a las tres situaciones y preguntó "¿Por qué?"; obtuvo los números, el objetivo personal y el día al mes; usó la palanca en el pitch y en el precio.
- E7 Adherencia al protocolo: nombre de pila, promesa de tiempo, agenda verbalizada, decisor, categoría confirmada, demo hecha, precio antes del minuto 40, llamada de menos de 50 minutos. Resta por lo prohibido: precio o descuento fuera de la oferta, servicios que no existen, garantías distintas a las de la oferta, grabación presencial en JessiK, decir "IA" o "agentes".

CHEQUEO DE FAIR PLAY (Cumple / Incumple, con cita):
- Precio dentro de la oferta: incumple si ofrece un precio menor o un descuento (JessiK 10.000; DFY 30.000, solo flexible en 3 × 10.000).
- Solo servicios que existen: incumple si promete podcast, canales que no están activos, landing pages, embudos web, email marketing o grabación presencial en JessiK.
- Solo las garantías de la oferta: incumple si garantiza leads, ventas o días exactos, o garantías distintas (JessiK = 100 agendas calificadas o devolución; DFY = 100.000 seguidores), u omite las condiciones de la garantía.
- Oferta correcta para la facturación: incumple si ofrece JessiK a quien factura más de 50.000 USD/mes, o DFY a quien no califica.

FORMATO: exactamente 10 momentos (n = 1 a 10, en orden), exactamente 5 KPIs (nota entera de 0 a 10), exactamente 4 chequeos de Fair Play y hasta 3 prioridades.
PRIORIDADES DE COACHING: las tres correcciones con más impacto en que el prospecto pague, ordenadas; cada una con la frase concreta que el closer debió decir.
La transcripción automática a veces se come dígitos ("$,000", "80" por 980): resolvelo con el contexto. Español neutro.`;

const estado = { type: "string", enum: ["Pasa", "Falla", "N/A"] };
const ESQUEMA = {
  type: "object", additionalProperties: false,
  required: ["datos", "momentos", "kpis", "fair_play", "objeciones", "prioridades", "resumen"],
  properties: {
    datos: {
      type: "object", additionalProperties: false,
      required: ["duracion_min", "minuto_precio", "facturacion_mensual", "categoria", "situacion", "resultado", "oferta", "forma_pago"],
      properties: {
        duracion_min: { type: "integer", description: "Duración aproximada en minutos según las marcas de tiempo; 0 si no se puede saber" },
        minuto_precio: { type: "integer", description: "Minuto en que se dijo el precio por primera vez; -1 si no hubo precio" },
        facturacion_mensual: { type: "string", description: "Facturación mensual declarada (USD), tal como se dijo; vacío si no se dijo" },
        categoria: { type: "string", enum: ["A", "B", "C", "D", "Sin confirmar"] },
        situacion: { type: "string", enum: ["1", "2", "3", "No se preguntó"] },
        resultado: { type: "string", enum: ["Pago", "Reserva", "Siguiente llamada con fecha", "Sin fecha", "Descalificado", "No se presentó"] },
        oferta: { type: "string", enum: ["JessiK", "DFY", "Ambas", "Ninguna"] },
        forma_pago: { type: "string", description: "Contado, financiado, 3 cuotas bajo demanda, pago único DFY o 3 × 10.000; vacío si no aplica" },
      },
    },
    momentos: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["n", "estado", "evidencia"], properties: { n: { type: "integer" }, estado, evidencia: { type: "string", description: "Cita textual corta (máx. 200 caracteres) con minuto; si falla por ausencia, decir qué faltó" } } },
    },
    kpis: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["kpi", "nota", "evidencia"], properties: { kpi: { type: "string", enum: KPIS }, nota: { type: "integer" }, evidencia: { type: "string" } } },
    },
    fair_play: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["chequeo", "estado", "evidencia"], properties: { chequeo: { type: "string", enum: FAIR }, estado: { type: "string", enum: ["Cumple", "Incumple"] }, evidencia: { type: "string" } } },
    },
    objeciones: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["objecion", "tipo", "manejo"], properties: {
        objecion: { type: "string", description: "Cita textual" },
        tipo: { type: "string", description: "Precio, Socio / pareja, Tiempo, Confianza, Lo tengo que pensar, Cámara, Caso del nicho, Otra" },
        manejo: { type: "string", enum: ["Aislada, respondida y confirmada", "Respondida sin confirmar", "Esquivada"] },
      } },
    },
    prioridades: { type: "array", items: { type: "string", description: "Corrección + frase concreta que debió decir" } },
    resumen: { type: "string", description: "2 o 3 líneas para el closer: qué hizo bien y qué le costó la venta" },
  },
};

async function token() {
  const { data: o } = await sb.rpc("get_drive_oauth");
  if (!o?.refresh_token) throw new Error("sin OAuth de Drive");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: o.client_id, client_secret: o.client_secret, refresh_token: o.refresh_token, grant_type: "refresh_token" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Google OAuth: ${j.error_description ?? j.error ?? r.status}`);
  return j.access_token as string;
}

async function evaluar(texto: string, job: any) {
  const key = anthropicKey();
  if (!key) throw new Error("falta ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const r: any = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
    system: FICHA,
    messages: [{ role: "user", content: `Closer: ${job.closer}. Prospecto: ${job.lead_nombre}. Llamada: ${fmt(job.call_at)} (hora Argentina).\nEl documento trae arriba un resumen de Gemini y después la transcripción: evaluá sobre la TRANSCRIPCIÓN.\n\n${texto.slice(0, 200000)}` }],
  } as any);
  if (r.stop_reason === "refusal") throw new Error("refusal");
  const txt = (r.content ?? []).find((b: any) => b.type === "text")?.text;
  if (!txt) throw new Error(`respuesta vacía (${r.stop_reason})`);
  const ev = JSON.parse(txt);
  // Reglas de la ficha, calculadas en código
  const m = new Map<number, string>(ev.momentos.map((x: any) => [x.n, x.estado]));
  const aplican = ev.momentos.filter((x: any) => x.estado !== "N/A");
  const pasan = aplican.filter((x: any) => x.estado === "Pasa").length;
  const incumple = ev.fair_play.filter((x: any) => x.estado === "Incumple").map((x: any) => x.chequeo);
  const fallaClave = [2, 7, 9, 10].filter((n) => m.get(n) === "Falla");
  ev.calculo = {
    momentos_pasa: pasan, momentos_aplican: aplican.length,
    kpi_promedio: Math.round((ev.kpis.reduce((t: number, k: any) => t + k.nota, 0) / ev.kpis.length) * 10) / 10,
    pasa_llamada: aplican.length > 0 && pasan === aplican.length && incumple.length === 0,
    fair_play_incumple: incumple,
    riesgo: ["Descalificado", "No se presentó"].includes(ev.datos.resultado) ? "no aplica" : ["Pago", "Reserva"].includes(ev.datos.resultado) ? "bajo" : fallaClave.length ? "alto" : ev.datos.resultado === "Siguiente llamada con fecha" ? "bajo" : "medio",
    momentos_clave_fallados: fallaClave,
  };
  return ev;
}

const norm = (x: string) => (x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function mismoLead(titulo: string, lead: string) {
  const m = norm(titulo).match(/asesoria(?: personalizada)?(?: entre .+? y)?(?: c)? (.+?) (?:\d{4} \d{2} \d{2}|transcripcion|notas de gemini)/);
  const a = (m ? m[1] : norm(titulo)).split(" ").filter((w) => w.length > 1);
  const b = norm(lead).split(" ").filter((w) => w.length > 1);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  if (a.length === 1 || b.length === 1) return true;
  return a.slice(1).some((w) => b.slice(1).includes(w));
}

// ---------- 1) Notas de Gemini nuevas sin tarea ----------
async function descubrir(t: string) {
  const desde = new Date(Date.now() - 2 * 864e5).toISOString();
  const q = `name contains 'Notas de Gemini' and name contains 'Asesor' and mimeType = 'application/vnd.google-apps.document' and trashed = false and createdTime > '${desde}'`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,owners(emailAddress))&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Drive ${r.status}: ${j?.error?.message ?? ""}`);
  const { data: jobs } = await sb.from("llamada_auto_jobs").select("doc_id, lead_nombre, call_at").gte("call_at", new Date(Date.now() - 4 * 864e5).toISOString());
  const { data: team } = await sb.from("comercial_team").select("name").eq("role", "closer").eq("active", true);
  let creadas = 0;
  for (const f of j.files ?? []) {
    const t0 = Date.parse(f.createdTime);
    const ya = (jobs ?? []).some((x: any) => x.doc_id === f.id || (x.lead_nombre && mismoLead(f.name, x.lead_nombre) && Math.abs(Date.parse(x.call_at) - t0) < 4 * 3600e3));
    if (ya) continue;
    const owner = norm(f.owners?.[0]?.emailAddress ?? "").replace(/ /g, "");
    const closer = (team ?? []).find((x: any) => owner.startsWith(norm(x.name).replace(/ /g, "")))?.name ?? null;
    // Contacto: citas de los últimos 60 días cuyo nombre coincide con el título de la nota
    const { data: aps } = await sb.from("ghl_appointments").select("contact_id").eq("deleted", false)
      .gte("start_time", new Date(t0 - 60 * 864e5).toISOString()).lte("start_time", new Date(t0 + 864e5).toISOString());
    const ids = [...new Set((aps ?? []).map((a: any) => a.contact_id).filter(Boolean))];
    const { data: cs } = ids.length ? await sb.from("ghl_contacts").select("id, full_name").in("id", ids) : { data: [] as any[] };
    const c = (cs ?? []).find((x: any) => x.full_name && mismoLead(f.name, x.full_name));
    if (!c) continue;
    await sb.from("llamada_auto_jobs").insert({ appointment_id: `doc:${f.id}`, contact_id: c.id, closer, lead_nombre: c.full_name, call_at: f.createdTime, deadline_at: new Date(t0 + 3 * 3600e3).toISOString() });
    creadas++;
  }
  return creadas;
}

// ---------- PDF (fuente estándar: solo caracteres WinAnsi) ----------
const limpio = (x: unknown) => String(x ?? "").replace(/[→⇒]/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/×/g, "x")
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E -ÿ—–•…\n]/g, "");
async function pdf(job: any, ev: any) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 42, ancho = W - 2 * M;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const lineas = (txt: string, font: any, size: number, w: number) => {
    const out: string[] = [];
    for (const par of limpio(txt).split("\n")) {
      let l = "";
      for (const pal of par.split(" ")) {
        const prueba = l ? `${l} ${pal}` : pal;
        if (font.widthOfTextAtSize(prueba, size) > w && l) { out.push(l); l = pal; } else l = prueba;
      }
      out.push(l);
    }
    return out;
  };
  const texto = (txt: string, o: { size?: number; bold?: boolean; color?: any; x?: number; w?: number; gap?: number } = {}) => {
    const size = o.size ?? 9.5, font = o.bold ? fb : f, x = o.x ?? M, w = o.w ?? ancho;
    for (const l of lineas(txt, font, size, w)) {
      if (y < M + size) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(l, { x, y: y - size, size, font, color: o.color ?? rgb(0.12, 0.12, 0.14) });
      y -= size * 1.35;
    }
    y -= o.gap ?? 3;
  };
  const verde = rgb(0.1, 0.5, 0.25), rojo = rgb(0.75, 0.15, 0.15), gris = rgb(0.42, 0.42, 0.47), azul = rgb(0.05, 0.36, 0.62);
  const titulo = (t: string) => { y -= 6; texto(t, { size: 12, bold: true, color: azul, gap: 4 }); };
  const sub = (t: string) => texto(t, { x: M + 12, w: ancho - 12, size: 9, color: gris, gap: 5 });
  const c = ev.calculo, d = ev.datos;
  texto("Evaluación de llamada · Ficha JessiK v1.0 (Rod)", { size: 16, bold: true });
  texto(`${job.closer ?? "Closer"} con ${job.lead_nombre ?? "prospecto"} · ${fmt(job.call_at)} (hora Argentina)`, { size: 11, gap: 8 });
  texto(`${c.pasa_llamada ? "PASA" : "NO PASA"}  ·  Momentos ${c.momentos_pasa}/${c.momentos_aplican}  ·  KPIs ${c.kpi_promedio}/10  ·  Riesgo de no cierre: ${String(c.riesgo).toUpperCase()}`, { size: 12, bold: true, color: c.pasa_llamada ? verde : rojo });
  if (c.fair_play_incumple.length) texto(`FAIR PLAY INCUMPLIDO: ${c.fair_play_incumple.join(" · ")} (se escala a Rod)`, { size: 10.5, bold: true, color: rojo });
  titulo("Datos de la llamada");
  const filas: [string, string][] = [["Duración", `${d.duracion_min} min`], ["Minuto del precio", d.minuto_precio >= 0 ? `${d.minuto_precio}` : "no se dijo precio"],
    ["Facturación declarada", d.facturacion_mensual || "—"], ["Categoría", d.categoria], ["Situación", d.situacion], ["Resultado", d.resultado], ["Oferta", d.oferta], ["Forma de pago", d.forma_pago || "—"]];
  for (const [k, v] of filas) texto(`${k}: ${v}`, { gap: 0 });
  titulo("Los 10 momentos");
  for (const m of ev.momentos) {
    texto(`${m.n}. ${MOMENTOS[m.n - 1] ?? ""} — ${String(m.estado).toUpperCase()}`, { bold: true, color: m.estado === "Pasa" ? verde : m.estado === "Falla" ? rojo : gris, gap: 0 });
    sub(m.evidencia);
  }
  titulo("KPIs (0 a 10)");
  for (const k of ev.kpis) { texto(`${k.kpi}: ${k.nota}/10`, { bold: true, gap: 0 }); sub(k.evidencia); }
  titulo("3 prioridades de coaching");
  ev.prioridades.slice(0, 3).forEach((p: string, i: number) => texto(`${i + 1}. ${p}`, { gap: 5 }));
  titulo("Chequeo de Fair Play");
  for (const x of ev.fair_play) { texto(`${x.chequeo}: ${String(x.estado).toUpperCase()}`, { bold: true, color: x.estado === "Cumple" ? verde : rojo, gap: 0 }); sub(x.evidencia); }
  y -= 6;
  texto(`Transcripción: ${job.doc_url ?? "—"}`, { size: 8.5, color: gris, gap: 0 });
  texto("Evaluación automática con Claude. Umbrales preliminares: se calibran con las primeras 20 llamadas.", { size: 8.5, color: gris });
  return await doc.save();
}

async function subirPdf(job: any, ev: any) {
  const bytes = await pdf(job, ev);
  const dia = new Date(job.call_at).toLocaleDateString("en-CA", { timeZone: TZ });
  const path = `${(job.closer ?? "sin-closer").replace(/\W+/g, "")}/${dia}_${norm(job.lead_nombre ?? "lead").replace(/ /g, "-")}_${String(job.appointment_id).replace(/\W+/g, "").slice(0, 24)}.pdf`;
  const { error } = await sb.storage.from("evaluaciones").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Storage: ${error.message}`);
  const { data } = await sb.storage.from("evaluaciones").createSignedUrl(path, 365 * 86400);
  return { path, url: data?.signedUrl ?? null };
}

function nota(job: any, ev: any, url: string | null) {
  const c = ev.calculo;
  return [
    `🧾 Evaluación de la llamada ${fmt(job.call_at)} · ${job.closer ?? ""} (ficha Rod v1.0)`,
    `${c.pasa_llamada ? "PASA" : "NO PASA"} · Momentos ${c.momentos_pasa}/${c.momentos_aplican} · KPIs ${c.kpi_promedio}/10 · Riesgo: ${String(c.riesgo).toUpperCase()}${c.fair_play_incumple.length ? ` · ⚠️ FAIR PLAY: ${c.fair_play_incumple.join(", ")}` : ""}`,
    url ? `📄 PDF de la evaluación: ${url}` : "",
  ].join("\n").slice(0, 4900);
}

async function procesar(b: any) {
  const t = await token();
  const nuevas = Array.isArray(b.appointment_ids) ? 0 : await descubrir(t).catch(() => 0);
  let q = sb.from("llamada_auto_jobs").select("*").not("doc_id", "is", null);
  if (Array.isArray(b.appointment_ids) && b.appointment_ids.length) q = q.in("appointment_id", b.appointment_ids);
  else q = q.eq("estado", "hecho").is("evaluacion", null).order("call_at").limit(Number(b.limite ?? 2));
  const { data: jobs } = await q;
  const out: any[] = [];
  for (const job of jobs ?? []) {
    try {
      let ev = job.evaluacion;
      if (!(b.solo_pdf && ev?.calculo)) {
        const e = await fetch(`https://www.googleapis.com/drive/v3/files/${job.doc_id}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${t}` } });
        if (!e.ok) throw new Error(`Drive export ${e.status}`);
        ev = await evaluar(await e.text(), job);
        ev.evaluado_at = new Date().toISOString();
      }
      const p = await subirPdf(job, ev);
      ev.pdf_path = p.path;
      ev.pdf_url = p.url;
      await sb.from("llamada_auto_jobs").update({ evaluacion: ev, updated_at: new Date().toISOString() }).eq("appointment_id", job.appointment_id);
      if (b.nota !== false && job.contact_id) {
        await fetch(`${API}/contacts/${job.contact_id}/notes`, { method: "POST", headers: GH, body: JSON.stringify({ body: nota(job, ev, p.url) }) });
      }
      out.push({ lead: job.lead_nombre, pdf: p.path, ...ev.calculo });
    } catch (err) {
      await sb.from("llamada_auto_jobs").update({ evaluacion: { error: String(err).slice(0, 400), evaluado_at: new Date().toISOString() } }).eq("appointment_id", job.appointment_id);
      out.push({ lead: job.lead_nombre, error: String(err).slice(0, 200) });
    }
  }
  return { nuevas, evaluadas: out.length, detalle: out };
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const t0 = Date.now();
  try {
    const detail = await procesar(b);
    await sb.from("sync_runs").insert({ source: "evaluar-llamada", ok: true, finished_at: new Date().toISOString(), detail: { ...detail, ms: Date.now() - t0 } });
    return Response.json(detail);
  } catch (e) {
    await sb.from("sync_runs").insert({ source: "evaluar-llamada", ok: false, finished_at: new Date().toISOString(), detail: { error: String(e) } });
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
