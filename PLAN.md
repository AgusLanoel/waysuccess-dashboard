# Dashboard de atribución WaySuccess (tipo Hyros)

Objetivo: ver, por cada anuncio de Meta, el gasto → agendas → calificadas → asistencias → ofertas → cierres → vendido → cobrado.

## Piezas
- Supabase (proyecto iqiyhlcqnxwtdhmmrlsp): base de datos + Edge Functions (webhooks y carga diaria).
- Meta Marketing API (token de usuario de sistema): gasto por anuncio y por día de la cuenta 1327704949277228 (Waysuccess Ads USA). La cuenta 1376171866434598 (WaySuccess Ads) está cerrada y no se usa.
- GHL (token Private Integration + webhooks de workflows): contactos, agendas, oportunidades, pagos.
- Landing en Vercel: visitor_id + primer/último clic pagado → calendario GHL. (Cambio de tracking: requiere aprobación.)
- Dashboard web con login (Vercel).

## Fases
0. Accesos (este documento + GHL-CAMPOS.md). Listo el 2026-10-14: la Edge Function `check-access` confirmó los 3 secretos. Hay 17.479 contactos, 4.855 oportunidades y 3 calendarios en GHL, y 0 transacciones en GHL Payments.
1. Captura del ad_id  ← en curso. Hallazgo del 2026-10-14: GHL guarda en `attributions[].url` la URL completa de la landing, con todos los parámetros. Los anuncios actuales ya mandan `utm_id` = ID de campaña y `utm_term` = un ID de Meta (parece el del conjunto), y `utm_content` sigue siendo un código manual. Para los anuncios nuevos alcanza con agregar `&ad_id={{ad.id}}` en "Parámetros de URL", sin tocar la landing GHL. Cuando el tráfico pase al funnel de Vercel, hay que sumar `ad_id` a `UTM_KEYS` (src/lib/site.ts), porque hoy solo reenvía utm_* al calendario. Ese cambio necesita aprobación.
   Cobrado: se carga a mano (llamadas de venta, no pasa por GHL). La fuente es la hoja "Tracker Ads" → Llamadas, y cada cobro necesita email o teléfono para cruzarlo con el contacto.
2. GHL como fuente de verdad (campos, pipeline, pagos). Pospuesto: por ahora la hoja "Llamadas" es la fuente de asistencias, ofertas, cierres, vendido y cobrado.
3. Datos. Listo el 2026-10-14. Las tablas están en Supabase y la carga es por pg_cron: Meta cada 2 h, GHL cada 20 min más una pasada diaria de 120 días. La hoja llega por Apps Script cada 15 min, **pendiente de instalar por el usuario** (`apps-script/SyncLlamadas.gs`; la versión con la clave está en `secrets/`). Detalle en `supabase/functions/README.md`.
4. Dashboard. Listo el 2026-10-14 en https://waysuccess-dashboard.vercel.app (repo privado AgusLanoel/waysuccess-dashboard, root `web/`, cada push a main se publica). El acceso requiere login de Supabase y estar en `dashboard_members`. Los usuarios se crean con `select private.call_fn('admin-create-user', '{"email":"…","password":"…"}')`.
   Definiciones: agenda = cita en los calendarios aLqJ…/l6nD…, contada por la fecha en que se agendó. Calificada = respuesta de facturación del formulario (campo 3rpSwnn007zZp1yFwwj7) que no empieza con "Menos" (deducido de los datos; GHL cancela 91-100% de esas agendas; coincide con los Schedule de Meta). Atribución = último clic (`lastAttributionSource` de GHL): `ad_id`, o `utm_content` numérico → anuncio; `utm_term` → conjunto; `utm_id` → campaña. Result. Meta = `offsite_conversion.fb_pixel_custom` (el Schedule que manda GHL por CAPI).
5. Envío de etapas/valor a Meta (con aprobación)
6. Validación semanal

## Secretos (NUNCA en el chat ni en git): Supabase → Edge Functions → Secrets
- META_SYSTEM_TOKEN
- GHL_PIT_TOKEN
- GHL_LOCATION_ID

## Cómo abrirlo
Se usa local, sin gastar en hosting: acceso directo "Dashboard WaySuccess" en el escritorio → `Abrir dashboard.bat` → http://localhost:5190. Los datos se siguen cargando solos en Supabase por cron.

## Para retomar (2026-10-14)
1. Verificar en GHL (Chrome "Browser 2") que el email de rechazo de la rama None del workflow "Confirmación de Calificación — WaySuccess" (555fa79f-…) quedó borrado y guardado. Se tocó Delete, pero el navegador dejó de responder y no se confirmó.
2. Decidir si se borra el proyecto de Vercel (Hobby = uso no comercial). Hace falta el OK del usuario.
3. LISTO el 2026-10-15. La fuente de ventas es la hoja **"WaySucess - Tracker Comercial"** (id 105oZEzxIuvon9f37P2sK_HIQ0vxUFVOnntER-NaiLRk), pestaña Llamadas. Reemplaza a "Tracker Ads". La envía cada 15 minutos el proyecto de Apps Script independiente "WaySuccess - Sync ventas al dashboard" (script.google.com, cuenta /u/1), que usa el código de `apps-script/` y se autentica con el token de identidad de Google, sin clave. La cuenta y el aud quedaron fijados en settings.sheet_identity; para cambiarlos, poner `{"pending":true}`.
4. Cambiar la contraseña inicial desde el botón "Contraseña" del dashboard.
5. Definir quién más tiene acceso (Ale, Zulia, closers).
6. Siguiente proyecto: flujo de email marketing.

## Atribución por anuncio (2026-10-15)
El formulario GHL "Funnel ADS" (zVtzBzpnciZhkDpAq1ul) guarda utm_source (campo FX69lW9hbVHb7rDApCoA), utm_medium (HsU5r1aGIuls9VwfHiQl) y dos campos con utm_campaign/utm_content (CvJKxtD5kd7XYFUOSgj8 y j42OHsWSKDVvMWkv48Le). Los nombres de esos dos están cruzados: j42O tiene el código del anuncio. Ese código es el mismo que viene en la URL.
- Los anuncios actuales llevan en utm_content un código manual que coincide con el nombre del anuncio dentro del conjunto (E-AD02 → "E-AD02", ORG-04 → "ORG-04-Variable", TRTFCMARIO → "TRT FC MARIO").
- `public.match_ad(adset, código)` resuelve el anuncio. Primero busca un nombre igual, después uno que empiece con el código, y si el conjunto tiene un solo anuncio usa ese. Si hay ambigüedad devuelve null.
- `v_contact_attribution` lo usa cuando no hay ad_id en la URL.
- Verificado con el gasto: cada código recibe agendas en el anuncio que concentra el gasto de su campaña.
- Riesgo: si alguien copia un anuncio sin cambiar el utm_content, las agendas de la copia se van al original. Por eso conviene sumar `&ad_id={{ad.id}}` en los anuncios nuevos.

## Ajustes 2026-10-15
- El dashboard es SOLO Ads (pedido del usuario). No mostrar ventas orgánicas, de afiliados ni de referidos.
- `is_paid`: es pago si tiene IDs de Meta, o si la fuente es Meta y el medium no es social/bio/organic/reels. Los links de la bio de IG son orgánicos.
- Las ventas de Ads de la cuenta cerrada van en la fila "Anuncios de otra cuenta (cerrada)" y como sub-línea de los KPI Vendido y Cobrado.
- `link_sheet_calls` necesita `where s.row_num >= 0` porque pg_safeupdate bloquea los UPDATE sin WHERE.
- `secrets/SyncLlamadas_CON_CLAVE.gs` es obsoleto: la hoja se autentica con el token de identidad de Google.

## Decisiones
- 2026-10-14: los anuncios activos con la promesa vieja (50/50, "2.000 leads") quedan prendidos por decisión del usuario.
