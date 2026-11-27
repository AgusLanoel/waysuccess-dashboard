import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money, num } from "../../lib/format";
import { nombrePiezaIG, type PiezaIG } from "./OrganicoIG";

// 27-11 (dueño): secciones por formato — Reels, Posts (carruseles y fotos) e Historias — para REPLICAR lo que funciona,
// no solo para saber. Cada sección arranca con "Qué replicar" (las piezas que más negocio trajeron por vista) y el mismo
// ranking alimenta al agente de ideas (organico-ganadores/ganadores.mjs → waysuccess-organico/ganadores.md).
// Historias: cada una lleva su link corto (toques del sticker) creado acá con org_link_historia.

export interface FilaF { pieza: string; tipo: string; contactos: number; agendas: number; calificadas: number; asistencias: number; ventas: number; cash: number; clics: number; views: number | null; recuperados?: number; toques_previos?: number }
// Comentarios por publicación (org_comentarios_piezas): con_palabra = comentaron JESSI / CONTENIDO / GANADORES (o variantes)
export interface ComentF { pieza_id: string; comentarios: number; con_palabra: number; personas_palabra: number; ultimo: string | null }
export interface LinkF { slug: string; pieza_id: string; automatizacion: string | null; destino: string; clics: number; ultimo_clic: string | null; contactos: number }
export type Formato = "reel" | "post" | "historia";

const LINK_BASE = "https://www.waysuccess.io/l/";
const TIPO_LBL: Record<string, string> = { reel: "Reel", carrusel: "Carrusel", post: "Post", historia: "Historia" };
const dec1 = (n: number) => (Number.isInteger(n) ? num(n) : n.toFixed(1).replace(".", ","));
const compacto = (n: number | null | undefined) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} M` : n >= 1e4 ? `${Math.round(n / 1e3)} mil` : num(n));
const hoyChile = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const pl = (n: number, uno: string, varios: string) => `${dec1(n)} ${n === 1 ? uno : varios}`;
const L = ({ l, c }: { l: string; c: string }) => <><span className="t-largo">{l}</span><span className="t-corto">{c}</span></>;
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// fecha de una historia a partir de su código (…-AAAA-MM-DD, o los viejos histag-13/11)
export function fechaHistoria(codigo: string, p?: PiezaIG): string | null {
  const a = codigo.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (a) return `${a[1]}-${a[2]}-${a[3]}`;
  const b = codigo.match(/(\d{1,2})[/-](\d{1,2})$/);
  if (b) return `2026-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}`;
  return p?.publicado_at ? new Date(p.publicado_at).toLocaleDateString("en-CA", { timeZone: "America/Santiago" }) : null;
}
const nombreHistoria = (c: string) => c.replace(/^hist(ag)?-/, "").replace(/-?\d{4}-\d{2}-\d{2}$/, "").replace(/-?\d{1,2}[/-]\d{1,2}$/, "") || c;
const fechaLarga = (d: string) => { const x = new Date(d + "T12:00:00Z"); return `${DIAS[x.getUTCDay()]} ${x.getUTCDate()}/${x.getUTCMonth() + 1}`; };

export function OrganicoFormatos({ formato, from, to, rows, piezas, links, coment, loading, onCreado }: {
  formato: Formato; from: string; to: string; rows: FilaF[]; piezas: Map<string, PiezaIG>; links: LinkF[]; coment?: Map<string, ComentF>; loading: boolean; onCreado: () => void;
}) {
  return formato === "historia"
    ? <Historias from={from} to={to} rows={rows} piezas={piezas} links={links} loading={loading} onCreado={onCreado} />
    : <Publicaciones formato={formato} from={from} to={to} rows={rows} piezas={piezas} coment={coment ?? new Map()} loading={loading} />;
}

// ───────────────────────── Reels y posts ─────────────────────────
// 27-11: antes de esa fecha ManyChat mandaba el mismo link a todos; esos contactos se recuperaron cruzando el usuario de
// Instagram del quiz con quien comentó la palabra clave en cada publicación (org_atribucion_recuperada). Se marcan con ↺.
const RECUP_TIT = "Recuperado por comentario: la persona comentó la palabra clave en esta publicación antes de llenar el quiz (cruce del usuario de Instagram del quiz con los comentarios). Desde el 27-11 la atribución es exacta por link único.";
const Recup = ({ n, de }: { n?: number; de?: number }) => (n ? <span className="recup" title={`${dec1(n)} ${n === 1 ? "contacto recuperado" : "contactos recuperados"} por comentario. ${RECUP_TIT}`}>↺{de != null && n < de ? ` ${dec1(n)}` : ""}</span> : null);

function Publicaciones({ formato, from, to, rows, piezas, coment, loading }: { formato: "reel" | "post"; from: string; to: string; rows: FilaF[]; piezas: Map<string, PiezaIG>; coment: Map<string, ComentF>; loading: boolean }) {
  const [orden, setOrden] = useState<"negocio" | "views" | "fecha">("negocio");
  const porPieza = useMemo(() => new Map(rows.map((r) => [r.pieza, r])), [rows]);
  const lista = useMemo(() => [...piezas.values()].filter((p) => {
    if (!p.id.startsWith("ig-") || !p.permalink || !p.publicado_at) return false;
    const esReel = p.tipo === "reel";
    if ((formato === "reel") !== esReel || p.tipo === "historia") return false;
    const d = new Date(p.publicado_at).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    return d >= from && d <= to;
  }), [piezas, formato, from, to]);
  const negocio = (p: PiezaIG) => { const r = porPieza.get(p.id); return r ? r.cash * 1e6 + r.agendas * 1e3 + r.contactos : 0; };
  const orden_ = useMemo(() => [...lista].sort((a, b) =>
    orden === "views" ? (b.views ?? 0) - (a.views ?? 0) : orden === "fecha" ? +new Date(b.publicado_at!) - +new Date(a.publicado_at!) : negocio(b) - negocio(a) || (b.views ?? 0) - (a.views ?? 0)),
  [lista, orden, porPieza]);

  // promedio de contactos por 1.000 vistas del formato en el período (para comparar a los ganadores)
  const tot = lista.reduce((s, p) => { const r = porPieza.get(p.id); return { v: s.v + (p.views ?? 0), c: s.c + (r?.contactos ?? 0), a: s.a + (r?.agendas ?? 0), $: s.$ + (r?.cash ?? 0), rec: s.rec + (r?.recuperados ?? 0), kw: s.kw + (coment.get(p.id)?.con_palabra ?? 0) }; }, { v: 0, c: 0, a: 0, $: 0, rec: 0, kw: 0 });
  const promMil = tot.v ? (tot.c / tot.v) * 1000 : 0;
  const ganadores = [...lista].filter((p) => (porPieza.get(p.id)?.contactos ?? 0) > 0).sort((a, b) => negocio(b) - negocio(a)).slice(0, 3);
  const nombre = formato === "reel" ? "reels" : "posts";

  return (
    <div className="formato">
      <div className="fmt-resumen">
        <span><b>{num(lista.length)}</b> {nombre} publicados</span>
        <span><b>{compacto(tot.v)}</b> vistas</span>
        <span><b>{dec1(tot.c)}</b> contactos{tot.rec ? <span className="muted small" title={RECUP_TIT}> ({dec1(tot.rec)} ↺)</span> : null}</span>
        <span><b>{dec1(tot.a)}</b> agendas</span>
        <span><b>{money(tot.$)}</b> cobrado</span>
        {tot.kw ? <span title="Comentarios con la palabra clave (JESSI, CONTENIDO, GANADORES): intención aunque no haya llegado al quiz"><b>{num(tot.kw)}</b> comentarios con palabra clave</span> : null}
        <span title="Contactos por cada 1.000 vistas del formato"><b>{promMil ? promMil.toFixed(2).replace(".", ",") : "—"}</b> contactos / 1.000 vistas</span>
      </div>

      <p className="aviso-recup small">↺ Desde el 27-11 la atribución por publicación es exacta; antes se recuperó cruzando comentarios con el usuario del quiz.</p>

      <section className="replicar">
        <h3>Qué replicar <span className="muted small">los {nombre} que más negocio trajeron en el período</span></h3>
        {ganadores.length ? (
          <ol>
            {ganadores.map((p) => {
              const r = porPieza.get(p.id)!;
              const mil = p.views ? (r.contactos / p.views) * 1000 : null;
              const veces = mil && promMil ? mil / promMil : null;
              return (
                <li key={p.id}>
                  <a href={p.permalink!} target="_blank" rel="noreferrer" className="rep-media">{p.thumbnail_url ? <img src={p.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}</a>
                  <div>
                    <div className="rep-titulo">{nombrePiezaIG(p.id, piezas)}</div>
                    <div className="rep-datos">
                      {r.cash ? <b className="good">{money(r.cash)}</b> : null} <span>{pl(r.agendas, "agenda", "agendas")}</span> <span>{pl(r.contactos, "contacto", "contactos")} <Recup n={r.recuperados} de={r.contactos} /></span> <span>{compacto(p.views)} vistas</span>{coment.get(p.id)?.con_palabra ? <span>{num(coment.get(p.id)!.con_palabra)} con palabra clave</span> : null}
                      {veces && veces >= 1.2 ? <span className="chip chip-kw">{veces.toFixed(1).replace(".", ",")}× el promedio</span> : null}
                    </div>
                    {p.caption ? <div className="rep-caption">“{p.caption.split("\n")[0].slice(0, 140)}”</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="muted small">{loading ? "Cargando…" : `Ningún ${formato === "reel" ? "reel" : "post"} del período trajo contactos todavía. Mira el ranking por vistas abajo.`}</p>}
      </section>

      <div className="fmt-head">
        <div className="seg" role="tablist" aria-label="Orden">
          {([["negocio", "Más negocio"], ["views", "Más vistas"], ["fecha", "Recientes"]] as const).map(([k, l]) => <button key={k} className={orden === k ? "on" : ""} onClick={() => setOrden(k)}>{l}</button>)}
        </div>
      </div>
      <div className="ig-grid">
        {orden_.map((p) => {
          const r = porPieza.get(p.id);
          return (
            <article key={p.id} className="ig-card">
              <a className="ig-media" href={p.permalink!} target="_blank" rel="noreferrer">
                {p.thumbnail_url ? <img src={p.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="ig-sin-img">Sin imagen</div>}
                <span className={`ig-tipo t-${p.tipo}`}>{TIPO_LBL[p.tipo ?? ""] ?? p.tipo}</span>
                <span className="ig-views">▶ {compacto(p.views)}</span>
              </a>
              <div className="ig-body">
                <div className="muted small">{new Date(p.publicado_at!).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}</div>
                <div className="ig-titulo">{nombrePiezaIG(p.id, piezas)}</div>
                <div className="ig-metr">
                  <span title="Alcance">👥 {compacto(p.alcance)}</span>
                  <span title="Guardados">🔖 {compacto(p.guardados)}</span>
                  <span title="Compartidos">↗ {compacto(p.compartidos)}</span>
                  <span title={coment.get(p.id)?.con_palabra ? `${num(p.comentarios ?? 0)} comentarios · ${num(coment.get(p.id)!.con_palabra)} con palabra clave (JESSI, CONTENIDO, GANADORES)` : "Comentarios"}>💬 {compacto(p.comentarios)}{coment.get(p.id)?.con_palabra ? <span className="kw"> · {num(coment.get(p.id)!.con_palabra)} 🔑</span> : null}</span>
                </div>
                <div className="ig-negocio">
                  <div><b>{r ? dec1(r.contactos) : "0"}<Recup n={r?.recuperados} de={r?.contactos} /></b><span>contactos</span></div>
                  <div><b>{r ? dec1(r.agendas) : "0"}</b><span>agendas</span></div>
                  <div className={r?.cash ? "cobro" : ""}><b>{r?.cash ? money(r.cash) : "—"}</b><span>cobrado</span></div>
                </div>
              </div>
            </article>
          );
        })}
        {!orden_.length && !loading && <p className="vacio">No hay {nombre} publicados en este período.</p>}
      </div>
    </div>
  );
}

// ───────────────────────── Historias ─────────────────────────
interface Hist { codigo: string; fecha: string; toques: number; contactos: number; agendas: number; asistencias: number; cash: number; slug: string | null }

function Historias({ from, to, rows, piezas, links, loading, onCreado }: { from: string; to: string; rows: FilaF[]; piezas: Map<string, PiezaIG>; links: LinkF[]; loading: boolean; onCreado: () => void }) {
  const [nombre, setNombre] = useState("");
  const [fecha, setFecha] = useState(hoyChile());
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState<{ slug: string; codigo: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const hist = useMemo(() => {
    const m = new Map<string, Hist>();
    const dar = (c: string) => {
      if (!m.has(c)) { const f = fechaHistoria(c, piezas.get(c)); if (!f) return null; m.set(c, { codigo: c, fecha: f, toques: 0, contactos: 0, agendas: 0, asistencias: 0, cash: 0, slug: null }); }
      return m.get(c)!;
    };
    for (const r of rows) if (r.tipo === "historia" || /^hist/i.test(r.pieza)) { const h = dar(r.pieza); if (h) Object.assign(h, { contactos: r.contactos, agendas: r.agendas, asistencias: r.asistencias, cash: r.cash, toques: Math.max(h.toques, r.clics) }); }
    for (const l of links) if (/^hist/i.test(l.pieza_id ?? "")) { const h = dar(l.pieza_id); if (h) { h.toques = Math.max(h.toques, l.clics); h.slug = h.slug ?? l.slug; } }
    for (const p of piezas.values()) if (p.id.startsWith("hist")) dar(p.id);
    return [...m.values()].filter((h) => h.fecha >= from && h.fecha <= to);
  }, [rows, links, piezas, from, to]);

  const dias = useMemo(() => {
    const g = new Map<string, Hist[]>();
    for (const h of hist) g.set(h.fecha, [...(g.get(h.fecha) ?? []), h]);
    return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([f, hs]) => ({
      fecha: f, hs: hs.sort((a, b) => b.cash - a.cash || b.agendas - a.agendas || b.contactos - a.contactos || b.toques - a.toques),
      toques: hs.reduce((s, h) => s + h.toques, 0), contactos: hs.reduce((s, h) => s + h.contactos, 0), agendas: hs.reduce((s, h) => s + h.agendas, 0), cash: hs.reduce((s, h) => s + h.cash, 0),
    }));
  }, [hist]);
  const top = [...hist].filter((h) => h.contactos > 0).sort((a, b) => b.cash - a.cash || b.agendas - a.agendas || b.contactos - a.contactos).slice(0, 3);
  const porDia = useMemo(() => {
    const acc = DIAS.map(() => ({ n: 0, c: 0, a: 0 }));
    for (const d of dias) { const w = new Date(d.fecha + "T12:00:00Z").getUTCDay(); acc[w].n++; acc[w].c += d.contactos; acc[w].a += d.agendas; }
    return acc.map((x, i) => ({ dia: DIAS[i], dias: x.n, c: x.n ? x.c / x.n : 0, a: x.n ? x.a / x.n : 0 })).filter((x) => x.dias > 0).sort((a, b) => b.a - a.a || b.c - a.c);
  }, [dias]);
  const tot = hist.reduce((s, h) => ({ t: s.t + h.toques, c: s.c + h.contactos, a: s.a + h.agendas, $: s.$ + h.cash }), { t: 0, c: 0, a: 0, $: 0 });

  const crear = async () => {
    setCreando(true); setErr(null);
    const { data, error } = await supabase.rpc("org_link_historia", { p_nombre: nombre, p_fecha: fecha, p_destino: "https://www.waysuccess.io/" });
    setCreando(false);
    if (error) { setErr(error.message); return; }
    const x = (data as { slug: string; codigo: string }[])?.[0];
    if (x) { setNuevo(x); setNombre(""); onCreado(); }
  };
  const copiar = (s: string) => navigator.clipboard?.writeText(LINK_BASE + s).then(() => { setCopiado(s); setTimeout(() => setCopiado(null), 1500); }).catch(() => undefined);

  return (
    <div className="formato">
      <section className="card nuevo-link">
        <h3>Link para el sticker de una historia</h3>
        <p className="muted small">Una historia = un link. Cuenta los toques del sticker y une cada contacto, agenda y venta con esa historia y su día.</p>
        <div className="nl-form">
          <label>Historia<input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="082-ale · gerardo-ws" /></label>
          <label>Se publica el<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          <button className="primary" disabled={creando || !nombre.trim()} onClick={crear}>{creando ? "Creando…" : "Crear link"}</button>
        </div>
        {err && <p className="error small">{err}</p>}
        {nuevo && (
          <div className="nl-ok">
            <code>{LINK_BASE.replace("https://", "") + nuevo.slug}</code>
            <button className="btn-sec" onClick={() => copiar(nuevo.slug)}>{copiado === nuevo.slug ? "Copiado ✓" : "Copiar link"}</button>
            <span className="muted small">{nuevo.codigo}</span>
          </div>
        )}
      </section>

      <div className="fmt-resumen">
        <span><b>{num(hist.length)}</b> historias con link o resultados</span>
        <span><b>{num(tot.t)}</b> toques</span>
        <span><b>{dec1(tot.c)}</b> contactos</span>
        <span><b>{dec1(tot.a)}</b> agendas</span>
        <span><b>{money(tot.$)}</b> cobrado</span>
      </div>

      <section className="replicar">
        <h3>Qué replicar <span className="muted small">las historias que más negocio trajeron en el período</span></h3>
        {top.length ? (
          <ol>
            {top.map((h) => (
              <li key={h.codigo}>
                <div className="rep-dia">{fechaLarga(h.fecha)}</div>
                <div>
                  <div className="rep-titulo">{nombreHistoria(h.codigo)}</div>
                  <div className="rep-datos">{h.cash ? <b className="good">{money(h.cash)}</b> : null} <span>{pl(h.agendas, "agenda", "agendas")}</span> <span>{pl(h.contactos, "contacto", "contactos")}</span> {h.toques ? <span>{num(h.toques)} toques</span> : null}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="muted small">{loading ? "Cargando…" : "Todavía no hay historias del período con contactos."}</p>}
        {porDia.length > 1 && <p className="small rep-dias">Mejor día para historias: <b>{porDia[0].dia}</b> ({porDia[0].a.toFixed(1).replace(".", ",")} agendas y {porDia[0].c.toFixed(1).replace(".", ",")} contactos por día) · peor: {porDia[porDia.length - 1].dia}</p>}
      </section>

      <div className="hist-dias">
        {dias.map((d) => (
          <section key={d.fecha} className="card hist-dia">
            <header>
              <b>{fechaLarga(d.fecha)}</b>
              <span className="muted small">{pl(d.toques, "toque", "toques")} · {pl(d.contactos, "contacto", "contactos")} · {pl(d.agendas, "agenda", "agendas")}{d.cash ? ` · ${money(d.cash)}` : ""}</span>
            </header>
            <table>
              <thead><tr><th className="name">Historia</th><th><L l="Toques" c="Toq." /></th><th><L l="Contactos" c="Cont." /></th><th><L l="Agendas" c="Ag." /></th><th>Asist.</th><th><L l="Cobrado" c="$" /></th><th></th></tr></thead>
              <tbody>
                {d.hs.map((h) => (
                  <tr key={h.codigo}>
                    <td className="name" title={h.codigo}>{nombreHistoria(h.codigo)}</td>
                    <td>{h.slug ? num(h.toques) : <span className="muted" title="Sin link corto: los toques no se midieron">—</span>}</td>
                    <td>{dec1(h.contactos)}</td><td>{dec1(h.agendas)}</td><td>{dec1(h.asistencias)}</td>
                    <td className={h.cash ? "good" : ""}>{h.cash ? money(h.cash) : "—"}</td>
                    <td>{h.slug ? <button className="link" onClick={() => copiar(h.slug!)}>{copiado === h.slug ? "Copiado" : <L l="Copiar link" c="Copiar" />}</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {!dias.length && !loading && <p className="vacio">No hay historias en este período. Crea el link de la próxima arriba.</p>}
      </div>
    </div>
  );
}
