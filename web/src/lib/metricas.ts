// Capa de métricas ÚNICA del dashboard (rediseño 14-11-2026).
// Todas las pestañas leen de acá: ningún componente recalcula una métrica por su cuenta.
// Los datos crudos vienen de la rpc dash_datos() (Supabase) y ya respetan los permisos de cada rol.

// ───────────────────────── Configuración ([A CONFIRMAR] = valor por defecto, cambiar acá) ─────────────────────────
export const FECHA_INICIO_DATOS = "2026-10-01"; // regla 7: nada anterior a esta fecha
export const COMISION = 0.03; // 3% de lo cobrado, DFY y JessiK (confirmado por Luca)
export const COMISION_INCLUYE_SEGUIMIENTO = false; // [A CONFIRMAR] el Tracker no la incluye (US$270 = 3% de US$9.000)
export const EXCLUIR_OUTLIERS_POR_DEFECTO = true; // [A CONFIRMAR] Llamada → pago: excluir > 30 días
export const OUTLIER_DIAS = 30;
export const ETAPAS_SEGUIMIENTO = ["P5 - Compra este mes", "P3 - Interés pero no puede ahora", "P1 - No tiene interés en este momento", "2da Llamada Agenda", "Reserva"] as const;
export const ETAPA_CORTA: Record<string, string> = {
  "P5 - Compra este mes": "P5", "P3 - Interés pero no puede ahora": "P3", "P1 - No tiene interés en este momento": "P1",
  "2da Llamada Agenda": "2da llamada", Reserva: "Reserva",
};
// [A CONFIRMAR] Mapeo PIF, valor por valor (Plan de pago / Método de cobro de GHL; respaldo: "Modalidad pago" del Tracker).
// PIF = JessiK pagado el año completo al cierre (contado o financiado). Mes a mes = No PIF. Ambiguo/vacío = Sin clasificar.
export type ClasePif = "PIF" | "No PIF" | "Sin clasificar";
export const MAPEO_PIF: { plan: string | null; metodo: string | null; clase: ClasePif; nota: string }[] = [
  { plan: "Contado", metodo: null, clase: "PIF", nota: "Pago único" },
  { plan: "Financiera", metodo: null, clase: "PIF", nota: "Año completo con financiera" },
  { plan: "Cuotas", metodo: "Whop", clase: "Sin clasificar", nota: "\"Cuotas Whop\": ¿año financiado o mes a mes? Espera a Luca" },
  { plan: "Cuotas", metodo: "Stripe", clase: "Sin clasificar", nota: "Cuotas por Stripe: ¿año financiado o mes a mes?" },
  { plan: "Cuotas", metodo: "Financiera", clase: "PIF", nota: "Cuotas con financiera: WaySuccess recibe el total" },
  { plan: "Cuotas", metodo: null, clase: "Sin clasificar", nota: "Cuotas sin método" },
];
// Respaldo con la columna "Modalidad pago" del Tracker (texto libre)
export function pifPorModalidad(m: string | null | undefined): ClasePif {
  const t = norm(m);
  if (!t) return "Sin clasificar";
  if (/mensual|mes a mes|suscrip|mrr/.test(t)) return "No PIF";
  if (/contado|unico|financiad|financiera/.test(t)) return "PIF";
  return "Sin clasificar";
}

// ───────────────────────── Tipos de los datos crudos ─────────────────────────
export type Producto = "DFY" | "JessiK" | "Sin definir";
export interface Llamada { id: string; persona: string; contact_id: string | null; fecha: string; inicio: string | null; status: string; closer: string | null; producto: Producto; asistio: boolean; calificada: boolean; oferta: boolean; fuente: string | null; tier: string | null; en_vivo: boolean }
export interface Opp {
  id: string; persona: string; contact_id: string | null; nombre: string | null; telefono: string | null; email: string | null;
  etapa: string; status: string; valor: number; producto: Producto; closer: string | null; setter: string | null; calificacion: string | null;
  oferta: boolean | null; asistio: boolean | null; primera_llamada: string | null; fecha_cierre: string | null; cobrado: number;
  motivo: string | null; proximo_seguimiento: string | null; plan_pago: string | null; metodo_cobro: string | null; saldo_pendiente: number | null;
  de_ads: boolean; creada: string | null; contacto_creado: string | null; cambio_etapa: string | null; fuente: string | null; tier: string | null; historico: boolean;
}
export interface Agenda { key: string; persona: string; contact_id: string | null; fecha: string; producto: Producto; fuente: string | null; closer: string | null; tier: string | null }
export interface TrackerLlamada {
  fila: number; persona: string; fecha: string | null; nombre: string; email: string | null; industria: string | null; facturacion: string | null; mes: string | null;
  ingreso: string | null; closer: string | null; setter: string | null; pais: string | null; estado: string | null; origen: string | null; producto: string | null;
  campana: string | null; tier: string | null; estado_llamada: string | null; asistencia_calificada: string | null; oferta: string | null; resultado: string | null;
  bono: string | null; modalidad: string | null; vendido: number | string | null; cobrado: number | string | null; periodo: string | null;
  fecha_primer_pago: string | null; ciclo_asistencia: string | null; objeciones: string[];
  numero?: string | null; cal_agenda?: string | null; notas?: string | null; cobranzas?: string | number | null;
}
// Hoja "Cierres — Clientes" del Tracker: una fila = un cierre (bloque FECHA…FILA)
export interface CierreTracker {
  fila: number; fecha: string | null; tipo: string | null; cliente: string; email: string | null; telefono: string | null; closer: string | null;
  producto: string | null; fuente: string | null; vendido: number | string | null; cobrado: number | string | null; fecha_original: string | null;
  modalidad: string | null; pais: string | null; notas: string | null; fila_llamadas: string | null;
}
export interface GeoValidada { fila_llamadas: string; pais: string | null; estado: string | null; ciudad: string | null }
export interface Cobro {
  fila: number; fecha: string | null; fecha_raw: string | null; cliente: string | null; email: string | null; fila_llamadas: string | null; closer: string | null;
  fuente: string | null; producto: string | null; tipo: string | null; cobrado: number | null; vendido_nuevo: number | null; observacion: string | null;
  cobrado_al_cierre: number | null; vendido_original: number | null; cobrado_acumulado: number | null; excedente: number | null; tier: string | null; industria: string | null;
}
export interface DashDatos {
  generado: string; desde: string; rol: string | null; closer_fijo: string | null; sync: Record<string, string>;
  equipo: { nombre: string; rol: string; activo: boolean; comision_dfy: number | null; comision_jessik: number | null }[];
  llamadas: Llamada[]; opps: Opp[]; agendas: Agenda[];
  tracker: { llamadas: TrackerLlamada[]; cobros: Cobro[]; cierres?: CierreTracker[]; geo?: GeoValidada[]; proyecciones: Record<string, Record<string, string | number>> | null; sincronizado: string | null };
}

// ───────────────────────── Normalización ─────────────────────────
export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const num0 = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return isFinite(n) ? n : 0; };
export const numOrNull = (v: unknown) => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : Number(v); return isFinite(n) ? n : null; };
export function closerNorm(c: string | null | undefined): string | null {
  const t = norm(c);
  if (!t) return null;
  if (["milesi", "mileses", "mileces"].includes(t)) return "Mileces";
  if (["alessandro", "ale"].includes(t)) return "Ale";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function productoTracker(p: string | null | undefined): Producto {
  const t = norm(p);
  if (t === "30k" || t.startsWith("dfy")) return "DFY";
  if (t.startsWith("jessik")) return "JessiK";
  return "Sin definir";
}
export function fuenteNorm(f: string | null | undefined): string | null {
  const t = norm(f);
  if (!t) return null;
  if (t.startsWith("ads") || t === "meta") return "Ads";
  if (t.startsWith("org")) return "Orgánico";
  if (t.startsWith("refer")) return "Referidos";
  if (t.startsWith("afil")) return "Afiliados";
  return f!.trim();
}
// Industrias con mayúsculas, espacios y variantes unificadas (regla 5). Mapa de normalización: patrón → nombre único.
// El orden importa (Desarrollador Real Estate antes que Real Estate). Lo que no entra en ningún patrón queda con mayúscula inicial.
export const MAPA_INDUSTRIAS: [RegExp, string][] = [
  [/desarrollador/, "Desarrollador Real Estate"],
  [/real\s*st?ate|realtor/, "Real Estate / Realtor"],
  [/agencia.*marketing/, "Agencia de marketing"],
  [/coach|mentor|consultor/, "Coach / Mentor / Consultor"],
  [/migraci|inmigraci/, "Inmigración"],
];
export function industriaNorm(i: string | null | undefined): string | null {
  const t = norm(i);
  if (!t || t === "-" || t === "sin industria") return null;
  for (const [re, nombre] of MAPA_INDUSTRIAS) if (re.test(t)) return nombre;
  const s = i!.replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
const OBJ_ETIQUETA: Record<string, string> = { "no tomo decisiones en calietne": "No tomo decisiones en caliente", "confianza en el vehiculo": "Confianza en el vehículo", "querer hacerlo despues": "Querer hacerlo después", "confianza en closer": "Confianza en el closer" };
export const objecionEtiqueta = (o: string) => OBJ_ETIQUETA[norm(o)] ?? o.trim().replace(/^./, (c) => c.toUpperCase());

// ───────────────────────── Fechas ─────────────────────────
export const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const diasEntre = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86400000);
export const sumarDias = (d: string, n: number) => new Date(ms(d) + n * 86400000).toISOString().slice(0, 10);
export const enRango = (d: string | null | undefined, from: string, to: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
export function periodoAnterior(from: string, to: string): [string, string] | null {
  const largo = diasEntre(from, to) + 1;
  const f = sumarDias(from, -largo), t = sumarDias(from, -1);
  return f < FECHA_INICIO_DATOS ? null : [f, t]; // regla 7: sin comparación contra datos viejos
}
// Semanas lunes→domingo recortadas al período
export function semanas(from: string, to: string): { ini: string; fin: string; label: string }[] {
  const out: { ini: string; fin: string; label: string }[] = [];
  let d = from;
  while (d <= to) {
    const dow = (new Date(ms(d)).getUTCDay() + 6) % 7; // 0 = lunes
    const fin0 = sumarDias(d, 6 - dow);
    const fin = fin0 > to ? to : fin0;
    out.push({ ini: d, fin, label: `${+d.slice(8, 10)}/${+d.slice(5, 7)}` });
    d = sumarDias(fin, 1);
  }
  return out;
}

// ───────────────────────── Filtros globales ─────────────────────────
export interface Filtros { producto: "Todos" | "DFY" | "JessiK"; closer: string; tier: string; fuente: string }
export const FILTROS_VACIOS: Filtros = { producto: "Todos", closer: "Todos", tier: "Todos", fuente: "Todas" };
type ConDims = { producto?: Producto | string | null; closer?: string | null; tier?: string | null; fuente?: string | null };
export function pasa(r: ConDims, f: Filtros, sin: Partial<Record<keyof Filtros, true>> = {}) {
  if (!sin.producto && f.producto !== "Todos" && r.producto !== f.producto) return false;
  if (!sin.closer && f.closer !== "Todos" && r.closer !== f.closer) return false;
  if (!sin.tier && f.tier !== "Todos" && (r.tier ?? "") !== f.tier) return false;
  if (!sin.fuente && f.fuente !== "Todas" && (r.fuente ?? "") !== f.fuente) return false;
  return true;
}
export const dimsTracker = (t: TrackerLlamada) => ({ producto: productoTracker(t.producto), closer: closerNorm(t.closer), tier: t.tier || null, fuente: fuenteNorm(t.origen) });
export const dimsCobro = (c: Cobro) => ({ producto: productoTracker(c.producto), closer: closerNorm(c.closer), tier: c.tier || null, fuente: fuenteNorm(c.fuente) });

// ───────────────────────── Base: un lead cuenta UNA vez, con su PRIMERA llamada ─────────────────────────
export interface Lead { persona: string; primeraLlamada: string | null; primeraAsistencia: string | null; asistCalificada: boolean; primeraOferta: string | null; producto: Producto; closer: string | null; fuente: string | null; tier: string | null }
const valida = (l: Llamada) => !["cancelled", "invalid"].includes(l.status);
export function leads(d: DashDatos): Map<string, Lead> {
  const m = new Map<string, Lead>();
  const orden = [...d.llamadas].filter(valida).sort((a, b) => (a.inicio ?? a.fecha).localeCompare(b.inicio ?? b.fecha));
  for (const l of orden) {
    let x = m.get(l.persona);
    if (!x) { x = { persona: l.persona, primeraLlamada: l.fecha, primeraAsistencia: null, asistCalificada: false, primeraOferta: null, producto: l.producto, closer: l.closer, fuente: l.fuente, tier: l.tier }; m.set(l.persona, x); }
    if (l.asistio && !x.primeraAsistencia) { x.primeraAsistencia = l.fecha; x.closer = l.closer ?? x.closer; x.producto = l.producto; }
    if (l.asistio && l.calificada) x.asistCalificada = true;
    if (l.oferta && !x.primeraOferta) x.primeraOferta = l.fecha;
  }
  return m;
}
// Primera agenda por persona (una agenda por lead)
function primerasAgendas(d: DashDatos) {
  const m = new Map<string, Agenda>();
  for (const a of [...d.agendas].sort((x, y) => x.fecha.localeCompare(y.fecha))) if (!m.has(a.persona)) m.set(a.persona, a);
  return [...m.values()];
}

// Cobrado mayor que vendido = alerta, no dato válido (regla 4). MRR (vendido 0) no cuenta como alerta.
export const cobradoInvalido = (o: Opp) => o.valor > 0 && o.cobrado > o.valor;
export const cobradoValido = (o: Opp) => (cobradoInvalido(o) ? 0 : num0(o.cobrado));
export const ganadas = (d: DashDatos) => d.opps.filter((o) => o.status === "won" && o.fecha_cierre && o.fecha_cierre >= FECHA_INICIO_DATOS);
export const esCierreSeguimiento = (o: Opp) => !!o.primera_llamada && !!o.fecha_cierre && o.primera_llamada.slice(0, 7) < o.fecha_cierre.slice(0, 7);
export const comisionDe = (d: DashDatos, o: Opp) => {
  const t = d.equipo.find((e) => e.nombre === o.closer);
  if (!t || t.rol !== "closer") return 0; // dueño (Ale) sin comisión
  return cobradoValido(o) * COMISION;
};
export const cobrosSeguimiento = (d: DashDatos, f: Filtros, from: string, to: string, sin: Partial<Record<keyof Filtros, true>> = {}) =>
  d.tracker.cobros.filter((c) => enRango(c.fecha, from, to) && c.fecha! >= FECHA_INICIO_DATOS && pasa(dimsCobro(c), f, sin));

// ───────────────────────── Bloque comercial (16 métricas, orden del Tracker) + cobranza ─────────────────────────
export interface Bloque {
  agendas: number; asistencias: number; asistencias_calificadas: number; ofertas: number; llamadas: number;
  cierres: number; cierres_seguimiento: number; cierres_totales: number; clientes_nuevos: number;
  vendido: number; cobrado: number; cobrado_seguimiento: number; cobrado_total: number; comisiones: number;
}
export function bloque(d: DashDatos, f: Filtros, from: string, to: string, sin: Partial<Record<keyof Filtros, true>> = {}, L = leads(d)): Bloque {
  from = from < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : from;
  const ag = primerasAgendas(d).filter((a) => enRango(a.fecha, from, to) && pasa(a, f, sin));
  const ls = [...L.values()].filter((l) => pasa(l, f, sin));
  const won = ganadas(d).filter((o) => enRango(o.fecha_cierre, from, to) && pasa(o, f, sin));
  const seg = won.filter(esCierreSeguimiento);
  const cobrado = won.reduce((t, o) => t + cobradoValido(o), 0);
  const cobSeg = cobrosSeguimiento(d, f, from, to, sin).reduce((t, c) => t + num0(c.cobrado), 0);
  return {
    agendas: ag.length,
    llamadas: ls.filter((l) => enRango(l.primeraLlamada, from, to)).length,
    asistencias: ls.filter((l) => enRango(l.primeraAsistencia, from, to)).length,
    asistencias_calificadas: ls.filter((l) => l.asistCalificada && enRango(l.primeraAsistencia, from, to)).length,
    ofertas: ls.filter((l) => enRango(l.primeraOferta, from, to)).length,
    cierres: won.length - seg.length,
    cierres_seguimiento: seg.length,
    cierres_totales: won.length,
    clientes_nuevos: new Set(won.map((o) => o.persona)).size,
    vendido: won.reduce((t, o) => t + num0(o.valor), 0),
    cobrado,
    cobrado_seguimiento: cobSeg,
    cobrado_total: cobrado + cobSeg,
    comisiones: won.reduce((t, o) => t + comisionDe(d, o), 0) + (COMISION_INCLUYE_SEGUIMIENTO ? cobSeg * COMISION : 0),
  };
}
export const tasa = (a: number, b: number) => (b > 0 ? a / b : null);
export const derivadas = (b: Bloque) => ({
  pct_asistencia: tasa(b.asistencias, b.agendas),
  pct_asist_calificadas: tasa(b.asistencias_calificadas, b.asistencias),
  pct_ofertas: tasa(b.ofertas, b.asistencias),
  pct_cierre: tasa(b.cierres_totales, b.asistencias),
  ticket: tasa(b.cobrado, b.cierres_totales),
  pct_recoleccion: tasa(b.cobrado, b.vendido),
});

// Filas de la "Vista empresa" — nombres y orden de la hoja "Dashboard " del Tracker (sección 2b)
export type Kind = "n" | "p" | "m";
export const FILAS_RESUMEN: { label: string; kind: Kind; get: (b: Bloque) => number | null }[] = [
  { label: "Agendas", kind: "n", get: (b) => b.agendas },
  { label: "Asistencias", kind: "n", get: (b) => b.asistencias },
  { label: "% Asistencia", kind: "p", get: (b) => tasa(b.asistencias, b.agendas) },
  { label: "Asistencias calificadas", kind: "n", get: (b) => b.asistencias_calificadas },
  { label: "% Asistencias calificadas", kind: "p", get: (b) => tasa(b.asistencias_calificadas, b.asistencias) },
  { label: "Ofertas", kind: "n", get: (b) => b.ofertas },
  { label: "% Ofertas", kind: "p", get: (b) => tasa(b.ofertas, b.asistencias) },
  { label: "Cierres", kind: "n", get: (b) => b.cierres },
  { label: "Cierres en seguimiento", kind: "n", get: (b) => b.cierres_seguimiento },
  { label: "Cierres totales", kind: "n", get: (b) => b.cierres_totales },
  { label: "Clientes nuevos", kind: "n", get: (b) => b.clientes_nuevos },
  { label: "% Cierre", kind: "p", get: (b) => tasa(b.cierres_totales, b.asistencias) },
  { label: "Vendido", kind: "m", get: (b) => b.vendido },
  { label: "Cobrado", kind: "m", get: (b) => b.cobrado },
  { label: "Cobrado en seguimiento", kind: "m", get: (b) => b.cobrado_seguimiento },
  { label: "Cobrado total", kind: "m", get: (b) => b.cobrado_total },
  { label: "Ticket promedio", kind: "m", get: (b) => tasa(b.cobrado, b.cierres_totales) },
  { label: "Comisiones", kind: "m", get: (b) => b.comisiones },
];
export const FUENTES = ["Ads", "Orgánico", "Referidos", "Afiliados"] as const;

export function variacion(kind: Kind, a: number | null, b: number | null): { txt: string; cls: string } {
  if (a == null || b == null) return { txt: "—", cls: "" };
  if (kind === "p") {
    const dd = (a - b) * 100;
    if (Math.abs(dd) < 0.5) return { txt: "=", cls: "" };
    return { txt: `${dd > 0 ? "▲" : "▼"} ${Math.abs(dd).toFixed(0)} pp`, cls: dd > 0 ? "up" : "down" };
  }
  if (!b) return { txt: a ? "nuevo" : "—", cls: a ? "up" : "" };
  const dd = (a - b) / b;
  if (Math.abs(dd) < 0.005) return { txt: "=", cls: "" };
  return { txt: `${dd > 0 ? "▲" : "▼"} ${Math.abs(dd * 100).toFixed(0)}%`, cls: dd > 0 ? "up" : "down" };
}

// ───────────────────────── Opciones de filtros (salen de los datos, no a mano) ─────────────────────────
export function opcionesFiltros(d: DashDatos) {
  const closers = new Set<string>();
  for (const l of d.llamadas) if (l.closer && l.fecha >= FECHA_INICIO_DATOS) closers.add(l.closer);
  for (const o of ganadas(d)) if (o.closer) closers.add(o.closer);
  const orden = ["Luca", "Jenny", "Mileces", "Ale"];
  const lista = [...closers].filter((c) => d.equipo.some((e) => e.nombre === c && e.activo) || orden.includes(c))
    .sort((a, b) => (orden.indexOf(a) + 1 || 99) - (orden.indexOf(b) + 1 || 99));
  return { closers: lista, tiers: ["S", "A", "B", "C"], fuentes: [...FUENTES] };
}

// ───────────────────────── Equipo · Closers ─────────────────────────
export function metasCloser(d: DashDatos): Record<string, { cierres: number; agendas: number; asistencias: number; ofertas: number }> {
  const p = d.tracker.proyecciones;
  const out: Record<string, { cierres: number; agendas: number; asistencias: number; ofertas: number }> = {};
  if (!p) return out;
  for (let f = 36; f <= 45; f++) {
    const r = p[String(f)];
    if (!r?.B || norm(r.B) === "general") continue;
    const n = closerNorm(String(r.B));
    if (n) out[n] = { cierres: num0(r.D), agendas: num0(r.G), asistencias: num0(r.J), ofertas: num0(r.M) };
  }
  return out;
}
const diasMes = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
// Prorratea una meta MENSUAL al período elegido (misma regla que Proyecciones: meta × días / días del mes)
export function prorratear(from: string, to: string, metaMes: (ym: string) => number) {
  let t = 0, d = from;
  while (d <= to) { const ym = d.slice(0, 7); t += metaMes(ym) / diasMes(ym); d = sumarDias(d, 1); }
  return t;
}
export function closers(d: DashDatos, f: Filtros, from: string, to: string) {
  const L = leads(d);
  const metas = metasCloser(d);
  const abiertos = d.opps.filter((o) => o.status === "open" && (ETAPAS_SEGUIMIENTO as readonly string[]).includes(o.etapa));
  return opcionesFiltros(d).closers
    .filter((c) => f.closer === "Todos" || c === f.closer)
    .map((c) => {
      const b = bloque(d, { ...f, closer: c }, from, to, {}, L);
      const meta = metas[c] ? prorratear(from, to, () => metas[c].cierres) : null;
      return { closer: c, ...b, comision_txt: `${(COMISION * 100).toFixed(0)}%`, meta_cierres: meta, pct_meta: meta ? b.cierres_totales / meta : null,
        seguimientos_abiertos: abiertos.filter((o) => o.closer === c && pasa(o, f, { closer: true })).length };
    })
    .filter((r) => r.llamadas + r.asistencias + r.cierres_totales + r.seguimientos_abiertos > 0);
}

// ───────────────────────── Seguimientos ─────────────────────────
export interface FilaSeg { id: string; contact_id: string | null; nombre: string | null; telefono: string | null; closer: string | null; producto: Producto; tier: string | null; etapa: string; motivo: string | null; fecha_llamada: string | null; proximo: string | null; dias_en_etapa: number | null; estado: "vencido" | "sin fecha" | "hoy" | "ok"; persona: string }
export function seguimientos(d: DashDatos, f: Filtros): FilaSeg[] {
  const hoy = hoyISO();
  const rango = (e: string) => ["P5 - Compra este mes", "P3 - Interés pero no puede ahora", "P1 - No tiene interés en este momento"].indexOf(e);
  const filas = d.opps
    .filter((o) => o.status === "open" && (ETAPAS_SEGUIMIENTO as readonly string[]).includes(o.etapa) && pasa(o, f))
    .map((o): FilaSeg => {
      const p = o.proximo_seguimiento;
      return {
        id: o.id, contact_id: o.contact_id, nombre: o.nombre, telefono: o.telefono, closer: o.closer, producto: o.producto, tier: o.tier, etapa: o.etapa,
        motivo: o.motivo, fecha_llamada: o.primera_llamada, proximo: p, persona: o.persona,
        dias_en_etapa: o.cambio_etapa ? diasEntre(o.cambio_etapa.slice(0, 10), hoy) : null,
        estado: !p ? "sin fecha" : p < hoy ? "vencido" : p === hoy ? "hoy" : "ok",
      };
    });
  const grupo = (x: FilaSeg) => (x.estado === "vencido" || x.estado === "sin fecha" ? 0 : 1);
  return filas.sort((a, b) => grupo(a) - grupo(b) || (rango(a.etapa) + 1 || 9) - (rango(b.etapa) + 1 || 9) || (b.dias_en_etapa ?? 0) - (a.dias_en_etapa ?? 0));
}
// Top objeciones (fuente: Tracker U:AM) de los leads de la tabla. Cuenta LEADS con la objeción (valor ≥ 1 = 1).
export function topObjeciones(d: DashDatos, personas: Set<string>, producto: "Todos" | "DFY" | "JessiK") {
  const filas = d.tracker.llamadas.filter((t) => personas.has(t.persona) && norm(t.resultado) !== "vendido" && (producto === "Todos" || productoTracker(t.producto) === producto));
  const porLead = new Map<string, Set<string>>();
  for (const t of filas) { const s = porLead.get(t.persona) ?? new Set(); t.objeciones.forEach((o) => s.add(objecionEtiqueta(o))); porLead.set(t.persona, s); }
  const conteo = new Map<string, number>();
  porLead.forEach((s) => s.forEach((o) => conteo.set(o, (conteo.get(o) ?? 0) + 1)));
  const total = porLead.size;
  return { total, top: [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([objecion, n]) => ({ objecion, n, pct: total ? n / total : 0 })) };
}

// ───────────────────────── Tendencias ─────────────────────────
export function semanal(d: DashDatos, f: Filtros, from: string, to: string) {
  from = from < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : from;
  const L = leads(d);
  const totalAg = bloque(d, f, from, to, {}, L).agendas;
  return semanas(from, to).map((s, i) => {
    const b = bloque(d, f, s.ini, s.fin, {}, L);
    const agTot = d.agendas.filter((a) => enRango(a.fecha, s.ini, s.fin) && pasa(a, f)).length;
    return { n: i + 1, ...s, ...b, ...derivadas(b), pct_agendas_calificadas: tasa(b.agendas, agTot), participacion: tasa(b.agendas, totalAg), pct_cierres_seguimiento: tasa(b.cierres_seguimiento, b.cierres_totales) };
  });
}
export function agendasPor(d: DashDatos, f: Filtros, from: string, to: string, dim: "closer" | "fuente" | "producto" | "industria") {
  const ag = primerasAgendas(d).filter((a) => enRango(a.fecha, from, to) && pasa(a, f));
  const ind = new Map(d.tracker.llamadas.map((t) => [t.persona, industriaNorm(t.industria)]));
  const m = new Map<string, number>();
  for (const a of ag) {
    const k = dim === "industria" ? ind.get(a.persona) ?? "Sin dato" : (a[dim] as string | null) ?? "Sin dato";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return topN([...m.entries()].map(([k, n]) => ({ k, n })), 8);
}
function topN(rows: { k: string; n: number }[], n: number) {
  const s = rows.sort((a, b) => b.n - a.n);
  if (s.length <= n) return s;
  const otras = s.slice(n).reduce((t, r) => t + r.n, 0);
  return [...s.slice(0, n), { k: "Otras", n: otras }];
}
// Desglose por industria y país (Tracker, por fecha de llamada)
export function desglose(d: DashDatos, f: Filtros, from: string, to: string, dim: "industria" | "pais") {
  const rows = d.tracker.llamadas.filter((t) => enRango(t.fecha, from, to) && pasa(dimsTracker(t), f));
  const m = new Map<string, { llamadas: number; vendidos: number }>();
  for (const t of rows) {
    const k = (dim === "industria" ? industriaNorm(t.industria) : t.pais?.trim()) || "Sin dato";
    const x = m.get(k) ?? { llamadas: 0, vendidos: 0 };
    x.llamadas++; if (norm(t.resultado) === "vendido") x.vendidos++;
    m.set(k, x);
  }
  const s = [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.llamadas - a.llamadas);
  if (s.length <= 8) return s;
  const o = s.slice(8).reduce((t, r) => ({ llamadas: t.llamadas + r.llamadas, vendidos: t.vendidos + r.vendidos }), { llamadas: 0, vendidos: 0 });
  return [...s.slice(0, 8), { k: "Otras", ...o }];
}

// ───────────────────────── Metas (Proyecciones) ─────────────────────────
const pctTxt = (v: unknown) => { const n = numOrNull(String(v ?? "").replace("%", "").replace(",", ".")); return n == null ? null : n / 100; };
const montoTxt = (v: unknown) => numOrNull(String(v ?? "").replace(/[^\d,-]/g, "").replace(",", "."));
const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function planMensual(d: DashDatos) {
  const p = d.tracker.proyecciones;
  if (!p) return [];
  const out: { ym: string; mes: string; ads: number; organico: number; referidos: number; afiliados: number; comercial: number; fase: string; gates: string; meta_siguiente: number; agendas: number; asistencias: number; agendas_ads: number; asistencias_ads: number }[] = [];
  for (let f = 2; f <= 30; f++) {
    const r = p[String(f)];
    const t = norm(r?.T);
    const m = t.match(/^([a-z]+) (\d{4})$/);
    if (!m || !MESES_ES.includes(m[1])) continue;
    const ym = `${m[2]}-${String(MESES_ES.indexOf(m[1]) + 1).padStart(2, "0")}`;
    if (ym < FECHA_INICIO_DATOS.slice(0, 7)) continue; // el plan empieza en octubre 2026
    out.push({
      ym, mes: String(r.T), ads: num0(r.U), organico: num0(r.V), referidos: num0(r.W), afiliados: num0(r.X), comercial: num0(r.Y), fase: String(r.Z ?? ""),
      gates: `cierre ${r.AA ?? "—"} · margen ${r.AB ?? "—"} · recolección ${r.AC ?? "—"} · clientes ${r.AD ?? "—"}`, meta_siguiente: num0(r.AE),
      agendas: num0(r.AF) + num0(r.AG) + num0(r.AH) + num0(r.AI), asistencias: num0(r.AJ) + num0(r.AK) + num0(r.AL) + num0(r.AM),
      agendas_ads: num0(r.AF), asistencias_ads: num0(r.AJ),
    });
  }
  return out;
}
// Tasas objetivo de Proyecciones (columna G): constantes del plan
export function objetivos(d: DashDatos) {
  const p = d.tracker.proyecciones ?? {};
  const fila = (nombre: string) => Object.values(p).find((r) => norm(r.B) === norm(nombre));
  return {
    pct_asistencia: pctTxt(fila("% Asistencia")?.G) ?? 0.7,
    pct_cierre: pctTxt(fila("% Cierre directo")?.G) ?? 0.15,
    pct_recoleccion: pctTxt(fila("% Recolección")?.G) ?? 0.5,
    ticket: montoTxt(fila("Ticket Promedio")?.G) ?? 30000,
    pct_oferta: pctTxt(fila("% TASA DE OFERTA")?.G) ?? 1,
  };
}
export function metas(d: DashDatos, f: Filtros, from: string, to: string) {
  from = from < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : from;
  const plan = planMensual(d);
  const obj = objetivos(d);
  const mes = (ym: string) => plan.find((x) => x.ym === ym);
  const soloAds = f.fuente === "Ads";
  const cierresMeta = prorratear(from, to, (ym) => (soloAds ? mes(ym)?.ads : mes(ym)?.comercial) ?? 0);
  const agendasMeta = prorratear(from, to, (ym) => (soloAds ? mes(ym)?.agendas_ads : mes(ym)?.agendas) ?? 0);
  const asistMeta = prorratear(from, to, (ym) => (soloAds ? mes(ym)?.asistencias_ads : mes(ym)?.asistencias) ?? 0);
  const b = bloque(d, f, from, to);
  const der = derivadas(b);
  const vendidoMeta = cierresMeta * obj.ticket;
  const cobradoMeta = vendidoMeta * obj.pct_recoleccion;
  const filas: { label: string; kind: Kind; actual: number | null; meta: number | null }[] = [
    { label: "Agendas", kind: "n", actual: b.agendas, meta: agendasMeta },
    { label: "% Asistencia", kind: "p", actual: der.pct_asistencia, meta: obj.pct_asistencia },
    { label: "Asistencias", kind: "n", actual: b.asistencias, meta: asistMeta },
    { label: "% Cierre", kind: "p", actual: der.pct_cierre, meta: obj.pct_cierre },
    { label: "Cierres totales", kind: "n", actual: b.cierres_totales, meta: cierresMeta },
    { label: "Vendido", kind: "m", actual: b.vendido, meta: vendidoMeta },
    { label: "Cobrado", kind: "m", actual: b.cobrado, meta: cobradoMeta },
    { label: "Cobrado en seguimiento", kind: "m", actual: b.cobrado_seguimiento, meta: null },
    { label: "Cobrado total", kind: "m", actual: b.cobrado_total, meta: cobradoMeta },
    { label: "% Recolección", kind: "p", actual: der.pct_recoleccion, meta: obj.pct_recoleccion },
    { label: "Ticket promedio", kind: "m", actual: der.ticket, meta: obj.ticket },
    { label: "Comisiones", kind: "m", actual: b.comisiones, meta: cobradoMeta * COMISION },
    { label: "Ofertas", kind: "n", actual: b.ofertas, meta: asistMeta * obj.pct_oferta },
    { label: "% Ofertas", kind: "p", actual: der.pct_ofertas, meta: obj.pct_oferta },
  ];
  // Encabezado: días transcurridos y alineación de los cierres contra lo proyectado a la fecha [A CONFIRMAR fórmula]
  const hoy = hoyISO();
  const total = diasEntre(from, to) + 1;
  const pasados = Math.max(0, Math.min(total, diasEntre(from, hoy < to ? hoy : to) + 1));
  const metaAlDia = prorratear(from, hoy < to ? hoy : to, (ym) => (soloAds ? mes(ym)?.ads : mes(ym)?.comercial) ?? 0);
  const alineacion = metaAlDia > 0 ? b.cierres_totales / metaAlDia : null;
  const estado = alineacion == null ? "Sin meta" : alineacion >= 1 ? "En ruta" : alineacion >= 0.7 ? "En riesgo" : "Fuera de ruta";
  return { filas, pasados, total, alineacion, estado, plan, metasCloser: metasCloser(d) };
}

// ───────────────────────── Cobranza ─────────────────────────
export function cobranza(d: DashDatos, f: Filtros, from: string, to: string) {
  from = from < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : from;
  const b = bloque(d, f, from, to);
  const clientesTodos = ganadas(d).filter((o) => pasa(o, f));
  const porCobrarTotal = clientesTodos.reduce((t, o) => t + Math.max(0, num0(o.valor) - cobradoValido(o)), 0);
  const ant = periodoAnterior(from, to);
  const bAnt = ant ? bloque(d, f, ant[0], ant[1]) : null;
  const semanalCob = semanas(from, to).map((s) => {
    const x = bloque(d, f, s.ini, s.fin);
    return { label: s.label, cobrado: x.cobrado, seguimiento: x.cobrado_seguimiento };
  });
  const porCliente = clientesTodos.map((o) => ({ id: o.id, nombre: o.nombre ?? "—", saldo: Math.max(0, num0(o.valor) - cobradoValido(o)) }))
    .filter((x) => x.saldo > 0).sort((a, b2) => b2.saldo - a.saldo);
  const pagos = cobrosSeguimiento(d, f, FECHA_INICIO_DATOS, "2999-12-31").filter((c) => enRango(c.fecha, from, to)).map((c) => {
    const vend = num0(c.vendido_original), acum = num0(c.cobrado_acumulado);
    return { ...c, saldo: vend ? vend - acum : null, alerta: num0(c.excedente) > 0 || /fecha estimada/i.test(c.observacion ?? "") };
  }).sort((a, b2) => (b2.fecha ?? "").localeCompare(a.fecha ?? ""));
  const clientes = clientesTodos.filter((o) => enRango(o.fecha_cierre, from, to)).map((o) => ({
    ...o, cobrado_ok: cobradoValido(o), por_cobrar: Math.max(0, num0(o.valor) - cobradoValido(o)), tipo: esCierreSeguimiento(o) ? "Seguimiento" : "Nuevo",
    pagos: d.tracker.cobros.filter((c) => c.email && o.email && norm(c.email) === norm(o.email)),
    dias_a_cierre: o.primera_llamada && o.fecha_cierre ? diasEntre(o.primera_llamada, o.fecha_cierre) : null,
  })).sort((a, b2) => (b2.fecha_cierre ?? "").localeCompare(a.fecha_cierre ?? ""));
  // MRR = cobrado mensual de clientes mes a mes (vendido 0); ARR = MRR × 12
  const mrr = clientesTodos.filter((o) => num0(o.valor) === 0 && num0(o.cobrado) > 0).reduce((t, o) => t + num0(o.cobrado), 0);
  const porMes = new Map<string, { nuevos: number; seguimiento: number }>();
  for (const o of clientesTodos) { const k = o.fecha_cierre!.slice(0, 7); const x = porMes.get(k) ?? { nuevos: 0, seguimiento: 0 }; esCierreSeguimiento(o) ? x.seguimiento++ : x.nuevos++; porMes.set(k, x); }
  return {
    b, bAnt, porCobrarTotal, semanal: semanalCob, porCliente, pagos, clientes, mrr, arr: mrr * 12,
    cierresPorMes: [...porMes.entries()].sort().map(([k, v]) => ({ mes: k, ...v })),
  };
}

// ───────────────────────── Ciclo de venta (T0→T4) ─────────────────────────
export interface CicloLead { id: string; nombre: string | null; producto: Producto; closer: string | null; t0: string | null; t1: string | null; t2: string | null; t3: string | null; t4: string | null; tramos: (number | null)[]; total: number | null; desdeAgenda: boolean }
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };
const p75 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * 0.75; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export const TRAMOS = ["Anuncio → agenda", "Agenda → asistencia", "Asistencia → oferta", "Oferta → cierre"] as const;
export function ciclo(d: DashDatos, f: Filtros, from: string, to: string) {
  from = from < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : from;
  const L = leads(d);
  const agPrimera = new Map<string, string>();
  for (const a of [...d.agendas].sort((x, y) => x.fecha.localeCompare(y.fecha))) if (!agPrimera.has(a.persona)) agPrimera.set(a.persona, a.fecha);
  // Un lead = una oportunidad del pipeline de Venta (la más avanzada si hay varias)
  const porPersona = new Map<string, Opp>();
  for (const o of d.opps) { const x = porPersona.get(o.persona); if (!x || (o.status === "won" && x.status !== "won")) porPersona.set(o.persona, o); }
  let invalidos = 0;
  const invalidosLista: { nombre: string | null; closer: string | null }[] = [];
  const filas: CicloLead[] = [];
  for (const o of porPersona.values()) {
    if (!pasa(o, f)) continue;
    const l = L.get(o.persona);
    const t0 = o.de_ads && o.contacto_creado ? o.contacto_creado.slice(0, 10) : null; // [A CONFIRMAR] primer clic que creó el contacto
    const t1 = agPrimera.get(o.persona) ?? null;
    const t2 = l?.primeraAsistencia ?? null, t3 = l?.primeraOferta ?? null;
    const t4 = o.status === "won" ? o.fecha_cierre : null;
    const hitos = [t0, t1, t2, t3, t4];
    const tramos: (number | null)[] = [];
    let mal = false;
    for (let i = 0; i < 4; i++) {
      const a = hitos[i], b = hitos[i + 1];
      if (!a || !b) { tramos.push(null); continue; }
      const dd = diasEntre(a, b);
      if (dd < 0) { mal = true; tramos.push(null); } else tramos.push(dd);
    }
    if (mal) { invalidos++; invalidosLista.push({ nombre: o.nombre, closer: o.closer }); }
    const ini = t0 ?? t1;
    const total = ini && t4 && diasEntre(ini, t4) >= 0 ? diasEntre(ini, t4) : null;
    const fin = t4 ?? t3 ?? t2 ?? t1;
    if (!fin || !enRango(fin, from, to)) continue;
    filas.push({ id: o.id, nombre: o.nombre, producto: o.producto, closer: o.closer, t0, t1, t2, t3, t4, tramos, total, desdeAgenda: !t0 });
  }
  const resumen = (xs: CicloLead[]) => ({
    tramos: TRAMOS.map((nombre, i) => { const v = xs.map((x) => x.tramos[i]).filter((n): n is number => n != null); return { nombre, mediana: median(v), p75: p75(v), n: v.length }; }),
    total: (() => { const v = xs.map((x) => x.total).filter((n): n is number => n != null); return { mediana: median(v), p75: p75(v), n: v.length }; })(),
  });
  return { filas, invalidos, invalidosLista, todos: resumen(filas), dfy: resumen(filas.filter((x) => x.producto === "DFY")), jessik: resumen(filas.filter((x) => x.producto === "JessiK")) };
}

// ───────────────────────── PIF ─────────────────────────
export function clasePif(d: DashDatos, o: Opp): { clase: ClasePif; fuente: string } {
  if (o.producto !== "JessiK") return { clase: "No PIF", fuente: "DFY" };
  if (num0(o.valor) === 0 && num0(o.cobrado) > 0) return { clase: "No PIF", fuente: "Mes a mes (MRR)" };
  const regla = MAPEO_PIF.find((m) => norm(m.plan) === norm(o.plan_pago) && (m.metodo == null || norm(m.metodo) === norm(o.metodo_cobro)))
    ?? MAPEO_PIF.find((m) => norm(m.plan) === norm(o.plan_pago) && m.metodo == null);
  if (regla && o.plan_pago) return { clase: regla.clase, fuente: `${o.plan_pago}${o.metodo_cobro ? " " + o.metodo_cobro : ""}` };
  const t = d.tracker.llamadas.find((x) => x.persona === o.persona && norm(x.resultado) === "vendido");
  if (t?.modalidad) return { clase: pifPorModalidad(t.modalidad), fuente: `Tracker: ${t.modalidad}` };
  return { clase: "Sin clasificar", fuente: "Sin dato" };
}
export function pif(d: DashDatos, f: Filtros, from: string, to: string) {
  from = from < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : from;
  const won = ganadas(d).filter((o) => enRango(o.fecha_cierre, from, to) && pasa(o, f));
  const jk = won.filter((o) => o.producto === "JessiK").map((o) => ({ ...o, ...clasePif(d, o) }));
  const pifs = jk.filter((x) => x.clase === "PIF").length;
  const b = bloque(d, f, from, to);
  const cada = (n: number) => (pifs > 0 ? n / pifs : null);
  return { pifs, cierres: won.length, cierresJessik: jk.length, porCierres: cada(won.length), porCierresJessik: cada(jk.length), porLeads: cada(b.agendas), porAsistencias: cada(b.asistencias), pctPif: tasa(pifs, jk.length), sinClasificar: jk.filter((x) => x.clase === "Sin clasificar"), detalle: jk };
}

// ───────────────────────── Llamada → pago (Tracker) ─────────────────────────
export type FuenteFecha = "BF" | "Cobros" | "sin fecha";
export interface CierrePago {
  fila: number; nombre: string; email: string | null; producto: Producto; closer: string | null; origen: string | null; tier: string | null; pais: string | null; estado: string | null;
  industria: string | null; facturacion: string | null; setter: string | null; campana: string | null; modalidad: string | null; oferta: string | null; bono: string | null;
  mes: string | null; ingreso: string | null; periodo: string | null; estado_llamada: string | null; asistencia_calificada: string | null; objeciones: string[];
  fecha_llamada: string | null; fecha_pago: string | null; fuente_fecha: FuenteFecha; dias: number | null; tipo: "En llamada" | "En seguimiento" | null;
  vendido: number | null; cobrado: number | null; incompleto: string | null;
}
export function cierresPago(d: DashDatos): CierrePago[] {
  const out: CierrePago[] = [];
  for (const t of d.tracker.llamadas) {
    if (norm(t.resultado) !== "vendido") continue;
    let fecha_pago: string | null = t.fecha_primer_pago || null;
    let fuente: FuenteFecha = fecha_pago ? "BF" : "sin fecha";
    if (!fecha_pago) {
      const cs = d.tracker.cobros.filter((c) => String(c.fila_llamadas ?? "").trim() === String(t.fila) && c.fecha && !(num0(c.cobrado_al_cierre) > 0));
      const min = cs.map((c) => c.fecha!).sort()[0];
      if (min) { fecha_pago = min; fuente = "Cobros"; }
    }
    // Inicio = fecha de llamada; si el Tracker corrigió la llamada asistida ("Ciclo de venta desde asistencia"), se respeta.
    let inicio = t.fecha;
    const ca = numOrNull(t.ciclo_asistencia);
    if (fecha_pago && fuente === "BF" && ca != null && ca >= 0 && inicio && diasEntre(inicio, fecha_pago) !== ca) inicio = sumarDias(fecha_pago, -ca);
    const dias = fecha_pago && inicio ? diasEntre(inicio, fecha_pago) : null;
    const corte = fecha_pago ?? t.fecha;
    if (!corte || corte < FECHA_INICIO_DATOS) continue;
    const incompleto = dias != null && dias < 0 ? "Pago anterior a la llamada" : !inicio ? "Sin fecha de llamada" : null;
    out.push({
      fila: t.fila, nombre: t.nombre, email: t.email, producto: productoTracker(t.producto), closer: closerNorm(t.closer), origen: fuenteNorm(t.origen), tier: t.tier || null,
      pais: t.pais, estado: t.estado, industria: industriaNorm(t.industria), facturacion: t.facturacion, setter: t.setter, campana: t.campana, modalidad: t.modalidad,
      oferta: t.oferta, bono: t.bono, mes: t.mes, ingreso: t.ingreso, periodo: t.periodo, estado_llamada: t.estado_llamada, asistencia_calificada: t.asistencia_calificada,
      objeciones: t.objeciones.map(objecionEtiqueta), fecha_llamada: inicio, fecha_pago, fuente_fecha: fuente, dias: incompleto ? null : dias,
      tipo: dias == null || incompleto ? null : dias === 0 ? "En llamada" : "En seguimiento",
      vendido: numOrNull(t.vendido), cobrado: numOrNull(t.cobrado), incompleto,
    });
  }
  return out;
}
// Filtros de "Más filtros": dimensión → valores elegidos (multiselección)
export const DIMS_PAGO: { key: keyof CierrePago | "objecion" | "excluir"; label: string; grupo: "Lead" | "Venta" | "Proceso" }[] = [
  { key: "industria", label: "Industria", grupo: "Lead" }, { key: "facturacion", label: "Facturación", grupo: "Lead" }, { key: "pais", label: "País", grupo: "Lead" },
  { key: "estado", label: "Estado / provincia", grupo: "Lead" }, { key: "objecion", label: "Objeción", grupo: "Lead" }, { key: "excluir", label: "Excluir lead", grupo: "Lead" },
  { key: "mes", label: "Mes", grupo: "Venta" }, { key: "ingreso", label: "Fecha de ingreso", grupo: "Venta" }, { key: "modalidad", label: "Modalidad pago", grupo: "Venta" },
  { key: "bono", label: "Bono activado", grupo: "Venta" }, { key: "periodo", label: "Periodo", grupo: "Venta" }, { key: "tipo", label: "Tipo de cierre", grupo: "Venta" },
  { key: "setter", label: "Setter origen", grupo: "Proceso" }, { key: "campana", label: "Campaña", grupo: "Proceso" }, { key: "estado_llamada", label: "Estado llamada", grupo: "Proceso" },
  { key: "asistencia_calificada", label: "Asistencia calificada", grupo: "Proceso" }, { key: "oferta", label: "Oferta hecha", grupo: "Proceso" },
];
export type FiltrosPago = Record<string, string[]>;
const valorDim = (c: CierrePago, k: string): string[] => k === "objecion" ? c.objeciones : k === "excluir" ? [c.nombre] : [String((c as unknown as Record<string, unknown>)[k] ?? "—").trim() || "—"];
export function opcionesPago(cs: CierrePago[]) {
  const o: Record<string, string[]> = {};
  for (const dm of DIMS_PAGO) { const s = new Set<string>(); cs.forEach((c) => valorDim(c, dm.key).forEach((v) => s.add(v))); o[dm.key] = [...s].sort((a, b) => a.localeCompare(b, "es")); }
  return o;
}
export function filtrarPago(cs: CierrePago[], f: Filtros, from: string, to: string, extra: FiltrosPago) {
  return cs.filter((c) => {
    const fecha = c.fecha_pago ?? c.fecha_llamada; // período por fecha de primer pago; sin fecha → fecha de llamada
    if (!enRango(fecha, from, to)) return false;
    if (!pasa({ producto: c.producto, closer: c.closer, tier: c.tier, fuente: c.origen }, f)) return false;
    for (const [k, vals] of Object.entries(extra)) {
      if (!vals.length) continue;
      const v = valorDim(c, k);
      if (k === "excluir") { if (v.some((x) => vals.includes(x))) return false; }
      else if (!v.some((x) => vals.map(norm).includes(norm(x)))) return false;
    }
    return true;
  });
}
export const BUCKETS = [["0", 0, 0], ["1-3", 1, 3], ["4-7", 4, 7], ["8-14", 8, 14], ["15-30", 15, 30], ["más de 30", 31, Infinity]] as const;
export function resumenPago(cs: CierrePago[], excluirOutliers: boolean) {
  const medibles = cs.filter((c) => c.dias != null && (!excluirOutliers || c.dias! <= OUTLIER_DIAS));
  const enLlamada = medibles.filter((c) => c.dias === 0), seg = medibles.filter((c) => c.dias! > 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
  return {
    cierres: medibles.length, enLlamada: enLlamada.length, enSeguimiento: seg.length,
    pctLlamada: tasa(enLlamada.length, medibles.length), pctSeguimiento: tasa(seg.length, medibles.length),
    promSeguimiento: avg(seg.map((c) => c.dias!)), medianaSeguimiento: median(seg.map((c) => c.dias!)), promTotal: avg(medibles.map((c) => c.dias!)),
    sinFecha: cs.filter((c) => c.fuente_fecha === "sin fecha"), incompletos: cs.filter((c) => c.incompleto),
    outliers: cs.filter((c) => c.dias != null && c.dias > OUTLIER_DIAS).length,
    buckets: BUCKETS.map(([label, a, b]) => ({ label, n: medibles.filter((c) => c.dias! >= a && c.dias! <= b).length })),
    medibles,
  };
}
export function agruparPago(cs: CierrePago[], excluirOutliers: boolean, dim: keyof CierrePago) {
  const m = new Map<string, CierrePago[]>();
  for (const c of cs) { const k = String(c[dim] ?? "—") || "—"; m.set(k, [...(m.get(k) ?? []), c]); }
  return [...m.entries()].map(([k, xs]) => ({ k, ...resumenPago(xs, excluirOutliers) })).filter((g) => g.cierres > 0).sort((a, b) => b.cierres - a.cierres);
}

// ───────────────────────── Datos incompletos (UN solo conteo para todo el dashboard) ─────────────────────────
export interface Incompleto { tipo: string; nombre: string; closer: string | null; detalle: string; contact_id?: string | null }
export function incompletosMetricas(d: DashDatos, f: Filtros): Incompleto[] {
  const out: Incompleto[] = [];
  for (const o of ganadas(d).filter((x) => pasa(x, f))) {
    if (cobradoInvalido(o)) out.push({ tipo: "Cobrado mayor que vendido", nombre: o.nombre ?? "—", closer: o.closer, detalle: `Vendido ${o.valor} · cobrado ${o.cobrado} (excluido de los totales)`, contact_id: o.contact_id });
  }
  for (const c of cierresPago(d).filter((x) => pasa({ producto: x.producto, closer: x.closer, tier: x.tier, fuente: x.origen }, f))) {
    if (c.fuente_fecha === "sin fecha") out.push({ tipo: "Cierre sin fecha de pago (Tracker BF)", nombre: c.nombre, closer: c.closer, detalle: `Llamada ${c.fecha_llamada ?? "—"} · cargar la fecha en la columna BF` });
    else if (c.incompleto) out.push({ tipo: "Ciclo con fechas inválidas", nombre: c.nombre, closer: c.closer, detalle: c.incompleto });
  }
  const cic = ciclo(d, f, FECHA_INICIO_DATOS, "2999-12-31");
  for (const x of cic.invalidosLista) out.push({ tipo: "Ciclo de venta: fechas fuera de orden", nombre: x.nombre ?? "—", closer: x.closer, detalle: "Un hito (agenda, asistencia, oferta o cierre) tiene fecha anterior al hito previo; se excluye de ese tramo" });
  for (const a of d.agendas.filter((x) => !x.fuente && pasa(x, f, { fuente: true }))) out.push({ tipo: "Agenda sin fuente", nombre: a.persona, closer: a.closer, detalle: a.fecha, contact_id: a.contact_id });
  return out;
}
