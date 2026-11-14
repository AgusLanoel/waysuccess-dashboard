import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { closers, objetivos, type DashDatos, type Filtros } from "../../lib/metricas";
import { ChipProd, Kpi, Panel, Seg, Tabla, Valor, dec, ghlContacto, num, pct } from "../ui";
import { TONO_CLOSER, usePaleta } from "../../lib/paleta";
import type { CSSProperties } from "react";

type Vista = "closers" | "setters";
export function Equipo({ d, f, from, to, reloadKey, irASeguimientos }: { d: DashDatos; f: Filtros; from: string; to: string; reloadKey: number; irASeguimientos: (closer: string) => void }) {
  const [vista, setVista] = useState<Vista>("closers");
  return (
    <div className="tab-col">
      <Seg label="Vista" className="seg-grande" value={vista} onChange={setVista} options={[["closers", "Closers"], ["setters", "Setters"]] as const} />
      {vista === "closers" ? <Closers d={d} f={f} from={from} to={to} irASeguimientos={irASeguimientos} /> : <Setters from={from} to={to} reloadKey={reloadKey} f={f} />}
    </div>
  );
}

function Closers({ d, f, from, to, irASeguimientos }: { d: DashDatos; f: Filtros; from: string; to: string; irASeguimientos: (c: string) => void }) {
  const filas = useMemo(() => closers(d, f, from, to), [d, f, from, to]);
  const obj = objetivos(d);
  const tonos = usePaleta();
  // Cada closer con su tono del violeta de Equipo (Luca oscuro, Jenny medio, Mileces lila, Ale lavanda)
  const tonoDe = (c: string) => ({ "--tono": tonos[TONO_CLOSER[c] ?? 3] }) as CSSProperties;
  const r = (a: number, b: number) => (b > 0 ? a / b : null);
  const ok = (v: number | null, meta: number) => (v != null && v >= meta ? "en-meta" : "");
  return (
    <Panel className="lleno" titulo="Closers" extra={<span className="muted">Comisión: 3% de lo cobrado (DFY y JessiK) · meta de cierres = Meta Ads del Tracker prorrateada al período</span>}>
      <Tabla
        rows={filas}
        porPagina={12}
        rowCls={() => "fila-closer"}
        rowStyle={(x) => tonoDe(x.closer)}
        cols={[
          { k: "c", label: "Closer", align: "l", get: (x) => <span className="closer-tono">{x.closer}</span> },
          { k: "ll", label: "Llamadas", get: (x) => <Valor k="n" v={x.llamadas} /> },
          { k: "as", label: "Asistencias", get: (x) => <Valor k="n" v={x.asistencias} /> },
          { k: "pa", label: "% Asist.", get: (x) => <Valor k="p" v={r(x.asistencias, x.agendas)} />, cls: (x) => ok(r(x.asistencias, x.agendas), obj.pct_asistencia) },
          { k: "of", label: "Ofertas", get: (x) => <Valor k="n" v={x.ofertas} /> },
          { k: "po", label: "% Oferta", get: (x) => <Valor k="p" v={r(x.ofertas, x.asistencias)} />, cls: (x) => ok(r(x.ofertas, x.asistencias), obj.pct_oferta) },
          { k: "ci", label: "Cierres", get: (x) => <Valor k="n" v={x.cierres} /> },
          { k: "cs", label: "Cierres en seg.", get: (x) => <Valor k="n" v={x.cierres_seguimiento} /> },
          { k: "ct", label: "Cierres totales", get: (x) => <Valor k="n" v={x.cierres_totales} /> },
          { k: "pc", label: "% Cierre", get: (x) => <Valor k="p" v={r(x.cierres_totales, x.asistencias)} />, cls: (x) => ok(r(x.cierres_totales, x.asistencias), obj.pct_cierre) },
          { k: "v", label: "Vendido", get: (x) => <Valor k="m" v={x.vendido} /> },
          { k: "co", label: "Cobrado", get: (x) => <Valor k="m" v={x.cobrado} /> },
          { k: "cseg", label: "Cobrado en seg.", get: (x) => <Valor k="m" v={x.cobrado_seguimiento} /> },
          { k: "ctot", label: "Cobrado total", get: (x) => <Valor k="m" v={x.cobrado_total} /> },
          { k: "com", label: "Comisión", get: (x) => <Valor k="m" v={x.comisiones} /> },
          { k: "m", label: "Meta cierres", get: (x) => (x.meta_cierres == null ? "—" : <Valor k="n" v={x.meta_cierres} txt={dec(x.meta_cierres)} />) },
          { k: "pm", label: "% Meta", get: (x) => <Valor k="p" v={x.pct_meta} />, cls: (x) => ok(x.pct_meta, 1) },
          { k: "sa", label: "Seguimientos", get: (x) => <button className="link" onClick={() => irASeguimientos(x.closer)}>{num(x.seguimientos_abiertos)} →</button> },
        ]}
        vacio="Ningún closer con actividad en el período"
      />
      <p className="nota">Tasas en verde = en meta (metas de Proyecciones: asistencia {pct(obj.pct_asistencia)}, oferta {pct(obj.pct_oferta)}, cierre {pct(obj.pct_cierre)}). La comisión no incluye el cobrado en seguimiento, igual que el Tracker [A CONFIRMAR].</p>
    </Panel>
  );
}

interface FilaSetter { grupo: string; clave: string; agendas: number; contactadas: number; contactadas_antes: number; mediana_min: number | null; pasadas_contactadas: number; asist_contactadas: number; pasadas_no_contactadas: number; asist_no_contactadas: number }
interface Pend { id: string; contact_id: string | null; nombre: string | null; telefono: string | null; producto: string; tier: string; closer: string | null; etapa: string; agendada: string; llamada: string | null; horas_esperando: number }
const horas = (m: number | null) => (m == null ? "—" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${dec(m / 60)} h` : `${dec(m / 1440)} d`);
const hora = (s: string | null) => (s ? new Date(s).toLocaleString("es", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function Setters({ from, to, reloadKey, f }: { from: string; to: string; reloadKey: number; f: Filtros }) {
  const [datos, setDatos] = useState<{ desde: string; filas: FilaSetter[]; pendientes: Pend[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    supabase.rpc("setter_equipo", { p_from: from, p_to: to }).then(({ data, error }) => { if (vivo) { setErr(error?.message ?? null); setDatos(data); } });
    return () => { vivo = false; };
  }, [from, to, reloadKey]);
  if (err) return <p className="error">Error: {err}</p>;
  if (!datos) return <div className="vacio">Cargando…</div>;
  const tot = datos.filas.find((x) => x.grupo === "total");
  const show = (a: number, b: number) => (b ? a / b : null);
  const pend = datos.pendientes.filter((p) => (f.closer === "Todos" || p.closer === f.closer) && (f.tier === "Todos" || p.tier === f.tier) && (f.producto === "Todos" || p.producto === f.producto));
  const colsGrupo = (titulo: string) => [
    { k: "k", label: titulo, align: "l" as const, get: (x: FilaSetter) => x.clave },
    { k: "a", label: "Agendas", get: (x: FilaSetter) => <Valor k="n" v={x.agendas} /> },
    { k: "c", label: "Contactadas", get: (x: FilaSetter) => <Valor k="n" v={x.contactadas} /> },
    { k: "ca", label: "% antes de la llamada", get: (x: FilaSetter) => <Valor k="p" v={show(x.contactadas_antes, x.agendas)} /> },
    { k: "t", label: "Tiempo (mediana)", get: (x: FilaSetter) => <Valor k="avg" v={x.mediana_min} txt={horas(x.mediana_min)} /> },
    { k: "s", label: "Show rate", get: (x: FilaSetter) => <Valor k="p" v={show(x.asist_contactadas + x.asist_no_contactadas, x.pasadas_contactadas + x.pasadas_no_contactadas)} /> },
  ];
  return (
    <>
      <div className="kpis5">
        <Kpi label="Sin contactar ahora" value={num(pend.length)} tone={pend.length ? "alerta" : ""} />
        <Kpi k="p" ratio={tot ? show(tot.contactadas, tot.agendas) : null} label="% contactadas" value={pct(tot ? show(tot.contactadas, tot.agendas) : null)} sub={tot ? `${tot.contactadas} de ${tot.agendas} agendas` : undefined} />
        <Kpi k="p" ratio={tot ? show(tot.contactadas_antes, tot.agendas) : null} label="% antes de la llamada" value={pct(tot ? show(tot.contactadas_antes, tot.agendas) : null)} />
        <Kpi k="avg" label="Tiempo hasta el contacto" value={horas(tot?.mediana_min ?? null)} sub="mediana" />
        <Kpi k="p" ratio={tot ? show(tot.asist_contactadas, tot.pasadas_contactadas) : null} label="Show rate contactadas" value={pct(tot ? show(tot.asist_contactadas, tot.pasadas_contactadas) : null)} sub={`sin contactar: ${pct(tot ? show(tot.asist_no_contactadas, tot.pasadas_no_contactadas) : null)}`} />
      </div>
      <div className="fila2">
        <Panel titulo="Por setter"><Tabla rows={datos.filas.filter((x) => x.grupo === "setter")} cols={colsGrupo("Setter")} /></Panel>
        <Panel titulo="Por tier"><Tabla rows={datos.filas.filter((x) => x.grupo === "tier").sort((a, b) => a.clave.localeCompare(b.clave))} cols={colsGrupo("Tier")} /></Panel>
      </div>
      <Panel className="lleno" titulo={`Agendas sin contactar · ${pend.length}`} extra={<span className="muted">Etapa “Agenda Contactada” del pipeline de Venta · desde {datos.desde}</span>}>
        <Tabla
          rows={pend}
          porPagina={8}
          buscar={(p) => `${p.nombre ?? ""} ${p.telefono ?? ""}`}
          cols={[
            { k: "n", label: "Lead", align: "l", get: (p) => { const u = ghlContacto(p.contact_id); return u ? <a href={u} target="_blank" rel="noreferrer">{p.nombre ?? "—"}</a> : p.nombre ?? "—"; } },
            { k: "t", label: "Teléfono", get: (p) => { const u = ghlContacto(p.contact_id); return u ? <a href={u} target="_blank" rel="noreferrer">{p.telefono ?? "—"}</a> : p.telefono ?? "—"; } },
            { k: "p", label: "Producto", get: (p) => <ChipProd p={p.producto} /> },
            { k: "ti", label: "Tier", get: (p) => p.tier },
            { k: "c", label: "Closer", get: (p) => p.closer ?? "—" },
            { k: "r", label: "Reservó", get: (p) => hora(p.agendada) },
            { k: "e", label: "Esperando", get: (p) => `${dec(p.horas_esperando)} h` },
            { k: "l", label: "Llamada", get: (p) => hora(p.llamada) },
          ]}
          vacio="Todas las agendas están contactadas"
        />
      </Panel>
    </>
  );
}
