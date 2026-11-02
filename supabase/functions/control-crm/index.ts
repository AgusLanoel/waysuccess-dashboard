// Aviso de cierre de día al teléfono del dueño por Telegram. Protegida con x-sync-key.
// Body: {"action":"enviar"} (lo que corre el cron), {"action":"vincular"} (toma el chat de quien le escribió al bot y manda una prueba)
// o {"action":"ver"} (devuelve el texto sin enviar nada).
// Secreto: TELEGRAM_BOT_TOKEN. El chat queda en settings.control_crm_chat. Cada corrida queda en sync_runs (source 'control-crm').
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

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

// Un segundo intento cubre cortes de red puntuales.
async function enviar(chat: number | string, text: string) {
  const body = { chat_id: chat, text, disable_web_page_preview: true };
  try {
    await telegram("sendMessage", body);
  } catch {
    await new Promise((res) => setTimeout(res, 5000));
    await telegram("sendMessage", body);
  }
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });

  const { action = "enviar" } = await req.json().catch(() => ({}));
  const started_at = new Date().toISOString();
  const log = (ok: boolean, detail: unknown) =>
    sb.from("sync_runs").insert({ source: "control-crm", started_at, finished_at: new Date().toISOString(), ok, detail });

  try {
    if (action === "ver") {
      const { data, error } = await sb.rpc("control_cierre_aviso");
      if (error) throw new Error(error.message);
      return Response.json({ texto: data });
    }
    if (!TOKEN) throw new Error("Falta el secreto TELEGRAM_BOT_TOKEN");

    if (action === "vincular") {
      const updates = await telegram("getUpdates", {});
      const chat = [...updates].reverse().map((u: any) => u.message?.chat).find((c: any) => c?.type === "private");
      if (!chat) throw new Error("Nadie le escribió al bot todavía");
      const { error } = await sb.from("settings").upsert({ key: "control_crm_chat", value: chat.id });
      if (error) throw new Error(error.message);
      await enviar(chat.id, "✅ Listo: acá vas a recibir el control del CRM todos los días a las 21 h.");
      await log(true, { action, vinculado: true });
      return Response.json({ vinculado: true });
    }

    const { data: fila } = await sb.from("settings").select("value").eq("key", "control_crm_chat").maybeSingle();
    if (!fila?.value) throw new Error("Falta vincular el chat (action: vincular)");
    const { data: texto, error } = await sb.rpc("control_cierre_aviso");
    if (error) throw new Error(error.message);
    await enviar(fila.value, texto);
    await log(true, { action, largo: texto.length });
    return Response.json({ enviado: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(false, { action, error: msg });
    return Response.json({ error: msg }, { status: 500 });
  }
});
