import { useEffect, useMemo, useState } from "react";
import { supabase, type CierreRow, type Level, type ReportRow, type SyncRow } from "../../lib/supabase";
import { costPer, money, num, pct, ratio } from "../../lib/format";
import { AgendasCalificadas } from "../AgendasCalificadas";

// Pestaña Ads (solo owners; la base también lo bloquea). Lógica sin cambios respecto de la versión anterior.
const LEVELS: [Level, string][] = [
  ["campaign", "Campañas"],
  ["adset", "Conjuntos"],
  ["ad", "Anuncios"],
];

interface Col {
  key: string;
  label: string;
  title?: string;
  get: (r: ReportRow) => number | null;
  fmt: (n: number | null) => string;
}

// Calificadas = todo lo que no es "Menos de $10k" (antes del 25-10, "Menos de $5k"): suma las dos ramas de GHL
const calif = (r: ReportRow) => r.calificadas + (r.calificadas_jessik ?? 0);

const COLS: Col[] = [
  { key: "spend", label: "Inversión", get: (r) => r.spend, fmt: money },
  { key: "agendas", label: "Agendas", title: "Contactos que agendaron en el período", get: (r) => r.agendas, fmt: num },
  { key: "cpa", label: "$ / agenda", get: (r) => costPer(r.spend, r.agendas), fmt: money },
  { key: "calificadas", label: "Calificadas", title: "Agendas calificadas: facturación de US$10k/mes o más (antes del 25-10, US$5k o más)", get: (r) => calif(r), fmt: num },
  { key: "cpq", label: "$ / calificada", get: (r) => costPer(r.spend, calif(r)), fmt: money },
  { key: "qrate", label: "% calif.", get: (r) => ratio(calif(r), r.agendas), fmt: (n) => pct(n, 0) },
  { key: "meta_schedules", label: "Result. Meta", title: "Schedule que Meta recibió por API (calificadas, según Meta)", get: (r) => r.meta_schedules, fmt: num },
  { key: "asistencias", label: "Asistencias", title: "Antes del 21-10 desde el archivo de llamadas; después desde GHL", get: (r) => r.asistencias, fmt: num },
  { key: "ofertas", label: "Ofertas", get: (r) => r.ofertas, fmt: num },
  { key: "cierres", label: "Cierres", get: (r) => r.cierres, fmt: num },
  { key: "vendido", label: "Vendido", get: (r) => r.vendido, fmt: money },
  { key: "cobrado", label: "Cobrado", get: (r) => r.cobrado, fmt: money },
  { key: "roas", label: "ROAS cobrado", title: "Cobrado / inversión", get: (r) => (r.spend > 0 ? r.cobrado / r.spend : null), fmt: (n) => (n == null ? "—" : `${n.toFixed(2)}x`) },
  { key: "ctr", label: "CTR", get: (r) => ratio(r.link_clicks, r.impressions), fmt: (n) => pct(n, 2) },
  { key: "cpm", label: "CPM", get: (r) => (r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null), fmt: money },
  { key: "lpv", label: "Visitas", title: "Visitas a la página de destino (Meta)", get: (r) => r.landing_page_views, fmt: num },
  { key: "v2a", label: "Visita → agenda", get: (r) => ratio(r.agendas, r.landing_page_views), fmt: (n) => pct(n, 1) },
];

// Reglas del dueño del 29-10: calificada = US$10k+; tope US$200 por calificada; US$200 sin calificada → apagar.
// targetCpq = referencia de noviembre (~US$130 por calificada).
const STD = { targetCpq: 130, killSpend: 200, reviewSpend: 400, maxCpq: 200 };

function verdict(r: ReportRow): { label: string; cls: string; why: string } | null {
  if (r.entity_id.startsWith("__") || r.spend <= 0) return null;
  const q = calif(r);
  const cpq = q > 0 ? r.spend / q : null;
  if (r.asistencias > 0 || r.cierres > 0)
    return q >= 2 && cpq != null && cpq <= STD.targetCpq
      ? { label: "Ganador", cls: "v-win", why: `${r.asistencias} asistencias y calificada a ${money(cpq)}` }
      : { label: "No tocar", cls: "v-keep", why: `Tiene ${r.asistencias} asistencias${r.cierres ? ` y ${r.cierres} cierres` : ""}` };
  if (q === 0)
    return r.spend >= STD.killSpend
      ? { label: "Apagar", cls: "v-kill", why: `${money(r.spend)} gastados sin calificadas` }
      : { label: "En prueba", cls: "v-test", why: `${money(r.spend)} de ${money(STD.killSpend)} sin calificada` };
  if (r.spend >= STD.reviewSpend && cpq! > STD.maxCpq) return { label: "Apagar", cls: "v-kill", why: `Calificada a ${money(cpq)} con ${money(r.spend)} gastados` };
  if (cpq! <= STD.targetCpq) return { label: "Candidato", cls: "v-cand", why: `Calificada a ${money(cpq)} (objetivo ${money(STD.targetCpq)}); falta una asistencia` };
  return { label: "En prueba", cls: "v-test", why: `Calificada a ${money(cpq)}, por encima del objetivo` };
}

function sumRows(rows: ReportRow[]): ReportRow {
  const z: ReportRow = {
    entity_id: "total", entity_name: "Total", parent_name: null, status: null, thumbnail_url: null,
    spend: 0, impressions: 0, clicks: 0, link_clicks: 0, landing_page_views: 0, meta_schedules: 0,
    agendas: 0, calificadas: 0, calificadas_jessik: 0, asistencias: 0, ofertas: 0, cierres: 0, vendido: 0, cobrado: 0,
  };
  for (const r of rows)
    for (const k of ["spend", "impressions", "clicks", "link_clicks", "landing_page_views", "meta_schedules", "agendas", "calificadas", "calificadas_jessik", "asistencias", "ofertas", "cierres", "vendido", "cobrado"] as const)
      z[k] += Number(r[k]) || 0;
  return z;
}

export function Ads({ from, to, reloadKey }: { from: string; to: string; reloadKey: number }) {
  const [level, setLevel] = useState<Level>("ad");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [sync, setSync] = useState<SyncRow[]>([]);
  const [cierres, setCierres] = useState<CierreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const [onlyActive, setOnlyActive] = useState(false);
  const [verAgendas, setVerAgendas] = useState(false);
  const [show, setShow] = useState<{ pasadas: number; asistencias: number; por_venir: number } | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    Promise.all([
      supabase.rpc("report", { p_from: from, p_to: to, p_level: level }),
      supabase.rpc("sync_status"),
      supabase.rpc("cierres", { p_from: from, p_to: to }),
      supabase.rpc("ads_show_rate", { p_from: from, p_to: to }),
    ]).then(([r, s, c, sr]) => {
      if (!alive) return;
      const e = r.error ?? s.error ?? c.error;
      setShow((sr.data as typeof show) ?? null);
      if (e) setErr(e.message);
      setRows(((r.data ?? []) as ReportRow[]).map((x) => ({ ...x, spend: Number(x.spend), vendido: Number(x.vendido), cobrado: Number(x.cobrado) })));
      setSync((s.data ?? []) as SyncRow[]);
      setCierres(((c.data ?? []) as CierreRow[]).map((x) => ({ ...x, vendido: Number(x.vendido), cobrado: Number(x.cobrado) })));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [from, to, level, reloadKey]);

  const visible = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key);
    const list = onlyActive ? rows.filter((r) => r.status === "ACTIVE" || r.spend > 0) : rows;
    return [...list].sort((a, b) => {
      const sa = a.entity_id.startsWith("__"), sb = b.entity_id.startsWith("__");
      if (sa !== sb) return sa ? 1 : -1;
      const va = col ? col.get(a) : 0;
      const vb = col ? col.get(b) : 0;
      return ((va ?? -Infinity) - (vb ?? -Infinity)) * sort.dir;
    });
  }, [rows, sort, onlyActive]);

  const total = useMemo(() => sumRows(rows), [rows]);
  // Ventas de Ads: todas las de la tabla de cierres, también las que no tienen el anuncio identificado
  const ventas = useMemo(
    () => ({ n: cierres.length, vendido: cierres.reduce((t, x) => t + x.vendido, 0), cobrado: cierres.reduce((t, x) => t + x.cobrado, 0) }),
    [cierres],
  );

  const kpis: [string, string, string?][] = [
    ["Inversión", money(total.spend)],
    ["Agendas", num(total.agendas), `${money(costPer(total.spend, total.agendas))} c/u`],
    ["Agendas calificadas", num(calif(total)), `${money(costPer(total.spend, calif(total)))} por agenda calificada · ${pct(ratio(calif(total), total.agendas), 0)} de las agendas`],
    ["Asistencias", num(total.asistencias), show
      ? `Show rate ${pct(ratio(show.asistencias, show.pasadas), 0)} · ${num(show.asistencias)} de ${num(show.pasadas)} llamadas que ya pasaron · ${num(show.por_venir)} por venir`
      : undefined],
    ["Cierres", num(ventas.n), total.asistencias > 0 ? `${pct(ratio(ventas.n, total.asistencias), 1)} de cierre sobre asistencias (${num(ventas.n)} de ${num(total.asistencias)})` : "Sin asistencias en el período"],
    ["Vendido", money(ventas.vendido)],
    ["Cobrado", money(ventas.cobrado), undefined],
    ["ROAS", total.spend > 0 ? `${(ventas.cobrado / total.spend).toFixed(2)}x` : "—", total.spend > 0 ? `Cobrado ÷ inversión · vendido ${(ventas.vendido / total.spend).toFixed(2)}x` : "Sin inversión en el período"],
  ];

  return (
    <div className="ads-scroll">
      {err && <p className="error">Error: {err}</p>}

      <section className="kpis" aria-busy={loading}>
        {kpis.map(([label, value, sub]) => (
          <div key={label} className="kpi">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{value}</div>
            {sub && <div className="kpi-sub">{sub}</div>}
          </div>
        ))}
      </section>

      {/* 01-11-2026: la lista de agendas calificadas reemplaza los gráficos de inversión/agendas por día */}
      <button className="link desplegable" onClick={() => setVerAgendas(!verAgendas)}>{verAgendas ? "▾" : "▸"} Lista de agendas calificadas</button>
      {verAgendas && <AgendasCalificadas from={from} to={to} reloadKey={reloadKey} />}

      <section className="card table-card">
        <div className="table-head">
          <div className="seg" role="tablist" aria-label="Nivel">
            {LEVELS.map(([l, label]) => (
              <button key={l} className={level === l ? "on" : ""} onClick={() => setLevel(l)}>
                {label}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
            Solo con gasto o activos
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="name">{LEVELS.find((l) => l[0] === level)![1].slice(0, -1)}</th>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    title={c.title}
                    className={sort.key === c.key ? "sorted" : ""}
                    onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                  >
                    {c.label}
                    {sort.key === c.key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.entity_id} className={r.entity_id.startsWith("__") ? "dim" : ""}>
                  <td className="name">
                    <div className="name-cell">
                      {level === "ad" && (r.thumbnail_url ? <img src={r.thumbnail_url} alt="" loading="lazy" /> : <span className="thumb" />)}
                      <div>
                        <div className="ent">
                          {r.status === "ACTIVE" && <span className="live" title="Activo" />}
                          {r.preview_url ? (
                            <a href={r.preview_url} target="_blank" rel="noreferrer" title="Ver el anuncio en Meta">{r.entity_name}</a>
                          ) : (
                            r.entity_name
                          )}
                          {level === "ad" && r.page_id && (
                            <a className="lib" href={adLibrary(r.page_id)} target="_blank" rel="noreferrer" title="Biblioteca de anuncios de la página">Biblioteca</a>
                          )}
                        </div>
                        {r.parent_name && <div className="sub">{r.parent_name}</div>}
                        {level !== "campaign" && (r.status === "ACTIVE" || r.spend > 0) && (() => {
                          const v = verdict(r);
                          return v && <span className={`verdict ${v.cls}`} title={v.why}>{v.label}</span>;
                        })()}
                      </div>
                    </div>
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key}>{c.fmt(c.get(r))}</td>
                  ))}
                </tr>
              ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 1} className="empty">
                    Sin datos en este período.
                  </td>
                </tr>
              )}
            </tbody>
            {visible.length > 0 && (
              <tfoot>
                <tr>
                  <td className="name">Total</td>
                  {COLS.map((c) => (
                    <td key={c.key}>{c.fmt(c.get(total))}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <section className="card table-card">
        <div className="table-head">
          <h2 className="section-title">Cierres de Ads · {cierres.length}</h2>
          <span className="muted">Fecha = ingreso del cliente · vendido {money(cierres.reduce((t, x) => t + x.vendido, 0))} · cobrado {money(cierres.reduce((t, x) => t + x.cobrado, 0))}</span>
        </div>
        <div className="table-wrap">
          <table className="cierres">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="name">Cliente</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Closer</th>
                <th>Vendido</th>
                <th>Cobrado</th>
                <th className="name">Campaña</th>
                <th className="name">Conjunto</th>
                <th className="name">Anuncio</th>
              </tr>
            </thead>
            <tbody>
              {cierres.map((x, i) => (
                <tr key={`${x.email ?? x.nombre}-${i}`}>
                  <td>{x.fecha}</td>
                  <td className="name">{x.nombre ?? "—"}</td>
                  <td>{x.telefono ?? "—"}</td>
                  <td>{x.email ? <a href={`mailto:${x.email}`}>{x.email}</a> : "—"}</td>
                  <td>{x.closer ?? "—"}</td>
                  <td>{money(x.vendido)}</td>
                  <td>{money(x.cobrado)}</td>
                  <td className="name">{x.campaign_name ?? "—"}{x.cuenta === "Cerrada" && <span className="sub"> · cuenta cerrada</span>}</td>
                  <td className="name">{x.adset_name ?? "—"}</td>
                  <td className="name">
                    {x.preview_url ? <a href={x.preview_url} target="_blank" rel="noreferrer">{x.ad_name}</a> : x.ad_name ?? "Sin anuncio identificado"}
                  </td>
                </tr>
              ))}
              {!loading && cierres.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty">Sin cierres de Ads en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="foot muted">
        <p>
          Atribución: último clic de anuncio antes de agendar. Agendas y calificadas por fecha en que se agendó; asistencias por fecha de la llamada; cierres, vendido y cobrado por fecha de cierre
          (oportunidades Won del pipeline de Venta en GHL). “Sin anuncio identificado” = agendas de anuncios cuyo link todavía no trae <code>ad_id</code>: se sabe el conjunto, no el anuncio.
          “Anuncios sin ID en la URL” = vinieron de Meta con un link sin parámetros de anuncio ni de conjunto.
        </p>
        <p>
          Última actualización:{" "}
          {sync.length === 0
            ? "—"
            : sync.map((s) => (
                <span key={s.source} className="sync">
                  {({ meta: "Meta", ghl: "GHL", sheet: "Hoja" } as Record<string, string>)[s.source] ?? s.source}{" "}
                  {s.last_ok ? new Date(s.last_ok).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "nunca"}
                </span>
              ))}
        </p>
      </footer>
    </div>
  );
}

const adLibrary = (pageId: string) =>
  `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&media_type=all&search_type=page&view_all_page_id=${pageId}`;

