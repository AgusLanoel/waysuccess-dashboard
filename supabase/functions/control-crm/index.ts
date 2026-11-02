// Bot de cierre de día en Telegram para el equipo. Acceso solo por invitación (control_bot_miembros / control_bot_invitaciones).
// Con x-sync-key: {"action":"enviar"} (cron 21 h, a todos los miembros), {"action":"ver"} (texto sin enviar), {"action":"webhook"} (conecta el bot),
// {"action":"responder","texto":"Luca"} (prueba: contesta como si el dueño lo hubiera escrito).
// Con el header secreto de Telegram: mensajes de chats privados. Quien no es miembro no recibe datos.
// Secreto: TELEGRAM_BOT_TOKEN. Cada corrida queda en sync_runs (source 'control-crm').
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const LIMITE = 4000; // Telegram corta en 4096

type Miembro = { chat_id: number; nombre: string; rol: string };

async function telegram(method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(`Telegram ${method}: ${r.status} ${j?.description ?? ""}`);
  return j.result;
}

// Parte por líneas para no cortar un lead al medio.
function partir(text: string) {
  const partes: string[] = [];
  let actual = "";
  for (const linea of text.split("\n")) {
    if (actual && actual.length + linea.length + 1 > LIMITE) {
      partes.push(actual);
      actual = linea;
    } else {
      actual = actual ? `${actual}\n${linea}` : linea;
    }
  }
  if (actual) partes.push(actual);
  return partes;
}

// Un segundo intento cubre cortes de red puntuales.
async function enviar(chat: number, text: string) {
  for (const parte of partir(text)) {
    const body = { chat_id: chat, text: parte, disable_web_page_preview: true };
    try {
      await telegram("sendMessage", body);
    } catch {
      await new Promise((res) => setTimeout(res, 5000));
      await telegram("sendMessage", body);
    }
  }
}

async function rpcTexto(fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as string;
}

// El enlace al dashboard solo sirve al dueño: los miembros no tienen esa pestaña.
const aviso = (m: Miembro) => rpcTexto("control_cierre_aviso", m.rol === "owner" ? {} : { p_url: null });

async function miembros() {
  const { data, error } = await sb.from("control_bot_miembros").select("chat_id, nombre, rol").eq("activo", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as Miembro[];
}

async function canjear(codigo: string, chat: number, quien: string) {
  const existentes = await miembros();
  const ya = existentes.find((m) => m.chat_id === chat);
  const { data } = await sb.from("control_bot_invitaciones")
    .update({ usado_en: new Date().toISOString(), usado_por: chat })
    .eq("codigo", codigo).is("usado_en", null).gt("expira_en", new Date().toISOString())
    .select("nombre").maybeSingle();
  if (!data) return "Este enlace ya se usó o venció. Pedí uno nuevo.";
  if (ya) return `Ya estás en el bot como ${ya.nombre}.`;
  const { error } = await sb.from("control_bot_miembros").upsert({ chat_id: chat, nombre: data.nombre, rol: "miembro", activo: true });
  if (error) throw new Error(error.message);
  // Aviso al dueño: si el enlace lo usó otra persona, lo ve acá.
  for (const m of existentes.filter((x) => x.rol === "owner")) {
    await enviar(m.chat_id, `✅ ${data.nombre} entró al bot (cuenta de Telegram: ${quien}).`).catch(() => {});
  }
  return `¡Hola, ${data.nombre}! Ya tenés acceso.\n\n${AYUDA}`;
}

const AYUDA = 'Escribí "yo" para ver tus pendientes en el CRM, el nombre de otra persona (ej: Luca) para ver los suyos, o "general" para el resumen de todos.\nTodos los días a las 21 h te llega el resumen.';
const AYUDA_DUENO = `${AYUDA}\n\nSolo vos:\n/invitar Nombre: crea el enlace de acceso\n/equipo: quiénes tienen acceso\n/quitar Nombre: saca el acceso`;

async function responder(m: Miembro, texto: string) {
  const t = texto.trim();
  const esDueno = m.rol === "owner";

  const invitar = t.match(/^\/invitar\s+(.+)$/i);
  if (invitar && esDueno) {
    const nombre = invitar[1].trim();
    const codigo = crypto.randomUUID().replaceAll("-", "");
    const { error } = await sb.from("control_bot_invitaciones").insert({ codigo, nombre });
    if (error) throw new Error(error.message);
    const bot = await telegram("getMe", {});
    return `Pasale este enlace a ${nombre}. Es de un solo uso y vence en 7 días:\nhttps://t.me/${bot.username}?start=${codigo}`;
  }
  if (/^\/equipo\b/i.test(t) && esDueno) {
    const lista = await miembros();
    return `Tienen acceso (${lista.length}):\n` + lista.map((x) => `• ${x.nombre}${x.rol === "owner" ? " (dueño)" : ""}`).join("\n");
  }
  const quitar = t.match(/^\/quitar\s+(.+)$/i);
  if (quitar && esDueno) {
    const { data, error } = await sb.from("control_bot_miembros").update({ activo: false })
      .ilike("nombre", quitar[1].trim()).eq("activo", true).eq("rol", "miembro").select("nombre");
    if (error) throw new Error(error.message);
    return data?.length ? `Listo: ${data[0].nombre} ya no tiene acceso.` : `No encontré a "${quitar[1].trim()}" entre los miembros. Mirá /equipo.`;
  }
  if (/^\/(start|help)\b|^(ayuda|hola)$/i.test(t)) return esDueno ? AYUDA_DUENO : AYUDA;
  if (/^\/?(general|todos|resumen)$/i.test(t)) return aviso(m);
  if (/^(yo|mis pendientes|m[ií]o)$/i.test(t)) return rpcTexto("control_cierre_persona", { p_nombre: m.nombre });
  return rpcTexto("control_cierre_persona", { p_nombre: t });
}

// Clave del webhook derivada del token: no suma otro secreto que guardar.
async function claveWebhook() {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`control-crm:${TOKEN}`));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const started_at = new Date().toISOString();
  const log = (ok: boolean, detail: unknown) =>
    sb.from("sync_runs").insert({ source: "control-crm", started_at, finished_at: new Date().toISOString(), ok, detail });

  // Mensajes de Telegram. Siempre 200: si no, Telegram reintenta el mismo mensaje.
  const secreto = req.headers.get("x-telegram-bot-api-secret-token");
  if (secreto !== null) {
    if (!TOKEN || secreto !== (await claveWebhook())) return new Response("forbidden", { status: 403 });
    const update = await req.json().catch(() => null);
    const msg = update?.message;
    const chat: number | undefined = msg?.chat?.id;
    const texto: string | undefined = msg?.text;
    if (!chat || !texto || msg.chat.type !== "private") return new Response("ok");
    try {
      const codigo = texto.trim().match(/^\/start\s+([a-f0-9]{32})$/i)?.[1];
      if (codigo) {
        const quien = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") + (msg.from?.username ? ` @${msg.from.username}` : "");
        await enviar(chat, await canjear(codigo, chat, quien || "sin nombre"));
        await log(true, { action: "invitacion" });
        return new Response("ok");
      }
      const miembro = (await miembros()).find((m) => m.chat_id === chat);
      if (!miembro) {
        await enviar(chat, "Este bot es privado. Pedile un enlace de acceso al administrador.");
        await log(true, { action: "rechazado" });
        return new Response("ok");
      }
      await enviar(chat, await responder(miembro, texto));
      await log(true, { action: "mensaje", de: miembro.nombre });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await log(false, { action: "mensaje", error });
      await enviar(chat, "No pude armar la respuesta. Probá de nuevo en un minuto.").catch(() => {});
    }
    return new Response("ok");
  }

  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });

  const { action = "enviar", texto } = await req.json().catch(() => ({}));
  try {
    if (action === "ver") return Response.json({ texto: await rpcTexto("control_cierre_aviso") });
    if (!TOKEN) throw new Error("Falta el secreto TELEGRAM_BOT_TOKEN");

    if (action === "webhook") {
      await telegram("setWebhook", {
        url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/control-crm`,
        secret_token: await claveWebhook(),
        allowed_updates: ["message"],
      });
      const info = await telegram("getWebhookInfo", {});
      await log(true, { action, pendientes: info.pending_update_count, ultimo_error: info.last_error_message ?? null });
      return Response.json({ conectado: Boolean(info.url), pendientes: info.pending_update_count, ultimo_error: info.last_error_message ?? null });
    }

    const lista = await miembros();
    const dueno = lista.find((m) => m.rol === "owner");
    if (!dueno) throw new Error("No hay dueño en control_bot_miembros");

    if (action === "responder") {
      const t = String(texto ?? "");
      const codigo = t.trim().match(/^\/start\s+([a-f0-9]{32})$/i)?.[1];
      await enviar(dueno.chat_id, codigo ? await canjear(codigo, dueno.chat_id, "prueba") : await responder(dueno, t));
      await log(true, { action });
      return Response.json({ enviado: true });
    }

    // Un miembro que bloqueó el bot no frena el aviso de los demás.
    const fallidos: string[] = [];
    for (const m of lista) {
      try {
        await enviar(m.chat_id, await aviso(m));
      } catch {
        fallidos.push(m.nombre);
      }
    }
    const todoOk = fallidos.length === 0;
    await log(todoOk, { action, enviados: lista.length - fallidos.length, fallidos });
    return Response.json({ enviados: lista.length - fallidos.length, fallidos }, { status: todoOk ? 200 : 500 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await log(false, { action, error });
    return Response.json({ error }, { status: 500 });
  }
});
