import { useEffect, useMemo, useState } from "react";
import { supabase, type CierreDiaData, type MiDiaData } from "../../lib/supabase";
import { incompletosMetricas, type DashDatos, type Filtros, type Incompleto } from "../../lib/metricas";
import { ChipProd, Panel, Seg, Tabla, ghlContacto } from "../ui";

const TIPOS: Record<string, string> = {
  faltan_datos: "Faltan datos en GHL", sin_resultado: "Llamada pasada sin resultado", sin_oportunidad: "Cita sin oportunidad",
  sin_contactar: "Agenda sin contactar", perdida_sin_motivo: "Perdida sin motivo",
};

export function Hoy({ d, f, reloadKey, esCloser }: { d: DashDatos; f: Filtros; reloadKey: number; esCloser: boolean }) {
  const [dia, setDia] = useState<"hoy" | "manana">("hoy");
  const [mi, setMi] = useState<MiDiaData | null>(null);
  const [cc, setCc] = useState<CierreDiaData | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    let vivo = true;
    supabase.rpc("mi_dia", { p_closer: esCloser || f.closer === "Todos" ? null : f.closer }).then(({ data }) => vivo && setMi(data as MiDiaData));
    if (!esCloser) supabase.rpc("control_cierre").then(({ data }) => vivo && setCc(data as CierreDiaData));
    return () => { vivo = false; };
  }, [reloadKey, f.closer, esCloser]);

  const llamadas = (mi?.llamadas ?? []).filter((l) => (dia === "hoy" ? l.dia === mi?.hoy : l.dia !== mi?.hoy) && (f.producto === "Todos" || l.producto === f.producto));

  // UN solo conteo: pendientes del CRM (control de cierre de día) + alertas de la capa de métricas
  const items: Incompleto[] = useMemo(() => {
    // Owner/finanzas: control de cierre de día. Closer: sus pendientes de "Mi día" (control_cierre es solo para owners).
    const crm: Incompleto[] = !esCloser
      ? (cc?.items ?? []).map((i) => ({ tipo: TIPOS[i.tipo] ?? i.tipo, nombre: i.nombre, closer: i.responsable, detalle: i.detalle, contact_id: i.contact_id }))
      : (mi?.pendientes ?? []).map((p) => ({ tipo: p.problema, nombre: p.nombre ?? "—", closer: p.closer, detalle: p.etapa, contact_id: p.contact_id }));
    return [...crm, ...incompletosMetricas(d, f)].filter((i) => f.closer === "Todos" || !i.closer || i.closer === f.closer);
  }, [cc, mi, d, f, esCloser]);
  const porTipo = useMemo(() => { const m = new Map<string, Incompleto[]>(); items.forEach((i) => m.set(i.tipo, [...(m.get(i.tipo) ?? []), i])); return [...m.entries()].sort((a, b) => b[1].length - a[1].length); }, [items]);
  const porCloser = useMemo(() => { const m = new Map<string, number>(); items.forEach((i) => m.set(i.closer ?? "Sin responsable", (m.get(i.closer ?? "Sin responsable") ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [items]);
  const lista = tipo ? porTipo.find(([t]) => t === tipo)?.[1] ?? [] : [];

  const copiar = () => {
    const txt = cc?.texto_equipo ?? porCloser.map(([c, n]) => `${c}: ${n} pendientes`).join("\n");
    navigator.clipboard.writeText(txt).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); });
  };

  return (
    <div className="fila-60-40 alto">
      <Panel className="lleno" titulo="Llamadas" extra={<Seg label="Día" value={dia} onChange={setDia} options={[["hoy", `Hoy · ${(mi?.llamadas ?? []).filter((l) => l.dia === mi?.hoy).length}`], ["manana", "Mañana"]] as const} />}>
        <Tabla rows={llamadas} porPagina={12} buscar={(l) => `${l.nombre ?? ""} ${l.telefono ?? ""}`}
          cols={[
            { k: "h", label: "Hora", get: (l) => l.hora },
            { k: "n", label: "Lead", align: "l", get: (l) => { const u = ghlContacto(l.contact_id); return u ? <a href={u} target="_blank" rel="noreferrer">{l.nombre ?? "—"}</a> : l.nombre ?? "—"; } },
            { k: "t", label: "Teléfono", get: (l) => l.telefono ?? "—" },
            { k: "c", label: "Closer", get: (l) => l.closer },
            { k: "p", label: "Producto", get: (l) => <ChipProd p={l.producto} /> },
            { k: "i", label: "Ingresos", get: (l) => l.ingresos ?? "—" },
            { k: "ne", label: "Negocio", align: "l", get: (l) => <span className="recorte" title={l.negocio ?? ""}>{l.negocio ?? "—"}</span> },
            { k: "e", label: "Etapa", get: (l) => l.etapa ?? "—" },
          ]} vacio={dia === "hoy" ? "Sin llamadas hoy" : "Sin llamadas mañana"} />
      </Panel>
      <Panel className="lleno" titulo={!esCloser && !cc ? "Datos incompletos · …" : `Datos incompletos · ${items.length}`} extra={<button className="link" onClick={copiar}>{copiado ? "Copiado ✓" : "Copiar mensaje para el equipo"}</button>}>
        <div className="incompletos">
          <div className="chips-closer">{porCloser.map(([c, n]) => <span key={c} className="chip-gris">{c} · {n}</span>)}</div>
          <ul className="tipos">
            {porTipo.map(([t, xs]) => (
              <li key={t}><button className={`tipo-btn ${tipo === t ? "on" : ""}`} onClick={() => setTipo(tipo === t ? null : t)}><span>{t}</span><b>{xs.length}</b></button></li>
            ))}
          </ul>
          {tipo && (
            <div className="tabla-scroll lista-nombres">
              <Tabla rows={lista} porPagina={8} buscar={(i) => i.nombre}
                cols={[
                  { k: "n", label: "Nombre", align: "l", get: (i) => { const u = ghlContacto(i.contact_id); return u ? <a href={u} target="_blank" rel="noreferrer">{i.nombre}</a> : i.nombre; } },
                  { k: "c", label: "Responsable", get: (i) => i.closer ?? "—" },
                  { k: "d", label: "Detalle", align: "l", get: (i) => <span className="recorte" title={i.detalle}>{i.detalle}</span> },
                ]} />
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
