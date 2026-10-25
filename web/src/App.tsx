import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type CierreRow, type DailyRow, type Level, type ReportRow, type SyncRow } from "./lib/supabase";
import { addDays, costPer, iso, money, money0, num, pct, ratio } from "./lib/format";
import { DailyChart } from "./components/Charts";
import { Comercial } from "./components/Comercial";
import { MiDia } from "./components/MiDia";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="center muted">Cargando…</div>;
  return session ? <Dashboard email={session.user.email ?? ""} /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr("Email o contraseña incorrectos.");
    setBusy(false);
  };
  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand">WaySuccess</div>
        <p className="muted">Dashboard comercial y de anuncios</p>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

type Preset = "today" | "yesterday" | "7" | "14" | "30" | "month" | "lastmonth" | "custom";
const PRESETS: [Preset, string][] = [
  ["today", "Hoy"],
  ["yesterday", "Ayer"],
  ["7", "7 días"],
  ["14", "14 días"],
  ["30", "30 días"],
  ["month", "Este mes"],
  ["lastmonth", "Mes pasado"],
  ["custom", "Personalizado"],
];

function rangeFor(p: Preset): [string, string] {
  const t = new Date();
  switch (p) {
    case "today":
      return [iso(t), iso(t)];
    case "yesterday":
      return [iso(addDays(t, -1)), iso(addDays(t, -1))];
    case "month":
      return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
    case "lastmonth":
      return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
    default:
      return [iso(addDays(t, -(Number(p) - 1))), iso(t)];
  }
}

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

const COLS: Col[] = [
  { key: "spend", label: "Inversión", get: (r) => r.spend, fmt: money },
  { key: "agendas", label: "Agendas", title: "Contactos que agendaron en el período", get: (r) => r.agendas, fmt: num },
  { key: "cpa", label: "$ / agenda", get: (r) => costPer(r.spend, r.agendas), fmt: money },
  { key: "calificadas", label: "Calif. DFY", title: "Agendas con facturación de US$20k/mes o más (rama \"Califica\" de GHL, la que se manda a Meta)", get: (r) => r.calificadas, fmt: num },
  { key: "calificadas_jessik", label: "Calif. JessiK", title: "Agendas con facturación de US$5k a US$20k/mes (rama \"Califica a JessiK\", downsell; no se manda a Meta)", get: (r) => r.calificadas_jessik ?? 0, fmt: num },
  { key: "cpq", label: "$ / calificada", get: (r) => costPer(r.spend, r.calificadas), fmt: money },
  { key: "qrate", label: "% calif.", get: (r) => ratio(r.calificadas, r.agendas), fmt: (n) => pct(n, 0) },
  { key: "meta_schedules", label: "Result. Meta", title: "Schedule que Meta recibió por API (calificadas, según Meta)", get: (r) => r.meta_schedules, fmt: num },
  { key: "asistencias", label: "Asistencias", title: "Desde la hoja de llamadas", get: (r) => r.asistencias, fmt: num },
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

// Estándares de optimización (skill meta-ads → waysuccess-standards.md). Cortes derivados del 1/9 al 15/10/2026.
const STD = { targetCpq: 174, killSpend: 350, reviewSpend: 500, maxCpq: 260 };

function verdict(r: ReportRow): { label: string; cls: string; why: string } | null {
  if (r.entity_id.startsWith("__") || r.spend <= 0) return null;
  const cpq = r.calificadas > 0 ? r.spend / r.calificadas : null;
  if (r.asistencias > 0 || r.cierres > 0)
    return r.calificadas >= 2 && cpq != null && cpq <= STD.targetCpq
      ? { label: "Ganador", cls: "v-win", why: `${r.asistencias} asistencias y calificada a ${money(cpq)}` }
      : { label: "No tocar", cls: "v-keep", why: `Tiene ${r.asistencias} asistencias${r.cierres ? ` y ${r.cierres} cierres` : ""}` };
  if (r.calificadas === 0)
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

export function Dashboard({ email }: { email: string }) {
  const [preset, setPreset] = useState<Preset>("7");
  const [[from, to], setRange] = useState(rangeFor("7"));
  const [level, setLevel] = useState<Level>("ad");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [sync, setSync] = useState<SyncRow[]>([]);
  const [cierres, setCierres] = useState<CierreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const [onlyActive, setOnlyActive] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Ads (inversión, anuncios, ROAS) solo para rol owner; la base también lo bloquea.
  const [role, setRole] = useState<string | null>(null);
  const [tab, setTab] = useState<"comercial" | "midia" | "ads">("comercial");
  const isOwner = role === "owner";
  const esCloser = role === "closer";
  // Closer: Mi día + sus números. Owner: además Ads (la base también lo bloquea para el resto).
  const TABS: ["comercial" | "midia" | "ads", string][] = esCloser
    ? [["midia", "Mi día"], ["comercial", "Mis números"]]
    : isOwner
      ? [["comercial", "Comercial"], ["midia", "Mi día"], ["ads", "Ads"]]
      : [["comercial", "Comercial"], ["midia", "Mi día"]];

  useEffect(() => {
    if (preset !== "custom") setRange(rangeFor(preset));
  }, [preset]);

  // Trae Meta y GHL al momento: al abrir el dashboard y con el botón "Actualizar".
  async function refresh() {
    setRefreshing(true);
    const { data, error } = await supabase.rpc("refresh_now");
    if (error) {
      setErr(error.message);
      setRefreshing(false);
      return;
    }
    const since = new Date((data as string | null) ?? Date.now() - 180_000).getTime();
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const s = await supabase.rpc("sync_status");
      const meta = ((s.data ?? []) as SyncRow[]).find((x) => x.source === "meta");
      if (meta?.last_ok && new Date(meta.last_ok).getTime() >= since) break;
    }
    setRefreshing(false);
    setReloadKey((k) => k + 1);
  }

  useEffect(() => {
    refresh();
    supabase.rpc("my_role").then(({ data }) => {
      setRole((data as string | null) ?? null);
      if (data === "closer") setTab("midia");
    });
  }, []);

  useEffect(() => {
    if (tab !== "ads" || !isOwner) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    Promise.all([
      supabase.rpc("report", { p_from: from, p_to: to, p_level: level }),
      supabase.rpc("report_daily", { p_from: from, p_to: to }),
      supabase.rpc("sync_status"),
      supabase.rpc("cierres", { p_from: from, p_to: to }),
    ]).then(([r, d, s, c]) => {
      if (!alive) return;
      const e = r.error ?? d.error ?? s.error ?? c.error;
      if (e) setErr(e.message);
      setRows(((r.data ?? []) as ReportRow[]).map((x) => ({ ...x, spend: Number(x.spend), vendido: Number(x.vendido), cobrado: Number(x.cobrado) })));
      setDaily(((d.data ?? []) as DailyRow[]).map((x) => ({ ...x, spend: Number(x.spend), cobrado: Number(x.cobrado) })));
      setSync((s.data ?? []) as SyncRow[]);
      setCierres(((c.data ?? []) as CierreRow[]).map((x) => ({ ...x, vendido: Number(x.vendido), cobrado: Number(x.cobrado) })));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [from, to, level, reloadKey, tab, isOwner]);

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
  const dates = daily.map((d) => d.d);

  const kpis: [string, string, string?][] = [
    ["Inversión", money(total.spend)],
    ["Agendas", num(total.agendas), `${money(costPer(total.spend, total.agendas))} c/u`],
    ["Calificadas DFY", num(total.calificadas), `${money(costPer(total.spend, total.calificadas))} c/u`],
    ["Calificadas JessiK", num(total.calificadas_jessik ?? 0), "US$5k–20k/mes · downsell"],
    ["Asistencias", num(total.asistencias), `${pct(ratio(total.asistencias, total.calificadas), 0)} de calificadas`],
    ["Cierres", num(ventas.n), `${pct(ratio(ventas.n, total.asistencias), 0)} de asistencias · ${num(total.cierres)} con anuncio identificado`],
    ["Vendido", money(ventas.vendido)],
    ["Cobrado", money(ventas.cobrado), undefined],
    ["ROAS", total.spend > 0 ? `${(ventas.cobrado / total.spend).toFixed(2)}x` : "—", total.spend > 0 ? `Cobrado ÷ inversión · vendido ${(ventas.vendido / total.spend).toFixed(2)}x` : "Sin inversión en el período"],
  ];

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">WaySuccess</div>
        <div className="user">
          <span className="muted">{email}</span>
          <button className="link" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Actualizando…" : "Actualizar"}
          </button>
          <button className="link" onClick={() => setShowPw((v) => !v)}>
            Contraseña
          </button>
          <button className="link" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </div>
      </header>
      {showPw && <ChangePassword onDone={() => setShowPw(false)} />}

      <div className="filters">
        {role && (
          <div className="seg tabs" role="tablist" aria-label="Sección">
            {TABS.map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
        )}
        {tab !== "midia" && (
        <div className="seg" role="tablist" aria-label="Período">
          {PRESETS.map(([p, l]) => (
            <button key={p} className={preset === p ? "on" : ""} onClick={() => setPreset(p)}>
              {l}
            </button>
          ))}
        </div>
        )}
        {tab !== "midia" && preset === "custom" && (
          <div className="dates">
            <input type="date" value={from} max={to} onChange={(e) => setRange([e.target.value, to])} />
            <span className="muted">a</span>
            <input type="date" value={to} min={from} onChange={(e) => setRange([from, e.target.value])} />
          </div>
        )}
      </div>

      {tab === "midia" ? (
        <MiDia esCloser={esCloser} reloadKey={reloadKey} />
      ) : tab === "comercial" || !isOwner ? (
        <Comercial from={from} to={to} reloadKey={reloadKey} />
      ) : (
      <>
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

      <section className="charts">
        <DailyChart title="Inversión por día" kind="bar" dates={dates} fmt={money0} series={[{ key: "spend", label: "Inversión", color: "var(--series-1)", values: daily.map((d) => d.spend) }]} />
        <DailyChart
          title="Agendas por día"
          kind="line"
          dates={dates}
          fmt={(n) => num(n)}
          series={[
            { key: "agendas", label: "Agendas", color: "var(--series-1)", values: daily.map((d) => d.agendas) },
            { key: "calificadas", label: "Calificadas", color: "var(--series-2)", values: daily.map((d) => d.calificadas) },
          ]}
        />
      </section>

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
          Atribución: último clic de anuncio antes de agendar. Agendas y calificadas por fecha en que se agendó; asistencias por fecha de la llamada; cierres, vendido y cobrado por fecha de ingreso del cliente
          (hoja “Llamadas”). “Sin anuncio identificado” = agendas de anuncios cuyo link todavía no trae <code>ad_id</code>: se sabe el conjunto, no el anuncio.
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
      </>
      )}
    </div>
  );
}

const adLibrary = (pageId: string) =>
  `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&media_type=all&search_type=page&view_all_page_id=${pageId}`;

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) return setMsg("Mínimo 10 caracteres.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setMsg(error.message);
    else {
      setMsg("Contraseña actualizada.");
      setTimeout(onDone, 1200);
    }
  };
  return (
    <form className="card pw" onSubmit={save}>
      <label>
        Nueva contraseña
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <button className="primary">Guardar</button>
      {msg && <span className="muted">{msg}</span>}
    </form>
  );
}
