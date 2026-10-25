-- Comercial fase 1c: histórico completo.
-- Corte 2026-10-21 (migración a GHL StartFly): antes = archivo congelado (hoja "Llamadas" en sheet_calls + citas del GHL viejo);
-- desde el corte = GHL StartFly en vivo. Las ventas salen siempre de StartFly (el histórico se importó ahí el 24-10).

insert into public.settings (key, value, note) values
  ('comercial_corte', '"2026-10-21"', 'Llamadas y agendas antes de esta fecha: archivo (hoja + GHL viejo). Desde esta fecha: GHL StartFly.')
on conflict (key) do nothing;

create or replace function public.comercial_corte() returns date
language sql stable as $$ select (value #>> '{}')::date from public.settings where key = 'comercial_corte' $$;

-- Closers del archivo con otro nombre
create or replace function public.closer_norm(n text) returns text
language sql immutable as $$
  select case lower(trim(n)) when 'alessandro' then 'Ale' when 'lucas' then 'Luca' else nullif(trim(n), '') end
$$;

insert into public.comercial_team (name, role, active) values
  ('Luigi', 'closer', false), ('Federico', 'closer', false), ('Agustín', 'owner', false)
on conflict (name) do nothing;

-- Agendas: citas creadas (GHL viejo antes del corte, StartFly desde el corte)
create or replace view public.v_com_agendas with (security_invoker = true) as
select a.contact_id,
       (a.date_added at time zone 'America/Argentina/Buenos_Aires')::date fecha_agenda,
       case when is_jessik(c.custom_fields) then 'JessiK' when is_qualified(c.custom_fields) then 'DFY' else 'Sin definir' end producto,
       a.calendar_id = '7SNm0NGnthgEIWCbOf05' en_vivo
from ghl_appointments a
left join ghl_contacts c on c.id = a.contact_id
where not a.deleted
  and ((a.calendar_id = '7SNm0NGnthgEIWCbOf05' and a.date_added >= comercial_corte())
    or (a.calendar_id in ('aLqJG1EY9LmXyuWh6lJE', 'l6nDyuqheYOmLWu813Ez') and a.date_added < comercial_corte()));

-- Llamadas del archivo (hoja) en el mismo formato que v_com_calls
create or replace view public.v_com_calls_archivo with (security_invoker = true) as
select
  'hoja-' || s.row_num id,
  s.contact_id,
  s.call_date fecha_llamada,
  case when s.estado_llamada in ('Canceló', 'Reagendó') then 'cancelled' else 'confirmed' end status,
  closer_norm(s.closer) closer,
  case when is_jessik(c.custom_fields) then 'JessiK' when is_qualified(c.custom_fields) then 'DFY' else 'Sin definir' end producto,
  s.estado_llamada = 'Asistió' asistio,
  s.estado_llamada = 'Asistió' and s.asistencia_calificada = 'Si' calificada_closer,
  coalesce(s.oferta_hecha, false) and s.estado_llamada = 'Asistió' oferta_hecha,
  s.lead_name nombre,
  s.resultado,
  s.objeciones,
  s.email_norm,
  s.phone_norm
from sheet_calls s
left join ghl_contacts c on c.id = s.contact_id
where s.call_date < comercial_corte();

-- Primera llamada de cada oportunidad: la del archivo (por email o teléfono) o la de StartFly
create or replace view public.v_com_opps with (security_invoker = true) as
with appt as (
  select a.contact_id,
         min(a.start_time) filter (where a.status not in ('cancelled', 'invalid')) primera_llamada,
         (array_agg(a.assigned_user_id order by a.start_time desc))[1] ultimo_closer_id,
         bool_or(a.status = 'showed') showed
  from ghl_appointments a
  where a.calendar_id = '7SNm0NGnthgEIWCbOf05' and not a.deleted
  group by 1
)
select
  o.id,
  o.contact_id,
  coalesce(o.name, c.email_norm) nombre,
  c.email_norm email,
  c.phone_norm telefono,
  o.stage_name etapa,
  o.status,
  coalesce(o.monetary_value, 0) valor,
  case
    when o.cf ->> '50leQ4Rh4kKu08aQOcRQ' ilike 'DFY%' then 'DFY'
    when o.cf ->> '50leQ4Rh4kKu08aQOcRQ' ilike 'JessiK%' then 'JessiK'
    when is_jessik(c.custom_fields) then 'JessiK'
    when is_qualified(c.custom_fields) then 'DFY'
    else 'Sin definir'
  end producto,
  coalesce(tc.name, ta.name, tl.name) closer,
  o.cf ->> 'XD595uUhP5aHlrwXpjPk' setter,
  o.cf ->> 'iBsP8fpGIsG4LOu8uIuv' calificacion,
  o.cf ->> 'H3JJfIUflRDFxE0vnllM' = 'Si' oferta_hecha,
  coalesce(o.cf ->> 'Vp3rYUo47OzLrgxol7yP' = 'Si', false)
    or coalesce(appt.showed, false)
    or o.status = 'won'
    or o.stage_name in ('P1 - No tiene interés en este momento', 'P3 - Interés pero no puede ahora', 'P5 - Compra este mes', 'Reserva', 'Cerrado - Contrato', '2da Llamada Agenda') asistio,
  least(
    (appt.primera_llamada at time zone 'America/Argentina/Buenos_Aires')::date,
    (select min(h.fecha_llamada) from v_com_calls_archivo h
      where h.status <> 'cancelled' and ((c.email_norm is not null and h.email_norm = c.email_norm) or (c.phone_norm is not null and h.phone_norm = c.phone_norm)))
  ) primera_llamada,
  case when o.status = 'won' then coalesce((o.cf ->> 'UmC8dTOZuUAU5xkYxNLN')::date, (o.last_status_change_at at time zone 'America/Argentina/Buenos_Aires')::date) end fecha_cierre,
  (o.cf ->> 'UmC8dTOZuUAU5xkYxNLN') is not null fecha_cierre_cargada,
  coalesce((o.cf ->> 'cQtlWKYlLm99Xe2r6mHQ')::numeric, 0) cobrado,
  coalesce(o.cf ->> 'Tps3Qa5SUKABPs5Nks3f', o.cf ->> 'Jd2qCnJz54LxGP5HPlCS', o.cf ->> 'I1YDC7yUCv8z7eTWJQIl') motivo,
  (o.cf ->> 'cZQznvJEZOmObwid7Lgs')::date proximo_seguimiento,
  o.cf ->> 'vbhiRxCKHaeUT9TUNzqC' plan_pago,
  o.cf ->> 'rhKzKMydHOcBUCjRrW3y' metodo_cobro,
  (o.cf ->> 'n92CtwQu5OqNYk7hwvbs')::numeric saldo_pendiente,
  (o.cf ->> 'b21wY5kT3kByWdbZpXJZ')::date proximo_cobro_fecha,
  (o.cf ->> 'T7WlzpunagSGPlFSklRz')::numeric proximo_cobro_monto,
  o.cf ->> '2lrp6WvUZk1HcWPVLLCa' link_grabacion,
  'historico-importado' = any (coalesce(c.tags, '{}')) historico,
  coalesce(ca.is_paid and not ca.other_account, false) de_ads,
  o.created_at,
  o.last_stage_change_at
from ghl_opportunities o
left join ghl_contacts c on c.id = o.contact_id
left join appt on appt.contact_id = o.contact_id
left join comercial_team tc on tc.closer_option = o.cf ->> 'eDFc3YKm41aXOXf7UR8m'
left join comercial_team ta on ta.ghl_user_id = o.assigned_to
left join comercial_team tl on tl.ghl_user_id = appt.ultimo_closer_id
left join v_contact_attribution ca on ca.contact_id = o.contact_id
where o.pipeline_id = 'kW8pBFCaVVZJ1pw9okvh';

-- Llamadas: archivo antes del corte + StartFly desde el corte
create or replace view public.v_com_calls_todas with (security_invoker = true) as
select id, contact_id, fecha_llamada, status, closer, producto, asistio, calificada_closer, oferta_hecha, false en_vivo
from v_com_calls_archivo
union all
select id, contact_id, fecha_llamada, status, closer, producto, asistio, calificada_closer, oferta_hecha, true
from v_com_calls where fecha_llamada >= comercial_corte();

-- Reporte sobre las fuentes unificadas
create or replace function public.comercial(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = public as $$
with
prev as (select p_from - (p_to - p_from + 1) f, p_from - 1 t),
calls as (select * from v_com_calls_todas),
agendas as (select * from v_com_agendas),
opps as (select * from v_com_opps),
team as (select * from comercial_team),
prods as (select unnest(array['Total', 'DFY', 'JessiK', 'Sin definir']) producto),
funnel as (
  select p.producto, r.f, r.t, r.periodo,
    (select count(distinct a.contact_id) from agendas a where a.fecha_agenda between r.f and r.t and (p.producto = 'Total' or a.producto = p.producto)) agendas,
    (select count(*) from calls c where c.fecha_llamada between r.f and r.t and c.status not in ('cancelled', 'invalid') and (p.producto = 'Total' or c.producto = p.producto)) llamadas,
    (select count(*) from calls c where c.fecha_llamada between r.f and r.t and c.status in ('cancelled', 'invalid') and (p.producto = 'Total' or c.producto = p.producto)) canceladas,
    (select count(*) from calls c where c.fecha_llamada between r.f and r.t and c.asistio and (p.producto = 'Total' or c.producto = p.producto)) asistencias,
    (select count(*) from calls c where c.fecha_llamada between r.f and r.t and c.asistio and c.calificada_closer and (p.producto = 'Total' or c.producto = p.producto)) asistencias_calificadas,
    (select count(*) from calls c where c.fecha_llamada between r.f and r.t and c.asistio and c.oferta_hecha and (p.producto = 'Total' or c.producto = p.producto)) ofertas,
    (select count(*) from opps o where o.fecha_cierre between r.f and r.t and (p.producto = 'Total' or o.producto = p.producto)) cierres,
    (select count(*) from opps o where o.fecha_cierre between r.f and r.t and date_trunc('month', o.primera_llamada) = date_trunc('month', o.fecha_cierre) and (p.producto = 'Total' or o.producto = p.producto)) cierres_nuevos,
    (select count(*) from opps o where o.fecha_cierre between r.f and r.t and o.primera_llamada < date_trunc('month', o.fecha_cierre) and (p.producto = 'Total' or o.producto = p.producto)) cierres_seguimiento,
    (select coalesce(sum(o.valor), 0) from opps o where o.fecha_cierre between r.f and r.t and (p.producto = 'Total' or o.producto = p.producto)) vendido,
    (select coalesce(sum(o.cobrado), 0) from opps o where o.fecha_cierre between r.f and r.t and (p.producto = 'Total' or o.producto = p.producto)) cobrado,
    (select coalesce(sum(o.valor), 0) from opps o where o.fecha_cierre between r.f and r.t and o.de_ads and (p.producto = 'Total' or o.producto = p.producto)) vendido_ads
  from prods p
  cross join (select p_from f, p_to t, 'actual' periodo union all select f, t, 'anterior' from prev) r
),
closers as (
  select t.name closer, t.active,
    count(*) filter (where c.fecha_llamada between p_from and p_to and c.status not in ('cancelled', 'invalid')) llamadas,
    count(*) filter (where c.fecha_llamada between p_from and p_to and c.asistio) asistencias,
    count(*) filter (where c.fecha_llamada between p_from and p_to and c.asistio and c.oferta_hecha) ofertas,
    (select count(*) from opps o where o.closer = t.name and o.fecha_cierre between p_from and p_to) cierres,
    (select coalesce(sum(o.valor), 0) from opps o where o.closer = t.name and o.fecha_cierre between p_from and p_to) vendido,
    (select coalesce(sum(o.cobrado), 0) from opps o where o.closer = t.name and o.fecha_cierre between p_from and p_to) cobrado,
    (select coalesce(sum(o.cobrado * case o.producto when 'JessiK' then t.comm_jessik else t.comm_dfy end), 0)
       from opps o where o.closer = t.name and o.fecha_cierre between p_from and p_to) comision,
    (select count(*) from opps o where o.closer = t.name and o.status = 'open'
       and o.etapa in ('P1 - No tiene interés en este momento', 'P3 - Interés pero no puede ahora', 'P5 - Compra este mes', 'Reserva', '2da Llamada Agenda')) en_seguimiento
  from team t left join calls c on c.closer = t.name
  where t.role in ('closer', 'owner')
  group by t.name, t.active, t.comm_dfy, t.comm_jessik
),
closers_vis as (
  select * from closers where active or llamadas > 0 or cierres > 0
),
objeciones as (
  select motivo, producto, count(*) n from (
    select o.motivo, o.producto
    from opps o
    where o.motivo is not null and o.status <> 'won' and not o.historico
      and (o.primera_llamada between p_from and p_to or (o.last_stage_change_at at time zone 'America/Argentina/Buenos_Aires')::date between p_from and p_to)
    union all
    select trim(m), h.producto
    from v_com_calls_archivo h, unnest(h.objeciones) m
    where h.fecha_llamada between p_from and p_to and coalesce(h.resultado, '') <> 'Vendido' and trim(m) <> ''
  ) x group by 1, 2
),
seguimientos as (
  select o.id, o.nombre, o.closer, o.producto, o.etapa, o.motivo, o.proximo_seguimiento, o.primera_llamada, o.historico,
         (current_date - (o.last_stage_change_at at time zone 'America/Argentina/Buenos_Aires')::date) dias_en_etapa
  from opps o
  where o.status = 'open'
    and o.etapa in ('P1 - No tiene interés en este momento', 'P3 - Interés pero no puede ahora', 'P5 - Compra este mes', 'Reserva', '2da Llamada Agenda')
    and (o.proximo_seguimiento is null or o.proximo_seguimiento <= current_date)
),
calidad as (
  select o.id, o.nombre, o.closer, o.etapa, o.historico, x.problema
  from opps o
  cross join lateral (values
    (case when o.status = 'won' and o.valor <= 0 then 'Ganada sin monto' end),
    (case when o.status = 'won' and not o.fecha_cierre_cargada then 'Ganada sin fecha de cierre' end),
    (case when o.status = 'won' and o.producto = 'Sin definir' then 'Ganada sin oferta' end),
    (case when o.status = 'won' and o.cobrado <= 0 then 'Ganada sin efectivo cobrado' end),
    (case when o.status <> 'open' or o.historico then null
          when o.etapa in ('Triaje', 'Agenda', 'Llamada Confirmada') and o.primera_llamada < current_date then 'Llamada pasada y la etapa no se movió' end),
    (case when o.status = 'open' and o.etapa like 'P_ - %' and o.motivo is null then 'En seguimiento sin motivo' end),
    (case when o.status = 'open' and o.etapa like 'P_ - %' and o.proximo_seguimiento is null then 'En seguimiento sin fecha de próximo seguimiento' end),
    (case when o.status = 'lost' and o.motivo is null then 'Perdida sin motivo' end),
    (case when o.closer is null and o.primera_llamada <= current_date then 'Sin closer' end)
  ) x(problema)
  where x.problema is not null
),
cierres_lista as (
  select o.fecha_cierre, o.nombre, o.closer, o.producto, o.valor, o.cobrado, o.plan_pago, o.metodo_cobro, o.saldo_pendiente,
         o.primera_llamada, o.fecha_cierre - o.primera_llamada dias_a_cierre, o.de_ads, o.historico
  from opps o where o.fecha_cierre between p_from and p_to
)
select jsonb_build_object(
  'corte', comercial_corte(),
  'funnel', (select jsonb_agg(to_jsonb(fu) - 'f' - 't') from funnel fu),
  'closers', (select jsonb_agg(to_jsonb(c) order by c.vendido desc, c.llamadas desc) from closers_vis c),
  'objeciones', (select coalesce(jsonb_agg(to_jsonb(x) order by x.n desc), '[]') from objeciones x),
  'seguimientos', (select coalesce(jsonb_agg(to_jsonb(s) order by s.proximo_seguimiento nulls first, s.dias_en_etapa desc), '[]') from seguimientos s),
  'calidad', (select coalesce(jsonb_agg(to_jsonb(q) order by q.problema, q.closer), '[]') from calidad q),
  'cierres', (select coalesce(jsonb_agg(to_jsonb(k) order by k.fecha_cierre desc), '[]') from cierres_lista k)
)
where is_member();
$$;
