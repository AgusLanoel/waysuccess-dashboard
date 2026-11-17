import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { iso, addDays } from "./lib/format";
import { FECHA_INICIO_DATOS, FILTROS_VACIOS, opcionesFiltros, type DashDatos, type Filtros } from "./lib/metricas";
import { Seg } from "./components/ui";
import { BASE, PaletaContext, escala, varsPestana } from "./lib/paleta";
import { Resumen } from "./components/tabs/Resumen";
import { Equipo } from "./components/tabs/Equipo";
import { Seguimientos } from "./components/tabs/Seguimientos";
import { Metas } from "./components/tabs/Metas";
import { Cobranza } from "./components/tabs/Cobranza";
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
// Atajos dentro de "Personalizado" (14-11: en la barra solo quedan Hoy · Ayer · Personalizado)
const ATAJOS: [Preset, string][] = [["7", "7 días"], ["14", "14 días"], ["30", "30 días"], ["month", "Este mes"], ["lastmonth", "Mes pasado"], ["all", "Oct + Nov"]];
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const etiquetaPeriodo = (p: Preset, from: string, to: string) => ATAJOS.find(([k]) => k === p)?.[1] ?? `${dm(from)} – ${dm(to)}`;
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
// 16-11 (dueño): fuera Tendencias, Ciclo, Clientes, Números, Gráficos y Hoy (Hoy ya es un filtro de período)
type Tab = "resumen" | "equipo" | "seguimientos" | "metas" | "cobranza" | "ads" | "centro";
const TABS: [Tab, string][] = [
  ["resumen", "Resumen"], ["equipo", "Equipo"], ["seguimientos", "Seguimientos"], ["metas", "Metas"], ["cobranza", "Cobranza"], ["ads", "Ads"], ["centro", "Centro comercial"],
];
const SIN_PERIODO: Tab[] = ["centro"];

// ───────── Estado en la URL (filtros, pestaña y período se comparten con el enlace) ─────────
function leerURL() {
  const q = new URLSearchParams(location.search);
  const preset = (q.get("p") as Preset) || "today"; // 14-11: por defecto Hoy
  const [f0, t0] = rangeFor(preset === "custom" ? "today" : preset);
  const viejo: Record<string, Tab> = { comercial: "resumen" };
  const tabQ = q.get("tab") ?? "";
  return {
    tab: (viejo[tabQ] ?? (TABS.some(([k]) => k === tabQ) ? tabQ : "resumen")) as Tab,
    preset,
    from: preset === "custom" ? clamp(q.get("desde") || f0) : f0,
    to: preset === "custom" ? q.get("hasta") || t0 : t0,
    f: { producto: (q.get("producto") as Filtros["producto"]) || "Todos", closer: q.get("closer") || "Todos", tier: q.get("tier") || "Todos", fuente: q.get("fuente") || "Todas" } as Filtros,
  };
}

export function Dashboard({ email }: { email: string }) {
  const ini = useMemo(leerURL, []);
  const [tab, setTab] = useState<Tab>(ini.tab);
  const [preset, setPreset] = useState<Preset>(ini.preset);
  const [[from, to], setRange] = useState<[string, string]>([ini.from, ini.to]);
  const [f, setF] = useState<Filtros>(ini.f);
  const [d, setD] = useState<DashDatos | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const versionNueva = useVersionNueva();
  const [panel, setPanel] = useState<null | "periodo" | "filtros">(null);
  const [borrador, setBorrador] = useState<[string, string]>([from, to]);
  useEffect(() => { if (panel === "periodo") setBorrador([from, to]); }, [panel]); // eslint-disable-line react-hooks/exhaustive-deps
  const personalizado = preset !== "today" && preset !== "yesterday";

  // Datos crudos (una sola foto para todas las pestañas)
  useEffect(() => {
    let vivo = true;
    supabase.rpc("dash_datos").then(({ data, error }) => {
      if (!vivo) return;
      setErr(error?.message ?? null);
      if (data) {
        const dd = data as DashDatos;
        // 16-11: el 15-11 se crearon en GHL 9 oportunidades "Ganadas" duplicadas de clientes de octubre, sin email ni teléfono
        // y sin fecha de cierre (caían el 15-11 e inflaban noviembre de 3 a 12). Una oportunidad sin contacto no cuenta.
        dd.opps = dd.opps.filter((o) => o.email || o.telefono);
        setD(dd);
      }
    });
    return () => { vivo = false; };
  }, [reloadKey]);

  const rol = d?.rol ?? null;
  const esOwner = rol === "owner";
  // Un closer ve solo lo suyo: el filtro Closer queda fijo en él (la base también lo filtra)
  const fEf: Filtros = useMemo(() => (d?.closer_fijo ? { ...f, closer: d.closer_fijo } : f), [f, d?.closer_fijo]);
  // 17-11 (dueño + Rod): dashboard ejecutivo = Resumen · Equipo · Ads (lo que se revisa los lunes; solo owners).
  // Closer: solo sus números (Equipo filtrado a él) + sus seguimientos y cobranza. Laura (finanzas): lo operativo,
  // hasta que Rod lo monte en su project tracker.
  const PORROL: Record<string, Tab[]> = {
    owner: ["resumen", "equipo", "ads"],
    closer: ["equipo", "seguimientos", "cobranza"],
    finanzas: ["equipo", "seguimientos", "metas", "cobranza"],
  };
  const permitidas = PORROL[rol ?? ""] ?? [];
  const tabs = TABS.filter(([k]) => permitidas.includes(k)).map(([k, l]) => [k, rol === "closer" && k === "equipo" ? "Mis números" : l] as [Tab, string]);
  useEffect(() => { if (rol && !permitidas.includes(tab) && permitidas.length) setTab(permitidas[0]); }, [rol]); // eslint-disable-line react-hooks/exhaustive-deps

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
    history.replaceState(null, "", `${location.pathname}?${q}`);
  }, [tab, preset, from, to, f]);

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
  // Filtros activos → contador del botón y chips con ✕
  const activos: { k: keyof Filtros; label: string; vacio: string }[] = [
    f.producto !== "Todos" ? { k: "producto" as const, label: `Producto: ${f.producto === "DFY" ? "DFY $30k" : "JessiK"}`, vacio: "Todos" } : null,
    !d?.closer_fijo && f.closer !== "Todos" ? { k: "closer" as const, label: `Closer: ${f.closer}`, vacio: "Todos" } : null,
    f.tier !== "Todos" ? { k: "tier" as const, label: `Tier: ${f.tier}`, vacio: "Todos" } : null,
    f.fuente !== "Todas" ? { k: "fuente" as const, label: `Fuente: ${f.fuente}`, vacio: "Todas" } : null,
  ].filter((x): x is { k: keyof Filtros; label: string; vacio: string } => !!x);
  const nActivos = activos.length;
  const ultima = d?.sync?.ghl ? new Date(d.sync.ghl).toLocaleString("es", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const props = d ? { d, f: fEf, from, to } : null;

  return (
    <PaletaContext.Provider value={escala(BASE[tab])}>
    <div className="app" data-tab={tab} style={varsPestana(tab) as React.CSSProperties}>
      <header className="barra">
        <div className="barra-1">
          <span className="brand">WaySuccess</span>
          <nav className="pestanas" role="tablist" aria-label="Sección">
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} style={{ "--c": BASE[k], "--c-claro": escala(BASE[k])[3] } as React.CSSProperties} onClick={() => setTab(k)}><i className="punto" />{l}</button>)}
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
            <span className="ancla">
              <span className="seg" role="tablist" aria-label="Período">
                <button role="tab" aria-selected={preset === "today"} className={preset === "today" ? "on" : ""} onClick={() => { setPreset("today"); setPanel(null); }}>Hoy</button>
                <button role="tab" aria-selected={preset === "yesterday"} className={preset === "yesterday" ? "on" : ""} onClick={() => { setPreset("yesterday"); setPanel(null); }}>Ayer</button>
                <button role="tab" aria-selected={personalizado} className={personalizado ? "on" : ""} onClick={() => setPanel(panel === "periodo" ? null : "periodo")}>
                  {personalizado ? etiquetaPeriodo(preset, from, to) : "Personalizado"} ▾
                </button>
              </span>
              {panel === "periodo" && (
                <div className="popover" role="dialog" aria-label="Elegir período">
                  <div className="atajos">
                    {ATAJOS.map(([p, l]) => <button key={p} className={preset === p ? "on" : ""} onClick={() => { setPreset(p); setPanel(null); }}>{l}</button>)}
                  </div>
                  <div className="rango">
                    <label>Desde<input type="date" value={borrador[0]} min={FECHA_INICIO_DATOS} max={borrador[1]} onChange={(e) => setBorrador([e.target.value, borrador[1]])} /></label>
                    <label>Hasta<input type="date" value={borrador[1]} min={borrador[0]} onChange={(e) => setBorrador([borrador[0], e.target.value])} /></label>
                  </div>
                  <div className="pop-acciones">
                    <button className="link" onClick={() => setPanel(null)}>Cancelar</button>
                    <button className="primary" onClick={() => { setPreset("custom"); setRange([clamp(borrador[0]), borrador[1] < borrador[0] ? borrador[0] : borrador[1]]); setPanel(null); }}>Aplicar</button>
                  </div>
                </div>
              )}
            </span>
          )}
          <span className="ancla">
            <button className={`btn-filtros ${nActivos ? "on" : ""}`} onClick={() => setPanel(panel === "filtros" ? null : "filtros")}>
              Filtros{nActivos ? ` · ${nActivos}` : ""} ▾
            </button>
            {panel === "filtros" && (
              <div className="popover" role="dialog" aria-label="Filtros">
                <div className="filtro-fila"><span>Producto</span><Seg label="Producto" className="seg-oferta" value={f.producto} onChange={(v) => setF({ ...f, producto: v })} options={[["Todos", "Todos"], ["DFY", "DFY $30k"], ["JessiK", "JessiK"]] as const} /></div>
                {!d?.closer_fijo && <div className="filtro-fila"><span>Closer</span><Seg label="Closer" value={f.closer} onChange={(v) => setF({ ...f, closer: v })} options={[["Todos", "Todos"], ...opts.closers.map((c) => [c, c] as const)] as const} /></div>}
                <div className="filtro-fila"><span>Tier</span><Seg label="Tier setter" value={f.tier} onChange={(v) => setF({ ...f, tier: v })} options={[["Todos", "Todos"], ...opts.tiers.map((t) => [t, t] as const)] as const} /></div>
                <div className="filtro-fila"><span>Fuente</span><Seg label="Fuente" value={f.fuente} onChange={(v) => setF({ ...f, fuente: v })} options={[["Todas", "Todas"], ...opts.fuentes.map((x) => [x, x] as const)] as const} /></div>
                <div className="pop-acciones">
                  <button className="link" onClick={() => { setF({ ...FILTROS_VACIOS, closer: d?.closer_fijo ?? "Todos" }); }}>Limpiar todo</button>
                  <button className="primary" onClick={() => setPanel(null)}>Listo</button>
                </div>
              </div>
            )}
          </span>
          {nActivos > 0 && (
            <span className="chips">
              {activos.map((a) => <span key={a.k} className="chip-filtro">{a.label}<button aria-label={`Quitar ${a.label}`} onClick={() => setF({ ...f, [a.k]: a.vacio })}>✕</button></span>)}
            </span>
          )}
        </div>
        {panel && <div className="cerrar-pop" onClick={() => setPanel(null)} />}
      </header>
      {versionNueva && (
        <div className="aviso-version">
          Hay una versión nueva del dashboard.
          <button className="primary" onClick={() => location.reload()}>Recargar</button>
        </div>
      )}
      {showPw && <ChangePassword onDone={() => setShowPw(false)} />}
      <main className="contenido">
        {err && <p className="error">Error: {err}</p>}
        {d && !permitidas.includes(tab) ? <div className="vacio">Sin acceso a esta sección.</div>
          : tab === "centro" ? <CentroComercial isOwner={esOwner} reloadKey={reloadKey} />
          : tab === "ads" && esOwner ? <Ads from={from} to={to} reloadKey={reloadKey} />
          : !props ? <div className="vacio">Cargando datos…</div>
          : tab === "resumen" ? <Resumen {...props} />
          : tab === "equipo" ? <Equipo {...props} reloadKey={reloadKey} irASeguimientos={(c) => { setF({ ...f, closer: c }); setTab("seguimientos"); }} />
          : tab === "seguimientos" ? <Seguimientos d={props.d} f={props.f} setCloser={(c) => setF({ ...f, closer: c })} />
          : tab === "metas" ? <Metas {...props} />
          : tab === "cobranza" ? <Cobranza {...props} />
          : null}
      </main>
    </div>
    </PaletaContext.Provider>
  );
}

// Avisa cuando se publicó una versión nueva y la pestaña sigue con la vieja (14-11: Luca seguía viendo el diseño anterior).
// Compara el bundle cargado con el que sirve hoy index.html; en desarrollo no hay bundle y no hace nada.
function useVersionNueva() {
  const [nueva, setNueva] = useState(false);
  useEffect(() => {
    const actual = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.getAttribute("src");
    if (!actual) return;
    const revisar = () =>
      fetch("/", { cache: "no-store" }).then((r) => r.text()).then((html) => {
        const m = html.match(/\/assets\/index-[\w-]+\.js/);
        if (m && !actual.endsWith(m[0])) setNueva(true);
      }).catch(() => {});
    const id = setInterval(revisar, 5 * 60_000);
    const alVolver = () => document.visibilityState === "visible" && revisar();
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", alVolver); };
  }, []);
  return nueva;
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
