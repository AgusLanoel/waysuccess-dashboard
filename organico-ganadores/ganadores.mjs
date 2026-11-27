// Ganadores del orgánico → agente de ideas (27-11, pedido del dueño: "no es para SABER, es para REPLICAR").
// Lee del dashboard (mismas reglas que la pestaña Orgánico) qué reels, posts e historias trajeron más negocio y escribe
// C:\Users\G15\waysuccess-organico\ganadores.md, que el agente waysuccess-organico lee antes de proponer ideas,
// planear la semana o escribir historias. Corre a diario (tarea de Windows "WaySuccess Ganadores Organico", 07:30).
// Uso: node ganadores.mjs [días=30]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
const { createClient } = createRequire("C:/Users/G15/waysuccess-dashboard/web/package.json")("@supabase/supabase-js");

const SB_URL = "https://iqiyhlcqnxwtdhmmrlsp.supabase.co";
const SB_KEY = "sb_publishable_ksz73Q2yla8YN_n5U2demg_5800pWmg";
const SALIDA = "C:/Users/G15/waysuccess-organico/ganadores.md";
const HIST = "C:/Users/G15/waysuccess-organico/auditorias/ganadores";
const login = readFileSync("C:/Users/G15/waysuccess-dashboard/secrets/dashboard_login.txt", "utf8");
const email = login.match(/Usuario:\s*(\S+)/)[1];
const password = login.split(/\r?\n/)[2].replace(/^[^:]*:\s*/, "").trim();
const DIAS_N = Number(process.argv[2] || 30);

const dia = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const hoy = new Date();
const desde = dia(new Date(hoy.getTime() - (DIAS_N - 1) * 864e5)), hasta = dia(hoy);
const desde14 = dia(new Date(hoy.getTime() - 13 * 864e5));
const SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const pl = (n, uno, varios) => `${n1(n)} ${n === 1 ? uno : varios}`;
const n1 = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
const usd = (n) => (n ? `US$${Math.round(n).toLocaleString("es-CL")}` : "—");
const miles = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} M` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n));
const limpio = (s, max = 110) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const { error: e1 } = await sb.auth.signInWithPassword({ email, password });
if (e1) throw new Error("login: " + e1.message);

const [rep, links, piezasR] = await Promise.all([
  sb.rpc("org_reporte", { desde, hasta, modelo: "primero" }),
  sb.rpc("org_links_estado", { desde, hasta }),
  sb.from("org_piezas").select("id, tipo, titulo, caption, permalink, publicado_at, views, alcance, guardados, compartidos, comentarios"),
]);
for (const r of [rep, links, piezasR]) if (r.error) throw new Error(r.error.message);
const filas = new Map(rep.data.map((r) => [r.pieza, { ...r, contactos: +r.contactos, agendas: +r.agendas, asistencias: +r.asistencias, calificadas: +r.calificadas, ventas: +r.ventas, cash: +r.cash, clics: +r.clics }]));
const piezas = new Map(piezasR.data.map((p) => [p.id, p]));

// ── reels y posts publicados en la ventana ──
const pub = [...piezas.values()].filter((p) => p.id.startsWith("ig-") && p.permalink && p.publicado_at && dia(new Date(p.publicado_at)) >= desde && p.tipo !== "historia");
const negocio = (p) => { const r = filas.get(p.id); return r ? r.cash * 1e6 + r.agendas * 1e3 + r.contactos : 0; };
function seccion(titulo, lista) {
  const tot = lista.reduce((s, p) => { const r = filas.get(p.id); return { v: s.v + (p.views ?? 0), c: s.c + (r?.contactos ?? 0), a: s.a + (r?.agendas ?? 0), $: s.$ + (r?.cash ?? 0) }; }, { v: 0, c: 0, a: 0, $: 0 });
  const prom = tot.v ? (tot.c / tot.v) * 1000 : 0;
  const out = [`## ${titulo}`, "", `${lista.length} publicados · ${miles(tot.v)} vistas · ${n1(tot.c)} contactos · ${n1(tot.a)} agendas · ${usd(tot.$)} cobrado · promedio ${prom.toFixed(2).replace(".", ",")} contactos por 1.000 vistas.`, ""];
  const gan = lista.filter((p) => (filas.get(p.id)?.contactos ?? 0) > 0).sort((a, b) => negocio(b) - negocio(a)).slice(0, 8);
  out.push("### Trajeron negocio (REPLICAR: mismo tema, mismo gancho, mismo formato)", "");
  if (!gan.length) out.push("- Ninguno trajo contactos en la ventana.", "");
  gan.forEach((p, i) => {
    const r = filas.get(p.id), mil = p.views ? (r.contactos / p.views) * 1000 : null;
    const veces = mil && prom ? ` (${(mil / prom).toFixed(1).replace(".", ",")}× el promedio)` : "";
    const d = new Date(p.publicado_at);
    out.push(`${i + 1}. **${limpio(p.titulo || p.caption, 90)}** — ${usd(r.cash)} · ${pl(r.agendas, "agenda", "agendas")} · ${pl(r.contactos, "contacto", "contactos")} · ${miles(p.views)} vistas${veces} · ${SEMANA[d.getDay()]} ${d.toLocaleDateString("es-CL")} · ${p.permalink}`);
    if (p.caption) out.push(`   - Caption: “${limpio(p.caption.split("\n")[0], 160)}”`);
  });
  const alcance = [...lista].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5);
  out.push("", "### Más vistas (sirven para CRECER; no necesariamente traen negocio)", "");
  alcance.forEach((p) => { const r = filas.get(p.id); out.push(`- ${limpio(p.titulo || p.caption, 90)} — ${miles(p.views)} vistas · ${miles(p.guardados)} guardados · ${miles(p.compartidos)} compartidos · ${n1(r?.contactos ?? 0)} contactos · ${p.permalink}`); });
  const cero = lista.filter((p) => (p.views ?? 0) > 50000 && !(filas.get(p.id)?.contactos)).length;
  if (cero) out.push("", `Ojo: ${cero} con más de 50 mil vistas no trajeron ningún contacto (alcance sin llamado a la acción que convierta).`);
  out.push("");
  return out;
}

// ── historias ──
const fechaHist = (c) => { const a = c.match(/(\d{4}-\d{2}-\d{2})$/); if (a) return a[1]; const b = c.match(/(\d{1,2})[/-](\d{1,2})$/); return b ? `2026-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}` : null; };
const hist = new Map();
const dar = (c) => { if (!hist.has(c)) { const f = fechaHist(c); if (!f) return null; hist.set(c, { c, f, toques: 0, contactos: 0, agendas: 0, asist: 0, cash: 0, link: false }); } return hist.get(c); };
for (const r of filas.values()) if (/^hist/i.test(r.pieza)) { const h = dar(r.pieza); if (h) Object.assign(h, { contactos: r.contactos, agendas: r.agendas, asist: r.asistencias, cash: r.cash, toques: Math.max(h.toques, r.clics) }); }
for (const l of links.data) if (/^hist/i.test(l.pieza_id ?? "")) { const h = dar(l.pieza_id); if (h) { h.toques = Math.max(h.toques, +l.clics); h.link = true; } }
const hs = [...hist.values()].filter((h) => h.f >= desde);
const nom = (c) => c.replace(/^hist(ag)?-/, "").replace(/-?\d{4}-\d{2}-\d{2}$/, "").replace(/-?\d{1,2}[/-]\d{1,2}$/, "") || c;
const sem = (f) => SEMANA[new Date(f + "T12:00:00Z").getUTCDay()];
const H = ["## Historias", ""];
const topH = hs.filter((h) => h.contactos > 0).sort((a, b) => b.cash - a.cash || b.agendas - a.agendas || b.contactos - a.contactos).slice(0, 8);
H.push("### Las que trajeron negocio (REPLICAR: misma persona/caso, mismo llamado, mismo día)", "");
if (!topH.length) H.push("- Ninguna con contactos en la ventana.");
topH.forEach((h, i) => H.push(`${i + 1}. **${nom(h.c)}** (${sem(h.f)} ${h.f}) — ${usd(h.cash)} · ${pl(h.agendas, "agenda", "agendas")} · ${pl(h.contactos, "contacto", "contactos")}${h.link ? ` · ${h.toques} toques del sticker (${h.toques ? Math.round((h.contactos / h.toques) * 100) : 0}% pasó a contacto)` : ""} · código ${h.c}`));
const porDia = new Map();
for (const h of hs) { const d = porDia.get(h.f) ?? { c: 0, a: 0 }; d.c += h.contactos; d.a += h.agendas; porDia.set(h.f, d); }
const sem7 = SEMANA.map((s) => ({ s, n: 0, c: 0, a: 0 }));
for (const [f, d] of porDia) { const w = new Date(f + "T12:00:00Z").getUTCDay(); sem7[w].n++; sem7[w].c += d.c; sem7[w].a += d.a; }
const rk = sem7.filter((x) => x.n).sort((a, b) => b.a / b.n - a.a / a.n || b.c / b.n - a.c / a.n);
if (rk.length > 1) H.push("", `Días de la semana (promedio por día con historias): ${rk.map((x) => `${x.s} ${n1(x.a / x.n)} ag. / ${n1(x.c / x.n)} cont.`).join(" · ")}`);
H.push("", "### Últimos 14 días, día por día", "");
[...porDia.keys()].filter((f) => f >= desde14).sort().reverse().forEach((f) => {
  const del = hs.filter((h) => h.f === f).sort((a, b) => b.agendas - a.agendas || b.contactos - a.contactos);
  H.push(`- **${sem(f)} ${f}**: ${del.map((h) => `${nom(h.c)} ${h.link ? h.toques + " toques/" : ""}${n1(h.contactos)} cont./${n1(h.agendas)} ag.${h.cash ? "/" + usd(h.cash) : ""}`).join(" · ")}`);
});
const sinLink = hs.filter((h) => !h.link).length;
if (sinLink) H.push("", `Nota: ${sinLink} historias no tienen link corto, así que sus toques no se midieron. Desde el 27-11 cada historia lleva su link creado en el dashboard (Orgánico → Historias).`);
H.push("");

// ── otros canales: bio y automatizaciones de DM ──
const O = ["## Otros canales (bio y DMs por palabra clave)", "", "Hasta el 27-11 los comentarios con palabra clave los respondía ManyChat con un link igual para todos: esos contactos quedaron en \"ManyChat\" y NO en el post donde comentaron. Por eso los reels y posts muestran pocos o cero contactos antes de esa fecha. Desde el 27-11 cada comentario recibe un link único con su post, así que el crédito va a la publicación.", ""];
for (const r of [...filas.values()].filter((r) => ["bio", "dm"].includes(r.tipo)).sort((a, b) => b.cash - a.cash || b.agendas - a.agendas || b.contactos - a.contactos))
  O.push(`- ${r.pieza} (${r.tipo}) — ${usd(r.cash)} · ${pl(r.agendas, "agenda", "agendas")} · ${pl(r.contactos, "contacto", "contactos")}`);
O.push("");

const md = [
  "# Ganadores del orgánico — qué replicar",
  "",
  `Generado ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })} (Chile) desde el dashboard. Ventana: ${desde} a ${hasta} (${DIAS_N} días). Negocio = cobrado > agendas > contactos, con la misma atribución que la pestaña Orgánico (primer contacto).`,
  "",
  "Cómo usarlo: antes de proponer ideas, planear la semana o escribir historias, parte de lo que está arriba en cada sección. Una idea nueva tiene que explicar en qué ganador se apoya (tema, gancho, formato, caso o día) o declarar que es una prueba. Lo que tiene muchas vistas y cero contactos sirve para crecer, no para vender.",
  "",
  ...seccion("Reels", pub.filter((p) => p.tipo === "reel")),
  ...seccion("Posts (carruseles y fotos)", pub.filter((p) => p.tipo !== "reel")),
  ...H,
  ...O,
].join("\n");

writeFileSync(SALIDA, md, "utf8");
mkdirSync(HIST, { recursive: true });
copyFileSync(SALIDA, `${HIST}/${hasta}.md`);
console.log(`ok → ${SALIDA} (${pub.length} publicaciones, ${hs.length} historias)`);
