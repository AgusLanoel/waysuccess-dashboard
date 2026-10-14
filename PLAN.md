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
   Cobrado: se carga a mano (llamadas de venta, no pasa por GHL). La fuente es la hoja "Tracker Ads" → Llamadas, y cada cobro necesita email o teléfono para cruzarlo con el contacto. ({{ad.id}} en anuncios nuevos + script en la landing + prueba de agenda)
2. GHL como fuente de verdad (campos, pipeline, pagos)
3. Datos (tablas, carga diaria de Meta, webhooks de GHL, importar el historial de la hoja)
4. Dashboard
5. Envío de etapas/valor a Meta (con aprobación)
6. Validación semanal

## Secretos (NUNCA en el chat ni en git): Supabase → Edge Functions → Secrets
- META_SYSTEM_TOKEN
- GHL_PIT_TOKEN
- GHL_LOCATION_ID

## Decisiones
- 2026-10-14: los anuncios activos con la promesa vieja (50/50, "2.000 leads") quedan prendidos por decisión del usuario.
