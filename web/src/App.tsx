import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { iso, addDays } from "./lib/format";
import { EXCLUIR_OUTLIERS_POR_DEFECTO, FECHA_INICIO_DATOS, FILTROS_VACIOS, opcionesFiltros, type DashDatos, type Filtros, type FiltrosPago } from "./lib/metricas";
import { Seg } from "./components/ui";
import { Resumen } from "./components/tabs/Resumen";
import { Equipo } from "./components/tabs/Equipo";
import { Seguimientos } from "./components/tabs/Seguimientos";
import { Metas } from "./components/tabs/Metas";
import { Tendencias } from "./components/tabs/Tendencias";
import { Ciclo } from "./components/tabs/Ciclo";
import { Cobranza } from "./components/tabs/Cobranza";
import { Hoy } from "./components/tabs/Hoy";
import { Ads } from "./components/tabs/Ads";
import { CentroComercial } from "./components/CentroComercial";

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
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <p className="error">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}

// ───────── Período ─────────
type Preset = "today" | "yesterday" | "7" | "14" | "30" | "month" | "lastmonth" | "all" | "custom";
const PRESETS: [Preset, string][] = [
  ["today", "Hoy"], ["yesterday", "Ayer"], ["7", "7 días"], ["14", "14 días"], ["30", "30 días"],
  ["month", "Este mes"], ["lastmonth", "Mes pasado"], ["all", "Histórico"], ["custom", "Personalizado"],
];
const clamp = (d: string) => (d < FECHA_INICIO_DATOS ? FECHA_INICIO_DATOS : d);
function rangeFor(p: Preset): [string, string] {
  const t = new Date();
  switch (p) {
    case "today": return [iso(t), iso(t)];
    case "yesterday": return [iso(addDays(t, -1)), iso(addDays(t, -1))];
    case "month": return [clamp(iso(new Date(t.getFullYear(), t.getMonth(), 1))), iso(t)];
    case "lastmonth": return [clamp(iso(new Date(t.getFullYear(), t.getMonth() - 1, 1))), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
    case "all": return [FECHA_INICIO_DATOS, iso(t)]; // Histórico = desde el 01/10/2026
    default: return [clamp(iso(addDays(t, -(Number(p) - 1)))), iso(t)];
  }
}

// ───────── Pestañas ─────────
type Tab = "resumen" | "equipo" | "seguimientos" | "metas" | "tendencias" | "ciclo" | "cobranza" | "hoy" | "ads" | "centro";
const TABS: [Tab, string][] = [
  ["resumen", "Resumen"], ["equipo", "Equipo"], ["seguimientos", "Seguimientos"], ["metas", "Metas"], ["tendencias", "Tendencias"],
  ["ciclo", "Ciclo"], ["cobranza", "Cobranza"], ["hoy", "Hoy"], ["ads", "Ads"], ["centro", "Centro comercial"],
];
const SIN_PERIODO: Tab[] = ["hoy", "centro"];

// ───────── Estado en la URL (filtros, pestaña y período se comparten con el enlace) ─────────
function leerURL() {
  const q = new URLSearchParams(location.search);
  const preset = (q.get("p") as Preset) || "month";
  const [f0, t0] = rangeFor(preset === "custom" ? "month" : preset);
  let pf: FiltrosPago = {};
  try { pf = JSON.parse(q.get("mf") || "{}"); } catch { pf = {}; }
  const viejo: Record<string, Tab> = { comercial: "resumen", cierre: "hoy", midia: "hoy" };
  const tabQ = q.get("tab") ?? "";
  return {
    tab: (viejo[tabQ] ?? (TABS.some(([k]) => k === tabQ) ? tabQ : "resumen")) as Tab,
    preset,
    from: preset === "custom" ? clamp(q.get("desde") || f0) : f0,
    to: preset === "custom" ? q.get("hasta") || t0 : t0,
    f: { producto: (q.get("producto") as Filtros["producto"]) || "Todos", closer: q.get("closer") || "Todos", tier: q.get("tier") || "Todos", fuente: q.get("fuente") || "Todas" } as Filtros,
    ciclo: (q.get("ciclo") === "pago" ? "pago" : "embudo") as "embudo" | "pago",
    pf,
    outliers: q.get("outliers") == null ? EXCLUIR_OUTLIERS_POR_DEFECTO : q.get("outliers") === "1",
  };
}

export function Dashboard({ email }: { email: string }) {
  const ini = useMemo(leerURL, []);
  const [tab, setTab] = useState<Tab>(ini.tab);
  const [preset, setPreset] = useState<Preset>(ini.preset);
  const [[from, to], setRange] = useState<[string, string]>([ini.from, ini.to]);
  const [f, setF] = useState<Filtros>(ini.f);
  const [cicloVista, setCicloVista] = useState(ini.ciclo);
  const [pf, setPf] = useState<FiltrosPago>(ini.pf);
  const [outliers, setOutliers] = useState(ini.outliers);
  const [d, setD] = useState<DashDatos | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showPw, setShowPw] = useState(false);

  // Datos crudos (una sola foto para todas las pestañas)
  useEffect(() => {
    let vivo = true;
    supabase.rpc("dash_datos").then(({ data, error }) => {
      if (!vivo) return;
      setErr(error?.message ?? null);
      if (data) setD(data as DashDatos);
    });
    return () => { vivo = false; };
  }, [reloadKey]);

  const rol = d?.rol ?? null;
  const esCloser = rol === "closer";
  const esOwner = rol === "owner";
  // Un closer ve solo lo suyo: el filtro Closer queda fijo en él (la base también lo filtra)
  const fEf: Filtros = useMemo(() => (d?.closer_fijo ? { ...f, closer: d.closer_fijo } : f), [f, d?.closer_fijo]);
  const tabs = TABS.filter(([k]) => k !== "ads" || esOwner);

  useEffect(() => { if (preset !== "custom") setRange(rangeFor(preset)); }, [preset]);

  // Sincroniza la URL
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("tab", tab); q.set("p", preset);
    if (preset === "custom") { q.set("desde", from); q.set("hasta", to); }
    if (f.producto !== "Todos") q.set("producto", f.producto);
    if (f.closer !== "Todos") q.set("closer", f.closer);
    if (f.tier !== "Todos") q.set("tier", f.tier);
    if (f.fuente !== "Todas") q.set("fuente", f.fuente);
    if (tab === "ciclo") { q.set("ciclo", cicloVista); if (Object.values(pf).some((v) => v.length)) q.set("mf", JSON.stringify(pf)); if (outliers !== EXCLUIR_OUTLIERS_POR_DEFECTO) q.set("outliers", outliers ? "1" : "0"); }
    history.replaceState(null, "", `${location.pathname}?${q}`);
  }, [tab, preset, from, to, f, cicloVista, pf, outliers]);

  // Actualizar: trae GHL y Meta al momento y recarga
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase.rpc("refresh_now");
    if (!error) {
      const since = new Date((data as string | null) ?? Date.now() - 180_000).getTime();
      for (let i = 0; i < 18; i++) {
        await new Promise((r) => setTimeout(r, 10_000));
        const s = await supabase.rpc("sync_status");
        const g = ((s.data ?? []) as { source: string; last_ok: string | null }[]).find((x) => x.source === "ghl");
        if (g?.last_ok && new Date(g.last_ok).getTime() >= since) break;
      }
    }
    setRefreshing(false);
    setReloadKey((k) => k + 1);
  }, []);

  const opts = d ? opcionesFiltros(d) : { closers: [], tiers: ["S", "A", "B", "C"], fuentes: ["Ads", "Orgánico", "Referidos", "Afiliados"] };
  const hayFiltros = f.producto !== "Todos" || (!d?.closer_fijo && f.closer !== "Todos") || f.tier !== "Todos" || f.fuente !== "Todas";
  const ultima = d?.sync?.ghl ? new Date(d.sync.ghl).toLocaleString("es", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const props = d ? { d, f: fEf, from, to } : null;

  return (
    <div className="app">
      <header className="barra">
        <div className="barra-1">
          <span className="brand">WaySuccess</span>
          <nav className="pestanas" role="tablist" aria-label="Sección">
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
          </nav>
          <span className="barra-user">
            <span className="muted" title={`Tracker: ${d?.tracker.sincronizado ? new Date(d.tracker.sincronizado).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "—"}`}>GHL {ultima}</span>
            <button className="link" onClick={refresh} disabled={refreshing}>{refreshing ? "Actualizando…" : "Actualizar"}</button>
            <button className="link" onClick={() => setShowPw((v) => !v)} title={email}>Contraseña</button>
            <button className="link" onClick={() => supabase.auth.signOut()}>Salir</button>
          </span>
        </div>
        <div className="barra-2">
          {!SIN_PERIODO.includes(tab) && (
            <>
              <Seg label="Período" value={preset} onChange={setPreset} options={PRESETS} />
              {preset === "custom" && (
                <span className="dates">
                  <input type="date" value={from} min={FECHA_INICIO_DATOS} max={to} onChange={(e) => setRange([clamp(e.target.value), to])} />
                  <span className="muted">a</span>
                  <input type="date" value={to} min={from} onChange={(e) => setRange([from, e.target.value])} />
                </span>
              )}
            </>
          )}
          <Seg label="Producto" className="seg-oferta" value={f.producto} onChange={(v) => setF({ ...f, producto: v })} options={[["Todos", "Todos"], ["DFY", "DFY $30k"], ["JessiK", "JessiK"]] as const} />
          {!d?.closer_fijo && <Seg label="Closer" value={f.closer} onChange={(v) => setF({ ...f, closer: v })} options={[["Todos", "Todos"], ...opts.closers.map((c) => [c, c] as const)] as const} />}
          <Seg label="Tier setter" value={f.tier} onChange={(v) => setF({ ...f, tier: v })} options={[["Todos", "Todos"], ...opts.tiers.map((t) => [t, t] as const)] as const} />
          <select className="select" aria-label="Fuente" value={f.fuente} onChange={(e) => setF({ ...f, fuente: e.target.value })}>
            <option value="Todas">Fuente: todas</option>
            {opts.fuentes.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          {hayFiltros && <button className="link" onClick={() => setF({ ...FILTROS_VACIOS, closer: d?.closer_fijo ?? "Todos" })}>Limpiar filtros</button>}
        </div>
      </header>
      {showPw && <ChangePassword onDone={() => setShowPw(false)} />}
      <main className="contenido">
        {err && <p className="error">Error: {err}</p>}
        {tab === "centro" ? <CentroComercial isOwner={esOwner} reloadKey={reloadKey} />
          : tab === "ads" && esOwner ? <Ads from={from} to={to} reloadKey={reloadKey} />
          : !props ? <div className="vacio">Cargando datos…</div>
          : tab === "resumen" ? <Resumen {...props} />
          : tab === "equipo" ? <Equipo {...props} reloadKey={reloadKey} irASeguimientos={(c) => { setF({ ...f, closer: c }); setTab("seguimientos"); }} />
          : tab === "seguimientos" ? <Seguimientos d={props.d} f={props.f} setCloser={(c) => setF({ ...f, closer: c })} />
          : tab === "metas" ? <Metas {...props} />
          : tab === "tendencias" ? <Tendencias {...props} />
          : tab === "ciclo" ? <Ciclo {...props} vista={cicloVista} setVista={setCicloVista} pf={pf} setPf={setPf} outliers={outliers} setOutliers={setOutliers} />
          : tab === "cobranza" ? <Cobranza {...props} />
          : tab === "hoy" ? <Hoy d={props.d} f={props.f} reloadKey={reloadKey} esCloser={esCloser} />
          : null}
      </main>
    </div>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) return setMsg("Mínimo 10 caracteres.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setMsg(error.message);
    else { setMsg("Contraseña actualizada."); setTimeout(onDone, 1200); }
  };
  return (
    <form className="card pw" onSubmit={save}>
      <label>Nueva contraseña<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <button className="primary">Guardar</button>
      {msg && <span className="muted">{msg}</span>}
    </form>
  );
}
