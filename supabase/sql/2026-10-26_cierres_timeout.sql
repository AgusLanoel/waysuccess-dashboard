-- 2026-10-26: la pestaña Ads mostraba "canceling statement due to statement timeout" y ROAS 0.00x.
-- Causa: cierres_core() unía v_contact_attribution entera (~4.5 s por match_ad() + dedupe) y el planner la re-evaluaba: ~16 s.
-- Arreglo (aplicado como migraciones attribution_for_ids / cierres_core_materialize_attribution):
--   * public.contact_attribution_for(p_ids text[]): misma lógica que v_contact_attribution, solo para los contactos pedidos.
--   * cierres_core() filtra primero las ventas Won y calcula la atribución solo de esos contactos.
-- Resultado: 16 s → 0.04 s; 0 diferencias vs la vista sobre todos los contactos de com_opps_snap.
-- Definiciones vigentes: select pg_get_functiondef('public.cierres_core'::regproc);

-- 2026-10-26 MRR/ARR: campo de oportunidad GHL "Pago mensual (MRR)" = LLVA4i49xYAqpk3JOdu0 (MONETORY).
-- public.mrr(p_from, p_to) jsonb {mrr, arr, clientes, mrr_nuevo, clientes_nuevos}; solo ve_todo() (owner/finanzas).
-- MRR = suma del campo en Won del pipeline kW8p con Fecha de cierre <= p_to; ARR = MRR*12. Migración mrr_resumen.
-- Clientes MRR (JessiK mes a mes): vendido 0, cobrado = lo cobrado acumulado.

-- 2026-10-26 ads_show_rate(p_from,p_to): asistencias / llamadas Ads DFY+JessiK no canceladas con inicio < now() (por fecha de llamada). Migración ads_show_rate.

-- 2026-10-26 refresh_comercial: asistencia por etapa cruzando persona (email/tel): P1/P3/P5/Reserva/2da/Cerrado/Won o No Califica movida después de la llamada -> última llamada pasada de la persona = asistió (desde 2026-10-01).
