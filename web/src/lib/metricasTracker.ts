// Capa de métricas · parte Tracker (15-11-2026): pestañas Clientes · Números · Gráficos.
// Reproducen las hojas "Cierres — Clientes", "Gráficos · Números" y "Gráficos CVO" con SUS reglas (fuente: Tracker, solo lectura):
//  · agenda = fila de Llamadas por fecha de llamada · asistencia = Estado llamada "Asistió" · asist. calificada = Asistencia Calificada "Si" y asistió
//  · oferta = Oferta hecha "Si" · agenda calificada = "Calificación histórica (respaldo P)" = Calificado
//  · cierres, vendido y recolectado de cierres = lista de "Cierres — Clientes" por su FECHA (fecha de ingreso)
//  · recolectado seguimiento = "Cobros — Seguimiento" por fecha de cobro
//  · ticket = cobrado ÷ cierres (nunca vendido) · % recolección = recolectado total ÷ vendido (igual que la hoja)
// Ningún componente recalcula: todo sale de acá.
import {
  FECHA_INICIO_DATOS, closerNorm, dimsCobro, dimsTracker, enRango, fuenteNorm, industriaNorm, norm, num0, objecionEtiqueta, objetivos, pasa,
  periodoAnterior, planMensual, productoTracker, semanas, tasa,
  type Cobro, type DashDatos, type Filtros, type GeoValidada, type Producto, type TrackerLlamada,
} from "./metricas";

export const TIPO_SEGUIMIENTO = "Cierre en seguimiento";
// [A CONFIRMAR] Fecha que ubica un cierre en el período: la FECHA de "Cierres — Clientes" (= fecha de ingreso); si falta, la fecha de llamada original.
export const FECHA_PERIODO_CIERRE = "ingreso (si falta: llamada original)";
// [A CONFIRMAR] Por cobrar negativo (cobrado de más) se muestra en 0 con ⚠. Clientes con vendido 0 (mes a mes) no generan alerta.
export const OBJECIONES_TRACKER = [
  "Caro", "Socio/Pareja", "Querer hacerlo después", "Estoy viendo otras opciones", "No tomo decisiones en caliente", "Capacidad de pago",
  "Malas experiencias", "Capacidad de él mismo", "Confianza en el vehículo", "Confianza en Ale", "Confianza en el closer", "Confianza en la empresa",
  "Miedo al éxito", "Tengo que pensarlo", "Ghosteó", "Contrato", "Logístico", "No le vio el valor", "Lo quiere hacer por su cuenta",
] as const;

const esSi = (v: unknown) => norm(v) === "si";
const asistioT = (t: TrackerLlamada) => norm(t.estado_llamada).startsWith("asistio");
const filaKey = (v: unknown) => String(v ?? "").trim();
// Histórico de Clientes: todos los cierres, incluidos los que no tienen fecha (igual que la hoja)
export const HISTORICO_CLIENTES = "2000-01-01";
const enPeriodo = (fecha: string | null, from: string, to: string) => (fecha ? enRango(fecha, from, to) : from <= HISTORICO_CLIENTES);
const desdeOk = (from: string) => (from < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : from);

// Filtros propios de Clientes (tipo, modalidad, país) y de Gráficos (país)
export interface FiltrosTab { tipo: "Todos" | "Nuevos" | "Seguimiento"; modalidad: string; pais: string }
export const FILTROS_TAB_VACIOS: FiltrosTab = { tipo: "Todos", modalidad: "Todas", pais: "Todos" };

export interface PagoCliente { fecha: string | null; tipo: string; monto: number }
export interface ClienteT {
  fila: number; fecha: string | null; cliente: string; email: string | null; telefono: string | null; closer: string | null; producto: Producto;
  fuente: string | null; tier: string | null; industria: string | null; tipo: "Nuevo" | "Seguimiento"; vendido: number; cobrado_cierre: number;
  cobrado_seguimiento: number; cobranzas: number; cobrado: number; por_cobrar: number; revisar: boolean; modalidad: string | null;
  pais: string | null; estado: string | null; ciudad: string | null; fecha_original: string | null; notas: string | null; fila_llamadas: string | null;
  pagos: PagoCliente[];
}
type LlamadaT = TrackerLlamada & { dims: ReturnType<typeof dimsTracker>; paisV: string | null; ind: string | null };
export interface CtxTracker { clientes: ClienteT[]; llamadas: LlamadaT[]; cobros: Cobro[]; cliPorFila: Map<string | null, ClienteT> }

// Contexto: se arma UNA vez por foto de datos
export function ctxTracker(d: DashDatos): CtxTracker {
  const geo = new Map<string, GeoValidada>((d.tracker.geo ?? []).map((g) => [filaKey(g.fila_llamadas), g]));
  const porFila = new Map(d.tracker.llamadas.map((t) => [String(t.fila), t]));
  const cobrosPorFila = new Map<string, Cobro[]>();
  for (const c of d.tracker.cobros) { const k = filaKey(c.fila_llamadas); if (k) cobrosPorFila.set(k, [...(cobrosPorFila.get(k) ?? []), c]); }
  const esCobranza = (x: Cobro) => norm(x.tipo) === "cobranza";
  const clientes = (d.tracker.cierres ?? []).map((c): ClienteT => {
    const k = filaKey(c.fila_llamadas), t = porFila.get(k), g = geo.get(k);
    const cobros = cobrosPorFila.get(k) ?? [];
    const vendido = num0(c.vendido), alCierre = num0(c.cobrado);
    const seg = cobros.filter((x) => !esCobranza(x)).reduce((a, x) => a + num0(x.cobrado), 0);
    const cobranzas = cobros.filter(esCobranza).reduce((a, x) => a + num0(x.cobrado), 0);
    const crudo = vendido - alCierre - seg; // Por cobrar = vendido − cobrado al cierre − cobros en seguimiento
    return {
      fila: c.fila, fecha: c.fecha ?? c.fecha_original, cliente: c.cliente.trim(), email: c.email ?? t?.email ?? null, telefono: c.telefono ?? t?.numero ?? null,
      closer: closerNorm(c.closer), producto: productoTracker(c.producto), fuente: fuenteNorm(c.fuente), tier: t?.tier || null, industria: industriaNorm(t?.industria),
      tipo: norm(c.tipo) === norm(TIPO_SEGUIMIENTO) ? "Seguimiento" : "Nuevo", vendido, cobrado_cierre: alCierre, cobrado_seguimiento: seg, cobranzas,
      cobrado: alCierre + seg, por_cobrar: vendido > 0 ? Math.max(0, crudo) : 0, revisar: vendido > 0 && crudo < 0,
      modalidad: c.modalidad?.trim() || t?.modalidad?.trim() || null,
      pais: g?.pais || c.pais || t?.pais || null, estado: g?.estado || t?.estado || null, ciudad: g?.ciudad || null,
      fecha_original: c.fecha_original, notas: c.notas || t?.notas || null, fila_llamadas: k || null,
      pagos: [
        ...(alCierre ? [{ fecha: c.fecha, tipo: "Cobrado al cierre", monto: alCierre }] : []),
        ...cobros.map((x) => ({ fecha: x.fecha, tipo: x.tipo ?? "Cobro", monto: num0(x.cobrado) })),
      ].sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "")),
    };
  });
  const llamadas = d.tracker.llamadas.map((t) => {
    const g = geo.get(String(t.fila));
    return { ...t, dims: dimsTracker(t), paisV: g?.pais || t.pais || null, ind: industriaNorm(t.industria) };
  });
  return { clientes, llamadas, cobros: d.tracker.cobros, cliPorFila: new Map(clientes.map((c) => [c.fila_llamadas, c])) };
}
const dimsCliente = (c: ClienteT) => ({ producto: c.producto, closer: c.closer, tier: c.tier, fuente: c.fuente });
const paisOk = (p: string | null | undefined, pais?: string) => !pais || pais === "Todos" || (p ?? "Sin dato") === pais;

// ───────── Clientes ─────────
export function clientesFiltrados(ctx: CtxTracker, f: Filtros, from: string, to: string, ft: FiltrosTab = FILTROS_TAB_VACIOS) {
  return ctx.clientes.filter((c) =>
    enPeriodo(c.fecha, from, to) && pasa(dimsCliente(c), f) &&
    (ft.tipo === "Todos" || (ft.tipo === "Nuevos" ? c.tipo === "Nuevo" : c.tipo === "Seguimiento")) &&
    (ft.modalidad === "Todas" || (c.modalidad ?? "Sin dato") === ft.modalidad) && paisOk(c.pais, ft.pais),
  ).sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.fila - a.fila);
}
const conExtra = (ft?: FiltrosTab) => !!ft && (ft.tipo !== "Todos" || ft.modalidad !== "Todas" || ft.pais !== "Todos");
export function resumenClientes(ctx: CtxTracker, f: Filtros, from: string, to: string, ft: FiltrosTab) {
  const cs = clientesFiltrados(ctx, f, from, to, ft);
  // Cobros del período por fecha de cobro; con filtros propios de Clientes, solo los de clientes que los cumplen
  const filasOk = conExtra(ft) ? new Set(clientesFiltrados(ctx, f, "0000-01-01", "9999-12-31", ft).map((c) => c.fila_llamadas)) : null;
  const cobros = ctx.cobros.filter((c) => enRango(c.fecha, from, to) && pasa(dimsCobro(c), f) && (!filasOk || filasOk.has(filaKey(c.fila_llamadas))));
  const cobranzas = cobros.filter((c) => norm(c.tipo) === "cobranza").reduce((a, c) => a + num0(c.cobrado), 0);
  const seguimiento = cobros.reduce((a, c) => a + num0(c.cobrado), 0) - cobranzas;
  const recCierres = cs.reduce((a, c) => a + c.cobrado_cierre, 0);
  return {
    filas: cs,
    nuevos: cs.filter((c) => c.tipo === "Nuevo").length, seguimiento: cs.filter((c) => c.tipo === "Seguimiento").length, total: cs.length,
    vendido: cs.reduce((a, c) => a + c.vendido, 0), cobrado: cs.reduce((a, c) => a + c.cobrado, 0), por_cobrar: cs.reduce((a, c) => a + c.por_cobrar, 0),
    revisar: cs.filter((c) => c.revisar).length,
    recolectado_cierres: recCierres, recolectado_seguimiento: seguimiento, cobranzas, recolectado_total: recCierres + seguimiento + cobranzas,
  };
}
export function opcionesTab(ctx: CtxTracker) {
  const mod = new Set<string>(), pais = new Set<string>();
  ctx.clientes.forEach((c) => { mod.add(c.modalidad ?? "Sin dato"); pais.add(c.pais ?? "Sin dato"); });
  ctx.llamadas.forEach((t) => { if (t.fecha && t.fecha >= FECHA_INICIO_DATOS) pais.add(t.paisV ?? "Sin dato"); });
  const ord = (s: Set<string>) => [...s].sort((a, b) => (a === "Sin dato" ? 1 : b === "Sin dato" ? -1 : a.localeCompare(b, "es")));
  return { modalidades: ord(mod), paises: ord(pais) };
}

// ───────── Números: bloque del período (misma fórmula que la hoja "Gráficos · Números") ─────────
export interface BloqueT {
  agendas: number; agendas_cal: number; asistencias: number; asist_cal: number; ofertas: number; cierres: number; cierres_seg: number;
  vendido: number; cobrado: number; cobrado_seg: number; cobrado_total: number;
}
export type DimT = "closer" | "fuente" | "producto" | "industria";
type ExtraT = { pais?: string; seg?: { k: DimT; v: string } };
const valLlamada = (t: LlamadaT, k: DimT) => (k === "industria" ? t.ind ?? "Sin industria" : String(t.dims[k] ?? "Sin dato"));
const valCliente = (c: ClienteT, k: DimT) => (k === "industria" ? c.industria ?? "Sin industria" : String(c[k] ?? "Sin dato"));
const valCobro = (c: Cobro, k: DimT) => (k === "industria" ? industriaNorm(c.industria) ?? "Sin industria" : String(dimsCobro(c)[k] ?? "Sin dato"));

export function bloqueTracker(ctx: CtxTracker, f: Filtros, from: string, to: string, x: ExtraT = {}): BloqueT {
  from = desdeOk(from);
  const ll = ctx.llamadas.filter((t) => enRango(t.fecha, from, to) && pasa(t.dims, f) && paisOk(t.paisV, x.pais) && (!x.seg || valLlamada(t, x.seg.k) === x.seg.v));
  const asis = ll.filter(asistioT);
  const cs = ctx.clientes.filter((c) => enRango(c.fecha, from, to) && pasa(dimsCliente(c), f) && paisOk(c.pais, x.pais) && (!x.seg || valCliente(c, x.seg.k) === x.seg.v));
  // Cobros en seguimiento: se cruzan con su cliente para país / segmento; sin cliente valen sus propias columnas
  const cob = ctx.cobros.filter((c) => {
    if (!enRango(c.fecha, from, to) || !pasa(dimsCobro(c), f)) return false;
    const cli = ctx.cliPorFila.get(filaKey(c.fila_llamadas));
    if (x.pais && x.pais !== "Todos" && !paisOk(cli?.pais, x.pais)) return false;
    if (x.seg) return (cli ? valCliente(cli, x.seg.k) : valCobro(c, x.seg.k)) === x.seg.v;
    return true;
  });
  const cobrado = cs.reduce((a, c) => a + c.cobrado_cierre, 0), cobSeg = cob.reduce((a, c) => a + num0(c.cobrado), 0);
  return {
    agendas: ll.length, agendas_cal: ll.filter((t) => norm(t.cal_agenda) === "calificado").length,
    asistencias: asis.length, asist_cal: asis.filter((t) => esSi(t.asistencia_calificada)).length, ofertas: ll.filter((t) => esSi(t.oferta)).length,
    cierres: cs.length, cierres_seg: cs.filter((c) => c.tipo === "Seguimiento").length,
    vendido: cs.reduce((a, c) => a + c.vendido, 0), cobrado, cobrado_seg: cobSeg, cobrado_total: cobrado + cobSeg,
  };
}
export const derivadasT = (b: BloqueT) => ({
  pct_agendas_cal: tasa(b.agendas_cal, b.agendas), pct_asistencia: tasa(b.asistencias, b.agendas), pct_asist_cal: tasa(b.asist_cal, b.asistencias),
  pct_ofertas: tasa(b.ofertas, b.asistencias), pct_cierre: tasa(b.cierres, b.asistencias), ticket: tasa(b.cobrado, b.cierres),
  pct_cierres_seg: tasa(b.cierres_seg, b.cierres), pct_recoleccion: tasa(b.cobrado_total, b.vendido), pct_cobro: tasa(b.cobrado, b.vendido),
});
export function numeros(ctx: CtxTracker, f: Filtros, from: string, to: string) {
  from = desdeOk(from);
  const b = bloqueTracker(ctx, f, from, to);
  const ant = periodoAnterior(from, to);
  const bAnt = ant ? bloqueTracker(ctx, f, ant[0], ant[1]) : null;
  const sem = semanas(from, to).map((s, i) => {
    const x = bloqueTracker(ctx, f, s.ini, s.fin);
    return { semana: `Semana ${i + 1}`, ...s, ...x, ...derivadasT(x), part_agendas: tasa(x.agendas, b.agendas) };
  });
  return { b, der: derivadasT(b), bAnt, derAnt: bAnt ? derivadasT(bAnt) : null, semanas: sem };
}
export function desgloseT(ctx: CtxTracker, f: Filtros, from: string, to: string, k: DimT) {
  from = desdeOk(from);
  const claves = new Set<string>();
  ctx.llamadas.filter((t) => enRango(t.fecha, from, to) && pasa(t.dims, f)).forEach((t) => claves.add(valLlamada(t, k)));
  ctx.clientes.filter((c) => enRango(c.fecha, from, to) && pasa(dimsCliente(c), f)).forEach((c) => claves.add(valCliente(c, k)));
  return [...claves].map((v) => { const x = bloqueTracker(ctx, f, from, to, { seg: { k, v } }); return { seg: v, ...x, pct_asistencia: tasa(x.asistencias, x.agendas) }; })
    .sort((a, b) => b.agendas - a.agendas || b.cierres - a.cierres);
}

// ───────── Gráficos: evolución mensual, objeciones, fuentes e industrias ─────────
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const finMes = (ym: string) => `${ym}-${String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`;
const mesSig = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
// Meses desde el 01/10/2026 hasta el mes del fin del período. Meta = Proyecciones (cierres comercial, o Ads si el filtro de fuente es Ads).
export function mensualT(d: DashDatos, ctx: CtxTracker, f: Filtros, to: string, pais?: string) {
  const plan = planMensual(d), obj = objetivos(d);
  const soloAds = f.fuente === "Ads";
  const out = [];
  const hasta = (to < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : to).slice(0, 7);
  for (let ym = FECHA_INICIO_DATOS.slice(0, 7); ym <= hasta; ym = mesSig(ym)) {
    const ini = `${ym}-01`, fin = finMes(ym);
    const b = bloqueTracker(ctx, f, ini, fin, { pais });
    const cobranzas = ctx.cobros.filter((c) => enRango(c.fecha, ini, fin) && pasa(dimsCobro(c), f) && norm(c.tipo) === "cobranza"
      && (!pais || pais === "Todos" || paisOk(ctx.cliPorFila.get(filaKey(c.fila_llamadas))?.pais, pais))).reduce((a, c) => a + num0(c.cobrado), 0);
    const p = plan.find((x) => x.ym === ym);
    const metaC = p ? (soloAds ? p.ads : p.comercial) : 0;
    out.push({
      ym, mes: `${MES_CORTO[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`, ...b, ...derivadasT(b),
      cobrado_seg_solo: b.cobrado_seg - cobranzas, cobranzas,
      meta_cierres: metaC || null, meta_vendido: metaC ? metaC * obj.ticket : null,
      meta_agendas: (p && (soloAds ? p.agendas_ads : p.agendas)) || null, meta_asistencias: (p && (soloAds ? p.asistencias_ads : p.asistencias)) || null,
    });
  }
  return out;
}
// Objeciones (suma de los 1 de las 19 columnas U:AM) sobre asistencias del período
export function objecionesT(ctx: CtxTracker, f: Filtros, from: string, to: string, soloCalificadas: boolean, pais?: string) {
  from = desdeOk(from);
  const base = ctx.llamadas.filter((t) => enRango(t.fecha, from, to) && pasa(t.dims, f) && paisOk(t.paisV, pais) && asistioT(t) && (!soloCalificadas || esSi(t.asistencia_calificada)));
  const n = new Map<string, number>(OBJECIONES_TRACKER.map((o) => [norm(o), 0]));
  for (const t of base) for (const o of t.objeciones) { const k = norm(objecionEtiqueta(o)); n.set(k, (n.get(k) ?? 0) + 1); }
  return { base: base.length, filas: OBJECIONES_TRACKER.map((o) => ({ objecion: o as string, n: n.get(norm(o)) ?? 0 })).sort((a, b) => b.n - a.n) };
}
// Agendas del período por fuente y top 10 industrias de cada fuente
export function fuentesT(ctx: CtxTracker, f: Filtros, from: string, to: string, pais?: string) {
  from = desdeOk(from);
  const ll = ctx.llamadas.filter((t) => enRango(t.fecha, from, to) && pasa(t.dims, f) && paisOk(t.paisV, pais));
  const porFuente = new Map<string, LlamadaT[]>();
  for (const t of ll) { const k = t.dims.fuente ?? "Sin dato"; porFuente.set(k, [...(porFuente.get(k) ?? []), t]); }
  return [...porFuente.entries()].map(([fuente, xs]) => {
    const ind = new Map<string, number>();
    xs.forEach((t) => { const k = t.ind ?? "Sin industria"; ind.set(k, (ind.get(k) ?? 0) + 1); });
    return { fuente, n: xs.length, industrias: [...ind.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 10) };
  }).sort((a, b) => b.n - a.n);
}
