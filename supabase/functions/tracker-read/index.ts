// Lee el Tracker Comercial (Google Sheets) en SOLO LECTURA y lo guarda en public.tracker_filas.
// Decisión del dueño (14-11-2026): las ventas salen de GHL; el Tracker solo alimenta los bloques "fuente: Tracker"
// (Llamada → pago con "Fecha primer pago", Cobros — Seguimiento, Proyecciones y objeciones U:AM).
// Credencial: OAuth del Gmail del dueño (Vault 'google_drive_oauth', scope drive.readonly) vía rpc get_drive_oauth.
// Nunca escribe en el Sheet: solo descarga el CSV de cada hoja (export de Drive).
// Protegida con x-sync-key (la llama el cron con private.call_fn).
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SHEET = Deno.env.get("TRACKER_SHEET_ID") ?? "105oZEzxIuvon9f37P2sK_HIQ0vxUFVOnntER-NaiLRk";

async function token() {
  const { data: o } = await sb.rpc("get_drive_oauth");
  if (!o?.refresh_token) throw new Error("Falta la credencial google_drive_oauth");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: o.client_id, client_secret: o.client_secret, refresh_token: o.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Google OAuth: ${j.error_description ?? j.error ?? r.status}`);
  return j.access_token as string;
}

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

// Serial de Sheets (base 1899-12-30), dd/mm/yyyy, yyyy-mm-dd o texto en inglés ("Thursday, October 1, 2026 11:00 AM") → yyyy-mm-dd
const MESES: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const okDate = (y: number, m: number, d: number) => (y > 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);
function fecha(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (v < 30000 || v > 80000) return null;
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return t.toISOString().slice(0, 10);
  }
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return okDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return okDate(+m[3], +m[2], +m[1]);
  m = s.toLowerCase().match(/([a-záéíóú]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MESES[m[1]]) return okDate(+m[3], MESES[m[1]], +m[2]);
  m = s.toLowerCase().match(/(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return okDate(+m[3], MESES[m[2]], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return fecha(Number(s));
  return null;
}
// "US$2.000", "2000", "1,234.5" → número; texto no numérico → null
function monto(v: unknown): number | null {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!s || s === "-") return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : null;
}

const colLetra = (i: number) => { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

// CSV de cada hoja vía Drive (export con gid): no requiere la API de Sheets habilitada en el proyecto de Google.
const GIDS = { llamadas: 584734302, cobros: 1966110601, proyecciones: 493758878, clientes: 602697806 };
function csv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); out.push(row); }
  return out;
}
async function hoja(t: string, gid: number) {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${gid}`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`Export gid ${gid}: ${r.status}`);
  return csv(await r.text());
}

async function leer() {
  const t = await token();
  const [ll, co, pr, cc] = await Promise.all([hoja(t, GIDS.llamadas), hoja(t, GIDS.cobros), hoja(t, GIDS.proyecciones), hoja(t, GIDS.clientes)]) as unknown[][][];

  const filas: { hoja: string; fila: number; datos: Record<string, unknown> }[] = [];

  // Llamadas: encabezado en fila 2; objeciones (U:AM) toman el nombre de la fila 1.
  const h1 = ll[0] ?? [], h2 = ll[1] ?? [];
  const headers = h2.map((h, i) => {
    const t1 = clean(h1[i]);
    if (i >= 20 && i <= 38 && t1) return "obj:" + t1;
    return clean(h);
  });
  for (let i = 2; i < ll.length; i++) {
    const row = ll[i];
    if (!clean(row[1])) continue; // sin nombre de lead = ignorar
    const d: Record<string, unknown> = {};
    headers.forEach((h, c) => {
      if (!h || h.startsWith("Filtro ")) return;
      const v = row[c];
      if (v === "" || v == null) return;
      if (/^fecha/i.test(h)) { d[h] = fecha(v); d[h + "__raw"] = v; }
      else if (h.startsWith("$$")) d[h] = monto(v);
      else d[h] = typeof v === "string" ? clean(v) : v;
    });
    filas.push({ hoja: "Llamadas", fila: i + 1, datos: d });
  }

  // Cobros — Seguimiento: encabezado en fila 1
  const hc = (co[0] ?? []).map(clean);
  for (let i = 1; i < co.length; i++) {
    const row = co[i];
    if (!row.some((v) => clean(v))) continue;
    const d: Record<string, unknown> = {};
    hc.forEach((h, c) => {
      const v = row[c];
      if (!h || v === "" || v == null) return;
      if (/^fecha/i.test(h)) { d[h] = fecha(v); d[h + "__raw"] = v; }
      else if (/USD|Cobrado|Vendido|Excedente/i.test(h) && h !== "Tipo de cobro") d[h] = monto(v);
      else d[h] = typeof v === "string" ? clean(v) : v;
    });
    filas.push({ hoja: "Cobros", fila: i + 1, datos: d });
  }

  // Proyecciones: grilla tal cual (celdas por letra), la interpretan las funciones SQL
  for (let i = 0; i < pr.length; i++) {
    const d: Record<string, unknown> = {};
    pr[i].forEach((v, c) => { if (v !== "" && v != null) d[colLetra(c)] = typeof v === "string" ? clean(v) : v; });
    if (Object.keys(d).length) filas.push({ hoja: "Proyecciones", fila: i + 1, datos: d });
  }

  // Cierres — Clientes (15-11): lista completa de cierres (bloque auxiliar FECHA…FILA, encabezado en mayúsculas)
  // y validación geográfica (Fila Llamadas · País validado · Estado validado · Ciudad validada · Origen de corrección).
  // Columnas por TEXTO del encabezado, no por letra.
  const iEnc = cc.findIndex((r) => r.some((v) => clean(v) === "FECHA") && r.some((v) => clean(v) === "CLIENTE"));
  if (iEnc >= 0) {
    const enc = cc[iEnc].map(clean);
    const ini = enc.indexOf("FECHA"), fin = enc.indexOf("FILA", ini);
    for (let i = iEnc + 1; i < cc.length; i++) {
      const row = cc[i];
      const d: Record<string, unknown> = {};
      for (let c = ini; c <= fin; c++) {
        const h = enc[c], v = row[c];
        if (!h || v === "" || v == null) continue;
        if (h.startsWith("FECHA")) { d[h] = fecha(v); d[h + "__raw"] = v; }
        else if (["VENDIDO", "COBRADO", "PENDIENTE"].includes(h)) d[h] = monto(v);
        else d[h] = clean(v);
      }
      if (d.CLIENTE) filas.push({ hoja: "Cierres", fila: i + 1, datos: d });
    }
  }
  const iGeo = cc.findIndex((r) => r.some((v) => clean(v) === "País validado"));
  if (iGeo >= 0) {
    const enc = cc[iGeo].map(clean);
    const cols = ["Fila Llamadas", "País validado", "Estado validado", "Ciudad validada", "Origen de corrección"].map((h) => [h, enc.indexOf(h)] as const);
    for (let i = iGeo + 1; i < cc.length; i++) {
      const d: Record<string, unknown> = {};
      for (const [h, c] of cols) if (c >= 0 && clean(cc[i][c])) d[h] = clean(cc[i][c]);
      if (d["Fila Llamadas"]) filas.push({ hoja: "Geo", fila: i + 1, datos: d });
    }
  }
  return filas;
}

Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("check_sync_key", { k: req.headers.get("x-sync-key") });
  if (!ok) return new Response("no autorizado", { status: 401 });
  const t0 = Date.now();
  try {
    const filas = await leer();
    const { error } = await sb.rpc("tracker_reemplazar", { p_filas: filas });
    if (error) throw new Error(error.message);
    const n = filas.reduce((a, f) => ((a[f.hoja] = (a[f.hoja] ?? 0) + 1), a), {} as Record<string, number>);
    await sb.from("sync_runs").insert({ source: "tracker", ok: true, detail: n, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString() });
    return Response.json({ ok: true, ...n, ms: Date.now() - t0 });
  } catch (e) {
    await sb.from("sync_runs").insert({ source: "tracker", ok: false, detail: { error: String(e) }, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString() });
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
