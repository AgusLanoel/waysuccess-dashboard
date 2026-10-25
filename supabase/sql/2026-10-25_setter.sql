-- Etapa "Agenda Contactada" (2026-10-25): entre Agenda y Llamada Confirmada del pipeline de Venta.
-- Mide el trabajo de la setter: agendas sin contactar, tiempo hasta el contacto, % contactadas antes de la llamada
-- y asistencia de contactadas vs no contactadas. Contactada = la oportunidad pasó por "Agenda Contactada" o "Llamada Confirmada"
-- (hora exacta de GHL, guardada en ghl_opportunity_events). Solo agendas del GHL nuevo (desde el corte), sin histórico.

create or replace view public.v_setter_agendas with (security_invoker = true) as
select o.id, o.contact_id, coalesce(o.name, c.email_norm) nombre, c.phone_norm telefono,
       o.created_at agendada, s.producto, s.etapa, s.status, s.asistio, s.closer,
       coalesce(o.cf ->> 'XD595uUhP5aHlrwXpjPk', 'Sin setter') setter,
       (select min(a.start_time) from ghl_appointments a
         where a.contact_id = o.contact_id and a.calendar_id = '7SNm0NGnthgEIWCbOf05' and not a.deleted
           and a.status not in ('cancelled', 'invalid') and a.start_time >= o.created_at - interval '1 hour') llamada,
       (select min(e.at) from ghl_opportunity_events e
         where e.opp_id = o.id and e.kind in ('stage', 'created') and e.to_val in ('Agenda Contactada', 'Llamada Confirmada')) contactada
from ghl_opportunities o
join com_opps_snap s on s.id = o.id
left join ghl_contacts c on c.id = o.contact_id
where o.pipeline_id = 'kW8pBFCaVVZJ1pw9okvh' and not s.historico and o.created_at >= comercial_corte();

create or replace function public.setter(p_from date, p_to date)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
with ag as (
  select v.*, (v.agendada at time zone 'America/Argentina/Buenos_Aires')::date dia,
         extract(epoch from v.contactada - v.agendada) / 60 minutos,
         v.status = 'open' and v.etapa in ('Triaje', 'Agenda') and v.contactada is null pendiente
  from v_setter_agendas v
  where v.llamada is not null  -- sin cita válida = no califica (cita cancelada/invalid): no se contacta
),
per as (select * from ag where dia between p_from and p_to),
resumen as (
  select coalesce(setter, 'Total') setter,
    count(*) agendas,
    count(*) filter (where contactada is not null) contactadas,
    count(*) filter (where contactada is not null and (llamada is null or contactada <= llamada)) contactadas_antes,
    count(*) filter (where pendiente) pendientes,
    count(*) filter (where contactada is null and not pendiente) sin_registro,
    round(percentile_cont(0.5) within group (order by minutos) filter (where minutos >= 0)) mediana_min,
    round(percentile_cont(0.9) within group (order by minutos) filter (where minutos >= 0)) p90_min,
    count(*) filter (where llamada < now() and contactada is not null) pasadas_contactadas,
    count(*) filter (where llamada < now() and contactada is not null and asistio) asist_contactadas,
    count(*) filter (where llamada < now() and contactada is null) pasadas_no_contactadas,
    count(*) filter (where llamada < now() and contactada is null and asistio) asist_no_contactadas
  from per group by grouping sets ((), (setter))
)
select jsonb_build_object(
  'resumen', (select coalesce(jsonb_agg(to_jsonb(r) order by r.setter = 'Total' desc, r.agendas desc), '[]') from resumen r),
  -- Ahora mismo, sin importar el período: agendas abiertas que nadie contactó todavía
  'pendientes', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'contact_id', a.contact_id, 'nombre', a.nombre, 'telefono', a.telefono, 'producto', a.producto,
      'etapa', a.etapa, 'setter', a.setter, 'agendada', a.agendada, 'llamada', a.llamada,
      'horas_esperando', round(extract(epoch from now() - a.agendada) / 3600, 1),
      'llamada_pasada', a.llamada < now()) order by a.llamada nulls last), '[]')
    from ag a where a.pendiente)
)
where is_member();
$function$;

grant execute on function public.setter(date, date) to authenticated;

-- Ajuste: el tiempo de contacto se mide desde que la oportunidad entró en "Agenda" (primer evento hacia Agenda; si no, la creación).
-- Ver migración setter_tiempo_desde_agenda: v_setter_agendas.agendada = coalesce(min(evento a 'Agenda'), created_at).

-- 25-10: la medición arranca el 26-10 (settings.setter_desde): antes Laura movía a Llamada Confirmada recién al confirmar.
-- setter() filtra agendas con entrada a Agenda >= setter_desde; comercial() devuelve 'setter' (fila Total + desde + sin_contactar_ahora)
-- para la tarjeta "Tiempo de contacto" de los números principales. Migraciones: setter_desde_26_10_y_kpi_comercial, comercial_setter_coalesce.
