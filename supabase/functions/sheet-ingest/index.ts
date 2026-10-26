// Recibe la pestaña "Llamadas" de la hoja "WaySucess - Tracker Comercial" (la manda un Apps Script)
// y reemplaza la tabla sheet_calls. Las columnas se leen por el nombre del encabezado, no por posición.
// Autenticación: x-sheet-key, o el token de identidad de Google del Apps Script (Authorization: Bearer).
// La cuenta y el proyecto de Apps Script se fijan en settings.sheet_identity con el primer envío válido.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function authorized(req: Request): Promise<boolean> {
  const k = req.headers.get("x-sheet-key");
  if (k) { const { data } = await sb.rpc("check_sheet_key", { k }); return !!data; }
  const tok = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!tok) return false;
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(tok));
  if (!r.ok) return false;
  const t = await r.json();
  if (!["accounts.google.com", "https://accounts.google.com"].includes(t.iss)) return false;
  if (String(t.email_verified) !== "true" || !t.email || !t.aud) return false;
  if (Number(t.exp) * 1000 < Date.now()) return false;
  const { data: s } = await sb.from("settings").select("value").eq("key", "sheet_identity").maybeSingle();
  const v = s?.value ?? {};
  if (v.pending) {
    await sb.from("settings").update({ value: { email: t.email, aud: t.aud, since: new Date().toISOString() } }).eq("key", "sheet_identity");
    return true;
  }
  return v.email === t.email && v.aud === t.aud;
}

const normEmail = (e: any) => { const s = String(e ?? "").trim().toLowerCase(); return s.includes("@") ? s : null; };
const normPhone = (p: any) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 7 ? d.slice(-10) : null; };
const txt = (v: any) => { const s = String(v ?? "").trim(); return s === "" || s === "-" ? null : s; };
const key = (s: any) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function money(v: any): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!s || s === "-") return 0;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  return Number(s) || 0;
}

function date(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // dd/mm/aaaa
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
}

// "Fecha de ingreso de cliente" trae solo mes y año ("octubre 2026") o "No cerrado" → primer día del mes.
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function mes(v: any): string | null {
  const d = date(v);
  if (d) return d.slice(0, 8) + "01";
  const m = key(v).match(/^([a-z]+) (\d{4})$/);
  if (!m) return null;
  const i = MESES.indexOf(m[1] === "setiembre" ? "septiembre" : m[1]);
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}-01`;
}

const yes = (v: any) => /^s[ií]/i.test(String(v ?? "").trim());
const marked = (x: any) => x === true || x === 1 || /^(1|true|s[ií]|x)$/i.test(String(x ?? "").trim());

// Encabezado de la hoja → columna. Se busca el primero que empiece con cada prefijo.
const COLS: Record<string, string> = {
  fecha: "fecha llamada", nombre: "nombre lead", numero: "numero", correo: "correo", industria: "industria",
  ingreso: "fecha de ingreso",
  closer: "closer", setter: "setter origen", pais: "pais", origen: "origen de lead", producto: "producto", campana: "campana",
  estado: "estado llamada", asist: "asistencia calificada", oferta: "oferta hecha", resultado: "resultado",
  bono: "bono activado", modalidad: "modalidad pago", vendido: "vendido usd", cobrado: "cobrado usd",
};

Deno.serve(async (req) => {
  if (!(await authorized(req))) return new Response("forbidden", { status: 403 });
  const { headers, above, rows } = await req.json() as { headers: string[]; above: string[]; rows: { row: number; v: any[] }[] };
  const { data: run } = await sb.from("sync_runs").insert({ source: "sheet" }).select("id").single();
  try {
    const hk = headers.map(key);
    const idx: Record<string, number> = {};
    for (const [k, p] of Object.entries(COLS)) idx[k] = hk.findIndex((h) => h === p || h.startsWith(p));
    const missing = ["fecha", "nombre", "resultado", "vendido", "cobrado"].filter((k) => idx[k] < 0);
    if (missing.length) throw new Error("Faltan columnas en la hoja: " + missing.join(", "));
    // Objeciones: columnas entre "Resultado" y "Bono activado"; el nombre está en la fila de arriba.
    const objCols: { i: number; name: string }[] = [];
    if (idx.bono > idx.resultado) for (let i = idx.resultado + 1; i < idx.bono; i++) {
      const name = String(above?.[i] ?? "").trim();
      if (name) objCols.push({ i, name });
    }
    const g = (v: any[], k: string) => (idx[k] >= 0 ? v[idx[k]] : null);
    const out = rows
      .filter((r) => txt(g(r.v, "fecha")) || txt(g(r.v, "nombre")))
      .map(({ row, v }) => ({
        row_num: row,
        call_date: date(g(v, "fecha")),
        ingreso_mes: mes(g(v, "ingreso")),
        ingreso_raw: txt(g(v, "ingreso")),
        lead_name: txt(g(v, "nombre")),
        phone_norm: normPhone(g(v, "numero")),
        email_norm: normEmail(g(v, "correo")),
        industria: txt(g(v, "industria")),
        closer: txt(g(v, "closer")),
        setter: txt(g(v, "setter")),
        pais: txt(g(v, "pais")),
        origen: txt(g(v, "origen")),
        producto: txt(g(v, "producto")),
        campana: txt(g(v, "campana")),
        estado_llamada: txt(g(v, "estado")),
        asistencia_calificada: txt(g(v, "asist")),
        oferta_hecha: yes(g(v, "oferta")),
        resultado: txt(g(v, "resultado")),
        objeciones: objCols.filter((c) => marked(v[c.i])).map((c) => c.name),
        modalidad_pago: txt(g(v, "modalidad")),
        vendido: money(g(v, "vendido")),
        cobrado: money(g(v, "cobrado")),
        synced_at: new Date().toISOString(),
      }));
    const { error: delErr } = await sb.from("sheet_calls").delete().gte("row_num", 0);
    if (delErr) throw delErr;
    for (let i = 0; i < out.length; i += 500) {
      const { error } = await sb.from("sheet_calls").insert(out.slice(i, i + 500));
      if (error) throw error;
    }
    const { error: linkErr } = await sb.rpc("link_sheet_calls");
    if (linkErr) throw linkErr;
    const { count: linked } = await sb.from("sheet_calls").select("row_num", { count: "exact", head: true }).not("contact_id", "is", null);
    const detail = { rows: out.length, linked, vendido: out.reduce((s, r) => s + r.vendido, 0), cobrado: out.reduce((s, r) => s + r.cobrado, 0), con_ingreso: out.filter((r) => r.ingreso_mes).length };
    await sb.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: true, detail }).eq("id", run!.id);
    return Response.json(detail);
  } catch (e) {
    await sb.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: false, detail: { error: String((e as any)?.message ?? e) } }).eq("id", run!.id);
    return Response.json({ error: String((e as any)?.message ?? e) }, { status: 500 });
  }
});
