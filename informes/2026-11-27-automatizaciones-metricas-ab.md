# Informe 27/28-11 — Automatizaciones de IG: métricas tipo ManyChat, A/B testing y saludo con nombre

Orden: `waysuccess-hq/ordenes/2026-11-27-datos-automatizaciones-metricas-ab.md` + agregado del director (personalización del nombre).

## 1. Qué hice

**Supabase (migraciones solo aditivas, aplicadas):** `org_auto_metricas_ab_tablas`, `org_auto_metricas_ab_funciones`, `org_nombre_pila_v2`, `org_auto_embudo_comentarios_desde_app`. Archivo único en el repo: `supabase/sql/2026-11-27_auto_metricas_ab.sql`.
- Columnas nuevas (todas nulas/false por defecto): `org_mensajes.variante_id, test_id, respondio_at, saludo, saludo2, recordatorio_at, recordatorio_error`; `org_links.variante_id, variante`; `org_automatizaciones.recordatorio_activo (false), recordatorio_horas (4), recordatorio_texto`.
- Tablas nuevas (RLS sin políticas, solo por RPC): `org_auto_tests`, `org_auto_variantes`, `org_auto_asignaciones`, `org_nombres_pila` (~480 nombres de pila; marca los que también son palabras: Rosa, Aurora, Victoria…).
- RPC internas (solo service_role): `org_auto_asignar(auto, usuario)` (variante fija por persona, al azar con peso; sin test corriendo no devuelve nada), `org_nombre_pila(name, username)`, `org_auto_filas()` (una fila por DM de apertura con todo su recorrido).
- RPC del dashboard (chequean `vista_total()`): `org_auto_embudo(desde, hasta, p_por 'auto'|'pieza'|'saludo')`, `org_auto_alertas`, `org_auto_ab(test)`, `org_auto_tests_lista`, `org_auto_test_crear`, `org_auto_variante_guardar`, `org_auto_variante_quitar`, `org_auto_test_estado`, `org_auto_test_cerrar`, `org_auto_recordatorio_guardar`.
- Índices nuevos: slug en `org_mensajes`/`org_clics`, `utm_term` en `quiz_eventos`, campo slug de GHL.

**Edge functions (código igual en el repo):**
- `ig-webhook` v14 (`supabase/functions/ig-webhook/index.ts`): (a) A/B: si la automatización tiene un test **corriendo**, toma los textos y el destino de la variante de la persona y guarda `variante_id/test_id` en `org_mensajes` y `org_links`; sin test → idéntico a v13. (b) Saludo: `{nombre}` = name del perfil → si no hay, nombre sacado del usuario cuando es un nombre de pila → si no, "¡Hola!" (ya no "@usuario"); guarda `saludo` (nombre_api / nombre_usuario / sin_nombre / arroba). Si la RPC falla, vuelve al comportamiento anterior.
- `ig-respuestas` v3 (`supabase/functions/ig-respuestas/index.ts`): paso 2 con el texto de la variante (si la hay), guarda `respondio_at` (para medir toque→link) y personaliza el paso 2 con el nombre ("Adrián, acá lo tienes 👇…", nunca @usuario; guarda `saludo2`). Recordatorio único **apagado**: solo actúa si alguien lo prende y solo para aperturas por DM/historia.
- Respaldos para volver atrás al instante: commit anterior `465f07a` (v13 y v2).

**Dashboard (`web/`):** sección nueva **Automatizaciones** en Orgánico, entre "Contactos orgánicos" e "Instagram" (`web/src/components/tabs/OrganicoAutomatizaciones.tsx`, estilos al final de `web/src/index.css`, enganche en `Organico.tsx`):
- Embudo por palabra, por publicación (orden por aperturas, CTR o agendas = ranking) y por tipo de saludo: comentarios → aperturas (y fallidas) → tocaron (tap rate) → links → clics (CTR) → quiz completo (y abrieron calendario) → agendas → calificadas → cierres y US$; mediana comentario→apertura y toque→link; únicos vs repetidos; % de errores con motivos.
- Aviso rojo si un día tiene > 10 % de errores de entrega (con ≥ 10 intentos).
- Tests A/B: crear (A = texto actual, B = copia), editar variantes (texto de apertura, botón ≤ 20, mensaje del link, destino, peso), arrancar/pausar, tabla por variante con todas las tasas, P(gana a A) bayesiana beta-binomial, muestra mínima para ver +20 %, "ganadora" solo con ≥ 95 % y ≥ 100 aperturas por variante, cerrar eligiendo con cuál se queda (sugiere la de los datos). Una variante con personas asignadas ya no cambia de texto (solo peso).
- Recordatorio: formulario por automatización, apagado, con confirmación "¿el dueño dio el OK?".

## 2. Cómo lo verifiqué

- **Reglas del Resumen:** agendas/calificadas/cierres salen de `org_base_base` (la misma función de la pestaña Orgánico, que ya cuadra con el Resumen): 1ra agenda calificada por fecha de reserva, asistencias calificadas, cierres por fecha de cierre.
- **Embudo con datos reales** (`org_auto_embudo('2026-11-20','2026-11-28')`): ver números abajo. Cuadra con `org_mensajes` (65 aperturas) y con `org_clics`.
- **A/B sin tocar producción:** prueba dentro de una transacción con rollback: sin correr → 0 asignaciones; corriendo 50/50 sobre 2.000 usuarios → A 981 / B 1.019; misma persona siempre misma variante (200/200); edición bloqueada con personas; pausado → 0; cerrar copia la ganadora a la automatización. Después: 0 tests, 0 asignaciones, botón de JESSI intacto ("Quiero mis guiones").
- **Nombre:** sobre los 63 usuarios reales: 16 con name del perfil, 21 recuperados del usuario (samuelpr_9→Samuel, fernandez.sergio.d1982→Sergio, miguelangel0605→Miguel, dra.jimenabardales→Jimena, soydani_silva→Dani), 26 sin nombre → "¡Hola!" (sm.paisajismo, imperiogtmultiservicesllc, azteca.studio…). Antes: 46 de 65 salían con @usuario.
- **Edge functions:** `tsc` estricto + `esbuild` sin errores; ig-webhook v14 arranca (GET de prueba → 403 esperado).
- **Comentario real después del deploy:** {{VERIFICACION_WEBHOOK}}
- **Paso 2 real:** {{VERIFICACION_RESPUESTAS}}
- **Diseño:** capturas con datos simulados (playwright-core, intercepta Supabase) en escritorio 1440 y celular 390: sin scroll horizontal (había desborde en celular por la grilla; corregido con `minmax(0,1fr)` en `.ig-bloque`, que también arregla el bloque Instagram). `npm run build` sin errores.

## Números reales del embudo por palabra (desde que responde nuestra app, 27-11 17:15 UTC → 28-11 03:15 UTC)

| | JESSI | CONTENIDO | GANADORES |
|---|---|---|---|
| Comentarios con palabra (top-level) | 55 (52 personas) | 8 | 0 |
| Aperturas enviadas / fallidas | 57 / 0 | 8 / 0 | 0 |
| Personas únicas / repetidos | 52 / 5 | 8 / 0 | — |
| Tocaron el botón (tap rate) | 30 (56 %) | 3 (38 %) | — |
| Links enviados | 30 | 3 | — |
| Clics (CTR = clics ÷ links) | 11 (37 %) · 15 clics totales | 3 (100 %) · 4 totales | — |
| Clic ÷ apertura | 19 % | 38 % | — |
| Quiz empezado / completo | 7 / 6 | 3 / 3 | — |
| Abrieron el calendario | 1 | 0 | — |
| Agendas / calificadas / cierres | 0 / 0 / 0 | 0 / 0 / 0 | — |
| Mediana comentario → apertura | 5,3 s | 6,1 s | — |
| Errores de entrega | 0 % | 0 % | — |

Notas: el quiz ya no crea lead antes de agendar (desde 24-11 el contacto se crea en el formulario del calendario), así que "lead/quiz" = quiz completo según `quiz_eventos` del slug. Toque→link se mide desde ahora (antes no se guardaba el momento del toque). Las publicaciones con más aperturas: ig-18186803548426848 (33 aperturas, 16 toques, 6 clics, 3 quiz), ig-18080734967734989 (8/4/2/1).

**CTR por tipo de saludo (histórico, 65 aperturas):**

| Saludo | Aperturas | Tap rate | CTR | Clic ÷ apertura |
|---|---|---|---|---|
| "@usuario" | 46 | 57 % | 42 % (11/26) | 24 % |
| Nombre del perfil | 17 | 41 % | 43 % (3/7) | 18 % |

Probabilidad de que el nombre le gane al @: 15 % en tap rate, 34 % en clic/apertura → **no hay diferencia demostrable** (muestra chica; para ver +20 % en clic/apertura hacen falta ~1.500 aperturas por variante; en tap rate ~340). No es un test limpio (quién tiene nombre no es al azar).

## Cómo se crea un test (dueño, desde el dashboard)

1. Orgánico → sección **Automatizaciones** → **Tests A/B** → **+ Nuevo test**: elegir la automatización, nombre y con qué métrica gana (tocaron, clics o agendas, todas ÷ aperturas). Se crea en **borrador**: A = lo que corre hoy, B = copia.
2. **Editar** la B (apertura, botón ≤ 20, mensaje del link, destino, peso). Se puede agregar C, D…
3. **Arrancar**. Desde ahí cada persona nueva recibe una variante al azar según el peso, siempre la misma. Pausar = vuelve a todos a la A.
4. Cuando una variante dice ✓ (≥ 95 % y ≥ 100 aperturas por lado), **Cerrar test** eligiendo con cuál se queda: pasa a ser el texto de la automatización. El historial queda.

**Test sugerido (preparado, NO arrancado):** "@usuario vs sin nombre" — hoy el código ya no manda @usuario (orden del director), así que para probarlo hay que crear el test en JESSI con A = actual ("¡Hola {nombre}!" → sale "¡Hola!" sin nombre) y B con "¡Hola @{usuario}!"… {{nota}} Ojo: `{usuario}` no existe como variable; si el dueño quiere este test, pedirlo y lo agrego (10 min). Alternativa que sí funciona hoy: A "¡Hola {nombre}! Gracias por comentar…" vs B "Gracias por comentar {palabra} 🙌…" (sin saludo).

## 3. Pendiente / necesita OK del dueño

- **Recordatorio**: construido y apagado. Limitación real de Meta: a quien **comentó** solo se le puede mandar un mensaje privado hasta que responda, así que el recordatorio solo sirve para quien escribió por DM o respondió una historia (flujo `ig-dm-palabras`, cuyo cron también espera OK). Prenderlo = OK del dueño.
- **Arrancar cualquier test** = OK del dueño (ninguno creado).
- `ig-dm-palabras` (sin cron) sigue con el saludo viejo (@usuario) y sin variantes; si se activa, conviene pasarle el mismo cambio.
- El conteo de comentarios viene de `ig-comentarios` (cada hora), por eso a veces aperturas > comentarios (104 %) hasta la próxima sincronización.
- Push a `main`: {{PUSH}}

## 4. Para memoria

- 28-11: sección **Automatizaciones** en Orgánico (embudo por palabra/publicación/saludo + tests A/B). RPC `org_auto_embudo/ab/alertas/tests_*`; base `org_auto_filas()`; agendas con `org_base_base` (mismas reglas que Resumen).
- A/B: `org_auto_tests` (borrador/corriendo/pausado/cerrado, uno abierto por automatización), `org_auto_variantes` (A = control), `org_auto_asignaciones` (fija por persona). ig-webhook v14 usa `org_auto_asignar`; sin test corriendo = v13.
- Saludo: `org_nombre_pila` + tabla `org_nombres_pila` (agregar nombres ahí). Ya no se saluda con @usuario. `org_mensajes.saludo` / `saludo2`.
- Meta: a un comentario solo se le puede mandar 1 mensaje privado hasta que responda → recordatorios solo para DM/historia.
- Desde 24-11 el quiz no crea lead hasta el calendario: el "lead" del orgánico se mide con `quiz_eventos` por `utm_term` (slug).

## 5. Pedidos a otros agentes

- Ninguno.
