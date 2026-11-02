// Bot de cierre de día en Telegram.
// Con x-sync-key: {"action":"enviar"} (cron 21 h), {"action":"ver"} (texto sin enviar), {"action":"webhook"} (conecta el bot a esta función),
// {"action":"responder","texto":"Luca"} (prueba: contesta como si el dueño lo hubiera escrito).
// Con el header secreto de Telegram: mensajes del chat. Solo contesta a settings.control_crm_chat; el resto se ignora.
// Secreto: TELEGRAM_BOT_TOKEN. Cada corrida queda en sync_runs (source 'control-crm').
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const LIMITE = 4000; // Telegram corta en 4096

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
async function enviar(chat: number | string, text: string) {
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

async function chatDueno() {
  const { data } = await sb.from("settings").select("value").eq("key", "control_crm_chat").maybeSingle();
  return data?.value ?? null;
}

async function responder(texto: string) {
  const t = texto.trim();
  if (/^\/(start|help)\b|^(ayuda|hola)$/i.test(t)) {
    return 'Escribí el nombre de una persona (ej: Luca) y te doy el mensaje listo para reenviarle.\n"general" = el resumen de todos.';
  }
  if (/^\/?(general|todos|resumen)$/i.test(t)) return rpcTexto("control_cierre_aviso");
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
    const chat = update?.message?.chat?.id;
    const texto = update?.message?.text;
    const dueno = await chatDueno();
    if (!chat || !texto || String(chat) !== String(dueno)) return new Response("ok");
    try {
      await enviar(chat, await responder(texto));
      await log(true, { action: "mensaje" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log(false, { action: "mensaje", error: msg });
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
        drop_pending_updates: true,
      });
      const info = await telegram("getWebhookInfo", {});
      await log(true, { action, pendientes: info.pending_update_count, ultimo_error: info.last_error_message ?? null });
      return Response.json({ conectado: Boolean(info.url), ultimo_error: info.last_error_message ?? null });
    }

    const chat = await chatDueno();
    if (!chat) throw new Error("Falta settings.control_crm_chat");

    if (action === "responder") {
      await enviar(chat, await responder(String(texto ?? "")));
      await log(true, { action });
      return Response.json({ enviado: true });
    }

    const aviso = await rpcTexto("control_cierre_aviso");
    await enviar(chat, aviso);
    await log(true, { action, largo: aviso.length });
    return Response.json({ enviado: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(false, { action, error: msg });
    return Response.json({ error: msg }, { status: 500 });
  }
});
