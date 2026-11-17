# Paquete operativo WaySuccess — para montar en el Project Tracker de Rod

17-11-2026. Acuerdo Agustín × Rod:
- **Dashboard ejecutivo** (waysuccess-dashboard.vercel.app): Resumen · Equipo · Ads. Lo ven solo los owners (Agustín, Ale, Rod). Se revisa los lunes.
- **Lo operativo** (Seguimientos, Metas, Cobranza y la vista de cada closer) pasa al Project Tracker de Rod. Lo administran Laura y Luca. Este paquete trae todo lo necesario para montarlo.

> Instrucción para el Claude de Rod: leé este archivo completo y después `codigo/`. Los datos ya existen en Supabase; no hace falta conectar GHL de nuevo.

---

## 1. De dónde salen los datos

```
GoHighLevel (CRM) ──sync cada 20 min──► Supabase (proyecto iqiyhlcqnxwtdhmmrlsp)
Google Sheet "Tracker" ──cada 15 min──►    │  tablas: com_opps_snap, com_agendas_snap, ghl_appointments,
Meta Ads ──cada 2 h──►                     │          ghl_contacts, tracker_filas
                                            ▼
                           rpc public.dash_datos()  →  un JSON con todo (desde 01-10-2026)
```

- **`dash_datos()`** es la única llamada que hace falta. Devuelve `llamadas`, `opps`, `agendas`, `tracker`, `cobros`, `cierres`, `equipo` y `rol` / `closer_fijo`.
- **Permisos dentro de la base:** owner y finanzas ven todo; un closer recibe solo sus filas, porque la función filtra por `my_closer()`. No hay que filtrar en la app.
- **Acceso:** cada persona entra con su usuario de Supabase Auth. Roles en `dashboard_members` (`owner | closer | setter | finanzas`).
  - Luca y Jenny = `closer`.
  - Laura = `finanzas`.
  - Para un usuario nuevo, pedírselo a Agustín.
- **Claves:** se usa solo la *publishable/anon key* del proyecto, más la sesión del usuario. Nunca la service role en el front. Agustín la pasa por privado; no viaja en este paquete.

## 2. Definiciones (idénticas al dashboard ejecutivo, para que los números coincidan)

| Métrica | Regla |
|---|---|
| Agendas | Primera agenda de cada lead en el período (sin reagendas). |
| Asistencias | Leads cuya **primera** asistencia cae en el período. Un lead cuenta una vez. |
| % Asistencia | asistencias ÷ agendas |
| Ofertas | Leads cuya primera oferta (¿Se realizó la oferta? = Sí) cae en el período. |
| Cierres | Oportunidades **Won** en GHL con fecha de cierre en el período. Las que se cierran en un mes posterior al de la primera llamada son "cierres en seguimiento". |
| Vendido | Suma del valor de las oportunidades ganadas. |
| Cobrado | Cobrado de esas ganadas. Si cobrado > valor se descarta (dato inválido). |
| Cobrado en seguimiento | Hoja "Cobros" del Tracker. |
| Comisión | 3% de lo cobrado (DFY y JessiK); no incluye lo cobrado en seguimiento. |
| Meta de cierres | Meta mensual del Tracker, prorrateada a los días del período. |
| Seguimientos | Oportunidades abiertas en P5, P3, P1, 2da Llamada Agenda o Reserva. Orden: vencidas o sin fecha primero, después P5 → P3 → P1. |
| Por cobrar | Valor − cobrado de cada cliente ganado. |

Excepciones conocidas:
- Las oportunidades sin email **ni** teléfono no cuentan (9 duplicadas creadas el 15-11).
- No hay datos anteriores al 01-10-2026.

## 3. Qué tiene que tener el Project Tracker (lo que pidió Rod)

**Vista de cada closer ("así voy")**, filtrada sola a la persona que entra:
llamadas · asistencias · show rate · ofertas · cierres · vendido · cobrado · pendiente de cobro · comisión · cierres contra meta.
→ Es la fila de la tabla Closers (`codigo/Equipo.tsx` + `closers()` en `codigo/metricas.ts`).

**Operativo (Laura y Luca):**
- **Seguimientos:** lista con link al contacto de GHL, etapa, motivo, próximo seguimiento y días en etapa (`codigo/Seguimientos.tsx`).
- **Cobranza:**
  - cobrado por semana;
  - por cobrar por cliente;
  - pagos en seguimiento;
  - cierres por mes (`codigo/Cobranza.tsx`).
- **Metas:** real contra meta de agendas, asistencias, % asistencia y % cierre (`codigo/Metas.tsx`).

**Feedback de llamadas (más adelante):** cada llamada va a tener un informe de evaluación con la ficha de Rod. Va a llegar por email al closer y con un link en la oportunidad de GHL. Cuando exista, se agrega acá como sección "Feedback" con un acceso por closer.

## 4. Cómo montarlo

1. Copiar `codigo/metricas.ts` tal cual. Tiene todas las fórmulas y depende solo del JSON de `dash_datos()`.
2. Crear el cliente de Supabase con la URL del proyecto y la anon key, más login con email y contraseña.
3. `const { data } = await supabase.rpc("dash_datos")`. Filtrar `data.opps` a las que tienen email o teléfono.
4. Reusar los componentes de `codigo/` (React + Recharts) o rehacer la UI en la herramienta del tracker usando las mismas funciones (`bloque`, `closers`, `seguimientos`, `metas`).
5. **Validar:** para el mismo período y el mismo closer, los números tienen que coincidir con la pestaña Equipo del dashboard ejecutivo.

## 5. Archivos

- `codigo/metricas.ts`: fórmulas y tipos.
- `codigo/Equipo.tsx`: tabla de closers y setters.
- `codigo/Seguimientos.tsx`
- `codigo/Cobranza.tsx`
- `codigo/Metas.tsx`
- `codigo/ui.tsx`: componentes compartidos (Panel, Tabla, Kpi, Valor).
- `codigo/dash_datos.sql`: definición de la función en la base, solo como referencia (ya está desplegada).
