// Evaluación automática de cada asesoría con la ficha de Rod: "JessiK · Sistema de Evaluación de Llamadas v1.0 (preliminar)", 14-11-2026.
// 10 momentos (pasa/falla/N/A) + 5 KPIs (0–10) + chequeo de Fair Play + 3 prioridades de coaching, con cita textual.
//
// Toma las llamadas que llamada-auto ya procesó (estado 'hecho', con doc de Gemini) y sin evaluación;
// guarda el resultado en llamada_auto_jobs.evaluacion y deja una nota en el contacto de GHL.
// Cron cada 15 min {"limite":N} (x-sync-key). {"appointment_ids":[...]} evalúa esas (re-evalúa si ya tenían).
// El riesgo de no cierre y si la llamada pasa se calculan en código con las reglas de la ficha, no los decide el modelo.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

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
    riesgo: ["Pago", "Reserva"].includes(ev.datos.resultado) ? "bajo" : fallaClave.length ? "alto" : ev.datos.resultado === "Siguiente llamada con fecha" ? "bajo" : "medio",
    momentos_clave_fallados: fallaClave,
  };
  return ev;
}

function nota(job: any, ev: any) {
  const c = ev.calculo;
  const ico = (e: string) => (e === "Pasa" ? "✅" : e === "Falla" ? "❌" : "➖");
  return [
    `🧾 Evaluación de la llamada ${fmt(job.call_at)} · ${job.closer} (ficha Rod v1.0, automática)`,
    `Momentos: ${c.momentos_pasa}/${c.momentos_aplican} · KPIs: ${c.kpi_promedio}/10 · Riesgo de no cierre: ${c.riesgo.toUpperCase()}${c.fair_play_incumple.length ? ` · ⚠️ FAIR PLAY: ${c.fair_play_incumple.join(", ")}` : ""}`,
    `Resultado: ${ev.datos.resultado} · Oferta: ${ev.datos.oferta}${ev.datos.minuto_precio >= 0 ? ` (precio en el min ${ev.datos.minuto_precio})` : ""}`,
    "",
    ev.momentos.map((x: any) => `${ico(x.estado)} ${x.n}. ${MOMENTOS[x.n - 1] ?? ""}`).join("\n"),
    "",
    ev.kpis.map((k: any) => `${k.kpi}: ${k.nota}/10`).join(" · "),
    "",
    "Prioridades de coaching:",
    ev.prioridades.map((p: string, i: number) => `${i + 1}. ${p}`).join("\n"),
    "",
    ev.resumen,
    job.doc_url ? `Transcripción: ${job.doc_url}` : "",
  ].join("\n").slice(0, 4900);
}

async function procesar(b: any) {
  let q = sb.from("llamada_auto_jobs").select("*").not("doc_id", "is", null);
  if (Array.isArray(b.appointment_ids) && b.appointment_ids.length) q = q.in("appointment_id", b.appointment_ids);
  else q = q.eq("estado", "hecho").is("evaluacion", null).order("call_at").limit(Number(b.limite ?? 4));
  const { data: jobs } = await q;
  if (!jobs?.length) return { evaluadas: 0 };
  const t = await token();
  const out: any[] = [];
  for (const job of jobs) {
    try {
      const e = await fetch(`https://www.googleapis.com/drive/v3/files/${job.doc_id}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${t}` } });
      if (!e.ok) throw new Error(`Drive export ${e.status}`);
      const ev = await evaluar(await e.text(), job);
      ev.evaluado_at = new Date().toISOString();
      await sb.from("llamada_auto_jobs").update({ evaluacion: ev, updated_at: new Date().toISOString() }).eq("appointment_id", job.appointment_id);
      if (b.nota !== false && job.contact_id) {
        await fetch(`${API}/contacts/${job.contact_id}/notes`, { method: "POST", headers: GH, body: JSON.stringify({ body: nota(job, ev) }) });
      }
      out.push({ lead: job.lead_nombre, ...ev.calculo });
    } catch (err) {
      await sb.from("llamada_auto_jobs").update({ evaluacion: { error: String(err).slice(0, 400), evaluado_at: new Date().toISOString() } }).eq("appointment_id", job.appointment_id);
      out.push({ lead: job.lead_nombre, error: String(err).slice(0, 200) });
    }
  }
  return { evaluadas: out.length, detalle: out };
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
