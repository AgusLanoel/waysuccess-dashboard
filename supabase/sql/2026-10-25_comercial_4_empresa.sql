-- Comercial 4: fuente por lead (Ads / Orgánico / Referidos / Afiliados), vista Empresa como la del sheet,
-- y cierres del histórico sin Fecha de cierre fuera de los períodos (antes caían en la fecha de importación).

-- Fuente de un contacto de StartFly: campo "Fuente" (xgR4…) primero; si no, anuncio pagado = Ads; si no, Orgánico
create or replace function public.fuente_contacto(cf jsonb, paid boolean) returns text
language sql immutable as $$
  select case
    when coalesce(cf ->> 'xgR4Z0639YEO5pblrBQL', '') ilike '%Referidos%' then 'Referidos'
    when coalesce(cf ->> 'xgR4Z0639YEO5pblrBQL', '') ilike '%Afiliados%' then 'Afiliados'
    when coalesce(paid, false) then 'Ads'
    else 'Orgánico'
  end
$$;

-- Fuente del archivo (columna "Origen" de la hoja)
create or replace function public.fuente_hoja(origen text) returns text
language sql immutable as $$
  select case when origen ilike 'Org%' then 'Orgánico' when origen in ('Ads', 'Referidos', 'Afiliados') then origen else 'Sin dato' end
$$;

create or replace view public.v_com_agendas with (security_invoker = true) as
select a.contact_id,
       (a.date_added at time zone 'America/Argentina/Buenos_Aires')::date fecha_agenda,
       case when is_jessik(c.custom_fields) then 'JessiK' when is_qualified(c.custom_fields) then 'DFY' else 'Sin definir' end producto,
       a.calendar_id = '7SNm0NGnthgEIWCbOf05' en_vivo,
       fuente_contacto(c.custom_fields, ca.is_paid and not ca.other_account) fuente
from ghl_appointments a
left join ghl_contacts c on c.id = a.contact_id
left join v_contact_attribution ca on ca.contact_id = a.contact_id
where not a.deleted
  and ((a.calendar_id = '7SNm0NGnthgEIWCbOf05' and a.date_added >= comercial_corte())
    or (a.calendar_id in ('aLqJG1EY9LmXyuWh6lJE', 'l6nDyuqheYOmLWu813Ez') and a.date_added < comercial_corte()));

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
  s.phone_norm,
  fuente_hoja(s.origen) fuente
from sheet_calls s
left join ghl_contacts c on c.id = s.contact_id
where s.call_date < comercial_corte();

create or replace view public.v_com_opps with (security_invoker = true) as
with appt as (
  select a.contact_id,
         min(a.start_time) filter (where a.status not in ('cancelled', 'invalid')) primera_llamada,
         (array_agg(a.assigned_user_id order by a.start_time desc))[1] ultimo_closer_id,
         bool_or(a.status = 'showed') showed
  from ghl_appointments a
  where a.calendar_id = '7SNm0NGnthgEIWCbOf05' and not a.deleted
  group by 1
),
hoja as materialized (
  select email_norm, phone_norm, lower(trim(lead_name)) nombre_l, call_date, origen, resultado, estado_llamada from sheet_calls
),
base as (
  select o.*, c.email_norm, c.phone_norm, c.custom_fields ccf, c.tags,
         'historico-importado' = any (coalesce(c.tags, '{}')) es_historico,
         coalesce(ca.is_paid and not ca.other_account, false) paid
  from ghl_opportunities o
  left join ghl_contacts c on c.id = o.contact_id
  left join v_contact_attribution ca on ca.contact_id = o.contact_id
  where o.pipeline_id = 'kW8pBFCaVVZJ1pw9okvh'
)
select
  o.id,
  o.contact_id,
  coalesce(o.name, o.email_norm) nombre,
  o.email_norm email,
  o.phone_norm telefono,
  o.stage_name etapa,
  o.status,
  coalesce(o.monetary_value, 0) valor,
  case
    when o.cf ->> '50leQ4Rh4kKu08aQOcRQ' ilike 'DFY%' then 'DFY'
    when o.cf ->> '50leQ4Rh4kKu08aQOcRQ' ilike 'JessiK%' then 'JessiK'
    when is_jessik(o.ccf) then 'JessiK'
    when is_qualified(o.ccf) then 'DFY'
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
    (select min(h.call_date) from hoja h
      where h.call_date < comercial_corte() and coalesce(h.estado_llamada, '') not in ('Canceló', 'Reagendó')
        and ((o.email_norm is not null and h.email_norm = o.email_norm) or (o.phone_norm is not null and h.phone_norm = o.phone_norm)))
  ) primera_llamada,
  -- Sin "Fecha de cierre" solo se usa la fecha en que se marcó Won si NO es del histórico importado
  case when o.status = 'won' then coalesce((o.cf ->> 'UmC8dTOZuUAU5xkYxNLN')::date,
    case when not o.es_historico then (o.last_status_change_at at time zone 'America/Argentina/Buenos_Aires')::date end) end fecha_cierre,
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
  o.es_historico historico,
  o.paid de_ads,
  o.created_at,
  o.last_stage_change_at,
  -- Fuente: histórico = "Origen" de su fila en la hoja; si no, la del contacto
  coalesce(
    case when o.es_historico then (
      select fuente_hoja(h.origen) from hoja h
      where h.origen is not null and ((o.email_norm is not null and h.email_norm = o.email_norm)
         or (o.phone_norm is not null and h.phone_norm = o.phone_norm)
         or h.nombre_l = lower(trim(o.name)))
      order by (h.resultado = 'Vendido') desc nulls last, h.call_date desc nulls last limit 1) end,
    fuente_contacto(o.ccf, o.paid)) fuente
from base o
left join appt on appt.contact_id = o.contact_id
left join comercial_team tc on tc.closer_option = o.cf ->> 'eDFc3YKm41aXOXf7UR8m'
left join comercial_team ta on ta.ghl_user_id = o.assigned_to
left join comercial_team tl on tl.ghl_user_id = appt.ultimo_closer_id;

create or replace view public.v_com_calls with (security_invoker = true) as
select
  a.id,
  a.contact_id,
  (a.date_added at time zone 'America/Argentina/Buenos_Aires')::date fecha_agenda,
  (a.start_time at time zone 'America/Argentina/Buenos_Aires')::date fecha_llamada,
  a.start_time,
  a.status,
  coalesce(t.name, o.closer) closer,
  coalesce(o.producto, case when is_jessik(c.custom_fields) then 'JessiK' when is_qualified(c.custom_fields) then 'DFY' else 'Sin definir' end) producto,
  a.status = 'showed' or (a.status = 'confirmed' and a.start_time < now() and coalesce(o.asistio, false)) asistio,
  coalesce(o.calificacion = 'Calificado', false) calificada_closer,
  coalesce(o.oferta_hecha, false) oferta_hecha,
  o.id opp_id,
  o.etapa,
  o.nombre,
  coalesce(o.fuente, fuente_contacto(c.custom_fields, ca.is_paid and not ca.other_account)) fuente
from ghl_appointments a
left join ghl_contacts c on c.id = a.contact_id
left join v_contact_attribution ca on ca.contact_id = a.contact_id
left join comercial_team t on t.ghl_user_id = a.assigned_user_id
left join (select distinct on (x.contact_id) * from v_com_opps x order by x.contact_id, x.created_at desc) o on o.contact_id = a.contact_id
where a.calendar_id = '7SNm0NGnthgEIWCbOf05' and not a.deleted;

create or replace view public.v_com_calls_todas with (security_invoker = true) as
select id, contact_id, fecha_llamada, status, closer, producto, asistio, calificada_closer, oferta_hecha, false en_vivo, fuente
from v_com_calls_archivo
union all
select id, contact_id, fecha_llamada, status, closer, producto, asistio, calificada_closer, oferta_hecha, true, fuente
from v_com_calls where fecha_llamada >= comercial_corte();

-- Vista Empresa: mismas métricas que el sheet, por fuente, período actual y anterior.
-- Columnas: Comercial = todo; Marketing = Ads + Orgánico. p_producto: 'Todos' | 'DFY' | 'JessiK'.
create or replace function public.comercial_empresa(p_from date, p_to date, p_producto text default 'Todos') returns jsonb
language sql stable security invoker set search_path = public as $$
with
periodos as (select p_from f, p_to t, 'actual' periodo union all select p_from - (p_to - p_from + 1), p_from - 1, 'anterior'),
grupos(grupo, orden, fuentes) as (values
  ('Comercial', 1, null::text[]), ('Marketing', 2, array['Ads', 'Orgánico']), ('Ads', 3, array['Ads']),
  ('Orgánico', 4, array['Orgánico']), ('Referidos', 5, array['Referidos']), ('Afiliados', 6, array['Afiliados'])),
ag as materialized (select * from v_com_agendas where p_producto = 'Todos' or producto = p_producto),
ca as materialized (select * from v_com_calls_todas where p_producto = 'Todos' or producto = p_producto),
op as materialized (select o.*, coalesce(case o.producto when 'JessiK' then t.comm_jessik else t.comm_dfy end, 0) pct
       from v_com_opps o left join comercial_team t on t.name = o.closer
       where o.status = 'won' and (p_producto = 'Todos' or o.producto = p_producto))
select jsonb_agg(jsonb_build_object(
  'grupo', g.grupo, 'orden', g.orden, 'periodo', p.periodo,
  'agendas', (select count(distinct a.contact_id) from ag a where a.fecha_agenda between p.f and p.t and (g.fuentes is null or a.fuente = any (g.fuentes))),
  'asistencias', (select count(*) from ca c where c.asistio and c.fecha_llamada between p.f and p.t and (g.fuentes is null or c.fuente = any (g.fuentes))),
  'asistencias_calificadas', (select count(*) from ca c where c.asistio and c.calificada_closer and c.fecha_llamada between p.f and p.t and (g.fuentes is null or c.fuente = any (g.fuentes))),
  'ofertas', (select count(*) from ca c where c.oferta_hecha and c.fecha_llamada between p.f and p.t and (g.fuentes is null or c.fuente = any (g.fuentes))),
  'cierres', (select count(*) from op o where o.fecha_cierre between p.f and p.t and date_trunc('month', o.primera_llamada) = date_trunc('month', o.fecha_cierre) and (g.fuentes is null or o.fuente = any (g.fuentes))),
  'cierres_seguimiento', (select count(*) from op o where o.fecha_cierre between p.f and p.t and o.primera_llamada < date_trunc('month', o.fecha_cierre) and (g.fuentes is null or o.fuente = any (g.fuentes))),
  'cierres_totales', (select count(*) from op o where o.fecha_cierre between p.f and p.t and (g.fuentes is null or o.fuente = any (g.fuentes))),
  'clientes_nuevos', (select count(distinct o.contact_id) from op o where o.fecha_cierre between p.f and p.t and (g.fuentes is null or o.fuente = any (g.fuentes))),
  'vendido', (select coalesce(sum(o.valor), 0) from op o where o.fecha_cierre between p.f and p.t and (g.fuentes is null or o.fuente = any (g.fuentes))),
  'cobrado', (select coalesce(sum(o.cobrado), 0) from op o where o.fecha_cierre between p.f and p.t and (g.fuentes is null or o.fuente = any (g.fuentes))),
  'comisiones', (select coalesce(sum(o.cobrado * o.pct), 0) from op o where o.fecha_cierre between p.f and p.t and (g.fuentes is null or o.fuente = any (g.fuentes)))
) order by g.orden, p.periodo)
from grupos g cross join periodos p
where is_member();
$$;
revoke execute on function public.comercial_empresa(date, date, text) from public, anon;
grant execute on function public.comercial_empresa(date, date, text) to authenticated;
