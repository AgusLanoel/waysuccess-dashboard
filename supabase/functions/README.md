# Edge Functions (copia de referencia)

El código que corre está desplegado en Supabase (proyecto `iqiyhlcqnxwtdhmmrlsp`). Para ver la versión exacta en producción: Supabase → Edge Functions, o pedirle a Claude `get_edge_function`.

| Función | Qué hace | Quién la llama |
|---|---|---|
| `sync-meta` | Anuncios + métricas diarias por anuncio de la cuenta Waysuccess Ads USA | pg_cron cada 2 h (`7 */2 * * *`) |
| `sync-ghl` | Citas de los 2 calendarios de llamadas, oportunidades del pipeline Closers, contactos con atribución | pg_cron cada 20 min (14 días) + diario 09:15 UTC (120 días) |
| `sheet-ingest` | Recibe la pestaña "Llamadas" de la hoja "WaySucess - Tracker Comercial". Lee las columnas por nombre de encabezado | Apps Script de la hoja, cada 15 min (`apps-script/SyncLlamadas.gs`) |
| `admin-create-user` | Crea usuarios del dashboard o les resetea la contraseña, y los agrega a `dashboard_members`, que es lo que da acceso a los datos | Manual, desde SQL: `select private.call_fn('admin-create-user', '{"email":"…","password":"…"}')` |
| `ghl-scope-check` | Verifica permisos de GHL_PIT_TOKEN (lectura + escritura no-op) y lista los campos de la oportunidad | Manual |
| `check-access` | Verifica que los tokens de Meta y GHL respondan | Manual |
| `ghl-explore` | Exploración de la estructura de GHL | Manual |
| `control-crm` | Bot de Telegram: aviso de cierre de día (`control_cierre_aviso()`) y detalle por persona al escribirle un nombre (`control_cierre_persona()`). Acciones: `enviar`, `ver`, `webhook`, `responder` | pg_cron 21:00 ART (`0 0 * * *` UTC) + webhook de Telegram (miembros por invitación: `/invitar`, `/equipo`, `/quitar`) |
| `ig-comentarios` | Lee los comentarios (y respuestas) de posts, carruseles y reels de los últimos 21 días → `org_comentarios`; después `org_recuperar_atribucion()` (capa `org_atribucion_recuperada`: crédito por comentario para contactos que entraron por link genérico de ManyChat antes del 27-11). Solo lectura de Meta, con reintentos y freno al 85 % de uso. Body opcional `{"dias":90,"max_llamadas":1200}` para rellenar | pg_cron `41 * * * *` |
| `check-attribution` | Desactivada (410) | — |

Autenticación: todas excepto `sheet-ingest` exigen el header `x-sync-key`, que vive en Vault (`sync_key`) y solo se usa desde `private.call_fn()`. `sheet-ingest` exige `x-sheet-key` (Vault `sheet_key`).

Secretos de las funciones (Supabase → Edge Functions → Secrets): `META_SYSTEM_TOKEN`, `GHL_PIT_TOKEN`, `GHL_LOCATION_ID`, `TELEGRAM_BOT_TOKEN`.
