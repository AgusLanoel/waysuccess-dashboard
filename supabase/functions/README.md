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
| `control-crm` | Manda por Telegram el aviso de cierre de día (`control_cierre_aviso()`). Acciones: `enviar`, `vincular`, `ver` | pg_cron 21:00 ART (`0 0 * * *` UTC) |
| `check-attribution` | Desactivada (410) | — |

Autenticación: todas excepto `sheet-ingest` exigen el header `x-sync-key`, que vive en Vault (`sync_key`) y solo se usa desde `private.call_fn()`. `sheet-ingest` exige `x-sheet-key` (Vault `sheet_key`).

Secretos de las funciones (Supabase → Edge Functions → Secrets): `META_SYSTEM_TOKEN`, `GHL_PIT_TOKEN`, `GHL_LOCATION_ID`, `TELEGRAM_BOT_TOKEN`.
