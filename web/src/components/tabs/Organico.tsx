import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money, num, pct, ratio } from "../../lib/format";
import { ghlContacto } from "../ui";
import { OrganicoIG, nombrePiezaIG, type PiezaIG } from "./OrganicoIG";

// Pestaña Orgánico (26-11, solo owners): el "Ads Manager" del contenido. Qué pieza (reel, carrusel, historia, bio,
// automatización de ManyChat) trajo cada contacto, agenda, asistencia y venta. Se arma con los UTM que GHL guarda en
// cada contacto orgánico (utm_content = pieza, utm_term = link único) y con las ventas de la hoja del Tracker.
// Nunca se mezcla con Ads ni se manda a Meta (regla del dueño 20-10 y 29-10).

type Modelo = "primero" | "ultimo" | "mitad";
interface Fila { pieza: string; tipo: string; contactos: number; agendas: number; calificadas: number; asistencias: number; ventas: number; cash: number; clics: number; views: number | null }
interface Contacto { contact_id: string; creado: string; nombre: string | null; email: string | null; telefono: string | null; pieza_primera: string; pieza_ultima: string; slug: string | null; medio: string; facturacion: string | null; en_cohorte: boolean; agendo: boolean; asistio: boolean; califica: boolean; ventas: number; cobrado: number }
interface Link { slug: string; pieza_id: string; automatizacion: string | null; destino: string; clics: number; ultimo_clic: string | null; contactos: number }
interface Conex { whop_ultimo: { ok: boolean; detalle: string; at: string } | null; whop_ok: number; ig_ultimo: { ok: boolean; at: string } | null; pagos: number; pagos_sin_cruzar: number; clics: number; toques_ig: number }

const MODELOS: [Modelo, string][] = [["primero", "Primer contacto"], ["ultimo", "Último contacto"], ["mitad", "50/50"]];
const LINK_BASE = "https://www.waysuccess.io/l/";

interface ColDef { key: string; label: string; title?: string; get: (r: Fila) => number | null; fmt: (n: number | null) => string }
const dec1 = (n: number | null) => (n == null ? "—" : Number.isInteger(n) ? num(n) : n.toFixed(1).replace(".", ","));
const COLS: ColDef[] = [
  { key: "contactos", label: "Contactos", title: "Personas que entraron a GHL desde esta pieza en el período", get: (r) => r.contactos, fmt: dec1 },
  { key: "agendas", label: "Agendas", title: "Agendas calificadas (DFY o JessiK) con fecha en el período — misma regla que el Resumen", get: (r) => r.agendas, fmt: dec1 },
  { key: "asistencias", label: "Asistencias", title: "Primera asistencia de la persona en el período — misma regla que el Resumen", get: (r) => r.asistencias, fmt: dec1 },
  { key: "calificadas", label: "Asist. calificadas", title: "Asistencias que el closer marcó calificadas", get: (r) => r.calificadas, fmt: dec1 },
  { key: "pcal", label: "% calif.", get: (r) => ratio(r.calificadas, r.asistencias), fmt: (n) => pct(n, 0) },
  { key: "ventas", label: "Cierres", title: "Cierres (Won) con fecha de cierre en el período", get: (r) => r.ventas, fmt: dec1 },
  { key: "cash", label: "Cobrado", title: "Cobrado de los cierres del período (igual que el Resumen)", get: (r) => r.cash, fmt: money },
  { key: "clics", label: "Clics link", title: "Clics en los links cortos de esta pieza (www.waysuccess.io/l/…)", get: (r) => r.clics, fmt: num },
  { key: "views", label: "Views", title: "Vistas de Instagram (llegan cuando Meta apruebe la app)", get: (r) => r.views, fmt: num },
  { key: "cpk", label: "Cobrado / 1k views", get: (r) => (r.views ? (r.cash / r.views) * 1000 : null), fmt: money },
];

const TIPO_LBL: Record<string, string> = { historia: "Historia", bio: "Bio", dm: "DM", reel: "Reel", carrusel: "Carrusel", post: "Post", "sin origen": "Sin origen", otro: "Otro" };

export function Organico({ from, to, reloadKey }: { from: string; to: string; reloadKey: number }) {
  const [modelo, setModelo] = useState<Modelo>("primero");
  const [rows, setRows] = useState<Fila[]>([]);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [conex, setConex] = useState<Conex | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "cash", dir: -1 });
  const [pieza, setPieza] = useState<string | null>(null);
  const [verContactos, setVerContactos] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [piezas, setPiezas] = useState<Map<string, PiezaIG>>(new Map());
  const nombrePieza = (p: string) => (p === "sin-pieza" ? "Sin pieza identificada" : nombrePiezaIG(p, piezas));

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErr(null);
    Promise.all([
      supabase.rpc("org_reporte", { desde: from, hasta: to, modelo }),
      supabase.rpc("org_base", { desde: from, hasta: to }),
      supabase.rpc("org_links_estado", { desde: from, hasta: to }),
      supabase.rpc("org_conexiones"),
      supabase.from("org_piezas").select("id, tipo, titulo, permalink, thumbnail_url, publicado_at"),
    ]).then(([r, b, l, c, p]) => {
      if (!vivo) return;
      const e = r.error ?? b.error ?? l.error ?? c.error;
      if (e) setErr(e.message);
      setRows(((r.data ?? []) as Fila[]).map((x) => ({ ...x, contactos: +x.contactos, agendas: +x.agendas, calificadas: +x.calificadas, asistencias: +x.asistencias, ventas: +x.ventas, cash: +x.cash, clics: +x.clics, views: x.views == null ? null : +x.views })));
      setContactos(((b.data ?? []) as Contacto[]).map((x) => ({ ...x, ventas: +x.ventas, cobrado: +x.cobrado })));
      setLinks(((l.data ?? []) as Link[]).map((x) => ({ ...x, clics: +x.clics, contactos: +x.contactos })));
      setConex((c.data as Conex) ?? null);
      setPiezas(new Map(((p.data ?? []) as PiezaIG[]).map((x) => [x.id, x])));
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [from, to, modelo, reloadKey]);

  const visibles = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key);
    return [...rows].sort((a, b) => {
      if ((a.pieza === "sin-pieza") !== (b.pieza === "sin-pieza")) return a.pieza === "sin-pieza" ? 1 : -1;
      return (((col?.get(a) ?? -Infinity) as number) - ((col?.get(b) ?? -Infinity) as number)) * sort.dir;
    });
  }, [rows, sort]);

  const t = useMemo(() => {
    // 26-11: agendas/asistencias/cierres/cobrado con las mismas reglas que la columna Orgánico del Resumen
    const c = contactos;
    const co = c.filter((x) => x.en_cohorte);
    return {
      contactos: co.length, agendas: c.filter((x) => x.agendo).length, calificadas: c.filter((x) => x.califica).length,
      asistencias: c.filter((x) => x.asistio).length, ventas: c.reduce((s, x) => s + x.ventas, 0), cash: c.reduce((s, x) => s + x.cobrado, 0),
      sinPieza: co.filter((x) => x.pieza_primera === "sin-pieza").length, clics: links.reduce((s, x) => s + x.clics, 0),
    };
  }, [contactos, links]);
  const mejor = visibles.find((r) => r.pieza !== "sin-pieza" && r.cash > 0);

  const kpis: [string, string, string?][] = [
    ["Cobrado orgánico", money(t.cash), `${num(t.ventas)} cierres${mejor ? ` · la que más cobró: ${nombrePieza(mejor.pieza)}` : ""}`],
    ["Contactos nuevos", num(t.contactos), `${pct(ratio(t.sinPieza, t.contactos), 0)} sin pieza identificada (${num(t.sinPieza)})`],
    ["Agendas", num(t.agendas), "Calificadas (DFY o JessiK), igual que el Resumen"],
    ["Asistencias", num(t.asistencias), `${pct(ratio(t.asistencias, t.agendas), 0)} de asistencia`],
    ["Asistencias calificadas", num(t.calificadas), `${pct(ratio(t.calificadas, t.asistencias), 0)} de las asistencias`],
    ["% Cierre", pct(ratio(t.ventas, t.asistencias), 0), `${num(t.ventas)} cierres de ${num(t.asistencias)} asistencias`],
    ["Clics en links", num(t.clics), "Links cortos www.waysuccess.io/l/…"],
  ];

  const lista = pieza ? contactos.filter((c) => c.pieza_primera === pieza || c.pieza_ultima === pieza) : contactos;
  const copiar = (s: string) => {
    navigator.clipboard?.writeText(LINK_BASE + s).then(() => { setCopiado(s); setTimeout(() => setCopiado(null), 1500); }).catch(() => setCopiado(null));
  };

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

      <section className="card table-card">
        <div className="table-head">
          <div className="seg" role="tablist" aria-label="Modelo de atribución">
            {MODELOS.map(([k, l]) => <button key={k} className={modelo === k ? "on" : ""} onClick={() => setModelo(k)}>{l}</button>)}
          </div>
          <span className="muted" style={{ fontSize: ".8rem" }}>
            {modelo === "primero" ? "Crédito a la pieza que trajo a la persona por primera vez" : modelo === "ultimo" ? "Crédito a la última pieza antes de agendar" : "Mitad para la primera pieza y mitad para la última"} · toca una fila para ver sus contactos
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="name">Pieza</th>
                <th>Tipo</th>
                {COLS.map((c) => (
                  <th key={c.key} title={c.title} className={sort.key === c.key ? "sorted" : ""} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
                    {c.label}{sort.key === c.key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => (
                <tr key={r.pieza} className={`${r.pieza === "sin-pieza" ? "dim" : ""} clic`} style={{ cursor: "pointer", outline: pieza === r.pieza ? "1px solid var(--acc-2)" : undefined }}
                  onClick={() => { setPieza(pieza === r.pieza ? null : r.pieza); setVerContactos(true); }}>
                  <td className="name"><div className="name-cell">{piezas.get(r.pieza)?.thumbnail_url && <img className="thumb" src={piezas.get(r.pieza)!.thumbnail_url!} alt="" loading="lazy" />}<div><b>{nombrePieza(r.pieza)}</b>{piezas.get(r.pieza)?.permalink && <div><a className="muted small" href={piezas.get(r.pieza)!.permalink!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Ver en Instagram</a></div>}</div></div></td>
                  <td>{TIPO_LBL[r.tipo] ?? r.tipo}</td>
                  {COLS.map((c) => <td key={c.key}>{c.fmt(c.get(r))}</td>)}
                </tr>
              ))}
              {!visibles.length && !loading && <tr><td colSpan={COLS.length + 2} className="vacio">Sin contactos orgánicos en este período</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <button className="link desplegable" onClick={() => setVerContactos(!verContactos)}>
        {verContactos ? "▾" : "▸"} Contactos orgánicos{pieza ? ` de ${nombrePieza(pieza)}` : ""} ({num(lista.length)})
      </button>
      {pieza && verContactos && <button className="link" onClick={() => setPieza(null)}>Ver todos</button>}
      {verContactos && (
        <section className="card table-card">
          <div className="table-wrap">
            <table>
              <thead><tr><th className="name">Contacto</th><th>Entró</th><th>Primera pieza</th><th>Última pieza</th><th>Agendó</th><th>Asistió</th><th>Asist. calificada</th><th>Cobrado</th></tr></thead>
              <tbody>
                {lista.slice().sort((a, b) => b.cobrado - a.cobrado || +new Date(b.creado) - +new Date(a.creado)).slice(0, 200).map((c) => {
                  const url = ghlContacto(c.contact_id);
                  return (
                    <tr key={c.contact_id}>
                      <td className="name">{url ? <a href={url} target="_blank" rel="noreferrer">{c.nombre || c.email || c.contact_id}</a> : c.nombre}</td>
                      <td>{new Date(c.creado).toLocaleDateString("es-CL", { day: "2-digit", month: "short", timeZone: "America/Los_Angeles" })}</td>
                      <td>{nombrePieza(c.pieza_primera)}</td>
                      <td>{c.pieza_ultima === c.pieza_primera ? "—" : nombrePieza(c.pieza_ultima)}</td>
                      <td>{c.agendo ? "Sí" : "—"}</td>
                      <td>{c.asistio ? "Sí" : "—"}</td>
                      <td>{c.asistio ? (c.califica ? "Sí" : "No") : "—"}</td>
                      <td>{c.cobrado > 0 ? money(c.cobrado) : "—"}</td>
                    </tr>
                  );
                })}
                {!lista.length && <tr><td colSpan={8} className="vacio">Sin contactos</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <OrganicoIG from={from} to={to} reloadKey={reloadKey} piezas={piezas} />

      <section className="card table-card">
        <div className="table-head"><b>Links cortos para usar en ManyChat, bio e historias</b><span className="muted" style={{ fontSize: ".8rem" }}>Cada clic queda registrado y la agenda queda unida a su pieza</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th className="name">Dónde va</th><th className="name">Link</th><th>Clics</th><th>Contactos</th><th>Último clic</th><th></th></tr></thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.slug}>
                  <td className="name">{l.automatizacion ?? nombrePieza(l.pieza_id)}</td>
                  <td className="name"><code>{LINK_BASE.replace("https://", "") + l.slug}</code></td>
                  <td>{num(l.clics)}</td>
                  <td>{num(l.contactos)}</td>
                  <td>{l.ultimo_clic ? new Date(l.ultimo_clic).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td><button className="link" onClick={() => copiar(l.slug)}>{copiado === l.slug ? "Copiado" : "Copiar"}</button></td>
                </tr>
              ))}
              {!links.length && <tr><td colSpan={6} className="vacio">Sin links creados</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {conex && (
        <section className="card table-card">
          <div className="table-head"><b>Conexiones</b></div>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><td className="name">GHL (agendas y UTM)</td><td className="name">Conectado · sincroniza solo</td></tr>
                <tr><td className="name">Ventas</td><td className="name">Tracker comercial (hoja) · {num(conex.pagos)} pagos de Whop recibidos{conex.pagos_sin_cruzar ? ` · ${num(conex.pagos_sin_cruzar)} sin cruzar` : ""}</td></tr>
                <tr><td className="name">Whop (webhook)</td><td className="name">{conex.whop_ok > 0 ? `Funcionando · ${num(conex.whop_ok)} eventos verificados` : "Conectado · esperando el primer pago"}</td></tr>
                <tr><td className="name">Links cortos</td><td className="name">En vivo · {num(conex.clics)} clics registrados</td></tr>
                <tr><td className="name">Instagram (comentarios y DMs)</td><td className="name">{conex.toques_ig > 0 ? `Recibiendo · ${num(conex.toques_ig)} interacciones` : "Esperando la aprobación de Meta"}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
