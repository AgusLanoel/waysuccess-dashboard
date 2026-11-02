-- Control de cierre de día (dueño 02-11): qué quedó sin actualizar en el CRM a las 21 h ART.
-- control_cierre_core(ahora) = lista única de pendientes. De ahí salen:
--   control_cierre()      -> jsonb para la pestaña "Cierre de día" del dashboard (solo owner)
--   control_cierre_aviso() -> resumen corto que la edge function control-crm manda al teléfono
--   control_crm()         -> texto largo para pegar en el grupo del equipo (misma firma que el del 28-10)
-- Definición de cada regla: ver comentarios dentro de control_cierre_core.

create or replace function public.control_cierre_core(p_ahora timestamptz default now())
returns table (
  area text, responsable text, tipo text, nombre text, contact_id text, opp_id text,
  producto text, etapa text, detalle text, referencia timestamptz, es_de_hoy boolean
)
language sql stable security definer set search_path = public as $fn$
with p as (
  select comercial_corte() corte,
         (select (value #>> '{}')::date from settings where key = 'setter_desde') setter_desde,
         (p_ahora at time zone 'America/Argentina/Buenos_Aires')::date hoy
),
opps as materialized (
  select g.id, g.contact_id, coalesce(nullif(g.name, ''), '(sin nombre)') nombre, g.stage_name etapa, g.status,
         g.last_stage_change_at, g.created_at, g.cf, coalesce(g.monetary_value, 0) valor,
         coalesce(c.email_norm, '') em, coalesce(c.phone_norm, '') ph,
         s.producto, s.closer closer_opp, s.motivo, s.historico
  from ghl_opportunities g
  join com_opps_snap s on s.id = g.id
  left join ghl_contacts c on c.id = g.contact_id
  where g.pipeline_id = 'kW8pBFCaVVZJ1pw9okvh'
),
llamadas as materialized (
  select a.contact_id, a.start_time inicio, t.name closer, k.producto, coalesce(c.email_norm, '') em, coalesce(c.phone_norm, '') ph
  from ghl_appointments a
  left join comercial_team t on t.ghl_user_id = a.assigned_user_id
  left join com_calls_snap k on k.id = a.id
  left join ghl_contacts c on c.id = a.contact_id
  where a.calendar_id = '7SNm0NGnthgEIWCbOf05' and not a.deleted
    and a.status not in ('cancelled', 'invalid') and a.start_time >= (select corte from p)
),
x as materialized (
  select o.*, u.inicio ult, u.closer closer_call, f.prox,
         coalesce((select t.name from comercial_team t where t.name = u.closer and t.role = 'closer' and t.active),
                  o.closer_opp, u.closer, 'Sin closer') resp,
         -- Misma persona con otra oportunidad ya resuelta (hay contactos duplicados tras la migración)
         exists (select 1 from opps o2 where o2.id <> o.id
                   and ((o.em <> '' and o2.em = o.em) or (o.ph <> '' and o2.ph = o.ph))
                   and (o2.status = 'won' or o2.etapa not in ('Triaje', 'Agenda', 'Agenda Contactada', 'Llamada Confirmada'))) resuelta_en_otra
  from opps o
  left join lateral (
    select l.inicio, l.closer from llamadas l
    where l.inicio <= p_ahora - interval '1 hour'
      and (l.contact_id = o.contact_id or (o.em <> '' and l.em = o.em) or (o.ph <> '' and l.ph = o.ph))
    order by l.inicio desc limit 1) u on true
  left join lateral (
    select min(l.inicio) prox from llamadas l
    where l.inicio > p_ahora - interval '1 hour'
      and (l.contact_id = o.contact_id or (o.em <> '' and l.em = o.em) or (o.ph <> '' and l.ph = o.ph))) f on true
),
-- Campos que cada resultado exige (SOP: PEDIDO_CLOSERS.md). Solo llamadas desde el corte, no el histórico importado.
faltan as (
  select x.*, array_remove(array[
    case when x.ult is not null and x.status = 'open' and x.cf ->> 'Vp3rYUo47OzLrgxol7yP' is null then '¿Asistió?' end,
    case when x.ult is not null and x.cf ->> '50leQ4Rh4kKu08aQOcRQ' is null then 'Oferta' end,
    case when x.ult is not null and x.cf ->> 'iBsP8fpGIsG4LOu8uIuv' is null then 'Calificación closer' end,
    case when x.ult is not null and x.cf ->> 'H3JJfIUflRDFxE0vnllM' is null then '¿Se realizó la oferta?' end,
    case when x.etapa like 'P1 -%' and x.cf ->> 'I1YDC7yUCv8z7eTWJQIl' is null then 'Razón de seguimiento' end,
    case when x.etapa like 'P3 -%' and x.cf ->> 'Jd2qCnJz54LxGP5HPlCS' is null then 'Motivo de no venta' end,
    case when x.status = 'open' and x.etapa like 'P_ -%' and x.cf ->> 'cZQznvJEZOmObwid7Lgs' is null then 'Fecha próximo seguimiento' end,
    case when x.status = 'won' and x.valor <= 0 and x.cf ->> 'LLVA4i49xYAqpk3JOdu0' is null then 'Valor' end,
    case when x.status = 'won' and x.cf ->> 'UmC8dTOZuUAU5xkYxNLN' is null then 'Fecha de cierre' end,
    case when x.status = 'won' and x.cf ->> 'cQtlWKYlLm99Xe2r6mHQ' is null then '$Efectivo recolectado' end,
    case when x.status = 'won' and x.cf ->> 'vbhiRxCKHaeUT9TUNzqC' is null then 'Plan de pago' end,
    case when x.status = 'won' and x.cf ->> 'rhKzKMydHOcBUCjRrW3y' is null then 'Método de cobro' end
  ], null) campos
  from x, p
  where (x.status = 'won' or (x.status = 'open' and x.etapa in (
          'P1 - No tiene interés en este momento', 'P3 - Interés pero no puede ahora', 'P5 - Compra este mes', 'Reserva', '2da Llamada Agenda')))
    and (x.ult is not null or (not x.historico and x.created_at >= p.corte))
),
filas as (
  -- CLOSER: la llamada ya terminó y la oportunidad sigue en una etapa previa, sin otra cita por delante.
  select 'closer' area, x.resp responsable, 'sin_resultado' tipo, x.nombre, x.contact_id, x.id opp_id, x.producto, x.etapa,
         'Sigue en "' || x.etapa || '": falta definir si asistió, No Show, cierre o seguimiento' detalle, x.ult referencia
  from x
  where x.status = 'open' and x.ult is not null and x.prox is null and not x.resuelta_en_otra
    and (x.etapa in ('Triaje', 'Agenda', 'Agenda Contactada', 'Llamada Confirmada')
         or (x.etapa = '2da Llamada Agenda' and x.ult > coalesce(x.last_stage_change_at, '2000-01-01')))

  union all
  -- CLOSER: tuvo resultado pero le faltan las etiquetas.
  select 'closer', coalesce(f.closer_opp, f.resp), 'faltan_datos', f.nombre, f.contact_id, f.id, f.producto, f.etapa,
         'Falta: ' || array_to_string(f.campos, ', '), coalesce(f.ult, f.created_at)
  from faltan f
  where cardinality(f.campos) > 0

  union all
  -- CLOSER: marcada perdida sin decir por qué.
  select 'closer', coalesce(x.closer_opp, x.resp), 'perdida_sin_motivo', x.nombre, x.contact_id, x.id, x.producto, x.etapa,
         'Perdida sin Motivo de pérdida', coalesce(x.last_stage_change_at, x.ult, x.created_at)
  from x, p
  where x.status = 'lost' and x.motivo is null and (x.ult is not null or (not x.historico and x.created_at >= p.corte))

  union all
  -- CLOSER: la llamada pasó y la persona no tiene oportunidad en el pipeline: no hay dónde registrar el resultado.
  select 'closer', coalesce(l.closer, 'Sin closer'), 'sin_oportunidad', coalesce(nullif(c.full_name, ''), l.em, '(sin nombre)'), l.contact_id, null, l.producto, null,
         'Tuvo llamada pero no tiene oportunidad en el pipeline', l.inicio
  from llamadas l
  left join ghl_contacts c on c.id = l.contact_id
  where l.inicio <= p_ahora - interval '1 hour'
    and not exists (select 1 from opps o where o.contact_id = l.contact_id or (l.em <> '' and o.em = l.em) or (l.ph <> '' and o.ph = l.ph))

  union all
  -- SETTER: agenda calificada que sigue sin contactar (entró hace más de 1 h).
  select 'setter', 'Laura', 'sin_contactar', coalesce(nullif(v.nombre, ''), '(sin nombre)'), v.contact_id, v.id, v.producto, v.etapa,
         'Sin contactar. Llamada: ' || to_char(v.llamada at time zone 'America/Argentina/Buenos_Aires', 'DD-MM HH24:MI'), v.agendada
  from v_setter_agendas v, p
  where v.contactada is null and v.llamada is not null and v.producto in ('DFY', 'JessiK')
    and v.etapa in ('Agenda', 'Triaje') and v.status = 'open'
    and v.agendada >= p.setter_desde and v.agendada < p_ahora - interval '1 hour'

  union all
  -- SETTER: contactada pero sin confirmar y la llamada es hoy o mañana.
  select 'setter', 'Laura', 'sin_confirmar', x.nombre, x.contact_id, x.id, x.producto, x.etapa,
         'Contactada sin confirmar. Llamada: ' || to_char(x.prox at time zone 'America/Argentina/Buenos_Aires', 'DD-MM HH24:MI'), coalesce(x.last_stage_change_at, x.created_at)
  from x, p
  where x.status = 'open' and x.etapa = 'Agenda Contactada' and x.producto in ('DFY', 'JessiK')
    and (x.prox at time zone 'America/Argentina/Buenos_Aires')::date <= p.hoy + 1
)
-- Duplicados de persona: una fila por responsable + regla + nombre.
select distinct on (f.responsable, f.tipo, lower(f.nombre))
       f.area, f.responsable, f.tipo, f.nombre, f.contact_id, f.opp_id, f.producto, f.etapa, f.detalle, f.referencia,
       (f.referencia at time zone 'America/Argentina/Buenos_Aires')::date = (select hoy from p)
from filas f
order by f.responsable, f.tipo, lower(f.nombre), f.referencia desc;
$fn$;

-- Aviso corto para el teléfono.
create or replace function public.control_cierre_aviso(p_ahora timestamptz default now(), p_url text default 'https://waysuccess-dashboard.vercel.app/?tab=cierre')
returns text language plpgsql security definer set search_path = public as $fn$
declare
  total int; de_hoy int; cuerpo text; ult_sync timestamptz; msg text;
begin
  create temp table if not exists _ci on commit drop as select * from control_cierre_core(p_ahora) limit 0;
  truncate _ci;
  insert into _ci select * from control_cierre_core(p_ahora);
  select count(*), count(*) filter (where es_de_hoy) into total, de_hoy from _ci;
  select max(finished_at) into ult_sync from sync_runs where source = 'ghl' and ok;

  msg := '🔔 Cierre de día ' || to_char(p_ahora at time zone 'America/Argentina/Buenos_Aires', 'DD-MM') || E'\n';
  if total = 0 then
    msg := msg || '✅ CRM al día: no falta actualizar nada.';
  else
    select string_agg(l, E'\n' order by orden, responsable) into cuerpo from (
      select responsable, min(case area when 'setter' then 0 else 1 end) orden,
             '• ' || responsable || ': ' || string_agg(n || ' ' || t, ', ' order by o) l
      from (
        select responsable, area, count(*) n,
          case tipo when 'sin_resultado' then 'llamadas sin resultado' when 'faltan_datos' then 'con etiquetas incompletas'
                    when 'perdida_sin_motivo' then 'perdidas sin motivo' when 'sin_oportunidad' then 'sin oportunidad'
                    when 'sin_contactar' then 'sin contactar' when 'sin_confirmar' then 'sin confirmar' end t,
          case tipo when 'sin_contactar' then 1 when 'sin_confirmar' then 2 when 'sin_resultado' then 3 when 'faltan_datos' then 4 when 'perdida_sin_motivo' then 5 else 6 end o
        from _ci group by responsable, area, tipo
      ) a group by responsable
    ) b;
    msg := msg || '⚠️ No se terminó de actualizar el CRM: ' || total || ' pendientes (' || de_hoy || ' de hoy, ' || (total - de_hoy) || E' arrastrados)\n\n'
               || cuerpo || E'\n\nVer detalle: ' || p_url;
  end if;
  if ult_sync is null or ult_sync < p_ahora - interval '45 minutes' then
    msg := msg || E'\n\n⚠️ Ojo: la última sincronización con GHL es de las ' || coalesce(to_char(ult_sync at time zone 'America/Argentina/Buenos_Aires', 'DD-MM HH24:MI'), '¿?') || ', los datos pueden estar atrasados.';
  end if;
  return msg;
end $fn$;

-- Texto largo para pegar en el grupo del equipo. Reemplaza la versión del 28-10 (solo cubría etapa y contacto).
create or replace function public.control_crm(p_ahora timestamptz default now())
returns text language plpgsql security definer set search_path = public as $fn$
declare
  tz constant text := 'America/Argentina/Buenos_Aires';
  msg text; r record; bloque text;
begin
  msg := '*Control CRM StartFly — ' || to_char(p_ahora at time zone tz, 'DD-MM HH24:MI') || '*' || E'\n';
  create temp table if not exists _cc2 on commit drop as select * from control_cierre_core(p_ahora) limit 0;
  truncate _cc2;
  insert into _cc2 select * from control_cierre_core(p_ahora);
  if not exists (select 1 from _cc2) then
    return msg || E'\n✅ ¡CRM al día! Todas las llamadas tienen resultado y etiquetas, y todas las agendas fueron contactadas. ¡Excelente trabajo, equipo! 👏';
  end if;
  for r in select t.name from comercial_team t where t.active and t.role in ('closer', 'setter')
             and not exists (select 1 from _cc2 where _cc2.responsable = t.name) order by 1 loop
    msg := msg || E'\n✅ *' || r.name || E'*: todo al día. ¡Bien ahí!\n';
  end loop;
  for r in select responsable, min(case area when 'setter' then 0 else 1 end) o, count(*) n from _cc2 group by responsable order by 2, 1 loop
    select string_agg('• ' || nombre || coalesce(' (' || producto || ')', '') || ' — ' || detalle ||
             case when not es_de_hoy then ' ⚠️ ' || to_char(referencia at time zone tz, 'DD-MM') else '' end,
             E'\n' order by referencia) into bloque from _cc2 where responsable = r.responsable;
    msg := msg || E'\n❌ *' || r.responsable || '* — ' || r.n || E' pendiente(s):\n' || bloque || E'\n';
  end loop;
  return msg;
end $fn$;

-- Para la pestaña del dashboard (solo owner).
create or replace function public.control_cierre()
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if not is_owner() then return null; end if;
  return jsonb_build_object(
    'generado', now(),
    'ultima_sync', (select max(finished_at) from sync_runs where source = 'ghl' and ok),
    'items', (select coalesce(jsonb_agg(to_jsonb(c) order by c.responsable, c.tipo, c.referencia), '[]') from control_cierre_core(now()) c),
    'texto_equipo', control_crm(now())
  );
end $fn$;

revoke all on function public.control_cierre_core(timestamptz) from public, anon, authenticated;
revoke all on function public.control_cierre_aviso(timestamptz, text) from public, anon, authenticated;
revoke all on function public.control_crm(timestamptz) from public, anon, authenticated;
revoke all on function public.control_cierre() from public, anon;
grant execute on function public.control_cierre() to authenticated;

-- Horarios en UTC (21:00 ART = 00:00 UTC): datos frescos a las 20:55 y aviso a las 21:00.
-- select cron.schedule('control-crm-sync', '55 23 * * *', $$select private.call_fn('sync-ghl', '{"days_back":14}'::jsonb)$$);
-- select cron.schedule('control-crm-refresh', '58 23 * * *', $$select public.refresh_comercial()$$);
-- select cron.schedule('control-crm-aviso', '0 0 * * *', $$select private.call_fn('control-crm', '{"action":"enviar"}'::jsonb)$$);
