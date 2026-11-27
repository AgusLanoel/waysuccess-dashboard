# 27-11 — DMs y respuestas a historias de waysuccess_ con palabra clave

## 1. Qué hice

- **Función nueva `ig-dm-palabras`** (hermana de `ig-respuestas`, desplegada v2, `verify_jwt: false`, auth `x-sync-key`).
  Código: `C:/Users/G15/waysuccess-dashboard/supabase/functions/ig-dm-palabras/index.ts` (igual a lo desplegado, comparado).
  En cada pasada:
  1. Lee los mensajes **entrantes** de la bandeja de waysuccess_ (`/conversations`, con `story`) desde el cursor `org_ig_cursor.ws_dm` (relee 3 min hacia atrás; nunca más de 24 h).
  2. Cada mensaje se procesa **una sola vez**: `org_dm_vistos.mid` (id del mensaje = mid del webhook) es el candado.
  3. Detecta la palabra con la **misma `coincide()`** del webhook, sobre las palabras de las 3 automatizaciones activas, y solo si el mensaje tiene **4 palabras o menos** (ver abajo por qué).
  4. Registra el **toque** (`org_toques`, `ig_event_id = m:<mid>`, el mismo id que usa el webhook → no se cuenta doble): tipo `historia` (nivel A) si responde a una historia, `dm_kw` (nivel B) si es DM directo.
  5. Si la persona **no tiene apertura pendiente** (paso 1 en 24 h) **ni recibió link en 24 h**: crea su fila en `org_mensajes` (tipo `dm` o `historia`, `comentario_id = m:<mid>`), crea el link con `org_crear_link` (medium `dm`) y le manda la **apertura con respuesta rápida "Quiero mis guiones"**, `recipient = {id: igsid}` (respuesta a DM, no private reply). Si la respuesta rápida falla, un solo DM con todo y el link (como el webhook).
  6. El **paso 2 (link)** lo sigue mandando `ig-respuestas` cuando la persona responde: las filas nuevas entran en su mismo circuito (paso 1 → 2).
  - **Pieza**: si el mensaje responde a una historia → el código `hist-<nombre>-ws-<fecha>` de ese día si hay uno solo (el que se crea en Orgánico → Historias); si no, la historia misma (`ig-<id>`, tipo historia, como el webhook). DM directo → `auto-<nombre>` (`auto-jessi`, `auto-contenido`, `auto-ganadores`).
- **Decisión punto 2 (lo más simple)**: el sondeo **usa las automatizaciones de 'comentario'** (mismas palabras, mismos textos); **no** se crearon automatizaciones 'dm'/'historia'. Así el webhook, si Meta vuelve a mandar DMs, no encuentra automatización de DM y **no manda nada**: el único que contesta DMs es el sondeo → imposible duplicar. (Si algún día se crean automatizaciones 'dm'/'historia', hay que apagar este sondeo.)
- **Único cambio de texto** para DMs: "Gracias por comentar" → "Gracias por escribir", y en respuestas a historia "en el post" → "en la historia". El resto es literal.
- **Tablas nuevas** (migración `ig_dm_palabras_cursor`, con RLS y sin políticas): `org_ig_cursor` (cursor, arranca 27-11 16:00 Chile, cuando se apagó ManyChat) y `org_dm_vistos`. SQL: `C:/Users/G15/waysuccess-dashboard/supabase/sql/2026-11-27_ig_dm_palabras.sql`.
- `ig-webhook` e `ig-respuestas` **sin cambios**.

**Palabras que disparan** (10): Jessi, Jesi, JessiK, Jessy → JESSI · Contenido, Marca, Crecer → CONTENIDO · Ganadores, Ganador, Winner → GANADORES. Sin importar mayúsculas, tildes, emojis ni signos. Palabra exacta: "Jessica", "marcas" o "contenidos" no disparan.

**Por qué el tope de 4 palabras**: en la bandeja real hay mensajes largos de vendedores ("Sigo tu contenido…", "edición de videos…") que contienen CONTENIDO; con la regla de los comentarios les habría llegado la apertura en medio de una conversación. Con el tope, "CONTENIDO", "Marca!", "marca por favor", "quiero crecer" disparan; "Hola, tengo una marca de ropa y quiero crecer en redes" no.

## 2. Qué verifiqué y cómo

- **Detección con la bandeja real (solo lectura, modo `dry`)**: últimos 5 días, 55 mensajes entrantes → 1 disparo correcto ("jessi" de una persona el 23-11 → JESSI, `auto-jessi`); 3 mensajes largos de vendedores con "contenido" → "largo (no dispara)"; los 9 "Quiero mis guiones" de hoy → sin palabra (son el paso 2 de los comentarios, los atiende `ig-respuestas`). Desde las 16:00 de hoy no hay ningún DM con palabra → al activar no le llega nada a nadie por mensajes viejos.
- **Simulación** de `coincide()` + tope (21 casos, `node`): las 10 palabras disparan la automatización correcta; "Jessica", "marcas", "contenidos", "hola", frases largas no.
- La API acepta el campo `story` en `/conversations` (la consulta no dio error), pero **en 5 días no hubo ninguna respuesta a historia en la bandeja**, así que la ruta "pieza = historia" no está probada con un mensaje real.
- **Envío real: NO probado.** La pasada en vivo (`select private.call_fn('ig-dm-palabras','{}')`) la bloqueó el sistema de permisos ("comunicación no autorizada"), y no lo forcé. Además agustinlanoel recibió link hoy a las 14:38 Chile, así que la regla de 24 h lo saltaría hasta mañana. El envío usa el mismo POST `/<IG_ID>/messages` con `recipient {id}` y respuesta rápida que ya funcionan hoy en `ig-webhook` (apertura) e `ig-respuestas` (link).

## 3. Pendiente / necesita OK del dueño

- **Activar el cron** (no está corriendo; hoy nadie recibe nada por DM con palabra). Con el OK, correr en Supabase:
  ```sql
  update public.org_ig_cursor set valor = now(), actualizado_at = now() where clave = 'ws_dm'; -- opcional: no contestar lo viejo
  select cron.schedule('ig-dm-palabras', '* * * * *', $$select private.call_fn('ig-dm-palabras','{}'::jsonb)$$);
  ```
  Apagar: `select cron.unschedule('ig-dm-palabras');`
- **Tiempo de respuesta una vez activo**: apertura ≤ ~1 min después del DM (cron cada minuto); link ≤ ~1 min después de que la persona toca "Quiero mis guiones" (`ig-respuestas`).
- **Prueba de punta a punta** al activar: que alguien del equipo que **no** haya recibido link en las últimas 24 h escriba "CONTENIDO" respondiendo a una historia de waysuccess_ → debe llegar la apertura y, al tocar, el link; revisar `org_dm_vistos` / `org_mensajes` (tipo `historia`) y el toque en el dashboard.
- Confirmar con el dueño los 2 cambios de texto (comentar→escribir, post→historia) o dejarlos literales.

## 4. Para memoria

- 27-11 (9): DMs/respuestas a historias de waysuccess_ con palabra clave → edge fn `ig-dm-palabras` (sondeo de /conversations, cursor `org_ig_cursor.ws_dm`, candado por mensaje `org_dm_vistos.mid`), usa las automatizaciones de 'comentario' (no hay automatizaciones 'dm'/'historia' a propósito: así el webhook no duplica). Dispara solo si el DM tiene ≤ 4 palabras. Apertura con quick reply → paso 2 lo manda `ig-respuestas`. Pieza: `hist-<nombre>-ws-<fecha>` del día si hay una sola, si no `ig-<story>`; DM directo → `auto-<nombre>`. Modo prueba: body `{"dry":true,"desde":"<fecha>"}`. Cron `ig-dm-palabras` PENDIENTE de OK (bloqueado por permisos al probar en vivo).

## 5. Pedidos a otros agentes

- **waysuccess-organico**: en las historias de WS, pedir que respondan **solo la palabra** ("Respóndeme CONTENIDO"); mensajes de más de 4 palabras no disparan. Para que la historia quede atribuida a su pieza, crear un solo código `hist-<nombre>-ws-<fecha>` por día en Orgánico → Historias (si hay varios ese día, queda atribuida a la historia de IG).
