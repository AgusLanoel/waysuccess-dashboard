// Copia las "Notas de Gemini" de asesorías de venta (visibles por el OAuth drive.readonly del Gmail del dueño,
// Vault google_drive_oauth → rpc get_drive_oauth) a la tabla privada llamadas_transcripciones.
// Uso: POST con x-sync-key, body {"desde":"2026-09-25T00:00:00Z","limite":25}. Repetir hasta "quedan" = 0.
// Creada 13-11-2026 para revisar las llamadas de venta (comparación octubre vs noviembre).
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function token() {
  const { data: o } = await sb.rpc("get_drive_oauth");
  if (!o?.refresh_token) throw new Error("sin OAuth de Drive");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: o.client_id, client_secret: o.client_secret, refresh_token: o.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Google OAuth: ${j.error_description ?? j.error ?? r.status}`);
  return j.access_token as string;
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("forbidden", { status: 403 });
  try {
    const b = await req.json().catch(() => ({}));
    const desde = b.desde ?? "2026-09-25T00:00:00Z";
    const limite = Math.min(Number(b.limite ?? 25), 40);
    const tok = await token();
    const q = `name contains 'Notas de Gemini' and name contains 'Asesor' and mimeType = 'application/vnd.google-apps.document' and trashed = false and createdTime > '${desde}'`;
    const files: any[] = [];
    let page = "";
    do {
      const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,createdTime,webViewLink)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives${page ? "&pageToken=" + page : ""}`;
      const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(`Drive ${r.status}: ${j?.error?.message ?? ""}`);
      files.push(...(j.files ?? []));
      page = j.nextPageToken ?? "";
    } while (page);
    const { data: ya } = await sb.from("llamadas_transcripciones").select("doc_id");
    const hechos = new Set((ya ?? []).map((x: any) => x.doc_id));
    const faltan = files.filter((f) => !hechos.has(f.id));
    let nuevos = 0;
    const errores: string[] = [];
    for (const f of faltan.slice(0, limite)) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok) { errores.push(`${f.name}: ${r.status}`); continue; }
      const texto = await r.text();
      const { error } = await sb.from("llamadas_transcripciones").upsert({ doc_id: f.id, titulo: f.name, created_time: f.createdTime, url: f.webViewLink, texto, chars: texto.length });
      if (error) { errores.push(`${f.name}: ${error.message}`); continue; }
      nuevos++;
    }
    return Response.json({ encontrados: files.length, ya_bajados: hechos.size, nuevos, quedan: Math.max(faltan.length - limite, 0), errores });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
