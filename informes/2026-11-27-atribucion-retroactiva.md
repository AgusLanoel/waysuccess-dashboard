# Informe 2026-11-27: atribución retroactiva de posts y reels

Orden: `waysuccess-hq/ordenes/2026-11-27-datos-atribucion-retroactiva.md`. Agente: waysuccess-datos. Ya está en producción (commit `4bc168c`, Vercel).

## 1. Qué hice

**Dónde está guardado el usuario de Instagram del quiz.** Está en `quiz_leads.respuestas->>'q_instagram'`. Lo tienen los 197 leads del quiz que hay, del 13-11 al 24-11. No llega a ningún campo de GHL. Desde el commit `9201b05` del quiz (24-11 23:50 Chile), el quiz **ya no pide Instagram ni crea el lead**: el contacto entra a GHL solo cuando agenda. Por eso el cruce sirve para el período 13–24-11, que es justo cuando ManyChat mandaba el link genérico.

**Supabase** (candado de la orden):
- Tabla `org_comentarios`. Guarda cada comentario y cada respuesta de los posts, carruseles y reels: publicación, usuario normalizado (misma regla que `normalizarUsuario`), texto, palabra clave detectada, fecha y la marca `propio` para los de waysuccess_. Los comentarios de nuestra cuenta no cuentan.
- Tabla `org_atribucion_recuperada`. Es la capa propia (`credito` o `toque_previo`, con método y confianza). Los UTM de GHL no se tocan.
- Funciones nuevas: `org_palabra_de()`, `org_norm_usuario()`, `org_recuperar_atribucion()` y `org_comentarios_piezas()` (cuenta los comentarios con palabra clave de cada publicación).
- `org_base_base`, `org_base`, `org_reporte_base` y `org_reporte`: tomé la versión anterior y le sumé la capa encima. Columnas nuevas: `pieza_original`, `recuperado`, `confianza`, `toque_previo`, `recuperados` y `toques_previos`. Solo cambia `pieza_primera` (y `pieza_ultima` cuando era la misma pieza genérica).
- Edge function nueva **`ig-comentarios`** (`verify_jwt: false`, `x-sync-key`). Solo lee de Meta, reintenta cuando Meta pone límites y se frena si el uso de la API llega al 85 %. Al final recalcula la capa. Cron `ig-comentarios` `41 * * * *`, con ventana de 21 días. Hice un relleno de 90 días: 120 publicaciones, 2.767 comentarios, 146 llamadas, 0 errores.
- No toqué `ig-webhook` (v13), `ig-respuestas` (v2), `ig-sync`, GHL ni el quiz.

**Regla aplicada:**
- **ManyChat** (manychat-*, mc-*, auto-*, jessi, ganadores, contenido): el contacto pasa a la publicación donde la persona comentó una palabra clave entre 0 y 7 días antes de entrar. Se prefiere el usuario exacto y, entre varios comentarios, el más cercano.
  - Confianza alta: usuario exacto y comentario hasta 2 h antes.
  - Confianza media: el resto, o el mismo usuario con distinto punto o guion bajo (por ejemplo `richboy_m77` y `richboy.m77`).
- **Bio, historia o sin pieza**: el crédito no se mueve. Si la persona comentó antes, queda como `toque_previo`.

**Dashboard** (Orgánico → Reels / Posts / Todas):
- Marca ↺ "recuperado por comentario" con explicación al pasar el mouse en tarjetas, en "Qué replicar", en el resumen, en la tabla de piezas y en la lista de contactos (muestra la pieza anterior y la confianza).
- Comentarios con palabra clave por publicación (💬 N · M 🔑) y el total del formato.
- Aviso: "Desde el 27-11 la atribución por publicación es exacta; antes se recuperó cruzando comentarios con el usuario del quiz."
- En la lista de contactos, los de bio e historia que comentaron antes se ven como "comentó en …".

**Ganadores**: a `organico-ganadores/ganadores.mjs` le agregué la marca de recuperados, una sección nueva "Más comentarios con palabra clave" y actualicé la nota de "Otros canales". Ya lo corrí y generó `C:/Users/G15/waysuccess-organico/ganadores.md`.

Archivos:
- `C:/Users/G15/waysuccess-dashboard/supabase/functions/ig-comentarios/index.ts`
- `C:/Users/G15/waysuccess-dashboard/supabase/sql/2026-11-27_atribucion_retroactiva.sql`
- `C:/Users/G15/waysuccess-dashboard/supabase/functions/README.md`
- `C:/Users/G15/waysuccess-dashboard/web/src/components/tabs/Organico.tsx`
- `C:/Users/G15/waysuccess-dashboard/web/src/components/tabs/OrganicoFormatos.tsx`
- `C:/Users/G15/waysuccess-dashboard/web/src/index.css`
- `C:/Users/G15/waysuccess-dashboard/organico-ganadores/ganadores.mjs`

## 2. Qué verifiqué y cómo

**Los totales no cambian.** Corrí `org_base_base` y `org_reporte_base` antes y después de la capa, con datos reales:

| Período | Contactos | Agendas | Asistencias | Asist. calificadas | Cierres | Cobrado |
|---|---|---|---|---|---|---|
| 1–27 nov, antes | 196 | 9 | 7 | 2 | 2 | US$15.000 |
| 1–27 nov, después | 196 | 9 | 7 | 2 | 2 | US$15.000 |
| Últimos 30 días, antes | 199 | 10 | 9 | 3 | 2 | US$15.000 |
| Últimos 30 días, después | 199 | 10 | 9 | 3 | 2 | US$15.000 |

- `org_reporte` da los mismos totales con los modelos primero, último y 50/50.
- El Resumen sale de `dash_datos()`, que no usa ninguna función `org_*`. No lo toqué, así que por construcción no puede cambiar.

**De los 33 contactos de ManyChat, se recuperaron 14 y quedaron 19.**
- 32 tenían `jessi` y 1 `ganadores`.
- Recuperados: 14. Confianza alta: 12. Confianza media: 2 (uno con el comentario 111 h antes y uno con el usuario escrito con `_` en vez de `.`).
- No recuperados: 19.
  - 18 no aparecen en ninguno de los 2.767 comentarios. Lo más probable es que hayan llegado por DM o respuesta a historia con la palabra, porque ManyChat también respondía DMs. Otras causas posibles: escribieron mal su usuario en el quiz o comentaron en algo que Meta no devuelve.
  - 1 (`spiritofnetwork`) comentó después de entrar, así que no cuenta.
  - `ganadores` (1 persona) puede ser solo el UTM por defecto del quiz para visitas sin UTM.

**Cobertura de la API.** Meta devolvió 2.767 de los 3.058 comentarios que marca `comments_count` (90 %). En algunos reels devuelve mucho menos; por ejemplo, el reel del 29-09 tiene 119 comentarios y la API devolvió 8. Lo más probable es que sean comentarios ocultos o borrados, o comentarios en la versión promocionada del post. No lo pude confirmar.

**Antes y después por publicación (1–27 nov, primer contacto).** "Antes" daba 0 contactos en todas las publicaciones.

| # | Publicación | Tipo | Publicada | Contactos antes → después | Recuperados | Toques previos | Comentarios con palabra clave | Vistas |
|---|---|---|---|---|---|---|---|---|
| 1 | Para investigar, para imágenes, para videos y para diseño… | Reel | 17-11 | 0 → 9 | 9 | 2 | 304 | 18 mil |
| 2 | Si tus diseños con IA se notan, no es culpa de la IA. | Carrusel | 16-11 | 0 → 3 | 3 | 0 | 114 | 21 mil |
| 3 | Mi agencia entera corre en Claude Code. | Carrusel | 14-11 | 0 → 2 | 2 | 0 | 42 | 11 mil |
| 4 | Cada PDF que le subes a Claude te quema hasta 70 mil tokens | Carrusel | 17-11 | 0 → 0 | 0 | 1 | 214 | 122 mil |
| 5 | Crea una fábrica de contenido usando Claude | Reel | 18-11 | 0 → 0 | 0 | 0 | 132 | 7 mil |
| 6 | Alguien construyó una agencia de Instagram completa… | Reel | 19-11 | 0 → 0 | 0 | 1 | 115 | 5 mil |
| 7 | Alguien acaba de compartir el prompt de Claude más útil… | Carrusel | 24-11 | 0 → 0 | 0 | 0 | 78 | 52 mil |
| 8 | Esta herramienta de Claude te crea 30 videos gratis | Reel | 20-11 | 0 → 0 | 0 | 0 | 63 | 6 mil |
| 9 | Seis prompts convierten a Claude en un tutor privado… | Carrusel | 21-11 | 0 → 0 | 0 | 0 | 56 | 81 mil |
| 10 | Este skill de Claude crea reels ilimitados… | Reel | 22-11 | 0 → 0 | 0 | 0 | 52 | 8 mil |

- En 1–27 nov, "ManyChat jessi" bajó de 32 a 18 contactos, y "ganadores" sigue con 1.
- Ninguno de los 14 recuperados agendó ni compró, así que no se movió ninguna agenda ni ningún dólar entre piezas.
- Hay 6 toques previos (4 de bio y 2 de historia) a la vista; no mueven el crédito.

**Capturas.** Usé el arnés playwright-core con datos simulados (`scratchpad/shot/shot3.js`) en escritorio 1440 px y celular 390 px: Reels, Posts, Todas las piezas y Contactos. Se ve la ↺, el aviso y los 🔑, y en el celular no hay desborde. `tsc` y `vite build` pasan.

**Producción.** Confirmé que el bundle publicado en Vercel ya trae el texto nuevo. `ganadores.mjs` entró con el login real y leyó las RPC nuevas sin error, así que los wrappers funcionan para usuarios autenticados.

**Lo que no verifiqué:** la pestaña en vivo con el login real (las capturas usan datos simulados) y la primera corrida del cron de las :41.

## 3. Pendiente o necesita OK del dueño

1. **El quiz ya no guarda el usuario de Instagram (desde el 24-11).**
   - Para los links únicos desde el 27-11 no hace falta.
   - Sin ese dato no se pueden cruzar los contactos de bio e historia con sus comentarios, ni a quien comenta y agenda sin pasar por el link.
   - Propuesta: volver a pedir el usuario de IG en el formulario del calendario, o guardarlo oculto cuando llega con el link `/l/`. Necesita OK del dueño y lo haría waysuccess-funnel.
2. **Señal de embudo roto, para mirar.** Del 18-11 al 24-11 los posts tuvieron cientos de comentarios con palabra clave (por ejemplo 214, 132, 115 y 78), pero ningún contacto entró al quiz con `jessi` después del 17-11 (salvo 1 el 21-11). Puede que en esos días el link de ManyChat no llegara al quiz o perdiera el UTM. ManyChat ya está apagado, así que es solo para entender el pasado.
3. Desde el 25-11, "Contactos" en Orgánico solo cuenta a quien agenda, porque el quiz ya no crea leads. El número de contactos de la última semana no se puede comparar con el de antes.
4. Vuelta atrás, si hiciera falta: `delete from org_atribucion_recuperada where true;` y quitar el cron `ig-comentarios`.

## 4. Para memoria

- 27-11 atribución retroactiva EN VIVO (dashboard `4bc168c`):
  - `org_comentarios`, que llena la edge function `ig-comentarios` con el cron `41 * * * *` (21 días; para rellenar, body `{"dias":90,"max_llamadas":1200}`).
  - Capa `org_atribucion_recuperada` (`credito` / `toque_previo`), que recalcula `org_recuperar_atribucion()`.
  - `org_base`/`org_reporte` tienen columnas nuevas: `recuperado`, `pieza_original`, `confianza`, `toque_previo`, `recuperados` y `toques_previos`. `org_comentarios_piezas()` da los comentarios con palabra clave por publicación.
  - En el dashboard, ↺ = recuperado por comentario.
- De los 33 contactos de ManyChat se recuperaron 14 (reel "Para investigar…" 17-11 = 9; carrusel "Si tus diseños con IA…" = 3; "Mi agencia entera corre en Claude Code" = 2). Los 19 restantes no aparecen en ningún comentario.
- El usuario de IG del quiz vive en `quiz_leads.respuestas->>'q_instagram'` (13–24-11). Desde el commit `9201b05` (24-11) el quiz no pide IG ni crea el lead.
- La API de comentarios de Meta devuelve cerca del 90 % de `comments_count`.

## 5. Pedidos a otros agentes

- **waysuccess-funnel**, si el dueño lo aprueba: volver a guardar el usuario de Instagram de quien agenda desde el orgánico (campo en el formulario del calendario Q5crAi9 o dato oculto desde `/l/<slug>`), para cruzar comentarios con bio e historias.
- **waysuccess-organico**: el `ganadores.md` nuevo trae la sección "Más comentarios con palabra clave". Las publicaciones con mucha intención y 0 contactos (18–24-11) muestran que el tema pegó aunque el link no convirtió. No hay que juzgarlas como malas.
