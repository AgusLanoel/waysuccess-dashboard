import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money, num, pct, ratio } from "../../lib/format";
import { nombrePiezaIG, type PiezaIG } from "./OrganicoIG";

// 28-11: métricas tipo ManyChat de las automatizaciones de IG + A/B testing.
// Embudo: comentarios con palabra → aperturas → tocaron el botón → links → clics (CTR) → quiz → agendas → calificadas → cierres.
// Arriba del embudo por fecha del DM de apertura; agendas/calificadas/cierres con las MISMAS reglas que el Resumen
// (org_base_base: 1ra agenda calificada por fecha de reserva, 1ra asistencia, cierres por fecha de cierre).
// Los tests los crea y arranca el dueño desde acá; ninguno arranca solo.

interface Fila {
  clave: string; comentarios: number; personas_coment: number; aperturas: number; fallidas: number; reemplazadas: number; personas: number; repetidos: number;
  toques: number; links: number; link_fallidos: number; clics: number; clics_total: number; quiz_empezo: number; quiz_completo: number; calendario: number;
  agendas: number; calificadas: number; ventas: number; cobrado: number; seg_apertura: number | null; seg_link: number | null; errores: Record<string, number>;
}
interface Variante { id: number; letra: string; nombre: string | null; mensaje_apertura: string | null; boton_apertura: string | null; mensaje: string | null; boton_link: string | null; destino: string | null; peso: number; asignados: number }
interface Test { id: number; automatizacion_id: number; automatizacion: string; nombre: string; metrica: "toque" | "clic" | "agenda"; estado: "borrador" | "corriendo" | "pausado" | "cerrado"; iniciado_at: string | null; cerrado_at: string | null; ganadora_id: number | null; variantes: Variante[] }
interface FilaAB { variante_id: number; letra: string; nombre: string | null; peso: number; asignados: number; aperturas: number; fallidas: number; toques: number; links: number; clics: number; quiz_completo: number; agendas: number; calificadas: number; ventas: number; cobrado: number }
interface AutoMin { id: number; nombre: string; activa: boolean; recordatorio_activo?: boolean; recordatorio_horas?: number; recordatorio_texto?: string | null; boton_apertura?: string | null }
interface Alerta { dia: string; intentos: number; fallidas: number; pct: number }

type Por = "auto" | "pieza" | "saludo";
const NUMS: (keyof Fila)[] = ["comentarios", "personas_coment", "aperturas", "fallidas", "reemplazadas", "personas", "repetidos", "toques", "links", "link_fallidos", "clics", "clics_total", "quiz_empezo", "quiz_completo", "calendario", "agendas", "calificadas", "ventas", "cobrado"];
const SALUDO: Record<string, string> = { nombre_api: "Nombre del perfil", nombre_usuario: "Nombre sacado del usuario", sin_nombre: "Sin nombre (¡Hola!)", arroba: "@usuario", "sin dato": "Sin dato" };
const METRICA: Record<Test["metrica"], string> = { toque: "Tocaron el botón ÷ aperturas", clic: "Clics en el link ÷ aperturas", agenda: "Agendas ÷ aperturas" };
const ESTADO: Record<Test["estado"], string> = { borrador: "Borrador", corriendo: "Corriendo", pausado: "Pausado", cerrado: "Cerrado" };
const seg = (s: number | null) => (s == null ? "—" : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1).replace(".", ",")} h`);

// ───────── estadística A/B ─────────
// P(B > A) con posteriores Beta(1+éxitos, 1+fracasos) por Monte Carlo (Marsaglia-Tsang para la gamma)
function gamma(k: number): number {
  if (k < 1) return gamma(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { const u1 = Math.random(), u2 = Math.random(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const beta = (a: number, b: number) => { const x = gamma(a); return x / (x + gamma(b)); };
export function probGana(xa: number, na: number, xb: number, nb: number, n = 20000) {
  if (!na || !nb) return null;
  let g = 0;
  for (let i = 0; i < n; i++) if (beta(1 + xb, 1 + nb - xb) > beta(1 + xa, 1 + na - xa)) g++;
  return g / n;
}
// muestra mínima por variante para detectar una mejora relativa de 20 % (95 % confianza, 80 % potencia)
export function muestraMinima(p: number, mejora = 0.2) {
  if (!(p > 0 && p < 1)) return null;
  const p2 = Math.min(0.99, p * (1 + mejora));
  return Math.ceil(((1.96 + 0.8416) ** 2 * (p * (1 - p) + p2 * (1 - p2))) / (p2 - p) ** 2);
}
const exitos = (r: FilaAB, m: Test["metrica"]) => (m === "toque" ? r.toques : m === "clic" ? r.clics : r.agendas);
const MIN_APERTURAS = 100;

function Paso({ label, n, base, nota, max }: { label: string; n: number; base?: number; nota?: string; max: number }) {
  return (
    <li>
      <span className="funnel-label">{label}</span>
      <span className="funnel-track"><span className="funnel-bar" style={{ width: `${max ? Math.max(2, (n / max) * 100) : 0}%` }} /></span>
      <span className="funnel-n">{num(n)}</span>
      <span className="funnel-rate">{base != null ? pct(ratio(n, base), 0) : ""}{nota ? ` ${nota}` : ""}</span>
    </li>
  );
}

function EmbudoCard({ f, titulo, thumb, link }: { f: Fila; titulo: string; thumb?: string | null; link?: string | null }) {
  const efectivas = f.aperturas - f.reemplazadas;
  const max = Math.max(f.comentarios, f.aperturas, 1);
  const errTot = f.fallidas + f.link_fallidos;
  return (
    <article className="card auto-embudo" style={{ ["--tone" as string]: "#8a5cf6", ["--tone-soft" as string]: "color-mix(in srgb, #8a5cf6 14%, var(--surface-2))" }}>
      <header className="ae-head">
        <div className="name-cell">{thumb && <img className="thumb" src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />}<div><b className="auto-nombre">{titulo}</b>{link && <div><a className="muted small" href={link} target="_blank" rel="noreferrer">Ver en Instagram</a></div>}</div></div>
        <div className="ae-kpis">
          <span title="Tocaron el botón ÷ aperturas (sin contar las reemplazadas por un comentario posterior de la misma persona)"><b>{pct(ratio(f.toques, efectivas), 0)}</b> tap rate</span>
          <span title="Personas que abrieron su link ÷ links enviados"><b>{pct(ratio(f.clics, f.links), 0)}</b> CTR</span>
          <span title="Personas que abrieron su link ÷ aperturas enviadas"><b>{pct(ratio(f.clics, f.aperturas), 1)}</b> clic/apertura</span>
        </div>
      </header>
      <ul className="funnel">
        {f.comentarios > 0 && <Paso label="Comentarios" n={f.comentarios} max={max} nota={`· ${num(f.personas_coment)} personas`} />}
        <Paso label="Aperturas" n={f.aperturas} base={f.comentarios || undefined} max={max} nota={f.fallidas ? `· ${num(f.fallidas)} fallidas` : ""} />
        <Paso label="Tocaron" n={f.toques} base={efectivas} max={max} />
        <Paso label="Links" n={f.links} base={f.toques} max={max} />
        <Paso label="Clics" n={f.clics} base={f.links} max={max} nota={f.clics_total > f.clics ? `· ${num(f.clics_total)} en total` : ""} />
        <Paso label="Quiz completo" n={f.quiz_completo} base={f.clics} max={max} nota={f.calendario ? `· ${num(f.calendario)} abrieron calendario` : ""} />
        <Paso label="Agendas" n={f.agendas} base={f.clics} max={max} />
        <Paso label="Calificadas" n={f.calificadas} base={f.agendas} max={max} />
        <Paso label="Cierres" n={f.ventas} base={f.calificadas} max={max} nota={f.cobrado ? `· ${money(f.cobrado)}` : ""} />
      </ul>
      <footer className="ae-pie">
        <span title="Mediana entre el comentario y el DM de apertura">⏱ comentario→apertura <b>{seg(f.seg_apertura)}</b></span>
        <span title="Mediana entre el toque del botón y el link (se mide desde el 28-11)">toque→link <b>{seg(f.seg_link)}</b></span>
        <span>👤 {num(f.personas)} únicos · {num(f.repetidos)} repetidos</span>
        <span className={errTot && errTot / Math.max(1, f.aperturas + f.toques) > 0.1 ? "error" : ""} title={Object.entries(f.errores).map(([k, v]) => `${v}× ${k}`).join("\n")}>⚠ errores {pct(ratio(errTot, f.aperturas + f.fallidas + f.toques), 0)}{errTot ? ` (${num(errTot)})` : ""}</span>
      </footer>
      {errTot > 0 && <details className="small"><summary>Motivos de error</summary><ul>{Object.entries(f.errores).map(([k, v]) => <li key={k}>{num(v)}× {k}</li>)}</ul></details>}
    </article>
  );
}

const VACIA = { nombre: "", mensaje_apertura: "", boton_apertura: "", mensaje: "", boton_link: "", destino: "", peso: 50 };

function EditorVariante({ test, v, onListo }: { test: Test; v: Variante | null; onListo: (msg?: string) => void }) {
  const base = test.variantes[0];
  const [f, setF] = useState(() => v ? { nombre: v.nombre ?? "", mensaje_apertura: v.mensaje_apertura ?? "", boton_apertura: v.boton_apertura ?? "", mensaje: v.mensaje ?? "", boton_link: v.boton_link ?? "", destino: v.destino ?? "", peso: v.peso } : { ...VACIA, mensaje_apertura: base?.mensaje_apertura ?? "", boton_apertura: base?.boton_apertura ?? "", mensaje: base?.mensaje ?? "", boton_link: base?.boton_link ?? "", destino: base?.destino ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [g, setG] = useState(false);
  const bloqueado = !!v && v.asignados > 0;
  const guardar = async () => {
    setG(true);
    const { error } = await supabase.rpc("org_auto_variante_guardar", { p_id: v?.id ?? null, p_test: test.id, p_nombre: f.nombre, p_apertura: f.mensaje_apertura, p_boton_apertura: f.boton_apertura, p_mensaje: f.mensaje, p_boton_link: f.boton_link, p_destino: f.destino, p_peso: f.peso });
    setG(false);
    if (error) setErr(error.message); else onListo();
  };
  return (
    <div className="auto-form ab-editor">
      <h3>{v ? `Variante ${v.letra}` : "Nueva variante"}{bloqueado && <span className="muted small"> · ya tiene {num(v!.asignados)} personas: solo se cambia el peso</span>}</h3>
      <label>Nombre<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Saludo corto" /></label>
      <label>1 · DM de apertura <span className="muted">{"{nombre}"} = nombre de pila o nada · {"{nombre_o_usuario}"} = nombre o @usuario · {"{palabra}"}</span><textarea rows={5} disabled={bloqueado} value={f.mensaje_apertura} onChange={(e) => setF({ ...f, mensaje_apertura: e.target.value })} /></label>
      <label>Botón de la apertura <span className="muted">(máx. 20)</span><input disabled={bloqueado} maxLength={20} value={f.boton_apertura} onChange={(e) => setF({ ...f, boton_apertura: e.target.value })} /> <span className="muted small">{f.boton_apertura.length}/20</span></label>
      <label>2 · DM con el link <span className="muted">{"{link}"} = link único</span><textarea rows={4} disabled={bloqueado} value={f.mensaje} onChange={(e) => setF({ ...f, mensaje: e.target.value })} /></label>
      <label>Texto antes del link <span className="muted">(máx. 20 · si el mensaje no tiene {"{link}"})</span><input disabled={bloqueado} maxLength={20} value={f.boton_link} onChange={(e) => setF({ ...f, boton_link: e.target.value })} /></label>
      <label>Destino del link<input disabled={bloqueado} value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })} placeholder="https://www.waysuccess.io/" /></label>
      <label>Peso <span className="muted">(reparto: 50 y 50 = mitad y mitad)</span><input type="number" min={0} max={100} value={f.peso} onChange={(e) => setF({ ...f, peso: Math.max(0, Math.min(100, +e.target.value || 0)) })} /></label>
      <div className="fila">
        <button className="primary" disabled={g} onClick={guardar}>{g ? "Guardando…" : "Guardar"}</button>
        <button className="link" onClick={() => onListo()}>Cancelar</button>
        {err && <span className="error small">{err}</span>}
      </div>
    </div>
  );
}

function TestCard({ t, onCambio }: { t: Test; onCambio: () => void }) {
  const [rows, setRows] = useState<FilaAB[]>([]);
  const [edit, setEdit] = useState<Variante | null | "nueva">(null);
  const [err, setErr] = useState<string | null>(null);
  const [ganadora, setGanadora] = useState<number | "">("");
  useEffect(() => {
    supabase.rpc("org_auto_ab", { p_test: t.id }).then(({ data, error }) => {
      if (error) setErr(error.message);
      setRows(((data ?? []) as FilaAB[]).map((r) => ({ ...r, cobrado: +r.cobrado })));
    });
  }, [t]);
  const ctrl = rows.find((r) => r.letra === "A");
  const stats = useMemo(() => rows.map((r) => {
    const tasa = ratio(exitos(r, t.metrica), r.aperturas);
    if (!ctrl || r.letra === "A") return { r, tasa, p: null as number | null, gana: false, pierde: false };
    const p = probGana(exitos(ctrl, t.metrica), ctrl.aperturas, exitos(r, t.metrica), r.aperturas);
    const muestra = r.aperturas >= MIN_APERTURAS && ctrl.aperturas >= MIN_APERTURAS;
    return { r, tasa, p, gana: !!(muestra && p != null && p >= 0.95), pierde: !!(muestra && p != null && p <= 0.05) };
  }), [rows, ctrl, t.metrica]);
  const necesita = ctrl ? muestraMinima(ratio(exitos(ctrl, t.metrica), ctrl.aperturas) ?? 0) : null;
  const sugerida = stats.find((s) => s.gana)?.r.variante_id ?? (stats.some((s) => s.pierde) ? ctrl?.variante_id : undefined);

  const accion = async (fn: string, args: Record<string, unknown>, confirmar?: string) => {
    if (confirmar && !window.confirm(confirmar)) return;
    const { error } = await supabase.rpc(fn, args);
    if (error) setErr(error.message); else { setErr(null); onCambio(); }
  };
  const cerrado = t.estado === "cerrado";
  return (
    <article className={`card ab-card ab-${t.estado}`}>
      <header className="ae-head">
        <div><b>{t.nombre}</b> <span className={`etapa ab-estado-${t.estado}`}>{ESTADO[t.estado]}</span><div className="muted small">{t.automatizacion} · gana por: {METRICA[t.metrica]}{t.iniciado_at ? ` · desde ${new Date(t.iniciado_at).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}` : ""}</div></div>
        {!cerrado && <div className="fila">
          {t.estado !== "corriendo"
            ? <button className="primary" onClick={() => accion("org_auto_test_estado", { p_test: t.id, p_estado: "corriendo" }, `¿Arrancar el test "${t.nombre}"? Desde ahora cada persona nueva que comente ${t.automatizacion} recibe una variante al azar (siempre la misma para esa persona).`)}>{t.estado === "pausado" ? "Reanudar" : "Arrancar"}</button>
            : <button className="btn-sec" onClick={() => accion("org_auto_test_estado", { p_test: t.id, p_estado: "pausado" })}>Pausar</button>}
        </div>}
      </header>
      {err && <p className="error small">{err}</p>}
      <div className="table-wrap">
        <table className="ab-tabla">
          <thead><tr><th className="name">Variante</th><th>Peso</th><th>Personas</th><th>Aperturas</th><th>Tap rate</th><th>CTR</th><th>Clic/apert.</th><th>Quiz</th><th>Agendas</th><th>Calif.</th><th>Cierres</th><th title={`Probabilidad de que le gane a la A en: ${METRICA[t.metrica]}`}>P(gana a A)</th><th></th></tr></thead>
          <tbody>
            {stats.map(({ r, p, gana, pierde }) => {
              const v = t.variantes.find((x) => x.id === r.variante_id);
              return (
                <tr key={r.variante_id} className={t.ganadora_id === r.variante_id ? "ab-ganadora" : ""}>
                  <td className="name"><b>{r.letra}</b> {r.nombre}{t.ganadora_id === r.variante_id && <span className="etapa e-pago"> Ganadora</span>}</td>
                  <td>{num(r.peso)}</td>
                  <td>{num(r.asignados)}</td>
                  <td>{num(r.aperturas)}</td>
                  <td>{pct(ratio(r.toques, r.aperturas), 0)}</td>
                  <td>{pct(ratio(r.clics, r.links), 0)}</td>
                  <td>{pct(ratio(r.clics, r.aperturas), 1)}</td>
                  <td>{num(r.quiz_completo)}</td>
                  <td>{num(r.agendas)}</td>
                  <td>{num(r.calificadas)}</td>
                  <td>{num(r.ventas)}{r.cobrado ? ` · ${money(r.cobrado)}` : ""}</td>
                  <td>{r.letra === "A" ? "control" : p == null ? "—" : <span className={gana ? "ab-si" : pierde ? "error" : ""}>{pct(p, 0)}{gana ? " ✓" : ""}</span>}</td>
                  <td>{!cerrado && v && <button className="link" onClick={() => setEdit(v)}>Editar</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small ab-nota">
        Se marca ganadora solo con ≥ 95 % de probabilidad y ≥ {MIN_APERTURAS} aperturas por variante.
        {necesita ? ` Para ver una mejora del 20 % sobre la A hacen falta ~${num(necesita)} aperturas por variante.` : ""}
        {t.variantes.some((v) => v.asignados > 0) ? "" : " Las variantes se pueden editar hasta que reciban la primera persona."}
      </p>
      {!cerrado && <div className="fila ab-acciones">
        <button className="btn-sec" onClick={() => setEdit("nueva")}>+ Variante</button>
        <select value={ganadora} onChange={(e) => setGanadora(e.target.value ? +e.target.value : "")} aria-label="Ganadora">
          <option value="">Cerrar test: elegir con qué variante se queda…</option>
          {rows.map((r) => <option key={r.variante_id} value={r.variante_id}>{r.letra} · {r.nombre}{r.variante_id === sugerida ? " (sugerida por los datos)" : ""}</option>)}
        </select>
        <button className="btn-sec" disabled={ganadora === ""} onClick={() => accion("org_auto_test_cerrar", { p_test: t.id, p_ganadora: ganadora }, "¿Cerrar el test? La variante elegida pasa a ser el texto de la automatización para todos. El historial queda guardado.")}>Cerrar test</button>
      </div>}
      {edit && <EditorVariante test={t} v={edit === "nueva" ? null : edit} onListo={() => { setEdit(null); onCambio(); }} />}
    </article>
  );
}

function Recordatorio({ a, onCambio }: { a: AutoMin; onCambio: () => void }) {
  const [f, setF] = useState({ activo: !!a.recordatorio_activo, horas: a.recordatorio_horas ?? 4, texto: a.recordatorio_texto ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const guardar = async () => {
    if (f.activo && !a.recordatorio_activo && !window.confirm("El recordatorio manda un mensaje nuevo a personas que no respondieron. ¿El dueño dio el OK para prenderlo?")) return;
    const { error } = await supabase.rpc("org_auto_recordatorio_guardar", { p_auto: a.id, p_activo: f.activo, p_horas: f.horas, p_texto: f.texto });
    if (error) setErr(error.message); else { setErr(null); onCambio(); }
  };
  return (
    <div className="ab-rec">
      <b>{a.nombre}</b>
      <label className="fila"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> {f.activo ? "Prendido" : "Apagado"}</label>
      <label>A las <input type="number" min={1} max={22} value={f.horas} onChange={(e) => setF({ ...f, horas: +e.target.value || 4 })} style={{ width: 56 }} /> horas sin respuesta</label>
      <input value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="¿Todavía quieres tus 30 guiones? Toca el botón 👇" />
      <button className="btn-sec" onClick={guardar}>Guardar</button>
      {err && <span className="error small">{err}</span>}
    </div>
  );
}

export function OrganicoAutomatizaciones({ from, to, reloadKey, piezas }: { from: string; to: string; reloadKey: number; piezas: Map<string, PiezaIG> }) {
  const [por, setPor] = useState<Por>("auto");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [autos, setAutos] = useState<AutoMin[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recarga, setRecarga] = useState(0);
  const [orden, setOrden] = useState<"ctr" | "agendas" | "aperturas">("aperturas");
  const [nuevo, setNuevo] = useState<{ auto: number | ""; nombre: string; metrica: Test["metrica"] } | null>(null);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    Promise.all([
      supabase.rpc("org_auto_embudo", { desde: from, hasta: to, p_por: por }),
      supabase.rpc("org_auto_alertas", { desde: from, hasta: to }),
      supabase.rpc("org_auto_tests_lista"),
      supabase.from("org_automatizaciones").select("id, nombre, activa, recordatorio_activo, recordatorio_horas, recordatorio_texto, boton_apertura").order("id"),
    ]).then(([e, a, t, au]) => {
      if (!vivo) return;
      setErr(e.error?.message ?? a.error?.message ?? t.error?.message ?? null);
      setFilas(((e.data ?? []) as Fila[]).map((x) => { const y = { ...x } as Record<string, unknown>; for (const k of NUMS) y[k] = +(x[k] as number); return { ...(y as unknown as Fila), seg_apertura: x.seg_apertura == null ? null : +x.seg_apertura, seg_link: x.seg_link == null ? null : +x.seg_link }; }));
      setAlertas(((a.data ?? []) as Alerta[]).map((x) => ({ ...x, pct: +x.pct })));
      setTests((t.data ?? []) as Test[]);
      setAutos((au.data ?? []) as AutoMin[]);
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [from, to, por, reloadKey, recarga]);

  const ordenadas = useMemo(() => {
    if (por !== "pieza") return filas;
    const k = (f: Fila) => (orden === "ctr" ? ratio(f.clics, f.links) ?? -1 : orden === "agendas" ? f.agendas * 1000 + f.clics : f.aperturas);
    return [...filas].sort((a, b) => k(b) - k(a));
  }, [filas, por, orden]);
  const tot = useMemo(() => filas.reduce((s, f) => ({ aperturas: s.aperturas + f.aperturas, toques: s.toques + f.toques, ef: s.ef + f.aperturas - f.reemplazadas, links: s.links + f.links, clics: s.clics + f.clics, agendas: s.agendas + f.agendas }), { aperturas: 0, toques: 0, ef: 0, links: 0, clics: 0, agendas: 0 }), [filas]);
  const malas = alertas.filter((a) => a.intentos >= 10 && a.pct > 0.1);
  const crear = async () => {
    if (!nuevo?.auto) return;
    const { error } = await supabase.rpc("org_auto_test_crear", { p_auto: nuevo.auto, p_nombre: nuevo.nombre, p_metrica: nuevo.metrica });
    if (error) setErr(error.message); else { setNuevo(null); setRecarga((n) => n + 1); }
  };
  const titulo = (f: Fila) => (por === "auto" ? f.clave : por === "saludo" ? SALUDO[f.clave] ?? f.clave : f.clave === "sin-pieza" ? "Sin publicación" : nombrePiezaIG(f.clave, piezas).slice(0, 80));

  return (
    <section className="ig-bloque auto-bloque">
      <div className="ig-head">
        <h2 className="section-title">Automatizaciones <span className="muted small">embudo, CTR y tests A/B</span></h2>
        <div className="estado-strip">
          <span className="estado ok">{num(tot.aperturas)} aperturas</span>
          <span className="estado">{pct(ratio(tot.toques, tot.ef), 0)} tap rate</span>
          <span className="estado">{pct(ratio(tot.clics, tot.links), 0)} CTR</span>
          <span className="estado">{num(tot.agendas)} agendas</span>
        </div>
      </div>
      {err && <p className="error">Error: {err}</p>}
      {malas.length > 0 && <p className="aviso error-aviso">⚠ Errores de entrega altos: {malas.map((m) => `${m.dia.slice(8, 10)}/${m.dia.slice(5, 7)} ${pct(m.pct, 0)} (${num(m.fallidas)} de ${num(m.intentos)})`).join(" · ")}. Revisa los motivos abajo.</p>}

      <div className="sub-head">
        <div className="seg" role="tablist" aria-label="Agrupar por">
          {([["auto", "Por palabra"], ["pieza", "Por publicación"], ["saludo", "Por saludo"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={por === k} className={por === k ? "on" : ""} onClick={() => setPor(k)}>{l}</button>)}
        </div>
        {por === "pieza" && <div className="seg" aria-label="Ordenar">
          {([["aperturas", "Más aperturas"], ["ctr", "Mejor CTR"], ["agendas", "Más agendas"]] as const).map(([k, l]) => <button key={k} className={orden === k ? "on" : ""} onClick={() => setOrden(k)}>{l}</button>)}
        </div>}
      </div>
      <p className="muted small">Comentarios y DMs por fecha de la apertura; agendas, calificadas y cierres con las mismas reglas que el Resumen. Tap rate = tocaron el botón ÷ aperturas · CTR = abrieron su link ÷ links enviados.</p>
      <div className="auto-grid ae-grid" aria-busy={loading}>
        {ordenadas.map((f) => {
          const p = por === "pieza" ? piezas.get(f.clave) : undefined;
          return <EmbudoCard key={f.clave} f={f} titulo={titulo(f)} thumb={p?.thumbnail_url} link={p?.permalink} />;
        })}
        {!ordenadas.length && !loading && <p className="vacio">Sin aperturas en este período</p>}
      </div>

      <div className="sub-head">
        <h3>Tests A/B <span className="muted small">ninguno arranca solo · cada persona ve siempre la misma variante</span></h3>
        <button className="btn-sec" onClick={() => setNuevo({ auto: autos[0]?.id ?? "", nombre: "", metrica: "clic" })}>+ Nuevo test</button>
      </div>
      {nuevo && (
        <div className="card auto-form ab-nuevo">
          <label>Automatización
            <select value={nuevo.auto} onChange={(e) => setNuevo({ ...nuevo, auto: e.target.value ? +e.target.value : "" })}>
              {autos.map((a) => <option key={a.id} value={a.id} disabled={tests.some((t) => t.automatizacion_id === a.id && t.estado !== "cerrado")}>{a.nombre}{tests.some((t) => t.automatizacion_id === a.id && t.estado !== "cerrado") ? " (ya tiene un test abierto)" : ""}</option>)}
            </select>
          </label>
          <label>Nombre del test<input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="@usuario vs sin nombre" /></label>
          <label>Gana la que tenga más
            <select value={nuevo.metrica} onChange={(e) => setNuevo({ ...nuevo, metrica: e.target.value as Test["metrica"] })}>
              {Object.entries(METRICA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <p className="muted small">Se crea en borrador con A = el texto que corre hoy y B = una copia para editar. Recién corre cuando tocas «Arrancar».</p>
          <div className="fila"><button className="primary" disabled={!nuevo.auto} onClick={crear}>Crear en borrador</button><button className="link" onClick={() => setNuevo(null)}>Cancelar</button></div>
        </div>
      )}
      <div className="ab-lista">
        {tests.map((t) => <TestCard key={t.id} t={t} onCambio={() => setRecarga((n) => n + 1)} />)}
        {!tests.length && <p className="vacio">Todavía no hay tests. Sugerido para empezar: «@usuario vs sin nombre» en JESSI, para las personas sin nombre en el perfil.</p>}
      </div>

      <details className="card ab-recs">
        <summary><b>Recordatorio a quien no tocó el botón</b> <span className="muted small">apagado · necesita OK del dueño</span></summary>
        <p className="muted small">Un solo mensaje, X horas después de la apertura, dentro de la ventana de 24 h. Solo funciona para quien escribió por DM o respondió una historia: a quien comentó, Instagram permite un único mensaje privado hasta que responda.</p>
        {autos.map((a) => <Recordatorio key={`${a.id}-${recarga}`} a={a} onCambio={() => setRecarga((n) => n + 1)} />)}
      </details>
    </section>
  );
}
