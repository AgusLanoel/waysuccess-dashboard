# Tutorial en video con NotebookLM — Dashboard + Pipeline de Venta

## Cómo usarlo (3 pasos)

1. En NotebookLM, crear un notebook nuevo y subir como fuente **solo** la "PARTE 2 — Fuente" de este archivo (copiar y pegar como "Texto copiado"). No subas el SOP viejo: tiene etapas y personas desactualizadas.
2. En el panel Studio → **Video Overview** → lápiz / "Personalizar". Pegar la "PARTE 1 — Prompt". Idioma: Español.
3. Generar. Si sale muy largo, pedir de nuevo agregando al final: "Máximo 8 minutos".

---

## PARTE 1 — Prompt (pegar en "Personalizar" del Video Overview)

Creá un video tutorial en español rioplatense, claro y práctico, para el equipo comercial de WaySuccess: closers (Luca y Jenny), la setter (Laura), finanzas (Zulia y Backeth) y los dueños (Agustín y Ale). El objetivo es que, al terminar de verlo, cada persona sepa exactamente qué tiene que hacer en GoHighLevel (GHL) y cómo leer el dashboard. Usá solo la información de la fuente; no inventes funciones, campos ni números.

Estructura del video, en este orden:

1. Apertura (30 s): la regla número uno. Todo lo comercial se carga en GHL StartFly, en el pipeline "2. Leads (Agendado) - Venta". Las planillas se eliminan. Si no está en la oportunidad de GHL, no existe en el dashboard. Las ventas salen únicamente de las oportunidades marcadas como Won en la etapa "Cerrado - Contrato".

2. El recorrido de un lead por el pipeline: mostralo como un diagrama de flujo con las 12 etapas en orden (Triaje, Agenda, Agenda Contactada, Llamada Confirmada, No Show, 2da Llamada Agenda, P1, P3, P5, Reserva, Cerrado - Contrato, No Califica). Explicá para qué sirve cada una con una frase.

3. La etapa nueva "Agenda Contactada": dale una sección propia. Explicá que está entre Agenda y Llamada Confirmada, que la setter tiene que mover la oportunidad apenas habla con el lead, y por qué importa: mide si quedan agendas sin contactar, cuánto tarda la setter en contactar y si contactar sube la asistencia. Remarcá que el campo "Setter" tiene que quedar cargado.

4. Qué hace cada persona, rol por rol: setter, closers, finanzas y dueños. Para los closers, mostrá como tabla "después de cada llamada": resultado → etapa a la que se mueve → campos a completar → estado (Open, Won o Lost). Insistí en que cuando se vende hay que marcar Won y completar valor, Fecha de cierre y $Efectivo recolectado, porque si no, la venta no aparece.

5. El error más común en GHL: la vista "Open opportunities" esconde las ventas ganadas, por eso "Cerrado - Contrato" parece vacía. Mostrá cómo verlas (filtro de estado en All o vista de lista).

6. Cómo usar el dashboard: entrar, elegir el período, el botón Actualizar y qué ve cada rol (los closers ven "Mi día" y "Mis números"; los dueños ven además Comercial completo y Ads). Recorré la pestaña Comercial de arriba hacia abajo, con una frase por sección, incluida la sección nueva "Setter".

7. Las definiciones que más se confunden: show rate, cierre nuevo vs de seguimiento, vendido vs cobrado, y que una venta cuenta en el mes en que se cerró.

8. Rutina diaria y semanal, como checklist por horario.

9. Cierre (20 s): las 3 cosas que no pueden fallar: mover la etapa el mismo día, marcar Won con monto y fecha, y mover a "Agenda Contactada" apenas se contacta.

Estilo: tono de compañero que explica, no de manual. Frases cortas. Usá diagramas de flujo, tablas y checklists en pantalla en lugar de párrafos. Nombrá las etapas y los campos exactamente como aparecen en GHL, entre comillas. Ejemplos concretos ("el lead reserva a las 10, Laura le escribe a las 11 y lo pasa a Agenda Contactada"). No muestres nombres de clientes reales ni montos de clientes. Duración ideal: 6 a 8 minutos.

---

## PARTE 2 — Fuente (pegar como fuente en NotebookLM)

# Guía del equipo comercial WaySuccess: pipeline de Venta en GHL y dashboard

Actualizada el 25-10-2026.

## 1. La regla número uno

GHL StartFly es el único lugar donde se carga la información comercial, en el pipeline "2. Leads (Agendado) - Venta". Las planillas (sheets) se van a eliminar y el dashboard ya no las usa. Si algo no está cargado en la oportunidad de GHL, no existe en el dashboard.

Las ventas (cierres, vendido y cobrado) salen únicamente de las oportunidades marcadas como **Won** en la etapa "Cerrado - Contrato".

Cómo viaja la información:
1. El equipo carga en GHL: la setter contacta y confirma, los closers cargan cada llamada y finanzas carga los cobros.
2. Cada 20 minutos la base de datos trae todo de GHL, calcula las métricas y decide quién ve qué. También suma la inversión en Meta Ads.
3. El dashboard lo muestra. Nadie carga nada a mano en el dashboard.

## 2. Las etapas del pipeline, en orden

1. **Triaje**: entrada para revisar si el lead califica. Las agendas que no califican (cita cancelada automáticamente) quedan acá y no se contactan.
2. **Agenda**: el lead reservó una llamada válida y todavía nadie habló con él.
3. **Agenda Contactada** (NUEVA): la setter ya habló con el lead (por WhatsApp, llamada o mensaje) pero la asistencia todavía no está confirmada.
4. **Llamada Confirmada**: el lead confirmó que va a estar en la llamada.
5. **No Show**: no se presentó a la llamada.
6. **2da Llamada Agenda**: hace falta una segunda llamada y ya está agendada.
7. **P1 - No tiene interés en este momento**: seguimiento frío.
8. **P3 - Interés pero no puede ahora**: seguimiento caliente.
9. **P5 - Compra este mes**: va a comprar este mes.
10. **Reserva**: dejó una reserva (seña).
11. **Cerrado - Contrato**: compró. Siempre con el estado Won.
12. **No Califica**: el closer lo descalificó. Estado Lost.

## 3. La etapa nueva: Agenda Contactada

Se agregó entre "Agenda" y "Llamada Confirmada" para medir el trabajo de la setter.

Qué hay que hacer: apenas la setter habla con el lead, mueve la oportunidad de "Agenda" a "Agenda Contactada" y completa el campo **Setter** (Laura o Automática). Cuando el lead confirma, la pasa a "Llamada Confirmada".

GHL guarda la hora exacta de cada movimiento, y con eso el dashboard calcula:
- Cuántas agendas siguen sin contactar en este momento, y en cuáles la llamada ya pasó sin que nadie hablara con el lead.
- El porcentaje de agendas contactadas y el porcentaje contactadas antes de la hora de la llamada.
- Cuánto se tarda en contactar, desde que el lead reserva hasta que pasa a "Agenda Contactada" (mediana y el tiempo en el que se contacta al 90%).
- Si contactar sube la asistencia: el show rate de las agendas contactadas contra el de las no contactadas.

Una agenda que pasa directo a "Llamada Confirmada" también cuenta como contactada.

Ejemplo: un lead reserva el lunes a las 10:00 para el martes a las 15:00. Laura le escribe a las 11:00, él responde y Laura lo mueve a "Agenda Contactada". El dashboard registra 1 hora hasta el contacto, contactada antes de la llamada. Cuando el lead confirma, Laura lo pasa a "Llamada Confirmada".

## 4. Qué hace cada persona

### Setter (Laura)
1. Cada mañana a las 9 h, y durante el día: abrir las agendas nuevas en "Agenda" y contactar a cada lead lo antes posible.
2. Apenas habla con el lead: moverlo a **Agenda Contactada** y completar **Setter** = Laura.
3. Cuando confirma: moverlo a **Llamada Confirmada** y poner **Asistencia Confirmada** = Sí.
4. Si reagenda: cargar **Fecha de reagenda** y **Razón de reagenda**, y dejar la oportunidad con la nueva cita.
5. Si no se presenta y el closer no lo movió: pasarlo a **No Show**.

### Closers (Luca y Jenny; también Ale cuando cierra)
1. Antes de la llamada: abrir la oportunidad y verificar que el campo **Closer** tenga su nombre.
2. Después de cada llamada, ese mismo día: mover la etapa y completar los campos (ver tabla de la sección 5).
3. Cada mañana: revisar los seguimientos vencidos en "Mi día" y contactarlos; al hacerlo, cargar la nueva **Fecha próximo seguimiento**.
4. Cuando cobra algo de una venta propia: actualizar **$Efectivo recolectado** con el total cobrado hasta hoy, no solo el último pago.

### Finanzas (Zulia y Backeth)
1. Cada cobro que entra (Whop, Stripe o transferencia): en la oportunidad ganada, actualizar **Estado cuota N** = Cobrada, **Cuotas cobradas**, **$Efectivo recolectado** (total acumulado) y **Saldo pendiente**.
2. Cargar el próximo vencimiento: **Próximo cobro - fecha** y **Próximo cobro - monto**.
3. Si una cuota no entra en su fecha: **Estado cuota N** = Vencida (o Fallida si rebotó el pago) y avisar al closer.
4. Cada lunes: comisiones de la semana anterior desde la tabla Closers del dashboard (3% DFY y 5% JessiK sobre lo cobrado).

### Dueños (Ale y Agustín)
- Ale: en sus ventas hace lo mismo que un closer. Los lunes revisa el mes en curso contra el mes pasado y la pestaña Ads.
- Agustín: todos los días a las 19 h revisa "Calidad de datos" y pide a cada uno lo que le falta antes del reporte de las 20 h. Las cuentas nuevas, los closers nuevos y los cambios de comisión se le piden a él. Las etapas y los campos de GHL no se renombran sin avisarle, porque el dashboard lee esos nombres.

## 5. Después de cada llamada (closers)

Siempre, en toda llamada: **¿Asistió?**, **Oferta** (DFY $30k o JessiK $10k), **Calificación closer** (Calificado, Descalificado o Anti-ICP) y **¿Se realizó la oferta?**.

Después, según cómo terminó:

| Resultado | Mover a | Completar además | Estado |
|---|---|---|---|
| No se presentó | No Show | ¿Asistió? = No | Open |
| No califica | No Califica | Calificación closer + Motivo de pérdida | Lost |
| No le interesa ahora | P1 - No tiene interés en este momento | Razón de seguimiento + Fecha próximo seguimiento | Open |
| Le interesa pero no puede ahora | P3 - Interés pero no puede ahora | Motivo de no venta + Fecha próximo seguimiento | Open |
| Compra este mes | P5 - Compra este mes | Fecha próximo seguimiento | Open |
| Necesita otra llamada | 2da Llamada Agenda | Agendar la cita | Open |
| Dejó una reserva | Reserva | Monto de la reserva + Razón de reserva + Fecha próximo seguimiento | Open |
| Compró | Cerrado - Contrato | Valor de la oportunidad (total vendido), Fecha de cierre, $Efectivo recolectado, Plan de pago, Método de cobro, Cuotas | **Won** |
| Se cae definitivamente | la que esté | Motivo de pérdida | Lost |

Si se grabó la llamada: pegar el link en **Link grabación llamada** y un resumen de 2 o 3 líneas en **Resumen de la llamada**.

**Importante sobre las ventas:** una venta solo aparece en el dashboard si la oportunidad está en "Cerrado - Contrato" con el estado **Won** y tiene cargados el valor, la Fecha de cierre y $Efectivo recolectado.

## 6. El error más común: "Cerrado - Contrato" parece vacía

La vista del tablero de GHL que se llama "Open opportunities" muestra solo las oportunidades abiertas. Cuando una oportunidad se marca como Won, deja de estar abierta y desaparece de esa vista, aunque sigue en "Cerrado - Contrato". Para ver las ventas: en "Advanced filters", poner el estado en All, o usar la vista de lista.

## 7. Cómo usar el dashboard

Se entra en waysuccess-dashboard.vercel.app con el email y la contraseña personal. La primera vez, se cambia la contraseña con el botón "Contraseña", arriba a la derecha.

Qué ve cada rol:
- **Closers**: "Mi día" (llamadas de hoy y mañana con teléfono, producto, facturación y negocio del lead, más el link a GHL; sus seguimientos de los próximos 7 días; lo que les falta completar) y "Mis números" (sus resultados). Cada closer ve solo lo suyo.
- **Dueños**: "Comercial" completo, "Mi día" de cualquier closer y "Ads". La pestaña Ads la ven solo Agustín y Ale.

Controles:
1. **Período**: Hoy, Ayer, 7, 14 o 30 días, Este mes, Mes pasado o Personalizado. Todo se compara contra el período anterior del mismo largo.
2. **Actualizar**: trae GHL y Meta en el momento. Si no se toca, el dashboard se actualiza solo cada 20 minutos.

La pestaña Comercial, de arriba hacia abajo:
- **Vista empresa**: el embudo por fuente (Ads, Orgánico, Referidos y Afiliados).
- **Números principales**: agendas, llamadas, show rate, ofertas, cierres, vendido, cobrado, cash pendiente y ticket promedio.
- **DFY vs JessiK**: el mismo embudo separado por producto.
- **Closers**: llamadas, show rate, ofertas, cierres, % cierre, vendido, cobrado, comisión y cuántos tiene cada uno en seguimiento.
- **Setter (NUEVA)**: agendas sin contactar en este momento, % contactadas, % contactadas antes de la llamada, tiempo hasta el contacto y show rate de contactadas contra no contactadas. Debajo, la lista de agendas sin contactar, ordenadas por hora de la llamada, con teléfono y link a GHL. Las que ya pasaron se marcan en rojo.
- **Cierres**: cada venta del período, con closer, producto, plan, método y días hasta el cierre.
- **Seguimientos vencidos**: oportunidades en P1, P3, P5, Reserva o 2da llamada con la fecha vencida o sin fecha. Se puede filtrar por closer.
- **Objeciones**: los motivos de no venta, de más a menos frecuente.
- **Calidad de datos**: lo que falta completar en GHL, agrupado por problema. Al tocar un problema se despliegan los nombres.

La pestaña Ads (solo dueños): inversión, costo por agenda y por calificada, y ventas por campaña, conjunto y anuncio. Cada venta queda asociada al anuncio del que vino el lead.

## 8. Definiciones

| Métrica | Cómo se calcula | Fecha que manda |
|---|---|---|
| Agendas | Personas que reservaron llamada, sin repetir | Fecha de reserva |
| Llamadas | Citas no canceladas | Fecha de la llamada |
| Show rate | Asistencias ÷ llamadas que ya pasaron | Fecha de la llamada |
| Asistencias | ¿Asistió? = Sí, o la oportunidad ya pasó a P1, P3, P5, Reserva, 2da llamada o Cerrado | Fecha de la llamada |
| Ofertas | Asistencias con ¿Se realizó la oferta? = Sí | Fecha de la llamada |
| Cierres | Oportunidades Won del pipeline de Venta | Fecha de cierre |
| Cierre nuevo / de seguimiento | La primera llamada fue en el mismo mes del cierre / en un mes anterior | Fecha de cierre |
| Vendido | Suma del valor de las oportunidades Won | Fecha de cierre |
| Cobrado | Suma de $Efectivo recolectado de esas ventas | Fecha de cierre |
| Cash pendiente | Vendido − cobrado | Fecha de cierre |
| Contactada | La oportunidad pasó por Agenda Contactada o Llamada Confirmada | Fecha de reserva |
| Tiempo hasta el contacto | Desde la reserva hasta que pasó a Agenda Contactada | Fecha de reserva |
| Comisión | 3% DFY y 5% JessiK sobre lo cobrado; Ale no comisiona | Fecha de cierre |
| Producto | Campo Oferta; si está vacío, la facturación que el lead respondió en el formulario | — |

Reglas:
- Una venta cuenta en el mes en que se cerró, aunque el lead haya agendado meses antes.
- El cobrado sale de $Efectivo recolectado hasta que se conecten Whop y Stripe.

## 9. Rutina

| Cuándo | Quién | Qué |
|---|---|---|
| Todos los días, 9 h y durante el día | Laura | Contactar las agendas nuevas, moverlas a Agenda Contactada y después confirmar |
| Todos los días, 9 h | Closers | Abrir "Mi día" y contactar los seguimientos vencidos |
| Después de cada llamada | Closer de la llamada | Mover la etapa y completar los campos |
| Cada cobro | Finanzas | Actualizar cuotas, efectivo, saldo y próximo cobro |
| Todos los días, 19 h | Agustín | Revisar Calidad de datos y la lista de agendas sin contactar |
| Todos los días, 20 h | Automático | Reporte diario al grupo de WhatsApp |
| Lunes | Ale y Agustín | Comercial (mes contra mes pasado), Setter y Ads |
| Lunes | Finanzas | Comisiones de la semana anterior |

## 10. Problemas frecuentes

| Pasa esto | Por qué | Qué hacer |
|---|---|---|
| Una venta no aparece | No está en Won, o le falta valor o Fecha de cierre | Completarla en GHL: aparece en 20 minutos o con Actualizar |
| "Cerrado - Contrato" parece vacía en GHL | La vista "Open opportunities" esconde las Won | Filtro de estado en All, o vista de lista |
| La venta aparece en otro mes | La Fecha de cierre está mal | Corregirla en GHL |
| Una agenda sigue en "sin contactar" aunque Laura ya habló | No se movió a Agenda Contactada | Moverla: se actualiza en 20 minutos |
| Todo sale como "Sin setter" | El campo Setter está vacío | Completar Setter al contactar |
| Cuenta como "Sin definir" | Falta el campo Oferta | Completar DFY $30k o JessiK $10k |
| Una llamada no aparece en mi fila | El campo Closer está vacío | Completar Closer |
| El cobrado no coincide con Whop o Stripe | $Efectivo recolectado no se actualizó | Finanzas lo actualiza con el total acumulado |
| El dashboard no carga | La sesión venció | Salir y volver a entrar; si sigue, avisar a Agustín |
